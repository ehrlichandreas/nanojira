'use strict';
/* AC-56 -- the exported skill folder, docs/SPECIFICATION.md § 18
 * "Packaging: the exported skill folder" / § 15 item 58 (v3.11,
 * DECISIONS 185, promoted: commit <pending>).
 *
 * AC-56 (§ 15 item 58): "node tools/export-skill.mts <tag> <dest>
 * verifies <tag> with git tag -v (refusing an unsigned or non-existent
 * tag), reads every shipped file from the tag's tree (never the
 * working tree), builds beside <dest> and renames atomically into
 * place, and refuses to replace a <dest> that lacks its own VERSION
 * file. The folder (SKILL.md, VERSION, bin/{nj,nj-mcp},
 * bin/{nj,nj-mcp}.cmd, dist/{nj,nj-mcp}.mjs) has no symlinks anywhere,
 * so the whole folder may be cp -R'd elsewhere and keeps working from
 * the copy. Each bin/ wrapper resolves its own location with a plain
 * dirname "$0" (never following a symlink), honours NJ_NODE, requires
 * Node.js >= 24, unsets NODE_OPTIONS, and on any startup failure exits
 * 127 with exactly one stderr line. The bundle is ESM (dist/nj.mjs,
 * dist/nj-mcp.mjs, in the repo and in every export, built only from
 * node:* imports). nj-mcp still finds its dist/nj.mjs sibling under
 * this layout, unaffected by an ambient "type": "module" above <dest>.
 * skill/SKILL.md's metadata.version equals package.json's version,
 * checked directly."
 *
 * Found by: D185 (2026-10-09, workspace/bin/ removed today, D159's
 * shared install ends; addendum 5f6529e, export tool moved to
 * TypeScript, no symlinks anywhere including the wrapper's own lookup;
 * addendum 9b3d0de, the bundle itself moves to ESM, dist/nj.mjs and
 * dist/nj-mcp.mjs replacing the extensionless CommonJS dist/nj and
 * dist/nj-mcp, in the repo as well as in every export).
 * The gap D179 let through -- nothing tested the DELIVERED layout
 * before, only the repo's own dist/ -- is explicitly what this suite
 * exists to close, exercised here through a scratch git repository and
 * a throwaway GPG identity: NEVER the real signing key, never
 * ~/.gnupg, never this project's own tags.
 *
 * Written before the fix lands: neither tools/export-skill.mts nor the
 * repo's own dist/nj.mjs/dist/nj-mcp.mjs exist yet, so every leg below
 * is red for one of those two reasons. The GPG setup checks are
 * independent of either and are expected to pass today, confirming the
 * suite's own machinery (not the product) works.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('../lib/harness.js');
const MCP = require('../lib/mcp-stdio.js');
const T = H.T;

const ROOT = path.resolve(__dirname, '..', '..');
const EXPORT_TS = path.join(ROOT, 'tools', 'export-skill.mts');
const REAL_DIST_NJ = path.join(ROOT, 'dist', 'nj.mjs');
const REAL_DIST_NJ_MCP = path.join(ROOT, 'dist', 'nj-mcp.mjs');
const REAL_SKILL_MD = path.join(ROOT, 'skill', 'SKILL.md');
const REAL_PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

/* ===================================================================== */
/* Throwaway GPG identity -- a fresh GNUPGHOME under /tmp with its own,  */
/* freshly generated key. Every git/gpg call below passes GNUPGHOME      */
/* explicitly; none ever reads the real ~/.gnupg or signs with the      */
/* project's own key.                                                    */
/* ===================================================================== */
let GNUPGHOME = null;
let FPR = null;
function setupGpg() {
  GNUPGHOME = H.freshDir('ac56-gnupghome');
  fs.chmodSync(GNUPGHOME, 0o700);
  const batch = path.join(GNUPGHOME, 'batch.txt');
  fs.writeFileSync(batch,
    '%no-protection\nKey-Type: eddsa\nKey-Curve: ed25519\n' +
    'Name-Real: NJ AC-56 Test\nName-Email: ac56@example.invalid\n' +
    'Expire-Date: 0\n%commit\n');
  const gen = spawnSync('gpg', ['--batch', '--gen-key', batch],
    { env: Object.assign({}, process.env, { GNUPGHOME }), encoding: 'utf8', timeout: 30000 });
  if (gen.status !== 0) { T.check('fixture: gpg --batch --gen-key (throwaway key)', false, gen.stderr); return; }
  const list = spawnSync('gpg', ['--batch', '--list-secret-keys', '--with-colons'],
    { env: Object.assign({}, process.env, { GNUPGHOME }), encoding: 'utf8', timeout: 15000 });
  const m = /^fpr:::::::::([0-9A-F]+):/m.exec(list.stdout || '');
  FPR = m ? m[1] : null;
  T.check('fixture: parsed a fingerprint for the throwaway key', !!FPR, list.stdout);
}
function gpgEnv() { return Object.assign({}, process.env, { GNUPGHOME }); }

/* ===================================================================== */
/* A scratch git repo shaped like this one just enough for              */
/* export-skill.mts to build from: real dist/nj + dist/nj-mcp (copied   */
/* from THIS repo's own committed bundles, so the exported binaries      */
/* genuinely run), the real skill/SKILL.md, and a package.json whose own */
/* version matches both.                                                 */
/* ===================================================================== */
function buildFixtureRepo(label) {
  const dir = H.freshDir(label);
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const gitSigned = (args) => spawnSync('git', args, { cwd: dir, env: gpgEnv(), encoding: 'utf8' });

  git(['init', '-q']);
  git(['config', 'user.email', 'ac56@example.invalid']);
  git(['config', 'user.name', 'NJ AC-56 Test']);
  git(['config', 'user.signingkey', FPR || '']);
  git(['config', 'gpg.program', 'gpg']);

  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skill'), { recursive: true });
  const haveBundles = fs.existsSync(REAL_DIST_NJ) && fs.existsSync(REAL_DIST_NJ_MCP);
  T.check('fixture: this repo\'s own dist/nj.mjs and dist/nj-mcp.mjs exist (ESM bundle not built yet)', haveBundles, 'REAL_DIST_NJ=' + REAL_DIST_NJ);
  if (haveBundles) {
    fs.copyFileSync(REAL_DIST_NJ, path.join(dir, 'dist', 'nj.mjs'));
    fs.copyFileSync(REAL_DIST_NJ_MCP, path.join(dir, 'dist', 'nj-mcp.mjs'));
    fs.chmodSync(path.join(dir, 'dist', 'nj.mjs'), 0o755);
    fs.chmodSync(path.join(dir, 'dist', 'nj-mcp.mjs'), 0o755);
  }
  fs.copyFileSync(REAL_SKILL_MD, path.join(dir, 'skill', 'SKILL.md'));
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: 'nanojira-fixture', version: REAL_PKG_VERSION }, null, 2) + '\n');

  git(['add', '-A']);
  const commit = gitSigned(['commit', '-q', '-m', 'fixture commit']);
  T.check('fixture: commit in the scratch repo', commit.status === 0, commit.stderr);
  return dir;
}
function signTag(repo, name) {
  const r = spawnSync('git', ['tag', '-s', name, '-m', 'fixture signed tag'], { cwd: repo, env: gpgEnv(), encoding: 'utf8' });
  T.check('fixture: signed tag ' + name, r.status === 0, r.stderr);
}
function unsignedTag(repo, name) {
  const r = spawnSync('git', ['tag', '-a', name, '-m', 'fixture unsigned tag'], { cwd: repo, env: gpgEnv(), encoding: 'utf8' });
  T.check('fixture: unsigned (annotated, not -s) tag ' + name, r.status === 0, r.stderr);
}

function runExport(args, cwd) {
  const r = spawnSync(process.execPath, [EXPORT_TS].concat(args),
    { cwd, env: gpgEnv(), encoding: 'utf8', timeout: 30000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function copyDir(src, dest) {
  const r = spawnSync('cp', ['-R', src, dest], { encoding: 'utf8' });
  if (r.status !== 0) T.check('fixture: cp -R ' + src + ' ' + dest, false, r.stderr);
}
function findSymlinks(dir) {
  const r = spawnSync('find', [dir, '-type', 'l'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(Boolean);
}
function runWrapper(binPath, args, opts) {
  const o = opts || {};
  const r = spawnSync('sh', [binPath].concat(args || []),
    { cwd: o.cwd, env: Object.assign({}, process.env, o.env || {}), encoding: 'utf8', timeout: 15000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function countStderrLines(s) { return (s || '').split('\n').filter(Boolean).length; }
/** Lists any symlinks under `dir` -- returns `null` (never throws) if
 * `dir` itself does not exist, e.g. because the export this leg depends
 * on never ran (not implemented yet): the caller reports that as its
 * own clear failure instead of an uncaught crash. */
function noSymlinksUnder(dir) {
  if (!fs.existsSync(dir)) return null;
  const bad = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) bad.push(p);
      else if (st.isDirectory()) walk(p);
    }
  })(dir);
  return bad;
}

/* ===================================================================== */
/* W0 -- skill/SKILL.md's own metadata.version equals package.json's     */
/* version, checked directly against the committed source (independent   */
/* of any export -- this is a static consistency check, not a product     */
/* behaviour, so it can and does run even before export-skill.mts exists) */
/* ===================================================================== */
{
  const skillMd = fs.readFileSync(REAL_SKILL_MD, 'utf8');
  const m = /^metadata:\s*\n\s*version:\s*"([^"]+)"/m.exec(skillMd);
  T.check('W0 skill/SKILL.md has a metadata.version field', !!m, skillMd.slice(0, 200));
  if (m) {
    T.eq('W0 skill/SKILL.md metadata.version equals package.json\'s version', m[1], REAL_PKG_VERSION);
  }
}

setupGpg();
const REPO = buildFixtureRepo('ac56-repo');
const GOOD_TAG = 'v-ac56-signed';
const UNSIGNED_TAG = 'v-ac56-unsigned';
const BAD_TAG = 'v-ac56-does-not-exist';
signTag(REPO, GOOD_TAG);
unsignedTag(REPO, UNSIGNED_TAG);

/* ===================================================================== */
/* W1 -- a signed tag exports: the full file set, no symlinks, atomic    */
/* (used as the base export every other positive leg below reuses)      */
/* ===================================================================== */
const DEST = path.join(H.freshDir('ac56-dest-parent'), 'exported');
const w1 = runExport([GOOD_TAG, DEST], REPO);
T.check('W1 export exits 0', w1.status === 0, 'status=' + w1.status + ' stderr=' + J(w1.stderr));
T.check('W1 (optional) export-skill.mts stderr has no MODULE_TYPELESS_PACKAGE_JSON warning',
  !/MODULE_TYPELESS/.test(w1.stderr), J(w1.stderr));
for (const rel of ['SKILL.md', 'VERSION', 'bin/nj', 'bin/nj-mcp', 'bin/nj.cmd', 'bin/nj-mcp.cmd', 'dist/nj.mjs', 'dist/nj-mcp.mjs']) {
  T.check('W1 ' + rel + ' exists', fs.existsSync(path.join(DEST, rel)), DEST);
}
{
  const links = noSymlinksUnder(DEST);
  T.check('W1 no symlinks anywhere under the exported folder', links !== null && links.length === 0, links === null ? 'dest does not exist' : J(links));
}

/* ===================================================================== */
/* W2 -- works from another cwd, through the wrapper's absolute path     */
/* ===================================================================== */
{
  const otherCwd = H.freshDir('ac56-othercwd');
  const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { cwd: otherCwd });
  T.check('W2 nj --version from an unrelated cwd: exit 0', r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
  T.check('W2 reports the exported version', r.stdout.indexOf(REAL_PKG_VERSION) !== -1, r.stdout);
}

/* ===================================================================== */
/* W3 -- no symlinks anywhere: cp -R the exported folder elsewhere, run  */
/* from the copy, and confirm `find <dest> -type l` is empty both on     */
/* the original export and on the copy (D185 addendum: the wrapper does  */
/* not resolve symlinks at all; a consuming team vendors by copying the  */
/* whole folder, never by symlinking into one file inside it)           */
/* ===================================================================== */
{
  const copyParent = H.freshDir('ac56-copy');
  const copyDest = path.join(copyParent, 'exported-copy');
  copyDir(DEST, copyDest);
  const r = runWrapper(path.join(copyDest, 'bin', 'nj'), ['--version']);
  T.check('W3 nj --version from a cp -R copy of the exported folder: exit 0', r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
  T.check('W3 still reports the exported version', r.stdout.indexOf(REAL_PKG_VERSION) !== -1, r.stdout);
  T.check('W3 find <copy> -type l is empty', findSymlinks(copyDest).length === 0, J(findSymlinks(copyDest)));
  T.check('W3 find <original> -type l is also empty', findSymlinks(DEST).length === 0, J(findSymlinks(DEST)));
}

/* ===================================================================== */
/* W4 -- NJ_NODE picks a specific node binary                           */
/* ===================================================================== */
{
  const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { env: { NJ_NODE: process.execPath } });
  T.check('W4 NJ_NODE=<real node>: exit 0', r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
}

/* ===================================================================== */
/* W5 -- node missing: NJ_NODE names a binary that does not exist        */
/* ===================================================================== */
{
  const bogus = path.join(H.freshDir('ac56-no-node'), 'no-such-node-binary');
  const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { env: { NJ_NODE: bogus } });
  T.check('W5 NJ_NODE=<missing>: exit 127', r.status === 127, 'status=' + r.status + ' stdout=' + J(r.stdout) + ' stderr=' + J(r.stderr));
  T.check('W5 nothing on stdout', r.stdout === '', r.stdout);
  T.check('W5 exactly one line on stderr', countStderrLines(r.stderr) === 1, J(r.stderr));
  T.check('W5 stderr is the full § 18 wording, naming the actual NJ_NODE path looked for -- not just "node not found" (sh\'s own "No such file" also exits 127)',
    r.stderr === 'nj: node not found (looked for \'' + bogus + '\')\n', J(r.stderr));
}

/* ===================================================================== */
/* W6 -- node too old: a stub `node` that reports a version below 24,    */
/* via a plain-text `--version` response (§ 18: the wrapper's check is   */
/* a text parse of `node --version`, no JS evaluated inside the probe)   */
/* ===================================================================== */
{
  const stubDir = H.freshDir('ac56-old-node');
  const stub = path.join(stubDir, 'node');
  fs.writeFileSync(stub,
    '#!/bin/sh\ncase "$1" in\n  --version) echo "v10.2.0"; exit 0 ;;\n  *) exec "' + process.execPath + '" "$@" ;;\nesac\n');
  fs.chmodSync(stub, 0o755);
  const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { env: { NJ_NODE: stub } });
  T.check('W6 NJ_NODE=<node v10.2.0>: exit 127', r.status === 127, 'status=' + r.status + ' stdout=' + J(r.stdout) + ' stderr=' + J(r.stderr));
  T.check('W6 nothing on stdout', r.stdout === '', r.stdout);
  T.check('W6 exactly one line on stderr', countStderrLines(r.stderr) === 1, J(r.stderr));
  T.check('W6 stderr is prefixed nj: (or nj-mcp:), names "too old" AND the minimum version 24 -- not just exit 127 (sh\'s own "No such file" also exits 127)',
    /^(nj|nj-mcp): .*too old/.test(r.stderr) && /24/.test(r.stderr), J(r.stderr));
}

/* ===================================================================== */
/* W7 -- an ambient "type": "module" above the exported folder has no    */
/* effect: dist/*.mjs is unambiguous regardless                          */
/* ===================================================================== */
{
  const parent = H.freshDir('ac56-esm-parent');
  fs.writeFileSync(path.join(parent, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
  const destUnderEsm = path.join(parent, 'exported');
  const exp = runExport([GOOD_TAG, destUnderEsm], REPO);
  T.check('W7 fixture: export under an ESM-scoped parent succeeds', exp.status === 0, exp.stderr);
  const r = runWrapper(path.join(destUnderEsm, 'bin', 'nj'), ['--version'], { cwd: parent });
  T.check('W7 nj --version still works under "type": "module": exit 0', r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
}

/* ===================================================================== */
/* W10 -- an unsigned tag is refused                                      */
/* ===================================================================== */
{
  const dest = path.join(H.freshDir('ac56-dest-unsigned'), 'exported');
  const r = runExport([UNSIGNED_TAG, dest], REPO);
  T.check('W10 export of an unsigned tag: non-zero exit', r.status !== 0, 'status=' + r.status);
  T.check('W10 nothing written at dest', !fs.existsSync(dest), dest);
}

/* ===================================================================== */
/* W11 -- a bad (non-existent) tag is refused                            */
/* ===================================================================== */
{
  const dest = path.join(H.freshDir('ac56-dest-badtag'), 'exported');
  const r = runExport([BAD_TAG, dest], REPO);
  T.check('W11 export of a non-existent tag: non-zero exit', r.status !== 0, 'status=' + r.status);
  T.check('W11 nothing written at dest', !fs.existsSync(dest), dest);
}

/* ===================================================================== */
/* W12 -- a foreign <dest> (no VERSION file) is refused, untouched       */
/* ===================================================================== */
{
  const dest = path.join(H.freshDir('ac56-dest-foreign'), 'exported');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'not-ours.txt'), 'unrelated directory, no VERSION file\n');
  const before = fs.readFileSync(path.join(dest, 'not-ours.txt'), 'utf8');
  const r = runExport([GOOD_TAG, dest], REPO);
  T.check('W12 export into a foreign dest: non-zero exit', r.status !== 0, 'status=' + r.status);
  T.check('W12 the foreign file survives untouched', fs.existsSync(path.join(dest, 'not-ours.txt')) && fs.readFileSync(path.join(dest, 'not-ours.txt'), 'utf8') === before, dest);
  T.check('W12 export never wrote SKILL.md into the foreign dest', !fs.existsSync(path.join(dest, 'SKILL.md')), dest);
}

/* ===================================================================== */
/* W13 (optional, DECISIONS 185 addendum 9b3d0de) -- the exported bundle  */
/* imports only node:* built-ins, nothing from node_modules, enforced at */
/* build time per the addendum -- checked here by scanning the SHIPPED   */
/* bundle's own static import/require specifiers, a best-effort textual  */
/* scan (not a full parse), against the exported dist/*.mjs directly.    */
/* ===================================================================== */
{
  function nonNodeImports(file) {
    if (!fs.existsSync(file)) return null;
    const src = fs.readFileSync(file, 'utf8');
    const specifiers = new Set();
    const importRe = /\bimport\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
    const requireRe = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = importRe.exec(src))) specifiers.add(m[1]);
    while ((m = requireRe.exec(src))) specifiers.add(m[1]);
    return [...specifiers].filter(s => !s.startsWith('node:') && !s.startsWith('.') && !s.startsWith('/'));
  }
  const bad = nonNodeImports(path.join(DEST, 'dist', 'nj.mjs'));
  T.check('W13 (optional) dist/nj.mjs imports nothing but node:* built-ins', bad !== null && bad.length === 0, bad === null ? 'dist/nj.mjs does not exist' : J(bad));
  const badMcp = nonNodeImports(path.join(DEST, 'dist', 'nj-mcp.mjs'));
  T.check('W13 (optional) dist/nj-mcp.mjs imports nothing but node:* built-ins', badMcp !== null && badMcp.length === 0, badMcp === null ? 'dist/nj-mcp.mjs does not exist' : J(badMcp));
}

/* ===================================================================== */
/* W14 -- every shipped file comes from the TAG's own tree, never the     */
/* working tree, even after the working tree has moved past the tag:     */
/* tamper dist/nj.mjs, skill/SKILL.md and package.json's version in the   */
/* fixture repo, commit that tamper (HEAD now differs from GOOD_TAG),     */
/* then export GOOD_TAG again and confirm every file byte-identical to   */
/* `git show GOOD_TAG:<path>` -- not to any of the post-tag changes.      */
/* Compared as Buffers, not strings: a real byte-identity check, not a    */
/* text/encoding-tolerant one.                                            */
/* ===================================================================== */
{
  function showBuf(ref) {
    return spawnSync('git', ['show', ref], { cwd: REPO }).stdout;
  }
  const tagSkillMd = showBuf(GOOD_TAG + ':skill/SKILL.md');
  const tagDistNj = showBuf(GOOD_TAG + ':dist/nj.mjs');
  const tagPkgVersion = JSON.parse(showBuf(GOOD_TAG + ':package.json').toString('utf8')).version;

  fs.appendFileSync(path.join(REPO, 'dist', 'nj.mjs'), '\n// post-tag tamper, must never be exported\n');
  fs.appendFileSync(path.join(REPO, 'skill', 'SKILL.md'), '\npost-tag tamper, must never be exported\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  pkg.version = '9.9.9-posttag';
  fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  git(['add', '-A']);
  const commit = git(['commit', '-q', '-m', 'post-tag tamper -- must not leak into an export of ' + GOOD_TAG]);
  T.check('W14 fixture: a commit after the tag, moving HEAD past GOOD_TAG', commit.status === 0, commit.stderr);

  const dest = path.join(H.freshDir('ac56-dest-posttag'), 'exported');
  const r = runExport([GOOD_TAG, dest], REPO);
  T.check('W14 export of GOOD_TAG still exits 0 after the working tree moved past it', r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
  const gotSkillMd = fs.existsSync(path.join(dest, 'SKILL.md')) ? fs.readFileSync(path.join(dest, 'SKILL.md')) : null;
  T.check('W14 exported SKILL.md is byte-identical to the TAG\'s tree, not the tampered working tree',
    gotSkillMd !== null && gotSkillMd.equals(tagSkillMd), dest);
  const gotDistNj = fs.existsSync(path.join(dest, 'dist', 'nj.mjs')) ? fs.readFileSync(path.join(dest, 'dist', 'nj.mjs')) : null;
  T.check('W14 exported dist/nj.mjs is byte-identical to the TAG\'s tree, not the tampered working tree',
    gotDistNj !== null && gotDistNj.equals(tagDistNj), dest);
  const version = fs.existsSync(path.join(dest, 'VERSION')) ? fs.readFileSync(path.join(dest, 'VERSION'), 'utf8').trim() : null;
  T.check('W14 exported VERSION is the TAG\'s package.json version, not the tampered 9.9.9-posttag',
    version === tagPkgVersion, 'VERSION=' + J(version) + ' tag version=' + J(tagPkgVersion));
}

/* ===================================================================== */
/* W15 -- NODE_OPTIONS is unset before exec, for both bin/nj and          */
/* bin/nj-mcp: an inherited --require hook that would otherwise fire on  */
/* every node invocation must never run. Checked by actually writing a   */
/* marker file from the hook -- its absence is the only thing that       */
/* proves NODE_OPTIONS never reached node, not merely that the call       */
/* "worked" (which it would either way: requiring the hook does not      */
/* itself fail).                                                         */
/* ===================================================================== */
{
  const markerDir = H.freshDir('ac56-node-options');
  const marker = path.join(markerDir, 'marker');
  const hook = path.join(markerDir, 'hook.js');
  fs.writeFileSync(hook, 'require(\'fs\').writeFileSync(' + JSON.stringify(marker) + ', \'fired\\n\');\n');
  for (const bin of ['nj', 'nj-mcp']) {
    if (fs.existsSync(marker)) fs.rmSync(marker);
    const r = runWrapper(path.join(DEST, 'bin', bin), ['--version'], { env: { NODE_OPTIONS: '--require=' + hook } });
    T.check('W15 ' + bin + ' --version with NODE_OPTIONS=--require=<hook>: exit 0',
      r.status === 0, 'status=' + r.status + ' stderr=' + J(r.stderr));
    T.check('W15 ' + bin + ': the --require hook never fired (NODE_OPTIONS unset before exec)',
      !fs.existsSync(marker), marker);
  }
}

/* ===================================================================== */
/* W16 -- the version floor is exactly 24, not merely "double-digit": a   */
/* stub one minor below (23.9.0) is rejected exactly like W6's v10.2.0,  */
/* and a stub at exactly the floor (24.0.0) is accepted -- the earlier    */
/* W6 leg alone could not tell a "< 24" floor apart from a "< 10" one.    */
/* ===================================================================== */
{
  function stubNode(version) {
    const dir = H.freshDir('ac56-node-stub-' + version.replace(/[^0-9a-zA-Z]/g, '-'));
    const stub = path.join(dir, 'node');
    fs.writeFileSync(stub,
      '#!/bin/sh\ncase "$1" in\n  --version) echo "v' + version + '"; exit 0 ;;\n  *) exec "' + process.execPath + '" "$@" ;;\nesac\n');
    fs.chmodSync(stub, 0o755);
    return stub;
  }
  {
    const stub = stubNode('23.9.0');
    const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { env: { NJ_NODE: stub } });
    T.check('W16 NJ_NODE=<node v23.9.0>: exit 127 (the floor is exactly 24, one minor below is still too old)',
      r.status === 127, 'status=' + r.status + ' stdout=' + J(r.stdout) + ' stderr=' + J(r.stderr));
    T.check('W16 v23.9.0 stderr names "too old" and the minimum version 24',
      /^(nj|nj-mcp): .*too old/.test(r.stderr) && /24/.test(r.stderr), J(r.stderr));
  }
  {
    const stub = stubNode('24.0.0');
    const r = runWrapper(path.join(DEST, 'bin', 'nj'), ['--version'], { env: { NJ_NODE: stub } });
    T.check('W16 NJ_NODE=<node v24.0.0>: accepted, exit 0 (exactly at the floor, not "too old")',
      r.status === 0, 'status=' + r.status + ' stdout=' + J(r.stdout) + ' stderr=' + J(r.stderr));
    T.check('W16 v24.0.0 reports the exported version', r.stdout.indexOf(REAL_PKG_VERSION) !== -1, r.stdout);
  }
}

/* ===================================================================== */
/* W8 -- nj-mcp still finds its dist/nj.mjs sibling under this layout    */
/* (the D179 sibling-by-extension rule, exercised against the EXPORTED   */
/* dist/ folder directly, independent of the sh wrapper)                 */
/* ===================================================================== */
(async () => {
  const distNj = path.join(DEST, 'dist', 'nj.mjs');
  const distNjMcp = path.join(DEST, 'dist', 'nj-mcp.mjs');
  const haveBoth = fs.existsSync(distNj) && fs.existsSync(distNjMcp);

  if (!haveBoth) {
    T.check('W8 fixture: the exported dist/nj.mjs and dist/nj-mcp.mjs exist (export did not run)', false, 'DEST=' + DEST);
    T.check('W9 fixture: cannot check VERSION against an export that was never built', false, 'DEST=' + DEST);
  } else {
    const bl = path.join(H.freshDir('ac56-mcp-backlog'), 'backlog');
    const init = spawnSync(process.execPath, [distNj, 'init', '--backlog=' + bl], { encoding: 'utf8' });
    T.check('W8 fixture: nj init against the exported dist/nj.mjs', init.status === 0, init.stderr);

    const s = MCP.spawnServer(distNjMcp, ['--backlog=' + bl]);
    try {
      const r = await s.modernToolsCall('doctor', {});
      T.check('W8 nj-mcp (exported) tools/call doctor: no protocol error', !r.error, J(r.error));
      T.check('W8 nj-mcp (exported) tools/call doctor: got a result (spawned its dist/nj.mjs sibling)',
        !!(r.result), J(r));
    } finally {
      await s.close();
    }

    /* ===================================================================== */
    /* W9 -- VERSION equals the exported nj's own --version                  */
    /* ===================================================================== */
    const versionFile = fs.existsSync(path.join(DEST, 'VERSION')) ? fs.readFileSync(path.join(DEST, 'VERSION'), 'utf8').trim() : null;
    const vr = spawnSync(process.execPath, [distNj, '--version', '--json'], { encoding: 'utf8' });
    let vj = null; try { vj = JSON.parse(vr.stdout); } catch (e) { /* left null */ }
    T.check('W9 VERSION file equals the exported nj --version', !!vj && versionFile !== null && vj.version === versionFile, J(vj) + ' vs VERSION=' + J(versionFile));
    T.check('W9 VERSION also equals package.json\'s version', versionFile === REAL_PKG_VERSION, versionFile + ' vs ' + REAL_PKG_VERSION);
  }

  T.finish();
})();
