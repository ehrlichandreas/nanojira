'use strict';
/* Edge — order of JSON object keys and JSON list items (§ 9), for byte-level
 * refactor safety. Assertions are made on the raw stdout TEXT (via indexOf),
 * not on `Object.keys()` of the parsed result — the refactor gate compares
 * bytes, and a key-order change that JSON.parse happens to normalise away
 * would still be a silent regression in the actual bytes on the wire.
 *
 * Two kinds of order live here, with very different footing:
 *
 *  (A) Top-level shape key order — § 9's "JSON shapes per command" table
 *      literally spells the key order in every shape it gives, e.g.
 *      "`{backlog, counts, entries: […]}`" or
 *      "`{ok, id, changed: […], entry: {…, _problems}, _problems}`".
 *      This is quoted, not inferred.
 *
 *  (B) Entry-object key order and `doctor --fix`'s `fixed[]` order — not
 *      quoted verbatim, but each has independent textual support (cited at
 *      the point of use) and is marked AMBIGUOUS accordingly.
 *
 * NOT covered here, reported instead: order of `doctor`'s `problems[]`; of
 * `doctor --fix`'s `notes[]`; and of `entries[]`/`ids[]`/`dependents[]` for
 * multi-element results (`archive`, `rm --cascade`) — no passage of
 * SPECIFICATION.md or DECISIONS.md fixes either, and no textual hook (unlike
 * A/B above) supports one reading over any other, so inventing one here would
 * be indistinguishable from guessing.
 */
const H = require('../lib/harness.js');
const T = H.T;

function J(x) { return JSON.stringify(x === undefined ? null : x); }

const NOW = H.FIXED_NOW;

/**
 * Every key in `keys`, present in `text`, in strictly ascending position.
 * `indent` anchors the match to a specific nesting depth (e.g. `'  '` for a
 * top-level key in 2-space-indented output) so a same-named key nested one
 * level deeper — `counts.incomplete` vs. the top-level `incomplete` array —
 * cannot be mistaken for the one under test.
 */
function assertKeyOrder(desc, text, keys, indent) {
  const pattern = k => indent === undefined ? '"' + k + '"' : '\n' + indent + '"' + k + '":';
  const positions = keys.map(k => ({ k, i: text.indexOf(pattern(k)) }));
  const missing = positions.filter(p => p.i === -1);
  if (missing.length) {
    return T.check(desc, false, 'missing key(s): ' + missing.map(m => m.k).join(', ') +
      '\n     text: ' + J(text).slice(0, 400));
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].i <= positions[i - 1].i) {
      return T.check(desc, false,
        '"' + positions[i - 1].k + '" (at ' + positions[i - 1].i + ') does not precede "' +
        positions[i].k + '" (at ' + positions[i].i + ')\n     text: ' + J(text).slice(0, 400));
    }
  }
  return T.check(desc, true);
}

function backlog() {
  return H.mkBacklog({
    label: 'enc-json-order',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'Backend',
        status: 'todo', priority: 'high', assignee: 'coder-agent',
        tags: '[a, b]', created: NOW, updated: NOW,
      }, H.completeBody('Backend')),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

/* ---- (A) top-level shape key order, quoted directly from § 9 ------------ */
{
  const d = backlog();

  const list = H.runNj(['list', '--json'], { cwd: d });
  T.exit('list --json', list, 0);
  assertKeyOrder('list: {backlog, counts, entries} (§ 9)', list.stdout,
    ['backlog', 'counts', 'entries'], '  ');

  const tree = H.runNj(['tree', '--json'], { cwd: d });
  T.exit('tree --json', tree, 0);
  assertKeyOrder('tree: {backlog, counts, entries} (§ 9)', tree.stdout,
    ['backlog', 'counts', 'entries'], '  ');

  const bare = H.runNj(['--json'], { cwd: d });
  T.exit('bare nj --json', bare, 0);
  // indent-anchored: the bare `counts` object also carries a key named
  // `incomplete` (the count), distinct from the top-level `incomplete` list.
  assertKeyOrder('bare nj: {backlog, counts, ready, incomplete} (§ 9)', bare.stdout,
    ['backlog', 'counts', 'ready', 'incomplete'], '  ');

  const doctor = H.runNj(['doctor', '--json'], { cwd: d });
  T.exit('doctor --json', doctor, 0);
  assertKeyOrder('doctor: {backlog, ok, problems} (§ 9)', doctor.stdout,
    ['backlog', 'ok', 'problems'], '  ');

  const set = H.runNj(['set', '--id=TSK-001', '--status=doing', '--json'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --json', set, 0);
  assertKeyOrder('set: {ok, id, changed, entry, _problems} (§ 9)', set.stdout,
    ['ok', 'id', 'changed', 'entry', '_problems'], '  ');

  const note = H.runNj(['note', '--id=TSK-001', 'hi', '--json'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('note --json', note, 0);
  assertKeyOrder('note: {ok, id, changed, entry, _problems} (§ 9)', note.stdout,
    ['ok', 'id', 'changed', 'entry', '_problems'], '  ');
}

/* ---- (A) archive / rm --cascade: {ok, ids|changed, entries, _problems} -- */
{
  const d = H.mkBacklog({
    label: 'enc-json-order-archive',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Done epic', status: 'done',
        created: NOW, updated: NOW,
      }, '# Done epic\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });
  const archive = H.runNj(['archive', '--id=EPIC-001', '--json'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('archive --json', archive, 0);
  assertKeyOrder('archive: {ok, ids, changed, entries, _problems} (§ 9)', archive.stdout,
    ['ok', 'ids', 'changed', 'entries', '_problems'], '  ');
}

/* ---- (B) entry-object key order — § 7 canonical order, then _problems --- */
{
  const d = backlog();
  const show = H.runNj(['show', '--id=TSK-001', '--json'], { cwd: d });
  T.exit('show --json', show, 0);
  // AMBIGUOUS: § 9 gives no literal key order for an entry object, and no key
  // list either — its own minimal example omits priority/tags/depends_on/file
  // entirely. Reading taken: § 7's canonical frontmatter key order (the one
  // order the spec does fix) for the fields § 7 defines, then `file`
  // (undocumented in § 9; a cross-verified finding reported to the lead for a
  // pending § 9 amendment — not asserted here as settled spec text, only as
  // the observed, reproducible shape), then `_problems` last — every JSON
  // shape example in § 9 shows `_problems` as the trailing key, never
  // elsewhere, so that part at least is a direct pattern in the text.
  assertKeyOrder(
    'show entry: § 7 canonical key order, file, then _problems last (AMBIGUOUS — see comment)',
    show.stdout,
    ['id', 'type', 'parent', 'title', 'status', 'priority', 'assignee',
      'tags', 'depends_on', 'created', 'updated', 'file', '_problems']);
}

/* ---- (B) doctor --fix: fixed[] in § 14's normative step order ----------- */
{
  const d = H.mkBacklog({
    label: 'enc-json-order-fix',
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: NOW, updated: NOW,
      }, '# Auth\n\n## Description\nD\n'),
      // Missing `type`/`status`/`created`/`updated` (step 1, step 5) and a
      // stale H1 vs. title (step 6) — three findings from three different
      // steps, § 14's numbered list fixes their relative order.
      'tasks/TSK-001.md': H.element({
        id: 'TSK-001', parent: 'EPIC-001', title: 'Truth',
      }, '# Stale heading\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const fix = H.runJson(['doctor', '--fix'], { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  // § 14: "0 when no error remains, 2 when one does." This fixture's only
  // findings (missing type/status/created/updated, stale H1) are all
  // unambiguous repairs, so nothing error-level survives — the exit code is
  // pinned at exactly 0, not tolerated as [0, 2] (AMBIGUITIES 23: an
  // either/or here would hide a wrong-but-in-set exit code the same way it
  // once hid a wrong failure code).
  T.exit('doctor --fix --json', fix, 0);
  const fixed = (fix.json && fix.json.fixed) || [];
  T.check('at least the step-1 and step-6 repairs both fired (non-vacuous order check)',
    fixed.length >= 2, J(fixed));
  // AMBIGUOUS: § 14 pins the ORDER STEPS RUN IN, not explicitly the order of
  // the `fixed[]` report — read here as the same order, since "reports the
  // actions it took" (§ 14) most naturally means in the order they were taken.
  const idxType = fixed.findIndex(s => /\btype\b/i.test(s));
  const idxH1 = fixed.findIndex(s => /h1/i.test(s));
  T.check('writing the derived `type` (step 1) is reported before the H1 sync (step 6), ' +
    'per § 14\'s step order (AMBIGUOUS — see comment)',
    idxType !== -1 && idxH1 !== -1 && idxType < idxH1,
    'fixed[]: ' + J(fixed));
}

T.finish();
