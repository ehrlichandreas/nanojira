/* run-all's run root and leak sweep (SSD guard): one private mkdtemp
 * directory per run, shared by every file, is each file's NJ_TEST_ROOT and
 * TMPDIR; a run that leaves anything in it fails and names what is left;
 * NJ_KEEP=1 (exactly "1", as the harness reads it) turns that into a note.
 *
 * Each case runs a COPY of test/run-all.ts over a throwaway tree of tiny
 * test files, with NJ_TEST_ROOT (the "outer root", where the run root is
 * made) and TMPDIR pointed at private directories of this file's own.
 *
 *   A. a file that removes what it made: exit 0, nothing listed, and no
 *      run root left in the outer root.
 *   B. the children's NJ_TEST_ROOT, TMPDIR, TEMP and TMP are one and the
 *      same `nj-run-XXXXXX` directory inside the outer root, gone
 *      afterwards.
 *   C. files that leave one dir via NJ_TEST_ROOT and one via os.tmpdir():
 *      exit 1 although every file passed, both listed, run root removed.
 *   D. a file that makes and keeps an `nj-*` dir directly in the OUTER
 *      root -- what another agent's run in the same /tmp does: not listed,
 *      exit 0. (The first version of this sweep compared /tmp before and
 *      after; in its full-suite proof 44 of 45 listed dirs were exactly
 *      that kind of false alarm.)
 *   E. C under NJ_KEEP=1: exit 0, both listed as kept, the run root stays.
 *   F. C with --jobs=1 (the serial path): exit 1, both listed.
 *   G. C under NJ_KEEP=0: still a failure, like C -- only "1" keeps.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const RUN_ALL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'run-all.ts');

const FILES: Record<string, string> = {
  'a-clean.ts':
    "import fs from 'fs'; import os from 'os'; import path from 'path';\n" +
    "fs.rmSync(fs.mkdtempSync(path.join(process.env.NJ_TEST_ROOT as string, 'nj-clean-')), { recursive: true });\n" +
    "fs.rmSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nj-dry-run-')), { recursive: true });\n" +
    "console.log('PASS a-clean.ts (1 checks)');\n",
  'b-env.ts':
    "import os from 'os';\n" +
    "console.log('PASS b-env.ts (1 checks)');\n" +
    "console.log('ENV ' + JSON.stringify({ root: process.env.NJ_TEST_ROOT, tmpdir: os.tmpdir(), temp: process.env.TEMP, tmp: process.env.TMP }));\n",
  'c-leak-root.ts':
    "import fs from 'fs'; import path from 'path';\n" +
    "fs.mkdtempSync(path.join(process.env.NJ_TEST_ROOT as string, 'nj-leaky-'));\n" +
    "console.log('PASS c-leak-root.ts (1 checks)');\n",
  'c-leak-tmpdir.ts':
    "import fs from 'fs'; import os from 'os'; import path from 'path';\n" +
    "fs.mkdtempSync(path.join(os.tmpdir(), 'nj-dry-run-'));\n" +
    "console.log('PASS c-leak-tmpdir.ts (1 checks)');\n",
  'd-foreign.ts':
    "import fs from 'fs'; import path from 'path';\n" +
    "fs.mkdtempSync(path.join(process.env.LEAK_TEST_OUTER as string, 'nj-someone-else-'));\n" +
    "console.log('PASS d-foreign.ts (1 checks)');\n",
};

interface Case { status: number | null; out: string; outer: string; listed: string[] }

function runCase(label: string, files: string[], env: Record<string, string>, args: string[]): Case {
  const base = H.freshDir('leak-sweep-' + label);
  fs.mkdirSync(path.join(base, 'test', 'ac'), { recursive: true });
  fs.copyFileSync(RUN_ALL, path.join(base, 'test', 'run-all.ts'));
  for (const f of files) fs.writeFileSync(path.join(base, 'test', 'ac', f), FILES[f]);
  const outer = path.join(base, 'outer'), tmp = path.join(base, 'tmp');
  fs.mkdirSync(outer); fs.mkdirSync(tmp);
  const e: Record<string, string | undefined> = Object.assign({}, process.env,
    { NJ_TEST_ROOT: outer, TMPDIR: tmp, LEAK_TEST_OUTER: outer }, env);
  if (!('NJ_KEEP' in env)) delete e.NJ_KEEP;
  delete e.NJ_TEST_TIMES; delete e.NJ_TEST_JOBS;
  const r = spawnSync(process.execPath, [path.join(base, 'test', 'run-all.ts'), ...args, 'unused-nj'],
    { cwd: base, env: e, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const at = lines.findIndex((l) => /^(leaked|kept) /.test(l));
  const listed: string[] = [];
  for (const l of at >= 0 ? lines.slice(at + 1) : []) { if (!l.startsWith('  ')) break; listed.push(l.trim().replace(/[A-Za-z0-9]{6}$/, 'XXXXXX')); }
  return { status: r.status, out, outer, listed };
}
const tail = (c: Case) => ('exit ' + c.status + '\n' + c.out).split('\n').slice(-16).join('\n');
const runRoots = (c: Case) => fs.readdirSync(c.outer).filter((n) => /^nj-run-[A-Za-z0-9]{6}$/.test(n));
const LEAKERS = ['a-clean.ts', 'c-leak-root.ts', 'c-leak-tmpdir.ts'];
const TWO = ['nj-dry-run-XXXXXX', 'nj-leaky-XXXXXX'];

/* ---- A: nothing left behind ----------------------------------------------- */
{
  const c = runCase('a', ['a-clean.ts'], {}, ['--jobs=2']);
  T.check('A: a run that leaves nothing behind exits 0', c.status === 0, tail(c));
  T.check('A: and lists nothing', !/^(leaked|kept) /m.test(c.out), tail(c));
  T.eq('A: and its run root is gone', runRoots(c), []);
}

/* ---- B: what the children see ---------------------------------------------- */
{
  const c = runCase('b', ['b-env.ts'], {}, ['--jobs=2']);
  const m = /^ENV (.*)$/m.exec(c.out);
  const seen = m ? JSON.parse(m[1]) : {};
  T.check('B: the child reported its environment', !!m, tail(c));
  T.eq('B: NJ_TEST_ROOT and os.tmpdir() are the same directory', seen.tmpdir, seen.root);
  T.eq('B: so are TEMP and TMP (os.tmpdir() on Windows), on every platform', [seen.temp, seen.tmp], [seen.root, seen.root]);
  T.check('B: an nj-run-XXXXXX directory directly inside the outer root',
    typeof seen.root === 'string' && path.dirname(seen.root) === fs.realpathSync(c.outer) && /^nj-run-[A-Za-z0-9]{6}$/.test(path.basename(seen.root)), String(seen.root));
  T.check('B: removed once the run is over', typeof seen.root === 'string' && !fs.existsSync(seen.root), String(seen.root));
}

/* ---- C: two leaks ---------------------------------------------------------- */
{
  const c = runCase('c', LEAKERS, {}, ['--jobs=2']);
  T.check('C: every file passed (the failure is the leak alone)', /^passed\s+3 \/ 3$/m.test(c.out), tail(c));
  T.check('C: a run that leaves entries in its run root exits 1', c.status === 1, tail(c));
  T.check('C: the header names the count', /^leaked 2 entries this run left in its run root \(now removed\):$/m.test(c.out), tail(c));
  T.eq('C: both are listed, the NJ_TEST_ROOT one and the os.tmpdir() one', c.listed, TWO);
  T.eq('C: the run root is removed all the same', runRoots(c), []);
}

/* ---- D: someone else's directory next to the run root --------------------- */
{
  const c = runCase('d', ['a-clean.ts', 'd-foreign.ts'], {}, ['--jobs=2']);
  T.check('D: a dir made and kept in the outer root during the run is no failure', c.status === 0, tail(c));
  T.check('D: and is not listed', !/^(leaked|kept) /m.test(c.out), tail(c));
  T.eq('D: it is still there, untouched',
    fs.readdirSync(c.outer).map((n) => n.replace(/[A-Za-z0-9]{6}$/, 'XXXXXX')), ['nj-someone-else-XXXXXX']);
}

/* ---- E: NJ_KEEP=1 ---------------------------------------------------------- */
{
  const c = runCase('e', LEAKERS, { NJ_KEEP: '1' }, ['--jobs=2']);
  T.check('E: under NJ_KEEP=1 the same run exits 0', c.status === 0, tail(c));
  T.check('E: and names the kept run root', /^kept \(NJ_KEEP=1, not a failure\) 2 entries in .*\/nj-run-[A-Za-z0-9]{6}:$/m.test(c.out), tail(c));
  T.eq('E: the same two entries', c.listed, TWO);
  const roots = runRoots(c);
  T.check('E: the run root stays, with both in it',
    roots.length === 1 && fs.readdirSync(path.join(c.outer, roots[0])).length === 2, roots.join(', '));
}

/* ---- F: the serial path ---------------------------------------------------- */
{
  const c = runCase('f', LEAKERS, {}, ['--jobs=1']);
  T.check('F: --jobs=1 exits 1 on the same leaks', c.status === 1, tail(c));
  T.eq('F: the same two entries', c.listed, TWO);
}

/* ---- G: NJ_KEEP set, but not to "1" -------------------------------------- */
{
  const c = runCase('g', LEAKERS, { NJ_KEEP: '0' }, ['--jobs=2']);
  T.check('G: under NJ_KEEP=0 the same run still exits 1', c.status === 1, tail(c));
  T.check('G: and lists them as leaked, not kept', /^leaked 2 entries this run left in its run root \(now removed\):$/m.test(c.out), tail(c));
  T.eq('G: the same two entries', c.listed, TWO);
  T.eq('G: the run root is removed', runRoots(c), []);
}

T.finish();
