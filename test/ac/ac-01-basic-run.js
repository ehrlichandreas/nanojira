'use strict';
/* AC-1 — Basic run.
 *
 * § 15.1: "**Basic run.** `nj init` creates the full layout; `nj new` for
 * epic, task, subtask; `list`, `show`, `set`, `note`, `tree`, `rm`, `archive`,
 * `doctor` and bare `nj` all work end-to-end."
 *
 * The first block checks § 4's layout byte by byte; the second drives every
 * round-one command once and asserts exit code, non-empty output and the bytes
 * left on disk. Nothing here reads the nj source: the tool is a black box.
 */
const H = require('../lib/harness.js');
const T = H.T;
const fs = require('fs');
const path = require('path');

const bl = (d, ...rel) => path.join(d, 'backlog', ...rel);

function exists(d, ...rel) { return fs.existsSync(bl(d, ...rel)); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

/** Human-facing commands must print something; the failure detail shows stderr. */
function printed(desc, r) {
  if (r.missing) return T.check(desc, false, 'CANNOT RUN: ' + r.missing);
  return T.check(desc, r.stdout.trim().length > 0,
    'stdout was empty (exit ' + r.status + ')' +
    (r.stderr.trim() ? '\n     stderr: ' + r.stderr.trim().slice(0, 300) : ''));
}

function entriesOf(r) { return (r.json && Array.isArray(r.json.entries)) ? r.json.entries : []; }

/* ---- § 4 layout, written by nj init ----------------------------------- */

{
  const d = H.freshDir('ac01-init');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);

  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira', H.IDS_REL]) {
    let isDir = false;
    try { isDir = fs.statSync(bl(d, sub)).isDirectory(); } catch (e) { isDir = false; }
    T.check('init creates backlog/' + sub + '/', isDir);
  }
  for (const f of [H.CONFIG_REL, '.gitignore', 'README.md']) {
    T.check('init creates backlog/' + f, exists(d, f));
  }
  // AMBIGUOUS: the § 4 tree also lists backlog/.nanojira/index.json, but § 13
  // says "round one ships without an index". Whether init writes that file is
  // unpinned, so neither its presence nor its absence is asserted here.

  T.check('README.md is not empty', readText(bl(d, 'README.md')).trim().length > 0);

  let cfg = null;
  try { cfg = JSON.parse(readText(bl(d, H.CONFIG_REL))); } catch (e) { cfg = null; }
  T.check('config is valid JSON', cfg !== null);
  T.check('config schema is 1', !!cfg && cfg.schema === 1);
  T.eq('config statuses are the § 5 default', cfg && cfg.statuses,
    ['todo', 'doing', 'blocked', 'review', 'done']);
  T.check('config sections map the roles to the § 5 defaults',
    !!cfg && !!cfg.sections &&
    JSON.stringify(cfg.sections.description) === JSON.stringify(['Description']) &&
    JSON.stringify(cfg.sections.acceptance) === JSON.stringify(['Acceptance Criteria']),
    'sections: ' + JSON.stringify(cfg && cfg.sections));
  /* § 5: "`init` writes the `layout` block out in full" (from V3-4, DECISIONS
   * 92 Q1). */
  T.eq('config carries the full § 5 layout block', cfg && cfg.layout, {
    group: 'type',
    folders: { epics: 'epics', tasks: 'tasks', subtasks: 'subtasks', archive: 'archive' },
    statusFile: true,
  });
  T.check('init writes no v2 file (.nanojira.json, .ids/) at the top level',
    !exists(d, '.nanojira.json') && !exists(d, '.ids'), JSON.stringify(H.lsOrEmpty(bl(d))));

  const gi = readText(bl(d, '.gitignore'));
  const giLines = gi.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  // AMBIGUOUS: § 4 pins the two patterns, not their order or the trailing
  // newline. Asserted as: exactly these two lines, nothing else.
  T.eq('gitignore ignores exactly the two patterns',
    giLines.slice().sort().join('|'), '.nanojira/index.json|.nj-tmp-*');
  /* § 4: "`.nanojira/ids/` is never ignored, by design" — neither by name nor
   * by ignoring the whole `.nanojira/` folder. */
  T.check('.nanojira/ids/ is never ignored', !gi.split('\n').some(l =>
    /^\/?\.nanojira\/?(\*\*?)?$/.test(l.trim()) || /^\/?\.nanojira\/ids/.test(l.trim())), JSON.stringify(gi));

  T.exit('init refuses a second init (§ 4)', H.runNj(['init'], { cwd: d }), 1);
}

/* ---- § 9 round one, every command once -------------------------------- */

{
  const d = H.freshDir('ac01-life');
  T.exit('nj init', H.runNj(['init'], { cwd: d }), 0);

  const empty = H.runNj([], { cwd: d });
  T.exit('bare nj on an empty backlog', empty, 0);
  printed('bare nj prints something', empty);

  T.exit('nj new --type=epic',
    H.runNj(['new', '--type=epic', '--title=Auth'], { cwd: d }), 0);
  T.exit('nj new --type=task',
    H.runNj(['new', '--type=task', '--parent=EPIC-001',
      '--title=Backend API Endpoints'], { cwd: d }), 0);
  T.exit('nj new --type=subtask',
    H.runNj(['new', '--type=subtask', '--parent=TSK-001',
      '--title=Login route'], { cwd: d }), 0);
  T.check('new wrote backlog/epics/EPIC-001.md', exists(d, 'epics', 'EPIC-001.md'));
  T.check('new wrote backlog/tasks/TSK-001.md', exists(d, 'tasks', 'TSK-001.md'));
  T.check('new wrote backlog/subtasks/SUB-001.md', exists(d, 'subtasks', 'SUB-001.md'));

  const listJson = H.runJson(['list'], { cwd: d });
  T.exit('nj list --json', listJson, 0);
  const listed = entriesOf(listJson);
  T.check('list counts the three elements',
    !!listJson.json && !!listJson.json.counts && listJson.json.counts.total === 3,
    'counts: ' + JSON.stringify(listJson.json && listJson.json.counts));
  T.eq('list returns the three ids', listed.map(e => e.id).sort(),
    ['EPIC-001', 'SUB-001', 'TSK-001']);
  /* A freshly scaffolded element is *incomplete*, not clean: § 9 has `nj new`
   * write the configured section headings as empty headings, and § 7 counts an
   * empty heading as absent — deliberately, so the readiness gate stays sharp.
   * Expecting an empty `_problems` here would assert the opposite of § 7. */
  const probsById = new Map(listed.map(e => [e.id, e._problems || []]));
  T.check('every freshly created entry carries incomplete:description',
    listed.length === 3 &&
    listed.every(e => (e._problems || []).includes('incomplete:description')),
    JSON.stringify(listed.map(e => [e.id, e._problems])));
  T.check('task and subtask also carry incomplete:acceptance',
    (probsById.get('TSK-001') || []).includes('incomplete:acceptance') &&
    (probsById.get('SUB-001') || []).includes('incomplete:acceptance'),
    JSON.stringify(listed.map(e => [e.id, e._problems])));
  T.check('the epic is exempt from the acceptance requirement',
    !(probsById.get('EPIC-001') || []).includes('incomplete:acceptance'),
    JSON.stringify(probsById.get('EPIC-001')));

  const listHuman = H.runNj(['list'], { cwd: d });
  T.exit('nj list', listHuman, 0);
  printed('nj list prints something', listHuman);

  const showJson = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.exit('nj show --json', showJson, 0);
  T.check('show returns TSK-001', entriesOf(showJson).some(e => e.id === 'TSK-001'));
  const showHuman = H.runNj(['show', '--id=TSK-001'], { cwd: d });
  T.exit('nj show', showHuman, 0);
  printed('nj show prints something', showHuman);

  const set = H.runNj(['set', '--id=TSK-001', '--status=doing'], { cwd: d });
  T.exit('nj set --status', set, 0);
  printed('nj set prints something', set);
  T.contains('set wrote status: doing', readText(bl(d, 'tasks', 'TSK-001.md')), 'status: doing');

  const note = H.runNj(['note', '--id=TSK-001', 'Parser splits at the first colon'], { cwd: d });
  T.exit('nj note', note, 0);
  printed('nj note prints something', note);
  T.contains('note appended a ## Notes section',
    readText(bl(d, 'tasks', 'TSK-001.md')), '## Notes');

  const treeJson = H.runJson(['tree'], { cwd: d });
  T.exit('nj tree --json', treeJson, 0);
  const tree = entriesOf(treeJson);
  // Each level here holds exactly one element, so the unpinned question of which
  // rule wins *within* a level (AMBIGUITIES.md #12) does not arise.
  T.eq('tree is flat and depth-first', tree.map(e => e.id),
    ['EPIC-001', 'TSK-001', 'SUB-001']);
  const byId = new Map(tree.map(e => [e.id, e]));
  T.check('tree entries carry the hierarchy in parent',
    !!byId.get('TSK-001') && byId.get('TSK-001').parent === 'EPIC-001' &&
    !!byId.get('SUB-001') && byId.get('SUB-001').parent === 'TSK-001',
    JSON.stringify(tree.map(e => [e.id, e.parent])));
  // The root epic's `parent` key is not asserted: § 6 forbids `parent` on an
  // epic, so whether the JSON entry carries the key at all is unpinned.
  const treeHuman = H.runNj(['tree'], { cwd: d });
  T.exit('nj tree', treeHuman, 0);
  printed('nj tree prints something', treeHuman);

  const rmChild = H.runNj(['rm', '--id=TSK-001'], { cwd: d });
  T.exit('rm refuses while a child element exists (§ 9)', rmChild, 1);
  T.contains('rm names the child it refuses on', rmChild.stdout + rmChild.stderr, 'SUB-001');
  const rm = H.runNj(['rm', '--id=SUB-001'], { cwd: d });
  T.exit('nj rm', rm, 0);
  printed('nj rm prints something', rm);
  T.check('rm deleted the file', !exists(d, 'subtasks', 'SUB-001.md'));
  T.check('rm left the tombstone in place (§ 8)', exists(d, H.IDS_REL, 'SUB-001'));

  const archOpen = H.runNj(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('archive refuses while elements are open (§ 11)', archOpen, 1);
  T.contains('archive names the open element', archOpen.stdout + archOpen.stderr, 'TSK-001');

  T.exit('set TSK-001 done', H.runNj(['set', '--id=TSK-001', '--status=done'], { cwd: d }), 0);
  T.exit('set EPIC-001 done', H.runNj(['set', '--id=EPIC-001', '--status=done'], { cwd: d }), 0);

  const arch = H.runNj(['archive', '--id=EPIC-001'], { cwd: d });
  T.exit('nj archive', arch, 0);
  printed('nj archive prints something', arch);
  T.check('archive moved the whole subtree',
    exists(d, 'archive', 'EPIC-001.md') && exists(d, 'archive', 'TSK-001.md') &&
    !exists(d, 'epics', 'EPIC-001.md') && !exists(d, 'tasks', 'TSK-001.md'));

  const after = H.runJson(['list'], { cwd: d });
  T.exit('nj list --json after archive', after, 0);
  T.check('archived elements are hidden from list', entriesOf(after).length === 0,
    JSON.stringify(entriesOf(after).map(e => e.id)));
  const all = H.runJson(['list', '--all'], { cwd: d });
  T.exit('nj list --all --json', all, 0);
  T.eq('--all shows the archived elements', entriesOf(all).map(e => e.id).sort(),
    ['EPIC-001', 'TSK-001']);
  T.check('archived entries carry their archived timestamp',
    entriesOf(all).length === 2 &&
    entriesOf(all).every(e => typeof e.archived === 'string' && e.archived.length > 0),
    JSON.stringify(entriesOf(all).map(e => [e.id, e.archived])));

  const doc = H.runNj(['doctor'], { cwd: d });
  T.exit('nj doctor', doc, 0);
  printed('nj doctor prints something', doc);
  const docJson = H.runJson(['doctor'], { cwd: d });
  T.exit('nj doctor --json', docJson, 0);
  T.check('doctor --json reports ok', !!docJson.json && docJson.json.ok === true,
    JSON.stringify(docJson.json && docJson.json.ok));
  T.check('doctor finds nothing on a clean backlog',
    !!docJson.json && Array.isArray(docJson.json.problems) && docJson.json.problems.length === 0,
    JSON.stringify(docJson.json && docJson.json.problems));

  const bare = H.runNj([], { cwd: d });
  T.exit('bare nj after the lifecycle', bare, 0);
  printed('bare nj prints something', bare);
}

T.finish();
