'use strict';
/* Determinism — AC-7's retry leg, reached on purpose (§ 8).
 *
 * § 8: the allocator computes a start value and probes upward with
 * O_CREAT|O_EXCL, "bounded at 100 retries, then exit 1 with the stderr line
 * `nj: id allocation failed after 100 retries (<TYPE>)`". AMBIGUITIES.md 8
 * records why a scheduler cannot reach that abort: every number above the
 * start value is free unless ~100 concurrent creators claim it first.
 *
 * This file reaches it without concurrency and without touching nj: the same
 * file is preloaded into nj's process (`NODE_OPTIONS=--require`) and, when
 * NJ_DET_SHIM=eexist, wraps Node's `fs` so that the first N exclusive creates
 * under `.nanojira/ids/` fail with EEXIST — exactly what a faster rival would cause.
 * nj is still a black box: nothing of it is required or read; only the
 * runtime it runs on is instrumented.
 *
 * The shim only fires when nj claims tombstones through Node's `fs` with an
 * exclusive flag. That is not a coupling to nj's internals but to § 8's rule
 * that O_CREAT|O_EXCL is the *sole* claiming authority — so a run in which the
 * shim saw no such open FAILS, it never passes silently.
 */
const fs = require('fs');
const path = require('path');

/* ---- shim half: runs inside nj's process ------------------------------- */
if (process.env.NJ_DET_SHIM === 'eexist') {
  const budget = Number(process.env.NJ_DET_EEXIST || 0);
  let seen = 0, injected = 0;

  const isTombstone = p => /[\\/]\.nanojira[\\/]ids[\\/][A-Z]+-\d+$/.test(String(p));
  const isExcl = f => (typeof f === 'string' && f.includes('x')) ||
    (typeof f === 'number' && (f & fs.constants.O_EXCL) !== 0);
  const eexist = p => Object.assign(
    new Error("EEXIST: file already exists (injected), open '" + p + "'"),
    { code: 'EEXIST', errno: -17, syscall: 'open', path: String(p) });

  function patch(obj, name, flagsOf, mode) {
    const orig = obj[name];
    obj[name] = function (...args) {
      if (isTombstone(args[0]) && isExcl(flagsOf(args))) {
        seen++;
        if (injected < budget) {
          injected++;
          const err = eexist(args[0]);
          if (mode === 'sync') throw err;
          if (mode === 'promise') return Promise.reject(err);
          const cb = args[args.length - 1];
          if (typeof cb === 'function') { process.nextTick(cb, err); return; }
          throw err;
        }
      }
      return orig.apply(this, args);
    };
  }
  const openFlags = a => a[1];
  const writeFlags = a => (a[2] && typeof a[2] === 'object') ? a[2].flag : undefined;
  patch(fs, 'openSync', openFlags, 'sync');
  patch(fs, 'open', openFlags, 'callback');
  patch(fs.promises, 'open', openFlags, 'promise');
  patch(fs, 'writeFileSync', writeFlags, 'sync');
  patch(fs, 'writeFile', writeFlags, 'callback');
  patch(fs.promises, 'writeFile', writeFlags, 'promise');

  process.on('exit', () => {
    if (process.env.NJ_DET_LOG) {
      fs.writeFileSync(process.env.NJ_DET_LOG, JSON.stringify({ seen, injected }));
    }
  });
  return;
}

/* ---- test half --------------------------------------------------------- */
const H = require('../lib/harness.js');
const T = H.T;

const ABORT_LINE = type => 'nj: id allocation failed after 100 retries (' + type + ')';
const CLOSED_CODES = ['no_backlog', 'backlog_without_config', 'invalid_config',
  'invalid_env', 'invalid_backlog_env', 'unknown_field', 'unknown_command',
  'missing_argument', 'missing_value', 'invalid_value', 'invalid_target',
  'not_found', 'duplicate_id', 'exists', 'changed_in_parallel',
  'id_allocation_failed', 'internal_error'];

function fixture(label) {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# E\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });
}

/** Run nj with the first `n` exclusive tombstone creates failing with EEXIST. */
function runInjected(d, n, args) {
  const log = path.join(d, 'shim.json');
  const r = H.runNj(args, {
    cwd: d,
    env: {
      NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') +
        '--require ' + __filename,
      NJ_DET_SHIM: 'eexist',
      NJ_DET_EEXIST: String(n),
      NJ_DET_LOG: log,
    },
  });
  r.shim = H.readOrNull(log) ? JSON.parse(H.readOrNull(log)) : null;
  return r;
}

/* Non-engagement is its own verdict, not a regression: a refactor that claims
 * tombstones through a call the shim does not wrap turns every case below red
 * without any behaviour having changed. So it is reported once, first line,
 * under its own name, and nothing else is asserted. */
function engaged(label, r) {
  if (r.shim && r.shim.seen > 0) {
    return T.check(label + ': shim engaged (≥1 O_EXCL open under .nanojira/ids/)', true);
  }
  console.log('FAIL det-id-retry.js — SHIM NOT ENGAGED (' + label + ')');
  console.log('  nj claimed no tombstone through Node fs with an exclusive flag ' +
    '(§ 8 O_CREAT|O_EXCL) — the preload did not load, or the allocation call ' +
    'form changed. This is NOT a behaviour verdict: nothing below was checked.');
  console.log('  shim log: ' + JSON.stringify(r.shim) +
    (r.stderr ? '\n  stderr: ' + r.stderr.trim().slice(0, 300) : ''));
  process.exit(1);
}

/* ---- 3 collisions: the allocator probes upward and claims the next free -- */
{
  const d = fixture('det-retry-3');
  const r = runInjected(d, 3, ['new', '--type=epic', '--title=X', '--json']);
  T.exit('3 collisions: exit 0', r, 0);
  engaged('3 collisions', r);
  T.eq('3 collisions: shim injected exactly 3', r.shim && r.shim.injected, 3);
  T.eq('3 collisions: 4 probes in total (3 refused + 1 claimed)', r.shim && r.shim.seen, 4);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* asserted below */ }
  T.eq('3 collisions: the new id is start+4', json && json.id, 'EPIC-005');
  T.eq('3 collisions: exactly one new tombstone, the claimed one',
    H.listFiles(d, H.IDS_REL), ['EPIC-001', 'EPIC-005']);
  T.eq('3 collisions: exactly one new element file',
    H.listFiles(d, 'epics'), ['EPIC-001.md', 'EPIC-005.md']);
}

/* ---- 100 collisions: retries exhausted ---------------------------------- */
{
  const d = fixture('det-retry-100');
  const r = runInjected(d, 100, ['new', '--type=epic', '--title=X']);
  T.exit('100 collisions: exit 1', r, 1);
  engaged('100 collisions', r);
  T.eq('100 collisions: the defined stderr line, exactly', r.stderr.trim(), ABORT_LINE('EPIC'));
  T.eq('100 collisions: the allocator stops after 100 probes', r.shim && r.shim.seen, 100);
  T.eq('100 collisions: no tombstone claimed', H.listFiles(d, H.IDS_REL), ['EPIC-001']);
  T.eq('100 collisions: no element file written', H.listFiles(d, 'epics'), ['EPIC-001.md']);
  T.eq('100 collisions: no stray temp file',
    H.listFiles(d, 'epics').filter(f => f.startsWith('.nj-tmp-')), []);
}

/* ---- 99 collisions: the boundary — the 100th probe is still tried -------
 * § 8 pins both the bound and the sentence "failed after 100 retries". A
 * program printing that after 101 probes contradicts its own mandated output,
 * so the only coherent reading is: at most 100 exclusive probes in total. */
{
  const d = fixture('det-retry-99');
  const r = runInjected(d, 99, ['new', '--type=epic', '--title=X', '--json']);
  T.exit('99 collisions: exit 0', r, 0);
  engaged('99 collisions', r);
  T.eq('99 collisions: 100 probes in total', r.shim && r.shim.seen, 100);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* asserted below */ }
  T.eq('99 collisions: the new id is start+100', json && json.id, 'EPIC-101');
  T.eq('99 collisions: tombstone claimed', H.listFiles(d, H.IDS_REL), ['EPIC-001', 'EPIC-101']);
}

/* ---- --json on the abort: every exit path writes JSON (§ 9) ------------- */
{
  const d = fixture('det-retry-json');
  const r = runInjected(d, 100, ['new', '--type=epic', '--title=X', '--json']);
  T.exit('--json abort: exit 1', r, 1);
  engaged('--json abort', r);
  let json = null; try { json = JSON.parse(r.stdout); } catch (e) { /* asserted below */ }
  T.check('--json abort: stdout is a JSON object', json && typeof json === 'object',
    JSON.stringify(r.stdout.slice(0, 200)));
  T.eq('--json abort: ok is false', json && json.ok, false);
  T.check('--json abort: error code is from the closed set',
    json && CLOSED_CODES.includes(json.error), JSON.stringify(json && json.error));
  T.eq('--json abort: the prose line additionally goes to stderr',
    r.stderr.trim(), ABORT_LINE('EPIC'));
}

/* ---- <TYPE> in the stderr line follows the element type ----------------- */
{
  const d = fixture('det-retry-tsk');
  const r = runInjected(d, 100, ['new', '--type=task', '--parent=EPIC-001', '--title=X']);
  T.exit('task abort: exit 1', r, 1);
  engaged('task abort', r);
  T.eq('task abort: stderr names TSK', r.stderr.trim(), ABORT_LINE('TSK'));
  T.eq('task abort: no task file written', H.listFiles(d, 'tasks'), []);
}

T.finish();
