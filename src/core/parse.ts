'use strict';

// Parsing and serialising element files: frontmatter values, file layout, body sections.

import type { ParsedFile, Config } from './types.ts';

import { FIELD_ORDER, LIST_FIELDS, SECTION_ROLES } from './constants.ts';
import { fail } from './kernel.ts';

// ------------------------------------------------------- frontmatter values

function readQuoted(raw: string, i: number) {
  let out = '';
  i++;
  for (;;) {
    if (i >= raw.length) throw new Error('unterminated quoted value');
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      if (n !== '"' && n !== '\\') throw new Error(`invalid escape '\\${n === undefined ? '' : n}'`);
      out += n; i += 2; continue;
    }
    if (c === '"') return { value: out, next: i + 1 };
    out += c; i++;
  }
}

function parseList(raw: string) {
  const items = [];
  let i = 1;
  let closed = false;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    if (raw[i] === ']') { i++; closed = true; break; }
    if (raw[i] === '"') {
      const r = readQuoted(raw, i);
      items.push(r.value); i = r.next;
    } else {
      const start = i;
      while (i < raw.length && raw[i] !== ',' && raw[i] !== ']') i++;
      items.push(raw.slice(start, i).trim());
    }
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    if (raw[i] === ',') { i++; continue; }
    if (raw[i] === ']') { i++; closed = true; break; }
    throw new Error(`unexpected character '${raw[i]}' in list`);
  }
  if (!closed) throw new Error("list is not closed by ']'");
  if (raw.slice(i).trim() !== '') throw new Error('trailing characters after list');
  return items;
}

function parseValue(raw: string, isListField: boolean): string | string[] {
  let value: string | string[];
  if (raw.startsWith('[')) {
    value = parseList(raw);
  } else if (raw.startsWith('"')) {
    const r = readQuoted(raw, 0);
    if (raw.slice(r.next).trim() !== '') throw new Error('trailing characters after quoted value');
    value = r.value;
  } else {
    value = raw;
  }
  if (isListField && !Array.isArray(value)) {
    const s = String(value).trim();
    value = s === '' ? [] : [s];
  }
  return value;
}

function quote(s: string) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function serializeScalar(v: string | string[]) {
  const s = String(v).replace(/[\r\n]+/g, ' ');
  if (s === '' || s.startsWith('[') || s.startsWith('"')) return quote(s);
  return s;
}

function serializeItem(v: string) {
  const s = String(v).replace(/[\r\n]+/g, ' ');
  if (s === '' || s.includes(',') || s.includes(']') || s.startsWith('"') || s !== s.trim()) return quote(s);
  return s;
}

function serializeValue(v: string | string[]): string {
  if (Array.isArray(v)) return '[' + v.map(serializeItem).join(', ') + ']';
  return serializeScalar(v);
}

function isEmptyValue(v: string | string[] | undefined) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v) === '';
}

// --------------------------------------------------------------- file parse

function parseFile(rawText: string): ParsedFile {
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n');

  const problems: { code: string; line?: number; message: string }[] = [];
  const fields: Map<string, string | string[]> = new Map();
  const order: string[] = [];
  const lines = text.split('\n');

  if (lines[0] !== '---') {
    problems.push({ code: 'frontmatter:unreadable', line: 1, message: "no '---' on line 1" });
    return { fields, order, body: text, problems, parsed: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end === -1) {
    problems.push({ code: 'frontmatter:unreadable', line: 1, message: "frontmatter is not closed by '---'" });
    return { fields, order, body: lines.slice(1).join('\n'), problems, parsed: false };
  }

  for (let i = 1; i < end; i++) {
    const ln = lines[i];
    if (ln.trim() === '') continue;
    if (ln[0] === '#') continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):([\s\S]*)$/.exec(ln);
    if (!m) {
      problems.push({ code: 'frontmatter:unreadable', line: i + 1, message: `cannot parse line: ${ln}` });
      continue;
    }
    const key = m[1];
    let rawVal = m[2];
    if (rawVal.startsWith(' ')) rawVal = rawVal.slice(1);
    if (fields.has(key)) {
      problems.push({ code: 'frontmatter:unreadable', line: i + 1, message: `duplicate key '${key}'` });
      continue;
    }
    let value: string | string[];
    try {
      value = parseValue(rawVal, LIST_FIELDS.has(key));
    } catch (e: any) {
      problems.push({ code: 'frontmatter:unreadable', line: i + 1, message: `${key}: ${e.message}` });
      continue;
    }
    fields.set(key, value);
    order.push(key);
  }

  return { fields, order, body: lines.slice(end + 1).join('\n'), problems, parsed: true };
}

function serialize(fields: Map<string, string | string[]>, order: string[], body: string) {
  const out = ['---'];
  const written = new Set();
  for (const k of FIELD_ORDER) {
    written.add(k);
    if (!fields.has(k)) continue;
    const v = fields.get(k);
    if (isEmptyValue(v)) continue;
    out.push(k + ': ' + serializeValue(v as string | string[]));
  }
  // Unknown keys are preserved verbatim — including an empty value, which for a
  // known optional field would mean "omit" but for a foreign key means data (§ 7).
  for (const k of order) {
    if (written.has(k)) continue;
    written.add(k);
    if (!fields.has(k)) continue;
    out.push(k + ': ' + serializeValue(fields.get(k) as string | string[]));
  }
  out.push('---');
  return out.join('\n') + '\n' + body;
}

// --------------------------------------------------------------- body logic

function h1Of(body: string) {
  const lines = body.split('\n');
  for (const ln of lines) {
    if (ln.trim() === '') continue;
    const m = /^#(?!#)[ \t]*(.*?)[ \t]*$/.exec(ln);
    return m ? m[1] : null;
  }
  return null;
}

function syncH1(body: string, title: string) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (/^#(?!#)/.test(lines[i])) {
      lines[i] = '# ' + title;
      return lines.join('\n');
    }
    return body;
  }
  return body;
}

function sectionPresent(body: string, names: string[]) {
  const want = names.map((n) => String(n).trim().toLowerCase());
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1].replace(/:\s*$/, '').trim().toLowerCase();
    if (!want.includes(name)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,2}[ \t]/.test(lines[j])) break;
      if (lines[j].trim() !== '') return true;
    }
  }
  return false;
}

function normalizeTitle(t: string) {
  return String(t).replace(/[\r\n]+/g, ' ').trim();
}

// The first heading matching one of the role's configured names, matched
// case-insensitively with an optional trailing colon ignored — the same rule
// sectionPresent reads by. Writes target the first match; a second heading for
// the same role keeps counting for completeness (decision 12) and is left alone.
function sectionHeadingIndex(lines: string[], names: string[]) {
  const want = names.map((n) => String(n).trim().toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (!m) continue;
    if (want.includes(m[1].replace(/:\s*$/, '').trim().toLowerCase())) return i;
  }
  return -1;
}

// After optional leading whitespace, a list marker then `[ ]`/`[x]`/`[X]`
// (§ 10a) — the one countable-checkbox shape, shared by `nanojira check`'s own
// scan and `acceptance:no_checkbox`'s span check (DECISIONS 163 E) so the
// two can never disagree on what counts as a checkbox.
const CHECKBOX_RE = /^([ \t]*)(-|\*|\+|\d+\.|\d+\))\ \[( |x|X)\](.*)$/;

// A section ends at the next `#`/`##` heading; `###`+ is content (decision 11).
function sectionEnd(lines: string[], headingIdx: number) {
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}[ \t]/.test(lines[i])) return i;
  }
  return lines.length;
}

/**
 * `acceptance:no_checkbox` (§ 7, DECISIONS 163 E): true when the role's own
 * section span (heading to the next `#`/`##` heading or the end of the
 * body — the same span `sectionHeadingIndex`/`sectionEnd` already define)
 * contains at least one countable checkbox line. A fenced code block
 * within the span is skipped exactly the way `nanojira check`'s own scan skips
 * one (§ 10a) — a checkbox-shaped example line inside ``` ``` ``` never
 * counts. False when the section has no heading at all (nothing to scan).
 */
function sectionHasCheckbox(body: string, names: string[]): boolean {
  const lines = body.split('\n');
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return false;
  const end = sectionEnd(lines, idx);
  let fence: { ch: string; len: number } | null = null;
  for (let i = idx + 1; i < end; i++) {
    const line = lines[i];
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) fence = null;
      continue;
    }
    if (fm) { fence = { ch: fm[1][0], len: fm[1].length }; continue; }
    if (CHECKBOX_RE.test(line)) return true;
  }
  return false;
}

/**
 * `done:open_acceptance` (§ 7, DECISIONS 176 B): counts every countable
 * checkbox in the role's own section span, same span and fence-skipping as
 * `sectionHasCheckbox` above, so the two can never disagree about what's in
 * the section. `null` when the section has no heading at all (nothing to
 * count) -- distinct from `{total: 0, ...}`, which can't actually happen
 * here since a section with zero checkboxes is `acceptance:no_checkbox`'s
 * job, not this one's.
 */
function sectionCheckboxCounts(body: string, names: string[]): { total: number; unticked: number } | null {
  const lines = body.split('\n');
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return null;
  const boxes = acceptanceCheckboxes(body, names);
  let unticked = 0;
  for (const { m } of boxes) if (m[3] === ' ') unticked++;
  return { total: boxes.length, unticked };
}

// A fenced block's opening delimiter (``` or ~~~, length 3 or more, after
// optional leading whitespace). Shared by every scanner below that must
// skip fenced content (§ 7 "What counts as a checkbox", § 10a "Scope",
// TSK-053) so they can never disagree about where a fence opens or closes.
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;

interface FenceState { ch: string; len: number }

/** One line's effect on fence state: `skip` is true for a line that must
 * never be matched as a checkbox or a heading (the fence delimiter itself,
 * or any line already inside an unclosed fence) — the single rule every
 * fence-skipping scanner below applies the same way (TSK-053). */
function fenceStep(line: string, fence: FenceState | null): { fence: FenceState | null; skip: boolean } {
  const fm = FENCE_OPEN_RE.exec(line);
  if (fence) {
    if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) return { fence: null, skip: true };
    return { fence, skip: true };
  }
  if (fm) return { fence: { ch: fm[1][0], len: fm[1].length }, skip: true };
  return { fence: null, skip: false };
}

/** The line a still-open fence opened at, found by walking `lines`
 * continuously from line 0 — the exact fence tracking `scanCheckboxes`
 * itself uses, never reset per section — and stopping the instant a fence
 * is open at a line that starts a `#`/`##` heading, or (if none trips it)
 * at the end of the body (TSK-053 v2, Scout MUST, DECISIONS 233). A
 * result with an open fence at either kind of boundary is exactly the
 * shape that makes `check`'s own scan treat the rest of the body —
 * whichever section or Notes comes after — as still fenced, silently.
 * `null` when every fence opened anywhere in `lines` is also closed
 * before the next such boundary (including EOF). A span-local check
 * (only the role being written) would miss a fence an EARLIER, untouched
 * section left open, or one this write's own new content opens without
 * closing (TSK-053's own MUST #1) — this one catches both, because it
 * is run against the RESULT, after the write, not against either side
 * of the splice alone. */
function openFenceAtAnyBoundary(lines: string[]): number | null {
  let fence: FenceState | null = null;
  let openedAt = -1;
  let inNotes = false;
  for (let i = 0; i < lines.length; i++) {
    if (fence !== null && /^#{1,2}[ \t]/.test(lines[i])) return openedAt;
    const h2 = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (h2) inNotes = h2[1].replace(/:\s*$/, '').trim().toLowerCase() === 'notes';
    const was = fence;
    fence = fenceStep(lines[i], fence).fence;
    if (was === null && fence !== null) openedAt = i;
  }
  // A fence still open at end of file is only a violation outside `## Notes`
  // (older nanojira wrote note text with no fence validation at all, so an
  // unclosed ``` already on disk there must not start refusing unrelated
  // writes now — compat). `## Notes` is always the body's last section
  // (§ 9 insertion order), so nothing with real content ever follows one
  // left open there; the heading-boundary check above already refuses the
  // one case that does matter — a fence open BEFORE `## Notes` is caught
  // there, at the `## Notes` heading line itself, before this is reached.
  return fence !== null && !inNotes ? openedAt : null;
}

/** The nearest `##` heading's own text at or before `from`, stopping at an
 * H1 (content before any `##` section has no section name to report) —
 * purely for `refuseIfOpenFenceAtBoundary`'s own message, naming which
 * section the open fence's own opening line sits in. */
function sectionNameAt(lines: string[], from: number): string | null {
  for (let i = from; i >= 0; i--) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (m) return m[1].replace(/:\s*$/, '').trim();
    if (/^#[ \t]/.test(lines[i])) return null;
  }
  return null;
}

/** Refuses (`refused:open_fence`, nothing written) when `body` — the
 * RESULT a write is about to produce, already containing whatever that
 * write changed — would leave a fence open at a line that starts a
 * section, or at the end of the file (TSK-053 v2, Scout MUST,
 * DECISIONS 233): the one case `check`'s own continuous fence tracking
 * can no longer tell a real heading or checkbox apart from fenced
 * content, from there on. Covers every direction at once: an old span
 * spliced out that left its own opener behind, new content (a
 * `--description`/`--acceptance`/`--add-acceptance` value, or a note's
 * own text) that opens a fence of its own, and a fence an earlier,
 * untouched section already had open before this write ran at all.
 * Every caller runs this against the body it is about to write, before
 * writing it — never against a read. */
function refuseIfOpenFenceAtBoundary(body: string): void {
  const lines = body.split('\n');
  const openedAt = openFenceAtAnyBoundary(lines);
  if (openedAt === null) return;
  const section = sectionNameAt(lines, openedAt);
  fail('refused:open_fence',
    `a fenced block opened at line ${openedAt + 1}${section !== null ? ` (in the ${section} section)` : ''} is still open at a section boundary or end of file — refusing to write, nothing changed`,
    'close the fence, or move the fenced example out of its section');
}

/** The checkbox lines in `lines[from..to)`, skipping fenced code blocks: a
 * checkbox inside a fence is an example, not a criterion. */
function checkboxesOutsideFences(lines: string[], from: number, to: number): { i: number; m: RegExpExecArray }[] {
  const out: { i: number; m: RegExpExecArray }[] = [];
  let fence: FenceState | null = null;
  for (let i = from; i < to; i++) {
    const step = fenceStep(lines[i], fence);
    fence = step.fence;
    if (step.skip) continue;
    const m = CHECKBOX_RE.exec(lines[i]);
    if (m) out.push({ i, m });
  }
  return out;
}

/** Every acceptance-section checkbox `check`'s own `--item=<n>` can
 * address, for `tickAllAcceptance`/`sectionCheckboxCounts`/
 * `sectionCheckboxItems` to share (TSK-053 v2, Reviewer MUST, DECISIONS
 * 233 addendum). `checkboxesOutsideFences(lines, idx + 1, sectionEnd(...))`
 * resets fence state at the section's own start -- span-local -- while
 * `scanCheckboxes` tracks it continuously from line 0; in a hand-broken
 * file where an earlier, untouched section already left a fence open, the
 * span-local scan sees a checkbox the continuous one still treats as
 * fenced (swallowed), so counts/ticks/items disagreed with what `check
 * --item=<n>` could actually reach. Filtering `scanCheckboxes`' own box
 * list to the section's line span means every consumer here sees exactly
 * what `check` sees: a swallowed box is not counted, not ticked, and not
 * listed (never `item: 0`). `item` is the box's 1-based position in the
 * unfiltered list, `check --item=<n>`'s own numbering. `[]` when the
 * section has no heading at all. */
function acceptanceCheckboxes(body: string, names: string[]): { line: number; m: RegExpExecArray; item: number }[] {
  const lines = body.split('\n');
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return [];
  const end = sectionEnd(lines, idx);
  const { boxes } = scanCheckboxes(body);
  const out: { line: number; m: RegExpExecArray; item: number }[] = [];
  boxes.forEach((b, i) => {
    if (b.line > idx && b.line < end) out.push({ line: b.line, m: CHECKBOX_RE.exec(lines[b.line]) as RegExpExecArray, item: i + 1 });
  });
  return out;
}

/** `--check-all` (§ 9, DECISIONS 225): every unticked checkbox in the
 * acceptance section ticked `x`, fenced ones skipped, the rest of the body
 * untouched. `checked` is each ticked line's text after the checkbox,
 * trimmed, in order; `[]` (and `body` itself) when nothing was open. */
function tickAllAcceptance(body: string, names: string[]): { body: string; checked: string[] } {
  const lines = body.split('\n');
  const checked: string[] = [];
  for (const { line, m } of acceptanceCheckboxes(body, names)) {
    if (m[3] !== ' ') continue;
    lines[line] = `${m[1]}${m[2]} [x]${m[4]}`;
    checked.push(m[4].trim());
  }
  return checked.length === 0 ? { body, checked } : { body: lines.join('\n'), checked };
}

/** Every acceptance checkbox in the role's own section span, in file order
 * (TSK-051, show/list `--json`'s `acceptance` field): `{text, checked,
 * item}`, same span and fence-skipping as `sectionCheckboxCounts` so the
 * two can never disagree about what's in the section. `item` is the box's
 * own 1-based position in `scanCheckboxes`' whole-body-minus-Notes scan
 * (TSK-052 item 1, Scout's N1) -- the exact number `nanojira check
 * --item=<n>` needs to flip that very box, so a consumer that reads
 * `acceptance[i].item` and passes it straight to `check --item=` never
 * ticks the wrong box just because a stray checkbox sits earlier in the
 * body (e.g. in Description). `[]` both when the section has no heading at
 * all and when it has one but no checkboxes -- the field itself does not
 * distinguish the two, unlike `description` below. */
function sectionCheckboxItems(body: string, names: string[]): { text: string; checked: boolean; item: number }[] {
  return acceptanceCheckboxes(body, names).map(({ m, item }) => ({
    text: m[4].trim(), checked: m[3] !== ' ', item,
  }));
}

interface Checkbox { line: number; rest: string; ticked: boolean }

/**
 * Every countable checkbox in document order (§ 10a, `nanojira check`'s own
 * `--item=<n>` numbering, TSK-052 item 1): top to bottom is depth-first
 * through nested lists, since a nested item is just a later, more-indented
 * line. `## Notes` is excluded (§ 10, an append-only audit trail); fenced
 * regions (``` / ~~~, matched after optional leading whitespace, closed
 * only by a matching-or-longer fence of the same character) are never
 * scanned — the one place in the spec where fence-awareness applies to
 * heading lines too (§ 7), unlike `sectionHeadingIndex`/`sectionEnd` above.
 * Lives here, not in `commands/cmd-check.ts`, so `core/derive.ts`'s
 * `acceptance[].item` (TSK-052 item 1) can share the exact same scan `check`
 * itself resolves `--item=<n>` against, rather than a second copy that
 * could drift from it.
 */
function scanCheckboxes(body: string): { lines: string[]; boxes: Checkbox[] } {
  const lines = body.split('\n');
  const boxes: Checkbox[] = [];
  let inNotes = false;
  let fence: FenceState | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const step = fenceStep(line, fence);
    fence = step.fence;
    if (step.skip) continue;
    if (/^#{1,2}[ \t]/.test(line)) {
      const h2 = /^##[ \t]+(.*?)[ \t]*$/.exec(line);
      inNotes = !!h2 && h2[1].replace(/:\s*$/, '').trim().toLowerCase() === 'notes';
      continue;
    }
    if (inNotes) continue;
    const m = CHECKBOX_RE.exec(line);
    if (m) boxes.push({ line: i, rest: m[4], ticked: m[3] !== ' ' });
  }
  return { lines, boxes };
}

/** A section's content as `writeSection` takes it (trailing blank lines
 * dropped), or `null` when the body has no such section. */
function sectionContent(body: string, names: string[]): string | null {
  const lines = body.split('\n');
  const idx = sectionHeadingIndex(lines, names);
  if (idx === -1) return null;
  return normalizeSectionContent(lines.slice(idx + 1, sectionEnd(lines, idx)).join('\n'));
}

/**
 * Replacing the acceptance section keeps ticks (§ 9, DECISIONS 223): a new
 * unticked line whose text after the checkbox is exactly that of a ticked
 * line in `body`'s section is written ticked, with the old line's tick
 * character. Each old ticked line is used at most once, first match first.
 * `reset` counts the old ticked lines no new line kept.
 */
function carryAcceptanceTicks(body: string, names: string[], content: string): { content: string; reset: number } {
  const old = body.split('\n');
  const idx = sectionHeadingIndex(old, names);
  const ticked = new Map<string, string[]>();
  let total = 0;
  if (idx !== -1) {
    for (const { m } of checkboxesOutsideFences(old, idx + 1, sectionEnd(old, idx))) {
      if (m[3] === ' ') continue;
      const marks = ticked.get(m[4]);
      if (marks === undefined) ticked.set(m[4], [m[3]]);
      else marks.push(m[3]);
      total++;
    }
  }
  const lines = content === '' ? [] : content.split('\n');
  let kept = 0;
  for (const { i, m } of checkboxesOutsideFences(lines, 0, lines.length)) {
    const marks = ticked.get(m[4]);
    if (marks === undefined || marks.length === 0) continue;
    const mark = marks.shift() as string;
    kept++;
    if (m[3] === ' ') lines[i] = `${m[1]}${m[2]} [${mark}]${m[4]}`;
  }
  return { content: lines.join('\n'), reset: total - kept };
}

function normalizeSectionContent(raw: string) {
  let t = String(raw);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return t.replace(/\n+$/, '');
}

// Where a missing section goes (§ 9): `description` after the H1 block, or at
// the start of the body when there is no H1 — after the blank line that
// separates body from frontmatter, which is structure, not content.
// `acceptance` before `## Notes`, else after `description`, else at the end.
function sectionInsertPoint(lines: string[], role: 'description' | 'acceptance', cfg: Config) {
  if (role === 'description') {
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /^#(?!#)/.test(lines[i])) i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return i;
  }
  const notes = sectionHeadingIndex(lines, ['Notes']);
  if (notes !== -1) return notes;
  const desc = sectionHeadingIndex(lines, cfg.sections.description);
  if (desc !== -1) return sectionEnd(lines, desc);
  return lines.length;
}

// Replace — never append — the region under a role's heading. The region becomes
// the content followed by one blank line. Mid-body that blank line is the
// separator before the next section; at the end of the body the same trailing
// empty element is the file's single closing newline, so one rule serves both
// and everything outside the region stays byte-for-byte (§ 9).
// Never checks for an open fence itself (TSK-053 v2, DECISIONS 233): that is
// now `refuseIfOpenFenceAtBoundary`'s job, run once against the fully
// resulting body in `applySections` below, after every role has been
// spliced in — a per-call, span-local check here could neither see a fence
// this call's own new content opens nor one an earlier, already-applied
// role left open.
function writeSection(body: string, role: 'description' | 'acceptance', cfg: Config, content: string) {
  const names = cfg.sections[role];
  const lines = body.split('\n');
  const contentLines = content === '' ? [] : content.split('\n');
  const at = sectionHeadingIndex(lines, names);
  if (at !== -1) {
    const end = sectionEnd(lines, at);
    lines.splice(at + 1, end - at - 1, ...contentLines, '');
  } else {
    lines.splice(sectionInsertPoint(lines, role, cfg), 0, `## ${names[0]}`, ...contentLines, '');
  }
  return lines.join('\n');
}

// Roles are applied in canonical order, so a freshly inserted `description`
// is already there when `acceptance` looks for where to go (§ 9).
function applySections(body: string, wanted: Map<string, string>, cfg: Config) {
  const changed = [];
  let result = body;
  for (const role of SECTION_ROLES) {
    if (!wanted.has(role)) continue;
    const next = writeSection(result, role, cfg, wanted.get(role) as string);
    if (next !== result) { result = next; changed.push(role); }
  }
  // Checked once, against the fully resulting body, only when something
  // actually changed (§ 9, "every write that changes body text" —
  // TSK-053 v2, DECISIONS 233): an unchanged result is already on disk,
  // so re-validating it here would block an unrelated frontmatter-only
  // write on damage this call did not cause and is not writing.
  if (changed.length > 0) refuseIfOpenFenceAtBoundary(result);
  return { body: result, changed };
}

// ----------------------------------------------------------------- notes

interface NoteLine { at: string; actor: string; text: string }

/**
 * Every note line under `## Notes` (§ 10, `nanojira log` § 12c), in document
 * order — the inverse of `withNote`'s own `- <ISO-8601> <author>: <text>`
 * format. The author never contains `:` (§ 9 "the acting name"), so the
 * first `: ` after it is an unambiguous boundary, exactly as § 12c states
 * ("text everything after the first ': ' following the author").
 * `## Notes` detection mirrors `cmd-check.ts`'s own `scanCheckboxes`.
 *
 * Multi-line text (DECISIONS 158 EV-7): a line immediately following a
 * note's own first line that is either completely empty or starts with
 * exactly two spaces is a continuation, consumed until a line that is
 * neither (a fresh note, a heading, a hand-added line — never merged in,
 * § 10 "Multi-line text"). A continuation can never itself start a fresh
 * note (it never begins `- ` at column 0), so this never misfires.
 */
const NOTE_LINE_RE = /^-\ (\S+)\ (.*)$/;

function parseNotes(body: string): NoteLine[] {
  const lines = body.split('\n');
  const notes: NoteLine[] = [];
  let inNotes = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,2}[ \t]/.test(line)) {
      const h2 = /^##[ \t]+(.*?)[ \t]*$/.exec(line);
      inNotes = !!h2 && h2[1].replace(/:\s*$/, '').trim().toLowerCase() === 'notes';
      i++; continue;
    }
    if (!inNotes) { i++; continue; }
    const m = NOTE_LINE_RE.exec(line);
    if (!m) { i++; continue; }
    const idx = m[2].indexOf(': ');
    if (idx === -1) { i++; continue; }
    const actor = m[2].slice(0, idx);
    const parts = [m[2].slice(idx + 2)];
    let j = i + 1;
    while (j < lines.length && (lines[j] === '' || lines[j].startsWith('  '))) {
      parts.push(lines[j] === '' ? '' : lines[j].slice(2));
      j++;
    }
    // A note's own text is always trimmed before it is written (it can
    // never legitimately END in a blank line), so any blank line(s) left
    // at the tail of what was just consumed are never the note's own —
    // either this file's single mandatory trailing newline (a
    // `String.split` artifact, not content) or genuine padding before the
    // next heading/EOF. A blank strictly between two non-blank lines is
    // untouched; only a trailing run is dropped.
    while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    notes.push({ at: m[1], actor, text: parts.join('\n') });
    i = j;
  }
  return notes;
}

/**
 * The literal `- <ts> <signer>: <text>` line, plus a two-space-indented
 * continuation line for everything after the first `\n` in `text` (§ 10
 * "Multi-line text") — the exact inverse of `parseNotes`'s own per-note
 * extraction, so re-rendering a `NoteLine` already read back out
 * reproduces the original bytes byte-for-byte. `cmd-note.ts` is the only
 * writer; `cmd-show.ts`'s `--notes=` truncation (§ 9b, TSK-005) reuses it
 * read-only, to redisplay a kept note exactly as stored without inventing
 * its own copy of this format.
 */
function renderNoteLine(ts: string, signer: string, text: string): string {
  const [first, ...rest] = text.split('\n');
  return [`- ${ts} ${signer}: ${first}`, ...rest.map((l) => (l === '' ? '  ' : `  ${l}`))].join('\n');
}

/**
 * The `## Notes` heading's own line index, and the exclusive index its
 * section ends at (the next `#`/`##` heading, or EOF) — the same boundary
 * `withNote` (cmd-note.ts) computes to know where to insert a fresh note,
 * reused read-only by `cmd-show.ts`'s `--notes=` truncation (§ 9b) to know
 * what to keep untouched before and after the section while only the
 * notes themselves are narrowed. `null` when `lines` has no `## Notes`
 * heading at all. When more than one line matches (a hand-edited body,
 * never written by `nanojira` itself), the LAST one wins — the same choice
 * `withNote` already makes, since that is the section a fresh note is
 * appended to.
 */
function notesSectionBounds(lines: string[]): { headingLine: number; endLine: number } | null {
  let headingLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (m && m[1].replace(/:\s*$/, '').trim().toLowerCase() === 'notes') headingLine = i;
  }
  if (headingLine === -1) return null;
  let endLine = lines.length;
  for (let j = headingLine + 1; j < lines.length; j++) {
    if (/^#{1,2}[ \t]/.test(lines[j])) { endLine = j; break; }
  }
  return { headingLine, endLine };
}

export type { Checkbox };
export { parseFile, serialize, h1Of, syncH1, sectionPresent, sectionHasCheckbox, sectionCheckboxCounts, sectionCheckboxItems, sectionContent, scanCheckboxes, carryAcceptanceTicks, tickAllAcceptance, CHECKBOX_RE, normalizeTitle, normalizeSectionContent, applySections, parseNotes, renderNoteLine, notesSectionBounds, refuseIfOpenFenceAtBoundary };
export type { NoteLine };
