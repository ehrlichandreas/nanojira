'use strict';

// Batch writes (§ 9 "Batch writes"): `--id=A,B,C` on set/note/check/claim/
// release. Shared by all five so the orchestration (preflight, then write,
// STATUS.md once, NJ_FAULT spent after its first firing) lives in one
// place; each command keeps its own single-element logic unchanged and
// supplies it here as two callbacks.

import type { Flags } from './types.ts';

import { flagString } from './args.ts';
import { Fail, fail } from './output.ts';

/**
 * `--id=A,B,C` -> the trimmed names, in the order given, when there are two
 * or more (a batch); `null` when `--id` is absent or names only one (the
 * single-element path, unaffected by batch writes existing). A name
 * repeated after trimming is `invalid_value` — an argument error, not a
 * per-ID one, since "every ID resolved and validated" already implies every
 * named ID is distinct (§ 9).
 */
function parseBatchIds(flags: Flags): string[] | null {
  const raw = flagString(flags, 'id');
  if (raw === undefined || !raw.includes(',')) return null;
  const ids = raw.split(',').map((s) => s.trim());
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail('invalid_value', `'${id}' is named twice in --id=${raw} (after trimming whitespace)`);
    seen.add(id);
  }
  return ids;
}

interface FailureResult { id: string; ok: false; error: string; hint?: string }

function asFailure(id: string, e: unknown): FailureResult {
  if (e instanceof Fail) return { id, ok: false, error: e.code, hint: e.hint };
  return { id, ok: false, error: 'internal_error', hint: e instanceof Error ? e.stack : String(e) };
}

/**
 * Preflight over every ID, then (only if every one passed) a write phase
 * over every ID independently (§ 9 "Batch writes"). `NJ_FAULT` fires once
 * per batch: the first write whose failure carries a `fault:<hook>` code
 * spends the hook (clears `process.env.NJ_FAULT`) so every later ID in the
 * batch writes normally (§ 12, DECISIONS 135).
 */
function runBatch<T, R extends object>(
  ids: string[],
  preflight: (id: string) => T,
  write: (item: T) => R,
): { ok: boolean; results: object[]; anyWritten: boolean } {
  const items: T[] = [];
  const preflightFailures: FailureResult[] = [];
  for (const id of ids) {
    try {
      items.push(preflight(id));
    } catch (e) {
      preflightFailures.push(asFailure(id, e));
    }
  }
  if (preflightFailures.length > 0) {
    return { ok: false, results: preflightFailures, anyWritten: false };
  }

  const results: object[] = [];
  let anyWritten = false;
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = write(items[i]);
      anyWritten = true;
      results.push(Object.assign({ id: ids[i] }, r));
    } catch (e) {
      const failure = asFailure(ids[i], e);
      results.push(failure);
      if (failure.error.startsWith('fault:') && process.env.NJ_FAULT !== undefined) delete process.env.NJ_FAULT;
    }
  }
  return { ok: results.every((r: any) => r.ok === true), results, anyWritten };
}

export { parseBatchIds, runBatch };
