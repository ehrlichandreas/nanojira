/* AC-64 — `nanojira <command> --help` lists every flag the command accepts
 * (docs/SPECIFICATION.md § 9 "`--help` (per-command)", DECISIONS 205;
 * found by the v4.1.0 acceptance pre-check, finding 3).
 *
 * The bug: `set --help` listed only the field flags, `note --help` only
 * --id/--file/--as — none of the control flags (--json, --dry-run,
 * --quiet, --force, --text, …) — and `set --help` showed `--depends_on`
 * where the docs say `--depends-on`.
 *
 * Black box, for EVERY command (bare `nanojira` included, whose help is
 * the general one): each candidate flag is tried on its own against the
 * real parser — a flag is accepted unless the command answers
 * `unknown field '<name>'` (`checkFlags` is the first thing every command
 * does, so nothing else can answer first; leg Z calibrates that).
 *
 *   A. every flag the parser accepts appears in `<command> --help`.
 *   B. every flag `<command> --help` shows is accepted (no unknown_field).
 *   C. the accepted set is exactly the one pinned below — the oracle, so
 *      dropping a flag from the shared source (parser and help together)
 *      turns this red too, not only a help-side omission.
 *   D. every flag line carries a one-line description.
 *   E. the spelling: `--depends-on` (documented), never `--depends_on`,
 *      though the parser accepts both.
 *
 * Candidates: SEED below, plus every `--flag` in the general help and in
 * any command's own `--help`, so a flag shown for one command is probed
 * on every other.
 */
import { spawn } from 'child_process';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }

const COMMANDS = ['status', 'init', 'new', 'set', 'note', 'check', 'show', 'log', 'list', 'find', 'tree',
  'tags', 'rm', 'archive', 'unarchive', 'claim', 'release', 'next', 'doctor'];

// What each command accepts, in the parser's own spelling (`depends_on`).
// Pinned from the pre-fix build by the same probe (DECISIONS 205): this fix
// changes only what --help shows, never what a command accepts.
const OUT = ['json', 'quiet', 'fields'];
const SECTIONS = ['description', 'description-file', 'acceptance', 'acceptance-file'];
const FILTERS = ['status', 'type', 'tag', 'parent', 'assignee'];
const PINNED: Record<string, string[]> = {
  status: ['backlog', 'json'],
  init: ['backlog', 'json', 'dry-run'],
  new: ['backlog', 'dry-run', ...OUT, 'input', 'type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on', ...SECTIONS],
  set: ['backlog', 'dry-run', ...OUT, 'input', 'id', 'file', 'force', 'allow-open-children',
    'title', 'parent', 'status', 'priority', 'assignee', 'tags', 'depends_on', ...SECTIONS, 'add-tags', 'remove-tags'],
  note: ['backlog', 'dry-run', ...OUT, 'id', 'file', 'as', 'force', 'text', 'text-file'],
  check: ['backlog', 'dry-run', ...OUT, 'id', 'file', 'force', 'text', 'item', 'on', 'off'],
  show: ['backlog', 'json', 'id', 'file', 'notes'],
  log: ['backlog', 'json', 'id', 'file', 'last'],
  list: ['backlog', 'json', ...FILTERS, 'ready', 'all'],
  find: ['backlog', 'json', ...FILTERS, 'all', 'case-sensitive'],
  tree: ['backlog', 'json', 'id', 'all'],
  tags: ['backlog', 'json'],
  rm: ['backlog', 'dry-run', 'json', 'id', 'file', 'cascade'],
  archive: ['backlog', 'dry-run', 'json', 'id', 'file'],
  unarchive: ['backlog', 'dry-run', 'json', 'id', 'file'],
  claim: ['backlog', 'dry-run', ...OUT, 'id', 'file', 'as', 'steal', 'status'],
  release: ['backlog', 'dry-run', ...OUT, 'id', 'file', 'as'],
  next: ['backlog', 'dry-run', 'json', 'as', ...FILTERS],
  doctor: ['backlog', 'dry-run', 'json', 'fix'],
};

const SEED = Array.from(new Set([...Object.values(PINNED).flat(), 'depends-on', 'help-me', 'verbose', 'yes']));
// Never probed: both short-circuit before any command runs (`--help` prints
// help, `--version` answers or fails on its own).
const NOT_PROBED = new Set(['help', 'version']);

// The parser normalises `--depends-on` to `depends_on`; --help shows the
// documented spelling. Mirrors core/args.ts FLAG_ALIASES, deliberately
// restated: the test must not read the source it checks.
const shownAs = (name: string) => (name === 'depends_on' ? 'depends-on' : name);

const BAD = 'zz-not-a-flag';

function env(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = Object.assign({}, process.env, { NJ_NOW: H.FIXED_NOW });
  for (const k of ['NJ_BACKLOG', 'NJ_ON_CHANGE', 'NJ_ON_CHANGE_TIMEOUT', 'NJ_HOOK_COMMAND', 'NJ_HOOK_IDS']) delete e[k];
  return e;
}
function spawnNj(args: string[], cwd: string): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const inv = H.njCommand(H.NJ as string, args);
    const child = spawn(inv.cmd, inv.args, { cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (er) => resolve({ status: null, stdout: '', stderr: String(er.message) }));
    child.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
  });
}
async function pool<I, R>(items: I[], limit: number, worker: (item: I) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner() {
    for (let i = next++; i < items.length; i = next++) results[i] = await worker(items[i]);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/** `--name` lines of a per-command help's flag block: name as shown, its
 * `=<value>` part, its description. */
interface FlagLine { name: string; value: string | null; text: string; line: string }
function flagLines(help: string): FlagLine[] {
  const block = help.split('\n\n').slice(1).join('\n\n');
  const out: FlagLine[] = [];
  for (const line of block.split('\n')) {
    const m = /^ {2}--([a-z][a-z0-9_-]*)(?:=(\S+))?(?: {2,}(.*))?$/.exec(line);
    if (m) out.push({ name: m[1], value: m[2] ?? null, text: (m[3] ?? '').trim(), line });
  }
  return out;
}
const mentioned = (text: string) => Array.from(text.matchAll(/--([a-z][a-z0-9_-]*)/g), (m) => m[1]);

const dir = H.freshDir('ac64');
{
  const r = H.runNj(['init'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] });
  if (r.status !== 0) T.check('fixture: nanojira init', false, r.status + ' ' + J(r.stderr));
}

const general = H.runNj(['--help'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] });
T.exit('general help: exit 0', general, 0);

const help: Record<string, string> = {};
const shown: Record<string, FlagLine[]> = {};
for (const c of COMMANDS) {
  // Bare `nanojira` has no per-command help: `nanojira --help` is the general one.
  const r = c === 'status' ? general : H.runNj([c, '--help'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] });
  T.exit(`${c} --help: exit 0`, r, 0);
  help[c] = r.stdout;
  shown[c] = c === 'status' ? [] : flagLines(r.stdout);
  if (c !== 'status') T.check(`${c} --help is its own text, not the general help`, r.stdout !== general.stdout, J(r.stdout));
}

const candidates = Array.from(new Set([
  ...SEED, ...mentioned(general.stdout), ...COMMANDS.flatMap((c) => shown[c].map((f) => f.name)),
])).filter((n) => !NOT_PROBED.has(n)).sort();

/** Accepted unless the parser answers `unknown field '<name>'` (in its own,
 * normalised spelling) for the flag given alone. */
const probes = COMMANDS.flatMap((c) => [...candidates, BAD].map((name) => ({ c, name })));
const answers = await pool(probes, 8, ({ c, name }) =>
  spawnNj((c === 'status' ? [] : [c]).concat([`--${name}=x`]), dir));
const accepted: Record<string, Set<string>> = Object.fromEntries(COMMANDS.map((c) => [c, new Set<string>()]));
probes.forEach(({ c, name }, i) => {
  const r = answers[i];
  const internal = name === 'depends-on' ? 'depends_on' : name;
  const rejected = r.status === 1 && r.stderr.includes(`unknown field '${internal}'`);
  if (name === BAD) {
    /* Z — calibration: the probe can tell a rejection at all. */
    T.check(`Z ${c}: an unknown flag is answered unknown_field`, rejected, J(r.stderr));
  } else if (!rejected) {
    accepted[c].add(internal);
  }
});

for (const c of COMMANDS) {
  const shownNames = shown[c].map((f) => f.name);

  /* A — accepted ⊆ shown */
  for (const name of accepted[c]) {
    if (c === 'status') {
      T.check(`A status: --${shownAs(name)} (accepted) appears in the general help`,
        mentioned(help[c]).includes(shownAs(name)), J(help[c]));
    } else {
      T.check(`A ${c}: --${shownAs(name)} (accepted) has its own line in ${c} --help`,
        shownNames.includes(shownAs(name)), J(help[c]));
    }
  }

  /* B — shown ⊆ accepted */
  for (const f of shown[c]) {
    const internal = f.name === 'depends-on' ? 'depends_on' : f.name;
    T.check(`B ${c}: --${f.name} (shown) is not unknown_field`, accepted[c].has(internal), J([...accepted[c]]));
  }
  T.eq(`B ${c}: each flag is shown once`, shownNames.length, new Set(shownNames).size);

  /* C — the accepted set is the pinned one */
  T.sameSet(`C ${c}: accepts exactly the pinned flags`, accepted[c], PINNED[c]);

  /* D — a one-line description on every line */
  for (const f of shown[c]) T.check(`D ${c}: --${f.name} has a description`, f.text.length > 0, J(f.line));

  /* E — documented spelling only */
  T.check(`E ${c}: never shows --depends_on`, !/--depends_on\b/.test(help[c]), J(help[c]));
}
for (const c of ['new', 'set']) {
  T.check(`E ${c}: shows --depends-on`, shown[c].some((f) => f.name === 'depends-on'), J(help[c]));
  T.check(`E ${c}: the parser accepts --depends-on`, accepted[c].has('depends_on'), J([...accepted[c]]));
}

/* F — the closed vocabularies still name their values on their own line */
{
  const line = (c: string, n: string) => shown[c].find((f) => f.name === n)?.line ?? '';
  T.check('F set --status lists the statuses', /allowed: todo, doing, blocked, review, done$/.test(line('set', 'status')), J(line('set', 'status')));
  T.check('F new --type lists the types', /allowed: epic, task, subtask$/.test(line('new', 'type')), J(line('new', 'type')));
  T.check('F new --priority lists the priorities', /allowed: low, normal, high, urgent$/.test(line('new', 'priority')), J(line('new', 'priority')));
  T.check('F next --status lists the statuses', /allowed: todo, doing, blocked, review, done$/.test(line('next', 'status')), J(line('next', 'status')));
}

T.finish();
