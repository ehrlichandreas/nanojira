'use strict';

// `nanojira find` (§ 9a).

import type { Flags, Element } from '../core/types.ts';

import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { applyFilters } from './cmd-list.ts';
import { context } from '../core/context.ts';
import { entryJson, countsOf } from '../core/derive.ts';
import { fail, out, printEntryLine } from '../core/output.ts';

const CONTEXT_MAX = 100;

function truncate(s: string): string {
  return s.length > CONTEXT_MAX ? s.slice(0, CONTEXT_MAX) + '…' : s;
}

/** The first line of the body containing the match, truncated — the way `grep` shows the matching line, falling back to the title for a title-only match. */
function matchContext(el: Element, needle: string, fold: (s: string) => string): string | null {
  for (const line of el.body.split('\n')) {
    if (fold(line).includes(needle)) return truncate(line.trim());
  }
  if (fold(el.title).includes(needle)) return truncate(el.title);
  return null;
}

function cmdFind(flags: Flags, positional: string[]) {
  checkCommandFlags(flags, 'find');
  // `--text=<t>` is the same search text as the positional form (TSK-035):
  // a text that starts with `--` can only be given that way, and
  // nanojira-mcp always passes it that way. One or the other, not both,
  // the rule note's own text sources follow.
  const textFlag = flagString(flags, 'text');
  if (textFlag !== undefined && positional.length > 0) {
    fail('invalid_value', 'the search text was given both as an argument and with --text', 'pass it one way: nanojira find "<text>" or nanojira find --text=<text>');
  }
  if (textFlag === undefined && positional.length === 0) fail('missing_argument', 'nanojira find needs the search text as an argument', 'nanojira find "<text>" (or --text=<text>)');
  const text = textFlag !== undefined ? textFlag : positional.join(' ');
  // The literal empty string is a caller's mistake, not "find nothing" (the
  // same reading --as= and check --text= already get, DECISIONS 119/129).
  if (text === '') fail('invalid_value', '<text> must not be empty');

  const ctx = context(flags);
  const scope = ctx.elements.filter((e: Element) => flags.has('all') || !e.archived);
  // The same AND-combined list filters, plus one more predicate: the text
  // match (§ 9a) — reusing list's read path, not a second implementation of it.
  const filtered = applyFilters(ctx.elements, flags, ctx.cfg);

  const caseSensitive = flags.has('case-sensitive');
  const fold = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const needle = fold(text);
  // Title, body AND ## Notes (already one block in the body, § 7) — one
  // scan over text nanojira has already loaded, not a new read (§ 13).
  const matched = filtered.filter((e: Element) => fold(e.title).includes(needle) || fold(e.body).includes(needle));

  if (flags.has('json')) {
    out(JSON.stringify({ backlog: ctx.backlog, counts: countsOf(scope, ctx.scan.unreadable.length), entries: matched.map((e) => entryJson(e, ctx.backlog, ctx.cfg)) }, null, 2));
    return 0;
  }
  if (matched.length === 0) { out('(no matches)'); return 0; }
  for (const e of matched) {
    printEntryLine(e, ctx.cfg);
    const line = matchContext(e, needle, fold);
    if (line !== null) out(`    ${line}`);
  }
  return 0;
}

export { cmdFind };
