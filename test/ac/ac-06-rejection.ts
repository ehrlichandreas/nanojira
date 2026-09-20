/* AC-6 — Rejection.
 *
 * § 15.6: "**Rejection.** `--statuss=done` and other unknown field flags are
 * rejected; the file is unchanged (verified by checksum)."
 *
 * § 9: "Unknown field flags are **rejected** — nothing is written — and the
 * known fields are listed."
 *
 * Every rejection is proven twice: exit code 1, and a SHA-256 of the target
 * file that is unchanged byte for byte. A final accepted write serves as the
 * negative control — it shows the checksum method can actually see a change.
 */
import * as H from '../lib/harness.ts';
const T = H.T;
import fs from 'fs';
import path from 'path';

const C = H.FIXED_NOW;

const d = H.mkBacklog({
  label: 'ac06',
  files: {
    'epics/EPIC-001.md': H.element({
      id: 'EPIC-001', type: 'epic', title: 'Platform', status: 'todo',
      created: C, updated: C,
    }, '# Platform\n\n## Description\nGroundwork for everything.\n'),
    'tasks/TSK-001.md': H.element({
      id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Login route',
      status: 'todo', created: C, updated: C,
    }, '# Login route\n\n## Description\nDo the thing.\n\n' +
      '## Acceptance Criteria\n- [ ] It works\n'),
  },
  tombstones: ['EPIC-001', 'TSK-001'],
});

const taskPath = path.join(d, 'backlog', 'tasks', 'TSK-001.md');
const digest = () => H.sha256(fs.readFileSync(taskPath, 'utf8'));
const tasksBefore = H.listFiles(d, 'tasks').join(',');

/* Unknown field flags. `--description` was removed from this list: § 9 now
 * defines section-role writes (AC-20) — `--description`/`--acceptance` are
 * accepted fields for `new` and `set`, not unknown ones. Their acceptance and
 * write semantics are verified in ac-20-section-writes.js; only genuinely
 * unknown flags remain here. */
const UNKNOWN = [
  '--statuss=done',        // the typo AC-6 names
  '--prioritiy=urgent',
  '--assignes=coder-agent',
  '--titel=Renamed',
  '--parentt=EPIC-001',
  '--tagz=a,b',
  '--id2=TSK-002',
];

/* ---- set: rejected, file untouched ------------------------------------- */

for (const flag of UNKNOWN) {
  // Fresh before/after per flag, not one snapshot reused across the whole
  // loop: a single flag that unexpectedly succeeds must fail only its own
  // checks, never cascade a false "checksum changed" into every later
  // iteration that compares against a now-stale reference.
  const before = digest();
  const r = H.runNj(['set', '--id=TSK-001', flag], { cwd: d });
  T.exit('set --id=TSK-001 ' + flag + ' is rejected', r, 1);
  // AMBIGUOUS: § 9 does not pin which stream carries the message; stdout and
  // stderr are checked together.
  const out = r.missing ? '' : r.stdout + r.stderr;
  T.check('set ' + flag + ' lists the known fields',
    ['status', 'priority', 'assignee', 'tags'].every(f => out.indexOf(f) >= 0),
    'output: ' + JSON.stringify(out.slice(0, 400)));
  T.check('set ' + flag + ' leaves the file byte-identical',
    digest() === before, 'checksum changed: ' + before + ' → ' + digest());
}

/* ---- new: rejected, no element file written ---------------------------- */

for (const flag of ['--statuss=done', '--prioritiy=urgent', '--nope=1']) {
  const r = H.runNj(['new', '--type=task', '--parent=EPIC-001', '--title=Nope', flag],
    { cwd: d });
  T.exit('new ' + flag + ' is rejected', r, 1);
  // AMBIGUOUS: whether a rejected `new` still claims a tombstone is not pinned
  // (§ 8's allocator is O_CREAT|O_EXCL, § 12's exit-1 rule allows a partial
  // write); only the absence of an element file is asserted.
  T.check('new ' + flag + ' writes no element file',
    H.listFiles(d, 'tasks').join(',') === tasksBefore,
    'tasks/: ' + H.listFiles(d, 'tasks').join(','));
}

/* ---- note: rejected, file untouched ------------------------------------ */

{
  const before = digest();
  const r = H.runNj(['note', '--id=TSK-001', '--statuss=done', 'text'], { cwd: d });
  T.exit('note --statuss is rejected', r, 1);
  T.check('note --statuss leaves the file byte-identical',
    digest() === before, 'checksum changed: ' + before + ' → ' + digest());
}

/* ---- negative control: the same command without the typo is accepted ---- */

{
  const before = digest();
  const r = H.runNj(['set', '--id=TSK-001', '--priority=high'], { cwd: d });
  T.exit('the control write is accepted', r, 0);
  T.check('the control write changes the checksum',
    digest() !== before,
    'the file did not change: ' + before +
    '\n     (the rejection assertions above would pass vacuously)');
}

T.finish();
