'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
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
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
function el(f, body) { const order = ['id','type','parent','title','status','priority','assignee','tags','depends_on','created','updated','archived']; const keys = order.filter(k => f[k] !== undefined).concat(Object.keys(f).filter(k => !order.includes(k))); return '---\n' + keys.map(k => k + ': ' + f[k]).join('\n') + '\n---\n\n' + (body || ''); }
const complete = t => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
function sums(d) { const out = {}; const bl = path.join(d, 'backlog'); for (const dir of ['epics','tasks','subtasks','archive']) { let names = []; try { names = fs.readdirSync(path.join(bl, dir)).sort(); } catch {} for (const nme of names) { const c = rd(path.join(bl, dir, nme)); out[dir + '/' + nme] = c === null ? '<unreadable>' : sha(c); } } return out; }
function mk(label) {
  const d = fs.mkdtempSync(SCRATCH_BASE + '/r3bc-' + label + '-'); const bl = path.join(d, 'backlog');
  for (const s of ['epics','tasks','subtasks','archive','.ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  fs.writeFileSync(path.join(bl, '.nanojira.json'), CFG);
  fs.writeFileSync(path.join(bl, 'epics', 'EPIC-001.md'), el({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'done', created: NOW, updated: NOW }, '# E\n\n## Description\nD\n'));
  fs.writeFileSync(path.join(bl, 'tasks', 'TSK-001.md'), el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'done', created: NOW, updated: NOW }, complete('T')));
  for (const t of ['EPIC-001','TSK-001']) fs.writeFileSync(path.join(bl, '.ids', t), '');
  return d;
}
function start(args, cwd, env) {
  const c = spawn(process.execPath, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: LATER, NJ_FAULT: 'before-compare' }, env || {}) });
  let out = '', err = ''; c.stdout.on('data', x => out += x); c.stderr.on('data', x => err += x);
  return new Promise(r => c.on('close', code => r({ status: code, out, err })));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (d, c, x) => { if (!c) bad++; console.log((c ? '  ✓ ' : '  ✗ ') + d + (c ? '' : '\n      ' + String(x).slice(0, 600))); };
(async () => {
  console.log('[g] archive under NJ_FAULT=before-compare');
  { // parallel change to the CHILD while archive waits → abort, nothing moved
    const d = mk('par'); const before = sums(d); const child = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
    const p = start(['archive','--id=EPIC-001','--json'], d); await sleep(800);
    const par = el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T edited', status: 'done', created: NOW, updated: LATER }, complete('T edited'));
    fs.writeFileSync(child, par); fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await p; let j = null; try { j = JSON.parse(r.out); } catch {}
    ok('parallel change to a child → exit 1, changed_in_parallel', r.status === 1 && j && j.error === 'changed_in_parallel', r.out + r.err);
    const after = sums(d); const exp = Object.assign({}, before, { 'tasks/TSK-001.md': sha(par) });
    ok('nothing moved: epic byte-identical, child = parallel bytes, archive/ empty', JSON.stringify(after) === JSON.stringify(exp), JSON.stringify(after));
    ok('hint does not offer --force', !/--force/.test(j.hint || ''), j.hint);
  }
  { // marker only, no change → archives
    const d = mk('go'); const p = start(['archive','--id=EPIC-001','--json'], d); await sleep(800);
    fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), ''); const r = await p; let j = null; try { j = JSON.parse(r.out); } catch {}
    ok('marker without change → exit 0, both archived', r.status === 0 && j && j.ids.length === 2 && Object.keys(sums(d)).every(k => k.startsWith('archive/')), r.out + r.err);
  }
  { // timeout → exit 1, nothing moved, ~10 s
    const d = mk('to'); const before = sums(d); const t0 = Date.now(); const r = await start(['archive','--id=EPIC-001','--json'], d); const ms = Date.now() - t0; let j = null; try { j = JSON.parse(r.out); } catch {}
    ok('timeout → exit 1 fault:before-compare after ~10 s (' + ms + ' ms), nothing moved', r.status === 1 && j && j.error === 'fault:before-compare' && ms >= 9500 && ms < 12000 && JSON.stringify(sums(d)) === JSON.stringify(before), r.out + r.err);
  }
  { // set --force still passes through the hook (regression)
    const d = mk('force'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
    const p = start(['set','--id=TSK-001','--status=doing','--force','--json'], d); await sleep(800);
    fs.writeFileSync(f, el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'review', created: NOW, updated: LATER }, complete('T'))); fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await p; ok('set --force still writes through after the hook', r.status === 0 && /^status: doing$/m.test(rd(f)), r.err);
  }
  console.log(bad === 0 ? 'ALL OK' : bad + ' FAILED');
})();
