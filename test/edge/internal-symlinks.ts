/* Edge — nanojira never writes, deletes or lists through a symlink inside
 * its own `.nanojira/` bookkeeping (§ 12 "Claims", § 8, § 9
 * `refused:symlink`, DECISIONS 215).
 *
 * The claims root `.nanojira/claims/`, each claim directory under it, the
 * tombstone directory `.nanojira/ids/` and `.nanojira/` itself are
 * nanojira's own internals: unlike a layout folder (DECISIONS 105) none of
 * them is ever meant to be a symlink. Before this, a crafted or cloned
 * backlog could carry one pointing anywhere (ImprovementScout, attack
 * script C1–C4):
 *
 *  - C1: `claims/TSK-009 -> outside` (no such element) — `doctor --fix`
 *    step 7a deleted the number-named files outside;
 *  - C2: a live element's claim directory as a symlink — `archive` deleted
 *    outside, `claim` read and appended outside;
 *  - C3: `claims -> outside` — `claim` wrote outside;
 *  - C4: `ids -> outside` — `new` wrote tombstones outside.
 *
 * A write that would go through such a link is refused before anything is
 * written; a read finds nothing behind it; `doctor --fix` leaves it alone
 * and says so in a note. Every "outside" lives in the fixture's own scratch
 * directory.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;
const p = (d: string, rel: string) => path.join(d, 'backlog', rel);
const outside = (d: string, rel = '') => path.join(d, 'outside', rel);

/** EPIC-001 > TSK-001, both done; EPIC-002 todo. */
function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'done', created: NOW, updated: NOW }, '# E1\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T1', status: 'done', created: NOW, updated: NOW }, H.doneBody('T1')),
      'epics/EPIC-002.md': H.element({ id: 'EPIC-002', type: 'epic', title: 'E2', status: 'todo', created: NOW, updated: NOW }, '# E2\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001', 'EPIC-002', 'TSK-001'],
  });
}

/** outside/<dir>/{1,2,keep}, plus a planted claim entry `3` naming mallory. */
function plantVictim(d: string, dir: string) {
  fs.mkdirSync(outside(d, dir), { recursive: true });
  fs.writeFileSync(outside(d, dir + '/1'), 'claimed\nmallory\n' + NOW + '\n');
  fs.writeFileSync(outside(d, dir + '/2'), 'b\n');
  fs.writeFileSync(outside(d, dir + '/keep'), 'k\n');
}

/** Byte-level snapshot of the whole fixture directory (links not followed). */
function snapshot(d: string): string {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, n);
      const r = rel === '' ? n : rel + '/' + n;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) out[r] = 'symlink -> ' + fs.readlinkSync(full);
      else if (st.isDirectory()) { out[r + '/'] = 'dir'; walk(full, r); }
      else out[r] = H.sha256(fs.readFileSync(full));
    }
  };
  walk(d, '');
  return JSON.stringify(out);
}

function refusesSymlink(desc: string, r: H.JsonRunResult, linkRel: string) {
  T.exit(desc + ' — exits 1', r, 1);
  T.eq(desc + ' — refused:symlink', r.json && r.json.error, 'refused:symlink');
  T.contains(desc + ' — the error names the link', r.stderr, linkRel);
}

const notesOf = (r: H.JsonRunResult): string[] => (r.json && Array.isArray(r.json.notes) ? r.json.notes : []);

/** Plain `doctor` reports the link as `claim:symlink` (an error), on `element` or backlog-level. */
function reportsClaimSymlink(desc: string, d: string, linkRel: string, element: string | null) {
  const r = H.runJson(['doctor'], { cwd: d });
  const found = ((r.json && r.json.problems) || []).filter((x: any) => x.code === 'claim:symlink');
  T.check(desc + ' — plain doctor reports one claim:symlink error naming the link',
    found.length === 1 && found[0].severity === 'error' && String(found[0].message).includes(linkRel),
    JSON.stringify(r.json && r.json.problems).slice(0, 600));
  T.eq(desc + ' — ' + (element === null ? 'backlog-level' : 'on ' + element), found.length === 1 ? (found[0].element ?? null) : 'none', element);
  T.eq(desc + ' — doctor is not ok', r.json && r.json.ok, false);
}

function noDuplicateNotes(desc: string, r: H.JsonRunResult) {
  const notes = notesOf(r);
  T.eq(desc + ' — no note appears twice', notes.filter((n, i) => notes.indexOf(n) !== i), []);
}

/* ---- C1: an orphaned claim directory that is a symlink ------------------ */
{
  const d = fixture('edge-isym-c1');
  plantVictim(d, 'v1');
  fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true });
  fs.symlinkSync(outside(d, 'v1'), p(d, '.nanojira/claims/TSK-009'));
  const before = snapshot(d);
  reportsClaimSymlink('C1', d, '.nanojira/claims/TSK-009', null);
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('C1 doctor --fix — ran to the end', r.json !== null && Array.isArray(r.json.notes), H.describeRun(r));
  T.eq('C1 doctor --fix — nothing outside was deleted', fs.readdirSync(outside(d, 'v1')).sort(), ['1', '2', 'keep']);
  T.check('C1 doctor --fix — the link itself is left in place', fs.lstatSync(p(d, '.nanojira/claims/TSK-009')).isSymbolicLink(), '');
  T.check('C1 doctor --fix — a note names the link', notesOf(r).some((n) => n.includes('.nanojira/claims/TSK-009') && n.includes('symlink')), JSON.stringify(notesOf(r)));
  T.check('C1 doctor --fix — nothing reported as removed or released for it',
    !!r.json && !(r.json.fixed || []).some((a: string) => a.includes('TSK-009')), JSON.stringify(r.json && r.json.fixed));
  T.eq('C1 doctor --fix — outside untouched byte for byte',
    JSON.parse(snapshot(d))['outside/v1/1'], JSON.parse(before)['outside/v1/1']);
}

/* ---- C2: a live element's claim directory is a symlink ------------------ */
{
  const d = fixture('edge-isym-c2');
  plantVictim(d, 'v2');
  fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true });
  fs.symlinkSync(outside(d, 'v2'), p(d, '.nanojira/claims/TSK-001'));
  const before = snapshot(d);
  const link = '.nanojira/claims/TSK-001';
  /* reads first: the writes below must not have touched what is read */
  const show = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  T.check('C2 show — a claim entry behind the link is not read', show.status === 0 && !show.stdout.includes('mallory'), show.stdout.slice(0, 400));
  const log = H.runJson(['log', '--id=TSK-001'], { cwd: d });
  T.check('C2 log — a claim entry behind the link is not read', !log.stdout.includes('mallory'), log.stdout.slice(0, 400));
  reportsClaimSymlink('C2', d, link, 'TSK-001');
  refusesSymlink('C2 claim', H.runJson(['claim', '--id=TSK-001', '--as=bob'], { cwd: d }), link);
  refusesSymlink('C2 release', H.runJson(['release', '--id=TSK-001', '--as=mallory'], { cwd: d }), link);
  T.eq('C2 claim/release — nothing written, inside or outside', snapshot(d), before);
  refusesSymlink('C2 archive', H.runJson(['archive', '--id=EPIC-001'], { cwd: d }), link);
  T.eq('C2 archive — nothing moved or deleted, inside or outside', snapshot(d), before);
  refusesSymlink('C2 rm --cascade', H.runJson(['rm', '--id=EPIC-001', '--cascade'], { cwd: d }), link);
  T.eq('C2 rm --cascade — nothing deleted, inside or outside', snapshot(d), before);
  /* the neighbour without a link is unaffected */
  T.exit('C2 claim --id=EPIC-002 — still succeeds beside the link', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), 0);
}

/* ---- C2b: unarchive of an archived element whose claim directory is a symlink */
{
  const d = H.mkBacklog({
    label: 'edge-isym-c2b',
    files: {
      'archive/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'done', created: NOW, updated: NOW, archived: NOW }, '# E1\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });
  plantVictim(d, 'v2b');
  fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true });
  fs.symlinkSync(outside(d, 'v2b'), p(d, '.nanojira/claims/EPIC-001'));
  const before = snapshot(d);
  refusesSymlink('C2b unarchive', H.runJson(['unarchive', '--id=EPIC-001'], { cwd: d }), '.nanojira/claims/EPIC-001');
  T.eq('C2b unarchive — nothing moved or deleted, inside or outside', snapshot(d), before);
}

/* ---- C3: the claims root is a symlink ----------------------------------- */
{
  const d = fixture('edge-isym-c3');
  plantVictim(d, 'croot/TSK-001');
  fs.writeFileSync(outside(d, 'croot/.nj-tmp-1-planted'), 'x\n');
  fs.mkdirSync(p(d, '.nanojira'), { recursive: true });
  fs.symlinkSync(outside(d, 'croot'), p(d, '.nanojira/claims'));
  const before = snapshot(d);
  refusesSymlink('C3 claim', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), '.nanojira/claims');
  T.eq('C3 claim — nothing written, inside or outside', snapshot(d), before);
  const list = H.runJson(['list'], { cwd: d });
  T.check('C3 list — a claim behind the linked root is not read', list.status === 0 && !list.stdout.includes('mallory'), list.stdout.slice(0, 400));
  reportsClaimSymlink('C3', d, '.nanojira/claims', null);
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('C3 doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
  noDuplicateNotes('C3 doctor --fix', r);
  T.eq('C3 doctor --fix — nothing outside removed or swept', fs.readdirSync(outside(d, 'croot')).sort(), ['.nj-tmp-1-planted', 'TSK-001']);
  T.eq('C3 doctor --fix — the planted claim entries survive', fs.readdirSync(outside(d, 'croot/TSK-001')).sort(), ['1', '2', 'keep']);
  T.check('C3 doctor --fix — a note names the linked root', notesOf(r).some((n) => n.includes('.nanojira/claims') && n.includes('symlink')), JSON.stringify(notesOf(r)));
}

/* ---- C4: the tombstone directory is a symlink --------------------------- */
{
  const d = fixture('edge-isym-c4');
  fs.mkdirSync(outside(d));
  fs.renameSync(p(d, H.IDS_REL), outside(d, 'ids'));
  fs.symlinkSync(outside(d, 'ids'), p(d, H.IDS_REL));
  const before = snapshot(d);
  refusesSymlink('C4 new', H.runJson(['new', '--type=epic', '--title=E3'], { cwd: d }), '.nanojira/ids');
  T.eq('C4 new — nothing written, inside or outside', snapshot(d), before);
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('C4 doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
  T.eq('C4 doctor --fix — no tombstone written outside', fs.readdirSync(outside(d, 'ids')).sort(), ['EPIC-001', 'EPIC-002', 'TSK-001']);
  T.check('C4 doctor --fix — a note names the linked ids directory', notesOf(r).some((n) => n.includes('.nanojira/ids') && n.includes('symlink')), JSON.stringify(notesOf(r)));
  const doc = H.runJson(['doctor'], { cwd: d });
  const miss = ((doc.json && doc.json.problems) || []).find((x: any) => x.code === 'backlog:ids_missing');
  T.check('C4 doctor — backlog:ids_missing says the directory is a symlink', !!miss && String(miss.message).includes('symlink'), JSON.stringify(doc.json && doc.json.problems).slice(0, 600));
  T.check('C4 doctor — a linked ids/ is not also claim:symlink', !((doc.json && doc.json.problems) || []).some((x: any) => x.code === 'claim:symlink'),
    JSON.stringify(doc.json && doc.json.problems).slice(0, 600));
}

/* ---- C5: .nanojira itself is a symlink ---------------------------------- */
{
  const d = fixture('edge-isym-c5');
  fs.mkdirSync(outside(d));
  fs.renameSync(p(d, '.nanojira'), outside(d, 'nj'));
  fs.symlinkSync(outside(d, 'nj'), p(d, '.nanojira'));
  const before = snapshot(d);
  refusesSymlink('C5 new', H.runJson(['new', '--type=epic', '--title=E3'], { cwd: d }), '.nanojira');
  refusesSymlink('C5 claim', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), '.nanojira');
  T.eq('C5 new/claim — nothing written, inside or outside', snapshot(d), before);
  T.exit('C5 list — the configuration behind the link is still read', H.runJson(['list'], { cwd: d }), 0);
  reportsClaimSymlink('C5', d, '.nanojira', null);
  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('C5 doctor --fix — ran to the end, a note names the link', fix.json !== null && notesOf(fix).some((n) => n.startsWith('.nanojira: a symlink')), H.describeRun(fix));
  noDuplicateNotes('C5 doctor --fix', fix);
  T.eq('C5 doctor --fix — nothing written, inside or outside', snapshot(d), before);
}

/* ---- batch claim/release: refused:symlink is a per-ID preflight refusal - */
{
  /* EPIC-002 comes first in each batch, so a refusal found only in the
   * write phase would already have claimed or released it. */
  const d = fixture('edge-isym-batch');
  plantVictim(d, 'vb');
  T.exit('batch fixture: claim EPIC-002 as bob', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), 0);
  fs.symlinkSync(outside(d, 'vb'), p(d, '.nanojira/claims/TSK-001'));
  const before = snapshot(d);
  for (const [verb, args] of [
    ['claim', ['claim', '--id=EPIC-002,TSK-001', '--as=bob']],
    ['release', ['release', '--id=EPIC-002,TSK-001', '--as=bob']],
  ] as [string, string[]][]) {
    const r = H.runJson(args, { cwd: d });
    T.exit('batch ' + verb + ' with claims/TSK-001 linked — exits 1', r, 1);
    const res: any[] = (r.json && r.json.results) || [];
    T.check('batch ' + verb + ' — TSK-001 refused:symlink in preflight, EPIC-002 not touched',
      res.length === 1 && res[0].id === 'TSK-001' && res[0].error === 'refused:symlink', JSON.stringify(r.json).slice(0, 400));
    T.eq('batch ' + verb + ' — nothing of the batch was written, inside or outside', snapshot(d), before);
  }
}

/* ---- a claim entry that is a symlink (Scout r2, N6) --------------------- */
{
  const d = fixture('edge-isym-entry');
  fs.mkdirSync(outside(d), { recursive: true });
  fs.writeFileSync(outside(d, 'planted'), 'claimed\nmallory\n' + NOW + '\n');
  fs.mkdirSync(p(d, '.nanojira/claims/EPIC-002'), { recursive: true });
  fs.symlinkSync(outside(d, 'planted'), p(d, '.nanojira/claims/EPIC-002/1'));
  const before = snapshot(d);
  const link = '.nanojira/claims/EPIC-002/1';
  refusesSymlink('N6 claim with entry 1 a symlink', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), link);
  refusesSymlink('N6 release with entry 1 a symlink', H.runJson(['release', '--id=EPIC-002', '--as=mallory'], { cwd: d }), link);
  T.eq('N6 claim/release — nothing written, inside or outside', snapshot(d), before);
  reportsClaimSymlink('N6', d, link, 'EPIC-002');
}

/* ---- doctor --fix's legacy migration and a linked .nanojira or .ids (Scout r2, N3) */
for (const linked of ['.nanojira', '.ids']) {
  const d = fixture('edge-isym-legacy' + linked.replace('.', '-'));
  fs.mkdirSync(outside(d));
  /* the v2 layout: .nanojira.json and .ids/ at the top level */
  fs.renameSync(p(d, H.CONFIG_REL), p(d, '.nanojira.json'));
  fs.renameSync(p(d, H.IDS_REL), p(d, '.ids'));
  fs.rmSync(p(d, '.nanojira'), { recursive: true });
  if (linked === '.nanojira') {
    fs.mkdirSync(outside(d, 'njdir'));
    fs.symlinkSync(outside(d, 'njdir'), p(d, '.nanojira'));
  } else {
    fs.renameSync(p(d, '.ids'), outside(d, 'ids'));
    fs.symlinkSync(outside(d, 'ids'), p(d, '.ids'));
  }
  const before = snapshot(d);
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('legacy, ' + linked + ' linked: doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
  T.check('legacy, ' + linked + ' linked: doctor --fix — a note names the link', notesOf(r).some((n) => n.startsWith(linked + ': a symlink')), JSON.stringify(notesOf(r)));
  const outsideOf = (snap: string) => Object.entries(JSON.parse(snap)).filter(([k]) => k.startsWith('outside/'));
  T.eq('legacy, ' + linked + ' linked: doctor --fix — nothing written outside', outsideOf(snapshot(d)), outsideOf(before));
  T.check('legacy, ' + linked + ' linked: doctor --fix — nothing migrated',
    fs.existsSync(p(d, '.nanojira.json')) && fs.lstatSync(p(d, linked)).isSymbolicLink(), fs.readdirSync(p(d, '.')).join(' '));
}

/* ---- next / list --ready skip an element whose claims are linked (Reviewer S1) */
for (const what of ['dir', 'entry']) {
  /* TSK-001 high and ready, but its claim directory (or an entry in it) is a
   * link; TSK-002 low and ready. One link must not block `next` for everyone. */
  const d = H.mkBacklog({
    label: 'edge-isym-next-' + what,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'doing', created: NOW, updated: NOW }, '# E1\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T1', status: 'todo', priority: 'high', created: NOW, updated: NOW }, H.completeBody('T1')),
      'tasks/TSK-002.md': H.element({ id: 'TSK-002', type: 'task', parent: 'EPIC-001', title: 'T2', status: 'todo', priority: 'low', created: NOW, updated: NOW }, H.completeBody('T2')),
    },
    tombstones: ['EPIC-001', 'TSK-001', 'TSK-002'],
  });
  fs.mkdirSync(outside(d, 'v'), { recursive: true });
  fs.writeFileSync(outside(d, 'v/1'), 'released\nmallory\n' + NOW + '\n');
  fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true });
  if (what === 'dir') fs.symlinkSync(outside(d, 'v'), p(d, '.nanojira/claims/TSK-001'));
  else {
    fs.mkdirSync(p(d, '.nanojira/claims/TSK-001'));
    fs.symlinkSync(outside(d, 'v/1'), p(d, '.nanojira/claims/TSK-001/1'));
  }
  const tag = 'S1 claims ' + what + ' of TSK-001 linked';
  const ready = H.runJson(['list', '--ready'], { cwd: d, env: { NJ_AUTHOR: 'x' } });
  const ids = ((ready.json && ready.json.entries) || []).map((e: any) => e.id);
  T.eq(tag + ': list --ready omits TSK-001, keeps TSK-002', ids, ['TSK-002']);
  const show = H.runJson(['show', '--id=TSK-001'], { cwd: d });
  const probs = (show.json && show.json.entry && show.json.entry._problems) || [];
  T.check(tag + ': show — _problems names claim:symlink', probs.includes('claim:symlink'), JSON.stringify(probs));
  const nx = H.runJson(['next', '--as=x', '--status=doing'], { cwd: d });
  T.exit(tag + ': next — succeeds', nx, 0);
  T.eq(tag + ': next — hands out TSK-002', nx.json && nx.json.id, 'TSK-002');
  T.eq(tag + ': nothing outside was touched', fs.readdirSync(outside(d, 'v')).sort(), ['1']);
}
{
  /* backlog level: a linked claims root still stops `next` (refused:symlink) */
  const d = fixture('edge-isym-next-root');
  fs.mkdirSync(outside(d, 'croot'), { recursive: true });
  fs.mkdirSync(p(d, '.nanojira'), { recursive: true });
  fs.symlinkSync(outside(d, 'croot'), p(d, '.nanojira/claims'));
  refusesSymlink('S1 a linked claims root: next', H.runJson(['next', '--as=x'], { cwd: d }), '.nanojira/claims');
  T.eq('S1 a linked claims root: nothing written outside', fs.readdirSync(outside(d, 'croot')), []);
}

/* ---- a sharded ids/ with one bucket linked (Scout r3, R3) -------------- */
{
  const d = fixture('edge-isym-bucket');
  const cfg = JSON.parse(fs.readFileSync(p(d, H.CONFIG_REL), 'utf8'));
  cfg.ids = { shardSize: 1000 };
  fs.writeFileSync(p(d, H.CONFIG_REL), JSON.stringify(cfg, null, 2) + '\n');
  T.exit('R3 fixture: doctor --fix migrates ids/ to sharded', H.runJson(['doctor', '--fix'], { cwd: d }), 0);
  T.check('R3 fixture: the TSK bucket exists', fs.existsSync(p(d, H.IDS_REL + '/TSK/000000/TSK-001')), '');
  T.exit('R3 control: sharded, nothing linked — doctor exits 0', H.runJson(['doctor'], { cwd: d }), 0);
  fs.mkdirSync(outside(d));
  fs.renameSync(p(d, H.IDS_REL + '/TSK/000000'), outside(d, 'bucket'));
  fs.symlinkSync(outside(d, 'bucket'), p(d, H.IDS_REL + '/TSK/000000'));
  fs.rmSync(p(d, H.IDS_REL + '/EPIC/000000/EPIC-002')); // step 4 would write this one
  const before = snapshot(d);
  const doc = H.runJson(['doctor'], { cwd: d });
  const miss = ((doc.json && doc.json.problems) || []).find((x: any) => x.code === 'backlog:ids_missing');
  T.check('R3 doctor — backlog:ids_missing names the linked bucket', !!miss && String(miss.message).includes('part of .nanojira/ids/ (.nanojira/ids/TSK/000000) is behind a symlink'),
    JSON.stringify(doc.json && doc.json.problems).slice(0, 600));
  T.exit('R3 doctor — exits 2', doc, 2);
  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.exit('R3 doctor --fix — exits 2', fix, 2);
  T.check('R3 doctor --fix — a note names the linked bucket', notesOf(fix).some((n) => n.startsWith('.nanojira/ids/TSK/000000: a symlink')), JSON.stringify(notesOf(fix)));
  const ids = (snap: string) => Object.entries(JSON.parse(snap)).filter(([k]) => k.startsWith('backlog/.nanojira/ids') || k.startsWith('outside/'));
  T.eq('R3 doctor --fix — no tombstone written, inside or outside', ids(snapshot(d)), ids(before));
}

/* ---- a flat ids/ with one tombstone a symlink (Reviewer r4, R1) ---------
 * A flat tombstone is a file, never a directory: one that is a link still
 * counts by its name (readTombstones), so it hides nothing and is no linked
 * type directory. doctor stays as it was: no backlog:ids_missing, and
 * doctor --fix backfills a missing tombstone. */
{
  const d = fixture('edge-isym-flat-link');
  fs.mkdirSync(outside(d));
  fs.writeFileSync(outside(d, 'empty'), '');
  fs.rmSync(p(d, H.IDS_REL + '/TSK-001'));
  fs.symlinkSync(outside(d, 'empty'), p(d, H.IDS_REL + '/TSK-001'));
  fs.rmSync(p(d, H.IDS_REL + '/EPIC-002'));
  const doc = H.runJson(['doctor'], { cwd: d });
  const probs: any[] = (doc.json && doc.json.problems) || [];
  T.check('flat link: doctor — no backlog:ids_missing', !probs.some((x) => x.code === 'backlog:ids_missing'), JSON.stringify(probs).slice(0, 600));
  T.check('flat link: doctor — EPIC-002 is id:no_tombstone', probs.some((x) => x.code === 'id:no_tombstone' && x.element === 'EPIC-002'), JSON.stringify(probs).slice(0, 600));
  T.exit('flat link: doctor — exits 0', doc, 0);
  const fix = H.runJson(['doctor', '--fix'], { cwd: d });
  T.exit('flat link: doctor --fix — exits 0', fix, 0);
  T.check('flat link: doctor --fix — backfills EPIC-002', fs.existsSync(p(d, H.IDS_REL + '/EPIC-002')), JSON.stringify(fix.json).slice(0, 400));
  T.check('flat link: the link and its target are untouched', fs.lstatSync(p(d, H.IDS_REL + '/TSK-001')).isSymbolicLink() && fs.statSync(outside(d, 'empty')).size === 0, '');
}

T.finish();
