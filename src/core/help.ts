'use strict';

// The text of `nanojira help`, and `nanojira <command> --help`'s own per-command text
// (§ 9 "`--help` (per-command)", DECISIONS 158 EV-2/EV-3).

import type { Flags } from './types.ts';

import { findBacklog, loadConfig, isLegacyBacklog } from './config.ts';
import { TYPES, PRIORITIES, DEFAULT_CONFIG } from './constants.ts';
import { displayFlagName } from './args.ts';
import { acceptedFlagNames, flagDoc } from './cli-flags.ts';

// --------------------------------------------------------------------- help

/** `next` takes what it finds (§ 12b, DECISIONS 224): said first in its own
 * `--help`, and under its synopsis in the general one. */
const NEXT_CLAIMS = 'next claims the element it picks; to look without claiming, use list --ready or next --dry-run';

const HELP = `nanojira — NanoJira, a local file-based task tool for agents

  nanojira --version                      print the version and exit
  nanojira                                short status: counts, top ready, problems
  nanojira init                           create the backlog layout
  nanojira <any command> --backlog=<path> use this backlog (else NJ_BACKLOG, else .njrc/backlog/ upward)
  NJ_NOW=<ISO-8601 UTC>                   pin every written timestamp (verification/testing only)
  NJ_ON_CHANGE=<command>                  after each successful write, run it with the --json result on stdin (env only)
  nanojira new --type=task --parent=EPIC-001 --title="…"
               [--status=…] [--priority=…] [--tags=a,b] [--assignee=…] [--depends-on=…]
               [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]
  nanojira set --id=TSK-009 [--title=…] [--status=…] [--priority=…]
               [--tags=…] [--assignee=…] [--depends-on=…] [--force] [--allow-open-children] [--check-all]
               [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=… | --add-acceptance=…]

Section writes replace the section; --<role>-file=- reads stdin. An acceptance line whose text
is unchanged keeps its tick; --add-acceptance appends one unticked line.
  nanojira note --id=TSK-009 ["text" | --text=… | --text-file=-|<path>] [--as=…]
  nanojira check --id=TSK-009 [--text=<substring> | --item=<n>] [--on | --off] [--force]
  nanojira show --id=TSK-009 [--notes=none|all|last:N]
  nanojira log --id=TSK-009 [--last=N]
  nanojira list [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--ready] [--all]
               [--exclude-tag=a,b] [--min-priority=…]
  nanojira find ["<text>" | --text=<t>] [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--all] [--case-sensitive]
               [--exclude-tag=a,b] [--min-priority=…]
  nanojira tree [--id=EPIC-001] [--all]
  nanojira tags                           every tag in use, with its carrier count
  nanojira rm --id=TSK-009 [--cascade]
  nanojira archive --id=EPIC-001
  nanojira unarchive --id=EPIC-001
  nanojira claim --id=TSK-009 [--as=…] [--status=…] [--steal=<holder>] [--check-all]
  nanojira release --id=TSK-009 [--as=…] [--status=…]
  nanojira next [--as=…] [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…]
               [--exclude-tag=a,b] [--min-priority=…]
               ${NEXT_CLAIMS}
  nanojira doctor [--fix]

Every command accepts --json. Write commands accept --file=<path> instead of
--id to address one file of a duplicated ID unambiguously. set/note/check/
claim/release accept --id=A,B,C (two or more) to apply the same write to
every named element; results come back as {ok, results: [...]}. new/set/
note/check/claim/release accept --quiet ({ok, id}, plus _problems when
non-empty) and --fields=<a,b,...> (keeps entry only, narrowed to those
names) to shrink a --json write result; both require --json and are
mutually exclusive with each other and with --input. show accepts
--notes=none|all|last:N to narrow which notes it shows (all, the default,
is unchanged); log accepts --last=N to show only the last N events of any
kind. Both work with or without --json, and add notes_total/events_total
alongside the narrowed list when given.

Every write command (init, new, set, note, check, claim, release, next,
archive, unarchive, rm, doctor --fix) accepts --dry-run: the whole call
runs against a scratch copy and nothing in the backlog is written. The
result is the real call's own, plus "dry_run": true and "changes": [{path,
kind, op, before, after}] with --json, or a summary of the paths without.

Exit codes: 0 success · 1 command failed · 2 doctor found at least one error.
`;

// ----------------------------------------------------- per-command --help

/**
 * `<command>`'s own synopsis line(s), extracted from `HELP` itself — one
 * source, not a second copy to keep in sync (§ 9). A command's block is
 * its `  nanojira <word> ...` line plus any directly-following continuation
 * lines (the `[--flag=…]` wraps `new`/`set` already have); anything else
 * (a blank line, a new command's own line, trailing prose) ends it. Null
 * when `command` never appears this way — the bare/no-command lines
 * (`nanojira`, `nanojira init`, `nanojira <any command> --backlog=…`) are not real commands
 * to re-derive a block for.
 */
function synopsisFor(command: string): string[] | null {
  const lines = HELP.split('\n');
  const out: string[] = [];
  let capturing = false;
  let found = false;
  for (const line of lines) {
    const m = /^ {2}nanojira {1,}(\S+)/.exec(line);
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
  if (fieldName === 'priority' || fieldName === 'min-priority') return PRIORITIES;
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
 * `nanojira <command> --help` (§ 9): that command's own synopsis, then one line
 * per flag it accepts — every one, control flags included, read from
 * `core/cli-flags.ts`, the same table the command's own `checkFlags` call
 * reads (DECISIONS 205) — each with a one-line description. A
 * closed-vocabulary flag names its allowed values on its line. A flag is
 * shown in its documented spelling (`--depends-on`, not `--depends_on`).
 * Falls back to the general `HELP` for anything not a real, known command
 * — `--help` never fails, the same discipline the rest of this function has.
 */
function commandHelp(command: string, flags: Flags): string {
  const synopsis = synopsisFor(command);
  if (synopsis === null) return HELP;
  const names = acceptedFlagNames(command);
  if (names === null) return synopsis.join('\n') + '\n';
  const rows = names.map((name) => {
    const d = flagDoc(command, name);
    const vocab = closedVocab(name, flags);
    const text = vocab ? `${d.text}; allowed: ${vocab.join(', ')}` : d.text;
    return { left: `  --${displayFlagName(name)}${d.value === undefined ? '' : '=' + d.value}`, text };
  });
  const width = Math.max(...rows.map((r) => r.left.length)) + 3;
  const lines = command === 'next' ? [NEXT_CLAIMS, ''].concat(synopsis) : synopsis.slice();
  if (rows.length > 0) {
    lines.push('');
    for (const r of rows) lines.push((r.left.padEnd(width) + r.text).trimEnd());
  }
  return lines.join('\n') + '\n';
}

export { HELP, commandHelp };
