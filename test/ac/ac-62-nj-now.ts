/* AC-62 -- NJ_NOW is a deterministic-clock verification hook (§ 12), not a
 * user feature: "every timestamp the tool writes (`created`, `updated`,
 * `archived`, `nanojira note` lines) uses exactly this value" when it is set.
 * Every other NJ_NOW-pinned fixture in this suite is quietly built on that
 * promise holding everywhere, not just at the one or two call sites each
 * individual test happens to exercise -- this file is the first to pin the
 * promise itself, directly, in two independent legs:
 *
 *   1. A full command sequence (init/new/set/note/claim/check/release/
 *      set=done/archive) run twice, from scratch, in two unrelated fresh
 *      backlogs, same NJ_NOW throughout -- the two resulting trees must be
 *      byte-for-byte identical (claim generations, tombstones, STATUS.md
 *      and all), not merely "close".
 *   2. A static guard over src/: nothing may read the wall clock
 *      (`Date.now()` / `new Date(`) directly outside core/store.ts, the one
 *      module that owns `nowIso()`/`nowMs()`/`mtimeIso()`. Leg 1 alone would
 *      only ever catch a clock-pinning regression if the scripted sequence
 *      happens to exercise the broken path AND the two runs happen to land
 *      in different real seconds -- this leg catches it unconditionally,
 *      the moment the offending line exists, regardless of timing or
 *      coverage.
 *
 *   3. An invalid NJ_NOW is refused by EVERY command, read or write, up
 *      front (DECISIONS 207) -- not lazily at the first clock read, which
 *      once made `list` pass on a backlog without claims and fail on the
 *      same backlog once an element was claimed (only the staleness check
 *      read the clock). `--version`, `--help` and `help` stay exempt.
 *
 * Leg 2 is not a blanket "zero Date.now() outside store.ts" rule: a handful
 * of real-clock reads elsewhere are correct and must stay on the wall
 * clock, because they bound a real wait or compare against a real
 * filesystem timestamp rather than writing anything -- each is named
 * explicitly below, by file and exact count, so a new one silently added
 * anywhere (including a THIRD occurrence appearing in an already-allowed
 * file) still fails loudly instead of blending in.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

const NOW = '2026-01-02T03:04:05Z';
const ACTOR = 'alice';

function run(d: string, args: string[]): RunResult {
  return H.runNj(args, { cwd: d, env: { NJ_NOW: NOW } });
}

/* Every file under <d>/backlog, as "<relative path> <sha256 of its bytes>"
 * (or "<relative path> -><link target>" for a symlink) -- deliberately not
 * excluding .nanojira/claims or .nanojira/ids: those are exactly where a
 * missed clock read (a claim's own `since`, say) would first show up. */
function snapshotBacklog(d: string): string[] {
  const root = path.join(d, 'backlog');
  const out: string[] = [];
  (function walk(abs: string, rel: string) {
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const k of fs.readdirSync(abs).sort()) walk(path.join(abs, k), rel + '/' + k);
      return;
    }
    if (st.isSymbolicLink()) { out.push(rel + ' ->' + fs.readlinkSync(abs)); return; }
    out.push(rel + ' ' + H.sha256(fs.readFileSync(abs)));
  })(root, '.');
  return out.sort();
}

/* The scripted session TSK-008 named: init, new (epic + task), set, note,
 * claim, check, release, then a second set to actually reach `done` (archive
 * requires the whole subtree done, § 9), then archive. Every exit code is
 * checked on EACH run, not only compared after the fact, so a broken step
 * fails with its own clear message instead of surfacing only as an opaque
 * tree mismatch far below. */
function scriptedRun(label: string, d: string): void {
  T.exit(label + ': init', run(d, ['init']), 0);
  T.exit(label + ': new epic', run(d, ['new', '--type=epic', '--title=Auth', '--description=Login.']), 0);
  T.exit(label + ': new task', run(d, ['new', '--type=task', '--parent=EPIC-001', '--title=Login route',
    '--priority=high', '--description=Wire it up.', '--acceptance=- [ ] wire the route']), 0);
  T.exit(label + ': set status=doing', run(d, ['set', '--id=TSK-001', '--status=doing']), 0);
  T.exit(label + ': note', run(d, ['note', '--id=TSK-001', 'started work', '--as=' + ACTOR]), 0);
  T.exit(label + ': claim', run(d, ['claim', '--id=TSK-001', '--as=' + ACTOR]), 0);
  T.exit(label + ': check', run(d, ['check', '--id=TSK-001', '--text=wire the route', '--on']), 0);
  T.exit(label + ': release', run(d, ['release', '--id=TSK-001', '--as=' + ACTOR]), 0);
  T.exit(label + ': set status=done', run(d, ['set', '--id=TSK-001', '--status=done']), 0);
  T.exit(label + ': set epic status=done', run(d, ['set', '--id=EPIC-001', '--status=done']), 0);
  T.exit(label + ': archive', run(d, ['archive', '--id=EPIC-001']), 0);
}

/* ---------------------------------------------------------------- */
/* Leg 1: two from-scratch runs, same NJ_NOW, byte-identical trees.  */
/* ---------------------------------------------------------------- */
{
  const d1 = H.freshDir('ac62-run1');
  const d2 = H.freshDir('ac62-run2');
  scriptedRun('AC-62 run 1', d1);
  scriptedRun('AC-62 run 2', d2);

  const snap1 = snapshotBacklog(d1);
  const snap2 = snapshotBacklog(d2);
  const paths1 = snap1.map((l) => l.split(' ')[0]);
  const paths2 = snap2.map((l) => l.split(' ')[0]);
  T.eq('AC-62: the two runs produce the same set of files', paths1, paths2);
  T.eq('AC-62: the two trees are byte-identical (same hash per file)', snap1, snap2);
}

/* ---------------------------------------------------------------- */
/* Leg 2: static guard -- raw Date.now()/new Date( outside the clock */
/* module (core/store.ts) is a hard failure, exact file+count below. */
/* ---------------------------------------------------------------- */
{
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const CLOCK_MODULE = 'core' + path.sep + 'store.ts';
  // Each entry: a real-clock read that is correct to leave on the wall
  // clock because it never reaches a written timestamp, named with why --
  // any count that drifts in either direction (a new one, or an old one
  // going away without this list being updated) fails below.
  const ALLOWED: Record<string, number> = {
    // njrcSwapFaultHook: NJ_FAULT=njrc-swap's own poll deadline, waiting on
    // a `.nj-fault-go` marker a test writes -- bounds a real wait, writes
    // nothing, so NJ_NOW must not reach it (same reasoning as store.ts's
    // own before-compare fault hook, which is exempt wholesale below).
    ['core' + path.sep + 'config.ts']: 2,
    // ctx.loadedAt: the upper bound for "this file's own ctime predates the
    // context load" (DECISIONS 103, STATUS.md's refresh) -- compared only
    // against real filesystem ctimes, which NJ_NOW cannot (and must not)
    // touch, so pinning this side of the comparison would make it meaningless.
    ['core' + path.sep + 'context.ts']: 1,
    // Comment prose mentioning the literal text "Date.now()", not a call.
    ['core' + path.sep + 'status.ts']: 1,
    ['core' + path.sep + 'types.ts']: 1,
  };

  const PATTERN = /\bDate\.now\s*\(|\bnew\s+Date\s*\(/;
  const found: Record<string, string[]> = {};
  (function walk(dir: string) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) { walk(abs); continue; }
      if (!name.endsWith('.ts')) continue;
      const rel = path.relative(SRC, abs);
      if (rel === CLOCK_MODULE) continue;
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (PATTERN.test(line)) {
          (found[rel] = found[rel] || []).push((i + 1) + ': ' + line.trim());
        }
      });
    }
  })(SRC);

  const allKeys = new Set([...Object.keys(ALLOWED), ...Object.keys(found)]);
  for (const rel of [...allKeys].sort()) {
    const expected = ALLOWED[rel] || 0;
    const actual = (found[rel] || []).length;
    T.eq('AC-62 guard: ' + rel + ' has exactly the accounted-for raw clock reads',
      actual, expected,
    );
    if (actual !== expected) {
      console.log('  ' + rel + ': ' + JSON.stringify(found[rel] || []));
    }
  }
}

/* ---------------------------------------------------------------- */
/* Leg 3: an invalid NJ_NOW refuses every command up front (D207).   */
/* ---------------------------------------------------------------- */
{
  const empty = H.freshDir('ac62-empty');
  T.exit('AC-62 leg 3 fixture: init (empty backlog)', run(empty, ['init']), 0);
  /* The same two elements twice: once unclaimed, once with TSK-001 claimed.
   * Before D207 only a claim made a read touch the clock, so the unclaimed
   * twin is where a lazy check slips through. */
  const twin = (label: string, claim: boolean) => {
    const d = H.freshDir(label);
    T.exit('AC-62 leg 3 fixture ' + label + ': init', run(d, ['init']), 0);
    T.exit('AC-62 leg 3 fixture ' + label + ': new epic', run(d, ['new', '--type=epic', '--title=Auth', '--description=Login.']), 0);
    T.exit('AC-62 leg 3 fixture ' + label + ': new task', run(d, ['new', '--type=task', '--parent=EPIC-001', '--title=Login route',
      '--description=Wire it up.', '--acceptance=- [ ] wire the route']), 0);
    if (claim) T.exit('AC-62 leg 3 fixture ' + label + ': claim', run(d, ['claim', '--id=TSK-001', '--as=' + ACTOR]), 0);
    return d;
  };
  const plain = twin('ac62-plain', false);
  const claimed = twin('ac62-claimed', true);

  const COMMANDS: [string, string[]][] = [
    ['list', ['list']],
    ['show', ['show', '--id=TSK-001']],
    ['doctor', ['doctor']],
    ['set --dry-run', ['set', '--id=TSK-001', '--status=doing', '--dry-run']],
    ['bare nanojira', []],
    ['new (a write)', ['new', '--type=epic', '--title=Other', '--description=O.']],
  ];
  const CASES: [string, string, string[]][] = [['list on an empty backlog', empty, ['list']]];
  for (const [d, where] of [[plain, 'unclaimed'], [claimed, 'with a claim']]) {
    for (const [name, args] of COMMANDS) CASES.push([name + ' (' + where + ')', d, args]);
  }
  for (const bad of ['bogus', '2026-09-21T18:00:00']) {
    for (const [name, d, args] of CASES) {
      const tag = 'AC-62 leg 3 NJ_NOW=' + JSON.stringify(bad) + ' ' + name;
      const before = snapshotBacklog(d);
      const r = H.runJson(args, { cwd: d, env: { NJ_NOW: bad } });
      T.exit(tag + ': exit 1', r, 1);
      T.eq(tag + ': invalid_env', r.json && r.json.error, 'invalid_env');
      const errLines = (r.stderr || '').split('\n').filter((l) => l !== '');
      T.check(tag + ': one stderr line naming NJ_NOW', errLines.length === 1 && /NJ_NOW/.test(errLines[0]), JSON.stringify(r.stderr));
      T.eq(tag + ': nothing written', snapshotBacklog(d), before);
    }
  }

  /* Exempt: they read no backlog and no clock, and must work in any
   * environment -- including the one whose NJ_NOW is wrong. */
  for (const args of [['--version'], ['--help'], ['help'], ['list', '--help']]) {
    const r = H.runNj(args, { cwd: claimed, env: { NJ_NOW: 'bogus' } });
    T.exit('AC-62 leg 3 NJ_NOW="bogus" ' + args.join(' ') + ': still exit 0', r, 0);
  }

  /* Control: a valid NJ_NOW changes nothing for the same calls. */
  for (const [name, d, args] of CASES) {
    const r = H.runJson(args, { cwd: d, env: { NJ_NOW: NOW } });
    T.exit('AC-62 leg 3 control (valid NJ_NOW) ' + name + ': exit 0', r, 0);
  }
}

T.finish();
