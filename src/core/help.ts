'use strict';

// The text of `nj help`, and `nj <command> --help`'s own per-command text
// (§ 9 "`--help` (per-command)", DECISIONS 158 EV-2/EV-3).

import type { Flags } from './types.ts';

import { findBacklog, loadConfig, isLegacyBacklog } from './config.ts';
import { TYPES, PRIORITIES, DEFAULT_CONFIG } from './constants.ts';
import { commandFields } from './flag-table.ts';

// --------------------------------------------------------------------- help

const HELP = `nj — NanoJira, a local file-based task tool for agents

  nj --version                           print the version and exit
  nj                                     short status: counts, top ready, problems
  nj init                                create the backlog layout
  nj <any command> --backlog=<path>      use this backlog (else NJ_BACKLOG, else .njrc/backlog/ upward)
  nj new   --type=task --parent=EPIC-001 --title="…"
           [--status=…] [--priority=…] [--tags=a,b] [--assignee=…] [--depends-on=…]
           [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]
  nj set   --id=TSK-009 [--title=…] [--status=…] [--priority=…]
           [--tags=…] [--assignee=…] [--depends-on=…] [--force] [--allow-open-children]
           [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]

Section writes replace the section; --<role>-file=- reads stdin.
  nj note  --id=TSK-009 "text" [--as=…]
  nj check --id=TSK-009 [--text=<substring> | --item=<n>] [--on | --off] [--force]
  nj show  --id=TSK-009
  nj log   --id=TSK-009
  nj list  [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--ready] [--all]
  nj find  "<text>" [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--all] [--case-sensitive]
  nj tree  [--id=EPIC-001] [--all]
  nj rm    --id=TSK-009 [--cascade]
  nj archive --id=EPIC-001
  nj unarchive --id=EPIC-001
  nj claim   --id=TSK-009 [--as=…] [--status=…] [--steal=<holder>]
  nj release --id=TSK-009 [--as=…]
  nj next    [--as=…] [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
  nj doctor [--fix]

Every command accepts --json. Write commands accept --file=<path> instead of
--id to address one file of a duplicated ID unambiguously. set/note/check/
claim/release accept --id=A,B,C (two or more) to apply the same write to
every named element; results come back as {ok, results: [...]}.

Exit codes: 0 success · 1 command failed · 2 doctor found at least one error.
`;

// ----------------------------------------------------- per-command --help

/**
 * `<command>`'s own synopsis line(s), extracted from `HELP` itself — one
 * source, not a second copy to keep in sync (§ 9). A command's block is
 * its `  nj <word> ...` line plus any directly-following continuation
 * lines (the `[--flag=…]` wraps `new`/`set` already have); anything else
 * (a blank line, a new command's own line, trailing prose) ends it. Null
 * when `command` never appears this way — the bare/no-command lines
 * (`nj`, `nj init`, `nj <any command> --backlog=…`) are not real commands
 * to re-derive a block for.
 */
function synopsisFor(command: string): string[] | null {
  const lines = HELP.split('\n');
  const out: string[] = [];
  let capturing = false;
  let found = false;
  for (const line of lines) {
    const m = /^ {2}nj {1,}(\S+)/.exec(line);
    if (m) {
      capturing = m[1] === command;
      if (capturing) { found = true; out.push(line); }
      continue;
    }
    if (capturing && /^ {2,}\[/.test(line)) { out.push(line); continue; }
    capturing = false;
  }
  return found ? out : null;
}

/** `type`/`status`/`priority`'s allowed values for this one listing (§ 9
 * "Allowed values shown"): `type`/`priority` are always the fixed lists;
 * `status` is the resolved backlog's own configured list when one
 * resolves cleanly, else `DEFAULT_CONFIG`'s — resolution is best-effort
 * and silent, the same "works anywhere" discipline `--version` has, so
 * `--help` itself never fails and never reports `no_backlog`/
 * `invalid_config`. */
function closedVocab(fieldName: string, flags: Flags): string[] | null {
  if (fieldName === 'type') return TYPES;
  if (fieldName === 'priority') return PRIORITIES;
  if (fieldName !== 'status') return null;
  try {
    const backlog = findBacklog(flags, false);
    if (isLegacyBacklog(backlog)) return DEFAULT_CONFIG.statuses;
    const { config, errors } = loadConfig(backlog, false);
    return errors.length === 0 ? config.statuses : DEFAULT_CONFIG.statuses;
  } catch {
    return DEFAULT_CONFIG.statuses;
  }
}

/**
 * `nj <command> --help` (§ 9): that command's own synopsis, then one line
 * per flag it accepts (from the same `core/flag-table.ts` `nj-mcp`'s own
 * tool schemas read, § 17) — a closed-vocabulary flag names its allowed
 * values on the line, any other flag is left free-form, nothing invented.
 * Falls back to the general `HELP` for anything not a real, known command
 * (an unknown command word, or one with no flag-table entry) — `--help`
 * never fails, the same discipline the rest of this function has.
 */
function commandHelp(command: string, flags: Flags): string {
  const synopsis = synopsisFor(command);
  if (synopsis === null) return HELP;
  let fields;
  try { fields = commandFields(command).filter((f) => !f.positional); } catch { return synopsis.join('\n') + '\n'; }
  const lines = synopsis.slice();
  if (fields.length > 0) {
    lines.push('');
    for (const f of fields) {
      const vocab = closedVocab(f.name, flags);
      lines.push(vocab ? `  --${f.name}=<value>   allowed: ${vocab.join(', ')}` : `  --${f.name}`);
    }
  }
  return lines.join('\n') + '\n';
}

export { HELP, commandHelp };
