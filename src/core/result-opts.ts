'use strict';

// `--fields=<a,b,...>` / `--quiet` on write commands (§ 9 "`--fields` /
// `--quiet`"): shared by new/set/note/check/claim/release so the flag
// validation and the result-shrinking they do lives in one place, applied
// as the last step before a single-ID JSON result or a batch item is
// serialised. A separate file from core/output.ts (not args.ts either):
// args.ts already exports `fail`, which output.ts defines, so output.ts
// cannot import `flagString` back from args.ts without a cycle — this file
// sits above both.

import type { Flags, Element, Config } from './types.ts';

import { flagString } from './args.ts';
import { ENTRY_FIELDS } from './constants.ts';
import { buildWriteResult, fail, out } from './output.ts';
import { listHint } from './suggest.ts';

interface OutputOpts { quiet: boolean; fields?: string[] }

/**
 * Parses and validates `--quiet`/`--fields` (§ 9): mutually exclusive with
 * each other, both require `--json` (there is no human-output meaning for
 * either — § 9 states this explicitly rather than leaving it to infer), and
 * every `--fields` name is checked against `ENTRY_FIELDS` — the exact set
 * `entryJson` can produce — before anything else in the caller runs, so a
 * bad name is refused before any write (the same "validate before the first
 * write" discipline every other flag value check in this codebase already
 * has).
 */
function parseOutputOpts(flags: Flags, json: boolean): OutputOpts {
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
    if (!ENTRY_FIELDS.includes(n)) {
      fail('invalid_value', `unknown field '${n}' in --fields`, listHint('entry fields', n, ENTRY_FIELDS));
    }
  }
  return { quiet, fields: names };
}

/**
 * Applies `opts` to one already-built, successful result object — `{ok,
 * id, changed, entry, _problems, ...}` (single-ID) or one `results[]`
 * member with `id` already attached (batch) — never to a failure object,
 * which this module's callers never pass here (§ 9 "Error output is never
 * trimmed").
 *
 * `--quiet` narrows to exactly `{ok, id}`, plus `_problems` only when it is
 * non-empty (DECISIONS: dropping an always-empty array is the whole point
 * of `--quiet`; dropping a *non-empty* one would silently hide a warning
 * like `done:open_acceptance`, defeating it). Every other key — `changed`,
 * `entry`, `claim`, `released`, `stolen_from`, `previous_assignee`,
 * `open_acceptance` — is dropped.
 *
 * `--fields` narrows only `entry` (or leaves it alone when `entry` is
 * absent, e.g. a `check`/`set` batch no-op never reaches this path with
 * `fields` set and no `entry` — but guarded anyway, defensively). Every
 * envelope-level signal — `changed`, `claim`, `released`, `stolen_from`,
 * `previous_assignee`, `open_acceptance`, and the top-level `_problems`
 * mirror of `entry._problems` — is left exactly as the command already
 * built it, named in `--fields` or not: `--fields` is a projection of the
 * entry snapshot, not of the call's own outcome.
 */
function trimResult<T extends Record<string, unknown>>(result: T, opts: OutputOpts): Record<string, unknown> {
  if (opts.quiet) {
    const out: Record<string, unknown> = { ok: result.ok, id: result.id };
    const probs = result._problems;
    if (Array.isArray(probs) && probs.length > 0) out._problems = probs;
    return out;
  }
  if (opts.fields !== undefined) {
    const entry = result.entry as Record<string, unknown> | undefined;
    if (entry === undefined) return result;
    const projected: Record<string, unknown> = {};
    for (const f of opts.fields) if (f in entry) projected[f] = entry[f];
    return Object.assign({}, result, { entry: projected });
  }
  return result;
}

/** `core/output.ts`'s own `emitWriteResult`, with `--fields`/`--quiet`
 * applied before printing — the single-ID JSON success path for
 * new/set/note/check (§ 9 "`--fields` / `--quiet`"). Neither flag changes
 * anything when `opts` carries neither (`quiet: false, fields: undefined`),
 * so a call site passing that is byte-identical to calling
 * `emitWriteResult` directly. */
function emitWriteResultOpts(json: boolean, el: Element, changed: string[], backlog: string, cfg: Config, extra: object | undefined, opts: OutputOpts) {
  if (!json) return;
  const result = buildWriteResult(el, changed, backlog, cfg, extra);
  const final = opts.quiet || opts.fields !== undefined ? trimResult(result, opts) : result;
  out(JSON.stringify(final, null, 2));
}

export type { OutputOpts };
export { parseOutputOpts, trimResult, emitWriteResultOpts };
