'use strict';

// `nanojira show`.

import type { Flags, Element, Config, EntryJson } from '../core/types.ts';

import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { context, resolveTarget } from '../core/context.ts';
import { elementProblems, compareElements, entryJson, countsOf } from '../core/derive.ts';
import { fail, out } from '../core/output.ts';
import { parseNotes, renderNoteLine, notesSectionBounds } from '../core/parse.ts';
import type { NoteLine } from '../core/parse.ts';
import { listHint } from '../core/suggest.ts';

type NotesMode = { kind: 'all' } | { kind: 'none' } | { kind: 'last'; n: number };

/**
 * `--notes=none|all|last:N` (§ 9b "`show --notes`", TSK-005): `undefined`
 * means the flag was not given at all — the caller keeps today's output
 * byte-identical in that case, never treating "not given" the same as
 * "given as `all`" even though the two end up showing the same notes.
 * `N` must be a positive integer; `0`, a negative number or anything else
 * unrecognised is `invalid_value`, with a did-you-mean against `none`/
 * `all`/`last:N` when one is close (`core/suggest.ts`'s `listHint`, the
 * same generic machinery `--fields` already reuses for its own closed
 * vocabulary).
 */
function parseNotesFlag(flags: Flags): NotesMode | undefined {
  const raw = flagString(flags, 'notes');
  if (raw === undefined) return undefined;
  if (raw === 'all') return { kind: 'all' };
  if (raw === 'none') return { kind: 'none' };
  const m = /^last:(-?\d+)$/.exec(raw);
  if (m !== null) {
    const n = Number(m[1]);
    if (n >= 1) return { kind: 'last', n };
    fail('invalid_value', `--notes=last:${m[1]} — N must be a positive integer, not ${m[1]}`);
  }
  fail('invalid_value', `unknown --notes value '${raw}'`, listHint('--notes values', raw, ['none', 'all', 'last:N']));
}

/** The notes `mode` actually keeps, oldest-first — the same relative order `parseNotes` already returns them in. */
function visibleNotes(all: NoteLine[], mode: NotesMode): NoteLine[] {
  if (mode.kind === 'all') return all;
  if (mode.kind === 'none') return [];
  return all.slice(Math.max(0, all.length - mode.n));
}

/**
 * The `entry` object (DECISIONS 171 C, § 9 "JSON interface"), with `notes`
 * (the visible subset, `{at, actor, text}` each — the same shape `log`
 * already returns) and `notes_total` (the element's real note count,
 * regardless of `mode` — the hint a truncated view needs to know how much
 * it isn't seeing) appended when `--notes` was given at all, `mode ===
 * undefined` otherwise leaving `entry` untouched so the default `--json`
 * shape stays byte-identical to before this flag existed.
 */
type ShownEntry = EntryJson & { notes?: NoteLine[]; notes_total?: number };

function withNotesExtra(entry: EntryJson, body: string, mode: NotesMode | undefined): ShownEntry {
  if (mode === undefined) return entry;
  const all = parseNotes(body);
  return Object.assign({}, entry, { notes: visibleNotes(all, mode), notes_total: all.length });
}

/**
 * The body text `show`'s human output actually prints: `body` unchanged
 * when `mode` is `undefined` or `all` (including when the body has no
 * `## Notes` section at all, or `last:N` keeps every note there already
 * is) — otherwise the section is rebuilt from `parseNotes`'s own
 * structured reading, keeping only the visible notes (re-rendered via
 * `renderNoteLine`, byte-identical to their stored form) behind one
 * placeholder line naming how many are hidden. A hand-edited line under
 * `## Notes` that is not a well-formed note (§ 10 "Multi-line text") is
 * dropped from this truncated view exactly as `log` already drops it from
 * history — never from the file itself, since `show` never writes.
 */
function renderBodyForNotes(body: string, mode: NotesMode | undefined): string {
  if (mode === undefined || mode.kind === 'all') return body;
  const lines = body.split('\n');
  const bounds = notesSectionBounds(lines);
  if (bounds === null) return body;
  const all = parseNotes(body);
  if (all.length === 0) return body;
  const visible = visibleNotes(all, mode);
  const hidden = all.length - visible.length;
  const before = lines.slice(0, bounds.headingLine + 1);
  const after = lines.slice(bounds.endLine);
  const placeholder = mode.kind === 'none'
    ? [`(${all.length} note${all.length === 1 ? '' : 's'} hidden — pass --notes=all or --notes=last:N to see them)`]
    : hidden > 0
      ? [`(${hidden} earlier note${hidden === 1 ? '' : 's'} hidden — pass --notes=all to see them)`]
      : [];
  const rendered = visible.map((n) => renderNoteLine(n.at, n.actor, n.text));
  return before.concat(placeholder, rendered, after).join('\n');
}

function cmdShow(flags: Flags) {
  checkCommandFlags(flags, 'show');
  const ctx = context(flags);
  const mode = parseNotesFlag(flags);
  const el = resolveTarget(ctx, flags, false);
  const scope = ctx.elements;
  // Reads show every file claiming the id, each marked duplicate_id (§ 9).
  const shown = flags.has('file') ? [el] : ctx.elements.filter((e: Element) => e.id === el.id).sort(compareElements);
  if (flags.has('json')) {
    const entries = shown.map((e) => withNotesExtra(entryJson(e, ctx.backlog, ctx.cfg), e.body, mode));
    // `entry` (DECISIONS 171 C, § 9): additive, identical to entries[0],
    // present exactly when `entries` has exactly one element -- never for a
    // duplicate_id target (two entries). `list`/`find` never carry it.
    out(JSON.stringify(Object.assign(
      { backlog: ctx.backlog, counts: countsOf(scope.filter((e: Element) => !e.archived)), entries },
      entries.length === 1 ? { entry: entries[0] } : {},
    ), null, 2));
    return 0;
  }
  if (shown.length > 1) {
    out(`⚠ ${el.id} is carried by ${shown.length} files (duplicate_id) — showing all of them.`);
    out('');
  }
  for (const one of shown) {
    if (shown.length > 1) out(`--- ${one.file} ---`);
    showOne(one, ctx.cfg, mode);
    if (one !== shown[shown.length - 1]) out('');
  }
  return 0;
}

function showOne(el: Element, cfg: Config, mode: NotesMode | undefined) {
  out(`${el.id}  ${el.title}`);
  out(`  type      ${el.type}`);
  if (el.parent) out(`  parent    ${el.parent}`);
  out(`  status    ${el.status}`);
  out(`  priority  ${el.priority}`);
  if (el.assignee) out(`  assignee  ${el.assignee}`);
  if (el.tags.length) out(`  tags      ${el.tags.join(', ')}`);
  if (el.depends_on.length) out(`  depends   ${el.depends_on.join(', ')}`);
  out(`  created   ${el.created}`);
  out(`  updated   ${el.updated}`);
  if (el.archivedAt) out(`  archived  ${el.archivedAt}`);
  out(`  file      ${el.file}`);
  const probs = elementProblems(el, cfg.problems.ignore);
  out(`  problems  ${probs.length ? probs.join(' ') : '(none)'}`);
  out('');
  const displayBody = renderBodyForNotes(el.body, mode);
  process.stdout.write(displayBody.replace(/^\n/, ''));
  if (displayBody !== '' && !displayBody.endsWith('\n')) out('');
}

export { cmdShow };
