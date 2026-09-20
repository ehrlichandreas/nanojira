import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || os.tmpdir();
import { track } from './lib/cleanup.ts';
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || path.join(import.meta.dirname, '..', '..', '..', 'src', 'nj.ts');
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo', 'doing', 'blocked', 'review', 'done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
let n = 0, bad = 0;
function ok(desc: string, cond: unknown, detail?: unknown): void { n++; if (!cond) { bad++; console.log('  ✗ ' + desc + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); } else console.log('  ✓ ' + desc); }
function el(f: Record<string, any>, body?: string): string { const order = ['id', 'type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived']; const keys = order.filter((k) => f[k] !== undefined).concat(Object.keys(f).filter((k) => !order.includes(k))); return '---\n' + keys.map((k) => k + ': ' + f[k]).join('\n') + '\n---\n\n' + (body || ''); }
const complete = (t: string) => '# ' + t + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
function mk(label: string, files?: Record<string, string>, tomb?: string[]): string { const d = track(fs.mkdtempSync(path.join(SCRATCH_BASE, 'r5-' + label + '-'))); const bl = path.join(d, 'backlog'); for (const s of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira/ids']) fs.mkdirSync(path.join(bl, s), { recursive: true }); fs.writeFileSync(path.join(bl, '.nanojira/config.json'), CFG); for (const [rel, c] of Object.entries(files || {})) fs.writeFileSync(path.join(bl, rel), c); for (const t of tomb || []) fs.writeFileSync(path.join(bl, '.nanojira/ids', t), ''); return d; }
interface RunResult { status: number | null; out: string; err: string; json: any; }
function run(args: string[], cwd: string, env?: Record<string, string>, now?: string): RunResult { const r = spawnSync(process.execPath, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: now || NOW }, env || {}), encoding: 'utf8', timeout: 20000 }); let json: any = null; try { json = JSON.parse(r.stdout); } catch {} return { status: r.status, out: r.stdout, err: r.stderr, json }; }
const keys = (o: Record<string, any> | null | undefined) => Object.keys(o || {}).sort().join(',');
const E = (id: string, st?: string) => el({ id, type: 'epic', title: id, status: st || 'todo', created: NOW, updated: NOW }, '# ' + id + '\n\n## Description\nD\n');
const T = (id: string, parent: string, extra?: Record<string, any>) => el(Object.assign({ id, type: id.startsWith('SUB') ? 'subtask' : 'task', parent, title: id, status: 'todo', created: NOW, updated: NOW }, extra || {}), complete(id));

console.log('[sweep] every command JSON shape vs §9 table');
{
  const d = mk('sweep', { 'epics/EPIC-001.md': E('EPIC-001'), 'epics/EPIC-002.md': E('EPIC-002', 'done'), 'tasks/TSK-001.md': T('TSK-001', 'EPIC-001'), 'tasks/TSK-002.md': T('TSK-002', 'EPIC-002', { status: 'done', depends_on: '[TSK-001]' }), 'subtasks/SUB-001.md': T('SUB-001', 'TSK-001'), 'archive/EPIC-009.md': el({ id: 'EPIC-009', type: 'epic', title: 'old', status: 'done', created: NOW, updated: NOW, archived: NOW }, '# old\n\n## Description\nD\n') }, ['EPIC-001', 'EPIC-002', 'EPIC-009', 'TSK-001', 'TSK-002', 'SUB-001']);
  const j = (args: string[], now?: string) => run(args.concat(['--json']), d, {}, now).json;
  ok('list → {backlog,counts,entries}', keys(j(['list'])) === 'backlog,counts,entries');
  ok('list --ready → same read shape', keys(j(['list', '--ready'])) === 'backlog,counts,entries');
  ok('show → {backlog,counts,entries}', keys(j(['show', '--id=TSK-001'])) === 'backlog,counts,entries');
  ok('tree → {backlog,counts,entries}, entries flat with parent', keys(j(['tree'])) === 'backlog,counts,entries' && j(['tree']).entries.some((e: any) => e.parent === 'EPIC-001'));
  ok('bare nj → {backlog,counts,incomplete,ready}', keys(j([])) === 'backlog,counts,incomplete,ready');
  ok('counts → {errors,incomplete,total}', keys(j(['list']).counts) === 'errors,incomplete,total');
  const entry = j(['list']).entries[0];
  ok('entry carries _problems (plus additive file)', Array.isArray(entry._problems) && 'file' in entry, keys(entry));
  const doc = j(['doctor']);
  ok('doctor → {backlog,ok,problems}', keys(doc) === 'backlog,ok,problems', keys(doc));
  const nw = j(['new', '--type=task', '--parent=EPIC-001', '--title=N'], LATER);
  ok('new → {_problems,changed,entry,id,ok}', keys(nw) === '_problems,changed,entry,id,ok', keys(nw));
  const st = j(['set', '--id=TSK-001', '--priority=high'], LATER);
  ok('set → {_problems,changed,entry,id,ok}', keys(st) === '_problems,changed,entry,id,ok', keys(st));
  const nt = j(['note', '--id=TSK-001', 'hi'], LATER);
  ok('note → {_problems,changed,entry,id,ok}, changed [body]', keys(nt) === '_problems,changed,entry,id,ok' && JSON.stringify(nt.changed) === '["body"]', keys(nt));
  const rm = j(['rm', '--id=SUB-001']);
  ok('rm → {_problems,changed,dependents,entry,id,ok}', keys(rm) === '_problems,changed,dependents,entry,id,ok', keys(rm));
  const ar = j(['archive', '--id=EPIC-002'], LATER);
  ok('archive (TSK-002 in subtree depends on live TSK-001; live nothing depends on moved) → {_problems,changed,entries,ids,ok}', keys(ar) === '_problems,changed,entries,ids,ok', keys(ar));
  const rc = j(['rm', '--id=EPIC-001', '--cascade']);
  ok('rm --cascade → {_problems,changed,dependents,entries,ids,ok}; dependents names archived TSK-002? (it depends on deleted TSK-001)', keys(rc) === '_problems,changed,dependents,entries,ids,ok', keys(rc) + ' ' + JSON.stringify(rc && rc.dependents));
  console.log('    note: rm --cascade dependents = ' + JSON.stringify(rc && rc.dependents) + ' (TSK-002 is archived and depends on deleted TSK-001)');
  const fl = j(['set', '--id=NOPE', '--status=done']);
  ok('failure → {error,ok} (+hint optional)', keys(fl) === 'error,ok' || keys(fl) === 'error,hint,ok', keys(fl));
  const init = run(['init', '--json'], track(fs.mkdtempSync(SCRATCH_BASE + '/r5-init-'))).json;
  console.log('    note: init --json → ' + keys(init) + ' (no §9 row for init)');
  const fx = j(['doctor', '--fix'], LATER);
  ok('doctor --fix → {backlog,fixed,notes,ok,problems}', keys(fx) === 'backlog,fixed,notes,ok,problems', keys(fx));
  const pk = new Set<string>(); for (const p of doc.problems) Object.keys(p).forEach((k) => pk.add(k));
  ok('doctor problem objects ⊆ {code,severity,element,file,line,message}', [...pk].every((k) => ['code', 'severity', 'element', 'file', 'line', 'message'].includes(k)), [...pk].join());
  // new §9 rows
  ok('--id + --file → invalid_target', j(['set', '--id=TSK-001', '--file=tasks/TSK-001.md', '--status=done']).error === 'invalid_target');
  ok('--parent on an epic → invalid_value', j(['new', '--type=epic', '--parent=EPIC-001', '--title=x']).error === 'invalid_value');
}

console.log('\n[§14] reporting wording vs behaviour');
{
  const epic = E('EPIC-001');
  // repairable-only → 0 ; fixed[] non-empty, problems [] , notes []
  const d1 = mk('fix0', { 'epics/EPIC-001.md': epic, 'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'T', status: 'todo' }, complete('T')) }, ['EPIC-001', 'TSK-001']);
  const r1 = run(['doctor', '--fix', '--json'], d1, {}, LATER);
  ok('repairable-only → exit 0, ok true, fixed[] lists actions, problems [] , notes []', r1.status === 0 && r1.json.ok === true && r1.json.fixed.length >= 1 && r1.json.problems.length === 0 && r1.json.notes.length === 0, JSON.stringify(r1.json));
  // remaining error → 2 ; problems reflects post-state (duplicate_id) ; fixed[] still lists actions
  const d2 = mk('fix2', { 'epics/EPIC-001.md': epic, 'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'A', status: 'todo' }, complete('A')), 'tasks/TSK-002.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'B', status: 'todo', created: NOW, updated: NOW }, complete('B')) }, ['EPIC-001', 'TSK-001', 'TSK-002']);
  const r2 = run(['doctor', '--fix', '--json'], d2, {}, LATER);
  ok('remaining error (duplicate_id) → exit 2, ok false, fixed[] non-empty, problems has duplicate_id and no missing:* (post-state)', r2.status === 2 && r2.json.ok === false && r2.json.fixed.length >= 1 && r2.json.problems.some((p: any) => p.code === 'duplicate_id') && !r2.json.problems.some((p: any) => p.code.startsWith('missing:') || p.code === 'type:derived'), JSON.stringify(r2.json.problems.map((p: any) => p.code)) + ' fixed=' + JSON.stringify(r2.json.fixed));
  // surviving warning → 0 ; problems lists the warning
  const d3 = mk('fixw', { 'epics/EPIC-001.md': E('EPIC-001', 'weird'), 'tasks/TSK-001.md': el({ id: 'TSK-001', parent: 'EPIC-001', title: 'T', status: 'todo' }, complete('T')) }, ['EPIC-001', 'TSK-001']);
  const r3 = run(['doctor', '--fix', '--json'], d3, {}, LATER); const r3h = run(['doctor', '--fix'], d3, {}, '2026-09-21T20:00:00Z');
  ok('surviving warning (unknown:status) → exit 0, ok true, problems lists the warning with severity warning', r3.status === 0 && r3.json.ok === true && r3.json.problems.some((p: any) => p.code === 'unknown:status' && p.severity === 'warning'), JSON.stringify(r3.json));
  ok('human: "Nothing to fix." on the second run, WARNING still listed, exit 0', r3h.status === 0 && /Nothing to fix/.test(r3h.out) && /WARNING/.test(r3h.out), r3h.out);
  // notes[] populated: unparsable-line file skipped
  const d4 = mk('fixn', { 'epics/EPIC-001.md': epic, 'tasks/TSK-001.md': '---\nid: TSK-001\nparent: EPIC-001\nbroken\ntitle: T\nstatus: todo\n---\n\n' + complete('T') }, ['EPIC-001', 'TSK-001']);
  const r4 = run(['doctor', '--fix', '--json'], d4, {}, LATER);
  ok('notes[] carries the skip note, problems keeps frontmatter:unreadable, exit 2', r4.status === 2 && r4.json.notes.length === 1 && /TSK-001/.test(r4.json.notes[0]) && r4.json.problems.some((p: any) => p.code === 'frontmatter:unreadable'), JSON.stringify(r4.json));
  // error repaired → 0
  const d5 = mk('fixe', { 'epics/EPIC-001.md': epic, 'tasks/TSK-009.md': el({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T', status: 'todo', created: NOW, updated: NOW }, complete('T')) }, ['EPIC-001', 'TSK-001']);
  const r5 = run(['doctor', '--fix', '--json'], d5, {}, LATER);
  ok('error repaired (id:mismatch → renamed) → exit 0, fixed names the rename, problems []', r5.status === 0 && r5.json.fixed.some((f: string) => /renamed/.test(f)) && r5.json.problems.length === 0, JSON.stringify(r5.json));
}
console.log(`\n${n - bad}/${n} checks passed, ${bad} failed`);
