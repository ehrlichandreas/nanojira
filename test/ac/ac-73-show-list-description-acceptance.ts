/* AC-73 — `show`/`list --json` carry `description` and `acceptance`,
 * docs/SPECIFICATION.md § 9 "JSON interface" (TSK-051, scans' TSK-014).
 *
 * `description` is the Description section's text, trimmed of leading/
 * trailing blank lines: `null` when the section has no heading, `""`
 * when it has one with nothing (or only blank lines) under it.
 * `acceptance` is every checkbox in the Acceptance Criteria section, in
 * file order, as `{text, checked, item}`; `item` is the box's own 1-based
 * `nanojira check --item=<n>` number from the whole-body-minus-Notes scan
 * (TSK-052 item 1, Scout's N1), not its position in this array, so a
 * stray checkbox-shaped line elsewhere in the body (e.g. Description)
 * shifts every later item's number. `[]` either way the section has
 * nothing to offer. `show --json` carries both by default; `list --json`
 * leaves both out unless named in `--fields`, which `show`/`list` (and
 * `find`) both newly accept them in.
 *
 * Sections: A show default carries both, B absent vs empty description,
 * C checked/unchecked boxes in order, D list default lacks them, E list
 * --fields=description,acceptance, F unknown-field hint lists them, G
 * show --fields narrows to exactly the named keys, H every existing key
 * is unchanged (strict superset), I a stray Description checkbox shifts
 * acceptance items (TSK-052 item 1, Scout's N1), J a Description of only
 * trailing blank lines (mutant M8), K an unindented heading-lookalike
 * inside a closed fenced example still ends Description on read (SPEC § 7
 * stays line-based, DECISIONS 234, TSK-052); a write there instead refuses
 * (DECISIONS 233, TSK-053) rather than silently leaving a dangling fence.
 * L a hand-edited Description ending in a whitespace-only (not fully
 * empty) line right before the next heading still has it trimmed --
 * `trimBlankLines`' trailing loop is live, not dead: `sectionContent`'s own
 * trailing-newline strip only removes fully empty lines.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as H from '../lib/harness.ts';
const T = H.T;

H.requireNj();

interface Model { dir: string; bl: string }

function J(x: unknown) { return JSON.stringify(x === undefined ? null : x); }

function model(label: string): Model {
  const dir = H.freshDir(label);
  const bl = path.join(dir, 'backlog');
  const r = H.runNj(['init'], { cwd: dir });
  if (r.status !== 0) T.check('fixture: nj init', false, J(r.stderr));
  return { dir, bl };
}

function newEpic(x: Model, title = 'E'): string {
  const r = H.runJson(['new', '--type=epic', `--title=${title}`], { cwd: x.dir });
  return r.json.id;
}

/* ------------------------------------------------------------------ */
/* A. show --json carries both by default                             */
/* ------------------------------------------------------------------ */
{
  const x = model('a-show-default');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T',
    '--description=Line one.\n\nLine two.', '--acceptance=- [ ] a\n- [x] b'], { cwd: x.dir });
  const id = t.json.id;

  const r = H.runJson(['show', `--id=${id}`, '--json'], { cwd: x.dir });
  T.exit('A1 show --json: exit 0', r, 0);
  T.eq('A1 entry.description is the section text', r.json.entry.description, 'Line one.\n\nLine two.');
  T.eq('A1 entry.acceptance lists both items in order with checked state and item',
    J(r.json.entry.acceptance), J([{ text: 'a', checked: false, item: 1 }, { text: 'b', checked: true, item: 2 }]));
  T.eq('A1 entries[0] matches entry (duplicate_id-free target)', J(r.json.entries[0]), J(r.json.entry));
}

/* ------------------------------------------------------------------ */
/* B. absent vs empty Description                                     */
/* ------------------------------------------------------------------ */
{
  // `new` always writes a `## Description` heading, even with no
  // `--description` (empty under it) — the null (section ABSENT) case
  // needs a hand-built fixture with no heading at all.
  const noHeadingBody = '# NoHeading\n\n## Acceptance Criteria\n- [ ] a\n';
  const d = H.mkBacklog({
    label: 'b-description-absent',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('E')),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'NoHeading', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, noHeadingBody),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r1 = H.runJson(['show', '--id=TSK-001', '--json'], { cwd: d });
  T.exit('B1 show --json (no Description heading at all): exit 0', r1, 0);
  T.eq('B2 an absent Description is null', r1.json.entry.description, null);

  const x = model('b-description-empty-and-present');
  const e = newEpic(x);

  const noSection = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=NoDesc'], { cwd: x.dir });
  const r2 = H.runJson(['show', `--id=${noSection.json.id}`, '--json'], { cwd: x.dir });
  T.exit('B3 show --json (new, no --description, heading present and empty): exit 0', r2, 0);
  T.eq('B4 a present-but-empty Description is "", not null', r2.json.entry.description, '');

  const withText = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=HasDesc', '--description=Hello.'], { cwd: x.dir });
  const r3 = H.runJson(['show', `--id=${withText.json.id}`, '--json'], { cwd: x.dir });
  T.eq('B5 a present, non-empty Description is its text', r3.json.entry.description, 'Hello.');

  const blankOnly = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=BlankDesc', '--description=\n\n'], { cwd: x.dir });
  const r4 = H.runJson(['show', `--id=${blankOnly.json.id}`, '--json'], { cwd: x.dir });
  T.eq('B6 a Description of only blank lines is "" (trimmed), not those blank lines', r4.json.entry.description, '');
}

/* ------------------------------------------------------------------ */
/* C. acceptance: checked/unchecked, order, empty                      */
/* ------------------------------------------------------------------ */
{
  const x = model('c-acceptance-items');
  const e = newEpic(x);

  const none = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=NoAC'], { cwd: x.dir });
  const r1 = H.runJson(['show', `--id=${none.json.id}`, '--json'], { cwd: x.dir });
  T.eq('C1 no acceptance checkboxes gives []', J(r1.json.entry.acceptance), '[]');

  const three = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=ThreeAC',
    '--acceptance=- [ ] first\n- [x] second\n- [ ] third'], { cwd: x.dir });
  const r2 = H.runJson(['show', `--id=${three.json.id}`, '--json'], { cwd: x.dir });
  T.eq('C2 three items, file order, checked state and item each', J(r2.json.entry.acceptance), J([
    { text: 'first', checked: false, item: 1 }, { text: 'second', checked: true, item: 2 }, { text: 'third', checked: false, item: 3 },
  ]));

  const checkedOne = H.runNj(['check', `--id=${three.json.id}`, '--text=third'], { cwd: x.dir });
  T.exit('C3 check --text=third: exit 0', checkedOne, 0);
  const r3 = H.runJson(['show', `--id=${three.json.id}`, '--json'], { cwd: x.dir });
  T.eq('C4 ticking a box flips only that item\'s checked, item unchanged', J(r3.json.entry.acceptance), J([
    { text: 'first', checked: false, item: 1 }, { text: 'second', checked: true, item: 2 }, { text: 'third', checked: true, item: 3 },
  ]));
}

/* ------------------------------------------------------------------ */
/* D. list --json default leaves both out                              */
/* ------------------------------------------------------------------ */
{
  const x = model('d-list-default');
  const e = newEpic(x);
  H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T', '--description=d', '--acceptance=- [ ] a'], { cwd: x.dir });

  const r = H.runJson(['list', '--json'], { cwd: x.dir });
  T.exit('D1 list --json: exit 0', r, 0);
  for (const entry of r.json.entries) {
    T.check('D2 ' + entry.id + ': no description key by default', !('description' in entry), J(entry));
    T.check('D3 ' + entry.id + ': no acceptance key by default', !('acceptance' in entry), J(entry));
  }
}

/* ------------------------------------------------------------------ */
/* E. list --fields=description,acceptance                             */
/* ------------------------------------------------------------------ */
{
  const x = model('e-list-fields');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T', '--description=d.', '--acceptance=- [x] z'], { cwd: x.dir });

  const r = H.runJson(['list', '--fields=id,description,acceptance', '--json'], { cwd: x.dir });
  T.exit('E1 list --fields=id,description,acceptance: exit 0', r, 0);
  const row = r.json.entries.find((en: any) => en.id === t.json.id);
  T.check('E2 the named row exists', !!row, J(r.json.entries));
  T.eq('E3 projected entry has exactly id, description, acceptance, in that order', Object.keys(row), ['id', 'description', 'acceptance']);
  T.eq('E4 description value', row.description, 'd.');
  T.eq('E5 acceptance value', J(row.acceptance), J([{ text: 'z', checked: true, item: 1 }]));

  // find takes the same two names in --fields too (TSK-051).
  const rf = H.runJson(['find', 'T', '--fields=id,description', '--json'], { cwd: x.dir });
  T.exit('E6 find --fields=id,description: exit 0', rf, 0);
  const frow = rf.json.entries.find((en: any) => en.id === t.json.id);
  T.eq('E7 find projects description the same way', frow && frow.description, 'd.');
}

/* ------------------------------------------------------------------ */
/* F. unknown --fields name's hint lists description/acceptance        */
/* ------------------------------------------------------------------ */
{
  const x = model('f-unknown-field-hint');
  const r = H.runJson(['list', '--fields=id,bogus', '--json'], { cwd: x.dir });
  T.exit('F1 list --fields with an unknown name: exit 1', r, 1);
  T.contains('F2 the hint lists description', String(r.json ? J(r.json) : r.stderr), 'description');
  T.contains('F3 the hint lists acceptance', String(r.json ? J(r.json) : r.stderr), 'acceptance');

  const r2 = H.runJson(['show', `--id=TSK-001`, '--fields=id,bogus', '--json'], { cwd: x.dir });
  T.exit('F4 show --fields with an unknown name: exit 1', r2, 1);
  T.contains('F5 show\'s hint lists description too', String(r2.json ? J(r2.json) : r2.stderr), 'description');
}

/* ------------------------------------------------------------------ */
/* G. show --fields narrows to exactly the named keys                  */
/* ------------------------------------------------------------------ */
{
  const x = model('g-show-fields-narrow');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T', '--description=d.', '--acceptance=- [ ] z'], { cwd: x.dir });

  const r = H.runJson(['show', `--id=${t.json.id}`, '--fields=id,acceptance', '--json'], { cwd: x.dir });
  T.exit('G1 show --fields=id,acceptance: exit 0', r, 0);
  T.eq('G2 projected entry has exactly id, acceptance', Object.keys(r.json.entry), ['id', 'acceptance']);
  T.check('G3 description is not pulled in uninvited', !('description' in r.json.entry), J(r.json.entry));
}

/* ------------------------------------------------------------------ */
/* H. strict superset — every existing key, value and order unchanged  */
/* ------------------------------------------------------------------ */
{
  const x = model('h-strict-superset');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T', '--description=d.', '--acceptance=- [ ] z'], { cwd: x.dir });

  const rShow = H.runJson(['show', `--id=${t.json.id}`, '--json'], { cwd: x.dir });
  const preexisting = ['id', 'type', 'parent', 'title', 'status', 'priority', 'tags', 'depends_on', 'created', 'updated', 'file', '_problems', '_claim'];
  const keys = Object.keys(rShow.json.entry);
  T.check('H1 show: every pre-existing key is still present, in its old relative order',
    preexisting.every((k, i) => keys.indexOf(k) === keys.filter((kk) => preexisting.includes(kk)).indexOf(k)), J(keys));
  T.check('H2 show: description/acceptance are appended after the pre-existing keys',
    keys.indexOf('description') > keys.indexOf('_claim') && keys.indexOf('acceptance') > keys.indexOf('description'), J(keys));

  const rList = H.runJson(['list', '--json'], { cwd: x.dir });
  const listKeys = Object.keys(rList.json.entries.find((en: any) => en.id === t.json.id));
  T.eq('H3 list: default entry keys are exactly the pre-existing set, untouched', listKeys, preexisting);
}

/* ------------------------------------------------------------------ */
/* I. a stray Description checkbox shifts acceptance items             */
/*    (TSK-052 item 1, Scout's N1: /tmp/team-tmp/tsk049/scout-tsk051.md) */
/* ------------------------------------------------------------------ */
{
  const x = model('i-stray-description-checkbox');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T',
    '--description=- [ ] stray', '--acceptance=- [ ] first\n- [ ] second'], { cwd: x.dir });
  const id = t.json.id;

  const r1 = H.runJson(['show', `--id=${id}`, '--json'], { cwd: x.dir });
  T.exit('I1 show --json: exit 0', r1, 0);
  T.eq('I2 acceptance[0] (first) is global item 2, after the stray Description box',
    r1.json.entry.acceptance[0].item, 2);
  T.eq('I3 acceptance[1] (second) is global item 3', r1.json.entry.acceptance[1].item, 3);

  const checked = H.runNj(['check', `--id=${id}`, `--item=${r1.json.entry.acceptance[0].item}`], { cwd: x.dir });
  T.exit('I4 check --item=<acceptance[0].item>: exit 0', checked, 0);
  const r2 = H.runJson(['show', `--id=${id}`, '--json'], { cwd: x.dir });
  T.eq('I5 the first acceptance box (not the stray Description one) is ticked',
    r2.json.entry.acceptance[0].checked, true);
  T.eq('I6 the second acceptance box is untouched', r2.json.entry.acceptance[1].checked, false);
  T.contains('I7 the stray Description checkbox itself is untouched',
    r2.json.entry.description as string, '- [ ] stray');
}

/* ------------------------------------------------------------------ */
/* J. a Description of only trailing blank lines (mutant M8:           */
/*    trimBlankLines that strips only leading, not trailing)           */
/* ------------------------------------------------------------------ */
{
  const x = model('j-description-trailing-blank-only');
  const e = newEpic(x);
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T',
    '--description=Body text.\n\n\n'], { cwd: x.dir });

  const r = H.runJson(['show', `--id=${t.json.id}`, '--json'], { cwd: x.dir });
  T.exit('J1 show --json: exit 0', r, 0);
  T.eq('J2 trailing blank lines are trimmed off the end', r.json.entry.description, 'Body text.');
}

/* ------------------------------------------------------------------ */
/* K. an unindented heading-lookalike inside a closed fence still ends  */
/*    Description on read (SPEC § 7, DECISIONS 234, TSK-052); a write   */
/*    there refuses instead of leaving a dangling fence (TSK-053)      */
/* ------------------------------------------------------------------ */
{
  const x = model('k-fenced-heading-lookalike');
  const e = newEpic(x);
  const fence = '```';
  const desc = `Intro.\n\n${fence}\n## Unindented heading-lookalike\nmore\n${fence}\n\nAfter fence.`;
  // `new --description=<this value>` would itself be refused now (TSK-053
  // v2, DECISIONS 233): the fake heading sits inside a still-open fence at
  // the point `new`'s own one-shot write checks the resulting body, well
  // before the real Acceptance heading. Hand-editing the file after a
  // normal `new` is how a body shaped like this actually reaches disk --
  // a pre-existing file, or one hand-edited outside `nanojira` -- and is
  // the read-side case this block is about.
  const t = H.runJson(['new', '--type=task', `--parent=${e}`, '--title=T',
    '--acceptance=- [ ] keep me'], { cwd: x.dir });
  const id = t.json.id;
  const file = path.join(x.bl, 'tasks', `${id}.md`);
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.replace(/## Description\n\n/, `## Description\n${desc}\n\n`));

  const r1 = H.runJson(['show', `--id=${id}`, '--json'], { cwd: x.dir });
  T.exit('K1 show --json: exit 0', r1, 0);
  T.eq('K2 the unindented heading-lookalike line (not fence-aware, SPEC § 7) ends Description early, read side unchanged',
    r1.json.entry.description, `Intro.\n\n${fence}`);

  const set = H.runNj(['set', `--id=${id}`, '--description=New short desc.'], { cwd: x.dir });
  T.exit('K3 set --description on it refuses (TSK-053 v2): exit 1', set, 1);
  const r2 = H.runJson(['show', `--id=${id}`, '--json'], { cwd: x.dir });
  T.eq('K4 nothing changed: Description reads exactly as before', r2.json.entry.description, r1.json.entry.description);
  T.eq('K5 the real Acceptance checkbox is still there, untouched', J(r2.json.entry.acceptance),
    J([{ text: 'keep me', checked: false, item: 1 }]));
}

/* ------------------------------------------------------------------ */
/* L. a hand-edited Description ending in a whitespace-only line        */
/*    (not fully empty) right before the next heading is still trimmed */
/*    -- proves trimBlankLines' trailing loop is live, not dead         */
/* ------------------------------------------------------------------ */
{
  // The last line before '## Acceptance Criteria' is three spaces, not
  // an empty string: `normalizeSectionContent`'s trailing-newline strip
  // leaves it alone (it only removes fully empty trailing lines), so
  // only `trimBlankLines`' own trailing loop can remove it here.
  const body = '# L\n\n## Description\nBody text.\n   \n\n## Acceptance Criteria\n- [ ] x\n';
  const d = H.mkBacklog({
    label: 'l-trailing-whitespace-only-line',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('E')),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'L', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, body),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = H.runJson(['show', '--id=TSK-001', '--json'], { cwd: d });
  T.exit('L1 show --json: exit 0', r, 0);
  T.eq('L2 the trailing whitespace-only line is trimmed off, not just the blank line after it',
    r.json.entry.description, 'Body text.');
}

/* ------------------------------------------------------------------ */
/* M. a hand-broken file where an earlier, untouched section already    */
/*    left a fence open: the Acceptance boxes it swallows are omitted   */
/*    from acceptance[] entirely, never `item: 0` (TSK-053 v2, Reviewer */
/*    MUST, DECISIONS 233 addendum) -- `acceptance[].item` is meant to  */
/*    be passed straight to `check --item=<n>`, which can't address a   */
/*    box `scanCheckboxes`' own continuous fence tracking never saw.    */
/* ------------------------------------------------------------------ */
{
  // Description opens a fence and never closes it before Acceptance's own
  // checkboxes -- scanCheckboxes (continuous from line 0) still has that
  // fence open across both boxes, so they are swallowed, not merely
  // mis-numbered. A span-local scan starting fresh at the Acceptance
  // heading would wrongly see both as real (the mutant this pins).
  const body = '# M\n\n## Description\nIntro.\n```\nnever closed\n\n' +
    '## Acceptance Criteria\n- [ ] box one\n- [ ] box two\n';
  const d = H.mkBacklog({
    label: 'm-swallowed-acceptance-boxes',
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, H.completeBody('E')),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'M', status: 'todo', created: H.FIXED_NOW, updated: H.FIXED_NOW }, body),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r1 = H.runJson(['show', '--id=TSK-001', '--json'], { cwd: d });
  T.exit('M1 show --json: exit 0', r1, 0);
  T.eq('M2 both boxes are swallowed by the still-open fence -- acceptance[] omits them, not `item: 0`',
    J(r1.json.entry.acceptance), J([]));

  const r2 = H.runJson(['set', '--id=TSK-001', '--status=done', '--check-all', '--json'],
    { cwd: d, env: { NJ_NOW: H.LATER_NOW } });
  T.exit('M3 --check-all: exit 0', r2, 0);
  T.eq('M4 --check-all does not tick a box it cannot address -- nothing ticked', J(r2.json.checked), J([]));
  T.check('M5 --check-all did not report acceptance as changed', !r2.json.changed.includes('acceptance'), r2.json.changed);
}

T.finish();
