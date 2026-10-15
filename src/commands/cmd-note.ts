'use strict';

// `nanojira note`.

import type { Flags, Element } from '../core/types.ts';

import { resolveActingName } from '../core/actor.ts';
import { checkFlags } from '../core/args.ts';
import { cliFieldNames } from '../core/flag-table.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, out, writeFeedback, emitWriteResult } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { nowIso, guardedWrite, guardedWriteCatchable, renderElement } from '../core/store.ts';

/**
 * The note's own text, as literal lines (§ 10 "Multi-line text", DECISIONS
 * 158 EV-7): the first becomes `<text>` on the `- <ts> <author>: <text>`
 * line itself; every line after it is a Markdown list continuation,
 * indented by exactly two spaces — a blank line among them is written as
 * exactly two spaces (never truly empty), the one deliberate exception to
 * this project's "no trailing whitespace" rule, so a reader (and
 * `parseNotes`) can tell it apart from the blank line that would otherwise
 * end `## Notes`.
 */
function noteLine(ts: string, signer: string, text: string): string {
  const [first, ...rest] = text.split('\n');
  return [`- ${ts} ${signer}: ${first}`, ...rest.map((l) => (l === '' ? '  ' : `  ${l}`))].join('\n');
}

/** The note line, and the body with it inserted (§ 10) — shared by the single and batch paths. */
function withNote(el: Element, text: string, signer: string, ts: string): string {
  const line = noteLine(ts, signer, text);
  let body = el.body;
  const lines = body.split('\n');
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (m && m[1].replace(/:\s*$/, '').trim().toLowerCase() === 'notes') idx = i;
  }
  if (idx === -1) {
    // Exactly one blank line before the heading; if the body already ends in
    // one, none is added (§ 10).
    body = body.replace(/\n+$/, '\n');
    if (body !== '' && !body.endsWith('\n')) body += '\n';
    body += `\n## Notes\n${line}\n`;
    return body;
  }
  let end = lines.length;
  for (let j = idx + 1; j < lines.length; j++) {
    if (/^#{1,2}[ \t]/.test(lines[j])) { end = j; break; }
  }
  let insert = end;
  // A strict, exact-empty check — not `.trim() === ''` — because a
  // multi-line note's own blank continuation line is exactly two spaces,
  // never truly empty; only genuine section-trailing padding is skipped
  // here, never another note's own content (§ 10 "Multi-line text").
  while (insert > idx + 1 && lines[insert - 1] === '') insert--;
  lines.splice(insert, 0, line);
  return lines.join('\n');
}

function cmdNote(flags: Flags, positional: string[]) {
  checkFlags(flags, [], new Set(['json', 'force', ...cliFieldNames('note')]), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  // \r\n and a lone \r normalise to \n first, the same as every other
  // write path (§ 7); the overall text is then trimmed, exactly as before
  // multi-line text existed (§ 10 "Multi-line text").
  const text = positional.join(' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (text === '') fail('missing_argument', 'nanojira note needs the note text as an argument', 'nanojira note --id=TSK-007 "…"');

  const author = resolveActingName(flags, false);

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const ts = nowIso();
    const result = runBatch<Element, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(el, 'note');
        return el;
      },
      (el) => {
        const signer = author !== null ? author : el.assignee !== '' ? el.assignee : '?';
        const newBody = withNote(el, text, signer, ts);
        guardedWriteCatchable(el, renderElement(el, new Map([['updated', ts]]), newBody), flags.has('force'), ctx.backlog);
        const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
        const entry = entryJson(fresh, ctx.backlog, ctx.cfg);
        return { ok: true, changed: ['body'], entry, _problems: entry._problems };
      },
    );
    if (result.anyWritten) { refreshStatus(ctx.backlog, ctx.cfg, ctx); refreshTags(ctx.backlog, ctx.cfg, ctx); }
    const wrapper = { ok: result.ok, results: result.results };
    if (json) out(JSON.stringify(wrapper, null, 2));
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} note added` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'note');

  const ts = nowIso();
  const signer = author !== null ? author : el.assignee !== '' ? el.assignee : '?';
  const newBody = withNote(el, text, signer, ts);

  const overrides = new Map([['updated', ts]]);
  guardedWrite(el, renderElement(el, overrides, newBody), flags.has('force'), ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  if (json) emitWriteResult(true, fresh, ['body'], ctx.backlog, ctx.cfg);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} note added`);
  return 0;
}

export { cmdNote };
