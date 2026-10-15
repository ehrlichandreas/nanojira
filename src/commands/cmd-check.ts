'use strict';

// `nanojira check` (§ 10a).

import type { Flags, Element } from '../core/types.ts';

import { checkFlags, flagString } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out, writeFeedback, emitWriteResult } from '../core/output.ts';
import { CHECKBOX_RE } from '../core/parse.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { nowIso, guardedWrite, guardedWriteCatchable, renderElement } from '../core/store.ts';

// CHECKBOX_RE (core/parse.ts): after optional leading whitespace, a list
// marker (-, *, +, or an ordered <digits>. / <digits>)), one space, then
// [ ]/[x]/[X]. Captures leading whitespace, the marker, the box content and
// everything after ']' — the write reconstructs the line from exactly these
// pieces, so only the box content ever changes (§ 10a). Shared with
// `acceptance:no_checkbox` (§ 7, DECISIONS 163 E) so the two can never
// disagree on what counts as a checkbox.

interface Checkbox { line: number; rest: string; ticked: boolean }

/**
 * Every countable checkbox in document order: top to bottom is depth-first
 * through nested lists, since a nested item is just a later, more-indented
 * line. `## Notes` is excluded (§ 10, an append-only audit trail); fenced
 * regions (``` / ~~~, matched after optional leading whitespace, closed
 * only by a matching-or-longer fence of the same character) are never
 * scanned — the one place in the spec where fence-awareness exists (§ 7).
 */
function scanCheckboxes(body: string): { lines: string[]; boxes: Checkbox[] } {
  const lines = body.split('\n');
  const boxes: Checkbox[] = [];
  let inNotes = false;
  let fence: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len) fence = null;
      continue;
    }
    if (fm) { fence = { ch: fm[1][0], len: fm[1].length }; continue; }
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

interface CheckItem { el: Element; newBody: string | null }

/** Resolves --text/--item to exactly one countable checkbox and computes the flipped body — `newBody: null` means a no-op (already in the wanted state). Pure; the only write happens after this (§ 9 "Batch writes" preflight). */
function prepareCheck(el: Element, text: string | undefined, item: string | undefined, wantOn: boolean): CheckItem {
  const { lines, boxes } = scanCheckboxes(el.body);
  let target: Checkbox;
  if (item !== undefined) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 1 || n > boxes.length) fail('not_found', `--item=${item} is out of range (1..${boxes.length})`);
    target = boxes[n - 1];
  } else {
    const matches = boxes.filter((b) => b.rest.includes(text as string));
    if (matches.length === 0) fail('not_found', `no checkbox line contains '${text}'`);
    if (matches.length > 1) {
      fail('ambiguous_target', `'${text}' matches ${matches.length} checkbox lines`, '--item=<n> addresses exactly one, or narrow --text');
    }
    target = matches[0];
  }
  if (target.ticked === wantOn) return { el, newBody: null };
  const line = lines[target.line];
  const m = CHECKBOX_RE.exec(line) as RegExpExecArray;
  lines[target.line] = `${m[1]}${m[2]} [${wantOn ? 'x' : ' '}]${m[4]}`;
  return { el, newBody: lines.join('\n') };
}

function cmdCheck(flags: Flags) {
  checkFlags(flags, [], new Set(['json', 'force', ...cliFieldNames('check')]), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const text = flagString(flags, 'text');
  const item = flagString(flags, 'item');
  if (text !== undefined && item !== undefined) fail('invalid_value', 'use either --text or --item, not both');
  if (text === undefined && item === undefined) fail('missing_argument', 'nanojira check needs --text=<substring> or --item=<n>');
  // The empty string is rejected, not trimmed (DECISIONS 129): a
  // whitespace-only --text is still a substring to match against.
  if (text === '') fail('invalid_value', '--text must not be empty');

  // Neither --on nor --off ticks — "check" names the common case (DECISIONS 128).
  if (flags.has('on') && flags.has('off')) fail('invalid_value', 'use either --on or --off, not both');
  const wantOn = !flags.has('off');

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const ts = nowIso();
    const result = runBatch<CheckItem, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(el, 'check');
        return prepareCheck(el, text, item, wantOn);
      },
      (prepared) => {
        if (prepared.newBody === null) {
          const entry = entryJson(prepared.el, ctx.backlog, ctx.cfg);
          return { ok: true, changed: [], entry, _problems: entry._problems };
        }
        guardedWriteCatchable(prepared.el, renderElement(prepared.el, new Map([['updated', ts]]), prepared.newBody), flags.has('force'), ctx.backlog);
        const fresh = loadElement(prepared.el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e: Element) => (e.file === prepared.el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
        return { ok: true, changed: ['body'], entry, _problems: entry._problems };
      },
    );
    if (result.anyWritten) { refreshStatus(ctx.backlog, ctx.cfg, ctx); refreshTags(ctx.backlog, ctx.cfg, ctx); }
    const wrapper = { ok: result.ok, results: result.results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} ${wantOn ? 'checked' : 'unchecked'}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'check');

  const prepared = prepareCheck(el, text, item, wantOn);
  if (prepared.newBody === null) {
    if (json) emitWriteResult(true, el, [], ctx.backlog, ctx.cfg);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }

  const ts = nowIso();
  guardedWrite(el, renderElement(el, new Map([['updated', ts]]), prepared.newBody), flags.has('force'), ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  if (json) emitWriteResult(true, fresh, ['body'], ctx.backlog, ctx.cfg);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} ${wantOn ? 'checked' : 'unchecked'}`);
  return 0;
}

export { cmdCheck };
