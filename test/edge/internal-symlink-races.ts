/* Edge — a link made inside nanojira's bookkeeping while a write is under
 * way is still never written or deleted through (§ 8, § 12 "Claims",
 * DECISIONS 215; ImprovementScout, TSK-033 round 2, N1/N2).
 *
 * `internal-symlinks.ts` covers a link that is there before the call. Here
 * the link is made while the call holds at NJ_FAULT=before-compare (§ 12),
 * after its own checks have passed:
 *
 *  - N1: `archive` holds; the archived task's claim directory becomes a
 *    link. The removal used to re-check through a cache of directories
 *    already seen to be real, and so deleted the entries outside.
 *  - N2: `claim --status=doing` holds; the claim directory, or the claims
 *    root, becomes a link and the element changes, so the mirror write
 *    fails and the claim is rolled back. The rollback appended its entry
 *    outside.
 *  - R1/R2/R2' (Scout r3/r4): the removal's rename aside, and a claim
 *    directory or the claims root gone under a claim write.
 *  - R4 (Scout r4): a `.nj-rm-*` aside a crash left behind is reported and
 *    removed by `doctor`, never followed.
 *
 * Node has no openat(2), so a window of one syscall pair between the
 * re-check and the operation remains (DECISIONS 215); the swaps below land
 * well before it.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;
const p = (d: string, rel: string) => path.join(d, 'backlog', rel);
const outside = (d: string, rel = '') => path.join(d, 'outside', rel);
const notesOf = (r: H.JsonRunResult): string[] => (r.json && Array.isArray(r.json.notes) ? r.json.notes : []);

/** EPIC-001 > TSK-001, both done, TSK-001 with a claim directory; EPIC-002 todo. */
function fixture(label: string): string {
  const d = H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'done', created: NOW, updated: NOW }, '# E1\n\n## Description\nD\n'),
      'tasks/TSK-001.md': H.element({ id: 'TSK-001', type: 'task', parent: 'EPIC-001', title: 'T1', status: 'done', created: NOW, updated: NOW }, H.doneBody('T1')),
      'epics/EPIC-002.md': H.element({ id: 'EPIC-002', type: 'epic', title: 'E2', status: 'todo', created: NOW, updated: NOW }, '# E2\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001', 'EPIC-002', 'TSK-001'],
  });
  fs.mkdirSync(p(d, '.nanojira/claims/TSK-001'), { recursive: true });
  fs.writeFileSync(p(d, '.nanojira/claims/TSK-001/1'), 'released\nbob\n' + NOW + '\n');
  fs.mkdirSync(outside(d));
  return d;
}

/** Runs `args` held at `hook` (before-compare by default), calls `swap` once it holds, keeps the go-marker present until it ends. */
async function heldRun(d: string, label: string, args: string[], swap: () => void, hook = 'before-compare'): Promise<{ held: boolean; r: H.JsonRunResult }> {
  const ready = H.faultReady(label);
  let running = true;
  const env = Object.assign({}, ready.env, { NJ_FAULT: hook });
  const done = H.runJsonAsync(args, { cwd: d, env, timeout: 60000 }).then((r) => { running = false; return r; });
  const held = await ready.wait(done);
  if (held) swap();
  const go = p(d, '.nj-fault-go');
  while (running) {
    if (!fs.existsSync(go)) fs.writeFileSync(go, '');
    await new Promise((res) => setTimeout(res, 100));
  }
  fs.rmSync(go, { force: true });
  return { held, r: await done };
}

(async () => {
  /* ---- N1: archive, the claim directory swapped for a link -------------- */
  {
    const d = fixture('edge-isymrace-archive');
    fs.mkdirSync(outside(d, 'v'));
    for (const n of ['1', '2', 'keep']) fs.writeFileSync(outside(d, 'v/' + n), n + '\n');
    const { held, r } = await heldRun(d, 'isymrace-archive', ['archive', '--id=EPIC-001'], () => {
      fs.rmSync(p(d, '.nanojira/claims/TSK-001'), { recursive: true });
      fs.symlinkSync(outside(d, 'v'), p(d, '.nanojira/claims/TSK-001'));
    });
    T.check('N1 archive reached the before-compare hold', held, H.describeRun(r));
    T.check('N1 archive — returned', r.status !== null, H.describeRun(r));
    T.eq('N1 archive — nothing outside was deleted', fs.readdirSync(outside(d, 'v')).sort(), ['1', '2', 'keep']);
    T.check('N1 archive — the link itself is left in place', fs.lstatSync(p(d, '.nanojira/claims/TSK-001')).isSymbolicLink(), '');
  }

  /* ---- N2: claim's rollback, the claim directory or root swapped -------- */
  for (const swapped of ['.nanojira/claims/EPIC-002', '.nanojira/claims']) {
    const d = fixture('edge-isymrace-claim' + (swapped.endsWith('claims') ? '-root' : '-dir'));
    T.exit('N2 fixture: EPIC-002 claimed and released once', H.runJson(['claim', '--id=EPIC-002', '--as=bob'], { cwd: d }), 0);
    T.exit('N2 fixture: released', H.runJson(['release', '--id=EPIC-002', '--as=bob'], { cwd: d }), 0);
    fs.mkdirSync(outside(d, 'empty'));
    const { held, r } = await heldRun(d, 'isymrace-claim', ['claim', '--id=EPIC-002', '--as=carol', '--status=doing'], () => {
      fs.renameSync(p(d, swapped), path.join(d, 'moved-away'));
      fs.symlinkSync(outside(d, 'empty'), p(d, swapped));
      fs.appendFileSync(p(d, 'epics/EPIC-002.md'), '\nParallel edit.\n');
    });
    const tag = 'N2 ' + swapped + ' swapped';
    T.check(tag + ': claim reached the before-compare hold', held, H.describeRun(r));
    T.eq(tag + ': changed_in_parallel', r.json && r.json.error, 'changed_in_parallel');
    const written: string[] = [];
    const walk = (dir: string) => { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); written.push(path.relative(outside(d), f)); if (fs.lstatSync(f).isDirectory()) walk(f); } };
    walk(outside(d, 'empty'));
    T.eq(tag + ': the rollback wrote nothing outside', written, []);
  }

  /* ---- R1: the removal renames the claim directory aside first ----------
   * Scout r3: a racer flipping the claim directory to a link between the
   * re-check and the unlink still deleted outside. The removal now renames
   * the directory aside (rename moves a link, never its target), checks the
   * aside name, and deletes only inside it. NJ_FAULT=claim-aside holds right
   * after that rename; the swap below turns the aside name into a link. */
  {
    const d = fixture('edge-isymrace-aside');
    fs.mkdirSync(p(d, '.nanojira/claims/TSK-009'));
    for (const n of ['1', '2']) fs.writeFileSync(p(d, '.nanojira/claims/TSK-009/' + n), 'claimed\nghost\n' + NOW + '\n');
    fs.mkdirSync(outside(d, 'v'));
    for (const n of ['1', '2', 'keep']) fs.writeFileSync(outside(d, 'v/' + n), n + '\n');
    let aside = '';
    const { held, r } = await heldRun(d, 'isymrace-aside', ['doctor', '--fix'], () => {
      aside = fs.readdirSync(p(d, '.nanojira/claims')).find((n) => n.startsWith('.nj-rm-')) || '';
      if (aside === '') return;
      fs.rmSync(p(d, '.nanojira/claims/' + aside), { recursive: true });
      fs.symlinkSync(outside(d, 'v'), p(d, '.nanojira/claims/' + aside));
    }, 'claim-aside');
    T.check('R1 doctor --fix reached the claim-aside hold', held, H.describeRun(r));
    T.check('R1 the claim directory was renamed aside before anything was removed', aside !== '', '');
    T.check('R1 doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
    T.eq('R1 nothing outside was deleted', fs.readdirSync(outside(d, 'v')).sort(), ['1', '2', 'keep']);
    let putBack = false;
    try { putBack = fs.lstatSync(p(d, '.nanojira/claims/TSK-009')).isSymbolicLink(); } catch { /* gone */ }
    T.check('R1 the link is put back under the claim directory\'s own name', putBack, fs.readdirSync(p(d, '.nanojira/claims')).join(' '));
  }

  /* ---- R1, rename back refused: the note names where the link sits -------
   * Reviewer r4, N2: an aside that turns out to be a link goes back under
   * the claim directory's name, unless that name is taken again; the link
   * then stays at the aside name, and that is the name the note gives. */
  {
    const d = fixture('edge-isymrace-aside-taken');
    fs.mkdirSync(p(d, '.nanojira/claims/TSK-009'));
    for (const n of ['1', '2']) fs.writeFileSync(p(d, '.nanojira/claims/TSK-009/' + n), 'claimed\nghost\n' + NOW + '\n');
    fs.mkdirSync(outside(d, 'v'));
    for (const n of ['1', '2', 'keep']) fs.writeFileSync(outside(d, 'v/' + n), n + '\n');
    let aside = '';
    const { held, r } = await heldRun(d, 'isymrace-aside-taken', ['doctor', '--fix'], () => {
      aside = fs.readdirSync(p(d, '.nanojira/claims')).find((n) => n.startsWith('.nj-rm-')) || '';
      if (aside === '') return;
      fs.rmSync(p(d, '.nanojira/claims/' + aside), { recursive: true });
      fs.symlinkSync(outside(d, 'v'), p(d, '.nanojira/claims/' + aside));
      fs.mkdirSync(p(d, '.nanojira/claims/TSK-009'));
    }, 'claim-aside');
    T.check('R1 taken: doctor --fix reached the claim-aside hold', held && aside !== '', H.describeRun(r));
    T.eq('R1 taken: nothing outside was deleted', fs.readdirSync(outside(d, 'v')).sort(), ['1', '2', 'keep']);
    T.check('R1 taken: the link stays at the aside name', aside !== '' && fs.lstatSync(p(d, '.nanojira/claims/' + aside)).isSymbolicLink(), '');
    T.check('R1 taken: the note names the aside, where the link sits', notesOf(r).some((n) => n.includes('.nanojira/claims/' + aside)), JSON.stringify(notesOf(r)).slice(0, 400));
  }

  /* ---- R2: the claim directory vanishes between mkdir and the temp file --
   * Scout r3: openSync's ENOENT escaped as internal_error. It is the same
   * "directory gone" retry the link() step already takes. NJ_FAULT=claim-append
   * holds between the mkdir and the temp file's open. */
  {
    const d = fixture('edge-isymrace-enoent');
    const { held, r } = await heldRun(d, 'isymrace-enoent', ['claim', '--id=EPIC-002', '--as=carol'], () => {
      fs.renameSync(p(d, '.nanojira/claims/EPIC-002'), path.join(d, 'moved-away'));
    }, 'claim-append');
    T.check('R2 claim reached the claim-append hold', held, H.describeRun(r));
    T.exit('R2 claim — succeeds on the retry', r, 0);
    T.check('R2 claim — not internal_error', !(r.json && r.json.error === 'internal_error') && !r.stderr.includes('    at '), H.describeRun(r));
  }

  /* ---- R2': the claims root gone between the fresh check and the mkdir ---
   * Scout r4: mkdirSync's ENOENT escaped as internal_error (41 of 800). It
   * is the same "directory gone" retry as R2. NJ_FAULT=claim-mkdir holds
   * between appendEntry's fresh check and its mkdir; a dangling link in the
   * claims root's place makes the recursive mkdir fail with ENOENT, and the
   * retry's fresh check then refuses the link as what it is. */
  {
    const d = fixture('edge-isymrace-mkdir');
    const { held, r } = await heldRun(d, 'isymrace-mkdir', ['claim', '--id=EPIC-002', '--as=carol'], () => {
      fs.renameSync(p(d, '.nanojira/claims'), path.join(d, 'moved-away'));
      fs.symlinkSync(outside(d, 'nowhere'), p(d, '.nanojira/claims'));
    }, 'claim-mkdir');
    T.check('R2\' claim reached the claim-mkdir hold', held, H.describeRun(r));
    T.check('R2\' claim — not internal_error', !(r.json && r.json.error === 'internal_error') && !r.stderr.includes('    at '), H.describeRun(r));
    T.eq('R2\' claim — the retry refuses the link: refused:symlink', r.json && r.json.error, 'refused:symlink');
    T.check('R2\' nothing was created behind the link', !fs.existsSync(outside(d, 'nowhere')), '');
  }

  /* ---- R4: a removal's aside left behind by a crash ----------------------
   * Scout r4: a kill right after the rename aside (C1, C1b) leaves a real
   * `.nj-rm-*` directory in the claims root; a failed rename back (C3)
   * leaves a link there. Nothing reported or removed either. Now plain
   * `doctor` reports each as backlog:stray_tmp, like a `.nj-tmp-*`, and
   * `doctor --fix` removes it: a directory holding only generations (and
   * temp files) is emptied and removed, a link is unlinked itself and never
   * followed, anything else in a directory leaves it in place with a note. */
  {
    const d = fixture('edge-isymrace-leftover');
    const root = p(d, '.nanojira/claims');
    fs.mkdirSync(path.join(root, '.nj-rm-111-aaaa'));
    for (const n of ['1', '2', '.nj-tmp-111-zz']) fs.writeFileSync(path.join(root, '.nj-rm-111-aaaa', n), 'claimed\nghost\n' + NOW + '\n');
    fs.mkdirSync(outside(d, 'v'));
    for (const n of ['1', '2', 'keep']) fs.writeFileSync(outside(d, 'v/' + n), n + '\n');
    fs.symlinkSync(outside(d, 'v'), path.join(root, '.nj-rm-222-bbbb'));
    fs.mkdirSync(path.join(root, '.nj-rm-333-cccc'));
    for (const n of ['1', 'notes.txt']) fs.writeFileSync(path.join(root, '.nj-rm-333-cccc', n), n + '\n');
    const strays = (r: H.JsonRunResult): string[] => ((r.json && r.json.problems) || [])
      .filter((x: any) => x.code === 'backlog:stray_tmp').map((x: any) => path.basename(String(x.file))).sort();
    const doc = H.runJson(['doctor'], { cwd: d });
    T.eq('R4 doctor reports every leftover aside as backlog:stray_tmp', strays(doc), ['.nj-rm-111-aaaa', '.nj-rm-222-bbbb', '.nj-rm-333-cccc']);
    T.check('R4 doctor — as a warning', ((doc.json && doc.json.problems) || []).filter((x: any) => x.code === 'backlog:stray_tmp').every((x: any) => x.severity === 'warning'),
      JSON.stringify(doc.json && doc.json.problems).slice(0, 400));
    const fix = H.runJson(['doctor', '--fix'], { cwd: d });
    T.check('R4 doctor --fix — ran to the end', fix.json !== null, H.describeRun(fix));
    T.check('R4 C1 the leftover directory is removed', !fs.existsSync(path.join(root, '.nj-rm-111-aaaa')), fs.readdirSync(root).join(' '));
    let linkLeft = true;
    try { fs.lstatSync(path.join(root, '.nj-rm-222-bbbb')); } catch { linkLeft = false; }
    T.check('R4 C3 the leftover link is unlinked', !linkLeft, fs.readdirSync(root).join(' '));
    T.eq('R4 C3 nothing outside was deleted', fs.readdirSync(outside(d, 'v')).sort(), ['1', '2', 'keep']);
    T.check('R4 C3 a note names the link', notesOf(fix).some((n) => n.includes('.nj-rm-222-bbbb')), JSON.stringify(notesOf(fix)).slice(0, 400));
    T.eq('R4 an aside holding anything else is left as it is', fs.readdirSync(path.join(root, '.nj-rm-333-cccc')).sort(), ['1', 'notes.txt']);
    T.check('R4 … and a note names it', notesOf(fix).some((n) => n.includes('.nj-rm-333-cccc')), JSON.stringify(notesOf(fix)).slice(0, 400));
    T.eq('R4 doctor afterwards reports only the aside left in place', strays(H.runJson(['doctor'], { cwd: d })), ['.nj-rm-333-cccc']);
  }

  /* ---- R4: the leftover swapped for a link while doctor --fix cleans it ---
   * The cleanup renames the leftover aside again, to a fresh name, and only
   * empties that name, exactly like the removal itself (R1). NJ_FAULT=
   * claim-aside holds right after that rename; the swap turns the fresh
   * name into a link, which is then unlinked, never followed. */
  {
    const d = fixture('edge-isymrace-leftover-race');
    const root = p(d, '.nanojira/claims');
    fs.mkdirSync(path.join(root, '.nj-rm-444-dddd'));
    for (const n of ['1', '2']) fs.writeFileSync(path.join(root, '.nj-rm-444-dddd', n), 'claimed\nghost\n' + NOW + '\n');
    fs.mkdirSync(outside(d, 'v'));
    for (const n of ['1', '2', 'keep']) fs.writeFileSync(outside(d, 'v/' + n), n + '\n');
    let fresh = '';
    const { held, r } = await heldRun(d, 'isymrace-leftover-race', ['doctor', '--fix'], () => {
      fresh = fs.readdirSync(root).find((n) => n.startsWith('.nj-rm-') && n !== '.nj-rm-444-dddd') || '';
      if (fresh === '') return;
      fs.rmSync(path.join(root, fresh), { recursive: true });
      fs.symlinkSync(outside(d, 'v'), path.join(root, fresh));
    }, 'claim-aside');
    T.check('R4 race: doctor --fix reached the claim-aside hold', held, H.describeRun(r));
    T.check('R4 race: the leftover was renamed to a fresh name first', fresh !== '', '');
    T.check('R4 race: doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
    T.eq('R4 race: nothing outside was deleted', fs.readdirSync(outside(d, 'v')).sort(), ['1', '2', 'keep']);
    T.eq('R4 race: no aside is left, the link included', fs.readdirSync(root).filter((n) => n.startsWith('.nj-rm-')), []);
  }


  /* ---- R4: the claims root swapped for a link during the cleanup --------
   * Reviewer r5: after its fresh rename, the cleanup checked only the fresh
   * name itself, not the directories above it. With the claims root swapped
   * at the claim-aside hold for a link to a directory holding the same fresh
   * name, it emptied that outside directory. */
  {
    const d = fixture('edge-isymrace-leftover-root');
    const root = p(d, '.nanojira/claims');
    fs.mkdirSync(path.join(root, '.nj-rm-555-eeee'));
    fs.writeFileSync(path.join(root, '.nj-rm-555-eeee', '1'), 'claimed\nghost\n' + NOW + '\n');
    fs.mkdirSync(outside(d, 'croot'));
    let fresh = '';
    const { held, r } = await heldRun(d, 'isymrace-leftover-root', ['doctor', '--fix'], () => {
      fresh = fs.readdirSync(root).find((n) => n.startsWith('.nj-rm-') && n !== '.nj-rm-555-eeee') || '';
      if (fresh === '') return;
      fs.mkdirSync(outside(d, 'croot/' + fresh));
      fs.writeFileSync(outside(d, 'croot/' + fresh + '/1'), 'decoy\n');
      fs.renameSync(root, path.join(d, 'claims-real'));
      fs.symlinkSync(outside(d, 'croot'), root);
    }, 'claim-aside');
    T.check('R4 root swap: doctor --fix reached the claim-aside hold', held && fresh !== '', H.describeRun(r));
    T.check('R4 root swap: doctor --fix — ran to the end', r.json !== null, H.describeRun(r));
    let left: string[] = [];
    try { left = fs.readdirSync(outside(d, 'croot/' + fresh)); } catch { /* removed */ }
    T.eq('R4 root swap: nothing outside was deleted', left, ['1']);
    // The note names where the aside now is, and the link as the reason.
    const notes: string[] = (r.json && r.json.notes) || [];
    const note = notes.find((n) => n.includes('.nj-rm-')) || '';
    T.check('R4 root swap: the note names the fresh aside name', fresh !== '' && note.includes('.nanojira/claims/' + fresh), JSON.stringify(notes));
    T.check('R4 root swap: the note gives the link as the reason, not the contents',
      /symlink/.test(note) && !/something other than claim entries/.test(note), JSON.stringify(notes));
  }

  T.finish();
})();
