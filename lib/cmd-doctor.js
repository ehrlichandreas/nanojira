'use strict';

// `nj doctor` and `nj doctor --fix`.

const fs = require('fs');
const path = require('path');
const { checkFlags } = require('./args.js');
const { PREFIX_TYPE, TYPE_DIR, PARENT_TYPE, SEVERITY } = require('./constants.js');
const { context } = require('./context.js');
const { elementProblems, compareElements } = require('./derive.js');
const { out } = require('./output.js');
const { syncH1 } = require('./parse.js');
const { nowIso, mtimeIso, readTombstones, atomicWrite, renderElement } = require('./store.js');

// ------------------------------------------------------------------- doctor

function collectFindings(ctx) {
  const findings = [];
  for (const e of ctx.configErrors) {
    findings.push({ code: 'config:invalid', severity: 'error', file: path.join(ctx.backlog, '.nanojira.json'), message: e });
  }

  const elements = ctx.elements.slice().sort(compareElements);
  const dupGroups = new Map();
  for (const el of elements) {
    if (!dupGroups.has(el.id)) dupGroups.set(el.id, []);
    dupGroups.get(el.id).push(el);
  }

  for (const el of elements) {
    for (const code of elementProblems(el)) {
      const sev = SEVERITY[code];
      if (sev === null || sev === undefined) continue;
      if (code === 'frontmatter:unreadable' || code === 'file:unreadable') {
        for (const d of el.detail) {
          if (d.code !== code) continue;
          findings.push({ code, severity: sev, element: el.id, file: el.file, line: d.line, message: d.message });
        }
        continue;
      }
      findings.push({ code, severity: sev, element: el.id, file: el.file, message: describeFinding(code, el, dupGroups) });
    }
  }

  for (const folder of ['', 'epics', 'tasks', 'subtasks', 'archive', '.ids']) {
    const dir = path.join(ctx.backlog, folder);
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) {
      if (n.startsWith('.nj-tmp-')) {
        findings.push({ code: 'backlog:stray_tmp', severity: 'warning', file: path.join(dir, n), message: 'stray temp file from an interrupted write' });
      }
    }
  }

  const tombs = readTombstones(ctx.backlog);
  if (ctx.elements.length > 0 && tombs.size === 0) {
    findings.push({ code: 'backlog:ids_missing', severity: 'error', file: path.join(ctx.backlog, '.ids'), message: '.ids/ is missing or empty while element files exist — the never-reuse guarantee is not in force' });
  }

  return findings;
}

function backlogLabel(backlog) {
  const rel = path.relative(process.cwd(), backlog);
  return (rel === '' ? '.' : rel) + '/';
}

function describeFinding(code, el, dupGroups) {
  switch (code) {
    case 'duplicate_id': return `duplicate id, also in: ${dupGroups.get(el.id).filter((o) => o !== el).map((o) => o.file).join(', ')}`;
    case 'missing:title': return 'title is absent or empty';
    case 'missing:status': return `status absent — defaulted`;
    case 'missing:created': return 'created absent — taken from file mtime';
    case 'missing:updated': return 'updated absent — taken from file mtime';
    case 'id:derived': return 'id absent — derived from the file name';
    case 'id:mismatch': return `frontmatter id '${el.id}' does not match the file name`;
    case 'type:derived': return `type absent — derived as '${el.type}'`;
    case 'type:folder': return el.type === null ? 'type cannot be determined from id, frontmatter or folder' : `type '${el.type}' does not match folder '${el.folder}/'`;
    case 'parent:orphaned': return 'parent is absent';
    case 'parent:dangling': return `parent '${el.parent}' points at nothing`;
    case 'parent:cycle': return 'parent chain contains a cycle';
    case 'parent:hierarchy': return el.type === 'epic' ? 'an epic must not have a parent' : `a ${el.type} needs a ${PARENT_TYPE[el.type]} as parent`;
    case 'depends_on:dangling': return `depends_on points at a missing element (${el.depends_on.join(', ')})`;
    case 'depends_on:cycle': return 'depends_on graph contains a cycle';
    case 'unknown:status': return `unknown status '${el.status}'`;
    case 'unknown:priority': return `unknown priority '${el.priority}' — sorted as normal, value left untouched`;
    case 'file:unreadable': return 'file cannot be read';
    case 'done:open_children': return 'done while children are not done';
    case 'archive:not_done': return `archived but status is '${el.status}'`;
    case 'archive:split': return `parent '${el.parent}' is archived while this element is not`;
    case 'title:h1_mismatch': return 'H1 in the body differs from title';
    case 'id:no_tombstone': return 'no tombstone in .ids/ — hand-created, or partial tombstone loss';
    default: return code;
  }
}

function cmdDoctor(flags) {
  checkFlags(flags, [], new Set(['json', 'fix']), false);
  const json = flags.has('json');
  if (flags.has('fix')) return doctorFix(json);

  const ctx = context({ lenient: true, tolerateConfig: true });
  const findings = collectFindings(ctx);
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (json) {
    out(JSON.stringify({ backlog: ctx.backlog, ok: errors.length === 0, problems: findings }, null, 2));
  } else {
    out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    if (findings.length > 0) out('');
    for (const f of findings) {
      const where = f.element ? f.element : path.relative(ctx.backlog, f.file);
      const line = f.line ? ` (line ${f.line})` : '';
      out(`${f.severity === 'error' ? 'ERROR  ' : 'WARNING'} ${where}: ${f.message}${line}`);
    }
  }
  return errors.length > 0 ? 2 : 0;
}

// A file with any unparsable frontmatter line is untouchable for --fix: every
// repair step re-renders from the parsed fields, which would silently drop the
// lines that failed to parse (§ 7 "no information may vanish", § 14).
function fixSkip(el, notes) {
  if (el.problems.has('file:unreadable')) {
    notes.push(`${path.basename(el.file)}: cannot be read — not touched by --fix`);
    return true;
  }
  if (el.problems.has('frontmatter:unreadable')) {
    notes.push(`${el.id}: has unparsable frontmatter lines — not touched by --fix, repair it by hand`);
    return true;
  }
  return false;
}

function doctorFix(json) {
  const actions = [];
  const notes = [];
  const reload = () => context({ lenient: true, tolerateConfig: true });
  const skipped = new Set();
  const guard = (el) => {
    if (!el.problems.has('file:unreadable') && !el.problems.has('frontmatter:unreadable')) return false;
    if (!skipped.has(el.id)) { skipped.add(el.id); fixSkip(el, notes); }
    return true;
  };

  // For a KNOWN field an empty value counts as absent — `status:` must not be
  // a dead end that is reported forever and never filled. UNKNOWN keys keep
  // their empty value verbatim; nothing here ever touches them (§ 14).
  const absent = (el, k) => {
    if (!el.fields.has(k)) return true;
    const v = el.fields.get(k);
    return Array.isArray(v) ? v.length === 0 : String(v === undefined || v === null ? '' : v).trim() === '';
  };

  // Step 5 writes `created` from the file mtime — but step 1 already rewrote
  // the file by then, so the true mtime has to be taken before anything runs.
  // Keyed by path, not by ID: two files may carry the same duplicated ID and
  // have different mtimes, and an ID key would hand both the same `created`.
  // Steps 2 and 3 rename, so they carry the entry over to the new path.
  const mtimes = new Map();
  for (const el of reload().elements) mtimes.set(el.file, mtimeIso(el.file));
  const rename = (from, to) => {
    fs.renameSync(from, to);
    if (mtimes.has(from)) { mtimes.set(to, mtimes.get(from)); mtimes.delete(from); }
  };

  // 1. write missing id / type — only when the key is genuinely absent; an
  //    existing non-empty value is never overwritten, not even an invalid one (§ 14).
  let ctx = reload();
  for (const el of ctx.elements) {
    if (guard(el) || !el.parsed) continue;
    const ov = new Map();
    if (el.problems.has('id:derived') && absent(el, 'id')) ov.set('id', el.id);
    if (el.problems.has('type:derived') && el.type && absent(el, 'type')) ov.set('type', el.type);
    if (ov.size === 0) continue;
    ov.set('updated', nowIso());
    atomicWrite(el.file, renderElement(el, ov, undefined));
    actions.push(`${el.id}: wrote ${Array.from(ov.keys()).filter((k) => k !== 'updated').join(', ')} into the frontmatter`);
  }

  // 2. rename file to match the frontmatter id
  ctx = reload();
  for (const el of ctx.elements) {
    if (guard(el)) continue;
    if (!el.problems.has('id:mismatch')) continue;
    const target = path.join(path.dirname(el.file), el.id + '.md');
    if (fs.existsSync(target)) { notes.push(`${el.file}: cannot rename to ${path.basename(target)} — target exists`); continue; }
    rename(el.file, target);
    actions.push(`renamed ${path.basename(el.file)} → ${path.basename(target)}`);
  }

  // 3. move into the correct type folder (only when id prefix and type agree)
  ctx = reload();
  for (const el of ctx.elements) {
    if (guard(el)) continue;
    if (el.archived || !el.problems.has('type:folder') || el.type === null) continue;
    const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
    if (!pm || PREFIX_TYPE[pm[1]] !== el.type) {
      notes.push(`${el.id}: id prefix and type disagree — not moved, resolve by hand`);
      continue;
    }
    const dir = path.join(ctx.backlog, TYPE_DIR[el.type]);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(el.file));
    if (fs.existsSync(target)) { notes.push(`${el.id}: cannot move into ${TYPE_DIR[el.type]}/ — target exists`); continue; }
    rename(el.file, target);
    actions.push(`moved ${el.id} → ${TYPE_DIR[el.type]}/`);
  }

  // 4. backfill tombstones
  ctx = reload();
  const dir = path.join(ctx.backlog, '.ids');
  fs.mkdirSync(dir, { recursive: true });
  const tombs = readTombstones(ctx.backlog);
  let created = 0;
  for (const el of ctx.elements) {
    if (tombs.has(el.id)) continue;
    try { fs.closeSync(fs.openSync(path.join(dir, el.id), 'wx')); created++; } catch { /* raced */ }
  }
  if (created > 0) {
    actions.push(`created ${created} missing tombstone${created === 1 ? '' : 's'} in .ids/`);
    notes.push('tombstones for already-deleted IDs cannot be recovered — the never-reuse guarantee is void for those numbers');
  }

  // 5. write missing status, created (from mtime) and updated (= now).
  //    Only absent keys are written; an existing invalid value stays (§ 14).
  ctx = reload();
  for (const el of ctx.elements) {
    if (guard(el) || !el.parsed) continue;
    const ov = new Map();
    if (el.problems.has('missing:status') && absent(el, 'status')) ov.set('status', el.status);
    if (el.problems.has('missing:created') && absent(el, 'created')) {
      ov.set('created', mtimes.get(el.file) || el.created);
    }
    if (ov.size === 0 && !el.problems.has('missing:updated')) continue;
    const wrote = Array.from(ov.keys());
    ov.set('updated', nowIso());
    atomicWrite(el.file, renderElement(el, ov, undefined));
    actions.push(`${el.id}: wrote ${wrote.concat(['updated']).join(', ')}`);
  }

  // 6. pull the H1 up from title
  ctx = reload();
  for (const el of ctx.elements) {
    if (guard(el) || !el.parsed || !el.problems.has('title:h1_mismatch')) continue;
    atomicWrite(el.file, renderElement(el, new Map([['updated', nowIso()]]), syncH1(el.body, el.title)));
    actions.push(`${el.id}: synchronised the H1 with title`);
  }

  // 7. remove stray temp files
  ctx = reload();
  for (const folder of ['', 'epics', 'tasks', 'subtasks', 'archive', '.ids']) {
    const d = path.join(ctx.backlog, folder);
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names.sort()) {
      if (!n.startsWith('.nj-tmp-')) continue;
      fs.unlinkSync(path.join(d, n));
      actions.push(`removed stray temp file ${path.join(folder, n)}`);
    }
  }

  // 8. rebuild the index — round two, intentionally a no-op.

  ctx = reload();
  const findings = collectFindings(ctx);
  const errors = findings.filter((f) => f.severity === 'error');

  if (json) {
    out(JSON.stringify({ backlog: ctx.backlog, ok: errors.length === 0, fixed: actions, notes, problems: findings }, null, 2));
  } else {
    for (const a of actions) out(`FIXED   ${a}`);
    for (const n of notes) out(`NOTE    ${n}`);
    if (actions.length === 0) out('Nothing to fix.');
    out('');
    const warnings = findings.filter((f) => f.severity === 'warning');
    out(`${backlogLabel(ctx.backlog)}: ${ctx.elements.length} entries, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} remaining`);
    for (const f of findings) {
      const where = f.element ? f.element : path.relative(ctx.backlog, f.file);
      out(`${f.severity === 'error' ? 'ERROR  ' : 'WARNING'} ${where}: ${f.message}`);
    }
  }
  return errors.length > 0 ? 2 : 0;
}

module.exports = { cmdDoctor };
