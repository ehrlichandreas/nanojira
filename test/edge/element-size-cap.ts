/* Edge — nanojira never writes an element file it would refuse to read
 * (§ 7 `file:unreadable`, § 9 `refused:too_large`, DECISIONS 215).
 *
 * An element file above 1 MiB is read as a `file:unreadable` stub. Before
 * this, writes had no matching limit (ImprovementScout, "cap symmetry"): a
 * 1.1 MB note returned ok:true and wrote a 1,100,180-byte element, after
 * which `set` was `refused:unreadable` — the user locked themselves out of
 * the element with a normal command. Now every write that would produce an
 * element file larger than the read cap is refused before anything is
 * written, and a write that stays at or below it goes through.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;
const CAP = 1024 * 1024;
const p = (d: string, rel: string) => path.join(d, 'backlog', rel);

function fixture(label: string, files: Record<string, string> = {}): string {
  return H.mkBacklog({
    label,
    files: Object.assign({
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'todo', created: NOW, updated: NOW }, '# E1\n\n## Description\nD\n'),
    }, files),
    tombstones: ['EPIC-001', 'TSK-001'],
  });
}

/** Byte-level snapshot of the backlog. */
function snapshot(d: string): string {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, n);
      const r = rel === '' ? n : rel + '/' + n;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) { out[r + '/'] = 'dir'; walk(full, r); }
      else out[r] = H.sha256(fs.readFileSync(full));
    }
  };
  walk(p(d, '.'), '');
  return JSON.stringify(out);
}

function refusesTooLarge(desc: string, r: H.JsonRunResult) {
  T.exit(desc + ' — exits 1', r, 1);
  T.eq(desc + ' — refused:too_large', r.json && r.json.error, 'refused:too_large');
  T.contains(desc + ' — the error names the cap', r.stderr, '1 MiB');
}

const big = (n: number) => 'x'.repeat(n) + '\n';

/* ---- note / set / new with a value that would pass the cap -------------- */
{
  const d = fixture('edge-cap-writes');
  const bigFile = path.join(d, 'big.txt');
  fs.writeFileSync(bigFile, big(1100 * 1000));
  const before = snapshot(d);

  refusesTooLarge('note --text-file=<1.1 MB>', H.runJson(['note', '--id=EPIC-001', '--as=alice', '--text-file=' + bigFile], { cwd: d }));
  T.eq('note — nothing written', snapshot(d), before);
  refusesTooLarge('set --description-file=<1.1 MB>', H.runJson(['set', '--id=EPIC-001', '--description-file=' + bigFile], { cwd: d }));
  T.eq('set — nothing written', snapshot(d), before);
  refusesTooLarge('new --description-file=<1.1 MB>', H.runJson(['new', '--type=epic', '--title=Big', '--description-file=' + bigFile], { cwd: d }));
  T.eq('new — nothing written, no tombstone burned', snapshot(d), before);
  const plan = JSON.stringify([{ type: 'epic', title: 'Small' }, { type: 'epic', title: 'Big', description: big(1100 * 1000) }]);
  const planR = H.runJson(['new', '--input=-'], { cwd: d, input: plan });
  T.exit('new --input=<plan with a 1.1 MB description> — exits 1', planR, 1);
  T.contains('new --input=<plan> — refused:too_large', planR.stdout, 'refused:too_large');
  T.eq('new --input=<plan> — nothing written, not even the small node', snapshot(d), before);

  /* the element is still writable afterwards */
  T.exit('set --title afterwards — succeeds', H.runJson(['set', '--id=EPIC-001', '--title=Still mine'], { cwd: d }), 0);
}

/* ---- non-vacuity: a write that ends just below the cap goes through ----- */
{
  const d = fixture('edge-cap-below');
  const textFile = path.join(d, 'text.txt');
  fs.writeFileSync(textFile, big(CAP - 4096));
  const r = H.runJson(['note', '--id=EPIC-001', '--as=alice', '--text-file=' + textFile], { cwd: d });
  T.exit('note ending just below 1 MiB — succeeds', r, 0);
  const size = fs.statSync(p(d, 'epics/EPIC-001.md')).size;
  T.check('note ending just below 1 MiB — the file really is near the cap', size > CAP - 8192 && size <= CAP, String(size));
  T.exit('set --title on the near-cap element — still readable and writable', H.runJson(['set', '--id=EPIC-001', '--title=Still mine'], { cwd: d }), 0);
}

/* ---- tool-made writes on an element already at the cap ------------------ */
{
  /* a done epic whose file is CAP - 5 bytes: archive adds `archived:` */
  const head = H.element({ id: 'EPIC-002', type: 'epic', title: 'Full', status: 'done', created: NOW, updated: NOW }, '# Full\n\n## Description\n');
  const full = head + 'x'.repeat(CAP - 5 - Buffer.byteLength(head) - 1) + '\n';
  const d = fixture('edge-cap-archive', { 'epics/EPIC-002.md': full });
  fs.appendFileSync(p(d, H.IDS_REL + '/EPIC-002'), '');
  H.writeStatus(p(d, '.'));
  T.eq('fixture: EPIC-002 is CAP - 5 bytes', fs.statSync(p(d, 'epics/EPIC-002.md')).size, CAP - 5);
  const before = snapshot(d);
  refusesTooLarge('archive of an element at the cap', H.runJson(['archive', '--id=EPIC-002'], { cwd: d }));
  T.eq('archive of an element at the cap — nothing moved or written', snapshot(d), before);
  refusesTooLarge('claim of an element at the cap', H.runJson(['claim', '--id=EPIC-002', '--as=alice'], { cwd: d }));
  T.eq('claim of an element at the cap — nothing written', snapshot(d), before);
}
{
  /* an element without `updated`, at the cap: doctor --fix step 5 would add it */
  const head = H.element({ id: 'EPIC-002', type: 'epic', title: 'Full', status: 'todo', created: NOW }, '# Full\n\n## Description\n');
  const full = head + 'x'.repeat(CAP - 5 - Buffer.byteLength(head) - 1) + '\n';
  const d = fixture('edge-cap-doctor', { 'epics/EPIC-002.md': full });
  fs.appendFileSync(p(d, H.IDS_REL + '/EPIC-002'), '');
  const fileBefore = H.sha256(fs.readFileSync(p(d, 'epics/EPIC-002.md')));
  const r = H.runJson(['doctor', '--fix'], { cwd: d });
  T.check('doctor --fix with an element at the cap — ran to the end', r.json !== null, H.describeRun(r));
  T.eq('doctor --fix — the element at the cap is not rewritten', H.sha256(fs.readFileSync(p(d, 'epics/EPIC-002.md'))), fileBefore);
  T.check('doctor --fix — a note says why', !!r.json && (r.json.notes || []).some((n: string) => n.includes('EPIC-002') && n.includes('1 MiB')),
    JSON.stringify(r.json && r.json.notes).slice(0, 400));
}

/* ---- batch writes: refused:too_large is a per-ID preflight refusal ------ */
{
  /* EPIC-002 has no `updated` and sits at CAP - 5 bytes: any write adds the
   * field and crosses the cap. EPIC-001 comes first in every batch, so a
   * refusal found only in the write phase would already have written it. */
  const head = H.element({ id: 'EPIC-002', type: 'epic', title: 'Full', status: 'todo', created: NOW }, '# Full\n\n## Description\n- [ ] a\n');
  const full = head + 'x'.repeat(CAP - 5 - Buffer.byteLength(head) - 1) + '\n';
  const d = fixture('edge-cap-batch', {
    'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'todo', created: NOW, updated: NOW }, '# E1\n\n## Description\n- [ ] a\n'),
    'epics/EPIC-002.md': full,
  });
  fs.appendFileSync(p(d, H.IDS_REL + '/EPIC-002'), '');
  H.writeStatus(p(d, '.'));
  T.eq('fixture: EPIC-002 is CAP - 5 bytes', fs.statSync(p(d, 'epics/EPIC-002.md')).size, CAP - 5);
  const before = snapshot(d);
  const batches: [string, string[]][] = [
    ['set', ['set', '--id=EPIC-001,EPIC-002', '--title=' + 'L'.repeat(400)]],
    ['note', ['note', '--id=EPIC-001,EPIC-002', '--as=alice', '--text=hello']],
    ['check', ['check', '--id=EPIC-001,EPIC-002', '--text=a']],
    ['claim', ['claim', '--id=EPIC-001,EPIC-002', '--as=alice']],
  ];
  for (const [verb, args] of batches) {
    const r = H.runJson(args, { cwd: d });
    T.exit('batch ' + verb + ' with EPIC-002 at the cap — exits 1', r, 1);
    const res: any[] = (r.json && r.json.results) || [];
    T.check('batch ' + verb + ' — EPIC-002 refused:too_large in preflight, EPIC-001 not written',
      res.length === 1 && res[0].id === 'EPIC-002' && res[0].error === 'refused:too_large', JSON.stringify(r.json).slice(0, 400));
    T.eq('batch ' + verb + ' — nothing of the batch was written', snapshot(d), before);
  }
}

T.finish();
