'use strict';
/* AC-39 — `--version`, docs/SPECIFICATION.md § 9 "`--version`", § 17 (v3.4,
 * promoted: DECISIONS 151, commit b2b10a7; nj-mcp's own startup arguments
 * made strict per DECISIONS 152, commit dd1c248).
 *
 * AC-39 (§ 15): "nj --version prints nj <version> and exits 0, with no
 * backlog resolved and no file read but nj's own — confirmed by running it
 * in an empty directory with no .njrc anywhere above it and NJ_BACKLOG
 * unset. nj --version --json prints exactly {"version": "<version>"}.
 * nj-mcp --version behaves identically for nj-mcp, and reports the same
 * version nj --version does — the one package.json source embedded into
 * both at build time; the same value is what nj-mcp's server/discover/
 * initialize responses declare as serverInfo's version. --version
 * combined with any other flag or an explicit subcommand is
 * unknown_field."
 *
 * The expected version string is pinned to the package.json "version"
 * field's current value — "3.6.0" as of v3.6's release docs round — the
 * same spec-named value this whole criterion exists to check, not a
 * looser pattern match. Bumping this pin is expected to go red until the
 * Implementer bumps package.json to match (and rebuilds); that is the
 * point of pinning an exact string rather than a pattern.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('../lib/harness.js');
const MCP = require('../lib/mcp-stdio.js');
const T = H.T;

H.requireNj();
H.requireNjMcp();

const VERSION = '3.6.0';
function J(x) { return JSON.stringify(x === undefined ? null : x); }

function envFor(o) {
  const env = Object.assign({}, (o && o.env) || {});
  return { cwd: o && o.cwd, env, unsetEnv: ['NJ_BACKLOG'] };
}
function run(args, o) { return H.runNj(args, envFor(o)); }

/* ===================================================================== */
/* V1 — `nj --version`: exit 0, "nj <version>"                            */
/* ===================================================================== */
{
  const d = H.freshDir('v39-bare');
  const r = run(['--version'], { cwd: d });
  T.exit('V1 nj --version: exit 0', r, 0);
  T.eq('V1 nj --version: stdout is exactly "nj 3.5.0\\n"', r.stdout, 'nj ' + VERSION + '\n');
  T.eq('V1 nj --version: nothing on stderr', r.stderr, '');
}

/* ===================================================================== */
/* V2 — `nj --version --json`: exactly {"version": "<version>"}           */
/* ===================================================================== */
{
  const d = H.freshDir('v39-json');
  const r = H.runJson(['--version'], envFor({ cwd: d }));
  T.exit('V2 nj --version --json: exit 0', r, 0);
  T.eq('V2 the JSON is exactly {"version": "3.5.0"}', r.json, { version: VERSION });
  T.eq('V2 nothing extra in the object', r.json && Object.keys(r.json).sort(), ['version']);
}

/* ===================================================================== */
/* V3 — works anywhere: no backlog, no .njrc, NJ_BACKLOG unset, confirmed  */
/* against the SAME directory where bare `nj` itself would fail           */
/* ===================================================================== */
{
  const d = H.freshDir('v39-nobacklog');
  const bare = run([], { cwd: d });
  T.exit('V3 fixture: bare `nj` in this empty directory fails (no_backlog)', bare, 1);
  const r = run(['--version'], { cwd: d });
  T.exit('V3 --version works in the exact directory where bare `nj` just failed', r, 0);
  T.eq('V3 --version: still "nj 3.5.0"', r.stdout, 'nj ' + VERSION + '\n');
  const rj = H.runJson(['--version'], envFor({ cwd: d }));
  T.eq('V3 --version --json: still exactly {"version": "3.5.0"}, no backlog field, no error', rj.json, { version: VERSION });
}

/* ===================================================================== */
/* V4 — `nj-mcp --version`: identical rule, "nj-mcp <version>"            */
/* ===================================================================== */
{
  const d = H.freshDir('v39-mcp-bare');
  const res = spawnSync(H.NODE, [H.NJ_MCP, '--version'], { cwd: d, encoding: 'utf8', timeout: 10000 });
  T.check('V4 nj-mcp --version: exit 0', res.status === 0, 'status=' + res.status + ' stderr=' + J(res.stderr));
  T.eq('V4 nj-mcp --version: stdout is exactly "nj-mcp 3.5.0\\n"', res.stdout, 'nj-mcp ' + VERSION + '\n');
}

/* ===================================================================== */
/* V6 — combinations: only --json combines with --version; anything else */
/* (another flag, or an explicit subcommand) is unknown_field             */
/* ===================================================================== */
{
  const d = H.freshDir('v39-combo-help');
  const r = run(['--version', '--help'], { cwd: d });
  T.exit('V6 --version with --help: exit 1', r, 1);
  const rj = H.runJson(['--version', '--help'], envFor({ cwd: d }));
  T.eq('V6 --version with --help: unknown_field', rj.json && rj.json.error, 'unknown_field');
}
{
  const d = H.freshDir('v39-combo-backlog');
  const r = run(['--version', '--backlog=' + d], { cwd: d });
  T.exit('V6 --version with --backlog: exit 1', r, 1);
  const rj = H.runJson(['--version', '--backlog=' + d], envFor({ cwd: d }));
  T.eq('V6 --version with --backlog: unknown_field', rj.json && rj.json.error, 'unknown_field');
}
{
  const d = H.freshDir('v39-combo-command');
  const r = run(['list', '--version'], { cwd: d });
  T.exit('V6 a subcommand with --version (nj list --version): exit 1', r, 1);
  const rj = H.runJson(['list', '--version'], envFor({ cwd: d }));
  T.eq('V6 nj list --version: unknown_field', rj.json && rj.json.error, 'unknown_field');
}
{
  const d = H.freshDir('v39-combo-leading');
  const r = run(['--version', 'list'], { cwd: d });
  T.exit('V6 --version given before a positional-looking "list" (never dispatched as a command): exit 1', r, 1);
  const rj = H.runJson(['--version', 'list'], envFor({ cwd: d }));
  T.eq('V6 --version list: unknown_field (not the version, not list\'s own output)', rj.json && rj.json.error, 'unknown_field');
}

/* ===================================================================== */
/* V7 — nj-mcp's own startup arguments are strict (D152, § 17): unknown  */
/* or typo'd flags, and --version combined with anything, are exit 1,    */
/* one stderr line naming the offending argument and the known ones,     */
/* nothing on stdout — checked before any protocol traffic is attempted  */
/* ===================================================================== */
function runMcp(args, cwd) {
  return spawnSync(H.NODE, [H.NJ_MCP].concat(args), { cwd, encoding: 'utf8', timeout: 10000 });
}
function assertMcpStartupRejected(label, args, mentions) {
  const d = H.freshDir('v39-mcp-strict');
  const res = runMcp(args, d);
  T.check(label + ': exit 1', res.status === 1, 'status=' + res.status + ' stderr=' + J(res.stderr));
  T.eq(label + ': nothing on stdout', res.stdout, '');
  const lines = (res.stderr || '').split('\n').filter(Boolean);
  T.check(label + ': exactly one stderr line', lines.length === 1, J(res.stderr));
  mentions.forEach(function (m) {
    T.check(label + ': stderr mentions ' + m, res.stderr.indexOf(m) !== -1, J(res.stderr));
  });
}
assertMcpStartupRejected('V7 nj-mcp --version --backlog=x', ['--version', '--backlog=/tmp'],
  ['--version', '--backlog', '--allow-destructive']);
assertMcpStartupRejected('V7 nj-mcp --version --allow-destructive', ['--version', '--allow-destructive'],
  ['--version', '--allow-destructive', '--backlog']);
assertMcpStartupRejected('V7 nj-mcp --version --json (nj-mcp has no --json)', ['--version', '--json'],
  ['--json', '--backlog', '--allow-destructive', '--version']);
assertMcpStartupRejected('V7 nj-mcp --bogus', ['--bogus'],
  ['--bogus', '--backlog', '--allow-destructive', '--version']);
assertMcpStartupRejected('V7 nj-mcp --allow-destrutive (typo)', ['--allow-destrutive'],
  ['--allow-destrutive', '--backlog', '--allow-destructive', '--version']);

/* ===================================================================== */
/* V5 — nj-mcp's own version equals --version's, via both eras'           */
/* serverInfo (§ 17: modern server/discover's _meta, legacy initialize's  */
/* top-level result — D151: "the same value again", both are pinned)      */
/* ===================================================================== */
(async () => {
  const d = H.freshDir('v39-mcp-discover');
  const bl = path.join(d, 'backlog');
  const init = H.runNj(['init', '--backlog=' + bl], { cwd: d, env: { NJ_NOW: H.FIXED_NOW }, unsetEnv: ['NJ_BACKLOG'] });
  if (init.status !== 0) T.check('fixture: nj init for the MCP discover fixture', false, J(init.stderr));

  const s = MCP.spawnServer(H.NJ_MCP, ['--backlog=' + bl], { cwd: d });
  try {
    const r = await s.discover();
    T.check('V5 server/discover: no protocol error', !r.error, J(r.error));
    const serverInfo = r.result && r.result._meta && r.result._meta['io.modelcontextprotocol/serverInfo'];
    T.eq('V5 server/discover\'s serverInfo.version equals nj --version\'s own value',
      serverInfo && serverInfo.version, VERSION);

    const ri = await s.initialize();
    T.check('V5 initialize: no top-level error', !ri.error, J(ri.error));
    const legacyServerInfo = ri.result && ri.result.serverInfo;
    T.eq('V5 legacy initialize\'s serverInfo.version equals nj --version\'s own value',
      legacyServerInfo && legacyServerInfo.version, VERSION);
  } finally {
    await s.close();
  }

  /* V8 — a valid start, including --allow-destructive, still answers
   * discover (D152: strict startup-argument validation must not reject
   * the KNOWN flags, only unknown or --version-combined ones) */
  const s2 = MCP.spawnServer(H.NJ_MCP, ['--backlog=' + bl, '--allow-destructive'], { cwd: d });
  try {
    const r2 = await s2.discover();
    T.check('V8 valid start (--backlog + --allow-destructive): no protocol error', !r2.error, J(r2.error));
    T.eq('V8 valid start: server/discover still completes',
      r2.result && r2.result.resultType, 'complete');
  } finally {
    await s2.close();
  }

  T.finish();
})();
