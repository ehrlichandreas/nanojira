'use strict';

// The optional change hook (§ 9 "`NJ_ON_CHANGE`", DECISIONS 200): after a
// successful write, `/bin/sh -c "$NJ_ON_CHANGE"` runs with the write's full
// `--json` result on stdin, so a team can push changes to an outside board
// without nanojira itself ever touching the network.
//
// Configured ONLY through the environment, never through
// `.nanojira/config.json` or any other file in the backlog: a cloned or
// foreign backlog must never be able to make nanojira execute code. Nothing
// in this module reads the backlog to decide whether, or what, to run.
//
// The flow is three calls, all no-ops unless the hook is armed:
//   beginOnChange(cmd, flags)  main(), before dispatch — decides once
//                              whether this invocation may fire at all,
//                              and validates NJ_ON_CHANGE_TIMEOUT before
//                              anything is written;
//   recordChange(backlog, fn)  each writer, once its write (and STATUS.md/
//                              TAGS.md refresh) is complete — `fn` builds
//                              the full, untrimmed result, called only when
//                              armed, so an unarmed run builds nothing extra;
//   fireRecordedChange()       main's caller, only after the command
//                              returned normally (never after a thrown
//                              failure) — runs the hook, waits for it,
//                              reports a hook failure as a stderr warning.

import type { Flags } from './types.ts';

import { spawn } from 'child_process';
import { isDryRun } from './dry-run.ts';
import { fail } from './output.ts';

const DEFAULT_TIMEOUT_S = 10;
const MAX_TIMEOUT_S = 86400;

/** Commands that can write. `doctor` only with `--fix`. Every other command
 * is a read and never fires the hook (§ 9 "`NJ_ON_CHANGE`"). */
const WRITERS = new Set(['init', 'new', 'set', 'note', 'check', 'claim', 'release', 'next', 'archive', 'unarchive', 'rm', 'doctor']);

interface Armed { command: string; hook: string; timeoutS: number }

let armed: Armed | null = null;
let pending: { backlog: string; result: Record<string, unknown> } | null = null;

/**
 * Arms the hook for this invocation, or leaves it disarmed. Disarmed —
 * and byte-identical to a nanojira without this feature — when
 * NJ_ON_CHANGE is unset or empty, when NJ_HOOK_COMMAND is set (we are
 * running inside a hook: the recursion guard), for any read, for `doctor`
 * without `--fix`, and for `--dry-run`, which never fires the hook.
 *
 * A dry run (§ 9 "`--dry-run`", DECISIONS 197) runs the real writer
 * against a scratch copy, so that writer DOES reach `recordChange` — with
 * the copy's path. Two independent guards keep that from ever firing:
 * this raw-flag check (`--dry-run` is the only way to arm a dry run,
 * `checkFlags` → `armDryRun`), and `recordChange`'s own `isDryRun()`.
 */
function beginOnChange(cmd: string | null, flags: Flags): void {
  armed = null;
  pending = null;
  const hook = process.env.NJ_ON_CHANGE;
  if (hook === undefined || hook === '') return;
  if (process.env.NJ_HOOK_COMMAND !== undefined) return;
  if (cmd === null || !WRITERS.has(cmd)) return;
  if (cmd === 'doctor' && !flags.has('fix')) return;
  if (flags.has('dry-run')) return;
  armed = { command: cmd, hook, timeoutS: hookTimeout() };
}

/** NJ_ON_CHANGE_TIMEOUT: whole seconds, 1..86400, default 10. Anything else
 * is `invalid_env` before anything is written — never a silent fall-back to
 * the default, the same discipline NJ_NOW has (§ 12). */
function hookTimeout(): number {
  const raw = process.env.NJ_ON_CHANGE_TIMEOUT;
  if (raw === undefined) return DEFAULT_TIMEOUT_S;
  const n = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= MAX_TIMEOUT_S)) {
    fail('invalid_env', `invalid NJ_ON_CHANGE_TIMEOUT '${raw}' (expected whole seconds, 1 to ${MAX_TIMEOUT_S})`,
      'fix NJ_ON_CHANGE_TIMEOUT, or unset it for the 10-second default');
  }
  return n;
}

/** Records the result of a write that changed (or, for a no-op, would have
 * changed) the backlog. `build` must return exactly what `--json` prints
 * for this call WITHOUT `--quiet`/`--fields` trimming. */
function recordChange(backlog: string, build: () => Record<string, unknown>): void {
  if (armed === null) return;
  // Second dry-run guard (see beginOnChange): `backlog` would be the
  // scratch copy, which is removed before the hook could even start.
  if (isDryRun()) return;
  pending = { backlog, result: build() };
}

/** NJ_HOOK_IDS: the elements this call wrote — `id` for a single write,
 * `ids` for archive/unarchive/rm --cascade/a `new --input` plan, the
 * successful members of a batch, `created` for a plan that stopped part
 * way. Empty for `init` and `doctor --fix`, which address no element. */
function hookIds(result: Record<string, unknown>): string[] {
  if (typeof result.id === 'string') return [result.id];
  if (Array.isArray(result.ids)) return result.ids as string[];
  if (Array.isArray(result.results)) {
    return (result.results as Array<{ id: string; ok: boolean }>).filter((r) => r.ok === true).map((r) => r.id);
  }
  if (Array.isArray(result.created)) return result.created as string[];
  return [];
}

function warn(what: string) {
  process.stderr.write(`Warning: NJ_ON_CHANGE hook ${what}; the write itself succeeded and is unchanged\n`);
}

/**
 * Runs the hook for the recorded change, if any. The command's own result
 * is already on stdout and every write, lock and claim file is already
 * settled. The hook's stdout and stderr both go to nanojira's stderr — a
 * `--json` caller's stdout stays exactly the one JSON document. The hook
 * runs in its own process group, so a timeout kills everything it started
 * (SIGKILL to the group), and nanojira's exit code is never changed by it.
 */
function fireRecordedChange(): void {
  if (armed === null || pending === null) return;
  const { command, hook, timeoutS } = armed;
  const { backlog, result } = pending;
  armed = null;
  pending = null;

  const env: NodeJS.ProcessEnv = Object.assign({}, process.env);
  delete env.NJ_ON_CHANGE;
  delete env.NJ_ON_CHANGE_TIMEOUT;
  env.NJ_HOOK_COMMAND = command;
  env.NJ_HOOK_IDS = hookIds(result).join(',');
  env.NJ_BACKLOG = backlog;

  let child: import('child_process').ChildProcess;
  try {
    child = spawn('/bin/sh', ['-c', hook], { cwd: backlog, env, stdio: ['pipe', 2, 2], detached: true });
  } catch (e: any) {
    warn(`could not be started (${e && e.message ? e.message : String(e)})`);
    return;
  }

  let settled = false;
  let timedOut = false;
  const killGroup = () => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  };
  // nanojira interrupted while waiting: take the hook's group down with it
  // rather than leave it running unbounded, then die of the same signal.
  const onSignal = (sig: NodeJS.Signals) => {
    killGroup();
    detachSignals();
    process.kill(process.pid, sig);
  };
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const detachSignals = () => { for (const s of signals) process.removeListener(s, onSignal); };
  for (const s of signals) process.on(s, onSignal);
  const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutS * 1000);
  const settle = () => { settled = true; clearTimeout(timer); detachSignals(); };

  child.on('error', (e) => {
    if (settled) return;
    settle();
    warn(`could not be started (${e.message})`);
  });
  child.on('exit', (code, signal) => {
    if (settled) return;
    settle();
    if (timedOut) warn(`timed out after ${timeoutS}s and was killed`);
    else if (signal !== null) warn(`was killed by ${signal}`);
    else if (code !== 0) warn(`exited with status ${code}${code === 127 ? ' (command not found)' : ''}`);
  });
  // A hook that never reads stdin may exit before the result is written:
  // EPIPE here is the hook's choice, not a failure of anything.
  child.stdin!.on('error', () => { /* ignored, see above */ });
  child.stdin!.end(JSON.stringify(result, null, 2) + '\n');
}

export { beginOnChange, recordChange, fireRecordedChange, hookIds };
