/* AC-46 — per-command `--help`, docs/SPECIFICATION.md § 9 "`--help`
 * (per-command)" and "Feedback after writes" (v3.6, DECISIONS 158
 * EV-2/EV-3/PA-2, promoted: commit 755820e; v3.7 DECISIONS 163 A adds
 * `rm`'s own flag lines, P7 below).
 *
 * AC-46 (§ 15): "nj new --help prints new's own synopsis and flags, not
 * the general command list; nj --help/nj help (no command word) are
 * unchanged. --type's and --priority's allowed values are always
 * epic|task|subtask and low|normal|high|urgent; --status's are the
 * resolved backlog's own configured statuses when one resolves cleanly,
 * else the default list — confirmed by one fixture with a non-default
 * statuses list showing those exact values in nj set --help, and one
 * with no backlog at all (an empty directory) still succeeding with the
 * defaults, never no_backlog. --json makes no difference to --help's
 * output, on any command. This already answers PA-2 too: new/set's
 * existing prose already names every open incomplete:* code after a
 * write, unchanged by this round (confirmed, not assumed)."
 *
 * Found by an outside team (feedback/team-b-tests TSK-002/TSK-003):
 * `nj <command> --help` printed the general help, and the allowed
 * --priority/--status/--type values weren't discoverable from the CLI
 * at all. `rm`'s own gap (P7, DECISIONS 163 A) was found by the Verifier,
 * D161: `rm` is never an `nj-mcp` tool (§ 17), so it had no
 * `core/flag-table.ts` entry either, and `--help` silently fell back to
 * just its synopsis line.
 *
 * Written before the fix lands: red against the current build for every
 * case the bug covers.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunResult } from '../lib/harness.ts';
const T = H.T;

H.requireNj();

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}
function run(args: string[], cwd: string, env?: Record<string, string | undefined>): RunResult {
  return H.runNj(args, { cwd, env, unsetEnv: ['NJ_BACKLOG'] });
}

function fixture(label: string): string {
  const dir = H.freshDir(label);
  ok(run(['init'], dir), 'nj init');
  return dir;
}

/* ===================================================================== */
/* P1 — `nj new --help` is NOT the general help, mentions `new`'s own    */
/* flags, and the general help is unaffected                             */
/* ===================================================================== */
{
  const dir = fixture('ac46-p1');
  const general = run(['--help'], dir);
  T.exit('P1 nj --help (no command): exit 0', general, 0);
  T.check('P1 general help mentions every command', /\bclaim\b/.test(general.stdout) && /\barchive\b/.test(general.stdout), J(general.stdout));

  const perCommand = run(['new', '--help'], dir);
  T.exit('P1 nj new --help: exit 0', perCommand, 0);
  T.check('P1 is NOT byte-identical to the general help', perCommand.stdout !== general.stdout, '');
  T.check('P1 mentions --parent (one of new\'s own flags)', /--parent/.test(perCommand.stdout), J(perCommand.stdout));
  T.check('P1 mentions --acceptance (one of new\'s own flags)', /--acceptance/.test(perCommand.stdout), J(perCommand.stdout));

  const bareHelp = run(['help'], dir);
  T.exit('P1 nj help (the subcommand form): exit 0', bareHelp, 0);
  T.eq('P1 nj help is unaffected (still the general help)', bareHelp.stdout, general.stdout);
}

/* ===================================================================== */
/* P2 — `--type`/`--priority` allowed values are always the fixed lists  */
/* ===================================================================== */
{
  const dir = fixture('ac46-p2');
  const r = run(['new', '--help'], dir);
  T.exit('P2 nj new --help: exit 0', r, 0);
  T.check('P2 --type\'s allowed values (epic, task, subtask) all appear',
    ['epic', 'task', 'subtask'].every(v => r.stdout.includes(v)), J(r.stdout));
  T.check('P2 --priority\'s allowed values (low, normal, high, urgent) all appear',
    ['low', 'normal', 'high', 'urgent'].every(v => r.stdout.includes(v)), J(r.stdout));
}

/* ===================================================================== */
/* P3 — `--status`'s allowed values come from the resolved backlog's own */
/* configured `statuses`, not the defaults, when one resolves cleanly    */
/* ===================================================================== */
{
  // Valid per § 5: `[a-z_]+` only (no hyphens) and the last entry literally
  // `done`. An earlier version of this fixture used `in-progress`/
  // `in-review` (hyphens) and ended in `shipped`, not `done` — invalid on
  // both counts, so the config this backlog actually has was
  // `invalid_config`, and P3b below is what that fixture was actually
  // exercising without saying so.
  const dir = H.mkBacklog({
    label: 'ac46-p3',
    config: JSON.stringify({
      schema: 1,
      statuses: ['backlog', 'in_progress', 'in_review', 'done'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    }, null, 2) + '\n',
  });
  const r = run(['set', '--help'], dir);
  T.exit('P3 nj set --help: exit 0', r, 0);
  T.check('P3 the CUSTOM statuses all appear',
    ['backlog', 'in_progress', 'in_review', 'done'].every(v => r.stdout.includes(v)), J(r.stdout));
  T.check('P3 none of the DEFAULT statuses leak in instead',
    !['todo', 'doing', 'blocked', 'review'].some(v => new RegExp('\\b' + v + '\\b').test(r.stdout)), J(r.stdout));
}

/* ===================================================================== */
/* P3b — an INVALID config: `--help` falls back to the DEFAULT statuses  */
/* silently (exit 0, no invalid_config), exactly as the spec says        */
/* ===================================================================== */
{
  // Invalid on two independent counts (§ 5): hyphens, not `[a-z_]+`, and
  // the last entry is `shipped`, not literally `done`.
  const dir = H.mkBacklog({
    label: 'ac46-p3b',
    config: JSON.stringify({
      schema: 1,
      statuses: ['backlog', 'in-progress', 'in-review', 'shipped'],
      sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
    }, null, 2) + '\n',
  });
  const r = run(['set', '--help'], dir);
  T.exit('P3b nj set --help with an invalid config: exit 0, not invalid_config', r, 0);
  T.check('P3b falls back to the DEFAULT statuses',
    ['todo', 'doing', 'blocked', 'review', 'done'].every(v => new RegExp('\\b' + v + '\\b').test(r.stdout)), J(r.stdout));
  T.check('P3b none of the invalid custom statuses leak in',
    !['in-progress', 'in-review', 'shipped'].some(v => r.stdout.includes(v)), J(r.stdout));
}

/* ===================================================================== */
/* P4 — no backlog at all: `--help` still succeeds, with the DEFAULT     */
/* statuses, never `no_backlog`                                          */
/* ===================================================================== */
{
  const dir = H.freshDir('ac46-p4-empty');
  const r = run(['set', '--help'], dir);
  T.exit('P4 nj set --help in an empty directory: exit 0 (never no_backlog)', r, 0);
  T.check('P4 the DEFAULT statuses are shown',
    ['todo', 'doing', 'blocked', 'review', 'done'].every(v => r.stdout.includes(v)), J(r.stdout));
}

/* ===================================================================== */
/* P5 — `--json` makes no difference to `--help`'s output                */
/* ===================================================================== */
{
  const dir = fixture('ac46-p5');
  const withoutJson = run(['new', '--help'], dir);
  const withJson = run(['new', '--help', '--json'], dir);
  T.exit('P5 nj new --help --json: exit 0', withJson, 0);
  T.eq('P5 identical output with or without --json', withJson.stdout, withoutJson.stdout);
  T.check('P5 the output is prose, not parseable JSON', (() => { try { JSON.parse(withJson.stdout); return false; } catch (e) { return true; } })(), J(withJson.stdout));
}

/* ===================================================================== */
/* P6 (PA-2, already correct — confirmed, not assumed) — `new`/`set`     */
/* text output already names every open incomplete:* code                */
/* ===================================================================== */
{
  const dir = fixture('ac46-p6');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.'], dir, { NJ_NOW: H.FIXED_NOW }), 'new epic');
  const r = run(['new', '--type=task', '--parent=EPIC-001', '--title=Incomplete'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('P6 nj new with no description/acceptance: exit 0', r, 0);
  T.check('P6 text output names incomplete:acceptance', /no acceptance criteria/.test(r.stdout), J(r.stdout));
  T.check('P6 text output names incomplete:description', /no description/.test(r.stdout), J(r.stdout));

  const r2 = run(['set', '--id=TSK-001', '--priority=high'], dir, { NJ_NOW: H.FIXED_NOW });
  T.exit('P6 nj set (still incomplete): exit 0', r2, 0);
  T.check('P6 set also names incomplete:acceptance', /no acceptance criteria/.test(r2.stdout), J(r2.stdout));
  T.check('P6 set also names incomplete:description', /no description/.test(r2.stdout), J(r2.stdout));
}

/* ===================================================================== */
/* P7 (DECISIONS 163 A) — `nj rm --help` gets its own per-flag lines     */
/* too, same as every other command. `rm` has no `core/flag-table.ts`    */
/* entry today (it is never an `nj-mcp` tool, § 17, so nothing had ever   */
/* added one) — written red against the current build, which falls back  */
/* to just rm's synopsis line and no flag detail at all.                  */
/* ===================================================================== */
{
  const dir = fixture('ac46-p7');
  const r = run(['rm', '--help'], dir);
  T.exit('P7 nj rm --help: exit 0', r, 0);
  T.check('P7 is NOT byte-identical to the general help', r.stdout !== run(['--help'], dir).stdout, J(r.stdout));
  // A real per-flag DETAIL line, not just the word appearing in rm's own
  // synopsis (`--id=TSK-009 [--cascade]`) — exactly `  --<name>` (or
  // `=<value>   allowed: ...` for a closed vocabulary) on its own line,
  // the same shape every other command's flag block already has (blank
  // line, then one `  --name` line per flag).
  T.check('P7 has a blank-line-separated flag-detail block (not just the synopsis line)',
    /\n\n {2}--/.test(r.stdout), J(r.stdout));
  T.check('P7 has a real --id detail line (not just the synopsis mentioning it)',
    /\n {2}--id\n/.test(r.stdout), J(r.stdout));
  T.check('P7 has a real --file detail line (rm\'s own target flag)',
    /\n {2}--file\n/.test(r.stdout), J(r.stdout));
  T.check('P7 has a real --cascade detail line (not just the synopsis mentioning it)',
    /\n {2}--cascade\n/.test(r.stdout), J(r.stdout));
  T.check('P7 does NOT list --backlog/--json as rm-specific flags (control flags, excluded everywhere)',
    !/\n {2}--backlog\b/.test(r.stdout) && !/\n {2}--json\b/.test(r.stdout), J(r.stdout));
}

T.finish();
