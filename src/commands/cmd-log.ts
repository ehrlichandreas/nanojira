'use strict';

// `nj log` (§ 12c, DECISIONS 154/155): the change history of one element,
// derived entirely from data `nj` already keeps -- `created`, the claim
// generations and the body's dated, signed notes. There are no new writes:
// nothing here can move the replay gate.

import type { Flags, Element } from '../core/types.ts';

import { checkFlags } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { allEntriesAscending } from '../core/claims.ts';
import { context, resolveTarget } from '../core/context.ts';
import { parseNotes } from '../core/parse.ts';
import { fail, out } from '../core/output.ts';

type EventKind = 'created' | 'claimed' | 'reasserted' | 'stolen' | 'released' | 'note';
interface LogEvent { at: string; kind: EventKind; actor?: string; text?: string }

// The fixed source precedence for the tie-break (§ 12c): created, then
// claims in generation order, then notes in document order -- never
// alphabetical, never by kind. Carried alongside each event only to break
// an exact-timestamp tie, then dropped before output.
const SOURCE_CREATED = 0;
const SOURCE_CLAIM = 1;
const SOURCE_NOTE = 2;

/**
 * `log` has nothing to derive a history from without reading the element
 * itself -- unlike `show`, which tolerates one unreadable entry among many
 * (§ 9 `file:unreadable` in `_problems`, exit 0), there is no `created` to
 * fall back on here. The same code `claim` already uses for the identical
 * reason (§ 12a), worded for a read instead of a write.
 */
function requireReadableForLog(el: Element) {
  if (el.problems.has('file:unreadable')) {
    fail('refused:unreadable', `${el.id} (${el.file}) cannot be read — refusing to log`,
      'check the file and its permissions, then run `nj doctor`');
  }
  if (el.problems.has('frontmatter:unreadable')) {
    fail('refused:unreadable', `${el.id} (${el.file}) has unreadable frontmatter — refusing to log`,
      'repair the file by hand, then run `nj doctor`');
  }
}

/**
 * Classify each claim generation by comparing it with the one immediately
 * before it (§ 12c): `released` names itself; a `claimed` with no earlier
 * generation, or whose earlier one was `released`, is a plain `claimed`;
 * the same name claiming again is `reasserted`; a different name landing
 * (only possible via `--steal`) is `stolen` -- the previous holder is not
 * repeated as a field, it is simply the actor of the event just before it.
 */
function claimEvents(backlog: string, id: string): (LogEvent & { _source: number })[] {
  const events: (LogEvent & { _source: number })[] = [];
  let prev: { kind: 'claimed' | 'released'; name: string } | null = null;
  for (const e of allEntriesAscending(backlog, id)) {
    const kind: EventKind = e.kind === 'released' ? 'released'
      : prev === null || prev.kind === 'released' ? 'claimed'
        : prev.name === e.name ? 'reasserted' : 'stolen';
    events.push({ at: e.time, kind, actor: e.name, _source: SOURCE_CLAIM });
    prev = { kind: e.kind, name: e.name };
  }
  return events;
}

function formatEvent(e: LogEvent): string {
  if (e.kind === 'created') return `${e.at} created`;
  if (e.kind === 'note') return `${e.at} ${e.actor}: ${e.text}`;
  const verb = e.kind === 'reasserted' ? 're-asserted' : e.kind;
  return `${e.at} ${verb} by ${e.actor}`;
}

function cmdLog(flags: Flags) {
  checkFlags(flags, [], new Set(['json', ...cliFieldNames('log')]), false);
  const json = flags.has('json');
  const ctx = context(flags);

  // `--id` naming a duplicate must be `duplicate_id` (forWrite), not a
  // silent first-match pick, the same escape hatch a write has (§ 12c
  // "Addressing") even though nothing here is ever written.
  const el = resolveTarget(ctx, flags, true);
  requireReadableForLog(el);

  const events: (LogEvent & { _source: number })[] = [{ at: el.created, kind: 'created', _source: SOURCE_CREATED }];
  events.push(...claimEvents(ctx.backlog, el.id));
  for (const n of parseNotes(el.body)) events.push({ at: n.at, kind: 'note', actor: n.actor, text: n.text, _source: SOURCE_NOTE });

  // A stable sort: `at` ascending, tie-broken by source precedence; within
  // one source, insertion order (generation order for claims, document
  // order for notes) is already the merge order § 12c requires.
  events.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a._source - b._source));
  const merged: LogEvent[] = events.map(({ _source, ...rest }) => rest);

  if (json) {
    out(JSON.stringify({ ok: true, id: el.id, events: merged }, null, 2));
    return 0;
  }
  for (const e of merged) out(formatEvent(e));
  return 0;
}

export { cmdLog };
