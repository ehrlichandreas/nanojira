'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || require('os').tmpdir();
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || path.join(__dirname, '..', '..', '..', 'src', 'nj.ts');
const NODE = process.execPath;
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo','doing','blocked','review','done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
let n = 0, bad = 0;
function ok(desc, cond, detail) { n++; if (!cond) { bad++; console.log('  ✗ ' + desc + (detail !== undefined ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 900) : '')); } else console.log('  ✓ ' + desc); }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function el(f, body) { const order = ['id','type','parent','title','status','priority','assignee','tags','depends_on','created','updated','archived']; const keys = order.filter(k => f[k] !== undefined).concat(Object.keys(f).filter(k => !order.includes(k))); return '---\n' + keys.map(k => k + ': ' + f[k]).join('\n') + '\n---\n\n' + (body || ''); }
function complete(t) { return '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'; }
function mk(label, files, tomb, cfg) {
  const d = fs.mkdtempSync(path.join(SCRATCH_BASE, label + '-'));
  const bl = path.join(d, 'backlog');
  for (const s of ['epics','tasks','subtasks','archive','.ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  if (cfg !== null) fs.writeFileSync(path.join(bl, '.nanojira.json'), cfg || CFG);
  for (const [rel, c] of Object.entries(files || {})) { const p = path.join(bl, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  for (const t of tomb || []) fs.writeFileSync(path.join(bl, '.ids', t), '');
  return d;
}
function run(args, cwd, env, now) {
  const r = spawnSync(NODE, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: now || NOW }, env || {}), encoding: 'utf8', timeout: 20000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, signal: r.signal, out: r.stdout, err: r.stderr, json, timedOut: r.error && r.error.code === 'ETIMEDOUT' };
}
const noTrace = (r) => !/\n\s+at .*\.js:\d+|TypeError|RangeError|Maximum call stack/.test(r.err + r.out);
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// ------------------------------------------------------------------ C1
console.log('\n[C1] unreadable file must not crash any command');
{
  const d = mk('c1', {
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T1', status: 'todo', created: NOW, updated: NOW, depends_on: '[TSK-003]' }, complete('T1')),
    'tasks/TSK-003.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'T3', status: 'done', created: NOW, updated: NOW }, complete('T3')),
  }, ['EPIC-001','TSK-001','TSK-002','TSK-003']);
  const bl = path.join(d, 'backlog');
  fs.symlinkSync(path.join(bl, 'nowhere.md'), path.join(bl, 'tasks', 'TSK-002.md'));
  fs.chmodSync(path.join(bl, 'tasks', 'TSK-003.md'), 0o000);
  const cmds = [[], ['list'], ['list','--ready'], ['list','--all','--tag=x'], ['show','--id=TSK-002'], ['show','--id=TSK-003'], ['show','--file=' + path.join(bl,'tasks','TSK-002.md')],
    ['tree'], ['tree','--id=EPIC-001'], ['set','--id=TSK-002','--status=doing'], ['set','--id=TSK-003','--status=doing'], ['note','--id=TSK-003','hi'],
    ['archive','--id=TSK-003'], ['archive','--id=EPIC-001'], ['doctor'], ['doctor','--fix'], ['new','--type=subtask','--parent=TSK-002','--title=child of stub'], ['rm','--id=TSK-001']];
  for (const c of cmds) {
    const r = run(c, d); const rj = run(c.concat(['--json']), d);
    ok(`${c.join(' ') || '(bare)'} → exit ${r.status}, no trace`, [0,1,2].includes(r.status) && noTrace(r) && !r.timedOut, r.err.slice(0, 300));
    ok(`${c.join(' ') || '(bare)'} --json → parseable JSON`, rj.json !== null, rj.out.slice(0, 200) + ' | ' + rj.err.slice(0, 200));
  }
  const doc = run(['doctor','--json'], d).json;
  const codes = doc ? doc.problems.map(p => p.code + '@' + (p.element || '')) : [];
  ok('doctor: file:unreadable on TSK-002 and TSK-003', codes.includes('file:unreadable@TSK-002') && codes.includes('file:unreadable@TSK-003'), codes.join(' '));
  ok('doctor: no content-derived codes on stubs (D46)', !doc.problems.some(p => (p.element === 'TSK-002' || p.element === 'TSK-003') && !['file:unreadable','id:no_tombstone','duplicate_id'].includes(p.code)), codes.join(' '));
  const ls = run(['list','--json'], d).json;
  const t1 = ls.entries.find(e => e.id === 'TSK-001');
  ok('TSK-001 depends_on unreadable TSK-003 → not ready (stub status unknown)', !run(['list','--ready','--json'], d).json.entries.some(e => e.id === 'TSK-001'));
  ok('stubs visible in list', ls.entries.some(e => e.id === 'TSK-002') && ls.entries.some(e => e.id === 'TSK-003'));
  const s = run(['set','--id=TSK-003','--status=doing','--json'], d);
  ok('set on unreadable → refused:unreadable exit 1', s.status === 1 && s.json && s.json.error === 'refused:unreadable', s.out);
  const nw = run(['new','--type=subtask','--parent=TSK-002','--title=x','--json'], d);
  console.log('    note: new under unreadable parent → exit ' + nw.status + ' ' + (nw.json && (nw.json.error || nw.json.id)));
  const rm = run(['rm','--id=TSK-002','--json'], d);
  console.log('    note: rm of dangling-symlink stub → exit ' + rm.status + ' ' + (rm.json && (rm.json.error || rm.json.changed)) + ' exists=' + fs.existsSync(path.join(bl,'tasks','TSK-002.md')));
  fs.chmodSync(path.join(bl, 'tasks', 'TSK-003.md'), 0o644);
}

// ------------------------------------------------------------------ C2
console.log('\n[C2] parent cycle terminates');
{
  const d = mk('c2', {
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'TSK-002', title: 'A', status: 'done', created: NOW, updated: NOW }, complete('A')),
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'TSK-001', title: 'B', status: 'done', created: NOW, updated: NOW }, complete('B')),
    'subtasks/SUB-001.md': el({ id: 'SUB-001', type: 'subtask', parent: 'SUB-001', title: 'Self', status: 'todo', created: NOW, updated: NOW }, complete('Self')),
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
  }, ['TSK-001','TSK-002','SUB-001','EPIC-001']);
  for (const c of [['tree'], ['tree','--json'], ['tree','--id=TSK-001'], ['tree','--id=SUB-001'], ['list'], ['list','--ready'], ['doctor'], ['rm','--id=TSK-001'], ['rm','--id=SUB-001'], ['archive','--id=TSK-001'], ['archive','--id=SUB-001'], ['rm','--id=TSK-001','--cascade']]) {
    const r = run(c, d);
    ok(`${c.join(' ')} → terminates, exit ${r.status}`, !r.timedOut && [0,1,2].includes(r.status) && noTrace(r), r.err.slice(0, 300));
  }
  const d2 = mk('c2b', {
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'TSK-002', title: 'A', status: 'done', created: NOW, updated: NOW }, complete('A')),
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'TSK-001', title: 'B', status: 'done', created: NOW, updated: NOW }, complete('B')),
  }, ['TSK-001','TSK-002']);
  const tr = run(['tree','--json'], d2).json;
  ok('tree shows cycle members (D54)', tr && tr.entries.length === 2, JSON.stringify(tr && tr.entries.map(e => e.id)));
  const doc = run(['doctor','--json'], d2).json;
  ok('doctor: parent:cycle on both', doc.problems.filter(p => p.code === 'parent:cycle').length === 2, JSON.stringify(doc.problems.map(p => p.code + '@' + p.element)));
  const rmr = run(['rm','--id=TSK-001','--cascade','--json'], d2);
  console.log('    note: rm --cascade in a 2-cycle → exit ' + rmr.status + ' ' + JSON.stringify(rmr.json && (rmr.json.ids || rmr.json.error)));
}

// ------------------------------------------------------------------ C3
console.log('\n[C3] --fix must not touch files with unreadable frontmatter lines');
{
  const broken = '---\nid: TSK-001\nparent: EPIC-001\nthis line has no colon at all\ntitle: Drift\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\ncustom: keep me\n---\n\n# Old H1\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
  const dup = '---\nid: TSK-002\ntype: task\nparent: EPIC-001\ntitle: Dup\ntitle: Second\nstatus: todo\n---\n\n# Dup\n';
  const d = mk('c3', { 'tasks/TSK-001.md': broken, 'tasks/TSK-002.md': dup, 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n') }, ['EPIC-001','TSK-001','TSK-002']);
  const p1 = path.join(d, 'backlog', 'tasks', 'TSK-001.md'), p2 = path.join(d, 'backlog', 'tasks', 'TSK-002.md');
  const h1 = sha(rd(p1)), h2 = sha(rd(p2));
  const doc = run(['doctor','--json'], d).json;
  const fu = doc.problems.filter(p => p.code === 'frontmatter:unreadable');
  ok('doctor reports frontmatter:unreadable with line numbers', fu.length === 2 && fu.every(f => typeof f.line === 'number'), JSON.stringify(fu));
  ok('doctor exit 2', run(['doctor'], d).status === 2);
  const fx = run(['doctor','--fix'], d, {}, LATER);
  ok('--fix leaves TSK-001 byte-identical', sha(rd(p1)) === h1, rd(p1));
  ok('--fix leaves TSK-002 byte-identical', sha(rd(p2)) === h2, rd(p2));
  ok('--fix prints a NOTE for both', /NOTE.*TSK-001/.test(fx.out) && /NOTE.*TSK-002/.test(fx.out), fx.out);
  ok('set refused on broken-line file', run(['set','--id=TSK-001','--status=doing','--json'], d).json.error === 'refused:unreadable');
  ok('note refused on broken-line file', run(['note','--id=TSK-001','x','--json'], d).json.error === 'refused:unreadable');
  ok('archive refused on broken-line file (not_done first is fine)', run(['archive','--id=TSK-001','--json'], d).status === 1);
  ok('TSK-001 still byte-identical after refusals', sha(rd(p1)) === h1);
  const fxj = run(['doctor','--fix','--json'], d, {}, LATER).json;
  ok('--fix --json carries notes[]', fxj && Array.isArray(fxj.notes) && fxj.notes.length >= 2, JSON.stringify(fxj && fxj.notes));
}

// ------------------------------------------------------------------ M1
console.log('\n[M1] top-level _problems on write results');
{
  const d = mk('m1', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n') }, ['EPIC-001']);
  const nw = run(['new','--type=task','--parent=EPIC-001','--title=T','--json'], d).json;
  ok('new: _problems top-level mirrors entry', nw && Array.isArray(nw._problems) && JSON.stringify(nw._problems) === JSON.stringify(nw.entry._problems) && nw._problems.includes('incomplete:description'), JSON.stringify(nw));
  ok('new: changed lists frontmatter fields minus created/updated', JSON.stringify(nw.changed) === JSON.stringify(['id','type','parent','title','status']), JSON.stringify(nw.changed));
  const st = run(['set','--id=TSK-001','--status=doing','--json'], d, {}, LATER).json;
  ok('set: _problems top-level mirrors entry', st && JSON.stringify(st._problems) === JSON.stringify(st.entry._problems) && st.changed[0] === 'status', JSON.stringify(st));
  const nt = run(['note','--id=TSK-001','hello','--json'], d, {}, LATER).json;
  ok('note: changed ["body"] and _problems mirrored', nt && JSON.stringify(nt.changed) === '["body"]' && JSON.stringify(nt._problems) === JSON.stringify(nt.entry._problems), JSON.stringify(nt));
  const nw2 = run(['new','--type=subtask','--parent=TSK-001','--title=S','--json'], d).json;
  const rm = run(['rm','--id=SUB-001','--json'], d).json;
  ok('rm: {ok,id,changed:[deleted],entry,_problems}', rm && rm.ok && rm.id === 'SUB-001' && rm.changed[0] === 'deleted' && rm.entry && Array.isArray(rm._problems), JSON.stringify(rm));
  run(['new','--type=subtask','--parent=TSK-001','--title=S2','--json'], d);
  const rmc = run(['rm','--id=TSK-001','--cascade','--json'], d).json;
  ok('rm --cascade: {ok,ids,changed:[deleted],entries,_problems}', rmc && Array.isArray(rmc.ids) && rmc.ids.length === 2 && Array.isArray(rmc.entries) && Array.isArray(rmc._problems), JSON.stringify(rmc));
  console.log('    note: rm --cascade top-level _problems = ' + JSON.stringify(rmc._problems) + ' while entries carry ' + JSON.stringify(rmc.entries.map(e => e._problems)));
}

// ------------------------------------------------------------------ M2
console.log('\n[M2] --fix refreshes updated; step 5 created=mtime, updated=now');
{
  const OLD = new Date('2020-01-02T03:04:05Z');
  const d = mk('m2', {
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'NoType', status: 'todo', created: NOW, updated: NOW }, complete('NoType')),          // step 1
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'NoTimes' }, complete('NoTimes')),                                       // step 5
    'tasks/TSK-003.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'H1', status: 'todo', created: NOW, updated: NOW }, '# Other\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'), // step 6
    'tasks/TSK-004.md': el({ id: 'TSK-004', parent: 'EPIC-001', title: 'NoTypeNoCreated', status: 'todo', updated: NOW }, complete('NoTypeNoCreated')),     // steps 1 + 5
    'tasks/TSK-005.md': el({ id: 'TSK-005', type: 'bogus', parent: 'EPIC-001', title: 'BadType', status: 'todo', created: NOW, updated: NOW }, complete('BadType')), // invalid existing value
    'tasks/TSK-006.md': '---\nid: TSK-006\ntype: task\nparent: EPIC-001\ntitle: EmptyStatus\nstatus:\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n\n' + complete('EmptyStatus'),
  }, ['EPIC-001','TSK-001','TSK-002','TSK-003','TSK-004','TSK-005','TSK-006']);
  const bl = path.join(d, 'backlog');
  for (const f of ['TSK-001','TSK-002','TSK-003','TSK-004','TSK-005','TSK-006']) fs.utimesSync(path.join(bl, 'tasks', f + '.md'), OLD, OLD);
  const pre = run(['doctor','--json'], d).json;
  console.log('    pre-fix codes: ' + pre.problems.map(p => p.code + '@' + p.element).join(' '));
  const fx = run(['doctor','--fix'], d, {}, LATER);
  console.log('    ' + fx.out.split('\n').filter(l => /FIXED|NOTE/.test(l)).join('\n    '));
  const g = (f, k) => { const m = new RegExp('^' + k + ': (.*)$', 'm').exec(rd(path.join(bl, 'tasks', f + '.md'))); return m ? m[1] : null; };
  ok('step 1: TSK-001 gets type and updated=now', g('TSK-001','type') === 'task' && g('TSK-001','updated') === LATER, rd(path.join(bl,'tasks','TSK-001.md')));
  ok('step 5: TSK-002 created=mtime(2020), updated=now, status=todo', g('TSK-002','created') === '2020-01-02T03:04:05Z' && g('TSK-002','updated') === LATER && g('TSK-002','status') === 'todo', rd(path.join(bl,'tasks','TSK-002.md')));
  ok('step 6: TSK-003 H1 synced and updated=now', /^# H1$/m.test(rd(path.join(bl,'tasks','TSK-003.md'))) && g('TSK-003','updated') === LATER, rd(path.join(bl,'tasks','TSK-003.md')));
  ok('steps 1+5 on one file: TSK-004 created still the ORIGINAL mtime (2020), not the step-1 write time', g('TSK-004','created') === '2020-01-02T03:04:05Z', 'created=' + g('TSK-004','created') + ' updated=' + g('TSK-004','updated'));
  ok('invalid type value left untouched (m4)', g('TSK-005','type') === 'bogus', rd(path.join(bl,'tasks','TSK-005.md')));
  const post = run(['doctor','--json'], d).json;
  ok('TSK-005 still reports type:derived after fix (never repaired)', post.problems.some(p => p.element === 'TSK-005' && p.code === 'type:derived'), JSON.stringify(post.problems.filter(p => p.element === 'TSK-005')));
  const t6 = post.problems.filter(p => p.element === 'TSK-006').map(p => p.code);
  console.log('    TSK-006 file after fix: ' + JSON.stringify(rd(path.join(bl,'tasks','TSK-006.md')).split('\n').slice(0,9).join('|'))); console.log('    note: empty `status:` line — post-fix codes on TSK-006: ' + JSON.stringify(t6) + ' ; status line now: ' + JSON.stringify(g('TSK-006','status')) + ' ; NOTE mentioned? ' + /TSK-006/.test(fx.out));
  ok('second --fix is a no-op', /Nothing to fix/.test(run(['doctor','--fix'], d, {}, '2026-09-21T20:00:00Z').out));
}

// ------------------------------------------------------------------ M3
console.log('\n[M3] --file through symlinked absolute paths');
{
  const d = mk('m3', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')) }, ['EPIC-001','TSK-001']);
  const bl = path.join(d, 'backlog');
  ok('/tmp is a symlink on this mac', fs.realpathSync('/tmp') !== '/tmp', fs.realpathSync('/tmp'));
  const viaTmp = path.join(bl, 'tasks', 'TSK-001.md'); // /tmp/v2/... (symlinked)
  const viaReal = fs.realpathSync(viaTmp);
  ok('--file=<abs via /tmp> works', run(['set','--file=' + viaTmp,'--status=doing','--json'], d).json.ok === true);
  ok('--file=<abs via /private/tmp> works', run(['set','--file=' + viaReal,'--priority=high','--json'], d).json.ok === true);
  ok('--file=<relative to backlog> works', run(['set','--file=tasks/TSK-001.md','--assignee=me','--json'], d).json.ok === true);
  ok('--file=<relative with ..> works', run(['set','--file=epics/../tasks/TSK-001.md','--tags=a','--json'], d).json.ok === true);
  const nested = path.join(d, 'sub'); fs.mkdirSync(nested);
  ok('--file relative resolves against backlog, not cwd', run(['show','--file=tasks/TSK-001.md','--json'], nested).json.entries[0].id === 'TSK-001');
  ok('--file nonexistent → not_found', run(['set','--file=tasks/NOPE.md','--status=done','--json'], d).json.error === 'not_found');
  ok('--file and --id together → invalid_target', run(['set','--file=tasks/TSK-001.md','--id=TSK-001','--status=done','--json'], d).json.error === 'invalid_target');
  fs.symlinkSync(path.join(bl, 'gone.md'), path.join(bl, 'tasks', 'TSK-009.md'));
  const dl = run(['set','--file=' + path.join(bl,'tasks','TSK-009.md'),'--status=doing','--json'], d).json;
  ok('--file to dangling symlink reaches the stub → refused:unreadable (D48)', dl.error === 'refused:unreadable', JSON.stringify(dl));
  { const sh = run(['show','--file=' + path.join(bl,'tasks','TSK-009.md'),'--json'], d); ok('show --file on dangling symlink reaches the stub', sh.json && sh.json.entries && sh.json.entries[0] && sh.json.entries[0]._problems.includes('file:unreadable'), sh.out); const byId = run(['show','--id=TSK-009','--json'], d); ok('show --id on dangling symlink reaches the stub', byId.json && byId.json.entries && byId.json.entries.length === 1, byId.out); console.log('    note: cwd=' + process.cwd() + ' ; nj sees backlog as ' + (byId.json && byId.json.backlog)); }
}

// ------------------------------------------------------------------ spec pins
console.log('\n[SPEC] pinned changes');
{
  // discovery
  const d0 = fs.mkdtempSync(SCRATCH_BASE + '/disc-'); fs.mkdirSync(path.join(d0, 'backlog', 'tasks'), { recursive: true }); fs.mkdirSync(path.join(d0, 'a', 'b'), { recursive: true });
  const r = run(['list'], d0); const rj = run(['list','--json'], path.join(d0, 'a', 'b'));
  ok('backlog/ without config → exit 1, names the missing file, points at doctor', r.status === 1 && /\.nanojira\.json/.test(r.err) && /nj doctor/.test(r.err) && !/no backlog found/.test(r.err), r.err);
  ok('… from nested dir, --json: {ok:false,error:backlog_without_config,hint}', rj.json && rj.json.ok === false && rj.json.error === 'backlog_without_config' && typeof rj.json.hint === 'string', rj.out);
  ok('… stdout is pure JSON (prose only on stderr)', rj.json !== null && rj.err.length > 0);
  const re = run(['list','--json'], '/', { NJ_BACKLOG: path.join(d0, 'backlog') });
  ok('NJ_BACKLOG at configless dir → backlog_without_config', re.json && re.json.error === 'backlog_without_config', re.out);
  const dd = run(['doctor','--json'], d0);
  ok('doctor tolerates missing config → config:invalid, exit 2', dd.status === 2 && dd.json.problems.some(p => p.code === 'config:invalid'), dd.out);
  const none = run(['list','--json'], os.homedir() + '/Downloads');
  ok('no backlog at all → no_backlog', none.json && none.json.error === 'no_backlog', none.out);
  // failure shape variants
  const d = mk('spec', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: NOW, updated: NOW }, complete('T')),
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'T2', status: 'todo', created: NOW, updated: NOW, depends_on: '[TSK-001]' }, complete('T2')),
    'tasks/TSK-002-copy.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'T2 copy', status: 'todo', created: NOW, updated: NOW }, complete('T2 copy')),
    'archive/EPIC-002.md': el({ id: 'EPIC-002', type: 'epic', title: 'Old', status: 'done', created: NOW, updated: NOW, archived: NOW }, '# Old\n\n## Description\nD\n'),
  }, ['EPIC-001','EPIC-002','TSK-001','TSK-002']);
  const bl = path.join(d, 'backlog');
  for (const [args, code] of [[['bogus'], 'unknown_command'], [['set','--id=TSK-001','--statuss=done'], 'unknown_field'], [['set','--id=NOPE','--status=done'], 'not_found'], [['set','--id=TSK-001','--status'], 'missing_value'], [['set','--status=done'], 'missing_argument'], [['new','--type=task','--parent=EPIC-002','--title=x'], 'refused:parent_archived'], [['list','--status=typo'], 'invalid_value'], [['list','--parent=NOPE'], 'not_found'], [['list','--type=typo'], 'invalid_value'], [['set','--id=EPIC-002','--status=done'], 'refused:archived'], [['note','--id=EPIC-002','x'], 'refused:archived'], [['rm','--id=EPIC-002'], 'refused:archived'], [['archive','--id=EPIC-002'], 'refused:archived'], [['set','--id=TSK-002','--status=doing'], 'duplicate_id'], [['new','--type=task','--parent=EPIC-001','--title=x','--tags=a]b'], 'invalid_value']]) {
    const x = run(args.concat(['--json']), d);
    ok(`${args.join(' ')} → exit 1, error=${code}, stdout pure JSON`, x.status === 1 && x.json && x.json.ok === false && x.json.error === code && (x.json.hint === undefined || typeof x.json.hint === 'string'), x.out + ' | ' + x.err.slice(0, 200));
  }
  const dup = run(['set','--id=TSK-002','--status=doing'], d);
  ok('duplicate_id refusal names the code and both absolute paths', /duplicate_id/.test(dup.err) && dup.err.includes(path.join(bl,'tasks','TSK-002.md')) && dup.err.includes(path.join(bl,'tasks','TSK-002-copy.md')) && /--file/.test(dup.err), dup.err);
  ok('show --id shows both duplicates marked', run(['show','--id=TSK-002','--json'], d).json.entries.length === 2);
  ok('show --file narrows to one (D55)', run(['show','--file=tasks/TSK-002-copy.md','--json'], d).json.entries.length === 1);
  ok('--file escape writes the one file', run(['set','--file=tasks/TSK-002-copy.md','--status=doing','--json'], d).json.ok === true);
  // rm names dependents
  const rmr = run(['rm','--id=TSK-001'], d); const rmj = run(['rm','--id=TSK-001','--json'], d);
  ok('rm names dependents in prose (TSK-002)', rmr.status === 0 && /TSK-002/.test(rmr.out) && /depends_on:dangling/.test(rmr.out), rmr.out);
  ok('rm --json (2nd run → not_found now): exit 1', rmj.json.error === 'not_found');
  // LF / BOM
  const crlf = '﻿---\r\nid: EPIC-003\r\ntype: epic\r\ntitle: Win\r\nstatus: todo\r\ncreated: ' + NOW + '\r\nupdated: ' + NOW + '\r\n---\r\n\r\n# Win\r\n\r\n## Description\r\nD\r\n';
  fs.writeFileSync(path.join(bl, 'epics', 'EPIC-003.md'), crlf); fs.writeFileSync(path.join(bl, '.ids', 'EPIC-003'), '');
  const s3 = run(['set','--id=EPIC-003','--status=doing','--json'], d, {}, LATER);
  const after = fs.readFileSync(path.join(bl, 'epics', 'EPIC-003.md'));
  ok('CRLF+BOM file → written as LF without BOM', s3.json.ok && !after.includes(0x0d) && !(after[0] === 0xef && after[1] === 0xbb), JSON.stringify(after.toString().slice(0, 80)));
  // unknown:priority
  fs.writeFileSync(path.join(bl, 'tasks', 'TSK-007.md'), el({ id: 'TSK-007', type: 'task', parent: 'EPIC-001', title: 'P', status: 'todo', priority: 'sky', created: NOW, updated: NOW }, complete('P'))); fs.writeFileSync(path.join(bl, '.ids', 'TSK-007'), '');
  const dj = run(['doctor','--json'], d).json;
  ok('unknown:priority is a warning finding', dj.problems.some(p => p.code === 'unknown:priority' && p.severity === 'warning' && p.element === 'TSK-007'));
  ok('unknown:priority does not block ready', run(['list','--ready','--json'], d).json.entries.some(e => e.id === 'TSK-007'));
  run(['set','--id=TSK-007','--assignee=x','--json'], d, {}, LATER);
  ok('unknown priority value survives a write untouched', /^priority: sky$/m.test(rd(path.join(bl,'tasks','TSK-007.md'))));
  ok('--fix never repairs unknown priority', (run(['doctor','--fix'], d, {}, LATER), /^priority: sky$/m.test(rd(path.join(bl,'tasks','TSK-007.md')))));
  // 30 codes
  // A static property of the SOURCE, not of whichever artifact is under
  // behavioural test right now -- `NJ` may point at `nj`, at `dist/nj` (no
  // sibling commands/ or core/ at all, and esbuild rewrites `const` to `var`
  // in its CJS wrapper, so a regex anchored on the source's own declaration
  // keyword stops matching the bundle), or some future build. Read the SOURCE
  // (src/nj.ts + src/commands/*.{js,ts} + src/core/*.{js,ts} next to THIS
  // script's repo root, not next to NJ) unconditionally.
  // TSK-023: lib/*.ts (now core/*.ts) declares SEVERITY with a type annotation
  // (`const SEVERITY: Record<...> = {`), which the old anchor -- expecting
  // `const SEVERITY = {` verbatim -- does not match. Proven broken first,
  // against a probe .ts file with a typed declaration, before this fix.
  const srcRoot = path.join(__dirname, '..', '..', '..', 'src');
  const modSrc = ['commands', 'core'].flatMap((sub) => {
    const dir = path.join(srcRoot, sub);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.ts')).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  });
  const src = [fs.readFileSync(path.join(srcRoot, 'nj.ts'), 'utf8')].concat(modSrc).join('\n'); const tbl = /(?:const|let|var) SEVERITY(?:\s*:[^=]+)? = \{([\s\S]*?)\n\};/.exec(src)[1]; const codes = tbl.match(/'([^']+)':/g).map(s => s.slice(1, -2));
  ok('SEVERITY has 30 distinct codes incl. file:unreadable + unknown:priority', new Set(codes).size === 30 && codes.includes('file:unreadable') && codes.includes('unknown:priority'), codes.length + ' ' + codes.join(','));
  // help --json
  const hj = run(['help','--json'], d); console.log('    note: `nj help --json` → exit ' + hj.status + ', stdout JSON? ' + (hj.json !== null));
  const cj = run(['--json','--help'], d); console.log('    note: `nj --json --help` → stdout JSON? ' + (cj.json !== null));
  // archive: refuse when target exists; archived child under active parent
  const d5 = mk('arch', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: NOW, updated: NOW }, complete('T')),
    'archive/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T old', status: 'done', created: NOW, updated: NOW, archived: NOW }, complete('T old')) }, ['EPIC-001','TSK-001']);
  const ar = run(['archive','--id=EPIC-001','--json'], d5);
  ok('archive refuses when target path occupied (D22) — exit 1, nothing moved', ar.status === 1 && fs.existsSync(path.join(d5,'backlog','epics','EPIC-001.md')), JSON.stringify(ar.json) + ' epics=' + fs.readdirSync(path.join(d5,'backlog','epics')));
  console.log('    state after: epics=' + fs.readdirSync(path.join(d5,'backlog','epics')) + ' tasks=' + fs.readdirSync(path.join(d5,'backlog','tasks')) + ' archive=' + fs.readdirSync(path.join(d5,'backlog','archive')) + ' ; doctor codes=' + run(['doctor','--json'], d5).json.problems.map(p=>p.code+'@'+p.element).join(' ') + ' ; retry child archive → ' + JSON.stringify(run(['archive','--id=TSK-001','--json'], d5).json)); console.log('    note: archive with occupied target → error=' + (ar.json && ar.json.error) + ' (EPIC moved first? ' + !fs.existsSync(path.join(d5,'backlog','epics','EPIC-001.md')) + ')');
}
console.log(`\n${n - bad}/${n} checks passed, ${bad} failed`);
