'use strict';

// Command-line flag parsing.

import type { Flags } from './types.ts';
import type { FlagKinds, Repeat } from './kernel.ts';

import * as fs from 'fs';
import * as path from 'path';
import { SECTION_ROLES } from './constants.ts';
import { armDryRun } from './dry-run.ts';
import { fail } from './output.ts';
import { parseArgs as kernelParseArgs, allowedControlSet as kernelAllowedControlSet, checkFlags as kernelCheckFlags, flagString, readStdin as kernelReadStdin } from './kernel.ts';
import { normalizeSectionContent } from './parse.ts';

// -------------------------------------------------------------- arg parsing

// The documented spelling of a flag -> the name it is normalised to (§ 9:
// "`--depends-on` and `--depends_on` are both accepted and normalised to
// the schema field"). `displayFlagName` reverses it, so `--help` shows the
// documented spelling, never the internal one (DECISIONS 205).
const FLAG_ALIASES: Map<string, string> = new Map([['depends-on', 'depends_on']]);

function displayFlagName(name: string): string {
  for (const [shown, internal] of FLAG_ALIASES) if (internal === name) return shown;
  return name;
}

/** Two values of one flag that mean the same: equal, or for `--backlog` two
 * paths that resolve alike (`B`, `B/`, `./B`). Every other flag compares
 * exactly (TSK-034). */
function sameValue(name: string, a: string | true, b: string | true): boolean {
  if (a === b) return true;
  return name === 'backlog' && typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && path.resolve(a) === path.resolve(b);
}

/**
 * `--` ends the options: every later token is a positional, even one that
 * starts with `--` (TSK-034 F11). With `kinds` (TSK-038, DECISIONS 230), a
 * string flag written without `=` takes the next token as its value,
 * unless that token starts with `--` (a value like that needs the `=`
 * form) or there is none: `--title "Two words"`, `--description-file -`.
 * Without `kinds` (the `--version` pre-scan, `nanojira-mcp`'s own startup
 * flags) every bare flag is `true`, as before; so is a flag `kinds` does
 * not know, which the command's flag check then refuses. A flag given again with a different
 * value (aliases counted as one) keeps its last value in `flags`, and
 * `repeated` gets its name plus the spelling typed the second time
 * (`depends_on` vs `depends-on`) — reported, not thrown, so each caller decides:
 * `nanojira` refuses it, `nanojira-mcp`'s own startup flags are unchanged.
 * An identical repeat (`--json` twice, the same `--backlog`) is not a
 * conflict and is not reported.
 *
 * The kernel's `parseArgs` (DECISIONS 231), given nanojira's flag aliases
 * and `sameValue` above.
 */
function parseArgs(argv: string[], kinds?: FlagKinds) {
  return kernelParseArgs(argv, kinds, { aliases: FLAG_ALIASES, sameValue });
}

function refuseRepeated(repeated: Repeat[]): void {
  if (repeated.length === 0) return;
  fail('invalid_value', `--${repeated[0].typed} is given more than once with different values`, 'give each flag once');
}

// Controls every command takes, so no call site can forget one (§ 9).
const GLOBAL_CONTROLS = ['backlog'];

/** Every control flag a command takes: its own, plus the global ones, plus
 * `--dry-run` for a write — what `checkFlags` accepts and, through
 * `core/cli-flags.ts`, what `--help` lists (DECISIONS 205). `--dry-run`
 * (§ 9 "`--dry-run`"): every write command takes it, so it is granted here
 * from `isWrite` rather than listed per command; `init` and `doctor`
 * (`--fix`), which pass `isWrite: false`, list it themselves. */
function allowedControlSet(commandControls: Iterable<string>, isWrite: boolean): Set<string> {
  return kernelAllowedControlSet(commandControls, [...GLOBAL_CONTROLS, ...(isWrite ? ['dry-run'] : [])]);
}

function checkFlags(flags: Flags, allowedFields: string[], commandControls: Set<string>, isWrite: boolean) {
  // Every flag the command takes, as documented (`--depends-on`), not
  // the subset an earlier version listed (TSK-038, DECISIONS 230).
  kernelCheckFlags(flags, allowedFields, allowedControlSet(commandControls, isWrite), isWrite, displayFlagName);
  if (flags.has('dry-run')) {
    armDryRun();
    if (flags.get('dry-run') !== true) fail('invalid_value', '--dry-run takes no value', 'pass --dry-run on its own');
  }
}

function parseListFlag(flags: Flags, name: string) {
  const v = flagString(flags, name);
  if (v === undefined) return undefined;
  if (v === '') return [];
  const items = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
  for (const it of items) {
    if (it.includes(']')) fail('invalid_value', `--${name.replace('_', '-')} item '${it}' contains ']', which is not accepted on the command line`);
  }
  return items;
}

function readStdin(): string {
  return kernelReadStdin('pipe the text in, or pass a path with --<role>-file=<path>');
}

// Value sources per role are mutually exclusive, and only one role may read
// stdin — a stream can be drained once (§ 9). Everything is validated before
// the first read, so a rejected invocation consumes nothing and writes nothing.
function readSectionFlags(flags: Flags) {
  const src: Map<string, { inline?: string; file?: string }> = new Map();
  for (const role of SECTION_ROLES) {
    const inline = flagString(flags, role);
    const file = flagString(flags, role + '-file');
    if (inline !== undefined && file !== undefined) {
      fail('invalid_value', `--${role} and --${role}-file are mutually exclusive. Nothing written.`,
        `pass the text with --${role}=… or the path with --${role}-file=…`);
    }
    if (inline !== undefined) src.set(role, { inline });
    else if (file !== undefined) src.set(role, { file });
  }
  const viaStdin = SECTION_ROLES.filter((r: string) => src.has(r) && (src.get(r) as { inline?: string; file?: string }).file === '-');
  if (viaStdin.length > 1) {
    fail('invalid_value', `--${viaStdin[0]}-file=- and --${viaStdin[1]}-file=- both read stdin, which can only be consumed once. Nothing written.`,
      'read one role from a file or pass it inline');
  }

  const wanted: Map<string, string> = new Map();
  for (const role of SECTION_ROLES) {
    if (!src.has(role)) continue;
    const s = src.get(role) as { inline?: string; file?: string };
    if (s.inline !== undefined) { wanted.set(role, normalizeSectionContent(s.inline)); continue; }
    if (s.file === '-') { wanted.set(role, normalizeSectionContent(readStdin())); continue; }
    let raw;
    try { raw = fs.readFileSync(s.file as string, 'utf8'); } catch (e: any) {
      fail('not_found', `--${role}-file: cannot read '${s.file}' — ${e.message}. Nothing written.`,
        'give a readable path, or `-` to read stdin');
    }
    wanted.set(role, normalizeSectionContent(raw));
  }
  return wanted;
}

export type { FlagKinds };
export { parseArgs, refuseRepeated, displayFlagName, allowedControlSet, checkFlags, flagString, parseListFlag, readSectionFlags, readStdin };
