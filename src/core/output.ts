'use strict';

// Output: the failure type, the shared output state (--json), and printing.

import type { Element, Config } from './types.ts';

import { elementProblems, entryJson } from './derive.ts';
import { sectionCheckboxCounts } from './parse.ts';
import { touchedFiles, failureFiles } from './touched.ts';

// The failure type, the --json state, hardExit, out, emitFailure and the
// EPIPE handler live in the project-neutral kernel (DECISIONS 231); this
// module adds nanojira's printing and hands the kernel the failure
// decorator below.
import { Fail, fail, output, setFailureDecorator, hardExit, out, emitFailure } from './kernel.ts';

/** A failure result plus `files` when part of the call had already landed
 * (§ 9 "files", DECISIONS 222): a pathspec commit, or a cleanup, needs to
 * know what is on disk now. */
function withFailureFiles<T extends object>(res: T): T {
  const files = failureFiles();
  return files === undefined ? res : Object.assign({}, res, { files });
}

setFailureDecorator(withFailureFiles);

// ----------------------------------------------------------------- printing

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

export { Fail, fail, output, hardExit, out, problemSuffix, printEntryLine, writeFeedback, buildWriteResult, emitWriteResult, emitFailure };
