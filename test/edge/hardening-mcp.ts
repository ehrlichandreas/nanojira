/* nanojira-mcp hardening (TSK-035, improvement survey #3, DECISIONS 214).
 *
 * Each leg drives `nanojira-mcp` over stdio, against a real backlog (or, for
 * the process-level legs, a fake `nanojira.mjs` sibling in a copied shipped
 * unit, so a child can be made to hang or read its stdin on purpose):
 *
 *   X1  note text that looks like a flag is stored as text: `--text-file=<path>`
 *       never reads that file, `--force-push was needed` is an ordinary note
 *   X2  find text that looks like a flag is searched for, not parsed; the
 *       CLI takes `find --text=<t>` as the positional text's twin
 *   X3  no tool schema has a `*-file` field; a call naming one is -32602
 *       before any child runs, and the file it names is never read
 *   X4  a child's stdin is not a pipe left open: a child that reads stdin
 *       gets EOF at once instead of hanging the call
 *   X5  a child that never finishes is killed after the per-call timeout
 *       (shortened in a patched copy) and the call gets -32603
 *   X6  a JSON line that is not an object (a string, a number, null, an
 *       array) is -32600 with id null, and the server keeps running
 *   X7  stdin EOF lets an in-flight call finish and answer before the
 *       server exits 0
 *   X8  multibyte UTF-8 split across the child's output chunks arrives intact
 *   X9  an error result carries nanojira's own message, not only the code
 *   X10 a write whose NJ_ON_CHANGE hook backgrounds a job (`sleep 20 &`)
 *       answers at once, not when the job ends (TSK-036, DECISIONS 217)
 *   X11 a hook job that left the hook's group (setsid) but still holds
 *       nanojira's stderr: the call answers success once the child has
 *       exited and its stdout has ended, not when stderr closes, and the
 *       server exits at EOF without waiting for the job (D214, revised)
 *   X12 `--backlog <path>` (the space form MCP client configs often use)
 *       serves that backlog, as `--backlog=<path>` does (DECISIONS 230)
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import * as MCP from '../lib/mcp-stdio.ts';
import type { McpServerDriver } from '../lib/mcp-stdio.ts';
const T = H.T;
const J = (v: unknown) => JSON.stringify(v);
const NOW = '2026-01-01T00:00:00Z';

H.requireNj();
H.requireNjMcp();

interface Model { dir: string; bl: string }

function model(label: string): Model {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const env = { NJ_NOW: NOW };
  for (const args of [['init'], ['new', '--type=epic', '--title=Epic', '--description=D.'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=Task', '--description=D.', '--acceptance=- [ ] x']]) {
    const r = H.runNj(args, { cwd: dir, env });
    if (r.status !== 0) T.check('fixture: nanojira ' + args.join(' '), false, r.status + ' ' + J(r.stderr));
  }
  return { dir, bl };
}

async function withServer(mcpPath: string, x: Model, env: Record<string, string | undefined>, fn: (s: McpServerDriver) => Promise<void>) {
  const s = MCP.spawnServer(mcpPath, ['--backlog=' + x.bl], { cwd: x.dir, env: Object.assign({ NJ_NOW: NOW }, env) });
  try { await fn(s); } finally { await s.close(); }
}

/* A call that must answer; a hang or a dead server is one failed check. */
async function call(s: McpServerDriver, what: string, name: string, args: Record<string, unknown>, timeout = 15000) {
  try {
    return await s.modernToolsCall(name, args, { timeout });
  } catch (e) {
    T.check(what + ': answered', false, String(e && (e as Error).message) + ' stderr=' + s.stderr().slice(0, 500));
    return null;
  }
}

const sc = (r: any) => (r && r.result && r.result.structuredContent) || null;
const taskFile = (x: Model) => path.join(x.bl, 'tasks', 'TSK-001.md');

/* ---- X1 note text is text ------------------------------------------------- */
{
  const x = model('mcp-x1');
  const secret = path.join(H.freshDir('mcp-x1-secret'), 'secret.txt');
  fs.writeFileSync(secret, 'TOP-SECRET-X1\n');
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    const r = await call(s, 'X1 --text-file=<path> as note text', 'note', { id: 'TSK-001', as: 'alice', text: '--text-file=' + secret });
    T.check('X1 a note text "--text-file=<path>" succeeds', !!r && r.result && r.result.isError === false && sc(r).ok === true, J(r));
    const body = H.readOrNull(taskFile(x)) || '';
    T.check('X1 ... the file it names is never read into the backlog', !body.includes('TOP-SECRET-X1'), body);
    T.check('X1 ... the text is stored as written', body.includes('alice: --text-file=' + secret), body);
    const r2 = await call(s, 'X1 "--force-push was needed"', 'note', { id: 'TSK-001', as: 'alice', text: '--force-push was needed' });
    T.check('X1 a note starting with "--" is an ordinary note, not unknown_field', !!r2 && sc(r2) && sc(r2).ok === true, J(r2));
    T.check('X1 ... and stored as written', (H.readOrNull(taskFile(x)) || '').includes('alice: --force-push was needed'), '');
    const r3 = await call(s, 'X1 "--text-file=-"', 'note', { id: 'TSK-001', as: 'alice', text: '--text-file=-' }, 10000);
    T.check('X1 a note text "--text-file=-" answers (no wait on stdin) and is stored', !!r3 && sc(r3) && sc(r3).ok === true, J(r3));
  });
}

/* ---- X2 find text is text ------------------------------------------------- */
{
  const x = model('mcp-x2');
  H.runNj(['note', '--id=TSK-001', '--as=bob', '--text=ran --status=done by hand'], { cwd: x.dir, env: { NJ_NOW: NOW } });
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    const r = await call(s, 'X2 find "--status=done"', 'find', { text: '--status=done' });
    const ids = ((sc(r) || {}).entries || []).map((e: any) => e.id);
    T.eq('X2 find text "--status=done" is searched for, finding the note that contains it', ids, ['TSK-001']);
    const r2 = await call(s, 'X2 find "--text-file=-"', 'find', { text: '--text-file=-' }, 10000);
    T.check('X2 find text "--text-file=-" answers: no match, no error', !!r2 && sc(r2) && Array.isArray(sc(r2).entries) && sc(r2).entries.length === 0, J(r2));
  });
  /* The CLI side: `find --text=` is the positional text's twin, one or the other. */
  const cli = (args: string[]) => H.runJson(['find', ...args], { cwd: x.dir, env: { NJ_NOW: NOW } });
  const byFlag = cli(['--text=--status=done']);
  T.eq('X2 CLI find --text=<t> finds what find "<t>" finds', (byFlag.json && byFlag.json.entries || []).map((e: any) => e.id),
    (cli(['by hand']).json.entries || []).map((e: any) => e.id));
  const both = cli(['hand', '--text=hand']);
  T.check('X2 CLI find with both the argument and --text: invalid_value', both.status === 1 && both.json && both.json.error === 'invalid_value', J(both.json));
  const empty = cli(['--text=']);
  T.check('X2 CLI find --text= (empty): invalid_value, as find ""', empty.status === 1 && empty.json && empty.json.error === 'invalid_value', J(empty.json));
}

/* ---- X3 no *-file fields --------------------------------------------------- */
{
  const x = model('mcp-x3');
  const secret = path.join(H.freshDir('mcp-x3-secret'), 'secret.txt');
  fs.writeFileSync(secret, 'TOP-SECRET-X3\n');
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    const list = await s.modernToolsList();
    const fileFields = ((list.result || {}).tools || []).flatMap((t: any) =>
      Object.keys((t.inputSchema || {}).properties || {}).filter((k) => k.endsWith('-file')).map((k) => t.name + '.' + k));
    T.eq('X3 no tool schema names a *-file field', fileFields, []);
    const before = H.readOrNull(taskFile(x));
    const r = await s.modernToolsCall('set', { id: 'TSK-001', 'description-file': secret });
    T.eq('X3 set with description-file is -32602 (Invalid params)', r.error && r.error.code, -32602);
    T.eq('X3 ... and the element is untouched', H.readOrNull(taskFile(x)), before);
    const r2 = await s.modernToolsCall('new', { type: 'epic', title: 'E2', 'acceptance-file': secret });
    T.eq('X3 new with acceptance-file is -32602', r2.error && r2.error.code, -32602);
  });
}

/* ---- X4/X5/X7: a fake nanojira.mjs sibling ------------------------------- */
/* Its behaviour is picked by the tool name: `list` reads stdin to the end
 * and reports how much it got; `doctor` writes its pid and never ends;
 * `tree` answers after 1.5 s. */
const FAKE = "import fs from 'node:fs';\n" +
  'const tool = process.argv[2];\n' +
  "const pidDir = process.env.X_PIDS || '';\n" +
  "if (tool === 'list') { const got = fs.readFileSync(0); process.stdout.write(JSON.stringify({ ok: true, stdinBytes: got.length })); }\n" +
  "else if (tool === 'doctor') { fs.writeFileSync(pidDir + '/doctor', String(process.pid)); setInterval(() => {}, 1000); }\n" +
  "else if (tool === 'tree') { setTimeout(() => process.stdout.write(JSON.stringify({ ok: true, slow: true })), 1500); }\n" +
  "else { process.stdout.write(JSON.stringify({ ok: true })); }\n";

function fakeUnit(label: string, patchMargin: boolean): { mcp: string; patched: boolean } {
  const unit = H.copyShippedUnit(H.freshDir(label));
  fs.writeFileSync(unit.njModule, FAKE);
  let patched = false;
  if (patchMargin) {
    const src = fs.readFileSync(unit.njMcpModule, 'utf8');
    patched = /^(?:const|var) CALL_MARGIN_S = \d+;$/m.test(src);
    fs.writeFileSync(unit.njMcpModule, src.replace(/^(const|var) CALL_MARGIN_S = \d+;$/m, '$1 CALL_MARGIN_S = 1;'));
  }
  return { mcp: unit.njMcp, patched };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

{
  const x = model('mcp-x4');
  const u = fakeUnit('mcp-x4-unit', false);
  await withServer(u.mcp, x, {}, async (s) => {
    const r = await call(s, 'X4 a child that reads stdin', 'list', {}, 8000);
    T.eq('X4 a child reading stdin gets EOF at once (no bytes), the call answers', sc(r), { ok: true, stdinBytes: 0 });
  });
}
{
  const x = model('mcp-x5');
  const u = fakeUnit('mcp-x5-unit', true);
  const pids = H.freshDir('mcp-x5-pids');
  T.check('X5 fixture: the per-call margin constant exists and was shortened', u.patched, '');
  await withServer(u.mcp, x, { X_PIDS: pids }, async (s) => {
    const t0 = Date.now();
    let r: any = null;
    try { r = await s.modernToolsCall('doctor', {}, { timeout: 12000 }); } catch (e) { r = { hung: String((e as Error).message) }; }
    const ms = Date.now() - t0;
    T.eq('X5 a child that never finishes: the call gets -32603 (Internal error)', r && r.error && r.error.code, -32603);
    T.check('X5 ... naming the timeout', /did not finish within 1 s/.test(J(r && r.error)), J(r));
    T.check('X5 ... soon after the timeout', ms < 8000, ms + ' ms');
    const pidFile = path.join(pids, 'doctor');
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
    let gone = false;
    for (let i = 0; i < 30 && !gone; i++) { gone = pid > 0 && !alive(pid); if (!gone) await new Promise((res) => setTimeout(res, 100)); }
    T.check('X5 ... and the child is gone', gone, 'pid ' + pid);
    if (pid > 0 && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    const r2 = await call(s, 'X5 a later call in the same session', 'show', { id: 'TSK-001' });
    T.check('X5 the server keeps answering afterwards', !!r2 && sc(r2) && sc(r2).ok === true, J(r2));
  });
}

/* ---- X6 non-object JSON lines --------------------------------------------- */
{
  const x = model('mcp-x6');
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    for (const v of ['hello', 42, null, [1, 2], true]) s.rawSend(v);
    const r = await s.modernToolsList().catch((e) => ({ dead: String((e as Error).message) }));
    T.check('X6 after 5 non-object lines the server still answers', !!(r as any).result, J(r));
    const answers = s.unsolicited();
    T.eq('X6 each non-object line got -32600 with id null',
      answers.map((m: any) => [m && m.id, m && m.error && m.error.code]), Array(5).fill([null, -32600]));
  });
}

/* ---- X7 stdin EOF with a call in flight ------------------------------------ */
{
  const x = model('mcp-x7');
  const u = fakeUnit('mcp-x7-unit', false);
  const s = MCP.spawnServer(u.mcp, ['--backlog=' + x.bl], { cwd: x.dir, env: { NJ_NOW: NOW } });
  const p = s.modernToolsCall('tree', {}, { timeout: 10000 }).catch((e) => ({ lost: String((e as Error).message) }));
  await new Promise((res) => setTimeout(res, 300));
  s.child.stdin!.end();
  const r: any = await p;
  const exit = await s.close();
  T.eq('X7 stdin EOF with a call in flight: the call still answers', sc(r), { ok: true, slow: true });
  T.eq('X7 ... then the server exits 0', exit && exit.status, 0);
}

/* ---- X8 multibyte UTF-8 across chunks -------------------------------------- */
{
  const x = model('mcp-x8');
  const text = 'é€😀'.repeat(12000) + ' end';
  const w = H.runNj(['note', '--id=TSK-001', '--as=carol', '--text=' + text], { cwd: x.dir, env: { NJ_NOW: NOW } });
  T.eq('X8 fixture: a ~130 KB multibyte note', w.status, 0);
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    const r = await call(s, 'X8 show --notes=all', 'show', { id: 'TSK-001', notes: 'all' });
    const notes = ((sc(r) || {}).entry || {}).notes || [];
    const got = notes.length ? notes[notes.length - 1].text : '';
    T.check('X8 the note arrives with no replacement character', !got.includes('�'), 'U+FFFD count ' + (got.match(/�/g) || []).length);
    T.check('X8 ... byte for byte', got === text, 'length ' + got.length + ' vs ' + text.length);
  });
}

/* ---- X9 error results carry the message ------------------------------------ */
{
  const x = model('mcp-x9');
  await withServer(H.NJ_MCP as string, x, {}, async (s) => {
    const r = await call(s, 'X9 note on a missing id', 'note', { id: 'TSK-999', as: 'alice', text: 'x' });
    T.check('X9 isError, with the unchanged {ok:false,error} body', !!r && r.result && r.result.isError === true && sc(r).error === 'not_found', J(r));
    const texts = ((r && r.result && r.result.content) || []).map((c: any) => c.text);
    T.check('X9 ... and a text block with nanojira\'s own message', texts.some((t: string) => /no element with id 'TSK-999'/.test(t)), J(texts));
    T.eq('X9 ... the first text block is still the JSON body', texts[0], J(sc(r)));
  });
}

/* ---- X10 a hook's backgrounded job does not hold the call ----------------- */
{
  const x = model('mcp-x10');
  const pids = H.freshDir('mcp-x10-pids');
  await withServer(H.NJ_MCP as string, x, { NJ_ON_CHANGE: 'sleep 20 & echo $! > "$X_PIDS/bg"', X_PIDS: pids }, async (s) => {
    const t0 = Date.now();
    const r = await call(s, 'X10 note with a hook that backgrounds sleep 20', 'note', { id: 'TSK-001', as: 'alice', text: 'hooked' }, 30000);
    const ms = Date.now() - t0;
    T.check('X10 the write succeeds', !!r && sc(r) && sc(r).ok === true, J(r));
    // 12 s: a loaded pool stretches the child's start; the job's 20 s stays out of reach.
    T.check('X10 ... and answers, not after the hook\'s backgrounded 20 s', ms < 12000, ms + ' ms');
    const pidFile = path.join(pids, 'bg');
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
    if (pid > 0 && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  });
}

/* ---- X11 a setsid'd hook job holding stderr does not hold the call -------- */
{
  const x = model('mcp-x11');
  const dir = H.freshDir('mcp-x11-esc');
  const esc = path.join(dir, 'escape.mjs');
  // a detached sleep (its own session) that inherits fd 2: nanojira's stderr
  fs.writeFileSync(esc, "import { spawn } from 'node:child_process';\nimport fs from 'node:fs';\n" +
    "const c = spawn('sleep', ['15'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });\nc.unref();\n" +
    "fs.writeFileSync(process.argv[2], String(c.pid));\n");
  const pidFile = path.join(dir, 'pid');
  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + x.bl], { cwd: x.dir,
    env: { NJ_NOW: NOW, NJ_ON_CHANGE: '"$X_NODE" "$X_ESC" "$X_PID"', X_NODE: process.execPath, X_ESC: esc, X_PID: pidFile } });
  const t0 = Date.now();
  const r = await call(s, 'X11 note with a hook that leaves a setsid job on stderr', 'note', { id: 'TSK-001', as: 'alice', text: 'escaped' }, 30000);
  const ms = Date.now() - t0;
  T.check('X11 the write answers success', !!r && sc(r) && sc(r).ok === true && r.result.isError === false, J(r));
  // 6 s: a loaded pool stretches the child's start; the job's 15 s stays out of reach.
  T.check('X11 ... promptly, not when the job lets go of stderr', ms < 6000, ms + ' ms');
  await s.close();
  const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
  T.check('X11 fixture: the hook started its job', pid > 0, '');
  if (pid > 0 && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  /* EOF with that call in flight: the server answers it and exits, while
   * the job still holds the child's stderr. */
  const pidFile2 = path.join(dir, 'pid2');
  const s2 = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + x.bl], { cwd: x.dir,
    env: { NJ_NOW: NOW, NJ_ON_CHANGE: '"$X_NODE" "$X_ESC" "$X_PID"', X_NODE: process.execPath, X_ESC: esc, X_PID: pidFile2 } });
  const t1 = Date.now();
  const p = s2.modernToolsCall('note', { id: 'TSK-001', as: 'alice', text: 'escaped at EOF' }, { timeout: 30000 }).catch((e) => ({ lost: String((e as Error).message) }));
  s2.child.stdin!.end();
  const r2: any = await p;
  const exit = await Promise.race([new Promise<number | null>((res) => s2.child.on('exit', (code) => res(code))),
    new Promise<string>((res) => setTimeout(() => res('still running after 10 s'), 10000))]);
  const exitMs = Date.now() - t1;
  T.check('X11 EOF with the call in flight: it still answers success', !!r2 && sc(r2) && sc(r2).ok === true, J(r2));
  T.eq('X11 ... and the server exits 0', s2.child.exitCode !== null ? s2.child.exitCode : exit, 0);
  T.check('X11 ... promptly, not when the job ends', exitMs < 6000, exitMs + ' ms');
  await s2.close();
  const pid2 = fs.existsSync(pidFile2) ? Number(fs.readFileSync(pidFile2, 'utf8')) : 0;
  if (pid2 > 0 && alive(pid2)) { try { process.kill(pid2, 'SIGKILL'); } catch { /* gone */ } }
}

/* ---- X12 --backlog <path>, the space form -------------------------------- */
{
  const x = model('mcp-x12');
  const elsewhere = H.freshDir('mcp-x12-cwd');
  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog', x.bl], { cwd: elsewhere, env: { NJ_NOW: NOW } });
  try {
    const r = await call(s, 'X12 list under --backlog <path>', 'list', {});
    T.check('X12 --backlog <path> serves that backlog', !!sc(r) && sc(r).backlog === x.bl
      && (sc(r).entries || []).some((e: any) => e.id === 'TSK-001'), J(r) + ' stderr=' + s.stderr().slice(0, 300));
  } finally { await s.close(); }
}

T.finish();
