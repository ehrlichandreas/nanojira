/* Edge — nanojira-mcp's tool schemas say what a call needs (TSK-041).
 *
 * Until now every tool's inputSchema was a bare list of typed properties:
 * no description, no `required`, no `enum`, and the write tools had no way
 * to ask for `--quiet`, `--fields` or `--dry-run` (survey #3 point 8, left
 * out of TSK-035, DECISIONS 214). An agent had to guess, and learnt the
 * rules only from failed calls. This file pins, through the real server:
 *
 * S1 every tool has a description, and every property one taken from the
 *    CLI's own `<command> --help` line for that flag (one source, so the
 *    two cannot drift): without the CLI-isms (`with --json:`, a flag
 *    spelled `--name`, "the positional argument"), and with the flag's
 *    value vocabulary appended when it holds `,` or `|` (TSK-041 review);
 * S2 `required` names exactly the fields no call can do without: `new`
 *    type and title, `find` text, `note` text; no other tool has any, and
 *    no schema uses a top-level anyOf/oneOf/allOf;
 * S3 `enum` on every `status` (the served backlog's configured statuses,
 *    here a custom set), `type` and `priority` property;
 * S4 `quiet`/`fields` on new/set/note/check/claim/release, `dry-run` on
 *    every write tool, `doctor`'s only next to `fix` (so only with
 *    `--allow-destructive`), and none of the three on a read tool;
 * S5 the server enforces what it declares (§ 17): a missing required field
 *    or a value outside an enum is a tool result with isError and the
 *    CLI's failure shape, every problem of the call listed, nothing
 *    spawned; an unknown argument or a wrong JSON type stays -32602;
 *    values inside pass;
 * S6 the three exposed flags pass through: the result equals the CLI's
 *    `--json` result with the same flag;
 * S7 the status enum follows a config edit without a restart, and the
 *    server checks a call against the config as it is now, whatever a
 *    client cached from an earlier tools/list;
 * S8 a config that does not read cleanly (invalid, a FIFO, a link to
 *    one, a directory, one swapped for a FIFO while requests run) drops
 *    the status enum and never blocks the server;
 * S9 the 4.3.0 flags reach the schemas through the flag table: release
 *    status, exclude-tag and min-priority, add-acceptance; check-all
 *    (a control flag, DECISIONS 225) does not.
 */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
import * as MCP from '../lib/mcp-stdio.ts';
import type { McpServerDriver } from '../lib/mcp-stdio.ts';
const T = H.T;

H.requireNj();
H.requireNjMcp();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;
const env = { NJ_NOW: NOW, NJ_AUTHOR: 'agent' };
const STATUSES = ['open', 'wip', 'done'];
const WRITES = ['new', 'set', 'note', 'check', 'claim', 'release', 'next', 'archive', 'unarchive'];
const SHRINKABLE = ['new', 'set', 'note', 'check', 'claim', 'release'];
const READS = ['list', 'show', 'find', 'tree', 'log'];

function cli(args: string[], cwd: string, input?: string) {
  return H.runJson(args, { cwd, env, input });
}

/** EPIC-001 > TSK-001, with the custom statuses. */
function fixture(label: string) {
  const dir = H.freshDir(label);
  T.eq(`${label} fixture: init`, H.runNj(['init'], { cwd: dir, env }).status, 0);
  const cfgPath = path.join(dir, 'backlog', '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.statuses = STATUSES;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  for (const a of [['new', '--type=epic', '--title=E', '--description=D.'],
    ['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [ ] a']]) {
    T.eq(`${label} fixture: ${a.slice(0, 2).join(' ')}`, H.runNj(a, { cwd: dir, env }).status, 0);
  }
  return { dir, bl: path.join(dir, 'backlog'), cfgPath };
}

async function withServer(dir: string, args: string[], fn: (s: McpServerDriver) => Promise<void>) {
  const s = MCP.spawnServer(H.NJ_MCP as string, ['--backlog=' + path.join(dir, 'backlog')].concat(args), { cwd: dir, env });
  try { await fn(s); } finally { await s.close(); }
}

async function toolList(s: McpServerDriver): Promise<any[]> {
  const r = await s.modernToolsList();
  return (r.result && r.result.tools) || [];
}

/** `--name` → the description an MCP property should carry: its line in
 * `<command> --help`, the "; allowed: …" suffix (the configured values,
 * which the schema carries as an enum) stripped, the CLI-isms dropped
 * (`with --json: `, `--` before a flag name), and the flag's value
 * appended when it is a vocabulary (holds `,` or `|`). */
function helpDocs(command: string, cwd: string): Map<string, string> {
  const r = H.runNj([command, '--help'], { cwd, env });
  const out = new Map<string, string>();
  for (const line of r.stdout.split('\n')) {
    const m = /^ {2}--([a-z_-]+)(?:=(\S+))?\s{2,}(.*)$/.exec(line);
    if (!m) continue;
    const text = m[3].replace(/; allowed: .*$/, '').replace(/^with --json: /, '').replace(/--([a-z][a-z-]*)/g, '$1');
    out.set(m[1], m[2] !== undefined && /[,|]/.test(m[2]) ? `${text}: ${m[2]}` : text);
  }
  return out;
}
/* The two lines the CLI words around its positional argument. */
const MCP_TEXT: Record<string, string> = { 'find.text': 'the search text', 'note.text': 'the note text' };

(async () => {

const x = fixture('mcps');
let tools: any[] = [];
await withServer(x.dir, [], async (s) => { tools = await toolList(s); });
const byName = new Map(tools.map((t) => [t.name, t]));
const props = (t: any) => (t && t.inputSchema && t.inputSchema.properties) || {};
T.check('the server lists its tools (at least 10)', tools.length >= 10, J(tools.map((t) => t.name)));

/* S1. Descriptions ------------------------------------------------------- */
for (const t of tools) {
  T.check(`S1 ${t.name}: the tool has a one-line description`,
    typeof t.description === 'string' && t.description.length > 0 && !t.description.includes('\n'), J(t.description));
  const docs = helpDocs(t.name, x.dir);
  for (const [name, p] of Object.entries<any>(props(t))) {
    const want = MCP_TEXT[`${t.name}.${name}`] ?? docs.get(name.replace(/_/g, '-'));
    T.check(`S1 ${t.name}.${name}: has a description`, typeof p.description === 'string' && p.description.length > 0, J(p));
    T.eq(`S1 ${t.name}.${name}: the description is the CLI --help line`, p.description, want === undefined ? '(no --help line)' : want);
    T.check(`S1 ${t.name}.${name}: no CLI-ism`, typeof p.description === 'string' && !/--|positional|\bjson\b/i.test(p.description), J(p.description));
  }
  T.check(`S1 ${t.name}: no CLI-ism in the tool description`, !/--|positional|\bjson\b/i.test(String(t.description)), J(t.description));
}
T.check('S1 show.notes names its values', /none\|all\|last:N/.test(String(props(byName.get('show')).notes && props(byName.get('show')).notes.description)), J(props(byName.get('show')).notes));
T.check('S1 set.tags says how the list is written', /<a,b,\.\.\.>/.test(String(props(byName.get('set')).tags && props(byName.get('set')).tags.description)), J(props(byName.get('set')).tags));
T.check('S1 set.depends_on says how the list is written', /<ID,\.\.\.>/.test(String(props(byName.get('set')).depends_on && props(byName.get('set')).depends_on.description)), J(props(byName.get('set')).depends_on));
T.check('S1 quiet says files stays', /files/.test(String(props(byName.get('set')).quiet && props(byName.get('set')).quiet.description)), J(props(byName.get('set')).quiet));

/* S2. required ----------------------------------------------------------- */
const REQUIRED: Record<string, string[]> = { new: ['title', 'type'], find: ['text'], note: ['text'] };
for (const t of tools) {
  const req = (t.inputSchema && t.inputSchema.required) || [];
  T.eq(`S2 ${t.name}: required`, req.slice().sort(), REQUIRED[t.name] || []);
  const top = Object.keys(t.inputSchema || {}).filter((k) => ['anyOf', 'oneOf', 'allOf', 'not', 'if'].includes(k));
  T.eq(`S2 ${t.name}: no top-level combinator`, top, []);
}

/* S3. enums -------------------------------------------------------------- */
const ENUMS: Record<string, string[]> = { status: STATUSES, type: ['epic', 'task', 'subtask'], priority: ['low', 'normal', 'high', 'urgent'], 'min-priority': ['low', 'normal', 'high', 'urgent'] };
let enumSeen = 0;
for (const t of tools) {
  for (const [name, values] of Object.entries(ENUMS)) {
    if (!(name in props(t))) continue;
    enumSeen++;
    T.eq(`S3 ${t.name}.${name}: enum`, props(t)[name].enum, values);
  }
}
T.check('S3 status/type/priority appear on at least 8 tool properties', enumSeen >= 8, String(enumSeen));

/* S4. quiet / fields / dry-run ------------------------------------------- */
for (const t of tools) {
  const p = props(t);
  const shrink = SHRINKABLE.includes(t.name), write = WRITES.includes(t.name);
  T.eq(`S4 ${t.name}: quiet ${shrink ? 'offered' : 'absent'}`, 'quiet' in p, shrink);
  T.eq(`S4 ${t.name}: fields ${shrink ? 'offered' : 'absent'}`, 'fields' in p, shrink);
  if (t.name !== 'doctor') T.eq(`S4 ${t.name}: dry-run ${write ? 'offered' : 'absent'}`, 'dry-run' in p, write);
  if (shrink) T.eq(`S4 ${t.name}: quiet is a boolean, fields a string`, [p.quiet && p.quiet.type, p.fields && p.fields.type], ['boolean', 'string']);
  if (READS.includes(t.name)) T.eq(`S4 ${t.name}: a read tool offers none of the three`, ['quiet', 'fields', 'dry-run'].filter((k) => k in p), []);
}
T.eq('S4 doctor without --allow-destructive: neither fix nor dry-run', ['fix', 'dry-run'].filter((k) => k in props(byName.get('doctor'))), []);
await withServer(x.dir, ['--allow-destructive'], async (s) => {
  const d = (await toolList(s)).find((t) => t.name === 'doctor');
  T.eq('S4 doctor with --allow-destructive: fix and dry-run', ['fix', 'dry-run'].filter((k) => k in props(d)), ['fix', 'dry-run']);
});

/* S5. The server enforces what it declares --------------------------------- */
{
  const y = fixture('mcps-enforce');
  const task = path.join(y.bl, 'tasks', 'TSK-001.md');
  const before = fs.readFileSync(task, 'utf8');
  const filesBefore = fs.readdirSync(path.join(y.bl, 'tasks')).sort();
  await withServer(y.dir, [], async (s) => {
    const bad: Array<[string, string, Record<string, unknown>, RegExp]> = [
      ['new without title', 'new', { type: 'task', parent: 'EPIC-001' }, /title/],
      ['new without type', 'new', { title: 'X', parent: 'EPIC-001' }, /type/],
      ['find without text', 'find', {}, /text/],
      ['note without text', 'note', { id: 'TSK-001' }, /text/],
      ['set status outside the configured set', 'set', { id: 'TSK-001', status: 'doing' }, /open, wip, done/],
      ['set priority in the wrong case', 'set', { id: 'TSK-001', priority: 'HIGH' }, /low, normal, high, urgent/],
      ['list type outside the set', 'list', { type: 'story' }, /epic, task, subtask/],
      ['claim status empty', 'claim', { id: 'TSK-001', status: '' }, /open, wip, done/],
    ];
    for (const [label, tool, args, names] of bad) {
      const r = await s.modernToolsCall(tool, args);
      const sc = r.result && r.result.structuredContent;
      const code = /without/.test(label) ? 'missing_argument' : 'invalid_value';
      T.check(`S5 ${label}: a tool result with isError, not a protocol error`, !r.error && r.result && r.result.isError === true, J(r.error || r.result));
      T.check(`S5 ${label}: the CLI's failure shape, error ${code}`, !!sc && sc.ok === false && sc.error === code, J(sc));
      T.check(`S5 ${label}: answered by the server itself (problems listed)`, !!sc && Array.isArray(sc.problems) && sc.problems.length === 1, J(sc));
      T.check(`S5 ${label}: the result names what is allowed or missing`, names.test(JSON.stringify(r.result && r.result.content)), J(r.result && r.result.content));
    }
    const many = await s.modernToolsCall('new', { type: 'bug', priority: 'p1' });
    const msc = many.result && many.result.structuredContent;
    T.check('S5 every problem of one call is listed (title missing, type and priority invalid)',
      !!msc && Array.isArray(msc.problems) && J(msc.problems.map((p: any) => [p.field, p.error])) === J([['title', 'missing_argument'], ['type', 'invalid_value'], ['priority', 'invalid_value']]), J(msc));
    T.check('S5 ... the first one is the error, and an invalid value carries its allowed list', !!msc && msc.error === 'missing_argument'
      && J(msc.problems[2] && msc.problems[2].allowed) === J(['low', 'normal', 'high', 'urgent']), J(msc));
    const hint = await s.modernToolsCall('set', { id: 'TSK-001', priority: 'hihg' });
    T.check('S5 an invalid value keeps the CLI\'s did-you-mean hint', /did you mean 'high'/.test(String(hint.result && hint.result.structuredContent && hint.result.structuredContent.hint)), J(hint.result));
    for (const [label, tool, args] of [
      ['an unknown argument', 'set', { id: 'TSK-001', colour: 'red' }],
      ['a wrong JSON type', 'set', { id: 'TSK-001', quiet: 'yes' }],
      ['check-all, which is not exposed', 'set', { id: 'TSK-001', status: 'done', 'check-all': true }],
    ] as Array<[string, string, Record<string, unknown>]>) {
      const r = await s.modernToolsCall(tool, args);
      T.check(`S5 ${label}: still -32602`, !!r.error && r.error.code === -32602, J(r.error || r.result));
    }
    T.eq('S5 nothing was written by a refused call', [fs.readFileSync(task, 'utf8'), fs.readdirSync(path.join(y.bl, 'tasks')).sort()], [before, filesBefore]);
    const okSet = await s.modernToolsCall('set', { id: 'TSK-001', status: 'wip', priority: 'high' });
    T.check('S5 values inside the enums pass and write', !okSet.error && okSet.result && okSet.result.isError !== true, J(okSet));
    const okList = await s.modernToolsCall('list', { type: 'task', status: 'wip' });
    T.check('S5 list with enum values passes', !okList.error && okList.result && okList.result.isError !== true, J(okList));
  });
}

/* S6. quiet / fields / dry-run pass through -------------------------------- */
{
  const m = fixture('mcps-pass-mcp'), c = fixture('mcps-pass-cli');
  const legs: Array<[string, string, Record<string, unknown>, string[]]> = [
    ['new quiet', 'new', { type: 'task', parent: 'EPIC-001', title: 'Q', description: 'D.', quiet: true },
      ['new', '--type=task', '--parent=EPIC-001', '--title=Q', '--description=D.', '--quiet', '--json']],
    ['set fields', 'set', { id: 'TSK-001', priority: 'high', fields: 'id,priority' },
      ['set', '--id=TSK-001', '--priority=high', '--fields=id,priority', '--json']],
    ['claim dry-run', 'claim', { id: 'TSK-001', as: 'agent', 'dry-run': true },
      ['claim', '--id=TSK-001', '--as=agent', '--dry-run', '--json']],
  ];
  await withServer(m.dir, [], async (s) => {
    for (const [label, tool, args, cliArgs] of legs) {
      const r = await s.modernToolsCall(tool, args);
      const want = cli(cliArgs, c.dir);
      const norm = (v: unknown) => JSON.parse(JSON.stringify(v === undefined ? null : v).split(m.dir).join('<root>').split(c.dir).join('<root>'));
      T.eq(`S6 ${label}: structuredContent equals the CLI's --json result`, norm(r.result && r.result.structuredContent), norm(want.json));
    }
  });
  T.check('S6 the dry-run claim wrote nothing (no claim directory)', !fs.existsSync(path.join(m.bl, '.nanojira', 'claims', 'TSK-001')), '');
}

/* S7. The status enum follows the config ----------------------------------- */
{
  const z = fixture('mcps-reread');
  await withServer(z.dir, [], async (s) => {
    const first = (await toolList(s)).find((t) => t.name === 'set');
    T.eq('S7 before the edit: the configured statuses', props(first).status && props(first).status.enum, STATUSES);
    const cfg = JSON.parse(fs.readFileSync(z.cfgPath, 'utf8'));
    cfg.statuses = ['open', 'wip', 'review', 'done'];
    fs.writeFileSync(z.cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    const second = (await toolList(s)).find((t) => t.name === 'set');
    T.eq('S7 after the edit, same session: the new statuses', props(second).status && props(second).status.enum, cfg.statuses);
    const r = await s.modernToolsCall('set', { id: 'TSK-001', status: 'review' });
    T.check('S7 a call with the new status passes the server', !r.error && r.result && r.result.isError !== true, J(r));
  });
}

/* S7b. A client that validated against a cached tools/list: the server
 * checks against the config as it is now, not as it was listed. */
{
  const z = fixture('mcps-cached');
  await withServer(z.dir, [], async (s) => {
    const cached = (await toolList(s)).find((t) => t.name === 'set');
    T.eq('S7b the cached list: the statuses at listing time', props(cached).status && props(cached).status.enum, STATUSES);
    const cfg = JSON.parse(fs.readFileSync(z.cfgPath, 'utf8'));
    cfg.statuses = ['open', 'wip', 'review', 'done'];
    fs.writeFileSync(z.cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    const r = await s.modernToolsCall('set', { id: 'TSK-001', status: 'review' });
    T.check('S7b a status added after the listing passes, no re-list', !r.error && r.result && r.result.isError !== true, J(r));
    cfg.statuses = ['open', 'review', 'done'];
    fs.writeFileSync(z.cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    const gone = await s.modernToolsCall('set', { id: 'TSK-001', status: 'wip' });
    const gsc = gone.result && gone.result.structuredContent;
    T.check('S7b a status removed after the listing is invalid_value (isError)', !gone.error && gone.result && gone.result.isError === true && !!gsc && gsc.error === 'invalid_value', J(gone.error || gone.result));
    T.check('S7b ... naming the statuses configured now', !!gsc && J(gsc.problems && gsc.problems[0] && gsc.problems[0].allowed) === J(['open', 'review', 'done']), J(gsc));
  });
}

/* S8. A config the server cannot read cleanly: no status enum, nothing
 * checked against it, and the server itself never blocks on it. The call
 * reaches the CLI, whose error says what is wrong, as it would have. */
{
  const z = fixture('mcps-badcfg');
  fs.writeFileSync(z.cfgPath, '{ not json\n');
  await withServer(z.dir, [], async (s) => {
    const set = (await toolList(s)).find((t) => t.name === 'set');
    T.check('S8 invalid config: set.status has no enum', !!set && props(set).status && !('enum' in props(set).status), J(set && props(set).status));
    T.eq('S8 invalid config: type and priority keep theirs', [props(set).priority && props(set).priority.enum, props(set).type], [['low', 'normal', 'high', 'urgent'], undefined]);
    const r = await s.modernToolsCall('set', { id: 'TSK-001', status: 'anything' });
    T.check('S8 invalid config: the call reaches the CLI (no -32602)', !r.error, J(r.error));
    T.eq('S8 invalid config: ... whose error is invalid_config', r.result && r.result.structuredContent && r.result.structuredContent.error, 'invalid_config');
  });
  fs.rmSync(z.cfgPath);
  const mk = spawnSync('mkfifo', [z.cfgPath], { encoding: 'utf8' });
  T.check('S8 fixture: config.json is a FIFO', !mk.error && mk.status === 0 && fs.lstatSync(z.cfgPath).isFIFO(), J(mk.error ? mk.error.message : mk.stderr));
  await withServer(z.dir, [], async (s) => {
    let tools: any[] | null = null;
    try { tools = await toolList(s); } catch (e: any) { T.check('S8 FIFO config: tools/list answers', false, String(e && e.message)); }
    if (tools) {
      const set = tools.find((t) => t.name === 'set');
      T.check('S8 FIFO config: tools/list answers, set.status has no enum', !!set && props(set).status && !('enum' in props(set).status), J(set && props(set).status));
    }
    const r = await s.modernToolsCall('set', { id: 'TSK-001', fields: 7 }).catch((e: any) => ({ error: { code: 0, message: String(e && e.message) } }));
    T.eq('S8 FIFO config: the server still answers the next request', r.error && r.error.code, -32602);
  });
  fs.rmSync(z.cfgPath);

  // A link to a FIFO, and a directory: the same, tools/list answers without an enum.
  const fifo = path.join(z.dir, 'elsewhere.fifo');
  T.check('S8 fixture: a FIFO beside the backlog', spawnSync('mkfifo', [fifo]).status === 0, '');
  for (const [label, make] of [
    ['a link to a FIFO', () => fs.symlinkSync(fifo, z.cfgPath)],
    ['a directory', () => fs.mkdirSync(z.cfgPath)],
  ] as Array<[string, () => void]>) {
    make();
    await withServer(z.dir, [], async (s) => {
      let tools: any[] | null = null;
      try { tools = await toolList(s); } catch (e: any) { T.check(`S8 ${label}: tools/list answers`, false, String(e && e.message)); }
      const set = tools && tools.find((t) => t.name === 'set');
      T.check(`S8 ${label}: tools/list answers, set.status has no enum`, !!set && props(set).status && !('enum' in props(set).status), J(set && props(set).status));
    });
    fs.rmSync(z.cfgPath, { recursive: true, force: true });
  }

  fs.rmSync(z.cfgPath, { force: true });
}

/* S8 swap race (TSK-041 review R1). config.json is a symlink that a
 * separate process re-points, in a tight loop, between a regular file and
 * a FIFO (an atomic rename each time, as the Reviewer's race041.sh does),
 * while 3000 tools/list requests run. A server that checks the path and
 * then opens it by path (the first version's stat, then readFileSync)
 * opens the FIFO sooner or later and blocks there for good; reading
 * through readRegularFile (O_NONBLOCK, fstat on the descriptor) never
 * does. A request unanswered within 3 s is a hang. */
{
  const w = fixture('mcps-race');
  const reg = path.join(w.dir, 'reg.json'), pipe = path.join(w.dir, 'pipe');
  fs.renameSync(w.cfgPath, reg);
  T.check('S8 race fixture: a FIFO', spawnSync('mkfifo', [pipe]).status === 0, '');
  fs.symlinkSync(reg, w.cfgPath);
  const SWAP = [
    "const fs = require('fs');",
    'const [cfg, reg, pipe] = process.argv.slice(1);',
    "const tmp = cfg + '.swap';",
    'for (;;) {',
    '  for (const target of [reg, pipe]) {',
    '    try { fs.unlinkSync(tmp); } catch {}',
    '    fs.symlinkSync(target, tmp);',
    '    fs.renameSync(tmp, cfg);',
    '  }',
    '}',
  ].join('\n');
  const swapper = spawn(process.execPath, ['-e', SWAP, w.cfgPath, reg, pipe], { stdio: 'ignore' });
  const stopSwapper = () => {
    swapper.kill('SIGTERM');
    // Free a server blocked opening the FIFO: one writer open releases
    // every reader waiting in open(2). No reader there: ENXIO, nothing to do.
    try { fs.closeSync(fs.openSync(pipe, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch { /* no reader */ }
  };
  const N = 3000;
  let answered = 0;
  let hung = '';
  const t0 = Date.now();
  try {
    await withServer(w.dir, [], async (s) => {
      try {
        for (let i = 0; i < N; i++) {
          await s.modernToolsList({ timeout: 3000 });
          answered++;
        }
      } catch (e: any) {
        hung = String(e && e.message);
      } finally {
        stopSwapper();
      }
    });
  } finally {
    stopSwapper();
  }
  const ms = Date.now() - t0;
  process.stderr.write(`  S8 swap race: ${answered} of ${N} answered in ${ms} ms\n`);
  T.eq(`S8 swap race: all ${N} tools/list requests answered while config.json flips between a file and a FIFO`, answered, N);
  if (hung !== '') T.check('S8 swap race: no request hung', false, `after ${answered}: ${hung}`);
  fs.rmSync(w.cfgPath, { force: true });
}

/* S9. The 4.3.0 flags --------------------------------------------------- */
{
  const has = (tool: string, field: string) => field in props(byName.get(tool));
  T.check('S9 release.status, with the status enum', has('release', 'status') && J(props(byName.get('release')).status.enum) === J(STATUSES), J(props(byName.get('release')).status));
  for (const tool of ['list', 'find', 'next']) {
    T.check(`S9 ${tool}: exclude-tag and min-priority`, has(tool, 'exclude-tag') && has(tool, 'min-priority'), J(Object.keys(props(byName.get(tool)))));
  }
  T.check('S9 set: add-acceptance', has('set', 'add-acceptance'), J(Object.keys(props(byName.get('set')))));
  T.eq('S9 check-all is exposed nowhere (a control flag, DECISIONS 225)', tools.filter((t) => 'check-all' in props(t)).map((t) => t.name), []);
}

T.finish();
})();
