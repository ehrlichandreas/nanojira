'use strict';
/* AC-15 — No dependencies.
 *
 * § 15 AC-15: "No dependencies. `nj` runs on the Node from `runtime/`, without
 * `node_modules`, without network."
 *
 * § 3 Runtime (current wording, DECISIONS 83): Dependencies — none at
 *   runtime: no external service (not Jira, not any other), `dist/nj` runs
 *   as one file without `node_modules` and without network; build-time
 *   tooling may declare `devDependencies`. Entry point: one executable
 *   script, `dist/nj`.
 *
 * "No dependencies" was misread once as "no npm packages at all" and
 * tightened on that misreading (an earlier revision of this file scanned the
 * WHOLE PROJECT for any `node_modules` directory and failed if one existed
 * anywhere — which would have turned red the day build tooling first ships a
 * `devDependencies` entry, § 3's own planned next step, TSK-021). That check
 * is gone. What § 3 actually promises is narrower and is checked directly
 * below: `dist/nj`, copied ALONE into a bare directory with nothing else
 * beside it, still runs — the shipped file does not reach for a
 * `node_modules` the project may have for its own build tooling.
 *
 * The harness reads NJ_NODE when it is loaded, so it is set before the require
 * below — otherwise `nj` would be driven by whatever Node runs this test and
 * the criterion would be vacuous. The environment variable is only defaulted,
 * never overwritten, so a caller can pin a different runtime deliberately.
 *
 * "Without network" is not observable from a spawned process without a
 * sandbox; what is observable is that no module outside the Node distribution
 * can be loaded, which is what NODE_PATH below pins, and which the lone-copy
 * check below pins for `dist/nj` specifically.
 */
const PORTABLE = '/home/dev/workspace/portable';
const PLATFORM = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
const RUNTIME_NODE = PORTABLE + '/runtime/' + PLATFORM + '/bin/node';
if (!process.env.NJ_NODE) process.env.NJ_NODE = RUNTIME_NODE;

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
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

/* ---- dist/nj runs alone, without any node_modules beside it (§ 3) ------- */

{
  const distNj = path.join(PROJECT, 'dist', 'nj');
  const distExists = fs.existsSync(distNj);
  T.check('dist/nj exists (§ 3: what ships)', distExists, distNj);

  if (distExists) {
    /* A bare directory: nothing else in it, not `lib/`, not `node_modules`,
     * not `package.json`. If `dist/nj` were not genuinely self-contained —
     * still `require`-ing a sibling `lib/` instead of carrying every module
     * inline — this is where that would show up as MODULE_NOT_FOUND, not as
     * a passing scan of the project root that never asked the file itself. */
    const scratch = H.freshDir('ac15-dist-alone');
    const lonelyNj = path.join(scratch, 'nj');
    fs.copyFileSync(distNj, lonelyNj);
    fs.chmodSync(lonelyNj, 0o755);
    T.eq('nothing was copied alongside dist/nj — it runs on its own or not at all',
      JSON.stringify(fs.readdirSync(scratch)), JSON.stringify(['nj']));

    const runLonely = (args, opts) => {
      const o = opts || {};
      const r = spawnSync(RUNTIME_NODE, [lonelyNj].concat(args), {
        cwd: scratch, env: Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW }, o.env),
        encoding: 'utf8', timeout: 30000,
      });
      return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    };

    const init = runLonely(['init']);
    T.exit('the lone copy inits a backlog with no node_modules beside it', init, 0);

    const newEpic = runLonely(['new', '--type=epic', '--title=Auth']);
    T.exit('the lone copy creates an epic', newEpic, 0);

    const json = runLonely(['list', '--json'], { env: { NODE_PATH: '' } });
    T.exit('the lone copy reads its own backlog, NODE_PATH emptied', json, 0);
    let parsed = null;
    try { parsed = JSON.parse(json.stdout); } catch (e) { /* reported below */ }
    T.check('the read works with nothing beside the file but the backlog it created',
      !!(parsed && Array.isArray(parsed.entries) && parsed.entries.length === 1),
      (json.stderr || J(parsed)).slice(0, 300));

    T.check('still nothing else appeared beside it — no node_modules was pulled in',
      JSON.stringify(fs.readdirSync(scratch).sort()), JSON.stringify(['backlog', 'nj']));
  }
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
