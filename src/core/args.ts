'use strict';

// Command-line flag parsing.

import type { Flags } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { SECTION_ROLES } from './constants.ts';
import { armDryRun } from './dry-run.ts';
import { fail } from './output.ts';
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

/**
 * `--` ends the options: every later token is a positional, even one that
 * starts with `--` (TSK-034 F11). A flag given again with a different
 * value (aliases counted as one) keeps its last value in `flags`, and
 * `repeated` gets its name plus the spelling typed the second time
 * (`depends_on` vs `depends-on`) — reported, not thrown, so each caller decides:
 * `nanojira` refuses it, `nanojira-mcp`'s own startup flags are unchanged.
 * An identical repeat (`--json` twice, the same `--backlog`) is not a
 * conflict and is not reported.
 */
interface Repeat { name: string; typed: string }

/** Two values of one flag that mean the same: equal, or for `--backlog` two
 * paths that resolve alike (`B`, `B/`, `./B`). Every other flag compares
 * exactly (TSK-034). */
function sameValue(name: string, a: string | true, b: string | true): boolean {
  if (a === b) return true;
  return name === 'backlog' && typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && path.resolve(a) === path.resolve(b);
}

function parseArgs(argv: string[]) {
  const flags: Flags = new Map();
  const positional = [];
  const repeated: Repeat[] = [];
  let options = true;
  for (const a of argv) {
    if (options && a === '--') { options = false; continue; }
    if (options && a.startsWith('--')) {
      const eq = a.indexOf('=');
      const typed = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const value = eq === -1 ? true : a.slice(eq + 1);
      const name = FLAG_ALIASES.get(typed) ?? typed;
      if (flags.has(name) && !sameValue(name, flags.get(name) as string | true, value) && !repeated.some((r) => r.name === name)) {
        repeated.push({ name, typed });
      }
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional, repeated };
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
  return new Set([...commandControls, ...GLOBAL_CONTROLS, ...(isWrite ? ['dry-run'] : [])]);
}

function checkFlags(flags: Flags, allowedFields: string[], commandControls: Set<string>, isWrite: boolean) {
  const allowedControls = allowedControlSet(commandControls, isWrite);
  for (const name of flags.keys()) {
    if (allowedControls.has(name)) continue;
    if (allowedFields.includes(name)) continue;
    const suffix = isWrite ? ' Nothing written.' : '';
    const known = allowedFields.length > 0
      ? `Known fields: ${allowedFields.join(', ')}`
      : `Known flags: ${Array.from(allowedControls).sort().map((f) => '--' + f).join(', ')}`;
    fail('unknown_field', `unknown field '${name}'.${suffix}`, known);
  }
  if (flags.has('dry-run')) {
    armDryRun();
    if (flags.get('dry-run') !== true) fail('invalid_value', '--dry-run takes no value', 'pass --dry-run on its own');
  }
}

function flagString(flags: Flags, name: string): string | undefined {
  const v = flags.get(name);
  if (v === undefined) return undefined;
  if (v === true) return fail('missing_value', `--${name} needs a value (use --${name}=…)`);
  return v;
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
  try { return fs.readFileSync(0, 'utf8'); } catch (e: any) {
    return fail('invalid_value', `cannot read stdin — ${e.message}`, 'pipe the text in, or pass a path with --<role>-file=<path>');
  }
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

export { parseArgs, refuseRepeated, displayFlagName, allowedControlSet, checkFlags, flagString, parseListFlag, readSectionFlags, readStdin };
