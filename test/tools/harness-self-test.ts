/* Harness self-test -- a regression test for this repo's own dev-time
 * tooling (the test harness itself), same category as test/tools/
 * release-regression.ts, not spec-pinned behaviour of the `nanojira`
 * binary (run-all.ts's own comment on why `tools/` is collected anyway
 * applies here verbatim). Deliberately NOT under test/lib/: a self-test
 * run-all never collects never actually runs, which is a silent
 * coverage gap, not a saved few seconds (Lead-found).
 *
 * Covers DECISIONS 210 (async runNj + per-leg buffered checks):
 *   1. legs flush in their own DECLARED order, never completion order,
 *      even when an earlier-declared leg finishes LAST;
 *   2. runLegs' concurrency cap is actually respected;
 *   3. a converted (async, concurrent) leg produces byte-identical
 *      output -- same checks, same order, same count -- as the
 *      equivalent synchronous run;
 *   4. runNjAsync and runNj agree on a real nanojira invocation;
 *   5. a throwing leg does not discard every other leg's own checks;
 *   6. two concurrent runNjAsync calls genuinely overlap -- proved
 *      structurally via the real 'spawn'/close event ORDER (onSpawn),
 *      never via a wall-time ratio: that ratio measured 3/15 FAIL at
 *      ratio 2.5 under a 15-way parallel load (Reviewer-found, D210);
 *   7. runPathAsync's maxBuffer overflow surfaces as status:null +
 *      `missing`, the same shape sync's own spawn-error path uses,
 *      instead of silently truncating output;
 *   8. a child that ignores SIGTERM is still stopped, on an overflow and
 *      on the timeout alike: SIGKILL after the kill grace (TSK-030);
 *   9. makeSemaphore's urgent waiters go first (TSK-049).
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Temporarily observes every call T.check actually receives (call
 * ORDER, not outcome), then restores it. The spied-on checks are real
 * `cond: true` checks -- they still count toward this file's own
 * "N checks" total (this self-test genuinely exercised them), but can
 * never fail it. */
async function observeCheckOrder(run: () => Promise<void>): Promise<string[]> {
  const observed: string[] = [];
  const original = T.check;
  T.check = function (desc, cond, detail) {
    observed.push(desc);
    return original.call(T, desc, cond, detail);
  };
  try {
    await run();
  } finally {
    T.check = original;
  }
  return observed;
}

async function main() {
  /* 1. Ordering under out-of-order completion: leg A is declared FIRST
   * but awaits longer, so it finishes LAST; leg B is declared SECOND but
   * finishes FIRST. The flushed order must follow the DECLARED (array)
   * order, not completion order. */
  {
    const observed = await observeCheckOrder(async () => {
      await H.runLegs([
        async (t) => { await delay(40); t.check('leg-A-1', true); t.check('leg-A-2', true); return null; },
        async (t) => { await delay(5); t.check('leg-B-1', true); return null; },
      ]);
    });
    T.eq('self-test: checks flush in declared leg order, not completion order',
      JSON.stringify(observed), JSON.stringify(['leg-A-1', 'leg-A-2', 'leg-B-1']));
  }

  /* Same shape, three legs, with the fastest-finishing leg declared in
   * the MIDDLE -- rules out "first declared / last declared" as an
   * accidental special case. */
  {
    const observed = await observeCheckOrder(async () => {
      await H.runLegs([
        async (t) => { await delay(30); t.check('leg-1', true); return null; },
        async (t) => { await delay(1); t.check('leg-2', true); return null; },
        async (t) => { await delay(15); t.check('leg-3', true); return null; },
      ]);
    });
    T.eq('self-test: three-leg ordering holds with the fastest leg declared in the middle',
      JSON.stringify(observed), JSON.stringify(['leg-1', 'leg-2', 'leg-3']));
  }

  /* 2. The concurrency cap is respected: with 6 legs and a cap of 2, no
   * more than 2 legs' own bodies are ever active between their own
   * start and end. */
  {
    let active = 0, maxActive = 0;
    const legs = Array.from({ length: 6 }, () => async (t: H.BufferedContext) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(15);
      t.check('capped-leg', true);
      active--;
      return null;
    });
    await H.runLegs(legs, { concurrency: 2 });
    T.check('self-test: runLegs respects its concurrency cap (max 2 legs active at once, cap=2)',
      maxActive <= 2, 'observed max concurrently active: ' + maxActive);
    T.check('self-test: the cap is actually exercised, not accidentally serial',
      maxActive >= 2, 'observed max concurrently active: ' + maxActive);
  }

  /* 3. A converted leg's checks, once flushed, are indistinguishable
   * from the same checks run synchronously: same descriptions, same
   * outcomes (pass AND fail), same count, same order -- verified by
   * literally diffing the two runs' `_failures`. A failing check is
   * included deliberately (not just passing ones): the detail text and
   * "which checks failed" must also come through unchanged. The
   * synthetic failure is popped back off `T._failures`/`_checks`
   * immediately after comparing, so it never reaches this file's own
   * `T.finish()`. */
  {
    const legFn = (t: H.BufferedContext) => {
      t.check('converted-pass', true);
      t.eq('converted-eq-pass', 'x', 'x');
      t.check('converted-fail', false, 'deliberate failure for this comparison');
      return Promise.resolve(null);
    };

    const beforeChecks = T._checks, beforeFailures = T._failures.length;
    await H.runLegs([ (t) => legFn(t) ]);
    const asyncChecks = T._checks - beforeChecks;
    const asyncFailures = T._failures.slice(beforeFailures);
    // Pop the synthetic failure(s) back off before this file's own summary.
    T._failures.length = beforeFailures;
    T._checks = beforeChecks;

    const syncCheck = T.check;
    const syncEq = T.eq;
    const beforeChecks2 = T._checks, beforeFailures2 = T._failures.length;
    syncCheck.call(T, 'converted-pass', true);
    syncEq.call(T, 'converted-eq-pass', 'x', 'x');
    syncCheck.call(T, 'converted-fail', false, 'deliberate failure for this comparison');
    const syncChecks = T._checks - beforeChecks2;
    const syncFailures = T._failures.slice(beforeFailures2);
    T._failures.length = beforeFailures2;
    T._checks = beforeChecks2;

    T.eq('self-test: an async leg records the same NUMBER of checks as the equivalent sync code',
      asyncChecks, syncChecks);
    T.eq('self-test: an async leg records the same FAILURES (desc + detail) as the equivalent sync code',
      JSON.stringify(asyncFailures), JSON.stringify(syncFailures));
  }

  /* 4. runNjAsync and runNj agree on a real invocation -- same status,
   * same stdout, same stderr. --help needs no backlog and writes
   * nothing, so this is safe to run directly against this clone. */
  {
    const sync = H.runNj(['--help']);
    const async_ = await H.runNjAsync(['--help']);
    T.eq('self-test: runNjAsync.status matches runNj.status for the same command', async_.status, sync.status);
    T.eq('self-test: runNjAsync.stdout matches runNj.stdout for the same command', async_.stdout, sync.stdout);
    T.eq('self-test: runNjAsync.stderr matches runNj.stderr for the same command', async_.stderr, sync.stderr);
  }

  /* 6. Two independent runNjAsync calls genuinely overlap -- proved
   * structurally, via the real ORDER of each child's own 'spawn' event
   * (RunOpts.onSpawn), not a wall-time ratio. A wall-time ratio check here
   * previously measured 3/15 FAIL at ratio 2.5 under a 15-way parallel
   * load (Reviewer-found): under load everything is slower, including a
   * genuinely-concurrent pair, so "closer to one call's time than the
   * sum of both" stops holding even though nothing is actually serial.
   * Event ORDER has no such failure mode: if call 2's own OS process
   * starts (its 'spawn' fires) before call 1's `close` resolves, the two
   * are provably overlapping, independent of how slow either one is. */
  {
    const events: string[] = [];
    const p1 = H.runNjAsync(['--help'], { onSpawn: () => events.push('spawn1') })
      .then(() => { events.push('close1'); });
    const p2 = H.runNjAsync(['--help'], { onSpawn: () => events.push('spawn2') })
      .then(() => { events.push('close2'); });
    await Promise.all([p1, p2]);

    const spawn2 = events.indexOf('spawn2');
    const close1 = events.indexOf('close1');
    T.check('self-test: two concurrent runNjAsync calls genuinely overlap (call 2 spawns before call 1 closes)',
      spawn2 !== -1 && close1 !== -1 && spawn2 < close1, JSON.stringify(events));
  }

  /* 5. A leg that throws does not take the others down with it: every
   * other leg still runs to completion and flushes, in its own declared
   * position, and the throwing leg's position becomes one FAIL check
   * naming it -- not a silently empty/missing slot, and not a lost
   * `Promise.all` rejection that would have discarded every leg's
   * buffered checks, passed or not (Reviewer-found). */
  {
    const beforeChecks = T._checks, beforeFailures = T._failures.length;
    const observed: Array<{ desc: string; cond: boolean }> = [];
    const original = T.check;
    T.check = function (desc, cond, detail) {
      observed.push({ desc, cond: !!cond });
      return original.call(T, desc, cond, detail);
    };
    let results: unknown[];
    try {
      results = await H.runLegs([
        async (t) => { t.check('leg-throw-A', true); return 'A'; },
        async () => { throw new Error('boom'); },
        async (t) => { t.check('leg-throw-C', true); return 'C'; },
      ]);
    } finally {
      T.check = original;
    }
    // Pop the 3 synthetic checks (A, the thrown FAIL, C) back off before this file's own summary.
    T._failures.length = beforeFailures;
    T._checks = beforeChecks;

    T.eq('self-test: a throwing leg does not discard the other legs\' own checks',
      JSON.stringify(observed.map((o) => o.desc)),
      JSON.stringify(['leg-throw-A', 'leg 1 threw: boom', 'leg-throw-C']));
    T.check('self-test: the other legs still pass; only the thrown leg fails',
      observed.length === 3 && observed[0].cond === true && observed[1].cond === false && observed[2].cond === true,
      JSON.stringify(observed));
    T.eq('self-test: a throwing leg resolves to undefined in the results array; others keep their value',
      JSON.stringify(results), JSON.stringify(['A', null, 'C']));
  }

  /* 7. runPathAsync's maxBuffer overflow surfaces the same way a genuine
   * spawn error does in sync (status:null + `missing`), never as
   * silently truncated output. A 1-byte cap makes any real stdout
   * overflow it immediately. */
  {
    const r = await H.runPathAsync(H.NJ, ['--help'], { maxBuffer: 1 });
    T.check('self-test: a maxBuffer overflow reports status: null', r.status === null, JSON.stringify(r));
    T.check('self-test: a maxBuffer overflow sets `missing`, not truncated output',
      typeof r.missing === 'string' && r.missing.includes('maxBuffer') && r.stdout === '' && r.stderr === '',
      JSON.stringify(r));
  }

  /* 8. A child that ignores SIGTERM is stopped anyway (TSK-030): the
   * overflow and the timeout send SIGTERM, then SIGKILL after the kill
   * grace (opts.killGraceMs, shortened here; default 10 s like run-all's
   * pool). The child writes its pid first, so the test can check it is
   * gone. A guard ends the wait on a red run, which used to hang for good:
   * the ignored SIGTERM was the only signal, so 'close' never came.
   *
   * Under load, the child's own startup (installing the SIGTERM handler,
   * writing its pid file) can take longer than the shortened timeout
   * itself: the parent's SIGTERM then arrives before the handler is
   * installed, the default action kills the child outright, and no pid
   * file is ever written -- the precondition "the child ignores SIGTERM"
   * never held, so the result (SIGTERM, not SIGKILL; no pid) is not a
   * finding about the harness. Detected by the missing pid file: retried
   * with a doubled timeout/killGraceMs, up to 3 tries, each against a
   * fresh instance of the script (a stale pid file from an earlier try
   * must never be read as this try's). The 3rd try's result is taken as
   * final either way -- the four checks below still do the asserting,
   * now on a result that is either genuine or has run out of retries. */
  {
    const dir = H.freshDir('t030-stubborn');
    const stubborn = (name: string, body: string) => {
      const p = path.join(dir, name + '.mjs');
      fs.writeFileSync(p, "import fs from 'node:fs';\nprocess.on('SIGTERM', () => {});\n" +
        'fs.writeFileSync(' + JSON.stringify(path.join(dir, name + '.pid')) + ', String(process.pid));\n' + body);
      return p;
    };
    const legs: [string, string, H.RunOpts][] = [
      ['an overflow', 'flood', { maxBuffer: 4096, killGraceMs: 300 }],
      ['the timeout', 'hang', { timeout: 300, killGraceMs: 300 }],
    ];
    const bodies: Record<string, string> = {
      flood: "const b = Buffer.alloc(65536, 120);\nconst w = () => { while (process.stdout.write(b)); process.stdout.once('drain', w); };\nw();\n",
      hang: 'setInterval(() => {}, 1000);\n',
    };
    const MAX_TRIES = 3;
    for (const [what, name, opts0] of legs) {
      let opts = opts0, r: H.RunResult | null = null, ms = 0, pid = 0, alive = false, tries = 0;
      const history: string[] = [];
      for (; tries < MAX_TRIES; tries++) {
        const script = stubborn(name + '-try' + tries, bodies[name]);
        const pidFile = script.replace(/\.mjs$/, '.pid');
        const t0 = Date.now();
        r = await Promise.race([H.runPathAsync(script, [], opts), delay(8000).then(() => null)]);
        ms = Date.now() - t0;
        pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
        alive = false;
        if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* gone */ } }
        if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
        history.push('try ' + tries + ': ' + ms + ' ms, pid ' + pid + ', signal ' + (r && r.signal));
        if (pid !== 0 || tries === MAX_TRIES - 1) break;
        // No pid file: the child never got far enough to be a test of the
        // SIGTERM-ignoring precondition. Give it more room and try again.
        opts = Object.assign({}, opts, opts.timeout ? { timeout: opts.timeout * 2 } : {}, { killGraceMs: (opts.killGraceMs || 0) * 2 });
      }
      const detail = history.join(' | ') + '; last: ' + JSON.stringify(r && Object.assign({}, r, { stdout: r.stdout.length + ' bytes' }));
      T.check('self-test: ' + what + ' ends the run of a child that ignores SIGTERM', r !== null, detail);
      T.check('self-test: ... soon after the grace', ms < 5000, detail);
      T.check('self-test: ... and the child is gone', pid > 0 && !alive, detail);
      T.eq('self-test: ... killed by SIGKILL', r && r.signal, 'SIGKILL');
      if (what === 'an overflow') {
        T.check('self-test: ... and the result still names maxBuffer exceeded',
          !!r && r.status === null && typeof r.missing === 'string' && r.missing.includes('maxBuffer exceeded'), detail);
      }
    }
  }

  /* 9. makeSemaphore: an urgent waiter goes before every plain one,
   * urgent ones first-in-first-out among themselves (TSK-049). */
  {
    const sem = H.makeSemaphore(1);
    const order: string[] = [];
    await sem.acquire();
    const waits = [['plain-a', false], ['urgent-b', true], ['plain-c', false], ['urgent-d', true]].map(([name, urgent]) =>
      sem.acquire(urgent as boolean).then(() => { order.push(name as string); sem.release(); }));
    sem.release();
    await Promise.all(waits);
    T.eq('self-test: makeSemaphore wakes urgent waiters first, each kind in order', order, ['urgent-b', 'urgent-d', 'plain-a', 'plain-c']);
  }
  /* … and a woken urgent waiter no longer counts as waiting: an urgent one
   * queued while it holds the slot still goes before the plain one. */
  {
    const sem = H.makeSemaphore(1);
    const order: string[] = [];
    await sem.acquire();
    const b = sem.acquire(true).then(() => { order.push('urgent-b'); });
    const a = sem.acquire().then(() => { order.push('plain-a'); sem.release(); });
    sem.release();
    await b;
    const e = sem.acquire(true).then(() => { order.push('urgent-e'); sem.release(); });
    sem.release();
    await Promise.all([a, e]);
    T.eq('self-test: makeSemaphore, an urgent waiter queued after an urgent one woke still goes first', order, ['urgent-b', 'urgent-e', 'plain-a']);
  }

  T.finish();
}

main().catch((e) => {
  console.log('FAIL harness-self-test.ts -- uncaught error');
  console.log('  ' + (e && e.stack || e));
  process.exit(1);
});
