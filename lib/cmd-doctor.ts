'use strict';

// `nj doctor` and `nj doctor --fix`.

import type { Flags, Element, Context, Finding } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from './args.ts';
import { PREFIX_TYPE, TYPE_DIR, PARENT_TYPE, SEVERITY } from './constants.ts';
import { context } from './context.ts';
import { elementProblems, compareElements } from './derive.ts';
import { out } from './output.ts';
import { syncH1 } from './parse.ts';
import { nowIso, mtimeIso, readTombstones, atomicWrite, renderElement } from './store.ts';

// ------------------------------------------------------------------- doctor

function collectFindings(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  for (const e of ctx.configErrors) {
    findings.push({ code: 'config:invalid', severity: 'error', file: path.join(ctx.backlog, '.nanojira.json'), message: e });
  }

  const elements = ctx.elements.slice().sort(compareElements);
  const dupGroups: Map<string, Element[]> = new Map();
  for (const el of elements) {
    if (!dupGroups.has(el.id)) dupGroups.set(el.id, []);
    (dupGroups.get(el.id) as Element[]).push(el);
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

function backlogLabel(backlog: string) {
  const rel = path.relative(process.cwd(), backlog);
  return (rel === '' ? '.' : rel) + '/';
}

function describeFinding(code: string, el: Element, dupGroups: Map<string, Element[]>): string {
  switch (code) {
    case 'duplicate_id': return `duplicate id, also in: ${(dupGroups.get(el.id) as Element[]).filter((o) => o !== el).map((o) => o.file).join(', ')}`;
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
    case 'parent:hierarchy': return el.type === 'epic' ? 'an epic must not have a parent' : `a ${el.type} needs a ${PARENT_TYPE[el.type as string]} as parent`;
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

function cmdDoctor(flags: Flags) {
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
function fixSkip(el: Element, notes: string[]) {
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

// What every step shares: the accumulated report, the two guards, and the
// mtime bookkeeping `rename` keeps current across steps 2/3's moves.
interface FixShared {
  actions: string[];
  notes: string[];
  guard(el: Element): boolean;
  absent(el: Element, k: string): boolean;
  mtimes: Map<string, string>;
  rename(from: string, to: string): void;
  reload(): Context;
}

/**
 * doctorFix runs nine steps in a fixed sequence -- the eight § 14 enumerates
 * plus the mtime snapshot it doesn't count (S4 karte § 1-2): step 5 needs the
 * file's ORIGINAL mtime even though step 1 may already have rewritten it, and
 * `exit-doctor-fix.js` pins `fixed[]` in exactly this order ("Steps run in
 * this order", § 14). Unlike loadElement's derivers, no step's OUTPUT feeds
 * the next as data -- every step reads and writes the same shared
 * actions/notes/mtimes by reference. `FixCtx<S>` is a pure phantom marker:
 * spreading `{ ...fc, stage: S + 1 }` advances the type without touching the
 * underlying arrays/map, so a call passing the wrong stage is a real
 * `tsc` error instead of a violated comment.
 */
interface FixCtx<S extends number> extends FixShared { readonly stage: S }

function makeFixCtx(): FixCtx<0> {
  const actions: string[] = [];
  const notes: string[] = [];
  const reload = () => context({ lenient: true, tolerateConfig: true });
  const skipped: Set<string> = new Set();
  const guard = (el: Element) => {
    if (!el.problems.has('file:unreadable') && !el.problems.has('frontmatter:unreadable')) return false;
    if (!skipped.has(el.id)) { skipped.add(el.id); fixSkip(el, notes); }
    return true;
  };
  // For a KNOWN field an empty value counts as absent — `status:` must not be
  // a dead end that is reported forever and never filled. UNKNOWN keys keep
  // their empty value verbatim; nothing here ever touches them (§ 14).
  const absent = (el: Element, k: string) => {
    if (!el.fields.has(k)) return true;
    const v = el.fields.get(k);
    return Array.isArray(v) ? v.length === 0 : String(v === undefined || v === null ? '' : v).trim() === '';
  };
  const mtimes: Map<string, string> = new Map();
  const rename = (from: string, to: string) => {
    fs.renameSync(from, to);
    if (mtimes.has(from)) { mtimes.set(to, mtimes.get(from) as string); mtimes.delete(from); }
  };
  return { actions, notes, guard, absent, mtimes, rename, reload, stage: 0 };
}

// Step 5 writes `created` from the file mtime — but step 1 already rewrote
// the file by then, so the true mtime has to be taken before anything runs.
// Keyed by path, not by ID: two files may carry the same duplicated ID and
// have different mtimes, and an ID key would hand both the same `created`.
// Steps 2 and 3 rename, so they carry the entry over to the new path
// (`rename`, in makeFixCtx). Measured (S4 karte § 2): move this after step 1
// and `created` becomes the fix's own run time instead of the file's mtime.
function fixSnapshotMtimes(fc: FixCtx<0>): FixCtx<1> {
  for (const el of fc.reload().elements) fc.mtimes.set(el.file, mtimeIso(el.file));
  return { ...fc, stage: 1 };
}

// 1. write missing id / type — only when the key is genuinely absent; an
//    existing non-empty value is never overwritten, not even an invalid one (§ 14).
function fixStep1(fc: FixCtx<1>): FixCtx<2> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed) continue;
    const ov: Map<string, string | string[]> = new Map();
    if (el.problems.has('id:derived') && fc.absent(el, 'id')) ov.set('id', el.id);
    if (el.problems.has('type:derived') && el.type && fc.absent(el, 'type')) ov.set('type', el.type);
    if (ov.size === 0) continue;
    ov.set('updated', nowIso());
    atomicWrite(el.file, renderElement(el, ov, undefined));
    fc.actions.push(`${el.id}: wrote ${Array.from(ov.keys()).filter((k) => k !== 'updated').join(', ')} into the frontmatter`);
  }
  return { ...fc, stage: 2 };
}

// 2. rename file to match the frontmatter id
function fixStep2(fc: FixCtx<2>): FixCtx<3> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el)) continue;
    if (!el.problems.has('id:mismatch')) continue;
    const target = path.join(path.dirname(el.file), el.id + '.md');
    if (fs.existsSync(target)) { fc.notes.push(`${el.file}: cannot rename to ${path.basename(target)} — target exists`); continue; }
    fc.rename(el.file, target);
    fc.actions.push(`renamed ${path.basename(el.file)} → ${path.basename(target)}`);
  }
  return { ...fc, stage: 3 };
}

// 3. move into the correct type folder (only when id prefix and type agree).
// The tombstone claim in step 4 does NOT depend on this running first: el.id
// is fixed at load time from the frontmatter, unaffected by which folder the
// file sits in (measured, S4 karte § 2) -- 3 precedes 4 only because § 14 and
// `exit-doctor-fix.js` pin `fixed[]` in this order, not because a later 4
// would claim a different id.
function fixStep3(fc: FixCtx<3>): FixCtx<4> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el)) continue;
    if (el.archived || !el.problems.has('type:folder') || el.type === null) continue;
    const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
    if (!pm || PREFIX_TYPE[pm[1]] !== el.type) {
      fc.notes.push(`${el.id}: id prefix and type disagree — not moved, resolve by hand`);
      continue;
    }
    const dir = path.join(ctx.backlog, TYPE_DIR[el.type]);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(el.file));
    if (fs.existsSync(target)) { fc.notes.push(`${el.id}: cannot move into ${TYPE_DIR[el.type]}/ — target exists`); continue; }
    fc.rename(el.file, target);
    fc.actions.push(`moved ${el.id} → ${TYPE_DIR[el.type]}/`);
  }
  return { ...fc, stage: 4 };
}

// 4. backfill tombstones
function fixStep4(fc: FixCtx<4>): FixCtx<5> {
  const ctx = fc.reload();
  const dir = path.join(ctx.backlog, '.ids');
  fs.mkdirSync(dir, { recursive: true });
  const tombs = readTombstones(ctx.backlog);
  let created = 0;
  for (const el of ctx.elements) {
    if (tombs.has(el.id)) continue;
    try { fs.closeSync(fs.openSync(path.join(dir, el.id), 'wx')); created++; } catch { /* raced */ }
  }
  if (created > 0) {
    fc.actions.push(`created ${created} missing tombstone${created === 1 ? '' : 's'} in .ids/`);
    fc.notes.push('tombstones for already-deleted IDs cannot be recovered — the never-reuse guarantee is void for those numbers');
  }
  return { ...fc, stage: 5 };
}

// 5. write missing status, created (from mtime) and updated (= now).
//    Only absent keys are written; an existing invalid value stays (§ 14).
function fixStep5(fc: FixCtx<5>): FixCtx<6> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed) continue;
    const ov: Map<string, string | string[]> = new Map();
    if (el.problems.has('missing:status') && fc.absent(el, 'status')) ov.set('status', el.status);
    if (el.problems.has('missing:created') && fc.absent(el, 'created')) {
      ov.set('created', fc.mtimes.get(el.file) || el.created);
    }
    if (ov.size === 0 && !el.problems.has('missing:updated')) continue;
    const wrote = Array.from(ov.keys());
    ov.set('updated', nowIso());
    atomicWrite(el.file, renderElement(el, ov, undefined));
    fc.actions.push(`${el.id}: wrote ${wrote.concat(['updated']).join(', ')}`);
  }
  return { ...fc, stage: 6 };
}

// 6. pull the H1 up from title
function fixStep6(fc: FixCtx<6>): FixCtx<7> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !el.problems.has('title:h1_mismatch')) continue;
    atomicWrite(el.file, renderElement(el, new Map([['updated', nowIso()]]), syncH1(el.body, el.title)));
    fc.actions.push(`${el.id}: synchronised the H1 with title`);
  }
  return { ...fc, stage: 7 };
}

// 7. remove stray temp files
function fixStep7(fc: FixCtx<7>): FixCtx<8> {
  const ctx = fc.reload();
  for (const folder of ['', 'epics', 'tasks', 'subtasks', 'archive', '.ids']) {
    const d = path.join(ctx.backlog, folder);
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names.sort()) {
      if (!n.startsWith('.nj-tmp-')) continue;
      fs.unlinkSync(path.join(d, n));
      fc.actions.push(`removed stray temp file ${path.join(folder, n)}`);
    }
  }
  return { ...fc, stage: 8 };
}

interface FixResult extends FixCtx<9> {
  ctx: Context;
  findings: Finding[];
}

// 8. rebuild the index — round two, intentionally a no-op — and collect
//    whatever remains for the report.
function fixStep8(fc: FixCtx<8>): FixResult {
  const ctx = fc.reload();
  const findings = collectFindings(ctx);
  return { ...fc, stage: 9, ctx, findings };
}

function doctorFix(json: boolean) {
  const fc0 = makeFixCtx();
  const fc1 = fixSnapshotMtimes(fc0);
  const fc2 = fixStep1(fc1);
  const fc3 = fixStep2(fc2);
  const fc4 = fixStep3(fc3);
  const fc5 = fixStep4(fc4);
  const fc6 = fixStep5(fc5);
  const fc7 = fixStep6(fc6);
  const fc8 = fixStep7(fc7);
  const { actions, notes, ctx, findings } = fixStep8(fc8);
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

export { cmdDoctor };
