'use strict';
/* AC-29 — Stale claims, docs/SPECIFICATION.md § 5 (`claims.staleAfterHours`),
 * § 7, § 12 "Claims", § 14 (v3.2 proposal § B, promoted: DECISIONS 122/123/
 * 125/130, commit 8822e95; D131, 6e6d1fc, broadens scope below).
 *
 * AC-29 (§ 15): "An element claimed more than `claims.staleAfterHours`
 * (default 24) ago reports `claim:stale` (warning, never blocks `--ready`)
 * on every read (`list`, `show`, `doctor`); one claimed less than the
 * threshold ago does not. 'Ago' is measured against `NJ_NOW` when set, real
 * wall-clock time otherwise. `doctor --fix` leaves `claim:stale` untouched —
 * no auto-release, no auto-steal, the claim and its `assignee` mirror are
 * unchanged byte-for-byte, and the exit code reflects only that one warning
 * remaining (0, since a warning never raises it). `claims.staleAfterHours:
 * 0` turns the finding off entirely, even for a claim far older than the
 * un-configured default; a negative or non-integer value, or an unknown key
 * inside `claims`, is `config:invalid`. A backlog with no `claims` config
 * key behaves exactly as the 24-hour default. `--ready` condition 5 (§ 9)
 * is unaffected by staleness in either direction; `_claim`'s shape is
 * unchanged."
 *
 * D131: `claim:stale` appears in the `_problems` of every entry `nj`
 * returns — not only `doctor`/`list`/`show` but `tree`, bare `nj`, and the
 * write results of `set`/`note` — exactly as `claim:mismatch`/
 * `claim:orphaned` already do (E8 below).
 *
 * Written before `claim:stale` exists: red everywhere until it is
 * implemented.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

H.requireNj();

const NOW = H.FIXED_NOW; /* element creation time, irrelevant to staleness */
function J(x) { return JSON.stringify(x === undefined ? null : x); }

const HOME = H.freshDir('ac29-home');
function envFor(o) {
  const env = Object.assign({ HOME }, (o && o.env) || {});
  const unset = [];
  for (const k of ['NJ_AUTHOR', 'NJ_BACKLOG']) if (env[k] === undefined) unset.push(k);
  return { cwd: o.cwd, env, unsetEnv: unset };
}
function run(args, o) { return H.runNj(args, envFor(o)); }
function runJ(args, o) { return H.runJson(args, envFor(o)); }
const at = t => ({ NJ_NOW: t });

function ok(r, what) {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

/* An hour, in milliseconds — ISO-8601 arithmetic on the pinned clock. */
const HOUR = 3600 * 1000;
function minus(iso, hours) { return new Date(new Date(iso).getTime() - hours * HOUR).toISOString().replace(/\.\d+Z$/, 'Z'); }

/* "Now" for every case below. */
const NOW_REF = '2026-10-01T12:00:00Z';

function model(label) {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  ok(run(['init'], { cwd: dir }), 'nj init');
  ok(run(['new', '--type=epic', '--title=Epic', '--description=E.'], { cwd: dir, env: at(NOW) }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=Task',
    '--description=D.', '--acceptance=- [ ] x'], { cwd: dir, env: at(NOW) }), 'new task');
  return { dir, bl };
}

function configPath(x) { return path.join(x.bl, '.nanojira', 'config.json'); }
function readConfig(x) { return JSON.parse(fs.readFileSync(configPath(x), 'utf8')); }
function writeConfig(x, cfg) { fs.writeFileSync(configPath(x), JSON.stringify(cfg, null, 2) + '\n'); }
function setClaims(x, claims) {
  const cfg = readConfig(x);
  if (claims === undefined) delete cfg.claims;
  else cfg.claims = claims;
  writeConfig(x, cfg);
}

function claimsDir(x, id) { return path.join(x.bl, '.nanojira', 'claims', id); }
/** Hand-write a single `claimed <name>` entry at generation 1, and mirror
 * `assignee` the same way a real `nj claim` would — full control over
 * `since`, which a real claim/sleep cycle could never give deterministically
 * (the reason § 12 pins `NJ_NOW` for this at all). */
function claimAt(x, id, name, since) {
  fs.mkdirSync(claimsDir(x, id), { recursive: true });
  fs.writeFileSync(path.join(claimsDir(x, id), '1'), 'claimed\n' + name + '\n' + since + '\n');
  ok(run(['set', '--id=' + id, '--assignee=' + name], { cwd: x.dir, env: at(since) }), 'mirror assignee=' + name);
}

function elementFile(x, id) { return path.join(x.bl, 'tasks', id + '.md'); }
function bytes(p) { return H.readOrNull(p); }

/* ===================================================================== */
/* E1 — default threshold (24h): just under, exactly at, just over          */
/* ===================================================================== */
{
  const x = model('ac29-e1-under');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 23));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E1 claimed 23h ago (default 24h threshold): no claim:stale',
    !(H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}
{
  const x = model('ac29-e1-exact');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 24));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E1 claimed exactly 24h ago: no claim:stale ("exceeds", not ">=")',
    !(H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}
{
  const x = model('ac29-e1-over');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E1 claimed 25h ago (default 24h threshold): claim:stale',
    (H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
  T.exit('E1 claim:stale alone: doctor still exits 0 (a warning)', d, 0);
}
{
  /* claim:stale on every read, not just doctor. */
  const x = model('ac29-e1-reads');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const list = runJ(['list', '--all'], { cwd: x.dir, env: at(NOW_REF) });
  const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir, env: at(NOW_REF) });
  const inList = (list.json && list.json.entries || []).find(e => e.id === 'TSK-001');
  T.check('E1 list: claim:stale in _problems', !!inList && (inList._problems || []).includes('claim:stale'), J(inList));
  T.check('E1 show: claim:stale in _problems', !!show.json && (show.json.entries[0]._problems || []).includes('claim:stale'), J(show.json));
}

/* ===================================================================== */
/* E2 — a custom threshold (§ 5 claims.staleAfterHours)                   */
/* ===================================================================== */
{
  const x = model('ac29-e2-under');
  setClaims(x, { staleAfterHours: 1 });
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 1));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E2 custom threshold=1h, claimed exactly 1h ago: no claim:stale',
    !(H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}
{
  const x = model('ac29-e2-over');
  setClaims(x, { staleAfterHours: 1 });
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 2));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E2 custom threshold=1h, claimed 2h ago: claim:stale',
    (H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}

/* ===================================================================== */
/* E3 — 0 disables the check entirely (§ 5)                               */
/* ===================================================================== */
{
  const x = model('ac29-e3');
  setClaims(x, { staleAfterHours: 0 });
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 1000));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E3 staleAfterHours=0: no claim:stale even for a 1000h-old claim',
    !(H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}

/* ===================================================================== */
/* E4 — no claims config key: behaves exactly as the 24h default          */
/* ===================================================================== */
{
  const x = model('ac29-e4');
  /* setClaims(x, undefined) deletes the key outright, confirming it is not
   * merely "absent by not having been set" but genuinely untouched by init. */
  setClaims(x, undefined);
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E4 no claims key at all: 25h-old claim is still stale (24h default)',
    (H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}

/* ===================================================================== */
/* E5 — invalid values and an unknown key: invalid_config on commands,      */
/* config:invalid as the doctor finding (§ 5, § 7, § 9)                    */
/* ===================================================================== */
for (const [label, claims] of [
  ['negative', { staleAfterHours: -1 }],
  ['non-integer (float)', { staleAfterHours: 1.5 }],
  ['a string', { staleAfterHours: '24' }],
  ['a boolean', { staleAfterHours: true }],
  ['null', { staleAfterHours: null }],
  ['an unknown key', { staleAfterHours: 24, bogus: 1 }],
]) {
  const x = model('ac29-e5-' + label.replace(/[^a-z0-9]+/gi, '-'));
  setClaims(x, claims);
  const r = runJ(['list'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E5 claims.' + label + ': list fails with exit 1', r, 1);
  T.eq('E5 claims.' + label + ': list --json error is invalid_config', r.json && r.json.error, 'invalid_config');
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E5 claims.' + label + ': doctor exits 2', d, 2);
  T.sameSet('E5 claims.' + label + ': config:invalid is the only finding', [...new Set(H.doctorSet(d) || ['<none>'])], ['config:invalid:error']);
}
{
  /* The healthy baseline: a correct custom value is NOT config:invalid. */
  const x = model('ac29-e5-valid');
  setClaims(x, { staleAfterHours: 48 });
  const r = runJ(['list'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E5 a valid claims.staleAfterHours=48: list exits 0', r, 0);
}

/* ===================================================================== */
/* E6 — NJ_NOW determinism: the same claim is stale or not purely by the  */
/* pinned clock, never by real wall-clock time (§ 12 "Claims")            */
/* ===================================================================== */
{
  const x = model('ac29-e6');
  /* A claim made "25 hours before NOW_REF" by the pinned clock — in real
   * wall-clock terms this `since` is whatever the test happened to run at,
   * which could be seconds old. If NJ_NOW were not honoured, this would
   * never be stale under a real clock. */
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E6 staleness is computed against NJ_NOW, not real wall-clock time',
    (H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
  /* The same fixture, read with NO NJ_NOW at all, falls back to the real
   * clock — "since" (2026-10-01, fixed in the fixture) is far in the past
   * by real wall-clock time too, so this is expected to also be stale; the
   * point of E6 above is that NJ_NOW, when given, is authoritative even
   * though it names an "ago" a real clock could not have produced. */
}

/* ===================================================================== */
/* E7 — advisory only: doctor --fix never touches it; --ready unaffected; */
/* no auto-release, no auto-steal (§ 12 "Claims")                          */
/* ===================================================================== */
{
  const x = model('ac29-e7-fix');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const before = bytes(elementFile(x, 'TSK-001'));
  const beforeGen = H.lsOrEmpty(claimsDir(x, 'TSK-001')).sort();
  const f = runJ(['doctor', '--fix'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E7 doctor --fix on a stale claim: exit 0 (a warning never raises it)', f, 0);
  T.eq('E7 --fix: the element file is byte-identical (no auto-release, no assignee change)',
    bytes(elementFile(x, 'TSK-001')), before);
  T.eq('E7 --fix: the claim directory is untouched (no auto-steal, no pruning)',
    H.lsOrEmpty(claimsDir(x, 'TSK-001')).sort(), beforeGen);
  const d = runJ(['doctor'], { cwd: x.dir, env: at(NOW_REF) });
  T.check('E7 claim:stale is still reported after --fix', (H.doctorSet(d) || []).includes('claim:stale:warning'), J(d.json && d.json.problems));
}
{
  const x = model('ac29-e7-ready');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const readyOther = runJ(['list', '--ready'], { cwd: x.dir, env: Object.assign(at(NOW_REF), { NJ_AUTHOR: 'bob' }) });
  T.check('E7 --ready as a different name: a stale claim still hides the element, exactly as a fresh one would',
    !(readyOther.json && readyOther.json.entries || []).some(e => e.id === 'TSK-001'), J(readyOther.json && readyOther.json.entries));
  const readyHolder = runJ(['list', '--ready'], { cwd: x.dir, env: Object.assign(at(NOW_REF), { NJ_AUTHOR: 'alice' }) });
  T.check('E7 --ready as the holder: still sees it, staleness does not exclude the holder either',
    (readyHolder.json && readyHolder.json.entries || []).some(e => e.id === 'TSK-001'), J(readyHolder.json && readyHolder.json.entries));
}
{
  /* _claim's shape is unchanged: no new field for age. */
  const x = model('ac29-e7-shape');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const show = runJ(['show', '--id=TSK-001'], { cwd: x.dir, env: at(NOW_REF) });
  const c = show.json && show.json.entries[0]._claim;
  T.eq('E7 _claim is exactly {by, since}, no new age/stale field', c && Object.keys(c).sort(), ['by', 'since']);
}

/* ===================================================================== */
/* E8 — claim:stale in _problems of EVERY entry nj returns (D131), not     */
/* only doctor/list/show: a write result (set) and tree (§ 12 "Claims")    */
/* ===================================================================== */
{
  const x = model('ac29-e8-write');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const w = runJ(['set', '--id=TSK-001', '--priority=high'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E8 set on a stale claim: exit 0', w, 0);
  T.check('E8 set --json: claim:stale in the write result\'s _problems (§ 9 example)',
    Array.isArray(w.json && w.json._problems) && w.json._problems.includes('claim:stale'), J(w.json));
}
{
  const x = model('ac29-e8-tree');
  claimAt(x, 'TSK-001', 'alice', minus(NOW_REF, 25));
  const t = runJ(['tree'], { cwd: x.dir, env: at(NOW_REF) });
  T.exit('E8 tree --json: exit 0', t, 0);
  const te = (t.json && t.json.entries || []).find(e => e.id === 'TSK-001');
  T.check('E8 tree --json: claim:stale in the entry\'s _problems',
    !!te && Array.isArray(te._problems) && te._problems.includes('claim:stale'), J(te));
}

T.finish();
