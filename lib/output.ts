'use strict';

// Output: the failure type, the shared output state (--json), and printing.

import type { Element, Config } from './types.ts';

import { elementProblems, entryJson } from './derive.ts';

// ------------------------------------------------------------------- errors

class Fail extends Error {
  hint?: string;
  code: string;
  constructor(message: string, hint?: string, code?: string) { super(message); this.hint = hint; this.code = code || 'failed'; }
}

function fail(code: string, message: string, hint?: string): never { throw new Fail(message, hint, code); }

// Set as soon as argv is parsed, so the top-level catch can honour --json (§ 9).
const output = { json: false };

/**
 * Paths that must not unwind through the normal error handling (fault hooks,
 * exhausted allocator) still owe --json callers a result object (§ 9).
 */
function hardExit(code: string, message: string): never {
  process.stderr.write(message + '\n');
  if (output.json) process.stdout.write(JSON.stringify({ ok: false, error: code }, null, 2) + '\n');
  process.exit(1);
}

// ----------------------------------------------------------------- printing

function out(s: string) { process.stdout.write(s + '\n'); }

function problemSuffix(el: Element) {
  const codes = elementProblems(el);
  return codes.length > 0 ? '  ' + codes.join(' ') : '';
}

function printEntryLine(el: Element, cfg: Config) {
  const arch = el.archived ? ' (archived)' : '';
  out(`  ${el.id}  ${el.status.padEnd(8)} ${el.title}${arch}${problemSuffix(el)}`);
}

function writeFeedback(el: Element, cfg: Config, headline: string) {
  out(headline);
  for (const code of elementProblems(el)) {
    if (code === 'incomplete:acceptance') out(`⚠ ${el.id} has no acceptance criteria. Add them before starting.`);
    else if (code === 'incomplete:description') out(`⚠ ${el.id} has no description. Add one before starting.`);
    else out(`⚠ ${el.id}: ${code}`);
  }
}

function emitWriteResult(json: boolean, el: Element, changed: string[], extra?: object) {
  if (!json) return;
  const entry = entryJson(el);
  // The top-level `_problems` mirrors entry._problems so an agent can branch on
  // one well-known place regardless of the command (§ 9).
  const res = Object.assign({ ok: true, id: el.id, changed, entry, _problems: entry._problems }, extra || {});
  out(JSON.stringify(res, null, 2));
}

/** With --json every exit path emits JSON on stdout; the prose stays on stderr (§ 9). */
function emitFailure(code: string, message: string, hint?: string) {
  process.stderr.write(`Error: ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  if (output.json) {
    const res: { ok: boolean; error: string; hint?: string } = { ok: false, error: code };
    if (hint) res.hint = hint;
    out(JSON.stringify(res, null, 2));
  }
  process.exitCode = 1;
}

export { Fail, fail, output, hardExit, out, problemSuffix, printEntryLine, writeFeedback, emitWriteResult, emitFailure };
