/* Edge — § 14's empty-value rule.
 *
 * "For **known** fields (the ones § 6 defines), an empty value counts as
 *  absent: `status:` is reported as `missing:status` and `--fix` may fill it.
 *  For **unknown** keys, an empty value is a value and is preserved verbatim
 *  (§ 7, `custom: ""`)."
 *
 * The same bytes — a key, a colon, and nothing behind it — mean opposite
 * things depending on whether the tool knows the key, and both mistakes are
 * quiet ones. Read a known-empty as a value and the element sits outside
 * `--ready` for ever with nothing on screen to explain it; read an
 * unknown-empty as absent and a write silently deletes a field the user put
 * there on purpose (§ 2's byte-exact promise, § 7's unknown-key preservation).
 * So both halves are driven end to end, and the unknown half is checked
 * byte-for-byte across two write cycles.
 */
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const C = H.FIXED_NOW;

function body(title: string) {
  return '# ' + title + '\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n';
}

function epic(status: string) {
  return H.element({
    id: 'EPIC-001', type: 'epic', title: 'Auth', status: status,
    created: C, updated: C,
  }, '# Auth\n\n## Description\nD\n');
}

/** The first line beginning with `<key>:`, or null. */
function lineWith(text: string | null, key: string) {
  if (text === null) return null;
  const hit = text.split('\n').filter((l: string) => l.startsWith(key + ':'));
  return hit.length ? hit[0] : null;
}

/** True when a `<key>:` line is present and carries nothing but spacing. */
function hasEmptyValueLine(text: string | null, key: string) {
  const l = lineWith(text, key);
  return l !== null && l.slice(key.length + 1).trim() === '';
}

/* ---- (a) a known field with an empty value counts as absent ------------ */
{
  /* The first entry of `statuses` is the initial state (§ 5) and the value
   * § 14's step 5 fills in. A non-default list is used deliberately: under the
   * default `["todo", …]`, "filled from `statuses[0]`" and "filled with the
   * literal `todo`" are the same observable. */
  const CONFIG = JSON.stringify({
    schema: 1,
    statuses: ['open', 'doing', 'done'],
    sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  }, null, 2) + '\n';

  const d = H.mkBacklog({
    label: 'edge-empty-known',
    config: CONFIG,
    files: {
      'epics/EPIC-001.md': epic('open'),
      // `status: ` — the key, a colon, and the one space § 7 strips.
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Space after the colon',
        status: '', created: C, updated: C,
      }, body('Space after the colon')),
      // `status:` — the same empty value with nothing behind the colon at all,
      // which a parser hunting for ': ' misses ("split at the first `:`").
      'tasks/TSK-002.md':
        '---\nid: TSK-002\ntype: task\nparent: EPIC-001\n' +
        'title: Nothing behind the colon\nstatus:\n' +
        'created: ' + C + '\nupdated: ' + C + '\n---\n\n' +
        body('Nothing behind the colon'),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });
  const file: Record<string, string> = {
    'TSK-001': path.join(d, 'backlog', 'tasks', 'TSK-001.md'),
    'TSK-002': path.join(d, 'backlog', 'tasks', 'TSK-002.md'),
  };

  const list = H.runJson(['list'], { cwd: d });
  const entries = (list.json && list.json.entries) || [];
  for (const id of ['TSK-001', 'TSK-002']) {
    const e = entries.find((x: any) => x.id === id);
    T.check(id + ': an empty known value is reported as missing:status',
      e !== undefined && (e._problems || []).includes('missing:status'),
      JSON.stringify(e && e._problems));
    T.eq(id + ': and the status falls back to statuses[0]', e && e.status, 'open');
  }

  // § 14: "0 when no error remains, 2 when one does." Both TSK-001 and
  // TSK-002's only defect is an empty `status` — `missing:status` (§ 7:
  // warning) — with everything else present, complete, and H1-synced. No
  // error-level code applies anywhere in this fixture, so the exit code is
  // pinned at exactly 0.
  T.exit('doctor --fix on an empty known value',
    H.runNj(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  for (const id of ['TSK-001', 'TSK-002']) {
    T.eq(id + ': --fix filled the empty status from statuses[0]',
      lineWith(H.readOrNull(file[id]), 'status'), 'status: open');
  }

  const after = H.runJson(['list'], { cwd: d });
  const still = ((after.json && after.json.entries) || [])
    .filter((e: any) => (e._problems || []).includes('missing:status'));
  T.check('missing:status is gone once the line carries a value',
    still.length === 0, JSON.stringify(still.map((e: any) => e.id)));
}

/* ---- (b) an unknown key with an empty value is a value ----------------- */
{
  const d = H.mkBacklog({
    label: 'edge-empty-unknown',
    files: {
      'epics/EPIC-001.md': epic('todo'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Unknown keys',
        status: 'todo',
        // Three empty values, and the point is the difference between them:
        // `assignee` is a field § 6 defines, `custom` and `custom3` are keys
        // the tool has never heard of.
        assignee: '',
        custom: '""',
        custom3: '',
        created: C, updated: C,
      }, body('Unknown keys')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const file = path.join(d, 'backlog', 'tasks', 'TSK-001.md');

  const fixture = H.readOrNull(file);
  T.check('the fixture carries a bare empty known field',
    hasEmptyValueLine(fixture, 'assignee'), JSON.stringify(lineWith(fixture, 'assignee')));
  T.eq('the fixture carries a quoted empty unknown key',
    lineWith(fixture, 'custom'), 'custom: ""');
  T.check('the fixture carries a bare empty unknown key',
    hasEmptyValueLine(fixture, 'custom3'), JSON.stringify(lineWith(fixture, 'custom3')));

  /* Cycle one: a real content change, so the file is certainly rewritten. */
  T.exit('nj set --status=doing', H.runNj(['set', '--id=TSK-001', '--status=doing'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  const after1 = H.readOrNull(file);
  T.eq('an unknown key with an empty value is written back verbatim',
    lineWith(after1, 'custom'), 'custom: ""');

  // AMBIGUOUS: § 14 says an unknown empty value is "preserved verbatim" while
  // § 7 says a value "is written quoted (`"…"`) when it is empty"; for a bare
  // `custom3:` the two readings disagree on the bytes (`custom3: ` or
  // `custom3: ""`). The oracle takes § 7's serializer rule — § 14's own example
  // is the quoted form — and reads "verbatim" as "the value is not dropped",
  // not as "the spacing behind the colon survives".
  T.eq('a bare unknown empty value round-trips through § 7\'s quoting rule',
    lineWith(after1, 'custom3'), 'custom3: ""');

  // AMBIGUOUS: § 7's quoting rule could be read as keeping an explicitly empty
  // known field as `assignee: ""`; § 14's "counts as absent" plus § 7's "empty
  // optional fields are omitted" is read here as dropping the line. The
  // contrast is the point: `custom3: ` and `assignee: ` are the same bytes and
  // differ only in whether the key is known.
  T.eq('a known field with an empty value is not a value',
    lineWith(after1, 'assignee'), null);

  /* Cycle two: whatever the parser made of those lines must survive being read
   * back and written again — § 7's round-trip, not just one rewrite. */
  T.exit('a second set cycle', H.runNj(['set', '--id=TSK-001', '--title=Renamed'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } }), 0);

  const after2 = H.readOrNull(file);
  T.eq('the unknown empty value is still verbatim after a second cycle',
    lineWith(after2, 'custom'), 'custom: ""');
  T.eq('the bare unknown empty value is still canonical after a second cycle',
    lineWith(after2, 'custom3'), 'custom3: ""');
  T.eq('the empty known field is still absent after a second cycle',
    lineWith(after2, 'assignee'), null);
  T.contains('the title change reached the H1 (§ 7)', after2, '\n# Renamed\n');

  const list = H.runJson(['list'], { cwd: d });
  const e = ((list.json && list.json.entries) || []).find((x: any) => x.id === 'TSK-001');
  T.eq('the element still parses after two cycles', e && e.title, 'Renamed');
}

T.finish();
