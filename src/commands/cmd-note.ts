'use strict';

// `nanojira note`.

import type { Flags, Element } from '../core/types.ts';

import * as fs from 'fs';
import { resolveActingName } from '../core/actor.ts';
import { flagString, readStdin } from '../core/args.ts';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { parseBatchIds, runBatch } from '../core/batch.ts';
import { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireActive } from '../core/context.ts';
import { entryJson } from '../core/derive.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { buildWriteResult, fail, out, writeFeedback } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { renderNoteLine } from '../core/parse.ts';
import { parseOutputOpts, emitWriteResultOpts, trimResult } from '../core/result-opts.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';
import { nowIso, guardedWrite, guardedWriteCatchable, renderElement } from '../core/store.ts';
import { touchedFiles } from '../core/touched.ts';

/** The note line, and the body with it inserted (§ 10) — shared by the single and batch paths. */
function withNote(el: Element, text: string, signer: string, ts: string): string {
  const line = renderNoteLine(ts, signer, text);
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

/**
 * The note's own text, from whichever of the three sources was given —
 * the positional argument (unchanged), `--text=<t>`, or
 * `--text-file=<path|->` (TSK-006, mirroring `--description`/
 * `--description-file`'s own stdin-via-`-`/file-path/mutual-exclusion
 * shape, § 9 "Section writes"). Exactly one may be given; two or more is
 * `invalid_value`, nothing written, the same code § 9 already uses for
 * `--description`+`--description-file` together. Whichever source wins,
 * the resulting raw text goes through the identical `\r\n`/`\r` → `\n`
 * normalisation and trim DECISIONS 158 (§ 10 "Multi-line text") already
 * pins for the positional form — one text-content rule, regardless of
 * source.
 */
function resolveNoteText(flags: Flags, positional: string[]): string {
  const textFlag = flagString(flags, 'text');
  const textFile = flagString(flags, 'text-file');
  const given = [positional.length > 0, textFlag !== undefined, textFile !== undefined].filter(Boolean).length;
  if (given > 1) {
    fail('invalid_value', 'the note text was given more than one way (positional, --text, --text-file). Nothing written.',
      'pass it as a positional argument, with --text=…, or with --text-file=<path|->, not more than one');
  }
  let raw: string;
  if (textFile !== undefined) {
    raw = textFile === '-' ? readStdin() : readTextFile(textFile);
  } else if (textFlag !== undefined) {
    raw = textFlag;
  } else {
    raw = positional.join(' ');
  }
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (text === '') {
    fail('missing_argument', 'nanojira note needs the note text as an argument',
      'nanojira note --id=TSK-007 "…" (or --text=…, --text-file=<path|->)');
  }
  return text;
}

function readTextFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (e: any) {
    return fail('not_found', `--text-file: cannot read '${filePath}' — ${e.message}. Nothing written.`,
      'give a readable path, or `-` to read stdin');
  }
}

function cmdNote(flags: Flags, positional: string[]) {
  checkCommandFlags(flags, 'note');
  const json = flags.has('json');
  const opts = parseOutputOpts(flags, json);
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const text = resolveNoteText(flags, positional);

  const author = resolveActingName(flags, false);

  // Batch writes (§ 9): --id=A,B,C, two or more. A single --id is
  // unaffected and falls through to the unchanged path below.
  const batchIds = parseBatchIds(flags);
  if (batchIds !== null) {
    const ts = nowIso();
    const result = runBatch<{ el: Element; content: string }, object>(
      batchIds,
      (id) => {
        const el = resolveById(ctx, id, true);
        requireWritable(el);
        requireActive(ctx, el, 'note');
        // Rendered in preflight: refused:too_large (DECISIONS 215) writes nothing of the batch.
        const signer = author !== null ? author : el.assignee !== '' ? el.assignee : '?';
        const newBody = withNote(el, text, signer, ts);
        return { el, content: renderElement(el, new Map([['updated', ts]]), newBody) };
      },
      ({ el, content }) => {
        guardedWriteCatchable(el, content, flags.has('force'), ctx.backlog);
        const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
        deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
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
    else for (const r of result.results as any[]) out(r.ok ? `${r.id} note added` : `${r.id}: Error: ${r.error}`);
    return result.ok ? 0 : 1;
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(ctx, el, 'note');

  const ts = nowIso();
  const signer = author !== null ? author : el.assignee !== '' ? el.assignee : '?';
  const newBody = withNote(el, text, signer, ts);

  const overrides = new Map([['updated', ts]]);
  guardedWrite(el, renderElement(el, overrides, newBody), flags.has('force'), ctx.backlog);

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  refreshTags(ctx.backlog, ctx.cfg, ctx);
  recordChange(ctx.backlog, () => buildWriteResult(fresh, ['body'], ctx.backlog, ctx.cfg));
  if (json) emitWriteResultOpts(true, fresh, ['body'], ctx.backlog, ctx.cfg, undefined, opts);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} note added`);
  return 0;
}

export { cmdNote };
