#!/usr/bin/env node
'use strict';

// The DECISIONS 90 B1 gate in one command, for a step that adds suites:
//
//   node tools/refactor-harness/gate.js --step=<commit> --frozen=<oracle-frozen tag>
//        [--tests=<rev>] [--nj=<path>] [--harness=<rev>] [--keep]
//
// 1. a throwaway worktree at <step>, laid out as <tmp>/projects/nanojira with
//    <tmp>/runtime/<platform> -> this Node's runtime, because the frozen AC-15
//    looks for the runtime four levels above test/ac (v3-preflight.md A2);
// 2. test/ replaced by <frozen>'s test/, removed first: `git checkout <tag>
//    -- test/` alone keeps suites added after the tag (V3-1: ac-21), and the
//    suite list then aborts the replay with exit 6;
// 3. the harness put over the step's tools/refactor-harness: by default the
//    one running this script, not the one the step shipped with (a step older
//    than DECISIONS 90 B2 would not gate on verdicts); with --harness=<rev>
//    the one committed at <rev>;
// 4. `baseline.js verify --nj=<worktree>/dist/nj.mjs` (the replay);
// 5. test/ replaced by <tests>'s test/ (default: the step itself) and
//    `test/run-all.js <worktree>/dist/nj.mjs` (the new suites' verdict),
//    unless the replay said its instrument is stale or damaged (6, 7);
// 6. the worktree removed (`--keep` leaves it for forensics).
//
// The harness brings its corpus along, and a corpus pins one frozen test/.
// So the running harness can only gate against the frozen tag of ITS corpus
// (checked before anything runs, the fitting tag is named). An old gate --
// V3-1 against oracle-frozen-7 and the c2 corpus -- is re-run with
// --harness=<a commit that still carries that corpus>, which brings that
// commit's code along too: exactly the instrument of the time.
//
// `--nj=<path>` replaces the step's dist/nj.mjs (or, for a step from before
// DECISIONS 185, dist/nj) in steps 4 and 5 by a copy of another file (a
// candidate not yet committed, or a deliberately broken one to prove the
// gate goes red). The copy sits at that same worktree path, so the suites
// that look for it themselves (AC-15) see the same file.
//
// The main working tree and its index are never written: everything happens
// inside the throwaway worktree, which only adds git's own bookkeeping under
// .git/worktrees/ and is removed again -- on a normal end, on SIGINT, SIGTERM
// and SIGHUP (the running child's whole process group is stopped first), on
// a crash, and, for what SIGKILL leaves behind, by the next gate.js start:
// it prunes nj-gate-* roots and nj-s0-* scratch whose owner pid is dead.
//
// Exit codes, same meaning as baseline.js's:
//   0  replay unchanged and oracle green
//   1  replay changed (read the list: every diff must be a named class), oracle green
//   2  usage error (also: --frozen does not fit the corpus, the fitting tag
//      is named), or the worktree could not be set up
//   4  coverage gap in the replay or a suite that could not run
//   6, 7  the replay's instrument is stale or damaged (baseline.js); run-all is skipped
//   8  red verdict: a replay suite or white-box check, or a run-all.js suite, failed
//   128+n  stopped by signal n (after stopping the child and removing the worktree)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HERE = __dirname;
const NODE = process.execPath;
// The same canonical root test/lib/harness.js's H.TMP_ROOT and
// baseline.js's SCRATCH/corpus files now use — realpath'd, NJ_TEST_ROOT if
// set, else /tmp — not os.tmpdir(). Two reasons: os.tmpdir() honours
// TMPDIR, which in at least one environment this has actually run in
// names a path with a real backlog in its own ancestor chain (§ 4's
// upward search then finds it instead of no_backlog, a real behavioural
// difference, not a normalisation artefact); and the un-resolved vs
// realpath'd form of the SAME /tmp (macOS: /tmp -> /private/tmp) made
// nj-shim's own ctx.projectRoot (realpath'd by Node's module loader) stop
// matching this worktree's own root (computed un-resolved here) in
// lib/record.js's normalize() — a bogus multi-hundred-call diff that had
// nothing to do with nj. Both are closed by every root in one gate run
// being this same, already-resolved value.
const TMP_ROOT = require('./lib/record.js').CANONICAL_TMP_ROOT;
// Set once, inherited by every child this process spawns (tee()'s own env
// is `Object.assign({}, process.env, …)`): the REPLAY runs the FROZEN
// tag's own test/, whose test/lib/harness.js cannot be changed (it is
// exactly what is being replayed) and still calls the raw os.tmpdir().
// Forcing TMPDIR here means os.tmpdir() returns TMP_ROOT transparently,
// for old and new test/ alike, without touching one byte of frozen
// content or the recorded baseline.
process.env.TMPDIR = TMP_ROOT;

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? null : hit.slice(name.length + 3);
}
function usage(msg) {
  process.stderr.write(
    `gate.js: ${msg}\nusage: gate.js --step=<commit> --frozen=<oracle-frozen tag> [--tests=<rev>] [--nj=<path>] [--harness=<rev>] [--keep] [--limit=<n>] [--diff-out=<file>]\n`
  );
  process.exit(2);
}
function git(cwd, args, opts) {
  const r = spawnSync('git', ['-C', cwd].concat(args), Object.assign({ encoding: 'utf8' }, opts || {}));
  if (r.status !== 0) {
    if (!(opts && opts.quiet)) process.stderr.write(`gate.js: git ${args.join(' ')} failed:\n${r.stderr}`);
    return null;
  }
  return r.stdout.trim();
}

const STEP = arg('step');
const FROZEN = arg('frozen');
const KEEP = process.argv.includes('--keep');
// Forwarded to the replay's own `baseline.js verify` call, unchanged
// meaning: see baseline.js's own usage/comments.
const DIFF_OUT_ARG = arg('diff-out') ? ['--diff-out=' + path.resolve(arg('diff-out'))] : [];
const LIMIT_ARG = arg('limit') ? ['--limit=' + arg('limit')] : [];
const NJ_OVERRIDE = arg('nj') && path.resolve(arg('nj'));
if (NJ_OVERRIDE && !fs.existsSync(NJ_OVERRIDE)) usage(`no nj at ${NJ_OVERRIDE}`);
if (!STEP) usage('--step=<commit> is required');
if (!FROZEN) usage('--frozen=<oracle-frozen tag> is required');

const REPO = git(HERE, ['rev-parse', '--show-toplevel']);
if (!REPO) usage('not inside a git checkout');
const stepSha = git(REPO, ['rev-parse', '--verify', STEP + '^{commit}']);
const frozenSha = git(REPO, ['rev-parse', '--verify', FROZEN + '^{commit}']);
const TESTS = arg('tests') || STEP;
const testsSha = git(REPO, ['rev-parse', '--verify', TESTS + '^{commit}']);
const HARNESS_REV = arg('harness');
const harnessSha = HARNESS_REV && git(REPO, ['rev-parse', '--verify', HARNESS_REV + '^{commit}']);
if (!stepSha || !frozenSha || !testsSha || (HARNESS_REV && !harnessSha)) usage('could not resolve --step, --frozen, --tests or --harness');
const HARNESS_REL = path.relative(REPO, HERE);

// Not the newest frozen oracle: legal (re-running an old gate, see the top),
// but never by accident.
const frozenTags = (git(REPO, ['tag', '--list', 'oracle-frozen*', '--sort=-creatordate']) || '').split('\n').filter(Boolean);
if (frozenTags.length && frozenTags[0] !== FROZEN) {
  process.stderr.write(`gate.js: note: --frozen=${FROZEN} is not the newest frozen oracle tag (${frozenTags[0]})\n`);
}

// The harness identity. A gate run names its instrument.
const harnessName = harnessSha
  ? `${HARNESS_REV} (${harnessSha.slice(0, 7)}, --harness)`
  : `${git(REPO, ['rev-parse', '--short', 'HEAD'])}${(git(REPO, ['status', '--porcelain', '--', HARNESS_REL]) || '') !== '' ? ' + uncommitted changes' : ''}`;

// ------------------------------------------------------ leftovers of others

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// What SIGKILL (or a machine reset) leaves behind cannot be cleaned by the
// run it killed. Each gate root carries its owner's pid; a root whose owner
// is dead is removed, with its worktree registration. Likewise baseline.js's
// per-pid scratch and raw corpus files. A root without owner.pid comes from
// a gate.js before this one and is only reported: nothing says it is dead.
function pruneLeftovers() {
  // TMP_ROOT, not os.tmpdir(): leftovers from before this fix (under the old
  // os.tmpdir()-based root) are not found here and need a one-time manual
  // cleanup; nothing new is created there going forward, so there is nothing
  // recurring to prune.
  const tmp = TMP_ROOT;
  let names = [];
  try { names = fs.readdirSync(tmp); } catch { return; }
  for (const n of names) {
    const p = path.join(tmp, n);
    if (n.startsWith('nj-gate-')) {
      let pid = null;
      try { pid = Number(fs.readFileSync(path.join(p, 'owner.pid'), 'utf8')); } catch {}
      if (!pid) { process.stderr.write(`gate.js: note: left alone: ${p} (no owner.pid, from an older gate.js)\n`); continue; }
      if (alive(pid)) continue;
      git(REPO, ['worktree', 'remove', '--force', path.join(p, 'projects', 'nanojira')], { quiet: true });
      fs.rmSync(p, { recursive: true, force: true });
      process.stderr.write(`gate.js: pruned ${p} (owner pid ${pid} is dead)\n`);
      continue;
    }
    const m = /^nj-s0-(?:scratch|record|verify)-(\d+)(?:\.ndjson)?$/.exec(n);
    if (m && !alive(Number(m[1]))) {
      fs.rmSync(p, { recursive: true, force: true });
      process.stderr.write(`gate.js: pruned ${p} (owner pid ${m[1]} is dead)\n`);
    }
  }
  git(REPO, ['worktree', 'prune'], { quiet: true });
}
pruneLeftovers();

// ------------------------------------------------------------ own cleanup

const ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'nj-gate-'));
fs.writeFileSync(path.join(ROOT, 'owner.pid'), String(process.pid));
const WT = path.join(ROOT, 'projects', 'nanojira');
const LOG = path.join(ROOT, 'gate.log');
let worktreeAdded = false;
let cleaned = false;
let child = null;     // the running replay or run-all, leader of its own process group
let stopping = false;

function childRunning() {
  return child !== null && child.exitCode === null && child.signalCode === null;
}
function killGroup(sig) {
  try { process.kill(-child.pid, sig); } catch {}
}

// baseline.js names its scratch and raw record after its own pid; once a
// child is gone, whatever it left under that pid goes too (a stopped
// baseline.js has no chance to clean up itself).
const childPids = [];
function removeChildScratch() {
  let names = [];
  try { names = fs.readdirSync(TMP_ROOT); } catch { return; }
  for (const pid of childPids) {
    for (const n of names) {
      if (new RegExp(`^nj-s0-(?:scratch|record|verify)-${pid}(?:\\.ndjson)?$`).test(n)) {
        fs.rmSync(path.join(TMP_ROOT, n), { recursive: true, force: true });
      }
    }
  }
}

// Synchronous, idempotent: also runs from process.on('exit').
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (childRunning()) killGroup('SIGKILL');
  removeChildScratch();
  if (KEEP) {
    process.stderr.write(`gate.js: --keep: worktree left at ${WT}\n`);
    return;
  }
  if (worktreeAdded) git(REPO, ['worktree', 'remove', '--force', WT], { quiet: true });
  fs.rmSync(ROOT, { recursive: true, force: true });
  git(REPO, ['worktree', 'prune'], { quiet: true });
}
process.on('exit', cleanup);

// A signal first stops the child's whole group (baseline.js, its suites and
// their nj calls) and waits for it, so nothing keeps spawning nj into a
// removed worktree on a machine where perf is judged; after 10 s it is
// killed outright. Only then the worktree goes.
function stop(sig) {
  if (stopping) return;
  stopping = true;
  const code = 128 + os.constants.signals[sig];
  process.stderr.write(`gate.js: ${sig}: stopping the running child, then removing the worktree\n`);
  if (!childRunning()) { cleanup(); process.exit(code); }
  killGroup('SIGTERM');
  const hard = setTimeout(() => killGroup('SIGKILL'), 10000);
  child.once('close', () => { clearTimeout(hard); cleanup(); process.exit(code); });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
process.on('uncaughtException', (e) => {
  process.stderr.write(`gate.js: crashed: ${e && e.stack}\n`);
  cleanup();
  process.exit(2);
});

function setupFailed(msg) {
  process.stderr.write(`gate.js: setup failed: ${msg}\n`);
  cleanup();
  process.exit(2);
}

// ------------------------------------------------------------------ steps

function walkFiles(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walkFiles(path.join(dir, e.name), r, out);
    else out.push(r);
  }
  return out;
}

// test/ becomes exactly <rev>'s test/: removed first, then checked out, so no
// suite added after <rev> survives. Then checked, both ways: the files on
// disk are exactly <rev>'s list (an untracked extra is invisible to `git
// diff`, I6), and their content is <rev>'s.
function useTests(rev) {
  const dir = path.join(WT, 'test');
  fs.rmSync(dir, { recursive: true, force: true });
  if (git(WT, ['checkout', rev, '--', 'test']) === null) setupFailed(`checkout ${rev} -- test`);
  const want = (git(WT, ['ls-tree', '-r', '--name-only', rev, '--', 'test']) || '').split('\n').filter(Boolean).sort();
  const have = walkFiles(dir, '', []).map((r) => 'test/' + r).sort();
  const extra = have.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !have.includes(f));
  if (extra.length || missing.length) {
    setupFailed(`test/ is not exactly ${rev}'s: extra ${extra.join(', ') || '-'}; missing ${missing.join(', ') || '-'}`);
  }
  if (git(WT, ['diff', '--quiet', rev, '--', 'test']) === null) setupFailed(`test/ content is not exactly ${rev}'s`);
}

// Runs a child in its own process group, output teed to the terminal and
// the log; resolves with its exit status and full output. A log write that
// fails (disk full, a directory in the way) turns the log off, it does not
// take the gate down with the child still running.
let logOk = true;
function log(s) {
  if (!logOk) return;
  try { fs.appendFileSync(LOG, s); } catch (e) {
    logOk = false;
    process.stderr.write(`gate.js: note: log disabled (${e.code || e.message})\n`);
  }
}
function tee(label, args) {
  return new Promise((resolve) => {
    const head = `\n===== ${label}: node ${args.map((a) => a.replace(ROOT + path.sep, '')).join(' ')}\n`;
    process.stdout.write(head);
    log(head);
    let out = '';
    child = spawn(NODE, args, {
      cwd: WT,
      env: Object.assign({}, process.env, { NJ_NODE: process.env.NJ_NODE || NODE }),
      detached: true,
    });
    childPids.push(child.pid);
    const on = (stream) => (d) => {
      try { out += d; log(d); stream.write(d); } catch {}
    };
    child.stdout.on('data', on(process.stdout));
    child.stderr.on('data', on(process.stderr));
    // While stopping, the signal handler owns the end: no next step.
    child.on('close', (status) => { if (!stopping) resolve({ status, out }); });
  });
}

function parseOracle(out, harnessDst) {
  const count = (re) => { const m = re.exec(out); return m ? Number(m[1]) : null; };
  const failed = count(/^failed\s+(\d+) \//m);
  const cannot = count(/^cannot run\s+(\d+) \//m);
  const passed = count(/^passed\s+(\d+) \/ (\d+)/m);
  // Which suites could not run, by name: each says so on its own first line,
  // "FAIL <file> — CANNOT RUN" (run-all's own list stops after five). A
  // CANNOT RUN listed in expected-gaps.js is named and does not stop the
  // gate; any other is a gap. If the names found do not add up to run-all's
  // count, the output is not what this parser knows, and that is a gap too.
  const gapsFile = path.join(harnessDst, 'expected-gaps.js');
  const gaps = fs.existsSync(gapsFile) ? require(gapsFile) : [];
  const expected = new Map(gaps.map((g) => [path.basename(g.suite), g]));
  const cannotNames = [...out.matchAll(/^FAIL (\S+) — CANNOT RUN$/gm)].map((m) => m[1]);
  return {
    failed, cannot, passed, expected,
    expectedHit: cannotNames.filter((n) => expected.has(n)),
    unexpected: cannotNames.filter((n) => !expected.has(n)),
    namesAddUp: cannot === cannotNames.length,
    found: cannotNames.length,
  };
}

async function main() {
  fs.mkdirSync(path.dirname(WT), { recursive: true });
  if (git(REPO, ['worktree', 'add', '--detach', WT, stepSha]) === null) setupFailed('git worktree add');
  worktreeAdded = true;

  // <tmp>/runtime/<platform> -> the runtime this Node comes from, if it is
  // one (…/runtime/<platform>/bin/node). Only the frozen AC-15 needs it.
  const binDir = path.dirname(NODE);
  const platDir = path.dirname(binDir);
  if (path.basename(binDir) === 'bin' && path.basename(path.dirname(platDir)) === 'runtime') {
    fs.mkdirSync(path.join(ROOT, 'runtime'));
    fs.symlinkSync(platDir, path.join(ROOT, 'runtime', path.basename(platDir)));
  } else {
    process.stderr.write(`gate.js: note: ${NODE} is not a runtime/<platform>/bin/node; a frozen AC-15 will not find its runtime\n`);
  }

  const harnessDst = path.join(WT, HARNESS_REL);
  fs.rmSync(harnessDst, { recursive: true, force: true });
  if (harnessSha) {
    if (git(WT, ['checkout', harnessSha, '--', HARNESS_REL]) === null) setupFailed(`checkout ${HARNESS_REV} -- ${HARNESS_REL}`);
  } else {
    fs.cpSync(HERE, harnessDst, { recursive: true });
  }

  useTests(frozenSha);
  // The corpus pins one test/ digest. A --frozen tag from another corpus
  // would only surface as the replay's exit 6 "stale baseline, re-record",
  // which is the wrong advice here: the call is wrong, not the baseline.
  // Name the tag that fits instead, and stop before anything runs. A harness
  // from before `baseline.js digest` (--harness=<old rev>) is not asked.
  const digestOf = () => {
    const r = spawnSync(NODE, [path.join(harnessDst, 'baseline.js'), 'digest'], { cwd: WT, encoding: 'utf8' });
    try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
  };
  const d = digestOf();
  if (d === null) {
    process.stderr.write('gate.js: note: this harness has no `baseline.js digest`; --frozen is not checked before the replay\n');
  } else if (d.current !== d.pinned) {
    let fits = null;
    for (const t of frozenTags) {
      useTests(git(REPO, ['rev-parse', t + '^{commit}']));
      if (digestOf().current === d.pinned) { fits = t; break; }
    }
    setupFailed(
      `--frozen=${FROZEN} does not belong to this harness's corpus: its test/ digest is ${d.current.slice(0, 8)}, ` +
        `the corpus pins ${d.pinned ? d.pinned.slice(0, 8) : '(none)'}. ` +
        (fits ? `Use --frozen=${fits}` : 'No oracle-frozen tag matches') +
        ' (or --harness=<a commit carrying the corpus of that tag>).'
    );
  }
  // `dist/nj.mjs` (DECISIONS 185 addendum 9b3d0de) for any step at or after
  // v3.11; a step from before that (replayed with --step=<old commit>, or
  // --harness=<old rev>) still ships the extensionless `dist/nj`, which the
  // frozen oracle tags themselves never touch (they only replace test/,
  // above) -- so both must keep working here. --nj=<path> targets whichever
  // of the two the checked-out step itself already has; absent either (a
  // step with neither file yet built), it defaults to the current, `.mjs`
  // name, since that is what a future build would produce.
  const NJ_MJS = path.join(WT, 'dist', 'nj.mjs');
  const NJ_CJS = path.join(WT, 'dist', 'nj');
  const NJ = fs.existsSync(NJ_MJS) ? NJ_MJS : fs.existsSync(NJ_CJS) ? NJ_CJS : NJ_MJS;
  if (NJ_OVERRIDE) {
    fs.mkdirSync(path.dirname(NJ), { recursive: true });
    fs.copyFileSync(NJ_OVERRIDE, NJ);
    fs.chmodSync(NJ, 0o755);
  }
  if (!fs.existsSync(NJ)) setupFailed(`${STEP} has no dist/nj.mjs or dist/nj`);
  const njSha = require('crypto').createHash('sha256').update(fs.readFileSync(NJ)).digest('hex');

  process.stdout.write(
    `gate: step ${STEP} (${stepSha.slice(0, 7)}), replay test/ from ${FROZEN} (${frozenSha.slice(0, 7)}), ` +
      `oracle test/ from ${TESTS} (${testsSha.slice(0, 7)})\n` +
      `      nj ${NJ_OVERRIDE ? NJ_OVERRIDE + ' (--nj)' : STEP + ':' + path.relative(WT, NJ)} sha256 ${njSha}\n` +
      `      harness from ${harnessName}, node ${process.version}, worktree ${WT}\n`
  );

  const replay = await tee('replay', [path.join(harnessDst, 'baseline.js'), 'verify', '--nj=' + NJ].concat(LIMIT_ARG, DIFF_OUT_ARG));

  // I5: after 2, 6 or 7 the replay's instrument (or its call) is at fault;
  // run-all cannot change that outcome, so it is not run.
  const instrumentFault = [2, 6, 7].includes(replay.status);
  let o = null;
  if (!instrumentFault) {
    useTests(testsSha);
    const oracle = await tee('oracle', [path.join(WT, 'test', 'run-all.js'), NJ]);
    o = parseOracle(oracle.out, harnessDst);
    o.status = oracle.status;
  }

  // Same precedence as baseline.js: red verdict, then coverage gap, then the
  // replay's own code. A replay killed by a signal (status null) proved
  // nothing. run-all exits 1 for any CANNOT RUN, expected or not, so its
  // status only counts through the parsed numbers.
  let code;
  if (instrumentFault) code = replay.status;
  else if (replay.status === 8 || o.failed > 0) code = 8;
  else if (replay.status === 4 || replay.status === null || o.failed === null || o.unexpected.length > 0 || !o.namesAddUp) code = 4;
  else code = replay.status;

  const meaning = {
    0: 'replay unchanged, oracle green',
    1: 'replay CHANGED, oracle green: every diff above must be a named class',
    2: 'replay could not be called',
    4: 'coverage gap: something could not run, nothing is proven',
    6: 'replay baseline is stale (test/ digest or suite list): instrument, not nj',
    7: 'replay header and corpus do not belong together: instrument, not nj',
    8: 'VERDICT RED: a suite or check failed',
  };
  let oracleLines;
  if (instrumentFault) oracleLines = `  oracle: skipped, the replay's instrument said ${replay.status}\n`;
  else {
    oracleLines =
      `  oracle: ${o.failed === null ? `no summary, exit ${o.status}` : `passed ${o.passed}, failed ${o.failed}, cannot run ${o.cannot} (${o.expectedHit.length} expected), exit ${o.status}`}\n` +
      o.expectedHit.map((n) => `          expected gap: ${o.expected.get(n).suite}: ${o.expected.get(n).reason}\n`).join('') +
      o.unexpected.map((n) => `          GAP (not in expected-gaps.js): ${n}\n`).join('') +
      (o.namesAddUp ? '' : `          GAP: ${o.found} CANNOT RUN line(s) found, run-all counted ${o.cannot}\n`);
  }
  const summary =
    `\n===== gate ${stepSha.slice(0, 7)}${NJ_OVERRIDE ? ' with --nj=' + NJ_OVERRIDE : ''} against ${FROZEN}\n` +
    `  replay: exit ${replay.status}\n` +
    oracleLines +
    `  gate  : exit ${code}, ${meaning[code] || 'see replay output'}\n`;
  process.stdout.write(summary);
  log(summary);
  if (KEEP) process.stdout.write(`  log   : ${LOG}\n`);
  cleanup();
  process.exit(code);
}

main().catch((e) => setupFailed(e && e.stack));
