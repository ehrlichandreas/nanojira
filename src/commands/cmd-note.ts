'use strict';

// `nj note`.

import type { Flags, Element } from '../core/types.ts';

import { checkFlags } from '../core/args.ts';
import { context, resolveTarget, requireWritable, requireActive } from '../core/context.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, writeFeedback, emitWriteResult } from '../core/output.ts';
import { nowIso, guardedWrite, renderElement } from '../core/store.ts';

function cmdNote(flags: Flags, positional: string[]) {
  checkFlags(flags, [], new Set(['json', 'force', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context();
  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'note');

  const text = positional.join(' ').trim();
  if (text === '') fail('missing_argument', 'nj note needs the note text as an argument', 'nj note --id=TSK-007 "…"');

  const ts = nowIso();
  const author = el.assignee !== '' ? el.assignee : '?';
  const line = `- ${ts} ${author}: ${text.replace(/[\r\n]+/g, ' ')}`;

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
  } else {
    let end = lines.length;
    for (let j = idx + 1; j < lines.length; j++) {
      if (/^#{1,2}[ \t]/.test(lines[j])) { end = j; break; }
    }
    let insert = end;
    while (insert > idx + 1 && lines[insert - 1].trim() === '') insert--;
    lines.splice(insert, 0, line);
    body = lines.join('\n');
  }

  const overrides = new Map([['updated', ts]]);
  guardedWrite(el, renderElement(el, overrides, body), flags.has('force'), ctx.backlog);

  const fresh = loadElement(el.file, el.folder, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.backlog);
  if (json) emitWriteResult(true, fresh, ['body']);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} note added`);
  return 0;
}

export { cmdNote };
