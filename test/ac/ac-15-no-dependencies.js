'use strict';
/* AC-15 — No dependencies.
 *
 * § 15 AC-15: "No dependencies. `nj` runs on the Node from `runtime/`, without
 * `node_modules`, without network."
 *
 * § 3 Runtime: Node.js ≥ 24, from workspace/portable/runtime/<platform>/bin/node.
 *   Dependencies: none — Node built-ins only. Entry point: one executable
 *   script `nj`.
 *
 * The harness reads NJ_NODE when it is loaded, so it is set before the require
 * below — otherwise `nj` would be driven by whatever Node runs this test and
 * the criterion would be vacuous. The environment variable is only defaulted,
 * never overwritten, so a caller can pin a different runtime deliberately.
 *
 * "Without network" is not observable from a spawned process without a
 * sandbox; what is observable is that no module outside the Node distribution
 * can be loaded, which is what NODE_PATH and the node_modules scan below pin.
 */
const PORTABLE = '/home/dev/workspace/portable';
const PLATFORM = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
const RUNTIME_NODE = PORTABLE + '/runtime/' + PLATFORM + '/bin/node';
if (!process.env.NJ_NODE) process.env.NJ_NODE = RUNTIME_NODE;

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const PROJECT = path.resolve(__dirname, '..', '..');

/* ---- the runtime itself ------------------------------------------------- */

{
  const exists = fs.existsSync(RUNTIME_NODE);
  T.check('the runtime Node ships at runtime/' + PLATFORM + '/bin/node', exists, RUNTIME_NODE);
  T.eq('the harness drives nj with the runtime Node', H.NODE, process.env.NJ_NODE);
  T.check('the harness knows where nj is', !!H.NJ, 'no NJ path given (argv[2] or NJ)');

  if (exists) {
    let version = '';
    try {
      version = execFileSync(RUNTIME_NODE, ['--version'], { encoding: 'utf8' }).trim();
    } catch (e) {
      version = 'cannot run: ' + e.message;
    }
    const major = parseInt(String(version).replace(/^v/, ''), 10);
    T.check('the runtime Node is at least v24 (§ 3)', major >= 24, 'reported: ' + version);
  }
}

/* ---- no node_modules anywhere under the project ------------------------- */

{
  /* Symlinks are neither followed nor counted: a link into a shared store is
   * not a dependency shipped with the project. */
  function scanNodeModules(root) {
    const hits = [];
    let dirs = 0;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      dirs++;
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const p = path.join(dir, e.name);
        if (e.name === 'node_modules') { hits.push(p); continue; }
        stack.push(p);
      }
    }
    return { hits: hits.sort(), dirs: dirs };
  }

  const res = scanNodeModules(PROJECT);
  T.check('the project ships no node_modules directory', res.hits.length === 0,
    res.hits.join(', '));
  T.check('the scan really walked the project tree (the check above is not vacuous)',
    res.dirs >= 3, 'directories visited: ' + res.dirs);
}

/* ---- the CLI works under that Node, with and without NODE_PATH ---------- */

{
  const d = H.freshDir('ac15-run');

  T.exit('nj init under the runtime Node', H.runNj(['init'], { cwd: d }), 0);
  T.exit('nj new under the runtime Node',
    H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.exit('nj new (task) under the runtime Node',
    H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Backend API Endpoints'], { cwd: d }), 0);

  const r = H.runJson(['list'], { cwd: d });
  T.exit('nj list --json under the runtime Node', r, 0);
  T.check('the read works without any external module',
    !!(r.json && Array.isArray(r.json.entries) && r.json.entries.length === 2),
    (r.parseError || J(r.json)).slice(0, 300));

  const empty = H.runJson(['list'], { cwd: d, env: { NODE_PATH: '' } });
  T.exit('nj list --json with NODE_PATH emptied', empty, 0);
  T.check('emptying NODE_PATH changes nothing', empty.stdout === r.stdout,
    'with NODE_PATH: ' + J(r.stdout).slice(0, 200) +
    '\n     without:       ' + J(empty.stdout).slice(0, 200));

  const unset = H.runJson(['list'], { cwd: d, unsetEnv: ['NODE_PATH'] });
  T.exit('nj list --json with NODE_PATH unset from the environment', unset, 0);

  // A write goes through the same runtime and the same built-ins.
  T.exit('nj set under the runtime Node',
    H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d, env: { NODE_PATH: '' } }), 0);

  // doctor loads the whole backlog including the configuration.
  const doc = H.runJson(['doctor'], { cwd: d, env: { NODE_PATH: '' } });
  T.exit('nj doctor --json under the runtime Node, exit 0 for a fresh backlog (AC-19)', doc, 0);
  T.check('doctor reports no problem for freshly created elements',
    !!(doc.json && doc.json.ok === true && Array.isArray(doc.json.problems) &&
      doc.json.problems.length === 0),
    (doc.parseError || J(doc.json)).slice(0, 300));
}

T.finish();
