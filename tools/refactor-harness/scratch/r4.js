'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || require('os').tmpdir();
const NJ = process.argv[2] || path.join(__dirname, '..', '..', '..', 'src', 'nj.ts');
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo','doing','blocked','review','done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
let n = 0, bad = 0;
function ok(desc, cond, detail) { n++; if (!cond) { bad++; console.log('  ✗ ' + desc + (detail !== undefined ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 900) : '')); } else console.log('  ✓ ' + desc); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function el(f, body) { const order = ['id','type','parent','title','status','priority','assignee','tags','depends_on','created','updated','archived']; const keys = order.filter(k => f[k] !== undefined).concat(Object.keys(f).filter(k => !order.includes(k))); return '---\n' + keys.map(k => k + ': ' + f[k]).join('\n') + '\n---\n\n' + (body || ''); }
const complete = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
function mk(label, files, tomb) {
  const d = fs.mkdtempSync(path.join(SCRATCH_BASE, 'r4-' + label + '-')); const bl = path.join(d, 'backlog');
  for (const s of ['epics','tasks','subtasks','archive','.ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  fs.writeFileSync(path.join(bl, '.nanojira.json'), CFG);
  for (const [rel, c] of Object.entries(files || {})) { const p = path.join(bl, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  for (const t of tomb || []) fs.writeFileSync(path.join(bl, '.ids', t), '');
  return d;
}
function run(args, cwd, env, now) {
  const r = spawnSync(process.execPath, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: now || NOW }, env || {}), encoding: 'utf8', timeout: 20000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, out: r.stdout, err: r.stderr, json };
}
const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
function sums(d) { const out = {}; const bl = path.join(d, 'backlog'); for (const dir of ['epics','tasks','subtasks','archive']) { let names = []; try { names = fs.readdirSync(path.join(bl, dir)).sort(); } catch {} for (const nme of names) { const p = path.join(bl, dir, nme); let st; try { st = fs.lstatSync(p); } catch { continue; } const c = rd(p); out[dir + '/' + nme] = c === null ? '<unreadable:' + (st.isSymbolicLink() ? 'link' : 'file') + '>' : sha(c); } } return out; }
const E = el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n');
const T = (id, parent, extra) => el(Object.assign({ id, type: id.startsWith('SUB') ? 'subtask' : 'task', parent, title: id, status: 'done', created: NOW, updated: NOW }, extra || {}), complete(id));

console.log('\n[a] three codes stay distinct');
{
  const d = mk('codes', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001', 'EPIC-001') }, ['EPIC-001','TSK-001']);
  const c = (args) => (run(args.concat(['--json']), d).json || {}).error;
  ok('task under a task → invalid_target', c(['new','--type=task','--parent=TSK-001','--title=x']) === 'invalid_target', c(['new','--type=task','--parent=TSK-001','--title=x']));
  ok('subtask under an epic → invalid_target', c(['new','--type=subtask','--parent=EPIC-001','--title=x']) === 'invalid_target');
  ok('--parent=EPIC-999 → not_found', c(['new','--type=task','--parent=EPIC-999','--title=x']) === 'not_found');
  ok('--status=nope on new → invalid_value', c(['new','--type=task','--parent=EPIC-001','--title=x','--status=nope']) === 'invalid_value');
  ok('--status=nope on set → invalid_value', c(['set','--id=TSK-001','--status=nope']) === 'invalid_value');
  ok('--priority=nope → invalid_value', c(['set','--id=TSK-001','--priority=nope']) === 'invalid_value');
  ok('--type=nope → invalid_value', c(['new','--type=nope','--title=x']) === 'invalid_value');
  ok('--depends-on=NOPE → not_found', c(['set','--id=TSK-001','--depends-on=NOPE']) === 'not_found');
  ok('--id and --file together → invalid_target (§9 table has no row; in set)', c(['set','--id=TSK-001','--file=tasks/TSK-001.md','--status=done']) === 'invalid_target');
  console.log('    note: epic with --parent → ' + c(['new','--type=epic','--parent=EPIC-001','--title=x']));
}

console.log('\n[b] backlog-wide stub guard');
{
  const files = { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001'), 'tasks/TSK-002.md': T('TSK-002','EPIC-001'), 'subtasks/SUB-001.md': T('SUB-001','TSK-002'), 'epics/EPIC-002.md': el({ id: 'EPIC-002', type: 'epic', title: 'E2', status: 'todo', created: NOW, updated: NOW }, '# E2\n\n## Description\nD\n') };
  const ids = ['EPIC-001','EPIC-002','TSK-001','TSK-002','SUB-001','SUB-009','TSK-009'];
  // variant 1: stub as a descendant (chmod 000 SUB-001) ; variant 2: stub elsewhere (dangling symlink in another folder) ; variant 3: stub inside archive/
  const variants = [
    ['stub is a descendant (chmod 000 subtasks/SUB-001.md)', d => fs.chmodSync(path.join(d,'backlog','subtasks','SUB-001.md'), 0o000), d => fs.chmodSync(path.join(d,'backlog','subtasks','SUB-001.md'), 0o644)],
    ['stub elsewhere (dangling symlink tasks/TSK-009.md)', d => fs.symlinkSync(path.join(d,'backlog','gone.md'), path.join(d,'backlog','tasks','TSK-009.md')), () => {}],
    ['stub inside archive/ (dangling symlink archive/SUB-009.md)', d => fs.symlinkSync(path.join(d,'backlog','gone.md'), path.join(d,'backlog','archive','SUB-009.md')), () => {}],
  ];
  for (const [label, arm, disarm] of variants) {
    console.log('  -- ' + label);
    const d = mk('stub', files, ids); arm(d); const before = sums(d);
    for (const args of [['rm','--id=EPIC-001'], ['rm','--id=EPIC-001','--cascade'], ['rm','--id=TSK-001'], ['rm','--id=EPIC-002'], ['archive','--id=EPIC-001'], ['archive','--id=TSK-001'], ['rm','--id=NOPE'], ['archive','--id=NOPE'], ['rm','--file=tasks/NOPE.md']]) {
      const r = run(args.concat(['--json']), d);
      ok(`${args.join(' ')} → refused:unreadable`, r.status === 1 && r.json && r.json.error === 'refused:unreadable', JSON.stringify(r.json));
    }
    ok('nothing moved or deleted (checksums identical)', JSON.stringify(sums(d)) === JSON.stringify(before), JSON.stringify(sums(d)));
    const rh = run(['rm','--id=EPIC-002'], d);
    ok('prose names the stub by id and absolute path + doctor hint', /SUB-001|TSK-009|SUB-009/.test(rh.err) && /\/backlog\//.test(rh.err) && /nj doctor/.test(rh.err), rh.err);
    for (const args of [['list'], ['list','--all'], ['tree'], ['tree','--all'], ['show','--id=EPIC-001'], ['doctor'], []]) {
      const r = run(args.concat(['--json']), d); ok(`read ${args.join(' ') || '(bare)'} still works (exit ${r.status})`, [0,2].includes(r.status) && r.json !== null, r.err.slice(0, 200));
    }
    const s = run(['set','--id=TSK-001','--status=doing','--json'], d, {}, LATER);
    ok('set on a readable element still allowed while a stub exists elsewhere', s.status === 0 && s.json && s.json.ok === true, JSON.stringify(s.json));
    const nw = run(['new','--type=task','--parent=EPIC-002','--title=x','--json'], d, {}, LATER);
    ok('new under a readable parent still allowed', nw.status === 0, JSON.stringify(nw.json));
    disarm(d);
    const after = run(['rm','--id=EPIC-002','--cascade','--json'], d);
    ok('after making the stub readable / it being a link elsewhere: rm works again?', after.status === 0 || (label.includes('elsewhere') || label.includes('archive')), JSON.stringify(after.json));
  }
}

console.log('\n[c] mtime map keyed by path');
{
  const OLD = new Date('2020-01-02T03:04:05Z'), OLD2 = new Date('2019-06-07T08:09:10Z'), OLD3 = new Date('2018-03-04T05:06:07Z');
  const d = mk('mtime', {
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-005.md': el({ id: 'TSK-005', parent: 'EPIC-001', title: 'Dup A', status: 'todo' }, complete('Dup A')),
    'tasks/TSK-005-copy.md': el({ id: 'TSK-005', parent: 'EPIC-001', title: 'Dup B', status: 'todo' }, complete('Dup B')),
    'tasks/TSK-009.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'Renamed', status: 'todo' }, complete('Renamed')),
    'epics/TSK-004.md': el({ id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'Moved', status: 'todo' }, complete('Moved')),
    'tasks/TSK-007.md': el({ id: 'TSK-007', parent: 'EPIC-001', title: 'TypeAndCreated', status: 'todo' }, complete('TypeAndCreated')),
  }, ['EPIC-001','TSK-003','TSK-004','TSK-005','TSK-007']);
  const bl = path.join(d, 'backlog'); const set = (rel, t) => fs.utimesSync(path.join(bl, rel), t, t);
  set('tasks/TSK-005.md', OLD); set('tasks/TSK-005-copy.md', OLD2); set('tasks/TSK-009.md', OLD3); set('epics/TSK-004.md', OLD3); set('tasks/TSK-007.md', OLD);
  const fx = run(['doctor','--fix'], d, {}, LATER);
  const g = (rel, k) => { const m = new RegExp('^' + k + ': (.*)$', 'm').exec(rd(path.join(bl, rel)) || ''); return m ? m[1] : null; };
  ok('dup A keeps 2020, dup B keeps 2019', g('tasks/TSK-005.md','created') === '2020-01-02T03:04:05Z' && g('tasks/TSK-005-copy.md','created') === '2019-06-07T08:09:10Z', 'A=' + g('tasks/TSK-005.md','created') + ' B=' + g('tasks/TSK-005-copy.md','created'));
  ok('rename edge: TSK-009.md→TSK-003.md keeps 2018', g('tasks/TSK-003.md','created') === '2018-03-04T05:06:07Z', 'created=' + g('tasks/TSK-003.md','created') + ' tasks=' + fs.readdirSync(path.join(bl,'tasks')));
  ok('move edge: epics/TSK-004.md→tasks/ keeps 2018', g('tasks/TSK-004.md','created') === '2018-03-04T05:06:07Z', 'created=' + g('tasks/TSK-004.md','created'));
  ok('type+created on one file keeps 2020', g('tasks/TSK-007.md','created') === '2020-01-02T03:04:05Z' && g('tasks/TSK-007.md','type') === 'task');
  console.log('    --fix exit=' + fx.status + ' (duplicate_id remains) ; FIXED lines=' + (fx.out.match(/^FIXED/mg) || []).length);
  ok('§14: exit 2 because duplicate_id remains after repair', fx.status === 2);
  ok('§14: report lists the acted-on repairs (FIXED lines) despite exit 2', /FIXED.*TSK-005.*created/.test(fx.out) && /renamed TSK-009/.test(fx.out), fx.out);
  // repairable-only case → exit 0, report shows what was acted on
  const d2 = mk('fixok', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'T', status: 'todo' }, complete('T')) }, ['EPIC-001','TSK-001']);
  const pre = run(['doctor'], d2); const fx2 = run(['doctor','--fix'], d2, {}, LATER); const post = run(['doctor'], d2);
  ok('repairable-only: doctor before exit ' + pre.status + ' (warnings), --fix exit 0, doctor after exit 0, FIXED lines present', fx2.status === 0 && post.status === 0 && /FIXED/.test(fx2.out), fx2.out);
  // warnings-only remaining (unknown:status is not fixable) → exit 0
  const d3 = mk('fixwarn', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'weird', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'T', status: 'todo' }, complete('T')) }, ['EPIC-001','TSK-001']);
  const fx3 = run(['doctor','--fix'], d3, {}, LATER);
  ok('warning remaining after repair → exit 0, WARNING listed', fx3.status === 0 && /WARNING.*EPIC-001/.test(fx3.out), fx3.out);
  // error present before, repaired by --fix (id:mismatch is an error) → exit 0
  const d4 = mk('fixerr', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-009.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')) }, ['EPIC-001','TSK-001']);
  ok('error before (id:mismatch): doctor exit 2', run(['doctor'], d4).status === 2);
  const fx4 = run(['doctor','--fix'], d4, {}, LATER); const fx4j = run(['doctor','--fix','--json'], d4, {}, LATER).json;
  ok('--fix repairs the error → exit 0 (state AFTER), FIXED renamed shown', fx4.status === 0 && /renamed TSK-009/.test(fx4.out), fx4.out);
  ok('--fix --json: ok true, problems [] after, fixed [] on second run', fx4j && fx4j.ok === true && fx4j.problems.length === 0 && fx4j.fixed.length === 0, JSON.stringify(fx4j));
}

console.log('\n[d] archive hint + dependents');
{
  const d = mk('dep', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001'), 'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'dep', status: 'done', created: NOW, updated: NOW }, complete('dep')), 'epics/EPIC-002.md': el({ id: 'EPIC-002', type: 'epic', title: 'E2', status: 'todo', depends_on: '[TSK-001]', created: NOW, updated: NOW }, '# E2\n\n## Description\nD\n'), 'tasks/TSK-003.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-002', title: 'T3', status: 'todo', depends_on: '[TSK-002, EPIC-001]', created: NOW, updated: NOW }, complete('T3')) }, ['EPIC-001','EPIC-002','TSK-001','TSK-002','TSK-003']);
  const ar = run(['archive','--id=EPIC-001','--json'], d, {}, LATER).json;
  ok('archive JSON has NO dependents key although EPIC-002/TSK-003 depend on moved elements (§9 final row)', ar && ar.ok && !('dependents' in ar) && Object.keys(ar).sort().join() === '_problems,changed,entries,ids,ok', JSON.stringify(Object.keys(ar||{})));
  console.log('    archive JSON keys: ' + Object.keys(ar||{}).sort().join(','));
  const d2 = mk('dep2', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001'), 'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'dep', status: 'todo', depends_on: '[TSK-001]', created: NOW, updated: NOW }, complete('dep')), 'epics/EPIC-002.md': el({ id: 'EPIC-002', type: 'epic', title: 'E2', status: 'todo', depends_on: '[TSK-001]', created: NOW, updated: NOW }, '# E2\n\n## Description\nD\n') }, ['EPIC-001','EPIC-002','TSK-001','TSK-002']);
  const rc = run(['rm','--id=EPIC-001','--cascade','--json'], d2).json;
  ok('rm --cascade JSON: {ok,ids,changed,entries,_problems,dependents}, dependents=[EPIC-002] (TSK-002 was deleted)', rc && Object.keys(rc).sort().join() === '_problems,changed,dependents,entries,ids,ok' && JSON.stringify(rc.dependents) === '["EPIC-002"]', JSON.stringify(rc));
  const d3 = mk('dep3', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001') }, ['EPIC-001','TSK-001']);
  const rc3 = run(['rm','--id=EPIC-001','--cascade','--json'], d3).json;
  ok('rm --cascade empty case: dependents []', rc3 && Array.isArray(rc3.dependents) && rc3.dependents.length === 0, JSON.stringify(rc3));
  const d4 = mk('dep4', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001') }, ['EPIC-001','TSK-001']);
  const ar4 = run(['archive','--id=EPIC-001','--json'], d4, {}, LATER).json;
  ok('archive empty case: NO dependents key', ar4 && ar4.ok && !('dependents' in ar4) && Object.keys(ar4).sort().join() === '_problems,changed,entries,ids,ok', JSON.stringify(Object.keys(ar4||{})));
  const rs = run(['rm','--id=TSK-001','--json'], mk('dep5', { 'epics/EPIC-001.md': E, 'tasks/TSK-001.md': T('TSK-001','EPIC-001') }, ['EPIC-001','TSK-001'])).json;
  ok('rm single empty case: dependents []', rs && Array.isArray(rs.dependents) && rs.dependents.length === 0, JSON.stringify(rs));
  // archive hint under before-compare is checked in r4bc.js
}
console.log(`\n${n - bad}/${n} checks passed, ${bad} failed`);
