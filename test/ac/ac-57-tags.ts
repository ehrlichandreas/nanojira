/* AC-57 — Tag vocabulary: `TAGS.md`, `nanojira tags`, the near-match
 * warning, and `layout.tagsFile` (DECISIONS: mirrors STATUS.md's own
 * "regenerated artifact, never incrementally patched" mechanism, applied to
 * `tags` instead of `status` — a fully-regenerated file can never drift from
 * the element files the way an append-only log of tags-ever-seen could).
 *
 * Scope:
 *  A. `TAGS.md` is rewritten after a write that introduces tags; its content
 *     matches a hand-computed rendering (sorted names, carrier counts).
 *  B. `nanojira tags` / `nanojira tags --json` mirror the same data, work
 *     the same with `layout.tagsFile: false` (same as `list`/bare `nanojira`
 *     not depending on STATUS.md).
 *  C. Doctor staleness: a hand-edited/deleted TAGS.md, or a tag added to an
 *     element file by hand (bypassing `refreshTags` entirely) is
 *     `backlog:tags_stale` (warning, exit 0); `doctor --fix` regenerates it.
 *  D. `layout.tagsFile: false` — never created, never checked, left alone
 *     (an existing one is not deleted either).
 *  E. `layout.tagsFile` config validation: must be boolean; unknown-key
 *     warning when misspelled.
 *  F. The near-match warning on `new --tags=` / `set --tags=`/`--add-tags=`:
 *     non-blocking (stderr only, exit 0, never in --json), fires only for a
 *     genuinely new, close-looking spelling of an existing tag; silent for
 *     an exact match, an unrelated new tag, or a tag already known to the
 *     whole backlog.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
import type { RunOpts, RunResult, JsonRunResult } from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;

function J(x: unknown): string { return JSON.stringify(x === undefined ? null : x); }
function ok(r: RunResult, what: string): RunResult {
  if (r.missing || r.status !== 0) T.check('fixture: ' + what, false, r.status + ' ' + J(r.stderr));
  return r;
}

interface Fixture { dir: string; bl: string }

function initBacklog(label: string): Fixture {
  const dir = H.freshDir(label);
  ok(H.runNj(['init'], { cwd: dir, unsetEnv: ['NJ_BACKLOG'] }), 'nj init');
  return { dir, bl: path.join(dir, 'backlog') };
}

function run(args: string[], fx: Fixture, extra?: RunOpts): RunResult {
  return H.runNj(args, Object.assign({ cwd: fx.dir, unsetEnv: ['NJ_BACKLOG'] }, extra || {}));
}
function runJ(args: string[], fx: Fixture, extra?: RunOpts): JsonRunResult {
  return H.runJson(args, Object.assign({ cwd: fx.dir, unsetEnv: ['NJ_BACKLOG'] }, extra || {}));
}

const tagsPath = (fx: Fixture): string => path.join(fx.bl, 'TAGS.md');
const readTags = (fx: Fixture): string | null => H.readOrNull(tagsPath(fx));

/** The same rendering rule tags.ts uses: sorted names, one line each. */
function expectedTagsMd(counts: Record<string, number>): string {
  const names = Object.keys(counts).sort();
  const body = names.length > 0 ? names.map((n) => `- \`${n}\` (${counts[n]})`).join('\n') : '(no tags in use)';
  return `# Tags\n\n${body}\n`;
}

function doctorSet(r: JsonRunResult): string[] | null { return H.doctorSet(r); }

/* ===================================================================== */
/* A — TAGS.md is written after a write that introduces tags              */
/* ===================================================================== */
{
  const fx = initBacklog('ac57-a');
  T.eq('A1 after init, TAGS.md says no tags in use', readTags(fx), expectedTagsMd({}));

  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=backend,bug'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  T.eq('A2 after new with tags, TAGS.md lists both, count 1 each', readTags(fx), expectedTagsMd({ backend: 1, bug: 1 }));

  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x', '--tags=bug,urgent'], fx, { env: { NJ_NOW: NOW } }), 'new task');
  T.eq('A3 after a second element reusing "bug", its count is 2', readTags(fx), expectedTagsMd({ backend: 1, bug: 2, urgent: 1 }));

  ok(run(['set', '--id=EPIC-001', '--remove-tags=backend'], fx), 'remove backend');
  T.eq('A4 removing the only carrier of a tag drops it from TAGS.md entirely', readTags(fx), expectedTagsMd({ bug: 2, urgent: 1 }));

  const doc = runJ(['doctor'], fx);
  T.exit('A5 doctor after a sequence of tag-touching writes: exit 0', doc, 0);
  T.eq('A5 doctor reports no staleness — TAGS.md tracked every write', doctorSet(doc), []);
}

/* ===================================================================== */
/* B — `nanojira tags` / `--json`, independent of `layout.tagsFile`       */
/* ===================================================================== */
{
  const fx = initBacklog('ac57-b');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=zeta,alpha'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T', '--description=D.', '--acceptance=- [x] x', '--tags=alpha'], fx, { env: { NJ_NOW: NOW } }), 'new task');

  const human = run(['tags'], fx);
  T.exit('B1 nanojira tags: exit 0', human, 0);
  T.eq('B1 human output: sorted, one line per tag with its count', human.stdout, 'alpha (2)\nzeta (1)\n');

  const j = runJ(['tags'], fx);
  T.exit('B2 nanojira tags --json: exit 0', j, 0);
  T.eq('B2 --json shape, sorted by name', j.json, { ok: true, tags: [{ name: 'alpha', count: 2 }, { name: 'zeta', count: 1 }] });

  const bad = run(['tags', '--bogus=1'], fx);
  T.exit('B3 nanojira tags --bogus=1: exit 1 (unknown field)', bad, 1);
  T.contains('B3 stderr names the unknown field', bad.stderr, 'unknown field');
}

{
  // layout.tagsFile: false — `nanojira tags` still answers correctly; only
  // the generated file and its doctor check are affected (mirrors
  // layout.statusFile: false not touching `nanojira list`/bare `nanojira`).
  const fx = initBacklog('ac57-b-off');
  const cfgPath = path.join(fx.bl, '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.layout.tagsFile = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.rmSync(tagsPath(fx), { force: true });

  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=solo'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  T.check('B4 layout.tagsFile:false: TAGS.md is never created', readTags(fx) === null, J(readTags(fx)));

  const j = runJ(['tags'], fx);
  T.eq('B5 layout.tagsFile:false: nanojira tags --json still answers from the elements', j.json, { ok: true, tags: [{ name: 'solo', count: 1 }] });

  const doc = runJ(['doctor'], fx);
  T.eq('B6 layout.tagsFile:false: doctor never checks a missing TAGS.md', doctorSet(doc), []);
}

/* ===================================================================== */
/* C — doctor staleness + --fix regeneration, mutation-tested below       */
/* ===================================================================== */
{
  const fx = initBacklog('ac57-c-hand-edit');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=a,b'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  const fresh = readTags(fx) as string;

  fs.appendFileSync(tagsPath(fx), '- `ghost` (99)\n');
  const doc1 = runJ(['doctor'], fx);
  T.exit('C1 hand-edited TAGS.md: doctor exit 0 (a warning)', doc1, 0);
  T.sameSet('C1 doctor reports exactly backlog:tags_stale', doctorSet(doc1) || ['<none>'], ['backlog:tags_stale:warning']);
  const finding = (doc1.json.problems as any[]).find((p) => p.code === 'backlog:tags_stale');
  T.check('C1 backlog:tags_stale is backlog-level (no element)', !!finding && !finding.element, J(finding));

  const fix1 = runJ(['doctor', '--fix'], fx);
  T.exit('C2 doctor --fix: exit 0', fix1, 0);
  T.eq('C2 doctor --fix restores TAGS.md byte-identically', readTags(fx), fresh);
  T.check('C2 fixed[] names TAGS.md', (fix1.json.fixed as string[]).some((s) => s.includes('TAGS.md')), J(fix1.json.fixed));
  T.eq('C2 doctor afterwards is clean', doctorSet(runJ(['doctor'], fx)), []);
}

{
  const fx = initBacklog('ac57-c-deleted');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=a'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  const fresh = readTags(fx) as string;
  fs.rmSync(tagsPath(fx), { force: true });
  T.sameSet('C3 deleted TAGS.md: doctor reports exactly backlog:tags_stale',
    doctorSet(runJ(['doctor'], fx)) || ['<none>'], ['backlog:tags_stale:warning']);
  runJ(['doctor', '--fix'], fx);
  T.eq('C3 doctor --fix recreates it byte-identically', readTags(fx), fresh);
}

{
  // The mutation case Lead's task asked for by name: a tag added to an
  // element file BY HAND (never through refreshTags at all) must still be
  // caught — proving the staleness check compares against the real
  // elements, not merely "does TAGS.md parse."
  const fx = initBacklog('ac57-c-mutation');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=a'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  T.eq('C4 fixture: TAGS.md fresh before the hand edit', doctorSet(runJ(['doctor'], fx)), []);

  const elPath = path.join(fx.bl, 'epics', 'EPIC-001.md');
  const raw = fs.readFileSync(elPath, 'utf8');
  T.check('C4 fixture: the element file has a tags: line to mutate', /^tags:/m.test(raw), raw);
  fs.writeFileSync(elPath, raw.replace(/^tags:.*$/m, 'tags: [a, smuggled]'));

  const doc = runJ(['doctor'], fx);
  T.check('C4 a tag added by hand (bypassing refreshTags) makes TAGS.md stale',
    (doctorSet(doc) || []).includes('backlog:tags_stale:warning'), J(doctorSet(doc)));
  const fix = runJ(['doctor', '--fix'], fx);
  T.exit('C4 doctor --fix: exit 0', fix, 0);
  T.eq('C4 doctor --fix regenerates TAGS.md to include the smuggled tag', readTags(fx), expectedTagsMd({ a: 1, smuggled: 1 }));
}

/* ===================================================================== */
/* D — layout.tagsFile: false — never created, never checked, left alone  */
/* ===================================================================== */
{
  const fx = initBacklog('ac57-d-existing');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=a'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  const junk = 'hand-written, not an overview\n';
  fs.writeFileSync(tagsPath(fx), junk);
  const cfgPath = path.join(fx.bl, '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.layout.tagsFile = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  ok(run(['set', '--id=EPIC-001', '--add-tags=b'], fx), 'set --add-tags');
  T.eq('D1 layout.tagsFile:false: an existing (even stale) TAGS.md is left alone', readTags(fx), junk);
  T.eq('D1 doctor does not check an existing, stale TAGS.md when tagsFile is off', doctorSet(runJ(['doctor'], fx)), []);
  runJ(['doctor', '--fix'], fx);
  T.eq('D1 doctor --fix does not touch it either', readTags(fx), junk);
}

/* ===================================================================== */
/* E — layout.tagsFile config validation                                  */
/* ===================================================================== */
{
  const fx = initBacklog('ac57-e-bad-value');
  const cfgPath = path.join(fx.bl, '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.layout.tagsFile = 'yes';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const r = run(['list'], fx);
  T.exit('E1 layout.tagsFile: "yes" (not boolean): every command but doctor fails', r, 1);
  const doc = runJ(['doctor'], fx);
  T.check('E1 doctor reports config:invalid naming tagsFile',
    (doctorSet(doc) || []).some((s) => s.startsWith('config:invalid:')) &&
    (doc.json.problems as any[]).some((p: any) => p.code === 'config:invalid' && /tagsFile/.test(p.message)),
    J(doc.json && doc.json.problems));
}
{
  const fx = initBacklog('ac57-e-unknown-key');
  const cfgPath = path.join(fx.bl, '.nanojira', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg.layout.tagsFile;
  cfg.layout.tagsFil = true; // typo
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const doc = runJ(['doctor'], fx);
  T.exit('E2 a misspelled layout key: exit 0 (a warning, not fatal)', doc, 0);
  T.check('E2 doctor reports config:unknown_key for the typo',
    (doctorSet(doc) || []).includes('config:unknown_key:warning'), J(doctorSet(doc)));
}

/* ===================================================================== */
/* F — the near-match warning: non-blocking, stderr-only, never in --json */
/* ===================================================================== */

const WARN_RE = /^Warning: tag '([^']+)' looks like it might be a drifted spelling of existing tag '([^']+)'/m;

{
  const fx = initBacklog('ac57-f-new');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=backend'], fx, { env: { NJ_NOW: NOW } }), 'new epic with backend');

  const near = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] x', '--tags=back-end'], fx);
  T.exit('F1 a near-miss spelling ("back-end" vs "backend"): exit 0, the write still happens', near, 0);
  T.eq('F1 the tag is written exactly as given, never silently corrected', near.json.entry.tags, ['back-end']);
  T.check('F1 a non-blocking warning names both spellings, on stderr', WARN_RE.test(near.stderr), J(near.stderr));
  const m1 = WARN_RE.exec(near.stderr) as RegExpExecArray;
  T.eq('F1 warning names the new tag and the existing one it resembles', [m1[1], m1[2]], ['back-end', 'backend']);
  T.check('F1 the warning is on stderr, not mixed into the --json stream', !WARN_RE.test(near.stdout), J(near.stdout).slice(0, 200));

  const caseVariant = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] x', '--tags=Backend'], fx);
  T.exit('F2 a case-only variant ("Backend" vs "backend"): exit 0', caseVariant, 0);
  T.check('F2 case-only drift still warns (case-insensitive compare)', WARN_RE.test(caseVariant.stderr), J(caseVariant.stderr));

  const exact = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T3', '--description=D.', '--acceptance=- [x] x', '--tags=backend'], fx);
  T.exit('F3 reusing the exact existing spelling: exit 0', exact, 0);
  T.check('F3 an exact, already-known tag never warns', !WARN_RE.test(exact.stderr), J(exact.stderr));

  const unrelated = runJ(['new', '--type=task', '--parent=EPIC-001', '--title=T4', '--description=D.', '--acceptance=- [x] x', '--tags=frontend'], fx);
  T.exit('F4 an unrelated brand-new tag: exit 0', unrelated, 0);
  T.check('F4 a tag that does not resemble anything existing never warns', !WARN_RE.test(unrelated.stderr), J(unrelated.stderr));
}

{
  // set --add-tags / --tags= trigger the same check. Each case gets its own
  // fresh element so the backlog's known-tag vocabulary stays exactly one
  // tag ("urgent") per case — unambiguous, no hand-computed edit distances
  // against accumulated state from an earlier case in this block.
  const fx = initBacklog('ac57-f-set');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=urgent'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T1', '--description=D.', '--acceptance=- [x] x'], fx, { env: { NJ_NOW: NOW } }), 'new TSK-001, no tags');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T2', '--description=D.', '--acceptance=- [x] x'], fx, { env: { NJ_NOW: NOW } }), 'new TSK-002, no tags');
  ok(run(['new', '--type=task', '--parent=EPIC-001', '--title=T3', '--description=D.', '--acceptance=- [x] x'], fx, { env: { NJ_NOW: NOW } }), 'new TSK-003, no tags');

  const addNear = runJ(['set', '--id=TSK-001', '--add-tags=urgend'], fx);
  T.exit('F5 set --add-tags with a near-miss: exit 0', addNear, 0);
  T.check('F5 warns on stderr', WARN_RE.test(addNear.stderr), J(addNear.stderr));

  const addExact = runJ(['set', '--id=TSK-002', '--add-tags=urgent'], fx);
  T.exit('F6 set --add-tags with the exact existing tag: exit 0', addExact, 0);
  T.check('F6 no warning for an exact match', !WARN_RE.test(addExact.stderr), J(addExact.stderr));

  const directNear = runJ(['set', '--id=TSK-003', '--tags=zzz,urgnt'], fx);
  T.exit('F7 set --tags= introducing a near-miss alongside an unrelated tag: exit 0', directNear, 0);
  T.check('F7 warns for the near-miss', WARN_RE.test(directNear.stderr), J(directNear.stderr));
  T.check('F7 does not warn for the unrelated tag (only one Warning line)',
    (directNear.stderr.match(/^Warning:/gm) || []).length === 1, J(directNear.stderr));
}

{
  // A no-op write (nothing in `changed`) must never warn — nothing was
  // actually introduced.
  const fx = initBacklog('ac57-f-noop');
  ok(run(['new', '--type=epic', '--title=E', '--description=D.', '--tags=alpha'], fx, { env: { NJ_NOW: NOW } }), 'new epic');
  const noop = runJ(['set', '--id=EPIC-001', '--add-tags=alpha'], fx);
  T.exit('F8 re-adding an already-present tag (a no-op): exit 0', noop, 0);
  T.check('F8 "tags" not reported as changed', !(noop.json.changed || []).includes('tags'), J(noop.json));
  T.check('F8 no warning for a no-op write', !WARN_RE.test(noop.stderr), J(noop.stderr));
}

T.finish();
