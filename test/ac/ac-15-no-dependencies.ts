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
 * WHICH NODE. The harness reads NJ_NODE when it is loaded, so the runtime is
 * resolved before the require below — otherwise `nj` would be driven by
 * whatever Node runs this test and the criterion would be vacuous. Search
 * order, first hit wins:
 *
 *   1. NJ_NODE, when set — a caller can pin a runtime deliberately; it is
 *      never overwritten.
 *   2. Walking up from the project directory, the first ancestor D holding
 *      D/runtime/<platform>/bin/node or D/portable/runtime/<platform>/bin/node.
 *      That covers both checkouts the project has lived in:
 *      workspace/portable/projects/nanojira (runtime two levels up, beside
 *      `projects/`) and workspace/nanojira (runtime under workspace/portable).
 *   3. The Node running this file, when it is >= 24 (§ 3's minimum)
 *      (DECISIONS 202, D). A checkout outside any portable tree -- a scratch
 *      clone under /tmp, ~/…/repos/nanojira itself -- has no runtime/ above
 *      it, and `npm test` sets no NJ_NODE; reporting CANNOT RUN there kept
 *      the release gate red with a perfectly good Node at hand.
 *
 * Only when none of those yields a usable Node does the test report CANNOT
 * RUN, not FAIL: a missing runtime is a missing prerequisite, not a defect
 * of `nj`. An explicit NJ_NODE that does not exist is CANNOT RUN too --
 * never silently swapped for a fallback the caller did not pin. Every spawn
 * below uses that one resolved path, so an explicit NJ_NODE is the Node
 * the whole criterion is checked on.
 *
 * "Without network" is not observable from a spawned process without a
 * sandbox; what is observable is that no module outside the Node distribution
 * can be loaded, which is what NODE_PATH below pins, and which the lone-copy
 * check below pins for the nj under test specifically.
 */
import path from 'path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLATFORM = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
const PROJECT = path.resolve(__dirname, '..', '..');

function findRuntime() {
  const tried = [];
  if (process.env.NJ_NODE) {
    tried.push('NJ_NODE=' + process.env.NJ_NODE);
    return { node: fs.existsSync(process.env.NJ_NODE) ? process.env.NJ_NODE : null, tried };
  }
  const rel = path.join('runtime', PLATFORM, 'bin', 'node');
  for (let d = PROJECT; ; d = path.dirname(d)) {
    for (const c of [path.join(d, rel), path.join(d, 'portable', rel)]) {
      tried.push(c);
      if (fs.existsSync(c)) return { node: c, tried };
    }
    if (path.dirname(d) === d) break;
  }
  tried.push('process.execPath=' + process.execPath + ' (' + process.version + ', needs >= 24)');
  const major = parseInt(process.version.replace(/^v/, ''), 10);
  return { node: major >= 24 ? process.execPath : null, tried };
}

const found = findRuntime();
if (!found.node) {
  console.log('FAIL ' + path.basename(__filename) + ' — CANNOT RUN');
  console.log('  no runtime Node found for ' + PLATFORM + '; tried, in order:');
  for (const t of found.tried.slice(0, 12)) console.log('    ' + t);
  if (found.tried.length > 12) console.log('    ' + found.tried[found.tried.length - 1]);
  console.log('  Set NJ_NODE to the runtime Node (§ 3: workspace/portable/runtime/<platform>/bin/node).');
  process.exit(1);
}
const RUNTIME_NODE = found.node;
process.env.NJ_NODE = RUNTIME_NODE;

import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

/* Stringify for failure details: never throws on undefined. */
function J(x: any) { return JSON.stringify(x === undefined ? null : x); }

/* ---- the runtime itself ------------------------------------------------- */

{
  const exists = fs.existsSync(RUNTIME_NODE);
  T.check('the runtime Node exists (' + RUNTIME_NODE + ')', exists, RUNTIME_NODE);
  T.eq('the harness drives nj with the runtime Node', H.NODE, process.env.NJ_NODE);
  T.check('the harness knows where nj is', !!H.NJ, 'no NJ path given (argv[2] or NJ)');

  if (exists) {
    let version = '';
    try {
      version = execFileSync(RUNTIME_NODE, ['--version'], { encoding: 'utf8' }).trim();
    } catch (e) {
      version = 'cannot run: ' + (e as Error).message;
    }
    const major = parseInt(String(version).replace(/^v/, ''), 10);
    T.check('the runtime Node is at least v24 (§ 3)', major >= 24, 'reported: ' + version);
  }
}

/* ---- the nj under test runs alone, without anything beside it (§ 3) ----- */

/* The lone copy is of the nj this run verifies (argv[2] / NJ), not of
 * <project>/dist/nj: a run against a candidate bundle must check THAT
 * bundle's self-containment, and a run against an older bundle (a v2
 * baseline copy) must not silently check the working tree's instead. When
 * that nj is a bin/ launcher -- run-all's default since D187, so what
 * `npm test` passes -- the lone copy is the bundle the launcher runs
 * (H.NJ_BUNDLE, dist/<name>.mjs beside it): the sh launcher is not
 * JavaScript, and `node <launcher>` died on its first comment line
 * (DECISIONS 202, B). The launcher itself is § 18's, covered by ac-56. */
{
  const distNj = H.NJ_BUNDLE;
  const distExists = !!distNj && fs.existsSync(distNj);
  T.check('the nj under test exists (§ 3: what ships is one file)', distExists, distNj);

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
    T.eq('nothing was copied alongside the nj under test — it runs on its own or not at all',
      JSON.stringify(fs.readdirSync(scratch)), JSON.stringify(['nj']));

    const runLonely = (args: string[], opts?: { env?: Record<string, string | undefined> }) => {
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
