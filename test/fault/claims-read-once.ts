/* `list` reads `.nanojira/claims/` once per call (TSK-043; Reviewer N3 from
 * TSK-033).
 *
 * `list --ready` asked, per element, whether its claim directory or a claim
 * entry is a symlink, and `list` read each element's claim: an `lstat` and a
 * `readdir` per element, most of them failing with ENOENT. At 2000 tasks
 * that was most of the run. Now one `readdir` of the claims root answers
 * both questions for every element that has no claim directory.
 *
 * The same preload pattern as det-id-retry.ts: this file is loaded into
 * nanojira's process (`NODE_OPTIONS=--import`, against H.NJ_BUNDLE since
 * `bin/nanojira` strips NODE_OPTIONS) and, when NJ_CLAIMS_SHIM is set, counts
 * Node `fs` calls on the claims root and on claims/<id> paths. The test half
 * pins one root `readdir` and no call at all for an unclaimed element, and
 * that the claim and the `claim:symlink` results stay as they were, and
 * that `next` and a batch `claim` still show the claim they just made.
 *
 * Written before the fix: red against f95d0f9.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const __filename = fileURLToPath(import.meta.url);

/* ---- shim half: runs inside nanojira's process ------------------------- */
if (process.env.NJ_CLAIMS_SHIM) {
  const rootReaddirs: string[] = [];
  const perElement: Record<string, number> = {};
  const ROOT = /[\\/]\.nanojira[\\/]claims$/;
  const ELEMENT = /[\\/]\.nanojira[\\/]claims[\\/]([A-Z]+-\d+)(?:[\\/]|$)/;
  for (const name of ['readdirSync', 'lstatSync', 'statSync', 'existsSync', 'readlinkSync', 'openSync']) {
    const orig = (fs as any)[name];
    (fs as any)[name] = function (this: unknown, ...args: any[]) {
      const p = String(args[0]);
      if (name === 'readdirSync' && ROOT.test(p)) rootReaddirs.push(p);
      const m = ELEMENT.exec(p);
      if (m) perElement[m[1]] = (perElement[m[1]] || 0) + 1;
      return orig.apply(this, args);
    };
  }
  syncBuiltinESMExports();
  process.on('exit', () => {
    fs.writeFileSync(process.env.NJ_CLAIMS_SHIM as string, JSON.stringify({ rootReaddirs: rootReaddirs.length, perElement }));
  });
} else {
  /* ---- test half ------------------------------------------------------- */
  const H = await import('../lib/harness.ts');
  const T = H.T;
  const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);
  const ENV = { NJ_NOW: H.FIXED_NOW };
  const UNSET = ['NJ_BACKLOG', 'NJ_ON_CHANGE', 'NJ_AUTHOR'];

  H.requireNj();
  if (H.NJ_BUNDLE === null) {
    T.notCovered('claims read once', 'no bundle next to ' + H.NJ + ' to preload the shim into');
    T.finish();
  }

  /* TSK-001 claimed, TSK-002's claim directory a symlink, TSK-003..TSK-010 unclaimed. */
  const dir = H.freshDir('claims-read-once');
  const fixture = (args: string[]) => {
    const r = H.runNj(args, { cwd: dir, env: ENV, unsetEnv: UNSET });
    if (r.status !== 0) T.check('fixture: ' + args.join(' '), false, r.status + ' ' + J(r.stderr));
  };
  fixture(['init']);
  fixture(['new', '--type=epic', '--title=E', '--description=D.']);
  for (let i = 1; i <= 10; i++) fixture(['new', '--type=task', '--parent=EPIC-001', '--title=T' + i, '--description=D.', '--acceptance=- [ ] a']);
  fixture(['claim', '--id=TSK-001', '--as=alice']);
  const outside = H.freshDir('claims-read-once-outside');
  fs.symlinkSync(outside, path.join(dir, 'backlog', '.nanojira', 'claims', 'TSK-002'));

  function counted(args: string[]) {
    const log = path.join(outside, 'shim.json');
    try { fs.unlinkSync(log); } catch { /* first run */ }
    const r = H.runPath(H.NJ_BUNDLE as string, args.concat(['--json']), {
      cwd: dir,
      unsetEnv: UNSET,
      env: Object.assign({}, ENV, {
        NODE_OPTIONS: (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '') + '--import ' + __filename,
        NJ_CLAIMS_SHIM: log,
      }),
    });
    const logged = H.readOrNull(log);
    let json: any = null; try { json = JSON.parse(r.stdout); } catch { /* asserted below */ }
    return { r, json, shim: logged ? JSON.parse(logged) : null };
  }
  const ids = (json: any) => (json && Array.isArray(json.entries) ? json.entries.map((e: any) => e.id) : null);
  const unclaimedTouched = (shim: any) => Object.keys((shim && shim.perElement) || {}).filter((id) => id !== 'TSK-001' && id !== 'TSK-002');

  for (const args of [['list', '--ready', '--type=task'], ['list', '--type=task']]) {
    const what = args.join(' ');
    const { r, json, shim } = counted(args);
    T.exit(what + ': exit 0', r, 0);
    T.check(what + ': shim engaged', shim !== null, J(r.stderr));
    T.eq(what + ': one readdir of claims/', shim && shim.rootReaddirs, 1);
    T.eq(what + ': no fs call for an unclaimed element', J(unclaimedTouched(shim)), '[]');
    if (args.includes('--ready')) {
      T.eq(what + ': the claimed and the linked element are not ready', J(ids(json)), J(['TSK-003', 'TSK-004', 'TSK-005', 'TSK-006', 'TSK-007', 'TSK-008', 'TSK-009', 'TSK-010']));
    } else {
      const byId = (id: string) => ((json && json.entries) || []).find((e: any) => e.id === id) || {};
      T.check(what + ': TSK-001 keeps its claim', byId('TSK-001')._claim && byId('TSK-001')._claim.by === 'alice', J(byId('TSK-001')));
      T.check(what + ': TSK-002 reports claim:symlink, no claim', (byId('TSK-002')._problems || []).includes('claim:symlink') && byId('TSK-002')._claim === null, J(byId('TSK-002')));
    }
  }

  /* A write that creates a claim directory drops the snapshot first, so its
   * own result shows the claim it just made. */
  {
    const runJ = (args: string[]) => H.runJson(args, { cwd: dir, env: ENV, unsetEnv: UNSET });
    const nx = runJ(['next', '--as=bob']);
    T.check('next: entry._claim names the claimer', nx.json && nx.json.entry && nx.json.entry._claim && nx.json.entry._claim.by === 'bob', J(nx.json && nx.json.entry));
    const b = runJ(['claim', '--id=TSK-004,TSK-005', '--as=carol']);
    const second = ((b.json && b.json.results) || [])[1] || {};
    T.check('batch claim: member 2 entry._claim names the claimer', second.entry && second.entry._claim && second.entry._claim.by === 'carol', J(second));
  }

  T.finish();
}
