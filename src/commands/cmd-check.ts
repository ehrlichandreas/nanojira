'use strict';

// `nanojira check` (§ 10a).

import type { Flags, Element } from '../core/types.ts';

import { flagString } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { ENTRY_FIELDS } from '../core/constants.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { buildWriteResult, fail, out, writeFeedback } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { parseOutputOpts, emitWriteResultOpts, trimResult } from '../core/result-opts.ts';
import { CHECKBOX_RE, scanCheckboxes } from '../core/parse.ts';
import type { Checkbox } from '../core/parse.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { nowIso, guardedWrite, guardedWriteCatchable, renderElement } from '../core/store.ts';
import { touchedFiles } from '../core/touched.ts';

// CHECKBOX_RE (core/parse.ts): after optional leading whitespace, a list
// marker (-, *, +, or an ordered <digits>. / <digits>)), one space, then
// [ ]/[x]/[X]. Captures leading whitespace, the marker, the box content and
// everything after ']' — the write reconstructs the line from exactly these
// pieces, so only the box content ever changes (§ 10a). Shared with
// `acceptance:no_checkbox` (§ 7, DECISIONS 163 E) so the two can never
// disagree on what counts as a checkbox.

interface CheckItem { el: Element; newBody: string | null }

/** Resolves --text/--item to exactly one countable checkbox and computes the flipped body — `newBody: null` means a no-op (already in the wanted state). Pure; the only write happens after this (§ 9 "Batch writes" preflight). */
function prepareCheck(el: Element, text: string | undefined, item: string | undefined, wantOn: boolean): CheckItem {
  const { lines, boxes } = scanCheckboxes(el.body);
  let target: Checkbox;
  if (item !== undefined) {
    // Not a whole number at all is a bad value; a number past the boxes is
    // a box that does not exist (TSK-038). Surrounding whitespace is
    // dropped first: `--item=$(wc -l <f)` pads on BSD. Digits only after
    // that, so 1.0, +1, 1e0 and 0x1 are refused.
    if (!/^\d+$/.test(item.trim())) fail('invalid_value', `--item=${item} is not a whole number`, 'count the acceptance items from 1');
    const n = Number(item.trim());
    if (n < 1 || n > boxes.length) fail('not_found', `--item=${item} is out of range (1..${boxes.length})`);
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
  checkCommandFlags(flags, 'check');
  const json = flags.has('json');
  const opts = parseOutputOpts(flags, json, ENTRY_FIELDS);
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
    const result = runBatch<{ prepared: CheckItem; content: string | null }, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(ctx, el, 'check');
        const prepared = prepareCheck(el, text, item, wantOn);
        // Rendered in preflight: refused:too_large (DECISIONS 215) writes nothing of the batch.
        const content = prepared.newBody === null ? null : renderElement(el, new Map([['updated', ts]]), prepared.newBody);
        return { prepared, content };
      },
      ({ prepared, content }) => {
        if (content === null) {
          const entry = entryJson(prepared.el, ctx.backlog, ctx.cfg);
          return { ok: true, changed: [], entry, _problems: entry._problems };
        }
        guardedWriteCatchable(prepared.el, content, flags.has('force'), ctx.backlog);
        const fresh = loadElement(prepared.el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e: Element) => (e.file === prepared.el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
        return { ok: true, changed: ['body'], entry, _problems: entry._problems };
      },
    );
    if (result.anyWritten) { refreshStatus(ctx.backlog, ctx.cfg, ctx); refreshTags(ctx.backlog, ctx.cfg, ctx); }
    const results = opts.quiet || opts.fields !== undefined
      ? result.results.map((r: any) => (r.ok ? trimResult(r, opts) : r))
      : result.results;
    const files = touchedFiles(ctx.backlog);
    if (result.anyWritten) recordChange(ctx.backlog, () => ({ ok: result.ok, results: result.results, files }));
    const wrapper = { ok: result.ok, results, files };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} ${wantOn ? 'checked' : 'unchecked'}` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(ctx, el, 'check');

  const prepared = prepareCheck(el, text, item, wantOn);
  if (prepared.newBody === null) {
    recordChange(ctx.backlog, () => buildWriteResult(el, [], ctx.backlog, ctx.cfg));
    if (json) emitWriteResultOpts(true, el, [], ctx.backlog, ctx.cfg, undefined, opts);
    else writeFeedback(el, ctx.cfg, `${el.id} unchanged`);
    return 0;
  }

  const ts = nowIso();
  guardedWrite(el, renderElement(el, new Map([['updated', ts]]), prepared.newBody), flags.has('force'), ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  recordChange(ctx.backlog, () => buildWriteResult(fresh, ['body'], ctx.backlog, ctx.cfg));
  if (json) emitWriteResultOpts(true, fresh, ['body'], ctx.backlog, ctx.cfg, undefined, opts);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} ${wantOn ? 'checked' : 'unchecked'}`);
  return 0;
}

export { cmdCheck };
