#!/usr/bin/env node
'use strict';

// TSK-003: performance as an automatic gate, not a manual measurement.
//
// Every gate before this one had someone run these same four commands by
// hand and eyeball the numbers against docs/SPECIFICATION.md:850's comfort bar
// (median <= 250 ms, worst <= 500 ms). This builds the same 10 000-element
// backlog the spec's own table measures (docs/SPECIFICATION.md:842-847) and fails
// loudly the moment a command crosses that bar, instead of waiting for
// someone to notice.
//
// Node built-ins only (fs/os/path/child_process) -- no new devDependency for
// four spawnSync calls and a median.
//
//   node tools/perf.ts                          absolute § 13 bar, dist/nanojira.mjs
//   node tools/perf.ts --ab=<nj A> --ab=<nj B> [--rounds=N] [--gate=all|reads]
//                                               interleaved A/B, "no regression"
//
// The A/B mode is DECISIONS 90's interim perf gate: while the absolute bar
// cannot be met on this machine (battery, Low Power Mode, other agents), B is
// judged against the previous accepted build A on the same backlog, with the
// runs interleaved so that whatever the machine is doing hits both alike.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
const DIST_NJ = path.join(ROOT, 'dist', 'nanojira.mjs');
const NODE = process.execPath;
const RUNS = 5; // docs/SPECIFICATION.md:840: "median of 5"
const ELEMENT_COUNT = 10000;
const EPIC_COUNT = 100;

// docs/SPECIFICATION.md:850. Overridable only so the counter-test can prove a
// crossed bar is actually caught (an artificially lowered bar must go red);
// there is no legitimate reason to loosen these for a real run.
const MEDIAN_MS = Number(process.env.PERF_MEDIAN_MS || 250);
const MAX_MS = Number(process.env.PERF_MAX_MS || 500);

interface Cmd {
  label: string;
  args: string[] | (() => string[]);
}

const COMMANDS: Cmd[] = [
  { label: 'list', args: ['list'] },
  { label: 'list --json', args: ['list', '--json'] },
  { label: 'tree', args: ['tree'] },
  { label: 'doctor', args: ['doctor'] },
];

// Writes (DECISIONS 95 B20). V3-3 makes every write regenerate STATUS.md
// from a full scan (§ 4: "one full scan per write"), so writes get a number
// before that lands. Every call changes bytes -- a fresh title, a fresh note
// -- so compare-before-write never turns one into a no-op. They run after
// all reads, so the reads see the untouched fixture; the backlog grows by a
// few dozen elements at most, noise against 10 000. `new` passes both
// sections so the fixture stays free of problems (doctor must exit 0).
// § 13 has no write bar yet (TSK-027 is to enter one): the absolute mode
// reports writes and does not gate them; A/B gates them like reads.
let writeSeq = 0;
const WRITES: Cmd[] = [
  { label: 'new', args: () => ['new', '--type=task', '--parent=EPIC-001', `--title=perf ${++writeSeq}`, '--description=x', '--acceptance=y'] },
  { label: 'set --title', args: () => ['set', '--id=TSK-00001', `--title=perf ${++writeSeq}`] },
  { label: 'note', args: () => ['note', '--id=TSK-00002', `perf ${++writeSeq}`] },
];
const argsOf = (c: Cmd): string[] => (typeof c.args === 'function' ? c.args() : c.args);

// A number that looks like a regression is only meaningful on a quiet
// machine -- tools/refactor-harness/README.md's "Ruhe fuers Perf-Gate":
// load average lags reality (2.86 measured with zero node processes
// running), so a live snapshot is needed, not a minute-average.
//
// Matching by process name (`pgrep -f 'bin/node'`) was tried first and is
// wrong both ways: a plain `node -e '...'` in the background does not match
// the pattern and slips through (verifier-confirmed: undetected, perf ran at
// exit 0 anyway), while this machine runs long-lived, genuinely idle node
// processes (MCP servers) that DO match and would block every run forever.
// What actually matters is load, not name or presence -- an idle node
// process costs nothing, a busy one of any name skews the clock.
//
// Numbers are measured on this machine, not the tutorial "20% / 50%":
// `ps -A -o pcpu` sampled five times with nothing unusual running summed to
// 70-114% (WindowServer, a screen-sharing helper, a terminal, this very
// agent -- 10 real cores, so plenty of idle desktop chrome adds up) and no
// single one of them passed ~23%. A `node -e 'while(1){}'` busy loop showed
// 100.0%, an idle `setTimeout` showed 0.0%. The bars sit with real margin
// above the measured ambient ceiling and real margin below a saturated core,
// so ordinary desktop use never trips them but a genuine competitor does.
const CPU_SINGLE_PCT = Number(process.env.PERF_CPU_SINGLE_PCT || 50);
const CPU_SUM_PCT = Number(process.env.PERF_CPU_SUM_PCT || 200);

interface ProcRow {
  pid: number;
  ppid: number;
  cpu: number;
  comm: string;
}

function foreignCpuLoad(): ProcRow[] | null {
  // ppid check only excludes direct children: measurement always spawns and
  // waits (spawnSync) before the next check runs, so no grandchild can still
  // be alive at a check point.
  // /bin/ps, not a PATH lookup. null when the list cannot be read: that must
  // not read as "no other process", i.e. quiet (I7, gate-instrument.md).
  const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pcpu=,comm='], { encoding: 'utf8' });
  if (r.error || r.status !== 0 || !r.stdout) return null;
  return r.stdout
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), comm: m[4] }))
    .filter((p) => p.pid !== process.pid && p.ppid !== process.pid);
}

// null when quiet, otherwise the message to report. Returns rather than
// exits itself: the caller after the measurement still has a temp dir to
// clean up first, an exit here would skip that.
function quietMachineViolation(): string | null {
  const rows = foreignCpuLoad();
  if (rows === null) return 'cannot read the process list (/bin/ps failed), so quiet cannot be shown';
  const worst = rows.reduce((a, b) => (b.cpu > a.cpu ? b : a), { cpu: 0, pid: null as number | null, comm: '' });
  const sum = rows.reduce((s, p) => s + p.cpu, 0);
  if (worst.cpu <= CPU_SINGLE_PCT && sum <= CPU_SUM_PCT) return null;
  return (
    `worst pid ${worst.pid} (${worst.comm}) at ${worst.cpu}% cpu, ${sum.toFixed(1)}% total across ` +
    `other processes (bar: one > ${CPU_SINGLE_PCT}% or sum > ${CPU_SUM_PCT}%)`
  );
}

function abortNotQuiet(when: string, violation: string): never {
  process.stderr.write(
    `perf: not a quiet machine (${when}): ${violation}. ` +
      'A measurement now would blame machine load on nj, not nj itself. Aborting.\n'
  );
  process.exit(3);
}

// CPU load is not the only thing that moves the clock. On battery with Low
// Power Mode on, the build DECISIONS 84 measured at 206 ms took ~390 ms,
// every other build likewise, while the CPU check above passed -- and the
// run reported OVER BAR on unchanged code (docs/verification/v3-preflight.md
// A5). The power state is read, never changed: it is the user's setting.
// null when fine, otherwise the reason. darwin only: elsewhere there is no
// pmset, and nothing is claimed about the power state.
function powerViolation(): string | null {
  if (process.platform !== 'darwin') return null;
  const g = spawnSync('/usr/bin/pmset', ['-g'], { encoding: 'utf8' });
  const b = spawnSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' });
  if (g.status !== 0 || b.status !== 0) return 'cannot read the power state (`pmset -g` / `pmset -g batt` failed)';
  const reasons: string[] = [];
  if (/^\s*lowpowermode\s+1\b/m.test(g.stdout)) reasons.push('Low Power Mode is on (pmset -g: lowpowermode 1)');
  if (/drawing from 'Battery Power'/.test(b.stdout)) reasons.push("running on battery (pmset -g batt: 'Battery Power')");
  return reasons.length ? reasons.join(', ') : null;
}

// NJ_BACKLOG would point every measured call at some other backlog. Also
// NJ_NOW / NJ_FAULT: nothing measured here should run under a test hook.
const CHILD_ENV: NodeJS.ProcessEnv = Object.assign({}, process.env);
for (const k of ['NJ_BACKLOG', 'NJ_NOW', 'NJ_FAULT']) delete CHILD_ENV[k];

// Built with the given nj's own `init`, and written into the layout that
// init produced: v2 keeps its config in .nanojira.json and tombstones in
// .ids/; V3-4 moves both into .nanojira/ (config.json, ids/). The A/B mode
// builds one fixture per side, so a v3 build is never fed a v2 layout it
// would refuse as legacy_layout (I8, gate-instrument.md). Folder names come
// from the config; only group "type" (the default) is built.
function buildBacklog(nj: string): string {
  const dir = fs.mkdtempSync('/tmp/nj-perf-');
  const init = spawnSync(NODE, [nj, 'init'], { cwd: dir, env: CHILD_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const fail = (msg: string): never => {
    process.stderr.write(`perf: ${nj}: ${msg}\n`);
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(2);
  };
  if (init.status !== 0) fail('nanojira init failed:\n' + init.stderr);
  const backlog = path.join(dir, 'backlog');
  const v3 = fs.existsSync(path.join(backlog, '.nanojira', 'config.json'));
  let cfg: { layout?: { group?: string; folders?: Record<string, string> } } = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(backlog, v3 ? '.nanojira/config.json' : '.nanojira.json'), 'utf8')); } catch (e: any) {
    fail(`cannot read the config nj init wrote (${e.code || e.message})`);
  }
  const layout = cfg.layout || {};
  if ((layout.group || 'type') !== 'type') fail(`fixture needs group "type", init wrote "${layout.group}"`);
  const folders = Object.assign({ epics: 'epics', tasks: 'tasks' }, layout.folders || {});
  const idsDir = path.join(backlog, v3 ? '.nanojira/ids' : '.ids');
  for (const d of [idsDir, path.join(backlog, folders.epics), path.join(backlog, folders.tasks)]) fs.mkdirSync(d, { recursive: true });
  const ts = '2026-01-01T00:00:00Z';
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  // Files are hand-written below, not created through `nj new`, so they leave
  // no `.ids/` tombstone behind on their own -- `doctor` then reports a real
  // ERROR ("never-reuse guarantee not in force"), which has nothing to do
  // with the commands being measured. Write the tombstones ourselves so the
  // fixture is clean and `doctor`'s own scan cost is what gets measured.
  const tombstone = (id: string): void => fs.writeFileSync(path.join(idsDir, id), '');
  for (let i = 1; i <= EPIC_COUNT; i++) {
    const id = 'EPIC-' + pad(i, 3);
    fs.writeFileSync(
      path.join(backlog, folders.epics, id + '.md'),
      `---\nid: ${id}\ntype: epic\ntitle: E${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# E${i}\n\n## Description\nx\n`
    );
    tombstone(id);
  }
  const taskCount = ELEMENT_COUNT - EPIC_COUNT;
  for (let i = 1; i <= taskCount; i++) {
    const id = 'TSK-' + pad(i, 5);
    const parent = 'EPIC-' + pad((i % EPIC_COUNT) + 1, 3);
    fs.writeFileSync(
      path.join(backlog, folders.tasks, id + '.md'),
      `---\nid: ${id}\ntype: task\nparent: ${parent}\ntitle: T${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# T${i}\n\n## Description\nx\n\n## Acceptance Criteria\ny\n`
    );
    tombstone(id);
  }
  return dir;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// One timed call. Returns ms, or exits 2 (after removing the fixture) when
// the command fails: a failing call has no meaningful duration.
function timeOnce(nj: string, cwd: string, args: string[]): number {
  const start = process.hrtime.bigint();
  const r = spawnSync(NODE, [nj, ...args], { cwd, env: CHILD_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (r.status !== 0) {
    process.stderr.write(`perf: ${nj} '${args.join(' ')}' exited ${r.status}\n` + r.stderr);
    fs.rmSync(cwd, { recursive: true, force: true });
    process.exit(2);
  }
  return ms;
}

function measure(cwd: string, cmd: Cmd): { median: number; max: number } {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) times.push(timeOnce(DIST_NJ, cwd, argsOf(cmd)));
  return { median: median(times), max: Math.max(...times) };
}

// --------------------------------------------------------------- A/B mode
//
// Tolerance: B may be slower than A by at most AB_TOLERANCE_PCT per command.
// Measured, not guessed: three builds with no perf-relevant change between
// them (5b666a0, c2-baseline, 2ca5c9f), interleaved on battery in Low Power
// Mode with other agents running, differed by up to 5.6% in median (tree:
// 418 vs 396 ms; v3-preflight.md, "perf, interleaved A/B"). 10% sits clear
// above that noise and still catches a real regression of the size that
// matters against a 250 ms bar. The max is printed, not gated: it swung by
// up to 17% between those same equal builds, so it would gate on noise.
//
// What is gated is the median of the PAIRED ratios B/A, not the ratio of
// the two medians. The first version compared medians, and two runs of v2
// against c3 (no perf-relevant change to reads) each failed on a different
// command: note +12.5% in one run, list --json +13.7% in the next, each
// within noise in the other run. Other agents' load comes in bursts of
// seconds (single calls of 1-2 s in the max column). A and B of one pair
// run back to back, so a burst mostly hits both of them, while a median
// over the whole run takes the burst on one side only.
//
// And a red must reproduce (I4, gate-instrument.md): a command over the
// tolerance gets a second, separate pass of as many rounds, and is a
// regression only if that pass is over it too; both are printed. A perf
// alarm that turns out to be machine load costs the same rollback as a real
// one (refactor-harness README, "Ruhe fuer das Perf-Gate"). Alongside runs
// an A/A control -- A a second time, on its own fixture -- whose spread says
// how much "no change at all" moves in this very session.
const AB_TOLERANCE_PCT = Number(process.env.PERF_AB_TOLERANCE_PCT || 10);
const AB_ROUNDS_DEFAULT = 7;
// --gate=reads: writes are measured and printed but do not fail the run.
// For a step whose write cost rises BY DESIGN (V3-3: STATUS.md on every
// write), so an intended cost is not reported as a regression -- and the
// reads, which must not move, still gate. Default: everything gates.
const GATE = (process.argv.find((a) => a.startsWith('--gate=')) || '--gate=all').slice(7);

function sha256(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

type Side = 'A' | 'B' | 'C';
type Timings = Record<Side, Record<string, number[]>>;

function mainAB(bins: string[], rounds: number): void {
  for (const b of bins) {
    if (!fs.existsSync(b)) {
      process.stderr.write(`perf: no nj at ${b}\n`);
      process.exit(2);
    }
  }
  const [A, B] = bins;
  // Neither refuses here: the point of A/B is to stay usable on a machine
  // that is not quiet. Both are reported, so the reader knows the absolute
  // numbers below are not § 13 numbers.
  const power = powerViolation();
  const load = quietMachineViolation();
  // Three sides, each on its own fixture built by its own init (I8): A, B,
  // and A again as the A/A control -- what "no change at all" looks like in
  // this very session, with the same fixture-per-side cost as B.
  const bin: Record<Side, string> = { A, B, C: A };
  const dir: Record<Side, string> = { A: buildBacklog(A), B: buildBacklog(B), C: buildBacklog(A) };
  process.stdout.write(
    `perf A/B: ${ELEMENT_COUNT} elements, ${rounds} rounds interleaved, gate: paired B/A median <= +${AB_TOLERANCE_PCT}% per ${GATE === 'reads' ? 'read command (writes reported only)' : 'command'}, reproduced once\n` +
      `  A = ${A}\n      sha256 ${sha256(A)}\n` +
      `  B = ${B}\n      sha256 ${sha256(B)}\n` +
      `  control: A/A (A a second time, own fixture)\n` +
      `  machine: ${power || 'mains power, no Low Power Mode'}; ${load ? 'busy: ' + load : 'cpu quiet'}\n` +
      (power || load ? '  (absolute numbers are not § 13 numbers on this machine; the A/B comparison still holds)\n' : '') +
      '\n'
  );
  // t[pass][side][label]: index i of A, B and C is one round of one pass.
  const t: Timings[] = [{ A: {}, B: {}, C: {} }, { A: {}, B: {}, C: {} }];
  for (const p of t) for (const side of ['A', 'B', 'C'] as Side[]) { for (const c of COMMANDS.concat(WRITES)) p[side][c.label] = []; }
  let loadedRounds = 0, totalRounds = 0;
  // The order rotates every round (A B C, B C A, C A B): a fixed order would
  // hand one side the warmer cache or the quieter moment every time.
  const ORDERS: Side[][] = [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']];
  const runRounds = (pass: number, group: Cmd[], n: number): void => {
    for (let r = 0; r < n; r++) {
      totalRounds++;
      if (quietMachineViolation()) loadedRounds++;
      for (const c of group) {
        for (const side of ORDERS[r % 3]) t[pass][side][c.label].push(timeOnce(bin[side], dir[side], argsOf(c)));
      }
    }
  };
  // All read rounds first, then all write rounds, so no read on the first
  // pass sees a backlog the writes have grown.
  runRounds(0, COMMANDS, rounds);
  runRounds(0, WRITES, rounds);
  const paired = (pass: number, side: Side, label: string): number => (median(t[pass].A[label].map((a, i) => t[pass][side][label][i] / a)) - 1) * 100;
  const groups: [string, Cmd[], boolean][] = [['reads', COMMANDS, true], ['writes', WRITES, GATE !== 'reads']];
  // A red must reproduce (I4): every gated command over the tolerance gets a
  // second, separate pass of as many rounds, and counts only if that pass is
  // over it too. Both passes are printed.
  const again: Cmd[] = [];
  for (const [, group, gated] of groups) for (const c of group) if (gated && paired(0, 'B', c.label) > AB_TOLERANCE_PCT) again.push(c);
  if (again.length) runRounds(1, again, rounds);
  for (const side of Object.keys(dir) as Side[]) fs.rmSync(dir[side], { recursive: true, force: true });

  const f = (x: number): string => x.toFixed(0).padStart(4);
  const sign = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
  const slower: string[] = [];
  let aaWorst = 0;
  for (const [title, group, gated] of groups) {
    process.stdout.write(
      `  ${title.padEnd(14)} ${'A median/max'.padStart(14)}   ${'B median/max'.padStart(14)}   ${'A/A'.padStart(7)}   B/A` +
        (gated ? '' : '  (reported, not gated: --gate=reads)') + '\n'
    );
    for (const c of group) {
      const a = t[0].A[c.label], b = t[0].B[c.label];
      const aa = paired(0, 'C', c.label);
      aaWorst = Math.max(aaWorst, Math.abs(aa));
      const first = paired(0, 'B', c.label);
      let tail = '';
      if (again.includes(c)) {
        const second = paired(1, 'B', c.label);
        const reproduced = second > AB_TOLERANCE_PCT;
        if (reproduced) slower.push(c.label);
        tail = reproduced
          ? `  REGRESSION (reproduced: 2nd pass ${sign(second)}, A/A ${sign(paired(1, 'C', c.label))})`
          : `  not reproduced: 2nd pass ${sign(second)} -> load, not nj`;
      }
      process.stdout.write(
        `  ${c.label.padEnd(14)} ${f(median(a))} / ${f(Math.max(...a))} ms   ${f(median(b))} / ${f(Math.max(...b))} ms   ` +
          `${sign(aa).padStart(7)}   ${sign(first)}${tail}\n`
      );
    }
  }
  process.stdout.write(
    `\n  A/A control: worst |A/A| ${aaWorst.toFixed(1)}% over all commands` +
      (aaWorst > AB_TOLERANCE_PCT ? ` -- above the ${AB_TOLERANCE_PCT}% tolerance: this session is too noisy for a green to mean much` : '') +
      `\n  ${loadedRounds} of ${totalRounds} rounds started with foreign cpu load over the bar\n`
  );
  if (slower.length) {
    process.stdout.write(`\nperf A/B: FAILED -- B is slower than A by more than ${AB_TOLERANCE_PCT}% (paired median, reproduced) on: ${slower.join(', ')}.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nperf A/B: OK -- no gated command of B is slower than A by more than ${AB_TOLERANCE_PCT}% (paired median; any first-pass red did not reproduce).\n`);
}

function main(): void {
  const ab = process.argv.filter((a) => a.startsWith('--ab=')).map((a) => path.resolve(a.slice(5)));
  const roundsArg = process.argv.find((a) => a.startsWith('--rounds='));
  if (ab.length > 0) {
    const rounds = roundsArg ? Number(roundsArg.slice(9)) : AB_ROUNDS_DEFAULT;
    if (ab.length !== 2 || !Number.isInteger(rounds) || rounds < 1 || (GATE !== 'all' && GATE !== 'reads')) {
      process.stderr.write('usage: perf.ts --ab=<nj A> --ab=<nj B> [--rounds=N] [--gate=all|reads]   (exactly two --ab, N >= 1)\n');
      process.exit(2);
    }
    mainAB(ab, rounds);
    return;
  }
  if (!fs.existsSync(DIST_NJ)) {
    process.stderr.write(`perf: ${DIST_NJ} not built -- run \`npm run build\` first\n`);
    process.exit(2);
  }
  // Power before load: it does not pass by waiting a minute, and it is the
  // one a CPU snapshot cannot see.
  const power = powerViolation();
  if (power) abortNotQuiet('power', power);
  // Checked here, before buildBacklog() -- not after it. Writing (or later
  // removing) the fixture's 20 000 files is itself a burst fseventsd reacts
  // to for a second or two (measured: 86% on that one process alone, right
  // after the write burst, settling back to 0% within ~2s). Bracketing the
  // fixture I/O instead of the measurement would make the fixture's own
  // setup look like the machine being busy.
  const beforeViolation = quietMachineViolation();
  if (beforeViolation) abortNotQuiet('before the run', beforeViolation);
  const dir = buildBacklog(DIST_NJ);
  let overBar = false;
  process.stdout.write(
    `perf: dist/nanojira.mjs, ${ELEMENT_COUNT} elements, ${RUNS} runs each, bar median<=${MEDIAN_MS}ms max<=${MAX_MS}ms (docs/SPECIFICATION.md:850)\n\n`
  );
  for (const cmd of COMMANDS) {
    const { median: med, max } = measure(dir, cmd);
    const over = med > MEDIAN_MS || max > MAX_MS;
    if (over) overBar = true;
    process.stdout.write(
      `  ${cmd.label.padEnd(14)} median ${med.toFixed(0).padStart(4)} ms  max ${max.toFixed(0).padStart(4)} ms` +
        (over ? '  OVER BAR' : '') +
        '\n'
    );
  }
  process.stdout.write('\n  writes (no § 13 bar yet: reported, not gated)\n');
  for (const cmd of WRITES) {
    const { median: med, max } = measure(dir, cmd);
    process.stdout.write(`  ${cmd.label.padEnd(14)} median ${med.toFixed(0).padStart(4)} ms  max ${max.toFixed(0).padStart(4)} ms\n`);
  }
  const afterViolation = quietMachineViolation();
  fs.rmSync(dir, { recursive: true, force: true });
  if (afterViolation) abortNotQuiet('after the run', afterViolation);
  if (overBar) {
    process.stdout.write('\nperf: FAILED -- see OVER BAR line(s) above.\n');
    process.exit(1);
  }
  process.stdout.write('\nperf: OK -- all commands within the docs/SPECIFICATION.md:850 comfort bar.\n');
}

main();
