'use strict';

// Parsing and serialising element files: frontmatter values, file layout, body sections.

import type { ParsedFile, Config } from './types.ts';

import { FIELD_ORDER, LIST_FIELDS, SECTION_ROLES } from './constants.ts';

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

// A section ends at the next `#`/`##` heading; `###`+ is content (decision 11).
function sectionEnd(lines: string[], headingIdx: number) {
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}[ \t]/.test(lines[i])) return i;
  }
  return lines.length;
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
function writeSection(body: string, role: 'description' | 'acceptance', cfg: Config, content: string) {
  const names = cfg.sections[role];
  const lines = body.split('\n');
  const contentLines = content === '' ? [] : content.split('\n');
  const at = sectionHeadingIndex(lines, names);
  if (at !== -1) {
    lines.splice(at + 1, sectionEnd(lines, at) - at - 1, ...contentLines, '');
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
  return { body: result, changed };
}

export { parseFile, serialize, h1Of, syncH1, sectionPresent, normalizeTitle, normalizeSectionContent, applySections };
