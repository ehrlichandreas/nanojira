import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import { track } from './lib/cleanup.ts';
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || os.tmpdir();
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || path.join(import.meta.dirname, '..', '..', '..', 'src', 'nj.ts');
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo', 'doing', 'blocked', 'review', 'done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const orig = (st: string, up: string) => `---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: T\nstatus: ${st}\ncreated: ${NOW}\nupdated: ${up}\n---\n\n# T\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n`;
function mk(label: string): string {
  const d = track(fs.mkdtempSync(SCRATCH_BASE + '/' + label + '-')); const bl = path.join(d, 'backlog');
  for (const s of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira/ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  fs.writeFileSync(path.join(bl, '.nanojira/config.json'), CFG); fs.writeFileSync(path.join(bl, 'tasks', 'TSK-001.md'), orig('todo', NOW)); fs.writeFileSync(path.join(bl, '.nanojira/ids', 'TSK-001'), '');
  return d;
}
interface StartResult {
  status: number | null;
  out: string;
  err: string;
}
function start(args: string[], cwd: string, env?: Record<string, string>): Promise<StartResult> {
  const c = spawn(process.execPath, [NJ].concat(args), { cwd, env: Object.assign({}, process.env, { NJ_NOW: LATER, NJ_FAULT: 'before-compare' }, env || {}) });
  let out = '', err = ''; c.stdout.on('data', (x) => out += x); c.stderr.on('data', (x) => err += x);
  return new Promise((r) => c.on('close', (code) => r({ status: code, out, err })));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let bad = 0; const ok = (d: string, c: unknown, x?: unknown) => { if (!c) bad++; console.log((c ? '  ✓ ' : '  ✗ ') + d + (c ? '' : '\n      ' + String(x).slice(0, 500))); };
(async () => {
  // leg 1: parallel change, no --force → exit 1, file keeps parallel bytes
  { const d = mk('bc1'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
    const p = start(['set', '--id=TSK-001', '--status=doing', '--json'], d); await sleep(800);
    const par = orig('review', LATER); fs.writeFileSync(f, par); fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await p; let j: any = null; try { j = JSON.parse(r.out); } catch {}
    ok('set: exit 1 on parallel change', r.status === 1, r.err);
    ok('set: JSON {ok:false,error:changed_in_parallel,hint}', j && j.ok === false && j.error === 'changed_in_parallel' && /--force/.test(j.hint || ''), r.out);
    ok('set: prose on stderr says changed in parallel', /changed in parallel/.test(r.err), r.err);
    ok('set: file keeps the parallel bytes exactly', sha(fs.readFileSync(f, 'utf8')) === sha(par));
    ok('set: no stray tmp file', !fs.readdirSync(path.join(d, 'backlog', 'tasks')).some((n) => n.startsWith('.nj-tmp-')), fs.readdirSync(path.join(d, 'backlog', 'tasks')).join());
  }
  // leg 2: --force → exit 0, nj's value wins but on top of the parallel bytes? (force overwrites with nj's render of ITS read)
  { const d = mk('bc2'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
    const p = start(['set', '--id=TSK-001', '--status=doing', '--force', '--json'], d); await sleep(800);
    fs.writeFileSync(f, orig('review', LATER)); fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await p; const after = fs.readFileSync(f, 'utf8');
    ok('--force: exit 0', r.status === 0, r.err);
    ok('--force: status: doing written', /^status: doing$/m.test(after), after);
    console.log('    note: --force result equals render of nj\'s own first read (parallel edit discarded): ' + (after === orig('doing', LATER)));
  }
  // leg 3: note path honours the hook too
  { const d = mk('bc3'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
    const p = start(['note', '--id=TSK-001', 'hello'], d); await sleep(800);
    const par = orig('review', LATER); fs.writeFileSync(f, par); fs.writeFileSync(path.join(d, 'backlog', '.nj-fault-go'), '');
    const r = await p; ok('note: exit 1 on parallel change, bytes kept', r.status === 1 && sha(fs.readFileSync(f, 'utf8')) === sha(par), r.err);
  }
  // leg 4: timeout, no marker → exit 1 near 10 s, no write, JSON shape
  { const d = mk('bc4'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md'); const t0 = Date.now();
    const r = await start(['set', '--id=TSK-001', '--status=doing', '--json'], d); const el = Date.now() - t0; let j: any = null; try { j = JSON.parse(r.out); } catch {}
    ok('timeout: exit 1', r.status === 1, r.err);
    ok('timeout: elapsed within 9.5–12 s (' + el + ' ms)', el >= 9500 && el < 12000);
    ok('timeout: file untouched', fs.readFileSync(f, 'utf8') === orig('todo', NOW));
    ok('timeout: JSON {ok:false,error:fault:before-compare} on stdout', j && j.ok === false && j.error === 'fault:before-compare', r.out);
    ok('timeout: prose on stderr', /timed out/.test(r.err), r.err);
  }
  // leg 5: the archive asymmetry — before-compare is NOT honoured; parallel change mid-archive is still caught by its inline compare (marker written immediately)
  { const d = mk('bc5'); const f = path.join(d, 'backlog', 'tasks', 'TSK-001.md'); fs.writeFileSync(f, orig('done', NOW));
    const t0 = Date.now(); const r = await start(['archive', '--id=TSK-001', '--json'], d); const el = Date.now() - t0;
    ok('archive ignores NJ_FAULT=before-compare (returns immediately, exit ' + r.status + ', ' + el + ' ms)', r.status === 0 && el < 3000, r.err);
  }
  // leg 6: hook without --json: nothing on stdout
  { const d = mk('bc6'); const r = await start(['set', '--id=TSK-001', '--status=doing'], d);
    ok('timeout without --json: stdout empty, stderr prose', r.out === '' && r.err.length > 0, r.out); }
  console.log(bad === 0 ? 'ALL OK' : bad + ' FAILED');
})();
