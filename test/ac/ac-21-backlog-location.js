'use strict';
/* AC-21 — Backlog location (spec v3).
 *
 * § 15 AC-21: "Each source works alone: `--backlog` (on every command,
 * including `init`), `NJ_BACKLOG`, a `.njrc` in the working directory and in
 * an ancestor (relative value against the `.njrc`'s own directory, `~/`
 * expanded). The order holds pairwise: flag over environment over search;
 * within the search the nearest directory wins and `.njrc` beats `backlog/`
 * in the same directory. A chosen source that holds no backlog exits 1 with
 * its own code and names the source — even when a lower source would have
 * found one. Every `.njrc` format violation exits 1 with `invalid_njrc` and
 * the line number; a `.njrc` without `backlog` lets the search continue.
 * Without any source `init` creates `./backlog`."
 *
 * § 4 "Backlog location", "`.njrc`", "`nj init`"; § 9 "Commands",
 * "Failure codes — spec-named paths".
 *
 * Every assertion below cites one of those passages. The clause → check map
 * is in the section headers (A1 … A9), mirrored in AC-MATRIX.md.
 *
 * "Holds a backlog" (§ 4) means `.nanojira/config.json` exists (since V3-4;
 * before it the v2 marker `.nanojira.json` decided — DECISIONS 88,
 * AMBIGUITIES 49). This suite never builds a backlog layout itself: every
 * backlog is made by `H.mkBacklog()` and moved into place, so "a backlog"
 * is whatever the harness builds.
 *
 * The prose prefix is the implementation's `Error: `; § 4's `nj: ` lines
 * illustrate the message, not the prefix (DECISIONS 88).
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

const NOW = H.FIXED_NOW;

function J(x) { return JSON.stringify(x === undefined ? null : x); }
function out(r) { return (r.stdout || '') + '\n' + (r.stderr || ''); }

/* A path compared by the folder it names: /var and /private/var are one
 * place on macOS. For a path that does not exist (the "points at nothing"
 * cases) the parent is canonicalised and the leaf compared by name. */
function canon(p) {
  try { return fs.realpathSync(p); } catch (e) { /* fall through */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch (e) { return path.resolve(p); }
}
function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && canon(a) === canon(b);
}

/* ---- fixtures -------------------------------------------------------- */

/* Home directory for every run. Pinned so no real ~/.njrc can leak in, and
 * so the `~/` expansion test controls what "home" means (§ 4 `.njrc`). */
const HOME = H.freshDir('ac21-home');

function epicFile(id, title, status) {
  return H.element({ id, type: 'epic', title, status: status || 'todo', created: NOW, updated: NOW },
    '# ' + title + '\n\n## Description\nSomething.\n');
}
function taskFile(id, title) {
  return H.element({ id, type: 'task', parent: 'EPIC-001', title, status: 'todo', created: NOW, updated: NOW },
    H.completeBody(title));
}

/**
 * A backlog at `target`, holding EPIC-001 and one marker task `markerId`.
 * The marker is what identifies WHICH backlog a command used. Built by the
 * harness (layout knowledge stays there) and renamed into place.
 */
function backlogAt(target, markerId, extra) {
  const files = { 'epics/EPIC-001.md': epicFile('EPIC-001', 'Home epic') };
  files['tasks/' + markerId + '.md'] = taskFile(markerId, 'Marker ' + markerId);
  const tombstones = ['EPIC-001', markerId];
  for (const [rel, body, id] of extra || []) { files[rel] = body; tombstones.push(id); }
  const tmp = H.mkBacklog({ label: 'ac21-src', files, tombstones });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(path.join(tmp, 'backlog'), target);
  return target;
}

function njrc(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, '.njrc');
  fs.writeFileSync(p, content);
  return p;
}

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

/* Every run: NJ_BACKLOG unset unless a test sets it, HOME pinned. */
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset = env.NJ_BACKLOG === undefined ? ['NJ_BACKLOG'] : [];
  return { cwd: o.cwd, env, unsetEnv: unset, input: o.input };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }

function ids(json) {
  return json && Array.isArray(json.entries) ? json.entries.map(e => e.id) : [];
}
/* The marker tasks a `list --json` result shows — the epics are shared
 * scaffolding, every backlog here has EPIC-001. */
function markers(json) { return ids(json).filter(id => /^TSK-/.test(id)).sort(); }

function reportsBacklog(json, target) {
  return !!json && samePath(json.backlog, target);
}

/**
 * Assert that `list` resolved to the backlog at `target` holding `markerId`.
 * Checks the entries (which backlog was read) and `backlog` in the read
 * shape (§ 9 JSON interface), so neither can be right by accident.
 */
function usesBacklog(desc, o, target, markerId, extraArgs) {
  const r = runJ(['list'].concat(extraArgs || []), o);
  T.exit(desc + ': exit 0', r, 0);
  T.eq(desc + ': reads the backlog holding ' + markerId, markers(r.json), [markerId]);
  T.check(desc + ': --json reports that backlog', reportsBacklog(r.json, target),
    'backlog = ' + J(r.json && r.json.backlog) + ', expected ' + J(target));
  return r;
}

/* § 4: "no backlog at /abs/path (from <source>)", behind the `Error: `
 * prefix (DECISIONS 88). */
const NO_BACKLOG_RE = /^Error: no backlog at (.+) \(from (.+)\)$/m;

/**
 * Assert a binding failure: exit 1, the source's own code in the JSON
 * failure shape (§ 9), and the § 4 prose on stderr naming the absolute path
 * and the source. `sourceIs` is a predicate over the "(from …)" part.
 */
function bindingFailure(desc, args, o, code, badPath, sourceIs, sourceDesc) {
  const r = run(args, o);
  T.exit(desc + ': exit 1', r, 1);
  const m = NO_BACKLOG_RE.exec(r.stderr || '');
  T.check(desc + ': stderr carries "Error: no backlog at <abs path> (from <source>)" (§ 4, DECISIONS 88)',
    !!m, 'stderr = ' + J(r.stderr) + ', stdout = ' + J(r.stdout));
  if (m) {
    T.check(desc + ': the named path is absolute', path.isAbsolute(m[1]), 'path = ' + J(m[1]));
    T.check(desc + ': the named path is the one the source gave', samePath(m[1], badPath),
      'path = ' + J(m[1]) + ', expected ' + J(badPath));
    T.check(desc + ': the error names the source (' + sourceDesc + ')', sourceIs(m[2]),
      'source = ' + J(m[2]));
  }
  const rj = runJ(args, o);
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.check(desc + ' --json: failure shape {ok:false, error} (§ 9)',
    !!rj.json && rj.json.ok === false && typeof rj.json.error === 'string',
    J(rj.json || rj.stdout).slice(0, 300));
  T.eq(desc + ' --json: error is ' + code, rj.json && rj.json.error, code);
  T.check(desc + ' --json: never a read shape with entries',
    !(rj.json && Array.isArray(rj.json.entries)), J(rj.json).slice(0, 300));
  T.check(desc + ' --json: the prose error still reaches stderr (§ 9)',
    NO_BACKLOG_RE.test(rj.stderr || ''), 'stderr = ' + J(rj.stderr));
  T.check(desc + ': the target is left as it was — never auto-created outside init (§ 4)',
    fs.existsSync(badPath) === existedBefore(badPath), 'exists now: ' + fs.existsSync(badPath));
  return r;
}
const _existed = new Map();
function remember(p) { _existed.set(p, fs.existsSync(p)); return p; }
function existedBefore(p) { return _existed.has(p) ? _existed.get(p) : true; }

const isFlag = s => s === '--backlog';
const isEnv = s => s === 'NJ_BACKLOG';
const isRc = rcPath => s => path.isAbsolute(s) && samePath(s, rcPath);

/* § 4: "invalid .njrc at <abs path>: line <n>: <reason>", behind the
 * `Error: ` prefix (DECISIONS 88). */
const INVALID_NJRC_RE = /^Error: invalid \.njrc at (.+): line (\d+): (.+)$/m;

function njrcFailure(desc, args, o, rcPath, line) {
  const r = run(args, o);
  T.exit(desc + ': exit 1', r, 1);
  const m = INVALID_NJRC_RE.exec(r.stderr || '');
  T.check(desc + ': stderr carries "Error: invalid .njrc at <abs path>: line <n>: <reason>" (§ 4, DECISIONS 88)',
    !!m, 'stderr = ' + J(r.stderr) + ', stdout = ' + J(r.stdout));
  if (m) {
    T.check(desc + ': the path is the absolute path of that .njrc',
      path.isAbsolute(m[1]) && samePath(m[1], rcPath), 'path = ' + J(m[1]) + ', expected ' + J(rcPath));
    T.eq(desc + ': the line number', m[2], String(line));
    T.check(desc + ': a reason is given', m[3].trim().length > 0, J(m[3]));
  }
  const rj = runJ(args, o);
  T.exit(desc + ' --json: exit 1', rj, 1);
  T.eq(desc + ' --json: error is invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
  T.check(desc + ' --json: ok is false', !!rj.json && rj.json.ok === false, J(rj.json || rj.stdout).slice(0, 300));
  return r;
}

/* ===================================================================== */
/* A1 — --backlog alone, on every command (§ 4 source 1, § 9)             */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-flag');
  const W = backlogAt(path.join(root, 'store', 'bl'), 'TSK-001',
    [['epics/EPIC-002.md', epicFile('EPIC-002', 'Finished epic', 'done'), 'EPIC-002']]);
  const cwd = mkdir(path.join(root, 'elsewhere'));   // no backlog anywhere up the tree
  const F = '--backlog=' + W;
  const o = { cwd };

  const bare = runJ([F], o);
  T.exit('A1 bare nj --backlog: exit 0', bare, 0);
  T.check('A1 bare nj --backlog: reports the flag backlog', reportsBacklog(bare.json, W), J(bare.json && bare.json.backlog));

  usesBacklog('A1 list --backlog', o, W, 'TSK-001', [F]);
  const lh = run(['list', F], o);
  T.exit('A1 list --backlog (human): exit 0', lh, 0);
  T.contains('A1 list --backlog (human) shows the marker', lh.stdout, 'TSK-001');

  const show = runJ(['show', '--id=TSK-001', F], o);
  T.exit('A1 show --backlog: exit 0', show, 0);
  T.eq('A1 show --backlog: shows the element', ids(show.json), ['TSK-001']);
  T.check('A1 show --backlog: reports the flag backlog', reportsBacklog(show.json, W), J(show.json && show.json.backlog));

  const tree = runJ(['tree', F], o);
  T.exit('A1 tree --backlog: exit 0', tree, 0);
  T.check('A1 tree --backlog: contains the marker', ids(tree.json).includes('TSK-001'), J(ids(tree.json)));
  T.check('A1 tree --backlog: reports the flag backlog', reportsBacklog(tree.json, W), J(tree.json && tree.json.backlog));

  const doc = runJ(['doctor', F], o);
  T.exit('A1 doctor --backlog on a clean backlog: exit 0', doc, 0);
  T.check('A1 doctor --backlog: reports the flag backlog', reportsBacklog(doc.json, W), J(doc.json && doc.json.backlog));

  const nw = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Via flag', F], o);
  T.exit('A1 new --backlog: exit 0', nw, 0);
  T.check('A1 new --backlog: accepted, not unknown_field (§ 9, DECISIONS 88)',
    !!nw.json && nw.json.error !== 'unknown_field', J(nw.json || nw.stdout).slice(0, 300));
  T.eq('A1 new --backlog: allocates the next id in that backlog', nw.json && nw.json.id, 'TSK-002');
  const afterNew = runJ(['show', '--id=TSK-002', F], o);
  T.exit('A1 new --backlog: the element is in the flag backlog', afterNew, 0);

  const st = runJ(['set', '--id=TSK-002', '--status=doing', F], o);
  T.exit('A1 set --backlog: exit 0', st, 0);
  T.check('A1 set --backlog: accepted, not unknown_field (§ 9, DECISIONS 88)',
    !!st.json && st.json.error !== 'unknown_field', J(st.json || st.stdout).slice(0, 300));
  const afterSet = runJ(['show', '--id=TSK-002', F], o);
  const setEntry = afterSet.json && Array.isArray(afterSet.json.entries) ? afterSet.json.entries[0] : null;
  T.eq('A1 set --backlog: the change is in the flag backlog', setEntry && setEntry.status, 'doing');

  const nt = runJ(['note', '--id=TSK-002', 'Noted via flag', F], o);
  T.exit('A1 note --backlog: exit 0', nt, 0);
  T.eq('A1 note --backlog: result names the element', nt.json && nt.json.id, 'TSK-002');

  const rm = runJ(['rm', '--id=TSK-002', F], o);
  T.exit('A1 rm --backlog: exit 0', rm, 0);
  const afterRm = runJ(['show', '--id=TSK-002', F], o);
  T.exit('A1 rm --backlog: the element is gone from the flag backlog', afterRm, 1);
  T.eq('A1 rm --backlog: show now says not_found', afterRm.json && afterRm.json.error, 'not_found');

  const ar = runJ(['archive', '--id=EPIC-002', F], o);
  T.exit('A1 archive --backlog: exit 0', ar, 0);
  const active = runJ(['list', F], o);
  const all = runJ(['list', '--all', F], o);
  T.exit('A1 list --backlog after archive: exit 0', active, 0);
  T.check('A1 archive --backlog: EPIC-002 left the active list',
    !ids(active.json).includes('EPIC-002'), J(ids(active.json)));
  T.check('A1 archive --backlog: EPIC-002 is still listed with --all',
    ids(all.json).includes('EPIC-002'), J(ids(all.json)));

  T.eq('A1 nothing was written in the working directory', H.lsOrEmpty(cwd), []);

  /* relative to the working directory (§ 4 source 1) */
  const sub = mkdir(path.join(root, 'store', 'deeper'));
  usesBacklog('A1 relative --backlog resolves against the working directory',
    { cwd: sub }, W, 'TSK-001', ['--backlog=../bl']);

  /* § 9: "--backlog without a value is missing_value" */
  const mv = runJ(['list', '--backlog'], o);
  T.exit('A1 --backlog without a value: exit 1', mv, 1);
  T.eq('A1 --backlog without a value: missing_value', mv.json && mv.json.error, 'missing_value');

  /* --backlog= with an empty value is missing_value too, never a fall-through
   * to the search (DECISIONS 89, AMBIGUITIES 53) */
  const withBl = mkdir(path.join(root, 'hasbl'));
  backlogAt(path.join(withBl, 'backlog'), 'TSK-009');
  const ev = runJ(['list', '--backlog='], { cwd: withBl });
  T.exit('A1 --backlog= (empty): exit 1', ev, 1);
  T.eq('A1 --backlog= (empty): missing_value, not the backlog/ beside it', ev.json && ev.json.error, 'missing_value');
}

/* ~/ is expanded only inside .njrc: --backlog and NJ_BACKLOG are literal
 * (DECISIONS 89, AMBIGUITIES 53). A backlog under HOME and one under a
 * literal "~" folder in the working directory tell the readings apart. */
{
  const cwd = H.freshDir('ac21-tilde');
  const literal = backlogAt(path.join(cwd, '~', 'tbl'), 'TSK-091');
  const homeTarget = backlogAt(path.join(HOME, 'tbl'), 'TSK-092');
  usesBacklog('A1 --backlog=~/… is literal, relative to the working directory', { cwd }, literal, 'TSK-091', ['--backlog=~/tbl']);
  usesBacklog('A2 NJ_BACKLOG=~/… is literal, relative to the working directory',
    { cwd, env: { NJ_BACKLOG: '~/tbl' } }, literal, 'TSK-091');
  fs.rmSync(homeTarget, { recursive: true, force: true });
}

/* § 9: "it appears in every command's list of known flags". Probed through
 * the unknown-field rejection, which lists the known flags (§ 9 Rules): every
 * "Known flags:" line names --backlog. `new` and `set` print "Known fields:"
 * instead — schema fields only, unchanged (DECISIONS 88); for them the
 * acceptance of --backlog is asserted in A1 above. The backlog comes from
 * NJ_BACKLOG, so --backlog itself is not on the command line. */
{
  const root = H.freshDir('ac21-known');
  const W = backlogAt(path.join(root, 'bl'), 'TSK-001');
  const cwd = mkdir(path.join(root, 'cwd'));
  const initTarget = path.join(root, 'not-yet');
  const cmds = [
    [[], W], [['init'], initTarget], [['note', '--id=TSK-001', 'x'], W], [['show', '--id=TSK-001'], W],
    [['list'], W], [['tree'], W], [['rm', '--id=TSK-001'], W], [['archive', '--id=EPIC-001'], W],
    [['doctor'], W],
  ];
  for (const [args, bl] of cmds) {
    const label = args[0] ? 'nj ' + args[0] : 'bare nj';
    const r = run(args.concat(['--bogusflag=1']), { cwd, env: { NJ_BACKLOG: bl } });
    T.exit('A1 ' + label + ' --bogusflag: rejected, exit 1', r, 1);
    const line = /^Known flags: (.*)$/m.exec(out(r));
    T.check('A1 ' + label + ': the rejection prints a "Known flags:" line', !!line, J(out(r)));
    T.check('A1 ' + label + ': --backlog is in its list of known flags (§ 9)',
      !!line && line[1].split(/,\s*/).includes('--backlog'), J(line && line[0]));
  }
  T.check('A1 the rejected init created nothing', !fs.existsSync(initTarget), 'created ' + initTarget);
}

/* ===================================================================== */
/* A2 — NJ_BACKLOG alone (§ 4 source 2)                                   */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-env');
  const B = backlogAt(path.join(root, 'envbl'), 'TSK-002');
  const cwd = mkdir(path.join(root, 'x', 'y'));
  usesBacklog('A2 NJ_BACKLOG (absolute) alone', { cwd, env: { NJ_BACKLOG: B } }, B, 'TSK-002');
  usesBacklog('A2 NJ_BACKLOG relative resolves against the working directory',
    { cwd, env: { NJ_BACKLOG: '../../envbl' } }, B, 'TSK-002');
  const nw = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Via env'], { cwd, env: { NJ_BACKLOG: B } });
  T.exit('A2 new with NJ_BACKLOG: exit 0', nw, 0);
  usesBacklogIds('A2 new with NJ_BACKLOG wrote into that backlog', { cwd, env: { NJ_BACKLOG: B } }, ['TSK-002', 'TSK-003']);

  /* NJ_BACKLOG= (empty) counts as unset: the search runs (DECISIONS 89,
   * AMBIGUITIES 53) */
  const S = backlogAt(path.join(root, 'searched', 'backlog'), 'TSK-093');
  usesBacklog('A2 empty NJ_BACKLOG counts as unset: the search finds backlog/',
    { cwd: mkdir(path.join(root, 'searched', 'sub')), env: { NJ_BACKLOG: '' } }, S, 'TSK-093');
  const lone = H.freshDir('ac21-env-empty');
  const r = runJ(['list'], { cwd: lone, env: { NJ_BACKLOG: '' } });
  T.exit('A2 empty NJ_BACKLOG and nothing to find: exit 1', r, 1);
  T.eq('A2 empty NJ_BACKLOG and nothing to find: no_backlog, not invalid_backlog_env', r.json && r.json.error, 'no_backlog');
}

function usesBacklogIds(desc, o, expected) {
  const r = runJ(['list'], o);
  T.exit(desc + ': exit 0', r, 0);
  T.eq(desc, markers(r.json), expected);
}

/* ===================================================================== */
/* A3 — .njrc alone: in the working directory, in an ancestor, relative   */
/*      value against the .njrc's own directory, ~/ expanded (§ 4)        */
/* ===================================================================== */

{
  /* .njrc in the working directory, the § 4 example's `../` shape */
  const root = H.freshDir('ac21-rc-cwd');
  const S = backlogAt(path.join(root, 'shared', 'backlog'), 'TSK-003');
  const proj = mkdir(path.join(root, 'proj'));
  njrc(proj, '# NanoJira — where this project\'s backlog lives\nbacklog = ../shared/backlog\n');
  usesBacklog('A3 .njrc in the working directory', { cwd: proj }, S, 'TSK-003');
  T.check('A3 .njrc in cwd: no ./backlog was created', !fs.existsSync(path.join(proj, 'backlog')), '');

  const nw = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=Via njrc'], { cwd: proj });
  T.exit('A3 new through .njrc: exit 0', nw, 0);
  usesBacklogIds('A3 new through .njrc wrote into the .njrc backlog', { cwd: proj }, ['TSK-003', 'TSK-004']);
}

{
  /* .njrc in an ancestor; relative value resolves against the .njrc's dir,
   * not the working directory — a decoy sits where a cwd-relative reading
   * would land. */
  const root = H.freshDir('ac21-rc-anc');
  const S = backlogAt(path.join(root, 'shared', 'bl'), 'TSK-004');
  njrc(root, 'backlog = shared/bl\n');
  const cwd = mkdir(path.join(root, 'a', 'b'));
  backlogAt(path.join(cwd, 'shared', 'bl'), 'TSK-099');   // decoy: cwd-relative reading
  usesBacklog('A3 .njrc in an ancestor, relative value against the .njrc\'s own directory',
    { cwd }, S, 'TSK-004');

  /* an absolute value works too */
  const root2 = H.freshDir('ac21-rc-abs');
  const A = backlogAt(path.join(root2, 'abs', 'bl'), 'TSK-005');
  const c2 = mkdir(path.join(root2, 'p', 'q'));
  njrc(path.join(root2, 'p'), 'backlog = ' + A + '\n');
  usesBacklog('A3 .njrc with an absolute value', { cwd: c2 }, A, 'TSK-005');
}

{
  /* ~/ expands to the user's home directory (HOME pinned for every run). A
   * decoy sits at a literal "~" folder next to the .njrc. */
  const root = H.freshDir('ac21-rc-home');
  const target = path.join(HOME, 'homebl');
  backlogAt(target, 'TSK-006');
  backlogAt(path.join(root, '~', 'homebl'), 'TSK-098');   // decoy: no expansion
  njrc(root, 'backlog = ~/homebl\n');
  usesBacklog('A3 .njrc value with leading ~/ expands to the home directory', { cwd: root }, target, 'TSK-006');
  fs.rmSync(target, { recursive: true, force: true });
}

{
  /* The value is literal: quotes are part of the path (§ 4 "no quotes"). */
  const root = H.freshDir('ac21-rc-lit');
  const Q = backlogAt(path.join(root, '"qbl"'), 'TSK-007');
  backlogAt(path.join(root, 'qbl'), 'TSK-097');           // decoy: quotes stripped
  njrc(root, 'backlog = "qbl"\n');
  usesBacklog('A3 .njrc value is literal — quotes are not stripped', { cwd: root }, Q, 'TSK-007');
}

{
  /* Whitespace around '=' and at both line ends is ignored; empty lines,
   * whitespace-only lines and lines whose first non-blank is '#' are ignored. */
  const root = H.freshDir('ac21-rc-ws');
  const S = backlogAt(path.join(root, 'wsbl'), 'TSK-008');
  njrc(root, '\n   # indented comment\n   \n\t  backlog \t=\t  wsbl  \t\n\n# trailing comment\n');
  usesBacklog('A3 .njrc whitespace, blank and comment lines are ignored', { cwd: root }, S, 'TSK-008');
}

{
  /* ~/.njrc is not a source: the search runs from the working directory up,
   * and HOME is not on that path here (§ 4 source 3; DECISIONS 86). */
  const root = H.freshDir('ac21-home-rc');
  const homeBl = backlogAt(path.join(HOME, 'onlyhome'), 'TSK-096');
  const rcPath = njrc(HOME, 'backlog = onlyhome\n');
  const r = runJ(['list'], { cwd: root });
  T.exit('A3 a ~/.njrc outside the search path is not read: exit 1', r, 1);
  T.eq('A3 a ~/.njrc outside the search path is not read: no_backlog', r.json && r.json.error, 'no_backlog');
  fs.rmSync(rcPath);
  fs.rmSync(homeBl, { recursive: true, force: true });
}

/* ===================================================================== */
/* A4 — pairwise order: flag > env > search (§ 4 "the first … set")       */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-order');
  const A = backlogAt(path.join(root, 'flagbl'), 'TSK-011');
  const B = backlogAt(path.join(root, 'envbl'), 'TSK-012');
  const D = backlogAt(path.join(root, 'rcbl'), 'TSK-014');
  const cwdBl = mkdir(path.join(root, 'withbacklog'));
  backlogAt(path.join(cwdBl, 'backlog'), 'TSK-013');
  const cwdRc = mkdir(path.join(root, 'withrc'));
  njrc(cwdRc, 'backlog = ../rcbl\n');

  usesBacklog('A4 flag over environment', { cwd: cwdBl, env: { NJ_BACKLOG: B } }, A, 'TSK-011', ['--backlog=' + A]);
  usesBacklog('A4 flag over search (backlog/ in cwd)', { cwd: cwdBl }, A, 'TSK-011', ['--backlog=' + A]);
  usesBacklog('A4 flag over search (.njrc in cwd)', { cwd: cwdRc }, A, 'TSK-011', ['--backlog=' + A]);
  usesBacklog('A4 environment over search (backlog/ in cwd)', { cwd: cwdBl, env: { NJ_BACKLOG: B } }, B, 'TSK-012');
  usesBacklog('A4 environment over search (.njrc in cwd)', { cwd: cwdRc, env: { NJ_BACKLOG: B } }, B, 'TSK-012');
  usesBacklog('A4 flag over environment over .njrc', { cwd: cwdRc, env: { NJ_BACKLOG: B } }, A, 'TSK-011', ['--backlog=' + A]);
}

/* ===================================================================== */
/* A5 — within the search: nearest directory wins; .njrc beats backlog/   */
/*      in the same directory (§ 4 source 3)                              */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-near');
  const R = backlogAt(path.join(root, 'rcbl'), 'TSK-021');
  const G = backlogAt(path.join(root, 'rcbl2'), 'TSK-022');

  /* repository-root .njrc vs a project's own deeper backlog/ */
  const t1 = mkdir(path.join(root, 't1'));
  njrc(t1, 'backlog = ../rcbl\n');
  const E = backlogAt(path.join(t1, 'proj', 'backlog'), 'TSK-023');
  usesBacklog('A5 a nearer backlog/ beats a .njrc further up', { cwd: mkdir(path.join(t1, 'proj', 'src')) }, E, 'TSK-023');

  /* nearer .njrc vs a backlog/ further up */
  const t2 = mkdir(path.join(root, 't2'));
  backlogAt(path.join(t2, 'backlog'), 'TSK-024');
  njrc(path.join(t2, 'proj'), 'backlog = ../../rcbl\n');
  usesBacklog('A5 a nearer .njrc beats a backlog/ further up', { cwd: mkdir(path.join(t2, 'proj', 'src')) }, R, 'TSK-021');

  /* two .njrc: the nearer one wins */
  const t3 = mkdir(path.join(root, 't3'));
  njrc(t3, 'backlog = ../rcbl\n');
  njrc(path.join(t3, 'proj'), 'backlog = ../../rcbl2\n');
  usesBacklog('A5 the nearer of two .njrc wins', { cwd: mkdir(path.join(t3, 'proj', 'src')) }, G, 'TSK-022');

  /* two backlog/: the nearer one wins */
  const t4 = mkdir(path.join(root, 't4'));
  backlogAt(path.join(t4, 'backlog'), 'TSK-025');
  const N4 = backlogAt(path.join(t4, 'proj', 'backlog'), 'TSK-026');
  usesBacklog('A5 the nearer of two backlog/ wins', { cwd: mkdir(path.join(t4, 'proj', 'src')) }, N4, 'TSK-026');

  /* nearest wins strictly: a config-less backlog/ reached first ends the
   * search with backlog_without_config — never a climb to the valid backlog
   * (or .njrc) further up (§ 4, DECISIONS 88) */
  for (const [what, setup] of [
    ['a valid backlog/ further up', d => backlogAt(path.join(d, 'backlog'), 'TSK-028')],
    ['a .njrc further up', d => njrc(d, 'backlog = ../rcbl\n')],
  ]) {
    const t6 = mkdir(path.join(root, 't6-' + what.replace(/\W+/g, '')));
    setup(t6);
    mkdir(path.join(t6, 'proj', 'backlog'));      // config-less, nearer
    const r = runJ(['list'], { cwd: mkdir(path.join(t6, 'proj', 'src')) });
    T.exit('A5 a nearer config-less backlog/ over ' + what + ': exit 1', r, 1);
    T.eq('A5 a nearer config-less backlog/ over ' + what + ': backlog_without_config',
      r.json && r.json.error, 'backlog_without_config');
  }

  /* same directory: .njrc beats backlog/ — in the cwd and in an ancestor */
  const t5 = mkdir(path.join(root, 't5'));
  backlogAt(path.join(t5, 'backlog'), 'TSK-027');
  njrc(t5, 'backlog = ../rcbl\n');
  usesBacklog('A5 .njrc beats backlog/ in the working directory', { cwd: t5 }, R, 'TSK-021');
  usesBacklog('A5 .njrc beats backlog/ in the same ancestor directory', { cwd: mkdir(path.join(t5, 'deep', 'er')) }, R, 'TSK-021');
}

/* ===================================================================== */
/* A6 — a chosen source that holds no backlog is binding: exit 1, its own */
/*      code, names path and source, even when a lower source would have  */
/*      found one (§ 4 "A chosen source is binding", § 9 table)           */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-bind');
  const B = backlogAt(path.join(root, 'envbl'), 'TSK-031');
  const cwd = mkdir(path.join(root, 'proj'));
  const C = backlogAt(path.join(cwd, 'backlog'), 'TSK-032');   // what the search would find
  const cBefore = H.lsOrEmpty(path.join(C, 'tasks')).join(',');

  const missing = remember(path.join(root, 'nothing-here'));
  bindingFailure('A6 --backlog at a missing path (env and search would succeed)',
    ['list', '--backlog=' + missing], { cwd, env: { NJ_BACKLOG: B } },
    'invalid_backlog_flag', missing, isFlag, '--backlog');

  const empty = remember(mkdir(path.join(root, 'empty-dir')));
  bindingFailure('A6 --backlog at an existing empty directory',
    ['list', '--backlog=' + empty], { cwd },
    'invalid_backlog_flag', empty, isFlag, '--backlog');

  /* The flag names the backlog folder itself; a project dir that merely
   * contains backlog/ does not hold one ("holds a backlog", § 4). */
  remember(cwd);
  bindingFailure('A6 --backlog at a project directory that contains backlog/',
    ['list', '--backlog=' + cwd], { cwd: root },
    'invalid_backlog_flag', cwd, isFlag, '--backlog');

  /* a target that is not a directory (DECISIONS 88) */
  const aFile = path.join(root, 'plain-file');
  fs.writeFileSync(aFile, 'not a backlog\n');
  remember(aFile);
  bindingFailure('A6 --backlog at a regular file',
    ['list', '--backlog=' + aFile], { cwd },
    'invalid_backlog_flag', aFile, isFlag, '--backlog');
  bindingFailure('A6 NJ_BACKLOG at a regular file',
    ['list'], { cwd, env: { NJ_BACKLOG: aFile } },
    'invalid_backlog_env', aFile, isEnv, 'NJ_BACKLOG');

  const relMissing = remember(path.join(cwd, 'rel-missing'));
  bindingFailure('A6 relative --backlog at nothing names the absolute path',
    ['list', '--backlog=rel-missing'], { cwd },
    'invalid_backlog_flag', relMissing, isFlag, '--backlog');

  /* a write: nothing written to the backlog the search would have found */
  bindingFailure('A6 new --backlog at nothing',
    ['new', '--type=task', '--parent=EPIC-001', '--title=Lost', '--backlog=' + missing], { cwd },
    'invalid_backlog_flag', missing, isFlag, '--backlog');
  T.eq('A6 new --backlog at nothing wrote nothing into the fallback backlog',
    H.lsOrEmpty(path.join(C, 'tasks')).join(','), cBefore);

  /* NJ_BACKLOG: search (backlog/ and .njrc) would succeed */
  const rcCwd = mkdir(path.join(root, 'rcproj'));
  njrc(rcCwd, 'backlog = ../envbl\n');
  backlogAt(path.join(rcCwd, 'backlog'), 'TSK-033');
  bindingFailure('A6 NJ_BACKLOG at a missing path (.njrc and backlog/ in cwd would succeed)',
    ['list'], { cwd: rcCwd, env: { NJ_BACKLOG: missing } },
    'invalid_backlog_env', missing, isEnv, 'NJ_BACKLOG');
  bindingFailure('A6 NJ_BACKLOG at an existing empty directory',
    ['list'], { cwd, env: { NJ_BACKLOG: empty } },
    'invalid_backlog_env', empty, isEnv, 'NJ_BACKLOG');
  bindingFailure('A6 relative NJ_BACKLOG at nothing names the absolute path',
    ['list'], { cwd, env: { NJ_BACKLOG: 'rel-missing' } },
    'invalid_backlog_env', relMissing, isEnv, 'NJ_BACKLOG');

  /* .njrc in cwd pointing at nothing; backlog/ in the same dir and one
   * further up would both succeed */
  const t = mkdir(path.join(root, 'rcbad'));
  backlogAt(path.join(t, 'backlog'), 'TSK-034');
  const inner = mkdir(path.join(t, 'inner'));
  backlogAt(path.join(inner, 'backlog'), 'TSK-035');
  const rcMissing = remember(path.join(inner, 'gone'));
  const rc1 = njrc(inner, 'backlog = gone\n');
  bindingFailure('A6 .njrc in cwd at nothing (backlog/ beside it and above would succeed)',
    ['list'], { cwd: inner },
    'invalid_backlog_njrc', rcMissing, isRc(rc1), 'the .njrc\'s absolute path');

  /* .njrc in an ancestor pointing at nothing; a backlog/ further up */
  const t2 = mkdir(path.join(root, 'rcbad2'));
  backlogAt(path.join(t2, 'backlog'), 'TSK-036');
  const mid = mkdir(path.join(t2, 'mid'));
  const rc2 = njrc(mid, 'backlog = ../nowhere\n');
  const rc2Missing = remember(path.join(t2, 'nowhere'));
  bindingFailure('A6 .njrc in an ancestor at nothing (a backlog/ further up would succeed)',
    ['list'], { cwd: mkdir(path.join(mid, 'a', 'b')) },
    'invalid_backlog_njrc', rc2Missing, isRc(rc2), 'the .njrc\'s absolute path');

  /* .njrc at a regular file (DECISIONS 88) */
  const t4 = mkdir(path.join(root, 'rcbad4'));
  const rcFile = path.join(t4, 'afile');
  fs.writeFileSync(rcFile, 'not a backlog\n');
  remember(rcFile);
  const rc4 = njrc(t4, 'backlog = afile\n');
  bindingFailure('A6 .njrc at a regular file',
    ['list'], { cwd: t4 },
    'invalid_backlog_njrc', rcFile, isRc(rc4), 'the .njrc\'s absolute path');

  /* .njrc at an existing empty directory */
  const t3 = mkdir(path.join(root, 'rcbad3'));
  const emptyTarget = remember(mkdir(path.join(t3, 'hollow')));
  const rc3 = njrc(t3, 'backlog = hollow\n');
  bindingFailure('A6 .njrc at an existing empty directory',
    ['list'], { cwd: t3 },
    'invalid_backlog_njrc', emptyTarget, isRc(rc3), 'the .njrc\'s absolute path');
}

/* ===================================================================== */
/* A7 — every .njrc format violation: exit 1, invalid_njrc, line number   */
/*      (§ 4 `.njrc`: unknown key, line without '=', empty value,         */
/*      repeated key); only a reached .njrc is parsed                     */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-rcfmt');
  const ok = backlogAt(path.join(root, 'okbl'), 'TSK-041');
  const cases = [
    ['unknown key', 'backlog = ../okbl\n# comment\n\ncolour = blue\n', 4],
    ['unknown key alone (not "a .njrc without backlog")', '# only this\nfoo = 1\n', 2],
    ['line without "="', '# comment\nbacklog ../okbl\n', 2],
    ['empty value', '\n# comment\nbacklog =   \n', 3],
    /* The line of a repeated key is the line of the repetition
     * (DECISIONS 89, AMBIGUITIES 50). */
    ['repeated key', 'backlog = ../okbl\n# again\nbacklog = ../okbl\n', 3],
    /* An empty key is an unknown key (DECISIONS 89, AMBIGUITIES 51). */
    ['empty key', '# c\n = ../okbl\n', 2],
  ];
  let i = 0;
  for (const [what, content, line] of cases) {
    const dir = mkdir(path.join(root, 'c' + (i++)));
    /* a backlog/ beside it and one above: falling through would succeed */
    backlogAt(path.join(dir, 'backlog'), 'TSK-042');
    const rc = njrc(dir, content);
    njrcFailure('A7 .njrc ' + what + ' (in cwd)', ['list'], { cwd: dir }, rc, line);
  }

  /* in an ancestor, reached by the search */
  const anc = mkdir(path.join(root, 'anc'));
  backlogAt(path.join(anc, 'backlog'), 'TSK-043');
  const rcA = njrc(anc, 'backlog = ../okbl\nbogus = 1\n');
  njrcFailure('A7 .njrc unknown key in an ancestor', ['list'], { cwd: mkdir(path.join(anc, 'x', 'y')) }, rcA, 2);

  /* a write command and init are covered by the same rule */
  njrcFailure('A7 .njrc violation on a write (new)',
    ['new', '--type=task', '--parent=EPIC-001', '--title=X'], { cwd: mkdir(path.join(anc, 'w')) }, rcA, 2);
  const initDir = mkdir(path.join(root, 'initbad'));
  const rcI = njrc(initDir, 'backlog\n');
  njrcFailure('A7 .njrc violation on init', ['init'], { cwd: initDir }, rcI, 1);
  T.eq('A7 init with an invalid .njrc created nothing', H.lsOrEmpty(initDir), ['.njrc']);

  /* only a .njrc the search reaches is parsed */
  const flagged = mkdir(path.join(root, 'flagged'));
  njrc(flagged, 'nonsense line\n');
  usesBacklog('A7 --backlog stops the search: a malformed .njrc in cwd is never read',
    { cwd: flagged }, ok, 'TSK-041', ['--backlog=' + ok]);
  usesBacklog('A7 NJ_BACKLOG stops the search: a malformed .njrc in cwd is never read',
    { cwd: flagged, env: { NJ_BACKLOG: ok } }, ok, 'TSK-041');
  const stopped = mkdir(path.join(root, 'stopped'));
  njrc(stopped, 'nonsense line\n');
  const near = backlogAt(path.join(stopped, 'proj', 'backlog'), 'TSK-044');
  usesBacklog('A7 a nearer backlog/ stops the search: a malformed .njrc further up is never read',
    { cwd: mkdir(path.join(stopped, 'proj', 'src')) }, near, 'TSK-044');
}

/* ===================================================================== */
/* A7b — .njrc lexing and odd files, as § 4 pins them (DECISIONS 90)      */
/* ===================================================================== */

/* § 4: a .njrc that is not a readable regular file: "invalid .njrc at <abs
 * path>: <reason>", no line number (prefix per DECISIONS 88). */
const NJRC_FILE_RE = /^Error: invalid \.njrc at (.+?): (.+)$/m;

function njrcFileFailure(desc, o, rcPath) {
  const r = run(['list'], o);
  T.exit(desc + ': exit 1', r, 1);
  const m = NJRC_FILE_RE.exec(r.stderr || '');
  T.check(desc + ': stderr carries "Error: invalid .njrc at <abs path>: <reason>" (§ 4)', !!m, 'stderr = ' + J(r.stderr));
  if (m) {
    T.check(desc + ': the path is the absolute path of that .njrc',
      path.isAbsolute(m[1]) && canon(path.dirname(m[1])) === canon(path.dirname(rcPath)) && path.basename(m[1]) === '.njrc',
      'path = ' + J(m[1]));
    T.check(desc + ': no line number', !/^line \d+:/.test(m[2]), J(m[2]));
  }
  const rj = runJ(['list'], o);
  T.eq(desc + ' --json: invalid_njrc', rj.json && rj.json.error, 'invalid_njrc');
}

{
  const root = H.freshDir('ac21-lex');
  let n = 0;
  const lex = (what, content, dirName, markerId, decoy) => {
    const d = mkdir(path.join(root, 'l' + (n++)));
    const target = backlogAt(path.join(d, dirName), markerId);
    if (decoy) backlogAt(path.join(d, decoy), 'TSK-095');
    njrc(d, content);
    usesBacklog('A7b ' + what, { cwd: d }, target, markerId);
  };
  lex('a UTF-8 BOM at the start is dropped', '\uFEFFbacklog = bombl\n', 'bombl', 'TSK-071');
  lex('CRLF line ends work', '# c\r\nbacklog = crlfbl\r\n', 'crlfbl', 'TSK-072', 'crlfbl\r');
  lex('a line splits at its first "=" — the value may contain "="', 'backlog = a=b\n', 'a=b', 'TSK-073', 'a');
  lex('an inline "#" is part of the value', 'backlog = bl #note\n', 'bl #note', 'TSK-074', 'bl');

  const cs = mkdir(path.join(root, 'case'));
  backlogAt(path.join(cs, 'backlog'), 'TSK-075');
  const rcCase = njrc(cs, 'Backlog = backlog\n');
  njrcFailure('A7b keys are case-sensitive: Backlog is an unknown key', ['list'], { cwd: cs }, rcCase, 1);

  /* not a readable regular file */
  const asDir = mkdir(path.join(root, 'asdir'));
  backlogAt(path.join(asDir, 'backlog'), 'TSK-076');
  mkdir(path.join(asDir, '.njrc'));
  njrcFileFailure('A7b a .njrc that is a directory', { cwd: asDir }, path.join(asDir, '.njrc'));

  const dang = mkdir(path.join(root, 'dangling'));
  backlogAt(path.join(dang, 'backlog'), 'TSK-077');
  fs.symlinkSync(path.join(root, 'no-such-file'), path.join(dang, '.njrc'));
  njrcFileFailure('A7b a .njrc that is a dangling symlink', { cwd: dang }, path.join(dang, '.njrc'));

  const unread = mkdir(path.join(root, 'unreadable'));
  backlogAt(path.join(unread, 'backlog'), 'TSK-078');
  const rcU = njrc(unread, 'backlog = backlog\n');
  fs.chmodSync(rcU, 0o000);
  let readable = true;
  try { fs.readFileSync(rcU); } catch (e) { readable = false; }
  if (readable) {
    T.check('A7b a .njrc without read permission: not covered — this process can read mode 000 (root?)', false, rcU);
  } else {
    njrcFileFailure('A7b a .njrc without read permission', { cwd: unread }, rcU);
  }
  fs.chmodSync(rcU, 0o644);

  /* a symlinked .njrc resolves against the directory where the link lies */
  const real = mkdir(path.join(root, 'realdir'));
  fs.writeFileSync(path.join(real, 'shared.njrc'), 'backlog = bl\n');
  backlogAt(path.join(real, 'bl'), 'TSK-094');                       // decoy: the target's directory
  const linkDir = mkdir(path.join(root, 'linkdir'));
  const viaLink = backlogAt(path.join(linkDir, 'bl'), 'TSK-079');
  fs.symlinkSync(path.join(real, 'shared.njrc'), path.join(linkDir, '.njrc'));
  usesBacklog('A7b a symlinked .njrc resolves against the link\'s directory', { cwd: linkDir }, viaLink, 'TSK-079');

  /* ~/.njrc is an ordinary ancestor: read when HOME is on the search path */
  const inHome = mkdir(path.join(HOME, 'proj', 'src'));
  const homeBl = backlogAt(path.join(HOME, 'homeonly'), 'TSK-080');
  const homeRc = njrc(HOME, 'backlog = homeonly\n');
  usesBacklog('A7b ~/.njrc is read like any ancestor when HOME is on the search path', { cwd: inHome }, homeBl, 'TSK-080');
  fs.rmSync(homeRc);
  fs.rmSync(homeBl, { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'proj'), { recursive: true, force: true });
}

/* ===================================================================== */
/* A8 — a .njrc without `backlog` lets the search continue (§ 4 `.njrc`)  */
/* ===================================================================== */

{
  const root = H.freshDir('ac21-rcnone');
  const up = backlogAt(path.join(root, 'backlog'), 'TSK-051');
  const mid = mkdir(path.join(root, 'mid'));
  njrc(mid, '# nothing set here\n\n   # still nothing\n');
  usesBacklog('A8 comment-only .njrc: the search continues upward', { cwd: mkdir(path.join(mid, 'x')) }, up, 'TSK-051');
  usesBacklog('A8 comment-only .njrc in cwd: the search continues upward', { cwd: mid }, up, 'TSK-051');

  const mid2 = mkdir(path.join(root, 'mid2'));
  njrc(mid2, '');
  usesBacklog('A8 empty .njrc: the search continues upward', { cwd: mid2 }, up, 'TSK-051');

  /* same directory: a .njrc without backlog does not shadow backlog/ */
  const same = mkdir(path.join(root, 'same'));
  const S = backlogAt(path.join(same, 'backlog'), 'TSK-052');
  njrc(same, '# no location\n');
  usesBacklog('A8 .njrc without backlog beside backlog/: backlog/ is used', { cwd: same }, S, 'TSK-052');

  /* nothing at all above a backlog-less .njrc: no_backlog */
  const lone = H.freshDir('ac21-rclone');
  njrc(lone, '# nothing\n');
  const r = runJ(['list'], { cwd: lone });
  T.exit('A8 a backlog-less .njrc and nothing else: exit 1', r, 1);
  T.eq('A8 a backlog-less .njrc and nothing else: no_backlog', r.json && r.json.error, 'no_backlog');
}

/* ===================================================================== */
/* A9 — init: every source, and ./backlog without one (§ 4 `nj init`)     */
/* ===================================================================== */

/* "created there": `nj init` exits 0, and the target then holds a backlog —
 * proven by an empty `list` through --backlog, which § 4 makes binding (a
 * target without a backlog would be invalid_backlog_flag, not exit 0). */
function initCreates(desc, args, o, target, notAt) {
  const r = run(['init'].concat(args), o);
  T.exit(desc + ': init exits 0', r, 0);
  const l = runJ(['list', '--backlog=' + target], { cwd: o.cwd });
  T.exit(desc + ': the target now holds a backlog', l, 0);
  T.eq(desc + ': and it is empty', ids(l.json), []);
  for (const p of notAt || []) {
    T.check(desc + ': nothing created at ' + path.basename(p), !fs.existsSync(p), p + ' exists');
  }
}

{
  const root = H.freshDir('ac21-init');

  const c1 = mkdir(path.join(root, 'c1'));
  initCreates('A9 init --backlog (relative)', ['--backlog=../flagnew'], { cwd: c1 },
    path.join(root, 'flagnew'), [path.join(c1, 'backlog')]);

  const c2 = mkdir(path.join(root, 'c2'));
  initCreates('A9 init with NJ_BACKLOG', [], { cwd: c2, env: { NJ_BACKLOG: path.join(root, 'envnew') } },
    path.join(root, 'envnew'), [path.join(c2, 'backlog')]);

  const c3 = mkdir(path.join(root, 'c3'));
  initCreates('A9 init --backlog over NJ_BACKLOG', ['--backlog=' + path.join(root, 'flag2')],
    { cwd: c3, env: { NJ_BACKLOG: path.join(root, 'env2') } },
    path.join(root, 'flag2'), [path.join(root, 'env2'), path.join(c3, 'backlog')]);

  const c4 = mkdir(path.join(root, 'c4'));
  njrc(c4, 'backlog = store\n');
  initCreates('A9 init with .njrc in cwd', [], { cwd: c4 },
    path.join(c4, 'store'), [path.join(c4, 'backlog')]);

  const c5 = mkdir(path.join(root, 'c5'));
  njrc(c5, 'backlog = shared/bl\n');
  const c5deep = mkdir(path.join(c5, 'a', 'b'));
  initCreates('A9 init with .njrc in an ancestor (relative to the .njrc)', [], { cwd: c5deep },
    path.join(c5, 'shared', 'bl'), [path.join(c5deep, 'backlog'), path.join(c5deep, 'shared')]);

  const c6 = mkdir(path.join(root, 'c6'));
  njrc(c6, 'backlog = ../rcnew\n');
  initCreates('A9 init NJ_BACKLOG over .njrc', [], { cwd: c6, env: { NJ_BACKLOG: path.join(root, 'env3') } },
    path.join(root, 'env3'), [path.join(root, 'rcnew'), path.join(c6, 'backlog')]);

  /* no source: ./backlog, found afterwards by the search */
  const c7 = mkdir(path.join(root, 'c7'));
  initCreates('A9 init without any source creates ./backlog', [], { cwd: c7 }, path.join(c7, 'backlog'));
  usesBacklogIds('A9 the new ./backlog is what the search then finds', { cwd: c7 }, []);
  const found = runJ(['list'], { cwd: c7 });
  T.check('A9 the search reports ./backlog', reportsBacklog(found.json, path.join(c7, 'backlog')),
    J(found.json && found.json.backlog));

  /* the upward search for an existing backlog/ is not used by init */
  const c8 = mkdir(path.join(root, 'c8'));
  const upper = backlogAt(path.join(c8, 'backlog'), 'TSK-061');
  const c8sub = mkdir(path.join(c8, 'sub'));
  initCreates('A9 init ignores a backlog/ further up and creates ./backlog', [], { cwd: c8sub },
    path.join(c8sub, 'backlog'));
  usesBacklogIds('A9 the backlog/ further up is untouched', { cwd: c8, env: { NJ_BACKLOG: upper } }, ['TSK-061']);

  /* a .njrc without backlog: init falls back to ./backlog */
  const c9 = mkdir(path.join(root, 'c9'));
  njrc(c9, '# nothing\n');
  initCreates('A9 init with a backlog-less .njrc creates ./backlog', [], { cwd: c9 }, path.join(c9, 'backlog'));

  /* the target is the source's: init refuses with exists there */
  const c10 = mkdir(path.join(root, 'c10'));
  const taken = backlogAt(path.join(root, 'taken'), 'TSK-062');
  const ex = runJ(['init', '--backlog=' + taken], { cwd: c10 });
  T.exit('A9 init --backlog at an existing backlog: exit 1', ex, 1);
  T.eq('A9 init --backlog at an existing backlog: exists', ex.json && ex.json.error, 'exists');
  T.eq('A9 the refused init created nothing in cwd', H.lsOrEmpty(c10), []);

  /* init never looks at backlog/ folders, not even a nearer one between the
   * working directory and the nearest .njrc (DECISIONS 89, AMBIGUITIES 52) */
  const c11 = mkdir(path.join(root, 'c11'));
  njrc(c11, 'backlog = rctarget\n');
  const nearer = backlogAt(path.join(c11, 'proj', 'backlog'), 'TSK-063');
  const c11cwd = mkdir(path.join(c11, 'proj', 'src'));
  initCreates('A9 init uses the nearest .njrc even past a nearer backlog/', [], { cwd: c11cwd },
    path.join(c11, 'rctarget'), [path.join(c11cwd, 'backlog')]);
  usesBacklogIds('A9 the nearer backlog/ is untouched by that init', { cwd: c11, env: { NJ_BACKLOG: nearer } }, ['TSK-063']);

  /* an existing empty directory is "anything exists": exists (DECISIONS 89,
   * AMBIGUITIES 55) — through --backlog and as ./backlog without a source */
  const c12 = mkdir(path.join(root, 'c12'));
  const hollow = mkdir(path.join(root, 'hollow'));
  const e1 = runJ(['init', '--backlog=' + hollow], { cwd: c12 });
  T.exit('A9 init --backlog at an existing empty directory: exit 1', e1, 1);
  T.eq('A9 init --backlog at an existing empty directory: exists', e1.json && e1.json.error, 'exists');
  T.eq('A9 the refused init left the empty directory empty', H.lsOrEmpty(hollow), []);
  const c13 = mkdir(path.join(root, 'c13'));
  mkdir(path.join(c13, 'backlog'));
  const e2 = runJ(['init'], { cwd: c13 });
  T.exit('A9 init without a source over an empty ./backlog: exit 1', e2, 1);
  T.eq('A9 init without a source over an empty ./backlog: exists', e2.json && e2.json.error, 'exists');
  T.eq('A9 the refused init left ./backlog empty', H.lsOrEmpty(path.join(c13, 'backlog')), []);
}

T.finish();
