'use strict';
/* Edge — TSK-018: a reader that closes its end of stdout early must not crash
 * `nj`.
 *
 * `nj list`/`nj doctor`/bare `nj` on a large backlog write more than fits in
 * one pipe buffer; a consumer like `| head -1` reads a little and closes, and
 * the next stdout write then fails with EPIPE. SPECIFICATION.md does not
 * mention this at all (AMBIGUITIES.md 48): DECIDED behaviour is that the
 * command already did its job and only the reader stopped listening, so
 * EPIPE on stdout is silent -- exit 0, nothing on stderr, no stack trace --
 * while any OTHER stdout write error must still crash visibly, exactly as
 * before (not re-tested here: simulating a non-EPIPE stdout error needs a
 * fake stream, not a real pipe, and was verified directly against
 * lib/output.ts during the fix).
 *
 * Goes through an actual shell pipe (`bash -c '… | head -1'`), not a Node
 * readable stream `.destroy()` on the parent side -- that alternative was
 * tried first and reliably produced `ENOTCONN` instead of `EPIPE` on this
 * platform (Node's parent/child stdio pipe is a different kind of transport
 * than a real anonymous pipe between two independent shell processes). The
 * real-world case a user or agent hits is exactly a shell pipe, so the test
 * reproduces that transport, not a Node-internal approximation of it.
 * `PIPESTATUS[0]` recovers `nj`'s own exit code from inside the pipeline
 * (`$?` after a pipe is the LAST command's exit status, i.e. `head`'s).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

/** Runs `nj <args> | head -1` in a real shell, discarding stdout past the
 * first line. Resolves {exit, stderr} for `nj` itself. */
function runPiped(d, args, stderrFile) {
  const argStr = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const cmd = `'${H.NODE}' '${H.NJ}' ${argStr} 2>'${stderrFile}' | head -1 >/dev/null; echo "\${PIPESTATUS[0]}"`;
  const r = spawnSync('/bin/bash', ['-c', cmd], { cwd: d, encoding: 'utf8' });
  const exit = parseInt(String(r.stdout || '').trim(), 10);
  const stderr = fs.readFileSync(stderrFile, 'utf8');
  return { exit, stderr };
}

function snapshot(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, n), r = rel ? rel + '/' + n : n;
      if (fs.statSync(a).isDirectory()) walk(a, r);
      else out[r] = fs.readFileSync(a).toString('hex');
    }
  };
  walk(dir, '');
  return out;
}

function main() {
  H.requireNj();
  const d = H.freshDir('epipe');
  H.runNj(['init'], { cwd: d });
  const Bk = path.join(d, 'backlog');
  const ts = '2026-01-01T00:00:00Z';
  const pad = (n, w) => String(n).padStart(w, '0');
  for (let i = 1; i <= 50; i++) {
    const id = 'EPIC-' + pad(i, 3);
    fs.writeFileSync(path.join(Bk, 'epics', id + '.md'),
      `---\nid: ${id}\ntype: epic\ntitle: E${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# E${i}\n\n## Description\nx\n`);
  }
  // 6000 tasks: `nj list`'s output on this backlog is well past one pipe
  // buffer, so the EPIPE trigger fires reliably instead of racing the
  // buffer size on whichever platform CI happens to run on.
  for (let i = 1; i <= 6000; i++) {
    const id = 'TSK-' + pad(i, 5), p = 'EPIC-' + pad((i % 50) + 1, 3);
    fs.writeFileSync(path.join(Bk, 'tasks', id + '.md'),
      `---\nid: ${id}\ntype: task\nparent: ${p}\ntitle: T${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# T${i}\n\n## Description\nx\n\n## Acceptance Criteria\ny\n`);
  }

  const before = snapshot(Bk);

  let n = 0;
  for (const args of [['list'], ['doctor'], []]) {
    const label = args.length ? args.join(' ') : '(bare nj)';
    const stderrFile = path.join(d, `.epipe-stderr-${n++}.log`);
    fs.writeFileSync(stderrFile, '');
    const r = runPiped(d, args, stderrFile);
    T.eq(`${label}: exit 0 when the reader closes early`, r.exit, 0);
    T.eq(`${label}: nothing on stderr`, r.stderr, '');
    fs.unlinkSync(stderrFile);
  }

  const after = snapshot(Bk);
  T.eq('backlog files unchanged by any of the early-close runs', JSON.stringify(after), JSON.stringify(before));

  T.finish();
}

main();
