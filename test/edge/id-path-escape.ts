/* Edge — an element id never becomes a path unchecked (§ 6, § 9 `refused:invalid_id`).
 *
 * § 6 gives an id exactly one shape, `EPIC-<n>`, `TSK-<n>` or `SUB-<n>`, but
 * the frontmatter `id:` of a hand-edited, cloned or foreign backlog can hold
 * anything. Wherever nanojira joins an id into a path — the claim directory
 * `.nanojira/claims/<id>/`, the file name `doctor --fix` renames to, the
 * folder `hierarchy` gives an epic or task — an id like `../../outside/x`
 * would reach outside the backlog. Before TSK-033 it did:
 *
 *  - S1: `doctor --fix` renamed `epics/EPIC-001.md` to `outside/PWNED.md`;
 *  - S2: `archive` deleted every number-named file in `outside/victim/`
 *    while removing the claim directory of a child whose id pointed there;
 *  - `claim` created `outside/w/1`.
 *
 * Every case below keeps its "outside" inside the fixture's own scratch
 * directory: `<dir>/outside` next to `<dir>/backlog`.
 *
 * The element-file reader is covered here too: an element file is opened
 * non-blocking, must be a regular file, and is capped in size, so a FIFO
 * cannot hang a read and a device (`/dev/null` stands in for the survey's
 * `/dev/zero` case, which must never be re-run) or an oversized file cannot
 * exhaust memory. Each becomes a `file:unreadable` stub, as § 7 already
 * describes for a file that "cannot be read at all".
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;
const CAP = 1024 * 1024; // § 12a: an element file above 1 MiB is not read
const p = (d: string, rel: string) => path.join(d, 'backlog', rel);
const outside = (d: string, rel = '') => path.join(d, 'outside', rel);

const epic = (id: string, extra: Record<string, unknown> = {}) => H.element(Object.assign({
  id, type: 'epic', title: 'Epic', status: 'done', created: NOW, updated: NOW,
}, extra), '# Epic\n\n## Description\nD\n');
const task = (id: string, parent: string, extra: Record<string, unknown> = {}) => H.element(Object.assign({
  id, type: 'task', parent, title: 'Task', status: 'done', created: NOW, updated: NOW,
}, extra), H.doneBody('Task'));

/** Byte-level snapshot of the whole fixture directory, backlog and outside alike. */
function snapshot(d: string): string {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, n);
      const r = rel === '' ? n : rel + '/' + n;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) out[r] = 'symlink';
      else if (st.isDirectory()) { out[r + '/'] = 'dir'; walk(full, r); }
      else if (st.isFile()) out[r] = H.sha256(fs.readFileSync(full));
      else out[r] = 'special';
    }
  };
  walk(d, '');
  return JSON.stringify(out);
}

/** outside/victim/{1,2,keep}: the files S2 deleted (the number-named ones). */
function plantVictim(d: string, dir = 'victim') {
  fs.mkdirSync(outside(d, dir), { recursive: true });
  fs.writeFileSync(outside(d, dir + '/1'), '1\n');
  fs.writeFileSync(outside(d, dir + '/2'), '2\n');
  fs.writeFileSync(outside(d, dir + '/keep'), 'k\n');
}

function refusesInvalidId(desc: string, r: H.JsonRunResult, id: string) {
  T.exit(desc + ' — exits 1', r, 1);
  T.eq(desc + ' — refused:invalid_id', r.json && r.json.error, 'refused:invalid_id');
  T.contains(desc + ' — the error names the id', r.stderr, id);
}

/* ---- S1: doctor --fix never renames a file to a malformed id ------------ */
for (const crafted of ['../../outside/PWNED', 'EPIC-001/../../../outside/PWNED', '..']) {
  const d = H.mkBacklog({
    label: 'edge-idpath-s1',
    files: { 'epics/EPIC-001.md': epic(crafted, { status: 'todo' }) },
    tombstones: ['EPIC-001'],
  });
  fs.mkdirSync(outside(d));
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('S1 ' + crafted + ' — doctor --fix ran to the end', r.json !== null && Array.isArray(r.json.notes), H.describeRun(r));
  T.eq('S1 ' + crafted + ' — nothing was written outside the backlog', fs.readdirSync(outside(d)), []);
  T.check('S1 ' + crafted + ' — the element file stayed where it was',
    fs.existsSync(p(d, 'epics/EPIC-001.md')), fs.readdirSync(p(d, 'epics')).join(' '));
  T.check('S1 ' + crafted + ' — nothing was reported as renamed',
    !!r.json && !(r.json.fixed || []).some((a: string) => a.includes('renamed')), JSON.stringify(r.json && r.json.fixed));
  T.check('S1 ' + crafted + ' — a note says why it was not renamed',
    !!r.json && (r.json.notes || []).some((n: string) => n.includes('EPIC-001.md') && n.includes('not renamed') && n.includes('§ 6')),
    JSON.stringify(r.json && r.json.notes));
  T.eq('S1 ' + crafted + ' — the backlog root holds no new file', fs.readdirSync(p(d, '.')).filter((n) => n.endsWith('.md')).sort(),
    ['README.md', 'STATUS.md', 'TAGS.md']);
}

/* non-vacuity: a well-shaped id that disagrees with its file name is still renamed */
{
  const d = H.mkBacklog({
    label: 'edge-idpath-s1-control',
    files: { 'epics/EPIC-009.md': epic('EPIC-001', { status: 'todo' }) },
    tombstones: ['EPIC-001'],
  });
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('S1 control — a well-shaped id is still renamed', fs.existsSync(p(d, 'epics/EPIC-001.md')) && !fs.existsSync(p(d, 'epics/EPIC-009.md')),
    JSON.stringify(r.json && r.json.fixed));
}

/* ---- S2: archive refuses a subtree that holds a malformed id ------------ */
{
  const crafted = '../../../outside/victim';
  const d = H.mkBacklog({
    label: 'edge-idpath-s2',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001'),
      'tasks/TSK-001.md': task(crafted, 'EPIC-001'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  plantVictim(d);
  const before = snapshot(d);
  const r = H.runJson(['archive', '--id=EPIC-001'], { cwd: d });
  refusesInvalidId('S2 archive (child id ' + crafted + ')', r, crafted);
  T.eq('S2 archive — nothing moved or deleted, inside or outside', snapshot(d), before);

  const r2 = H.runJson(['archive', '--id=' + crafted], { cwd: d });
  T.eq('S2 archive --id=<the malformed id itself> — refused:invalid_id', r2.json && r2.json.error, 'refused:invalid_id');
  T.eq('S2 archive --id=<the malformed id itself> — nothing moved or deleted', snapshot(d), before);
}

/* ---- rm refuses a malformed id, alone or inside a cascade --------------- */
{
  const crafted = '../../../outside/victim';
  const d = H.mkBacklog({
    label: 'edge-idpath-rm',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001'),
      'tasks/TSK-001.md': task(crafted, 'EPIC-001'),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  plantVictim(d);
  const before = snapshot(d);
  refusesInvalidId('rm --cascade (child id ' + crafted + ')', H.runJson(['rm', '--id=EPIC-001', '--cascade'], { cwd: d }), crafted);
  T.eq('rm --cascade — nothing deleted, inside or outside', snapshot(d), before);
  refusesInvalidId('rm --id=' + crafted, H.runJson(['rm', '--id=' + crafted], { cwd: d }), crafted);
  T.eq('rm --id=<malformed> — nothing deleted, inside or outside', snapshot(d), before);
}

/* ---- unarchive refuses an archived subtree that holds a malformed id ---- */
{
  const crafted = '../../../outside/victim';
  const d = H.mkBacklog({
    label: 'edge-idpath-unarchive',
    files: {
      'archive/EPIC-001.md': epic('EPIC-001', { archived: NOW }),
      'archive/TSK-001.md': task(crafted, 'EPIC-001', { archived: NOW }),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  plantVictim(d);
  const before = snapshot(d);
  refusesInvalidId('unarchive (archived child id ' + crafted + ')', H.runJson(['unarchive', '--id=EPIC-001'], { cwd: d }), crafted);
  T.eq('unarchive — nothing moved or deleted, inside or outside', snapshot(d), before);
}

/* ---- claim / release / new --parent on a malformed id ------------------- */
{
  const crafted = '../../../outside/w';
  const d = H.mkBacklog({
    label: 'edge-idpath-claim',
    files: {
      'epics/EPIC-001.md': epic(crafted, { status: 'todo' }),
      'epics/EPIC-002.md': epic('EPIC-002', { status: 'todo' }),
    },
    tombstones: ['EPIC-001', 'EPIC-002'],
  });
  fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true });
  fs.mkdirSync(outside(d));
  const before = snapshot(d);
  refusesInvalidId('claim --id=' + crafted, H.runJson(['claim', '--id=' + crafted, '--as=alice'], { cwd: d }), crafted);
  T.check('claim --id=<malformed> — no directory was created outside', !fs.existsSync(outside(d, 'w')), fs.readdirSync(outside(d)).join(' '));
  T.eq('claim --id=<malformed> — nothing written at all', snapshot(d), before);
  refusesInvalidId('claim --steal on a malformed id', H.runJson(['claim', '--id=' + crafted, '--as=alice', '--steal=bob'], { cwd: d }), crafted);
  refusesInvalidId('release --id=' + crafted, H.runJson(['release', '--id=' + crafted, '--as=alice'], { cwd: d }), crafted);
  T.eq('claim/release on a malformed id — nothing written at all', snapshot(d), before);
  /* in a batch the malformed id is a preflight refusal: EPIC-002, named first, is not claimed */
  for (const verb of ['claim', 'release']) {
    const r = H.runJson([verb, '--id=EPIC-002,' + crafted, '--as=alice'], { cwd: d });
    const res: any[] = (r.json && r.json.results) || [];
    T.check('batch ' + verb + ' with a malformed id — refused:invalid_id in preflight',
      r.status === 1 && res.length === 1 && res[0].id === crafted && res[0].error === 'refused:invalid_id', JSON.stringify(r.json).slice(0, 400));
    T.eq('batch ' + verb + ' with a malformed id — nothing of the batch was written', snapshot(d), before);
  }

  /* a claim directory reached through a malformed id is never read either:
   * a planted outside/w/1 must not show up as a holder */
  fs.mkdirSync(outside(d, 'w'), { recursive: true });
  fs.writeFileSync(outside(d, 'w/1'), 'claimed\nmallory\n' + NOW + '\n');
  const show = H.runJson(['show', '--id=' + crafted], { cwd: d });
  T.check('show --id=<malformed> — a claim file outside the backlog is not read', show.status === 0 && !show.stdout.includes('mallory'), show.stdout.slice(0, 400));
  const log = H.runJson(['log', '--id=' + crafted], { cwd: d });
  T.check('log --id=<malformed> — a claim file outside the backlog is not read', !log.stdout.includes('mallory'), log.stdout.slice(0, 400));
  const list = H.runJson(['list'], { cwd: d });
  T.check('list — a claim file outside the backlog is not read', list.status === 0 && !list.stdout.includes('mallory'), list.stdout.slice(0, 400));

  /* the well-shaped neighbour is still claimable: the check is per id */
  const ok = H.runJson(['claim', '--id=EPIC-002', '--as=alice'], { cwd: d });
  T.exit('claim --id=EPIC-002 beside a malformed id — still succeeds', ok, 0);

  const nw = H.runJson(['new', '--type=task', '--parent=' + crafted, '--title=Child'], { cwd: d });
  refusesInvalidId('new --parent=<malformed>', nw, crafted);
}

/* ---- hierarchy: set --parent onto a malformed parent -------------------- */
{
  const crafted = '../outside/E'; // relative to the backlog root, where the file lies
  const cfg = JSON.parse(H.DEFAULT_CONFIG);
  cfg.layout = { group: 'hierarchy' };
  const d = H.mkBacklog({
    label: 'edge-idpath-hier',
    config: JSON.stringify(cfg, null, 2) + '\n',
    files: {
      'EPIC-001/EPIC-001.md': epic('EPIC-001', { status: 'todo' }),
      'EPIC-001/TSK-001/TSK-001.md': task('TSK-001', 'EPIC-001', { status: 'todo' }),
      'EPIC-001/TSK-001/SUB-001.md': H.element({
        id: 'SUB-001', type: 'subtask', parent: 'TSK-001', title: 'Sub', status: 'todo', created: NOW, updated: NOW,
      }, H.completeBody('Sub')),
      'EPIC-002.md': epic(crafted, { status: 'todo' }),
      'TSK-002/TSK-002.md': task('TSK-002', crafted, { status: 'todo' }),
    },
    tombstones: ['EPIC-001', 'EPIC-002', 'TSK-001', 'TSK-002', 'SUB-001'],
  });
  fs.mkdirSync(outside(d));
  const before = snapshot(d);
  refusesInvalidId('hierarchy: set --parent=<malformed>', H.runJson(['set', '--id=TSK-001', '--parent=' + crafted], { cwd: d }), crafted);
  T.eq('hierarchy: set --parent=<malformed> — nothing moved', snapshot(d), before);
  refusesInvalidId('hierarchy: set --parent onto a task under a malformed epic',
    H.runJson(['set', '--id=SUB-001', '--parent=TSK-002'], { cwd: d }), crafted);
  T.eq('hierarchy: set --parent onto a task under a malformed epic — nothing moved', snapshot(d), before);
  refusesInvalidId('hierarchy: new --parent=<malformed>', H.runJson(['new', '--type=task', '--parent=' + crafted, '--title=C'], { cwd: d }), crafted);
  T.eq('hierarchy: new --parent=<malformed> — nothing written', snapshot(d), before);
  H.runJson(['doctor', '--fix'], { cwd: d });
  T.eq('hierarchy: doctor --fix — nothing written outside the backlog', fs.readdirSync(outside(d)), []);
  T.check('hierarchy: doctor --fix — the malformed epic stayed where it was', fs.existsSync(p(d, 'EPIC-002.md')), fs.readdirSync(p(d, '.')).join(' '));
}

/* ---- an id-shaped id of absurd length (L1) ------------------------------
 * § 6 bounds the number at 15 digits: `TSK-<300 digits>` once reached
 * `mkdir`/`rename` and died with a raw ENAMETOOLONG and no JSON. */
{
  const long = 'TSK-' + '1'.repeat(300);
  const d = H.mkBacklog({
    label: 'edge-idpath-long',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', { status: 'todo' }),
      'tasks/TSK-001.md': task(long, 'EPIC-001', { status: 'todo' }),
    },
    tombstones: ['EPIC-001', 'TSK-001'],
  });
  const r = H.runJson(['claim', '--id=' + long, '--as=alice'], { cwd: d });
  T.check('L1 claim --id=TSK-<300 digits> — a JSON result', r.json !== null, H.describeRun(r));
  refusesInvalidId('L1 claim --id=TSK-<300 digits>', r, long);
  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('L1 doctor --fix — a JSON result', fix.json !== null, H.describeRun(fix));
  T.check('L1 doctor --fix — not renamed, with a note',
    fs.existsSync(p(d, 'tasks/TSK-001.md')) && !!fix.json && (fix.json.notes || []).some((n: string) => n.includes('not renamed')),
    String(JSON.stringify(fix.json && fix.json.notes)).slice(0, 400));
  const nw = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: d });
  T.eq('L1 new beside TSK-<300 digits> — the next id is still TSK-002', nw.json && nw.json.id, 'TSK-002');
}
{
  const at15 = 'TSK-' + '9'.repeat(15);
  const at16 = 'TSK-' + '9'.repeat(16);
  const d = H.mkBacklog({
    label: 'edge-idpath-15',
    files: {
      'epics/EPIC-001.md': epic('EPIC-001', { status: 'todo' }),
      ['tasks/' + at15 + '.md']: task(at15, 'EPIC-001', { status: 'todo' }),
      ['tasks/' + at16 + '.md']: task(at16, 'EPIC-001', { status: 'todo' }),
    },
    tombstones: ['EPIC-001', at15, at16],
  });
  T.exit('L1 an id of 15 digits — claimable', H.runJson(['claim', '--id=' + at15, '--as=alice'], { cwd: d }), 0);
  refusesInvalidId('L1 an id of 16 digits', H.runJson(['claim', '--id=' + at16, '--as=alice'], { cwd: d }), at16);
  /* the allocator never hands out a 16-digit id either (Scout r2, N4) */
  const before = snapshot(d);
  const nw = H.runJson(['new', '--type=task', '--parent=EPIC-001', '--title=Next'], { cwd: d });
  T.eq('L1 new after TSK-<15 nines> — id_allocation_failed', nw.json && nw.json.error, 'id_allocation_failed');
  T.contains('L1 new after TSK-<15 nines> — the error names the 15-digit limit', nw.stderr, '15 digits');
  T.eq('L1 new after TSK-<15 nines> — no tombstone, no file', snapshot(d), before);
}

/* ---- the element reader: FIFO, device, oversize ------------------------- */
function readerFixture(label: string): string {
  return H.mkBacklog({
    label,
    files: { 'epics/EPIC-001.md': epic('EPIC-001', { status: 'todo' }) },
    tombstones: ['EPIC-001', 'EPIC-002'],
  });
}

function unreadableFor(desc: string, d: string, rel: string, why: string) {
  const r = H.runJson(['list'], { cwd: d, timeout: 20000 });
  T.check(desc + ' — list returns instead of hanging or growing', r.status !== null, H.describeRun(r));
  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.check(desc + ' — doctor returns', doc.status !== null, H.describeRun(doc));
  const f = ((doc.json && doc.json.problems) || []).find((x: any) => x.code === 'file:unreadable' && String(x.file).endsWith(rel));
  T.check(desc + ' — reported as file:unreadable', !!f, JSON.stringify(doc.json && doc.json.problems).slice(0, 600));
  T.contains(desc + ' — the message says why', f ? f.message : '', why);
}

{
  const d = readerFixture('edge-idpath-fifo');
  const mk = spawnSync('mkfifo', [p(d, 'epics/EPIC-002.md')]);
  if (mk.status !== 0) T.notCovered('a FIFO element file', 'mkfifo is not available: ' + String(mk.error || mk.stderr));
  else unreadableFor('a FIFO element file', d, 'epics/EPIC-002.md', 'not a regular file');
}
{
  const d = readerFixture('edge-idpath-device');
  if (!fs.existsSync('/dev/null')) T.notCovered('an element file that is a device', 'no /dev/null here');
  else {
    fs.symlinkSync('/dev/null', p(d, 'epics/EPIC-002.md'));
    unreadableFor('an element file that is a device (symlink to /dev/null)', d, 'epics/EPIC-002.md', 'not a regular file');
  }
}
{
  const d = readerFixture('edge-idpath-oversize');
  const f = p(d, 'epics/EPIC-002.md');
  fs.writeFileSync(f, epic('EPIC-002', { status: 'todo' }));
  fs.truncateSync(f, CAP + 1); // sparse: no real bytes written
  unreadableFor('an element file of 1 MiB + 1 byte', d, 'epics/EPIC-002.md', '1 MiB');

  /* the cap itself is still read */
  fs.truncateSync(f, CAP);
  const doc = H.runJson(['doctor'], { cwd: d, timeout: 20000 });
  T.check('an element file of exactly 1 MiB — still read',
    doc.json !== null && !((doc.json.problems || []).some((x: any) => x.code === 'file:unreadable')),
    JSON.stringify(doc.json && doc.json.problems).slice(0, 600));
}

T.finish();
