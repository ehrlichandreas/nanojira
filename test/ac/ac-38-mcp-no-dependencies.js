'use strict';
/* AC-38 — `dist/nj-mcp` ships with zero runtime dependencies, mirroring
 * AC-15's own methodology for `dist/nj` (§ 17, § 3: "no runtime
 * dependency and no build-time dependency for nj-mcp itself").
 *
 * `test/ac/ac-15-no-dependencies.js` proves this for `dist/nj` by copying
 * it ALONE into a bare directory (no `node_modules` beside it) and
 * confirming it still runs. This file does the identical thing for
 * `dist/nj-mcp`, extended to confirm the copied-alone binary answers
 * BOTH protocol eras it claims to speak (§ 17): a legacy
 * `initialize`/`tools/list` round trip, and a modern
 * `server/discover`/`tools/list` round trip.
 *
 * The driver is `test/lib/mcp-stdio.js` — hand-rolled, zero dependencies
 * itself — never the official SDK client (that would reintroduce exactly
 * the dependency this criterion is checking the absence of).
 *
 * Written before `nj-mcp` exists: CANNOT RUN until it does.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const MCP = require('../lib/mcp-stdio.js');
const T = H.T;

H.requireNj();
H.requireNjMcp();

function J(x) { return JSON.stringify(x === undefined ? null : x); }

(async () => {
  const distNjMcp = H.NJ_MCP;

  /* A bare directory: nothing else in it, not `node_modules`, not
   * `package.json` — the same "it runs on its own or not at all" check
   * AC-15 already makes for `dist/nj`. */
  const scratch = H.freshDir('ac38-mcp-alone');
  const lonely = path.join(scratch, 'nj-mcp');
  fs.copyFileSync(distNjMcp, lonely);
  fs.chmodSync(lonely, 0o755);
  T.eq('nothing was copied alongside nj-mcp — it runs on its own or not at all',
    JSON.stringify(fs.readdirSync(scratch)), JSON.stringify(['nj-mcp']));

  /* A real backlog for it to serve, built with the nj under test (not the
   * lonely copy — the backlog itself has no dependency story to check). */
  const projDir = H.freshDir('ac38-mcp-proj');
  const bl = path.join(projDir, 'backlog');
  const env = { NJ_NOW: H.FIXED_NOW };
  const init = H.runNj(['init', '--backlog=' + bl], { cwd: projDir, env });
  T.exit('fixture: nj init builds the backlog nj-mcp will serve', init, 0);

  function spawnLonely(args) {
    return MCP.spawnServer(lonely, ['--backlog=' + bl].concat(args || []),
      { cwd: scratch, env: Object.assign({}, { NJ_NOW: H.FIXED_NOW }, { NODE_PATH: '' }) });
  }

  /* Legacy round trip: initialize, then tools/list. */
  {
    const s = spawnLonely([]);
    try {
      const init = await s.initialize();
      T.check('the lone nj-mcp answers initialize (legacy)', !init.error, J(init.error));
      T.eq('the lone nj-mcp declares the legacy revision 2025-11-25',
        init.result && init.result.protocolVersion, '2025-11-25');
      const list = await s.legacyToolsList();
      T.check('the lone nj-mcp answers tools/list (legacy)', !list.error, J(list.error));
      T.check('tools/list names at least one tool, with no node_modules beside it',
        !!(list.result && Array.isArray(list.result.tools) && list.result.tools.length > 0),
        J(list.result));
    } finally {
      await s.close();
    }
  }

  /* Modern round trip: server/discover, then tools/list. */
  {
    const s = spawnLonely([]);
    try {
      const disc = await s.discover();
      T.check('the lone nj-mcp answers server/discover (modern)', !disc.error, J(disc.error));
      T.eq('the lone nj-mcp\'s discover names both pinned revisions',
        (disc.result && disc.result.supportedVersions || []).slice().sort(),
        ['2025-11-25', '2026-07-28']);
      const list = await s.modernToolsList();
      T.check('the lone nj-mcp answers tools/list (modern)', !list.error, J(list.error));
      T.check('tools/list (modern) names at least one tool',
        !!(list.result && Array.isArray(list.result.tools) && list.result.tools.length > 0),
        J(list.result));
    } finally {
      await s.close();
    }
  }

  T.check('still nothing else appeared beside the lone copy — no node_modules was pulled in',
    JSON.stringify(fs.readdirSync(scratch).sort()), JSON.stringify(['nj-mcp']));

  T.finish();
})().catch(e => {
  console.log('FAIL ' + path.basename(__filename) + ' — uncaught: ' + (e && e.stack || e));
  process.exit(1);
});
