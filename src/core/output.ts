'use strict';

// Output: the failure type, the shared output state (--json), and printing.

import type { Element, Config } from './types.ts';

import { elementProblems, entryJson } from './derive.ts';
import { sectionCheckboxCounts } from './parse.ts';
import { touchedFiles, failureFiles } from './touched.ts';

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
/** A failure result plus `files` when part of the call had already landed
 * (§ 9 "files", DECISIONS 222): a pathspec commit, or a cleanup, needs to
 * know what is on disk now. */
function withFailureFiles<T extends object>(res: T): T {
  const files = failureFiles();
  return files === undefined ? res : Object.assign({}, res, { files });
}

function hardExit(code: string, message: string): never {
  process.stderr.write(message + '\n');
  if (output.json) process.stdout.write(JSON.stringify(withFailureFiles({ ok: false, error: code }), null, 2) + '\n');
  process.exit(1);
}

// ----------------------------------------------------------------- printing

// TSK-018: a reader that closes early (`nanojira list | head`) makes the next
// stdout write fail with EPIPE. Node's write() call itself does not throw --
// the failure surfaces asynchronously as an 'error' event on the stream --
// so an unhandled EPIPE crashes the process with a full stack trace despite
// the command having done everything it was asked. The spec is silent here;
// decided behaviour (not derived, see AMBIGUITIES.md): the command already
// succeeded and only the reader stopped listening, so EPIPE on stdout is
// silent and exits 0 -- no stack trace, nothing on stderr. Any OTHER stdout
// write error is a real fault and must still crash visibly, exactly as an
// unhandled error normally would; re-throwing here (rather than swallowing)
// is what keeps that true, since registering this listener at all suppresses
// Node's own default "uncaught error event" crash for every error on this
// stream, not just EPIPE.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function out(s: string) { process.stdout.write(s + '\n'); }

function problemSuffix(el: Element, cfg: Config) {
  const codes = elementProblems(el, cfg.problems.ignore);
  return codes.length > 0 ? '  ' + codes.join(' ') : '';
}

function printEntryLine(el: Element, cfg: Config) {
  const arch = el.archived ? ' (archived)' : '';
  out(`  ${el.id}  ${el.status.padEnd(8)} ${el.title}${arch}${problemSuffix(el, cfg)}`);
}

function writeFeedback(el: Element, cfg: Config, headline: string) {
  out(headline);
  for (const code of elementProblems(el, cfg.problems.ignore)) {
    if (code === 'incomplete:acceptance') out(`⚠ ${el.id} has no acceptance criteria. Add them before starting.`);
    else if (code === 'incomplete:description') out(`⚠ ${el.id} has no description. Add one before starting.`);
    else if (code === 'acceptance:no_checkbox') out(`⚠ ${el.id} has acceptance criteria with no checkbox items — nothing for check to tick.`);
    else if (code === 'done:no_acceptance') out(`⚠ ${el.id} is done with no acceptance criteria.`);
    else if (code === 'done:open_acceptance') {
      const counts = sectionCheckboxCounts(el.body, cfg.sections.acceptance);
      out(`⚠ ${el.id} is done with ${counts ? counts.unticked : '?'} of ${counts ? counts.total : '?'} acceptance boxes still unticked.`);
    }
    else out(`⚠ ${el.id}: ${code}`);
  }
}

/** The single-ID write-result object itself, with no `--json`/printing
 * concerns — factored out of `emitWriteResult` so `core/result-opts.ts`'s
 * `--fields`/`--quiet` trimming can build the exact same object and apply
 * itself to it before printing, without duplicating this shape a second
 * time (§ 9 "`--fields` / `--quiet`"). */
function buildWriteResult(el: Element, changed: string[], backlog: string, cfg: Config, extra?: object) {
  const entry = entryJson(el, backlog, cfg);
  // The top-level `_problems` mirrors entry._problems so an agent can branch on
  // one well-known place regardless of the command (§ 9).
  // `files` (§ 9, DECISIONS 222): what this call wrote, last.
  return Object.assign({ ok: true, id: el.id, changed, entry, _problems: entry._problems }, extra || {}, { files: touchedFiles(backlog) });
}

function emitWriteResult(json: boolean, el: Element, changed: string[], backlog: string, cfg: Config, extra?: object) {
  if (!json) return;
  out(JSON.stringify(buildWriteResult(el, changed, backlog, cfg, extra), null, 2));
}

/** With --json every exit path emits JSON on stdout; the prose stays on stderr (§ 9). */
function emitFailure(code: string, message: string, hint?: string) {
  process.stderr.write(`Error: ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  if (output.json) {
    const res: { ok: boolean; error: string; hint?: string } = { ok: false, error: code };
    if (hint) res.hint = hint;
    out(JSON.stringify(withFailureFiles(res), null, 2));
  }
  process.exitCode = 1;
}

export { Fail, fail, output, hardExit, out, problemSuffix, printEntryLine, writeFeedback, buildWriteResult, emitWriteResult, emitFailure };
