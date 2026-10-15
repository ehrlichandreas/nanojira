'use strict';

// `nanojira doctor` and `nanojira doctor --fix`.

import type { Flags, Element, Context, Finding } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { allClaimDirs, claimsRootDir, highestEntry, isClaimStale, releaseUnconditional, removeClaimDirWholesale } from '../core/claims.ts';
import {
  PREFIX_TYPE, PARENT_TYPE, SEVERITY,
  V3_DIR_REL, V3_CONFIG_REL, V3_IDS_REL, V3_INDEX_REL, LEGACY_CONFIG_REL, LEGACY_IDS_REL, LEGACY_INDEX_REL,
} from '../core/constants.ts';
import { workingDir } from '../core/config.ts';
import { context } from '../core/context.ts';
import { elementProblems, compareElements } from '../core/derive.ts';
import { ID_FOLDER, moveTarget, misplacedCode, ownFolder, removeEmptiedIdFolders } from '../core/layout.ts';
import { out } from '../core/output.ts';
import { syncH1, sectionCheckboxCounts } from '../core/parse.ts';
import { article } from './cmd-new.ts';
import { V2_README, V3_README } from '../core/readme-texts.ts';
import { statusIsFresh, refreshStatus } from '../core/status.ts';
import { tagsIsFresh, refreshTags } from '../core/tags.ts';
import { nowIso, nowMs, mtimeIso, readTombstones, tombstoneLocation, atomicWrite, planMove, runMove, renderElement } from '../core/store.ts';

// ------------------------------------------------------------------- doctor

function collectFindings(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  // Backlog-level, no element: the v2 layout itself is the finding (§ 4,
  // § 14 — "doctor is the one command that runs on a legacy backlog").
  if (ctx.legacy) {
    findings.push({ code: 'backlog:legacy_layout', severity: 'error', file: path.join(ctx.backlog, LEGACY_CONFIG_REL),
      message: `the backlog is in the v2 (legacy) layout (${LEGACY_CONFIG_REL}, ${LEGACY_IDS_REL}/) — \`nanojira doctor --fix\` migrates it to .nanojira/` });
  }
  const configFile = path.join(ctx.backlog, ctx.legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL);
  for (const e of ctx.configErrors) {
    findings.push({ code: 'config:invalid', severity: 'error', file: configFile, message: e });
  }
  // config:unknown_key / config:unknown_code (§ 7, DECISIONS 166): warnings,
  // never invalidate the configuration -- reported alongside any real
  // config:invalid findings above, not instead of them.
  for (const w of ctx.configWarnings) {
    findings.push({ code: w.code, severity: 'warning', file: configFile, message: w.message });
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
      // While the configuration is invalid, every element is judged against
      // the DEFAULT layout (loadConfig's fallback), so a renamed folder or an
      // unrelated typo would report every file misplaced — noise pointing at
      // the wrong repair. Suppressed, like backlog:status_stale (DECISIONS 102).
      if (ctx.configErrors.length > 0 && (code === 'type:folder' || code === 'layout:misplaced')) continue;
      if (code === 'frontmatter:unreadable' || code === 'file:unreadable') {
        for (const d of el.detail) {
          if (d.code !== code) continue;
          findings.push({ code, severity: sev, element: el.id, file: el.file, line: d.line, message: d.message });
        }
        continue;
      }
      findings.push({ code, severity: sev, element: el.id, file: el.file, message: describeFinding(code, el, dupGroups, ctx.cfg) });
    }
  }

  const scan = ctx.scan;
  for (const file of strayTmpFiles(scan.dirs.concat(claimsScanDirs(ctx.backlog)))) {
    findings.push({ code: 'backlog:stray_tmp', severity: 'warning', file, message: 'stray temp file from an interrupted write' });
  }
  findings.push(...collectClaimFindings(ctx));
  if (claimsNeedGitignoreLine(ctx.backlog)) {
    findings.push({ code: 'backlog:claims_unignored', severity: 'warning', file: path.join(ctx.backlog, '.gitignore'),
      message: ".nanojira/claims/ exists but .gitignore has no line that is exactly '.nanojira/claims/'" });
  }
  // A folder the scan cannot list may hold element files nobody sees (DECISIONS 93 F9).
  for (const { dir, reason } of scan.unreadable) {
    findings.push({ code: 'backlog:unreadable_dir', severity: 'error', file: dir, message: `folder cannot be listed (${reason}) — element files in it are not seen` });
  }

  const tombs = readTombstones(ctx.idsDir, ctx.cfg.ids.shardSize);
  if (ctx.elements.length > 0 && tombs.size === 0) {
    findings.push({ code: 'backlog:ids_missing', severity: 'error', file: ctx.idsDir, message: `${path.relative(ctx.backlog, ctx.idsDir)}/ is missing or empty while element files exist — the never-reuse guarantee is not in force` });
  }
  // backlog:ids_layout_mismatch (§ 5 `ids.shardSize`, § 8): the on-disk
  // tombstone layout disagrees with what the current configuration asks
  // for — the same "configuration changed, the backlog hasn't caught up
  // yet" condition `backlog:legacy_layout` reports, ERROR for the same
  // reason (DECISIONS: no silent dual-layout support forever). Gated on a
  // valid configuration exactly like the checks above it: while
  // `config:invalid` holds there is no target layout to compare against.
  if (ctx.configErrors.length === 0) {
    const actual = detectIdsLayout(ctx.idsDir);
    const wantSharded = ctx.cfg.ids.shardSize > 0;
    if (actual === 'mixed' || (actual === 'flat' && wantSharded) || (actual === 'sharded' && !wantSharded)) {
      const want = wantSharded ? `sharded (ids.shardSize=${ctx.cfg.ids.shardSize})` : 'flat';
      findings.push({ code: 'backlog:ids_layout_mismatch', severity: 'error', file: ctx.idsDir,
        message: `${path.relative(ctx.backlog, ctx.idsDir)}/ is laid out ${actual} on disk but the configuration wants ${want} — \`nanojira doctor --fix\` moves the tombstones` });
    }
  }

  // Without a valid configuration there is no status list to render against
  // (DECISIONS 100); with `statusFile: false` the file is not nanojira's (§ 4). A
  // legacy backlog predates STATUS.md and so has none, which is exactly a
  // stale rendering — doctor runs every other check against the v2 places,
  // this included (DECISIONS 101, AMBIGUITIES 74).
  if (ctx.configErrors.length === 0 && ctx.cfg.layout.statusFile && !statusIsFresh(ctx.backlog, ctx.elements, ctx.cfg)) {
    findings.push({ code: 'backlog:status_stale', severity: 'warning', file: path.join(ctx.backlog, 'STATUS.md'), message: 'STATUS.md is missing or differs from a fresh rendering — `nanojira doctor --fix` regenerates it' });
  }
  // Same mechanism, same rationale, applied to TAGS.md (DECISIONS 101, 102
  // above apply unchanged: no vocabulary to render against without a valid
  // configuration; `tagsFile: false` means it is not nanojira's file).
  if (ctx.configErrors.length === 0 && ctx.cfg.layout.tagsFile && !tagsIsFresh(ctx.backlog, ctx.elements, ctx.cfg)) {
    findings.push({ code: 'backlog:tags_stale', severity: 'warning', file: path.join(ctx.backlog, 'TAGS.md'), message: 'TAGS.md is missing or differs from a fresh rendering — `nanojira doctor --fix` regenerates it' });
  }

  // problems.ignore (§ 7, DECISIONS 165/166): suppressed everywhere a code
  // is reported, element-level or backlog-level alike -- one filter here
  // covers both, rather than threading the ignore list into every push
  // site above. Never touches the readiness computation (isReady reads
  // el.problems directly, not this findings list).
  if (ctx.cfg.problems.ignore.length === 0) return findings;
  const ignore = new Set(ctx.cfg.problems.ignore);
  return findings.filter((f) => !ignore.has(f.code));
}

// A write leaves its temp file in the target's folder (§ 12), and under
// `hierarchy` that can be any folder of the backlog.
function strayTmpFiles(dirs: string[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) if (n.startsWith('.nj-tmp-')) found.push(path.join(dir, n));
  }
  return found;
}

// `.nanojira/claims/<id>/` is never walked by scanBacklog (every dot-directory
// is out of bounds, § 4 DECISIONS 91 B11), so a stray temp file inside one
// needs its own list of directories to check (§ 12 "Claims").
function claimsScanDirs(backlog: string): string[] {
  return [claimsRootDir(backlog), ...allClaimDirs(backlog).map((c) => c.dir)];
}

// claim:mismatch (an element claimed N whose assignee is not N) and
// claim:orphaned (a claim directory for an element that is archived or does
// not exist — backlog-level in the latter case) — § 7, § 12a.
function collectClaimFindings(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  for (const { id, dir } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    const h = highestEntry(dir);
    if (!el) {
      findings.push({ code: 'claim:orphaned', severity: 'warning', file: dir, message: `claim directory for '${id}', which does not exist` });
      continue;
    }
    if (el.archived) {
      findings.push({ code: 'claim:orphaned', severity: 'warning', element: el.id, file: dir, message: `${el.id} is archived but still carries a claim directory` });
    }
    if (h && h.kind === 'claimed' && h.name !== el.assignee) {
      findings.push({ code: 'claim:mismatch', severity: 'warning', element: el.id, file: el.file,
        message: `claimed by '${h.name}' but assignee is '${el.assignee || '(empty)'}'` });
    }
    // claim:stale (§ 7, § 12 "Claims"): advisory only, reported here exactly
    // as list/show report it (core/derive.ts entryJson) — never repaired by
    // --fix (§ 14).
    if (h && h.kind === 'claimed' && isClaimStale(h.time, ctx.cfg.claims.staleAfterHours, nowMs())) {
      findings.push({ code: 'claim:stale', severity: 'warning', element: el.id, file: el.file,
        message: `claimed by '${h.name}' since ${h.time}, past the ${ctx.cfg.claims.staleAfterHours}h staleness threshold` });
    }
  }
  return findings;
}

const CLAIMS_GITIGNORE_LINE = '.nanojira/claims/';

function gitignoreHasClaimsLine(backlog: string): boolean {
  let content: string;
  try { content = fs.readFileSync(path.join(backlog, '.gitignore'), 'utf8'); } catch { return false; }
  return content.split('\n').some((l) => l.replace(/\r$/, '') === CLAIMS_GITIGNORE_LINE);
}

function claimsNeedGitignoreLine(backlog: string): boolean {
  return fs.existsSync(claimsRootDir(backlog)) && !gitignoreHasClaimsLine(backlog);
}

// "the last line's ending, or LF if the file is empty or its last line has
// none" (§ 12a) — an append has no matched line to copy from, unlike step
// 0's gitignore replace, which can reuse the one line it overwrites.
function appendGitignoreLine(content: string, line: string): string {
  if (content === '') return line + '\n';
  if (content.endsWith('\r\n')) return content + line + '\r\n';
  if (content.endsWith('\n')) return content + line + '\n';
  return content + '\n' + line + '\n';
}

function backlogLabel(backlog: string) {
  const rel = path.relative(workingDir(), backlog);
  return (rel === '' ? '.' : rel) + '/';
}

function describeFinding(code: string, el: Element, dupGroups: Map<string, Element[]>, cfg: Context['cfg']): string {
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
    case 'layout:misplaced': return `file lies in '${el.folder === '' ? '.' : el.folder}/', not where the layout puts it`;
    case 'parent:orphaned': return 'parent is absent';
    case 'parent:dangling': return `parent '${el.parent}' points at nothing`;
    case 'parent:cycle': return 'parent chain contains a cycle';
    case 'parent:hierarchy': return el.type === 'epic' ? 'an epic must not have a parent' : `a ${el.type} needs ${article(PARENT_TYPE[el.type as string])} ${PARENT_TYPE[el.type as string]} as parent`;
    case 'depends_on:dangling': return `depends_on points at a missing element (${el.depends_on.join(', ')})`;
    case 'depends_on:cycle': return 'depends_on graph contains a cycle';
    case 'unknown:status': return `unknown status '${el.status}'`;
    case 'unknown:priority': return `unknown priority '${el.priority}' — sorted as normal, value left untouched`;
    case 'file:unreadable': return 'file cannot be read';
    case 'done:open_children': return 'done while children are not done';
    case 'archive:not_done': return `archived but status is '${el.status}'`;
    case 'archive:split': return `parent '${el.parent}' is archived while this element is not`;
    case 'title:h1_mismatch': return 'H1 in the body differs from title';
    case 'id:no_tombstone': return 'no tombstone in the ids folder — hand-created, or partial tombstone loss';
    case 'acceptance:no_checkbox': return 'acceptance criteria has content but no checkbox items — nothing for check to tick';
    case 'done:no_acceptance': return 'done with no acceptance criteria';
    case 'done:open_acceptance': {
      const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
      return `done with ${counts ? counts.unticked : '?'} of ${counts ? counts.total : '?'} acceptance boxes still unticked`;
    }
    default: return code;
  }
}

function cmdDoctor(flags: Flags) {
  checkFlags(flags, [], new Set(['json', ...cliFieldNames('doctor')]), false);
  const json = flags.has('json');
  if (flags.has('fix')) return doctorFix(flags, json);

  const ctx = context(flags, { lenient: true, tolerateConfig: true });
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
  move(plan: ReturnType<typeof planMove>): void;
  reload(): Context;
}

/**
 * doctorFix runs ten steps in a fixed sequence -- § 14's steps 1-9 (step 0,
 * the legacy migration, arrives with V3-4) plus the mtime snapshot § 14
 * doesn't count (S4 karte § 1-2): step 5 needs the
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

function makeFixCtx(flags: Flags): FixCtx<0> {
  const actions: string[] = [];
  const notes: string[] = [];
  const reload = () => context(flags, { lenient: true, tolerateConfig: true });
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
  const rekey = (from: string, to: string) => {
    for (const [k, v] of Array.from(mtimes)) {
      if (k === from) { mtimes.delete(k); mtimes.set(to, v); }
      else if (k.startsWith(from + path.sep)) { mtimes.delete(k); mtimes.set(to + k.slice(from.length), v); }
    }
  };
  const rename = (from: string, to: string) => {
    fs.renameSync(from, to);
    rekey(from, to);
  };
  // Step 3's moves: a file, or a whole folder with everything in it.
  const move = (plan: ReturnType<typeof planMove>) => {
    runMove(plan);
    for (const [from, to] of plan.renames) rekey(from, to);
  };
  return { actions, notes, guard, absent, mtimes, rename, move, reload, stage: 0 };
}

// 0. migrate a legacy layout, when unambiguous: create `.nanojira/`, rename
// the v2 configuration and tombstone folder into it, and delete the v2 index
// cache (§ 14 step 0). An EMPTY `.nanojira/` beside the v2 files does not
// count as "both present" — the ambiguity needs a v3 configuration or v3
// tombstones, i.e. the config file or the ids FOLDER actually existing
// (AMBIGUITIES 73) — so step 0 still proceeds past a bare `mkdir .nanojira`
// left over from a previous, aborted attempt.
//
// fixGitignore/fixReadme are NOT called here. They used to run only on this
// path, which meant a crash after these renames but before them (process
// killed, disk full) left `.gitignore`/README unfixed forever: the next
// `--fix` sees a v3 layout already, `ctx.legacy` is false, and this
// function never runs again (G2). doctorFix calls them unconditionally on
// every run instead — they are already no-ops once the line/text no longer
// matches, so a pristine v3 backlog pays nothing for it.
function fixStep0(ctx: Context, fc: FixShared) {
  const backlog = ctx.backlog;
  const v3Config = path.join(backlog, V3_CONFIG_REL);
  const v3Ids = path.join(backlog, V3_IDS_REL);
  if (fs.existsSync(v3Config) || fs.existsSync(v3Ids)) {
    fc.notes.push(`both the v2 and the v3 place exist (${LEGACY_CONFIG_REL} / ${LEGACY_IDS_REL} and ${V3_CONFIG_REL} / ${V3_IDS_REL}) — ambiguous, nothing moved; remove one copy by hand and run \`nanojira doctor --fix\` again`);
    return;
  }
  fs.mkdirSync(path.join(backlog, V3_DIR_REL), { recursive: true });
  fc.rename(path.join(backlog, LEGACY_CONFIG_REL), v3Config);
  fc.rename(path.join(backlog, LEGACY_IDS_REL), v3Ids);
  const legacyIndex = path.join(backlog, LEGACY_INDEX_REL);
  if (fs.existsSync(legacyIndex)) fs.unlinkSync(legacyIndex);
  fc.actions.push(`migrated the legacy layout: ${LEGACY_CONFIG_REL} → ${V3_CONFIG_REL}, ${LEGACY_IDS_REL}/ → ${V3_IDS_REL}/`);
}

// 0 (continued). A backlog that is already v3 (not `backlog:legacy_layout`)
// can still carry a stray top-level `.ids/` — the half of a crash between
// step 0's two renames that left `.ids/` → `.nanojira/ids/` incomplete while
// `.nanojira.json` → `.nanojira/config.json` finished (DECISIONS 108 G1).
// Removed only when every tombstone name in it is already present in
// `.nanojira/ids/` — never discard a tombstone that exists nowhere else,
// since "never reuse" (§ 8) is the one invariant `--fix` cannot compromise
// on. A note only, no new problem code: harmless one-time migration
// residue, not a current defect for `doctor` to name.
function fixStrayIds(ctx: Context, fc: FixShared) {
  const backlog = ctx.backlog;
  const strayDir = path.join(backlog, LEGACY_IDS_REL);
  if (!fs.existsSync(strayDir)) return;
  // The stray `.ids/` is always flat (a v2 leftover; v2 never sharded), but
  // the "real" `.nanojira/ids/` it is compared against may now be sharded —
  // `readTombstones` needs the current configuration's layout to see it.
  const stray = readTombstones(strayDir);
  const real = readTombstones(path.join(backlog, V3_IDS_REL), ctx.cfg.ids.shardSize);
  for (const id of stray) if (!real.has(id)) return;
  fs.rmSync(strayDir, { recursive: true, force: true });
  fc.notes.push(`removed the stray top-level ${LEGACY_IDS_REL}/ (every tombstone in it was already in ${V3_IDS_REL}/, § 14 step 0)`);
}

// Which of the two `ids/` layouts (§ 8) is actually on disk, independent of
// what the configuration currently asks for: a flat tombstone (`EPIC-003`)
// sitting directly in `idsDir`, or a type directory (`EPIC`, `TSK`, `SUB`)
// holding bucket subdirectories. `'mixed'` means both kinds of entry exist
// side by side — a partial migration (crash mid-`--fix`) — and, like
// `'flat'`/`'sharded'` disagreeing with the configuration, is always a
// `backlog:ids_layout_mismatch`, never silently tolerated.
const TOMBSTONE_RE = /^(EPIC|TSK|SUB)-(\d+)$/;

function detectIdsLayout(idsDir: string): 'empty' | 'flat' | 'sharded' | 'mixed' {
  let entries;
  try { entries = fs.readdirSync(idsDir, { withFileTypes: true }); } catch { return 'empty'; }
  let flat = false, sharded = false;
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory() && TOMBSTONE_RE.test(e.name)) flat = true;
    else if (e.isDirectory() && Object.prototype.hasOwnProperty.call(PREFIX_TYPE, e.name)) sharded = true;
  }
  if (flat && sharded) return 'mixed';
  if (flat) return 'flat';
  if (sharded) return 'sharded';
  return 'empty';
}

// Moves every tombstone between the flat and sharded layouts to match
// whatever `ids.shardSize` currently asks for (§ 5, § 8) — the
// `backlog:ids_layout_mismatch` repair, run unconditionally like
// `fixGitignore`/`fixReadme` (it needs no element mtime/guard bookkeeping:
// tombstones carry no content, only their path). One pass, one direction —
// never a dual-layout reader afterwards (same reasoning as step 0's legacy
// migration). A target already occupied (only possible from a corrupted,
// `'mixed'` on-disk state) is left alone and noted rather than overwritten.
function fixIdsLayout(ctx: Context, fc: FixShared) {
  const idsDir = ctx.idsDir;
  const actual = detectIdsLayout(idsDir);
  const wantSharded = ctx.cfg.ids.shardSize > 0;
  if (actual === 'empty') return;
  if (actual === 'flat' && !wantSharded) return;
  if (actual === 'sharded' && wantSharded) return;

  let moved = 0;
  if (!wantSharded) {
    for (const prefix of Object.keys(PREFIX_TYPE)) {
      const typeDir = path.join(idsDir, prefix);
      let buckets;
      try { buckets = fs.readdirSync(typeDir); } catch { continue; }
      for (const b of buckets) {
        if (b.startsWith('.')) continue;
        const bucketDir = path.join(typeDir, b);
        let names;
        try { names = fs.readdirSync(bucketDir); } catch { continue; }
        for (const n of names) {
          if (n.startsWith('.')) continue;
          const target = path.join(idsDir, n);
          if (fs.existsSync(target)) { fc.notes.push(`${path.join(prefix, b, n)}: cannot move to the flat layout — ${n} already exists there`); continue; }
          fs.renameSync(path.join(bucketDir, n), target);
          moved++;
        }
        // Only an EMPTY bucket is removed -- a left-alone collision (just
        // above) must stay on disk, never be swept away by tidying up the
        // directory around it (never discard a tombstone, § 8).
        try { fs.rmdirSync(bucketDir); } catch { /* not empty: a collision was left behind */ }
      }
      try { fs.rmdirSync(typeDir); } catch { /* a bucket under it survived */ }
    }
  } else {
    let entries: string[];
    try { entries = fs.readdirSync(idsDir); } catch { entries = []; }
    for (const n of entries) {
      if (n.startsWith('.')) continue;
      if (!TOMBSTONE_RE.test(n)) continue;
      const { dir, file } = tombstoneLocation(idsDir, n, ctx.cfg.ids.shardSize);
      if (fs.existsSync(file)) { fc.notes.push(`${n}: cannot move to the sharded layout — already exists at ${path.relative(idsDir, file)}`); continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(path.join(idsDir, n), file);
      moved++;
    }
  }
  if (moved > 0) {
    fc.actions.push(`moved ${moved} tombstone${moved === 1 ? '' : 's'} in ${path.relative(ctx.backlog, idsDir)}/ to the ${wantSharded ? 'sharded' : 'flat'} layout`);
  }
}

// The ONE verbatim line, replaced in place; a trailing `\r` is line-end
// whitespace, not part of the match, and the replacement keeps whichever
// ending the matched line had (CRLF stays CRLF). Anything else about the
// file — the line reworded, commented, missing, or the file itself absent —
// is left exactly as it is, noted when `verbose` (DECISIONS 101,
// AMBIGUITIES 74). `verbose` is false on a backlog that was not legacy at
// the START of this run (G2): calling this unconditionally on every v3
// backlog, most of which never had the v2 line to begin with, would spam a
// "left alone" note on every `--fix`. A match is still fixed either way —
// only the no-op's note is quieted.
function fixGitignore(backlog: string, fc: FixShared, verbose: boolean) {
  const p = path.join(backlog, '.gitignore');
  let content: string;
  try {
    content = fs.readFileSync(p, 'utf8');
  } catch {
    if (verbose) fc.notes.push('.gitignore does not exist — not created');
    return;
  }
  let changed = false;
  const lines = content.split('\n').map((line) => {
    const hasCR = line.endsWith('\r');
    if ((hasCR ? line.slice(0, -1) : line) !== LEGACY_INDEX_REL) return line;
    changed = true;
    return V3_INDEX_REL + (hasCR ? '\r' : '');
  });
  if (!changed) {
    if (verbose) fc.notes.push(`.gitignore does not have the '${LEGACY_INDEX_REL}' line verbatim — left alone`);
    return;
  }
  atomicWrite(p, lines.join('\n'));
  fc.actions.push(`.gitignore: replaced the '${LEGACY_INDEX_REL}' line with '${V3_INDEX_REL}'`);
}

// Replaced only when byte-identical to the exact text a v2 `nanojira init` wrote —
// a user's own edit, however small, is never overwritten (DECISIONS 102).
// `verbose`: see fixGitignore above.
function fixReadme(backlog: string, fc: FixShared, verbose: boolean) {
  const p = path.join(backlog, 'README.md');
  let content: string;
  try { content = fs.readFileSync(p, 'utf8'); } catch { return; }
  if (content !== V2_README) {
    if (verbose) fc.notes.push('README.md is not the v2 init text — left alone');
    return;
  }
  atomicWrite(p, V3_README);
  fc.actions.push('README.md: replaced the v2 init text with the v3 text');
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

// Whether `el` carries an identity with the § 8 ID shape — its frontmatter
// `id`, or (absent that) the id `deriveId` falls back to, which is the file's
// OWN basename. A genuinely stray document (`meeting-notes.md`, no `id:`
// field) derives a non-ID-shaped id this way and is excluded; a misnamed but
// real element (`id: TSK-007` in a file still called `wrongname.md`, ahead of
// step 2's rename) is not — its NAME does not have the shape yet, but its
// identity already does, and step 1 filling in the type it derives from that
// same id is exactly the repair (§ 14) that must still happen. Steps 1, 4 and
// 5 act only on these: a stray document is read and reported like any
// element (DECISIONS 86), but writing an `id` into a colleague's meeting
// notes, or burning it a tombstone, is not a repair (DECISIONS 106 F5).
function idShaped(el: Element): boolean {
  return ID_FOLDER.test(el.id);
}

// 1. write missing id / type — only when the key is genuinely absent; an
//    existing non-empty value is never overwritten, not even an invalid one (§ 14).
function fixStep1(fc: FixCtx<1>): FixCtx<2> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !idShaped(el)) continue;
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

// 3. move each file to its layout place (§ 14). Under `type` only when id
// prefix and type agree (frontmatter > prefix > folder; the folder loses);
// under `hierarchy` only when the parent chain resolves without parent:*
// problems (a parentless task or subtask has a place of its own, DECISIONS
// 91 B15). A move never rewrites a file: every element file is byte-identical
// afterwards. The tombstone claim in step 4 does NOT depend on this running
// first: el.id is fixed at load time from the frontmatter, unaffected by
// which folder the file sits in (measured, S4 karte § 2) -- 3 precedes 4 only
// because § 14 and `exit-doctor-fix.js` pin `fixed[]` in this order.
function fixStep3(fc: FixCtx<3>): FixCtx<4> {
  const layout = fc.reload().cfg.layout;
  // Top-down under `hierarchy`: an epic's or task's folder carries its
  // children along in one rename, so each level re-reads what the level above
  // left. The other groups move files only, in one pass in scan order (v2's).
  const rounds = layout.group === 'hierarchy' ? ['epic', 'task', 'subtask'] : [null];
  const left: Set<string> = new Set();
  // Names already reported this step: skipped on every later pass, so a note
  // is printed once, not once per reload (DECISIONS 105 F3).
  const noted: Set<string> = new Set();
  for (const round of rounds) {
    // Reloaded after EVERY move, not once per round: a folder rename can
    // carry a nested misplaced element along with it (two epics, one inside
    // the other's misplaced folder), and the stale path an un-reloaded loop
    // would still use for that nested element no longer exists — planMove's
    // `lstat` on its target then answers ENOENT, plans a rename, and the
    // rename throws (DECISIONS 105 F3, found by Verifier-B). One reload per
    // actual move keeps every remaining candidate's path current.
    for (let moved = true; moved; ) {
      moved = false;
      const ctx = fc.reload();
      for (const el of ctx.elements) {
        if (round !== null && el.type !== round) continue;
        if (noted.has(el.id)) continue;
        if (fc.guard(el) || el.type === null || !el.problems.has(misplacedCode(layout))) continue;
        if (layout.group === 'type') {
          const pm = /^(EPIC|TSK|SUB)-/.exec(el.id);
          if (!pm || PREFIX_TYPE[pm[1]] !== el.type) {
            fc.notes.push(`${el.id}: id prefix and type disagree — not moved, resolve by hand`);
            noted.add(el.id);
            continue;
          }
        }
        if (layout.group === 'hierarchy' && chainProblem(el)) {
          fc.notes.push(`${el.id}: its parent chain has problems — not moved, resolve by hand`);
          noted.add(el.id);
          continue;
        }
        const dir = moveTarget(el, el.byId as Map<string, Element>, layout) as string;
        const own = layout.group === 'hierarchy' ? ownFolder(el) : null;
        // A folder move carries every descendant with it in one `rename`, so
        // it must never disagree with one of them on `archived:` — that would
        // archive (or un-archive) a child `--fix` never touches on its own
        // (DECISIONS 92 Q2, DECISIONS 106 F6).
        if (own !== null && !folderArchivedAgrees(ctx.elements, own, el.archived || el.archivedAt !== null)) {
          fc.notes.push(`${el.id}: its folder holds elements that disagree on archived: — not moved, resolve by hand`);
          noted.add(el.id);
          continue;
        }
        const src = own === null ? el.file : own;
        const dst = own === null ? path.join(ctx.backlog, dir, path.basename(el.file)) : path.join(ctx.backlog, dir);
        const shown = (dir === '' ? '.' : dir) + '/';
        if (layout.group === 'type') fs.mkdirSync(path.dirname(dst), { recursive: true });
        const plan = planMove(src, dst);
        if (plan.conflicts.length > 0) {
          fc.notes.push(`${el.id}: cannot move into ${shown} — target exists`);
          noted.add(el.id);
          continue;
        }
        fc.move(plan);
        left.add(path.dirname(src));
        fc.actions.push(own === null ? `moved ${el.id} → ${shown}` : `moved ${el.id} with its folder → ${shown}`);
        moved = true;
        break;
      }
    }
  }
  removeEmptiedIdFolders(fc.reload().backlog, left);
  return { ...fc, stage: 4 };
}

/**
 * Every element physically inside `own` (the folder about to move as one)
 * must be going the same way — archived or not — as the element that owns
 * it, or the folder move would carry a mismatched child along (DECISIONS 106
 * F6).
 */
function folderArchivedAgrees(elements: Element[], own: string, expectArchived: boolean): boolean {
  const prefix = own + path.sep;
  return elements.every((e) => !e.file.startsWith(prefix) || (e.archived || e.archivedAt !== null) === expectArchived);
}

/** The element or an ancestor carries a parent:* error: its place is not to be trusted. */
function chainProblem(el: Element): boolean {
  const byId = el.byId as Map<string, Element>;
  const seen: Set<string> = new Set();
  for (let cur: Element | undefined = el; cur !== undefined && !seen.has(cur.id); cur = cur.parent === null ? undefined : byId.get(cur.parent)) {
    seen.add(cur.id);
    if (['parent:dangling', 'parent:cycle', 'parent:hierarchy'].some((c) => (cur as Element).problems.has(c))) return true;
  }
  return false;
}

// 4. backfill tombstones
function fixStep4(fc: FixCtx<4>): FixCtx<5> {
  const ctx = fc.reload();
  const dir = ctx.idsDir;
  const shardSize = ctx.cfg.ids.shardSize;
  fs.mkdirSync(dir, { recursive: true });
  const tombs = readTombstones(dir, shardSize);
  let created = 0;
  for (const el of ctx.elements) {
    if (!idShaped(el) || tombs.has(el.id)) continue;
    const { dir: tdir, file } = tombstoneLocation(dir, el.id, shardSize);
    if (tdir !== dir) fs.mkdirSync(tdir, { recursive: true });
    try { fs.closeSync(fs.openSync(file, 'wx')); created++; } catch { /* raced */ }
  }
  if (created > 0) {
    fc.actions.push(`created ${created} missing tombstone${created === 1 ? '' : 's'} in ${path.relative(ctx.backlog, dir)}/`);
    fc.notes.push('tombstones for already-deleted IDs cannot be recovered — the never-reuse guarantee is void for those numbers');
  }
  return { ...fc, stage: 5 };
}

// 5. write missing status, created (from mtime) and updated (= now).
//    Only absent keys are written; an existing invalid value stays (§ 14).
function fixStep5(fc: FixCtx<5>): FixCtx<6> {
  const ctx = fc.reload();
  for (const el of ctx.elements) {
    if (fc.guard(el) || !el.parsed || !idShaped(el)) continue;
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

// 7. remove stray temp files (now covers .nanojira/claims/ too, § 12 "Claims")
function fixStep7(fc: FixCtx<7>): FixCtx<8> {
  const ctx = fc.reload();
  for (const file of strayTmpFiles(ctx.scan.dirs.concat(claimsScanDirs(ctx.backlog)))) {
    fs.unlinkSync(file);
    fc.actions.push(`removed stray temp file ${path.relative(ctx.backlog, file)}`);
  }
  return { ...fc, stage: 8 };
}

// 7a. remove the claim directories of orphaned claims (archived or does not
// exist — never merely `done`); never touches a live claim's entries; never
// resolves claim:mismatch (§ 7, § 12a). Then appends the `.nanojira/claims/`
// line to .gitignore if the directory exists and the line is missing.
function fixStep7a(fc: FixCtx<8>): FixCtx<8> {
  const ctx = fc.reload();
  for (const { id, dir } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    if (el && !el.archived) continue; // live: never touched
    // DECISIONS 182 A: an archived element's claim directory is wholesale-
    // removed exactly as before (unconditionally, regardless of status) --
    // but when it was still actively claimed, the report names the holder
    // released the same way step 7b below does, rather than silently
    // discarding who held it.
    const entry = highestEntry(dir);
    const holder = entry && entry.kind === 'claimed' ? entry.name : null;
    removeClaimDirWholesale(ctx.backlog, id);
    if (fs.existsSync(dir)) continue;
    fc.actions.push(holder !== null ? `${id}: released ${holder}` : `removed the orphaned claim directory for ${id}`);
  }
  if (claimsNeedGitignoreLine(ctx.backlog)) {
    const p = path.join(ctx.backlog, '.gitignore');
    let content: string;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch {
      fc.notes.push('.gitignore does not exist — not created (the claims/ line was not added)');
      return { ...fc, stage: 8 };
    }
    atomicWrite(p, appendGitignoreLine(content, CLAIMS_GITIGNORE_LINE));
    fc.actions.push(`.gitignore: appended '${CLAIMS_GITIGNORE_LINE}'`);
  }
  return { ...fc, stage: 8 };
}

// 7b. release every claim still held on an element in the final status
// (DECISIONS 182 A, § 14 step 7b, feedback/team-a): the same
// unconditional release set/claim --status=<last> already perform inside
// one write (§ 12a), applied here in bulk to elements that reached that
// status some other way and were left claimed. Live elements only in
// practice -- an archived final-status element's claim directory is
// already gone by the time this runs, wholesale-removed by step 7a above
// (which now names the holder it released, for exactly that case).
// Claims on elements not in the final status are left exactly as they
// are, stale or not. Idempotent: releaseUnconditional itself returns
// undefined once nothing is left to release, so a second --fix reports
// nothing here.
function fixStep7b(fc: FixCtx<8>): FixCtx<8> {
  const ctx = fc.reload();
  const finalStatus = ctx.cfg.statuses[ctx.cfg.statuses.length - 1];
  const ts = nowIso();
  for (const { id } of allClaimDirs(ctx.backlog)) {
    const el = ctx.elements.find((e) => e.id === id);
    if (!el || el.status !== finalStatus) continue;
    const released = releaseUnconditional(ctx.backlog, id, ts);
    if (released !== undefined) fc.actions.push(`${id}: released ${released.holder}`);
  }
  return { ...fc, stage: 8 };
}

interface FixResult extends FixCtx<10> {
  ctx: Context;
  findings: Finding[];
}

// 8. rebuild the index — round two, intentionally a no-op.
function fixStep8(fc: FixCtx<8>): FixCtx<9> {
  return { ...fc, stage: 9 };
}

// 9. regenerate STATUS.md — last, so it reflects every repair above; this
//    also resolves a merge conflict in it. Reported in fixed[] only when its
//    bytes changed (DECISIONS 100). Then collect what remains for the report.
function fixStep9(fc: FixCtx<9>): FixResult {
  const before = fc.reload();
  // TAGS.md before STATUS.md: existing callers (AC-23) rely on STATUS.md's
  // own regeneration staying the LAST `fixed[]` entry when both happen in
  // the same --fix run — the two are otherwise independent, neither
  // reflects anything about the other.
  if (refreshTags(before.backlog, before.cfg, before)) fc.actions.push('regenerated TAGS.md');
  if (refreshStatus(before.backlog, before.cfg, before)) fc.actions.push('regenerated STATUS.md');
  const ctx = fc.reload();
  const findings = collectFindings(ctx);
  return { ...fc, stage: 10, ctx, findings };
}

function doctorFix(flags: Flags, json: boolean) {
  const fc0 = makeFixCtx(flags);
  let start = fc0.reload();
  // Measured before step 0 runs: whether THIS backlog was legacy when this
  // `--fix` started, as opposed to a plain v3 backlog that was never legacy
  // at all. Used only to decide whether a non-matching .gitignore/README is
  // worth a note below (verbose) — it is not how step 0 itself still
  // decides to run; see the `start.legacy` check right after.
  const wasLegacy = start.legacy;
  // Step 0, first: a legacy layout migrates (or, ambiguous, stays exactly as
  // it is) before anything else is even attempted. Reload afterwards — a
  // successful migration changes `start.legacy` and every v3 path context()
  // computes from it.
  if (start.legacy) {
    fixStep0(start, fc0);
    start = fc0.reload();
  } else {
    // Still step 0 (§ 14): a plain v3 backlog can carry a stray top-level
    // `.ids/` left by an earlier crash. Exempt from the config/legacy gate
    // below, the same reason the migration rename above is.
    fixStrayIds(start, fc0);
    start = fc0.reload();
  }
  // Nothing else is repaired against a legacy layout still standing
  // (ambiguous step 0) or an invalid configuration: every later step reads
  // it (statuses, folder names), and a missing one usually means `--fix` was
  // pointed at something that is not a backlog at all (DECISIONS 93 F3, 95
  // B21). The report is the plain one: the backlog-level finding heads the
  // remaining findings.
  if (start.legacy || start.configErrors.length > 0) return fixReport(json, fc0.actions, fc0.notes, start, collectFindings(start));
  // Unconditional (G2): a backlog that migrated on an earlier, interrupted
  // `--fix` run arrives here already v3 (`start.legacy` is false), and this
  // is the only remaining chance to finish the migration's `.gitignore`/
  // README text fix-ups. A match is still fixed regardless of `wasLegacy` —
  // only the "nothing matched" note is gated on it, so a backlog that was
  // never legacy at all (the common case) does not get a spurious note on
  // every `--fix`.
  fixGitignore(start.backlog, fc0, wasLegacy);
  fixReadme(start.backlog, fc0, wasLegacy);
  // ids/ layout migration (§ 5 `ids.shardSize`, § 8), before step 4 backfills
  // any missing tombstones below — those must land in the already-correct
  // layout, not get created in one and then have to move again.
  fixIdsLayout(start, fc0);
  const fc1 = fixSnapshotMtimes(fc0);
  const fc2 = fixStep1(fc1);
  const fc3 = fixStep2(fc2);
  const fc4 = fixStep3(fc3);
  const fc5 = fixStep4(fc4);
  const fc6 = fixStep5(fc5);
  const fc7 = fixStep6(fc6);
  const fc8 = fixStep7(fc7);
  const fc8a = fixStep7a(fc8);
  const fc8b = fixStep7b(fc8a);
  const fc9 = fixStep8(fc8b);
  const { actions, notes, ctx, findings } = fixStep9(fc9);
  return fixReport(json, actions, notes, ctx, findings);
}

function fixReport(json: boolean, actions: string[], notes: string[], ctx: Context, findings: Finding[]) {
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
