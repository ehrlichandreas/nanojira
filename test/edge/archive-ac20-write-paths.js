'use strict';
/* Edge — AC-20 section-write gaps (Not-covered #18), write-path half.
 *
 * review-ac20-verifier.md's "Orakel-Lücken für AC-20" names these as verified
 * by the verifier's own scratch probes but never added to the oracle: stdin
 * combined with --json, an epic given --acceptance, a directory/empty path
 * for --<role>-file, the unknown_field hint naming description/acceptance,
 * section flags rejected on rm/note, and compare-before-write on a section
 * write (ac-20-section-writes.js explicitly delegates that last one to the
 * generic fault/nj-fault-before-compare.js — this closes it for real).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/harness.js');
const T = H.T;

const C = H.FIXED_NOW;
const LATER = H.LATER_NOW;
const J = x => JSON.stringify(x);

function mkTask(label, body) {
  return H.mkBacklog({
    label,
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: C, updated: C,
    }, body) },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
}

/* ---- stdin combined with --json: the JSON stream must not be corrupted -- */

{
  const d = mkTask('archive-ac20-stdin-json', '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  const r = H.runJson(['set', '--id=TSK-001', '--description-file=-'],
    { cwd: d, input: 'From stdin.' });
  T.exit('set --description-file=- --json', r, 0);
  T.check('stdout parses as clean JSON (stdin consumption did not leak into it)',
    r.json !== null, r.parseError || r.stdout);
  T.check('ok is true', r.json && r.json.ok === true, J(r.json));
  T.check('changed includes description', r.json && (r.json.changed || []).includes('description'), J(r.json && r.json.changed));
  T.contains('the stdin content was written', fs.readFileSync(path.join(d, 'backlog', 'tasks', 'TSK-001.md'), 'utf8'),
    'From stdin.');
}

/* ---- epic + --acceptance: accepted, inserted, exempt from the AC-20 gate  */

{
  const d = H.freshDir('archive-ac20-epic-acceptance');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);
  const r = H.runJson(['new', '--type=epic', '--title=Auth', '--acceptance=- [ ] top-level criterion'], { cwd: d });
  T.exit('new epic with --acceptance (no --description)', r, 0);
  T.check('changed includes acceptance', r.json && (r.json.changed || []).includes('acceptance'), J(r.json && r.json.changed));
  T.check('changed does not include description (not supplied)',
    r.json && !(r.json.changed || []).includes('description'), J(r.json && r.json.changed));

  const epicFile = path.join(d, 'backlog', 'epics', 'EPIC-001.md');
  const bytes = fs.readFileSync(epicFile, 'utf8');
  T.contains('the acceptance heading and content were written', bytes,
    '## Acceptance Criteria\n- [ ] top-level criterion');

  const list = H.runJson(['list'], { cwd: d });
  const e = (list.json.entries || []).find(x => x.id === 'EPIC-001');
  T.check('the epic is incomplete:description (empty description)',
    !!e && (e._problems || []).includes('incomplete:description'), J(e && e._problems));
  T.check('the epic is NEVER flagged on acceptance (§ 7: epics are exempt)',
    !!e && !(e._problems || []).some(c => c.includes('acceptance')), J(e && e._problems));
}

/* ---- --<role>-file: directory and empty path are both not_found -------- */

{
  const d = mkTask('archive-ac20-file-dir', '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  const taskFile = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
  const before = H.sha256(fs.readFileSync(taskFile));

  const dirPath = path.join(d, 'backlog', 'tasks');
  const r1 = H.runJson(['set', '--id=TSK-001', '--description-file=' + dirPath], { cwd: d });
  T.exit('--description-file=<a directory> is rejected', r1, 1);
  T.eq('the error code is not_found (a directory cannot be read as content)',
    r1.json && r1.json.error, 'not_found');
  T.check('the file is unchanged', H.sha256(fs.readFileSync(taskFile)) === before, 'checksum changed');

  const r2 = H.runJson(['set', '--id=TSK-001', '--description-file='], { cwd: d });
  T.exit('--description-file=<empty path> is rejected', r2, 1);
  T.eq('the error code is not_found (an empty path names nothing readable)',
    r2.json && r2.json.error, 'not_found');
  T.check('the file is unchanged', H.sha256(fs.readFileSync(taskFile)) === before, 'checksum changed');
}

/* ---- unknown_field hint names description/acceptance too --------------- */

{
  const d = mkTask('archive-ac20-hint', '# Endpoint\n\n## Description\n\n## Acceptance Criteria\n- [ ] x\n');
  const r = H.runNj(['set', '--id=TSK-001', '--nope=1'], { cwd: d });
  T.exit('an unknown flag is rejected', r, 1);
  const out = r.stdout + r.stderr;
  T.contains('the hint lists description among the known fields', out, 'description');
  T.contains('the hint lists acceptance among the known fields', out, 'acceptance');
}

/* ---- section flags do not exist on rm or note --------------------------- */

{
  const d = mkTask('archive-ac20-rm-note-reject', '# Endpoint\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n');
  const taskFile = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
  const before = H.sha256(fs.readFileSync(taskFile));

  const r1 = H.runJson(['rm', '--id=TSK-001', '--description=Nope'], { cwd: d });
  T.exit('rm --description is rejected', r1, 1);
  T.eq('the error code is unknown_field', r1.json && r1.json.error, 'unknown_field');
  T.check('rm did not run', fs.existsSync(taskFile), 'the file was removed');
  T.check('the file is unchanged', H.sha256(fs.readFileSync(taskFile)) === before, 'checksum changed');

  const r2 = H.runJson(['note', '--id=TSK-001', '--acceptance=Nope', 'text'], { cwd: d });
  T.exit('note --acceptance is rejected', r2, 1);
  T.eq('the error code is unknown_field', r2.json && r2.json.error, 'unknown_field');
  T.check('the file is unchanged', H.sha256(fs.readFileSync(taskFile)) === before, 'checksum changed');
}

/* ---- compare-before-write races a section write, not just --status ----- */
/* (fault/nj-fault-before-compare.js already proves the guard is field-agnostic
 * for --status; this closes ac-20's explicit delegation with a real run against
 * a --description write, using the same rendezvous protocol.) */

H.requireNj();

function fixture(label) {
  return H.mkBacklog({
    label,
    files: { 'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
      status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW,
    }, '# Endpoint\n\n## Description\nOld.\n\n## Acceptance Criteria\n- [ ] x\n') },
    tombstones: ['TSK-001', 'EPIC-001'],
  });
}

function startNj(args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env, { NJ_NOW: o.now || LATER }, o.env || {});
  const inv = H.njCommand(H.NJ, args);
  const child = spawn(inv.cmd, inv.args, { cwd: o.cwd, env });
  let out = '', err = '';
  child.stdout.on('data', x => { out += x; });
  child.stderr.on('data', x => { err += x; });
  return new Promise(resolve => {
    child.on('error', e => resolve({ status: null, stdout: '', stderr: String(e.message) }));
    child.on('close', code => resolve({ status: code, stdout: out, stderr: err }));
  });
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const d = fixture('archive-ac20-before-compare');
  const file = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  const done = startNj(['set', '--id=TSK-001', '--description=New from this run'],
    { cwd: d, env: { NJ_FAULT: 'before-compare' } });

  await sleep(1000); // let nj finish its first read
  const parallelVersion = H.element({
    id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Endpoint',
    status: 'review', created: H.FIXED_NOW, updated: LATER,
  }, '# Endpoint\n\n## Description\nOld.\n\n## Acceptance Criteria\n- [ ] x\n');
  fs.writeFileSync(file, parallelVersion);
  fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');

  const r = await done;
  T.exit('a parallel change aborts a section write, same as any other write', r, 1);
  T.check('the abort says so in words', /changed in parallel|parallel/i.test(r.stdout + r.stderr),
    JSON.stringify(r.stdout + r.stderr));

  const after = fs.readFileSync(file, 'utf8');
  T.contains('the parallel writer\'s version survives', after, 'status: review');
  T.check('the section write did not go through', !after.includes('New from this run'), after);
  T.eq('the file is byte-identical to the parallel version', H.sha256(after), H.sha256(parallelVersion));

  T.finish();
})().catch(e => {
  console.log('FAIL archive-ac20-write-paths.js — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
