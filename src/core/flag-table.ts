'use strict';

// The per-command flag table (§ 17 "MCP Interface", D144 C-2): the single
// source `checkFlags`' call sites build their allowed-field sets from, and
// `nj-mcp` generates its tool input schemas from. Moving the CLI onto this
// table must keep CLI behaviour byte-identical — the replay gate against
// c7-baseline is what proves that, not this file's own correctness.
//
// Deliberately excluded from every entry (§ 9 "Control flags ... are not
// schema fields; they are hard-wired in the tool"): `backlog`, `json`,
// `force`, `fix` (added back only for `doctor` when the server allows it),
// `cascade` (its command, `rm`, is not exposed at all, § 17), `ready`,
// `all`, `allow-open-children`. `id`/`file` are NOT control flags in this
// sense — they address the call's target and are genuine per-tool fields.
//
// `positional: true` marks a field that is a bare CLI argument (`nj note
// --id=X "text"`), not a `--name=value` flag; nj-mcp appends it to argv
// after every other flag, in table order.

import { NEW_FIELDS, SETTABLE_FIELDS } from './constants.ts';

type FlagKind = 'string' | 'boolean';

interface FieldSpec {
  name: string;
  kind: FlagKind;
  positional?: boolean;
}

interface CommandSpec {
  fields: FieldSpec[];
}

const str = (name: string): FieldSpec => ({ name, kind: 'string' });
const bool = (name: string): FieldSpec => ({ name, kind: 'boolean' });

const FLAG_TABLE: Record<string, CommandSpec> = {
  list: { fields: [str('status'), str('type'), str('tag'), str('parent'), str('assignee')] },
  find: { fields: [str('status'), str('type'), str('tag'), str('parent'), str('assignee'), bool('case-sensitive'),
    { name: 'text', kind: 'string', positional: true }] },
  show: { fields: [str('id'), str('file')] },
  log: { fields: [str('id'), str('file')] },
  tree: { fields: [str('id')] },
  // Built from the same NEW_FIELDS/SETTABLE_FIELDS constants.ts and
  // cmd-new.ts/cmd-set.ts already validate against — one list, not two
  // hand-kept-in-sync copies.
  new: { fields: NEW_FIELDS.map(str) },
  // --add-tags/--remove-tags (DECISIONS 163 B): an incremental alternative
  // to --tags=, set-only, hyphenated like case-sensitive/allow-open-children
  // (no pre-existing Element field to normalise onto, unlike depends-on).
  set: { fields: [str('id'), str('file')].concat(SETTABLE_FIELDS.map(str), [str('add-tags'), str('remove-tags')]) },
  note: { fields: [str('id'), str('file'), str('as'), { name: 'text', kind: 'string', positional: true }] },
  check: { fields: [str('id'), str('file'), str('text'), str('item'), bool('on'), bool('off')] },
  claim: { fields: [str('id'), str('file'), str('as'), str('steal'), str('status')] },
  release: { fields: [str('id'), str('file'), str('as')] },
  // No id/file (§ 12b "Not applicable"): `next` picks its own target, the
  // same reason `new` has neither.
  next: { fields: [str('as'), str('status'), str('type'), str('tag'), str('parent'), str('assignee')] },
  archive: { fields: [str('id'), str('file')] },
  unarchive: { fields: [str('id'), str('file')] },
  doctor: { fields: [bool('fix')] },
  // `rm` answers only `nj rm --help`'s question (DECISIONS 163 A) -- it is
  // never an `nj-mcp` tool (TOOL_NAMES omits it unconditionally, § 17),
  // and this entry does not change that.
  rm: { fields: [str('id'), str('file'), bool('cascade')] },
};

function spec(command: string): CommandSpec {
  const s = FLAG_TABLE[command];
  if (!s) throw new Error(`flag-table: unknown command '${command}'`);
  return s;
}

/** Every field `command` takes as a `--name=value` flag — what each CLI
 * command's own `checkFlags` call builds its allowed-field set from. A
 * `positional` field (note/find's `text`) is never a `--flag` on the CLI,
 * so it is excluded here: including it would let `--text=…` through
 * `checkFlags` where it was previously `unknown_field`, a CLI behaviour
 * change the shared table must not cause. */
function cliFieldNames(command: string): string[] {
  return spec(command).fields.filter((f) => !f.positional).map((f) => f.name);
}

/** Every field `command` takes, flag or positional, WITH its kind and
 * `positional` marker intact — what `nj-mcp`'s schema generator and its
 * `tools/call` argument builder both read (§ 17: the MCP tool call has no
 * "positional" concept; a positional CLI field is still one ordinary
 * input field, just appended to argv differently when spawning `nj`). */
function commandFields(command: string): FieldSpec[] {
  return spec(command).fields;
}

/** Just the names, flag or positional — a convenience over `commandFields`
 * for call sites that only need to check membership. */
function commandFieldNames(command: string): string[] {
  return spec(command).fields.map((f) => f.name);
}

export type { FlagKind, FieldSpec, CommandSpec };
export { FLAG_TABLE, cliFieldNames, commandFields, commandFieldNames };
