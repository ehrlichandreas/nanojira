'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || require('os').tmpdir();
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || '/home/dev/workspace/portable/projects/nanojira/nj';
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo','doing','blocked','review','done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
let n = 0, bad = 0;
function ok(desc, cond, detail) { n++; if (!cond) { bad++; console.log('  ✗ ' + desc + (detail !== undefined ? '\n      ' + String(detail).replace(/\n/g, '\n      ').slice(0, 900) : '')); } else console.log('  ✓ ' + desc); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function el(f, body) { const order = ['id','type','parent','title','status','priority','assignee','tags','depends_on','created','updated','archived']; const keys = order.filter(k => f[k] !== undefined).concat(Object.keys(f).filter(k => !order.includes(k))); return '---\n' + keys.map(k => k + ': ' + f[k]).join('\n') + '\n---\n\n' + (body || ''); }
const complete = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
function mk(label, files, tomb, cfg) {
  const d = fs.mkdtempSync(path.join(SCRATCH_BASE, 'r3-' + label + '-')); const bl = path.join(d, 'backlog');
  for (const s of ['epics','tasks','subtasks','archive','.ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  if (cfg !== null) fs.writeFileSync(path.join(bl, '.nanojira.json'), cfg || CFG);
  for (const [rel, c] of Object.entries(files || {})) { const p = path.join(bl, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  for (const t of tomb || []) fs.writeFileSync(path.join(bl, '.ids', t), '');
  return d;
}
function run(args, cwd, env, now) {
  const r = spawnSync(process.execPath, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: now || NOW }, env || {}), encoding: 'utf8', timeout: 20000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, out: r.stdout, err: r.stderr, json, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT') };
}
const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
// checksum of every element file (lstat so dangling symlinks are recorded)
function sums(d) { const out = {}; const bl = path.join(d, 'backlog'); for (const dir of ['epics','tasks','subtasks','archive']) { let names = []; try { names = fs.readdirSync(path.join(bl, dir)).sort(); } catch {} for (const nme of names) { const p = path.join(bl, dir, nme); let st; try { st = fs.lstatSync(p); } catch { continue; } const c = rd(p); out[dir + '/' + nme] = c === null ? '<unreadable:' + (st.isSymbolicLink() ? 'symlink' : 'file') + '>' : sha(c); } } return out; }
const noTrace = r => !/\n\s+at .*\.js:\d+|TypeError|RangeError|Maximum call stack/.test(r.err + r.out);
const doneEl = (f, b) => el(Object.assign({ status: 'done', created: NOW, updated: NOW }, f), b);

// ---------------------------------------------------------------- (a) archive all-or-nothing
console.log('\n[a] archive all-or-nothing');
{
  const files = {
    'epics/EPIC-001.md': doneEl({ id: 'EPIC-001', type: 'epic', title: 'E' }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': doneEl({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T1' }, complete('T1')),
    'tasks/TSK-002.md': doneEl({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'T2' }, complete('T2')),
    'subtasks/SUB-001.md': doneEl({ id: 'SUB-001', type: 'subtask', parent: 'TSK-002', title: 'S1' }, complete('S1')),
  };
  // collision on the LAST element of the plan (SUB-001), so a per-element check would have moved three files first
  const d = mk('arch-collide', Object.assign({ 'archive/SUB-001.md': doneEl({ id: 'SUB-001', type: 'subtask', parent: 'TSK-002', title: 'stale', archived: NOW }, complete('stale')) }, files), ['EPIC-001','TSK-001','TSK-002','SUB-001']);
  const before = sums(d);
  const r = run(['archive','--id=EPIC-001','--json'], d, {}, LATER);
  ok('collision on the last planned element → exit 1, error=exists', r.status === 1 && r.json && r.json.error === 'exists', r.out + r.err);
  ok('every element file byte-identical (incl. the stale archive copy)', JSON.stringify(sums(d)) === JSON.stringify(before), JSON.stringify(sums(d)));
  ok('no .nj-tmp-* left anywhere', !Object.keys(sums(d)).some(k => k.includes('.nj-tmp-')));
  ok('message says nothing was moved', /nothing was moved/i.test(r.err), r.err);
  const rh = run(['archive','--id=EPIC-001'], d, {}, LATER);
  ok('human path: exit 1, still byte-identical', rh.status === 1 && JSON.stringify(sums(d)) === JSON.stringify(before));
  // clean case
  const d2 = mk('arch-clean', files, ['EPIC-001','TSK-001','TSK-002','SUB-001']);
  const r2 = run(['archive','--id=EPIC-001','--json'], d2, {}, LATER);
  const s2 = sums(d2);
  ok('clean case archives all 4', r2.status === 0 && r2.json && r2.json.ids.length === 4 && Object.keys(s2).every(k => k.startsWith('archive/')) && Object.keys(s2).length === 4, JSON.stringify(r2.json && r2.json.ids) + ' ' + Object.keys(s2));
  ok('archived + updated stamped', /^archived: 2026-09-21T19:30:00Z$/m.test(rd(path.join(d2,'backlog','archive','SUB-001.md'))) && /^updated: 2026-09-21T19:30:00Z$/m.test(rd(path.join(d2,'backlog','archive','SUB-001.md'))));
  ok('doctor clean after archive', run(['doctor','--json'], d2).json.problems.length === 0, JSON.stringify(run(['doctor','--json'], d2).json.problems));
  // archive with --force → which code?
  const d3 = mk('arch-force', files, ['EPIC-001','TSK-001','TSK-002','SUB-001']);
  const rf = run(['archive','--id=EPIC-001','--force','--json'], d3, {}, LATER);
  console.log('    note: archive --force → exit ' + rf.status + ' error=' + (rf.json && rf.json.error) + ' ; stderr: ' + rf.err.split('\n')[0]);
  ok('archive --force does not archive (§12: no override)', rf.status === 1 && Object.keys(sums(d3)).every(k => !k.startsWith('archive/')));
  // collision + unreadable child in the subtree: also nothing moves
  const d4 = mk('arch-unreadable', files, ['EPIC-001','TSK-001','TSK-002','SUB-001']);
  fs.chmodSync(path.join(d4,'backlog','subtasks','SUB-001.md'), 0o000);
  const b4 = sums(d4); const r4 = run(['archive','--id=EPIC-001','--json'], d4, {}, LATER);
  ok('unreadable descendant → refused, nothing moved (exit ' + r4.status + ', ' + (r4.json && r4.json.error) + ')', r4.status === 1 && JSON.stringify(sums(d4)) === JSON.stringify(b4));
  fs.chmodSync(path.join(d4,'backlog','subtasks','SUB-001.md'), 0o644);
}

// ---------------------------------------------------------------- (b) traversal
console.log('\n[b] traversal: unsorted callers keep scan order, tree sorts; cycles terminate');
{
  // scan order (by folder, then filename) differs from sort order (priority desc): TSK-001 low, TSK-002 urgent, TSK-003 high
  const files = {
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'low', status: 'done', priority: 'low', created: NOW, updated: NOW }, complete('low')),
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'urgent', status: 'done', priority: 'urgent', created: NOW, updated: NOW }, complete('urgent')),
    'tasks/TSK-003.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'high', status: 'done', priority: 'high', created: NOW, updated: NOW }, complete('high')),
    'subtasks/SUB-001.md': el({ id: 'SUB-001', type: 'subtask', parent: 'TSK-003', title: 's-low', status: 'done', priority: 'low', created: NOW, updated: NOW }, complete('s-low')),
    'subtasks/SUB-002.md': el({ id: 'SUB-002', type: 'subtask', parent: 'TSK-001', title: 's-urgent', status: 'done', priority: 'urgent', created: NOW, updated: NOW }, complete('s-urgent')),
  };
  const ids = ['EPIC-001','TSK-001','TSK-002','TSK-003','SUB-001','SUB-002'];
  const d = mk('trav', files, ids);
  const tree = run(['tree','--json'], d).json.entries.map(e => e.id);
  ok('tree: children sorted by priority desc (pre-order)', JSON.stringify(tree) === JSON.stringify(['EPIC-001','TSK-002','TSK-003','SUB-001','TSK-001','SUB-002']), JSON.stringify(tree));
  const treeH = run(['tree'], d).out;
  ok('tree human: indentation matches depth', /^EPIC-001/m.test(treeH) && /^  TSK-002/m.test(treeH) && /^    SUB-001/m.test(treeH), treeH);
  const rmr = run(['rm','--id=EPIC-001','--cascade','--json'], mk('trav-rm', files, ids)).json;
  // old descendants(): DFS in scan order: EPIC → TSK-001 → SUB-002 → TSK-002 → TSK-003 → SUB-001
  ok('rm --cascade ids: DFS in SCAN order (unsorted, as before)', JSON.stringify(rmr.ids) === JSON.stringify(['EPIC-001','TSK-001','SUB-002','TSK-002','TSK-003','SUB-001']), JSON.stringify(rmr.ids));
  const rmh = run(['rm','--id=EPIC-001','--cascade'], mk('trav-rm2', files, ids)).out.split('\n').filter(l => / deleted /.test(l)).map(l => l.split(' ')[0]);
  ok('rm --cascade human lines: same scan order', JSON.stringify(rmh) === JSON.stringify(['EPIC-001','TSK-001','SUB-002','TSK-002','TSK-003','SUB-001']), JSON.stringify(rmh));
  const ar = run(['archive','--id=EPIC-001','--json'], mk('trav-ar', files, ids), {}, LATER).json;
  ok('archive ids: DFS in SCAN order (unsorted, as before)', JSON.stringify(ar.ids) === JSON.stringify(['EPIC-001','TSK-001','SUB-002','TSK-002','TSK-003','SUB-001']), JSON.stringify(ar.ids));
  const refusal = run(['rm','--id=EPIC-001'], d).err;
  ok('rm refusal names children in scan order', refusal.indexOf('TSK-001') < refusal.indexOf('SUB-002') && refusal.indexOf('SUB-002') < refusal.indexOf('TSK-002'), refusal);
  // cycles
  const dc = mk('cyc', {
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'TSK-002', title: 'A', status: 'done', created: NOW, updated: NOW }, complete('A')),
    'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'TSK-001', title: 'B', status: 'done', created: NOW, updated: NOW }, complete('B')),
    'subtasks/SUB-001.md': el({ id: 'SUB-001', type: 'subtask', parent: 'SUB-001', title: 'Self', status: 'todo', created: NOW, updated: NOW }, complete('Self')),
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
  }, ['TSK-001','TSK-002','SUB-001','EPIC-001']);
  for (const c of [['tree'], ['tree','--json'], ['tree','--id=TSK-001'], ['tree','--id=SUB-001'], ['list','--ready'], ['doctor'], ['rm','--id=TSK-001'], ['rm','--id=SUB-001'], ['archive','--id=TSK-001'], ['archive','--id=SUB-001'], ['rm','--id=TSK-001','--cascade']]) {
    const r = run(c, dc); ok(`cycle: ${c.join(' ')} terminates (exit ${r.status})`, !r.timedOut && [0,1,2].includes(r.status) && noTrace(r), r.err.slice(0, 200));
  }
  const tj = run(['tree','--json'], mk('cyc2', { 'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'TSK-002', title: 'A', status: 'done', created: NOW, updated: NOW }, complete('A')), 'tasks/TSK-002.md': el({ id: 'TSK-002', type: 'task', parent: 'TSK-001', title: 'B', status: 'done', created: NOW, updated: NOW }, complete('B')) }, ['TSK-001','TSK-002'])).json;
  ok('tree shows both cycle members exactly once', tj.entries.map(e => e.id).sort().join() === 'TSK-001,TSK-002', JSON.stringify(tj.entries.map(e => e.id)));
}

// ---------------------------------------------------------------- (c) --fix mtime snapshot
console.log('\n[c] --fix mtime snapshot');
{
  const OLD = new Date('2020-01-02T03:04:05Z'), OLD2 = new Date('2019-06-07T08:09:10Z');
  const d = mk('mtime', {
    'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'NoTypeNoCreated', status: 'todo' }, complete('NoTypeNoCreated')),                    // steps 1+5
    'tasks/TSK-002.md': el({ type: 'task', parent: 'EPIC-001', title: 'NoIdNoCreated', status: 'todo' }, complete('NoIdNoCreated')),                          // steps 1(id)+5
    'tasks/TSK-009.md': el({ id: 'TSK-003', type: 'task', parent: 'EPIC-001', title: 'Mismatch', status: 'todo' }, complete('Mismatch')),                    // step 2 rename + 5
    'epics/TSK-004.md': el({ id: 'TSK-004', type: 'task', parent: 'EPIC-001', title: 'WrongFolder', status: 'todo' }, complete('WrongFolder')),              // step 3 move + 5
    'tasks/TSK-005.md': el({ id: 'TSK-005', parent: 'EPIC-001', title: 'Dup A', status: 'todo' }, complete('Dup A')),                                        // duplicate id, both missing type+created
    'tasks/TSK-005-copy.md': el({ id: 'TSK-005', parent: 'EPIC-001', title: 'Dup B', status: 'todo' }, complete('Dup B')),
  }, ['EPIC-001','TSK-001','TSK-002','TSK-003','TSK-004','TSK-005']);
  const bl = path.join(d, 'backlog');
  const set = (rel, t) => fs.utimesSync(path.join(bl, rel), t, t);
  set('tasks/TSK-001.md', OLD); set('tasks/TSK-002.md', OLD); set('tasks/TSK-009.md', OLD); set('epics/TSK-004.md', OLD); set('tasks/TSK-005.md', OLD); set('tasks/TSK-005-copy.md', OLD2);
  const fx = run(['doctor','--fix'], d, {}, LATER);
  console.log('    ' + fx.out.split('\n').filter(l => /FIXED|NOTE/.test(l)).join('\n    '));
  const g = (rel, k) => { const m = new RegExp('^' + k + ': (.*)$', 'm').exec(rd(path.join(bl, rel)) || ''); return m ? m[1] : null; };
  ok('steps 1+5 (type): created = original mtime', g('tasks/TSK-001.md','created') === '2020-01-02T03:04:05Z' && g('tasks/TSK-001.md','type') === 'task', 'created=' + g('tasks/TSK-001.md','created'));
  ok('steps 1+5 (id): created = original mtime', g('tasks/TSK-002.md','created') === '2020-01-02T03:04:05Z' && g('tasks/TSK-002.md','id') === 'TSK-002', 'created=' + g('tasks/TSK-002.md','created'));
  ok('step 2 rename then 5: created = original mtime (TSK-003)', g('tasks/TSK-003.md','created') === '2020-01-02T03:04:05Z', 'created=' + g('tasks/TSK-003.md','created') + ' files=' + fs.readdirSync(path.join(bl,'tasks')));
  ok('step 3 move then 5: created = original mtime (TSK-004)', g('tasks/TSK-004.md','created') === '2020-01-02T03:04:05Z', 'created=' + g('tasks/TSK-004.md','created') + ' files=' + fs.readdirSync(path.join(bl,'tasks')));
  const a = g('tasks/TSK-005.md','created'), b = g('tasks/TSK-005-copy.md','created');
  ok('duplicate id: each file keeps ITS OWN original mtime (snapshot keyed by id would collide)', a === '2020-01-02T03:04:05Z' && b === '2019-06-07T08:09:10Z', 'A created=' + a + ' B created=' + b);
  ok('updated = now on all repaired files', ['tasks/TSK-001.md','tasks/TSK-002.md','tasks/TSK-003.md','tasks/TSK-004.md'].every(r => g(r,'updated') === LATER));
  ok('EPIC untouched', g('epics/EPIC-001.md','updated') === NOW);
}

// ---------------------------------------------------------------- (d) --file at dangling symlink
console.log('\n[d] --file at a dangling symlink');
{
  const d = mk('dangling', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n') }, ['EPIC-001','TSK-009']);
  const bl = path.join(d, 'backlog'); const link = path.join(bl, 'tasks', 'TSK-009.md');
  fs.symlinkSync(path.join(bl, 'gone.md'), link);
  ok('cwd is under /tmp (symlinked)', d.startsWith('/tmp/'));
  const s = run(['set','--file=' + link,'--status=doing','--json'], d);
  ok('set --file=<dangling, /tmp path> → refused:unreadable', s.json && s.json.error === 'refused:unreadable', s.out);
  const s2 = run(['set','--file=' + link.replace(/^\/tmp/, '/private/tmp'),'--status=doing','--json'], d);
  ok('set --file=<dangling, /private/tmp path> → refused:unreadable', s2.json && s2.json.error === 'refused:unreadable', s2.out);
  const s3 = run(['set','--file=tasks/TSK-009.md','--status=doing','--json'], d);
  ok('set --file=<dangling, relative> → refused:unreadable', s3.json && s3.json.error === 'refused:unreadable', s3.out);
  const sh = run(['show','--file=' + link,'--json'], d);
  ok('show --file=<dangling> reaches the stub', sh.json && sh.json.entries.length === 1 && sh.json.entries[0]._problems.includes('file:unreadable'), sh.out);
  const nf = run(['show','--file=tasks/NOPE.md','--json'], d);
  ok('show --file=<nonexistent> → not_found', nf.json && nf.json.error === 'not_found');
  const rmr = run(['rm','--file=' + link,'--json'], d);
  ok('rm --file=<dangling> deletes the link (exit ' + rmr.status + ')', rmr.status === 0 && !fs.existsSync(link) && (() => { try { fs.lstatSync(link); return false; } catch { return true; } })(), rmr.out + rmr.err);
}

// ---------------------------------------------------------------- (e) empty known field vs empty unknown key
console.log('\n[e] empty-value rule');
{
  const raw = '---\nid: TSK-001\ntype:\nparent: EPIC-001\ntitle: Empty\nstatus:\npriority:\nassignee:\ntags:\ndepends_on:\ncreated:\nupdated:\ncustom:\ncustom2: ""\ncustom3: \n---\n\n' + complete('Empty');
  const d = mk('empty', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-001.md': raw }, ['EPIC-001','TSK-001']);
  const bl = path.join(d, 'backlog'); fs.utimesSync(path.join(bl,'tasks','TSK-001.md'), new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));
  const pre = run(['doctor','--json'], d).json.problems.filter(p => p.element === 'TSK-001').map(p => p.code).sort();
  ok('empty known fields reported as absent: type:derived, missing:status, missing:created, missing:updated; NOT frontmatter:unreadable', JSON.stringify(pre) === JSON.stringify(['missing:created','missing:status','missing:updated','type:derived']), JSON.stringify(pre));
  const e0 = run(['list','--json'], d).json.entries.find(e => e.id === 'TSK-001');
  ok('empty priority → normal, no unknown:priority', e0.priority === 'normal' && !e0._problems.includes('unknown:priority'), JSON.stringify(e0));
  const fx = run(['doctor','--fix'], d, {}, LATER);
  const after = rd(path.join(bl,'tasks','TSK-001.md'));
  console.log('    after --fix:\n      ' + after.split('\n').slice(0, 14).join('\n      '));
  ok('--fix filled type, status, created(mtime), updated', /^type: task$/m.test(after) && /^status: todo$/m.test(after) && /^created: 2020-01-02T03:04:05Z$/m.test(after) && /^updated: 2026-09-21T19:30:00Z$/m.test(after), after);
  ok('empty known optional fields dropped (priority/assignee/tags/depends_on lines gone)', !/^(priority|assignee|tags|depends_on):/m.test(after), after);
  ok('unknown keys keep an (empty) value: custom, custom2, custom3 all present', /^custom: ""$/m.test(after) && /^custom2: ""$/m.test(after) && /^custom3: ""$/m.test(after), after);
  const post = run(['doctor','--json'], d).json.problems.filter(p => p.element === 'TSK-001').map(p => p.code);
  ok('doctor clean on TSK-001 after --fix', post.length === 0, JSON.stringify(post));
  // set with empty title → refuses; title: empty in file → missing:title, --fix never fills
  const d2 = mk('empty-title', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-001.md': '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle:\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n\n' + complete('X') }, ['EPIC-001','TSK-001']);
  const h = sha(rd(path.join(d2,'backlog','tasks','TSK-001.md')));
  ok('title: (empty) → missing:title error', run(['doctor','--json'], d2).json.problems.some(p => p.code === 'missing:title' && p.element === 'TSK-001'));
  run(['doctor','--fix'], d2, {}, LATER);
  ok('--fix never invents a title (file byte-identical)', sha(rd(path.join(d2,'backlog','tasks','TSK-001.md'))) === h);
  ok('set --title repairs it', run(['set','--id=TSK-001','--title=Fixed','--json'], d2, {}, LATER).json.ok === true);
}

// ---------------------------------------------------------------- (f) new with unreadable stub as parent
console.log('\n[f] nj new with an unreadable parent');
{
  const d = mk('stubparent', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')),
    'tasks/TSK-003.md': '---\nid: TSK-003\ntype: task\nparent: EPIC-001\nbroken line here\ntitle: Broken\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n\n' + complete('Broken') }, ['EPIC-001','TSK-001','TSK-002','TSK-003']);
  const bl = path.join(d, 'backlog');
  fs.symlinkSync(path.join(bl, 'gone.md'), path.join(bl, 'tasks', 'TSK-002.md'));
  fs.chmodSync(path.join(bl, 'tasks', 'TSK-001.md'), 0o000);
  const before = sums(d); const tombs = fs.readdirSync(path.join(bl, '.ids')).sort();
  const r1 = run(['new','--type=subtask','--parent=TSK-002','--title=x','--json'], d);
  ok('dangling-symlink parent → refused:unreadable', r1.status === 1 && r1.json && r1.json.error === 'refused:unreadable', r1.out);
  const r2 = run(['new','--type=subtask','--parent=TSK-001','--title=x','--json'], d);
  ok('chmod-000 parent → refused:unreadable', r2.status === 1 && r2.json && r2.json.error === 'refused:unreadable', r2.out);
  const r3 = run(['new','--type=subtask','--parent=TSK-003','--title=x','--json'], d);
  ok('frontmatter-unreadable parent → refused:unreadable (code says both)', r3.status === 1 && r3.json && r3.json.error === 'refused:unreadable', r3.out);
  ok('nothing written, no tombstone burnt', JSON.stringify(sums(d)) === JSON.stringify(before) && JSON.stringify(fs.readdirSync(path.join(bl, '.ids')).sort()) === JSON.stringify(tombs), fs.readdirSync(path.join(bl, '.ids')).join());
  fs.chmodSync(path.join(bl, 'tasks', 'TSK-001.md'), 0o644);
  ok('readable parent still works', run(['new','--type=subtask','--parent=TSK-001','--title=x','--json'], d).json.ok === true);
}

// ---------------------------------------------------------------- spec rulings
console.log('\n[spec] new §9 table / rm dependents / archive --force');
{
  const d = mk('rulings', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'),
    'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')) }, ['EPIC-001','TSK-001']);
  const w1 = run(['new','--type=task','--parent=TSK-001','--title=x','--json'], d);
  ok('§9 table: task under a TASK parent → invalid_target', w1.json && w1.json.error === 'invalid_target', JSON.stringify(w1.json));
  const w2 = run(['new','--type=subtask','--parent=EPIC-001','--title=x','--json'], d);
  ok('§9 table: subtask under an EPIC parent → invalid_target', w2.json && w2.json.error === 'invalid_target', JSON.stringify(w2.json));
  const w3 = run(['new','--type=epic','--parent=EPIC-001','--title=x','--json'], d);
  console.log('    note: epic with --parent → ' + (w3.json && w3.json.error));
  const rmj = run(['rm','--id=TSK-001','--json'], mk('rulings2', { 'epics/EPIC-001.md': el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'), 'tasks/TSK-001.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')) }, ['EPIC-001','TSK-001'])).json;
  ok('rm JSON carries dependents: [] even when none', rmj && Array.isArray(rmj.dependents) && rmj.dependents.length === 0, JSON.stringify(rmj));
  for (const [args, code] of [[['set','--id=TSK-001','--status=typo'], 'invalid_value'], [['list','--parent=NOPE'], 'not_found'], [['set','--file=nope.md','--status=done'], 'not_found'], [['set','--id=TSK-001','--depends-on=NOPE'], 'not_found'], [['new','--type=task','--parent=NOPE','--title=x'], 'not_found'], [['set','--id=TSK-001'], undefined]]) {
    const x = run(args.concat(['--json']), d);
    if (code) ok(`${args.join(' ')} → ${code}`, x.json && x.json.error === code, JSON.stringify(x.json)); else console.log('    note: set with no field flags → exit ' + x.status + ' ' + JSON.stringify(x.json && (x.json.error || x.json.changed)));
  }
}
console.log(`\n${n - bad}/${n} checks passed, ${bad} failed`);
