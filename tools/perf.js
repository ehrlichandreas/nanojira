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

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NJ = path.join(ROOT, 'dist', 'nj');
const NODE = process.execPath;
const RUNS = 5; // docs/SPECIFICATION.md:840: "median of 5"
const ELEMENT_COUNT = 10000;
const EPIC_COUNT = 100;

// docs/SPECIFICATION.md:850. Overridable only so the counter-test can prove a
// crossed bar is actually caught (an artificially lowered bar must go red);
// there is no legitimate reason to loosen these for a real run.
const MEDIAN_MS = Number(process.env.PERF_MEDIAN_MS || 250);
const MAX_MS = Number(process.env.PERF_MAX_MS || 500);

const COMMANDS = [
  { label: 'list', args: ['list'] },
  { label: 'list --json', args: ['list', '--json'] },
  { label: 'tree', args: ['tree'] },
  { label: 'doctor', args: ['doctor'] },
];

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

function foreignCpuLoad() {
  // ppid check only excludes direct children: measurement always spawns and
  // waits (spawnSync) before the next check runs, so no grandchild can still
  // be alive at a check point.
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,comm='], { encoding: 'utf8' });
  return (r.stdout || '')
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), comm: m[4] }))
    .filter((p) => p.pid !== process.pid && p.ppid !== process.pid);
}

// null when quiet, otherwise the message to report. Returns rather than
// exits itself: the caller after the measurement still has a temp dir to
// clean up first, an exit here would skip that.
function quietMachineViolation() {
  const rows = foreignCpuLoad();
  const worst = rows.reduce((a, b) => (b.cpu > a.cpu ? b : a), { cpu: 0, pid: null, comm: '' });
  const sum = rows.reduce((s, p) => s + p.cpu, 0);
  if (worst.cpu <= CPU_SINGLE_PCT && sum <= CPU_SUM_PCT) return null;
  return (
    `worst pid ${worst.pid} (${worst.comm}) at ${worst.cpu}% cpu, ${sum.toFixed(1)}% total across ` +
    `other processes (bar: one > ${CPU_SINGLE_PCT}% or sum > ${CPU_SUM_PCT}%)`
  );
}

function abortNotQuiet(when, violation) {
  process.stderr.write(
    `perf: machine not quiet (${when}) -- ${violation}. ` +
      'A measurement now would blame machine load on nj, not nj itself. Aborting.\n'
  );
  process.exit(3);
}

function buildBacklog() {
  const dir = fs.mkdtempSync('/tmp/nj-perf-');
  const init = spawnSync(NODE, [NJ, 'init'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (init.status !== 0) {
    process.stderr.write('perf: nj init failed:\n' + init.stderr);
    process.exit(2);
  }
  const backlog = path.join(dir, 'backlog');
  const idsDir = path.join(backlog, '.ids');
  const ts = '2026-01-01T00:00:00Z';
  const pad = (n, w) => String(n).padStart(w, '0');
  // Files are hand-written below, not created through `nj new`, so they leave
  // no `.ids/` tombstone behind on their own -- `doctor` then reports a real
  // ERROR ("never-reuse guarantee not in force"), which has nothing to do
  // with the commands being measured. Write the tombstones ourselves so the
  // fixture is clean and `doctor`'s own scan cost is what gets measured.
  const tombstone = (id) => fs.writeFileSync(path.join(idsDir, id), '');
  for (let i = 1; i <= EPIC_COUNT; i++) {
    const id = 'EPIC-' + pad(i, 3);
    fs.writeFileSync(
      path.join(backlog, 'epics', id + '.md'),
      `---\nid: ${id}\ntype: epic\ntitle: E${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# E${i}\n\n## Description\nx\n`
    );
    tombstone(id);
  }
  const taskCount = ELEMENT_COUNT - EPIC_COUNT;
  for (let i = 1; i <= taskCount; i++) {
    const id = 'TSK-' + pad(i, 5);
    const parent = 'EPIC-' + pad((i % EPIC_COUNT) + 1, 3);
    fs.writeFileSync(
      path.join(backlog, 'tasks', id + '.md'),
      `---\nid: ${id}\ntype: task\nparent: ${parent}\ntitle: T${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# T${i}\n\n## Description\nx\n\n## Acceptance Criteria\ny\n`
    );
    tombstone(id);
  }
  return dir;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measure(cwd, args) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint();
    const r = spawnSync(NODE, [NJ, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (r.status !== 0) {
      process.stderr.write(`perf: '${args.join(' ')}' exited ${r.status}\n` + r.stderr);
      process.exit(2);
    }
  }
  return { median: median(times), max: Math.max(...times) };
}

function main() {
  if (!fs.existsSync(NJ)) {
    process.stderr.write(`perf: ${NJ} not built -- run \`npm run build\` first\n`);
    process.exit(2);
  }
  // Checked here, before buildBacklog() -- not after it. Writing (or later
  // removing) the fixture's 20 000 files is itself a burst fseventsd reacts
  // to for a second or two (measured: 86% on that one process alone, right
  // after the write burst, settling back to 0% within ~2s). Bracketing the
  // fixture I/O instead of the measurement would make the fixture's own
  // setup look like the machine being busy.
  const beforeViolation = quietMachineViolation();
  if (beforeViolation) abortNotQuiet('before the run', beforeViolation);
  const dir = buildBacklog();
  let overBar = false;
  process.stdout.write(
    `perf: dist/nj, ${ELEMENT_COUNT} elements, ${RUNS} runs each, bar median<=${MEDIAN_MS}ms max<=${MAX_MS}ms (docs/SPECIFICATION.md:850)\n\n`
  );
  for (const cmd of COMMANDS) {
    const { median: med, max } = measure(dir, cmd.args);
    const over = med > MEDIAN_MS || max > MAX_MS;
    if (over) overBar = true;
    process.stdout.write(
      `  ${cmd.label.padEnd(14)} median ${med.toFixed(0).padStart(4)} ms  max ${max.toFixed(0).padStart(4)} ms` +
        (over ? '  OVER BAR' : '') +
        '\n'
    );
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
