'use strict';

// `nj note`.

import type { Flags, Element } from '../core/types.ts';

import { checkFlags, flagString } from '../core/args.ts';
import { context, resolveTarget, requireWritable, requireActive } from '../core/context.ts';
import { loadElement, deriveGraph } from '../core/load.ts';
import { fail, writeFeedback, emitWriteResult } from '../core/output.ts';
import { refreshStatus } from '../core/status.ts';
import { nowIso, guardedWrite, renderElement } from '../core/store.ts';

// § 10: a name is valid when, after dropping only leading/trailing spaces
// and tabs (not other whitespace), it is non-empty, a single line (any \n
// or \r left, trailing included, makes it multi-line) and has no ':'.
// Unicode spaces are literal characters of the name, not trimmed.
function validAuthor(raw: string): string | null {
  const trimmed = raw.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (trimmed === '' || /[\n\r]/.test(trimmed) || trimmed.includes(':')) return null;
  return trimmed;
}

// resolveTarget bundles the --id/--file argument-syntax checks (missing_value
// via flagString, missing_argument when neither is given, invalid_target when
// both are given) together with the actual lookup (not_found, duplicate_id).
// § 10's precedence puts NJ_AUTHOR (invalid_env) between those two halves —
// argument parsing first, then NJ_AUTHOR, then target resolution — so the
// syntax half runs here, early; resolveTarget below re-derives the same
// flags harmlessly and does the lookup. D111: invalid_target (--id with
// --file) ranks with argument parsing, so it is checked here too.
function requireTargetFlagSyntax(flags: Flags) {
  const file = flagString(flags, 'file');
  const id = flagString(flags, 'id');
  if (file !== undefined && id !== undefined) fail('invalid_target', 'use either --id or --file, not both');
  if (file === undefined && id === undefined) fail('missing_argument', '--id is required');
}

function cmdNote(flags: Flags, positional: string[]) {
  checkFlags(flags, [], new Set(['json', 'force', 'id', 'file']), true);
  const json = flags.has('json');
  const ctx = context(flags);

  requireTargetFlagSyntax(flags);
  const text = positional.join(' ').trim();
  if (text === '') fail('missing_argument', 'nj note needs the note text as an argument', 'nj note --id=TSK-007 "…"');

  const authorEnv = process.env.NJ_AUTHOR;
  let author: string | null = null;
  if (authorEnv !== undefined && authorEnv !== '') {
    author = validAuthor(authorEnv);
    if (author === null) {
      fail('invalid_env', `invalid NJ_AUTHOR '${authorEnv}' (must be non-empty after trimming spaces/tabs, a single line, and contain no ':')`);
    }
  }

  const el = resolveTarget(ctx, flags, true);
  requireWritable(el);
  requireActive(el, 'note');

  const ts = nowIso();
  const signer = author !== null ? author : el.assignee !== '' ? el.assignee : '?';
  const line = `- ${ts} ${signer}: ${text.replace(/[\r\n]+/g, ' ')}`;

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

  const fresh = loadElement(el.file, ctx.backlog, ctx.cfg);
  deriveGraph(ctx.elements.map((e: Element) => (e.file === el.file ? fresh : e)), ctx.idsDir, ctx.cfg.layout);
  refreshStatus(ctx.backlog, ctx.cfg, ctx);
  if (json) emitWriteResult(true, fresh, ['body']);
  else writeFeedback(fresh, ctx.cfg, `${fresh.id} note added`);
  return 0;
}

export { cmdNote };
