'use strict';

// Command-line flag parsing.

import type { Flags } from './types.ts';

import * as fs from 'fs';
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

function parseArgs(argv: string[]) {
  const flags: Flags = new Map();
  const positional = [];
  for (const a of argv) {
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const value = eq === -1 ? true : a.slice(eq + 1);
      name = FLAG_ALIASES.get(name) ?? name;
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
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

export { parseArgs, displayFlagName, allowedControlSet, checkFlags, flagString, parseListFlag, readSectionFlags, readStdin };
