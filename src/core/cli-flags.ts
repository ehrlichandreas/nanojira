'use strict';

// Every flag each CLI command accepts (§ 9 "`--help` (per-command)",
// DECISIONS 205): the single source each command's own `checkFlags` call
// and `nanojira <command> --help` both read, so the two cannot drift apart.
//
// A command's schema fields still come from `core/flag-table.ts` (which
// `nanojira-mcp`'s tool schemas read too); this table adds what that one
// deliberately leaves out — the control flags (`--json`, `--force`,
// `--quiet`, …) — and, through `allowedControlSet`, the ones `checkFlags`
// grants every command (`--backlog`) or every write (`--dry-run`).

import type { Flags } from './types.ts';

import { allowedControlSet, checkFlags } from './args.ts';
import { FLAG_TABLE, cliFieldNames } from './flag-table.ts';

interface CliSpec {
  /** The names `checkFlags` reports as "Known fields:" on an unknown flag. */
  fields: string[];
  /** Everything else this command takes, beyond `allowedControlSet`'s grants. */
  controls: string[];
  /** A write command: `--dry-run` is granted (§ 9 "`--dry-run`"). */
  write: boolean;
}

const OUTPUT = ['json', 'quiet', 'fields'];

// The `fields`/`controls` split is exactly what each call site passed to
// `checkFlags` before this table existed, so every "Known fields:"/"Known
// flags:" hint stays byte-identical.
const CLI_SPEC: Record<string, CliSpec> = {
  // Bare `nanojira` (the short status); `nanojira --help` is the general help.
  status: { fields: [], controls: ['json'], write: false },
  // `init` and `doctor` (`--fix`) are not write commands to `checkFlags`,
  // so they name `--dry-run` themselves.
  init: { fields: [], controls: ['json', 'dry-run'], write: false },
  new: { fields: cliFieldNames('new'), controls: ['json', 'input', 'quiet', 'fields'], write: true },
  // `id`/`file` stay out of "Known fields:": they address the element, they
  // are not settable fields.
  set: {
    fields: cliFieldNames('set').filter((f) => f !== 'id' && f !== 'file'),
    controls: ['json', 'force', 'allow-open-children', 'id', 'file', 'input', 'quiet', 'fields'],
    write: true,
  },
  note: { fields: [], controls: [...OUTPUT, 'force', 'text', 'text-file', ...cliFieldNames('note')], write: true },
  check: { fields: [], controls: [...OUTPUT, 'force', ...cliFieldNames('check')], write: true },
  show: { fields: [], controls: ['json', ...cliFieldNames('show')], write: false },
  log: { fields: [], controls: ['json', ...cliFieldNames('log')], write: false },
  list: { fields: [], controls: ['json', 'ready', 'all', ...cliFieldNames('list')], write: false },
  find: { fields: [], controls: ['json', 'all', ...cliFieldNames('find')], write: false },
  tree: { fields: [], controls: ['json', 'all', ...cliFieldNames('tree')], write: false },
  tags: { fields: [], controls: ['json'], write: false },
  rm: { fields: [], controls: ['json', ...cliFieldNames('rm')], write: true },
  archive: { fields: [], controls: ['json', ...cliFieldNames('archive')], write: true },
  unarchive: { fields: [], controls: ['json', ...cliFieldNames('unarchive')], write: true },
  // Only `status` in "Known fields:", as the original error text had it.
  claim: { fields: ['status'], controls: [...OUTPUT, ...cliFieldNames('claim').filter((f) => f !== 'status')], write: true },
  release: { fields: [], controls: [...OUTPUT, ...cliFieldNames('release')], write: true },
  next: { fields: cliFieldNames('next'), controls: ['json'], write: true },
  doctor: { fields: [], controls: ['json', 'dry-run', ...cliFieldNames('doctor')], write: false },
};

function cliSpec(command: string): CliSpec {
  const s = Object.hasOwn(CLI_SPEC, command) ? CLI_SPEC[command] : undefined;
  if (!s) throw new Error(`cli-flags: unknown command '${command}'`);
  return s;
}

/** `command`'s own flag check — the first thing every command does (§ 9:
 * an unknown flag is `unknown_field`, nothing written). */
function checkCommandFlags(flags: Flags, command: string): void {
  const s = cliSpec(command);
  checkFlags(flags, s.fields, new Set(s.controls), s.write);
}

/** Every flag name `command` accepts, as `checkCommandFlags` sees them
 * (internal spelling: `depends_on`), each once: the flag-table fields in
 * table order, then the rest in `CLI_SPEC` order, then the granted ones.
 * Null for a word that is not a command. */
function acceptedFlagNames(command: string): string[] | null {
  if (!Object.hasOwn(CLI_SPEC, command)) return null;
  const s = CLI_SPEC[command];
  const accepted = new Set([...s.fields, ...s.controls, ...allowedControlSet(s.controls, s.write)]);
  const tableOrder = Object.hasOwn(FLAG_TABLE, command) ? cliFieldNames(command).filter((f) => accepted.has(f)) : [];
  return Array.from(new Set([...tableOrder, ...accepted]));
}

// ----------------------------------------------------- one-line descriptions

interface FlagDoc {
  /** Shown as `--name=<value>`; absent for a flag that takes no value. */
  value?: string;
  text: string;
}

const doc = (text: string, value?: string): FlagDoc => (value === undefined ? { text } : { value, text });

const FILTER: Record<string, FlagDoc> = {
  status: doc('only elements with this status', '<value>'),
  type: doc('only elements of this type', '<value>'),
  tag: doc('only elements carrying this tag', '<tag>'),
  parent: doc('only direct children of this element', '<id>'),
  assignee: doc('only elements assigned to this name', '<name>'),
};

const BATCH_ID = doc('the element to act on; A,B,C applies the same write to each', '<id>');

// What a flag means wherever a command does not say otherwise.
const FLAG_DOCS: Record<string, FlagDoc> = {
  id: doc('the element to act on', '<id>'),
  file: doc('address one file of a duplicated ID, instead of --id', '<path>'),
  json: doc('print the result as JSON'),
  backlog: doc('use this backlog (else NJ_BACKLOG, else the upward search)', '<path>'),
  'dry-run': doc('run against a scratch copy; nothing is written'),
  quiet: doc('with --json: print only {ok, id}, plus _problems when non-empty'),
  fields: doc('with --json: keep only these entry fields, in this order', '<a,b,...>'),
  force: doc('overwrite a parallel change'),
  'allow-open-children': doc('allow the final status while children are still open'),
  input: doc('read the fields as one JSON object from a file, - for stdin', '<path|->'),
  as: doc('act as this name', '<name>'),
  title: doc('the title', '<text>'),
  parent: doc('the parent element', '<id>'),
  status: doc('the status to set', '<value>'),
  priority: doc('the priority', '<value>'),
  assignee: doc('the assignee', '<name>'),
  type: doc('the element type', '<value>'),
  tags: doc('the whole tag list (replaces it; empty clears it)', '<a,b,...>'),
  'add-tags': doc('add these tags, keep the others', '<a,b,...>'),
  'remove-tags': doc('remove these tags, keep the others', '<a,b,...>'),
  depends_on: doc('the whole dependency list (replaces it; empty clears it)', '<ID,...>'),
  description: doc('the Description section', '<text>'),
  'description-file': doc('the Description section from a file, - for stdin', '<path|->'),
  acceptance: doc('the Acceptance Criteria section', '<text>'),
  'acceptance-file': doc('the Acceptance Criteria section from a file, - for stdin', '<path|->'),
  ready: doc('only elements ready to start'),
  all: doc('include archived elements'),
};

// Where a command gives a flag its own meaning.
const COMMAND_DOCS: Record<string, Record<string, FlagDoc>> = {
  init: { backlog: doc('create the backlog at this path', '<path>') },
  new: { input: doc('read the element, or a whole plan, as JSON from a file, - for stdin', '<path|->') },
  set: { id: BATCH_ID, parent: doc('move the element under this parent', '<id>') },
  note: {
    id: BATCH_ID,
    as: doc('sign the note with this name', '<name>'),
    text: doc('the note text, instead of the positional argument', '<text>'),
    'text-file': doc('read the note text from a file, - for stdin', '<path|->'),
  },
  check: {
    id: BATCH_ID,
    text: doc('the acceptance item whose text contains this', '<substring>'),
    item: doc('the n-th acceptance item, counting from 1', '<n>'),
    on: doc('tick the item (the default)'),
    off: doc('untick the item'),
  },
  show: {
    id: doc('the element to show', '<id>'),
    notes: doc('which notes to show (default all)', 'none|all|last:N'),
  },
  log: {
    id: doc('the element whose history to show', '<id>'),
    last: doc('show only the last N events', '<N>'),
  },
  list: FILTER,
  find: { ...FILTER, 'case-sensitive': doc('match the text with exact case') },
  tree: { id: doc('show only this element and what is below it', '<id>') },
  rm: { cascade: doc('also remove every element below this one') },
  claim: {
    id: BATCH_ID,
    as: doc('claim as this name', '<name>'),
    steal: doc('take over the claim this holder has', '<holder>'),
    status: doc('also set this status', '<value>'),
  },
  release: { id: BATCH_ID, as: doc('release the claim held under this name', '<name>') },
  next: {
    ...FILTER,
    as: doc('claim as this name', '<name>'),
    status: doc('also set this status on the claimed element', '<value>'),
  },
  doctor: {
    fix: doc('repair what can be repaired automatically'),
    'dry-run': doc('with --fix: show what would change; nothing is written'),
  },
};

/** The one-line description of `--name` on `command` (internal spelling).
 * A flag nobody described still gets a line — `--help` never fails — but
 * `test/ac/ac-64-help-lists-every-flag.ts` turns red on it. */
function flagDoc(command: string, name: string): FlagDoc {
  const own = Object.hasOwn(COMMAND_DOCS, command) ? COMMAND_DOCS[command] : {};
  if (Object.hasOwn(own, name)) return own[name];
  if (Object.hasOwn(FLAG_DOCS, name)) return FLAG_DOCS[name];
  return { text: '' };
}

export type { CliSpec, FlagDoc };
export { checkCommandFlags, acceptedFlagNames, flagDoc };
