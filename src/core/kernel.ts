'use strict';

// CLI kernel — copy verbatim, project-neutral.
//
// The parts of a small JSON-first Node CLI that know nothing about the
// project around them: the failure type and `--json` output state, flag
// parsing and the unknown-flag check, did-you-mean, the pinnable clock and
// `--fields`/`--quiet` validation (DECISIONS 231). Every project-specific
// choice comes in as a parameter (flag aliases, the global controls, a
// display name, a failure decorator, a hint label), so another project can
// copy this file unchanged and keep its own domain code beside it.
//
// Rules for this file: it imports only `node:*` built-ins, never another
// module of this project, and names no project. A test pins both.

import * as fs from 'node:fs';

// ------------------------------------------------------------------- errors

class Fail extends Error {
  hint?: string;
  code: string;
  constructor(message: string, hint?: string, code?: string) { super(message); this.hint = hint; this.code = code || 'failed'; }
}

function fail(code: string, message: string, hint?: string): never { throw new Fail(message, hint, code); }

// Set as soon as argv is parsed, so the top-level catch can honour --json.
const output = { json: false };

/** Applied to every failure result object before it is printed (`hardExit`,
 * `emitFailure`): the project may add fields, e.g. the files a partly landed
 * call already wrote. The identity by default. */
type FailureDecorator = <T extends object>(res: T) => T;
let decorateFailure: FailureDecorator = (res) => res;

function setFailureDecorator(fn: FailureDecorator): void { decorateFailure = fn; }

/**
 * Paths that must not unwind through the normal error handling (fault hooks,
 * exhausted allocator) still owe --json callers a result object.
 */
function hardExit(code: string, message: string): never {
  process.stderr.write(message + '\n');
  if (output.json) process.stdout.write(JSON.stringify(decorateFailure({ ok: false, error: code }), null, 2) + '\n');
  process.exit(1);
}

// ----------------------------------------------------------------- printing

// A reader that closes early (`cli list | head`) makes the next stdout write
// fail with EPIPE. Node's write() call itself does not throw -- the failure
// surfaces asynchronously as an 'error' event on the stream -- so an
// unhandled EPIPE crashes the process with a full stack trace despite the
// command having done everything it was asked. The command already
// succeeded and only the reader stopped listening, so EPIPE on stdout is
// silent and exits 0 -- no stack trace, nothing on stderr. Any OTHER stdout
// write error is a real fault and must still crash visibly, exactly as an
// unhandled error normally would; re-throwing here (rather than swallowing)
// is what keeps that true, since registering this listener at all suppresses
// Node's own default "uncaught error event" crash for every error on this
// stream, not just EPIPE.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function out(s: string) { process.stdout.write(s + '\n'); }

/** With --json every exit path emits JSON on stdout; the prose stays on stderr. */
function emitFailure(code: string, message: string, hint?: string) {
  process.stderr.write(`Error: ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  if (output.json) {
    const res: { ok: boolean; error: string; hint?: string } = { ok: false, error: code };
    if (hint) res.hint = hint;
    out(JSON.stringify(decorateFailure(res), null, 2));
  }
  process.exitCode = 1;
}

// -------------------------------------------------------------- arg parsing

type Flags = Map<string, string | true>;

/** A flag's kind, from the command's flag table: a `string` flag also takes
 * its value as the next token. */
type FlagKinds = Record<string, 'string' | 'boolean'>;

interface Repeat { name: string; typed: string }

interface ParseOpts {
  /** The typed spelling of a flag -> the name it is normalised to. */
  aliases?: ReadonlyMap<string, string>;
  /** Whether two values of one flag mean the same; exact equality by default. */
  sameValue?: (name: string, a: string | true, b: string | true) => boolean;
}

/**
 * `--` ends the options: every later token is a positional, even one that
 * starts with `--`. With `kinds`, a string flag written without `=` takes
 * the next token as its value, unless that token starts with `--` (a value
 * like that needs the `=` form) or there is none: `--title "Two words"`,
 * `--text-file -`. Without `kinds` every bare flag is `true`; so is a flag
 * `kinds` does not know, which the command's flag check then refuses. A
 * flag given again with a different value (aliases counted as one) keeps
 * its last value in `flags`, and `repeated` gets its name plus the spelling
 * typed the second time — reported, not thrown, so each caller decides. An
 * identical repeat (`--json` twice) is not a conflict and is not reported.
 */
function parseArgs(argv: string[], kinds?: FlagKinds, opts?: ParseOpts) {
  const aliases = opts?.aliases;
  const sameValue = opts?.sameValue ?? ((_name: string, a: string | true, b: string | true) => a === b);
  const flags: Flags = new Map();
  const positional = [];
  const repeated: Repeat[] = [];
  let options = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (options && a === '--') { options = false; continue; }
    if (options && a.startsWith('--')) {
      const eq = a.indexOf('=');
      const typed = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const name = aliases?.get(typed) ?? typed;
      let value: string | true = eq === -1 ? true : a.slice(eq + 1);
      if (value === true && kinds !== undefined && Object.hasOwn(kinds, name) && kinds[name] === 'string'
        && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        value = argv[++i];
      }
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

/** Every control flag a command takes: its own plus the global ones (the
 * caller's list, e.g. a backlog path every command accepts). */
function allowedControlSet(commandControls: Iterable<string>, globalControls: Iterable<string> = []): Set<string> {
  return new Set([...commandControls, ...globalControls]);
}

/** Refuses the first flag that is neither a field nor an allowed control;
 * the hint lists every flag the command takes, sorted, as `displayName`
 * shows it. */
function checkFlags(flags: Flags, allowedFields: string[], allowedControls: Set<string>, isWrite: boolean,
  displayName: (name: string) => string = (name) => name) {
  for (const name of flags.keys()) {
    if (allowedControls.has(name)) continue;
    if (allowedFields.includes(name)) continue;
    const suffix = isWrite ? ' Nothing written.' : '';
    const known = Array.from(new Set([...allowedFields, ...allowedControls])).map(displayName).sort();
    fail('unknown_field', `unknown field '${name}'.${suffix}`, `Known flags: ${known.map((f) => '--' + f).join(', ')}`);
  }
}

function flagString(flags: Flags, name: string): string | undefined {
  const v = flags.get(name);
  if (v === undefined) return undefined;
  if (v === true) return fail('missing_value', `--${name} needs a value (use --${name}=… or --${name} <value>)`);
  return v;
}

function readStdin(hint = 'pipe the text in'): string {
  try { return fs.readFileSync(0, 'utf8'); } catch (e: any) {
    return fail('invalid_value', `cannot read stdin — ${e.message}`, hint);
  }
}

// ----------------------------------------------------------- did-you-mean

/**
 * Optimal string alignment distance: insert, delete, substitute (each cost
 * 1), plus an adjacent transposition — also cost 1, not two substitutions —
 * since a swapped pair of letters is the most common typo and plain
 * Levenshtein otherwise puts "hgih" two edits from "high" instead of one,
 * pushing it over the <= 4-character threshold for no good reason.
 * "Optimal string alignment" (unlike full Damerau-Levenshtein) never edits
 * the same substring twice, which is all a single did-you-mean comparison
 * ever needs.
 */
function osaDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d.push([i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[m][n];
}

/**
 * The allowed value(s) at the smallest OSA distance from `value`, only when
 * that distance is at or under the length-dependent threshold — <= 1 for a
 * value of <= 4 characters, <= 2 otherwise, since for a short word distance
 * 2 replaces half of it (noise, not a hint) — AND exactly one allowed value
 * reaches it. A tie, or everything over the threshold, suggests nothing
 * ("never guess wrong" over "always say something").
 */
function nearestMatch(value: string, allowed: string[]): string | null {
  const threshold = value.length <= 4 ? 1 : 2;
  let best: string[] = [];
  let bestDist = Infinity;
  for (const v of allowed) {
    const d = osaDistance(value, v);
    if (d < bestDist) { bestDist = d; best = [v]; } else if (d === bestDist) best.push(v);
  }
  return bestDist <= threshold && best.length === 1 ? best[0] : null;
}

/** `Known <label>: a, b, c`, with a leading "did you mean '<value>'?"
 * sentence when `nearestMatch` finds one; `label` is a plural noun. */
function listHint(label: string, value: string, allowed: string[]): string {
  const known = `Known ${label}: ${allowed.join(', ')}`;
  const suggestion = nearestMatch(value, allowed);
  return suggestion === null ? known : `did you mean '${suggestion}'? ${known}`;
}

// -------------------------------------------------------------------- clock

// NJ_NOW when set (and not empty), validated; null when the wall clock applies.
function pinnedNow(): string | null {
  const pinned = process.env.NJ_NOW;
  if (pinned === undefined || pinned === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
    fail('invalid_env', `invalid NJ_NOW '${pinned}' (expected ISO-8601 UTC, e.g. 2026-09-21T18:02:44Z)`,
      'fix NJ_NOW, or unset it for the system clock');
  }
  return pinned;
}

/** Refuses an invalid NJ_NOW up front: called once at dispatch, so every
 * command fails the same way whether or not it would ever have read the
 * clock. */
function checkClockEnv(): void {
  pinnedNow();
}

function nowIso(): string {
  return pinnedNow() ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The same clock as `nowIso()` (NJ_NOW when set, else the wall clock), as epoch ms. */
function nowMs(): number {
  return Date.parse(nowIso());
}

// ------------------------------------------------------ --fields / --quiet

interface OutputOpts { quiet: boolean; fields?: string[] }

/**
 * Parses and validates `--quiet`/`--fields`: mutually exclusive with each
 * other, both require `--json`, and every `--fields` name is checked
 * against the caller's `allowedFields` before anything else in the caller
 * runs, so a bad name is refused before any write. `label` names the
 * vocabulary in the hint (plural noun).
 */
function parseOutputOpts(flags: Flags, json: boolean, allowedFields: string[], label = 'fields'): OutputOpts {
  const quiet = flags.has('quiet');
  const fieldsRaw = flagString(flags, 'fields');
  if (quiet && fieldsRaw !== undefined) {
    fail('invalid_value', '--quiet cannot be combined with --fields',
      'use --fields=<list> to choose fields, or --quiet for {ok, id}');
  }
  if (quiet && !json) fail('invalid_value', '--quiet requires --json');
  if (fieldsRaw !== undefined && !json) fail('invalid_value', '--fields requires --json');
  if (fieldsRaw === undefined) return { quiet };
  const names = fieldsRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (names.length === 0) fail('invalid_value', '--fields must not be empty');
  for (const n of names) {
    if (!allowedFields.includes(n)) {
      fail('invalid_value', `unknown field '${n}' in --fields`, listHint(label, n, allowedFields));
    }
  }
  return { quiet, fields: names };
}

export type { Flags, FlagKinds, Repeat, ParseOpts, FailureDecorator, OutputOpts };
export {
  Fail, fail, output, setFailureDecorator, hardExit, out, emitFailure,
  parseArgs, allowedControlSet, checkFlags, flagString, readStdin,
  osaDistance, nearestMatch, listHint,
  checkClockEnv, nowIso, nowMs,
  parseOutputOpts,
};
