/* Edge — the launchers (§ 18, TSK-065, DECISIONS 242).
 *
 * bin/nanojira followed through symlinks: a launcher linked from another
 * directory (say, onto PATH) runs the bundle next to the real launcher,
 * never a dist/ that happens to sit next to the link, and under a link of
 * another name it still runs dist/nanojira.mjs. A symlink loop, or a
 * readlink that cannot run, ends in exit 127 and one stderr line instead of
 * a hang or a guessed directory; that line is printed with printf '%s', so a
 * backslash in a name stays as it is.
 *
 * bin/nanojira.cmd never enables delayed expansion, so cmd.exe keeps every
 * `!` in the arguments and in the install path; and the entry path in its
 * "not found" message is quoted, so ( ) or & in the install path cannot
 * break the block. cmd.exe is not run here: the team has no Windows
 * machine, so the .cmd launcher is checked by its text.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'bin', 'nanojira');
const VERSION = 'nanojira ' + JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function run(file: string, env: Record<string, string> = {}) {
  const r = spawnSync(file, ['--version'], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 15000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const lines = (s: string) => s.split('\n').filter(Boolean);

/** A decoy dist/ beside `dir`'s parent, the place a launcher that does not follow its link would look. */
function decoy(dir: string) {
  fs.mkdirSync(path.join(dir, '..', 'dist'), { recursive: true });
  for (const name of ['nanojira', 'nj']) {
    fs.writeFileSync(path.join(dir, '..', 'dist', name + '.mjs'), "console.log('decoy');\n");
  }
}

/* An absolute link from another directory runs the real bundle. */
{
  const d = H.freshDir('edge-launcher-abs');
  const dir = path.join(d, 'a', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  decoy(dir);
  fs.symlinkSync(BIN, path.join(dir, 'nanojira'));
  const r = run(path.join(dir, 'nanojira'));
  T.eq('absolute link: exits 0', r.status, 0);
  T.eq('absolute link: the real bundle runs, not the decoy', r.stdout.trim(), VERSION);
}

/* A relative chain under another name: c/nj -> ../a/bin/nanojira -> the real launcher. */
{
  const d = H.freshDir('edge-launcher-chain');
  const a = path.join(d, 'a', 'bin');
  const c = path.join(d, 'c', 'bin');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(c, { recursive: true });
  decoy(a);
  decoy(c);
  fs.symlinkSync(BIN, path.join(a, 'nanojira'));
  fs.symlinkSync(path.join('..', '..', 'a', 'bin', 'nanojira'), path.join(c, 'nj'));
  const r = run(path.join(c, 'nj'));
  T.eq('relative chain: exits 0', r.status, 0);
  T.eq('relative chain: the real bundle runs under the real name', r.stdout.trim(), VERSION);
  T.eq('relative chain: nothing on stderr', r.stderr, '');
}

/* A symlink loop ends in 127 with one line, not a hang. */
{
  const d = H.freshDir('edge-launcher-loop');
  // a loop cannot be exec'd, so the real launcher runs sourced, with the looping name as its $0
  // a backslash in the name: dash's echo would read \c as "stop here", printf '%s' prints it as it is
  const p = path.join(d, 'p\\cp');
  fs.symlinkSync(path.join(d, 'q'), p);
  fs.symlinkSync(p, path.join(d, 'q'));
  const g = spawnSync('sh', ['-c', '. "$1"', p, BIN], { encoding: 'utf8', timeout: 15000 });
  T.eq('loop: exits 127', g.status, 127);
  T.eq('loop: one stderr line', lines(g.stderr || '').length, 1);
  T.eq('loop: says too many symlinks, under the name it was called by', g.stderr, 'p\\cp: too many symlinks from ' + p + '\n');
}

/* Without a readlink that runs, the launcher stops rather than guess. */
{
  const d = H.freshDir('edge-launcher-noreadlink');
  const dir = path.join(d, 'a', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  decoy(dir);
  fs.symlinkSync(BIN, path.join(dir, 'nanojira'));
  const empty = path.join(d, 'empty');
  fs.mkdirSync(empty);
  const r = spawnSync('/bin/sh', [path.join(dir, 'nanojira'), '--version'],
    { env: { PATH: empty, NJ_NODE: process.execPath }, encoding: 'utf8', timeout: 15000 });
  T.eq('no readlink: exits 127', r.status, 127);
  T.eq('no readlink: one stderr line', lines(r.stderr || '').length, 1);
  T.check('no readlink: names the link it could not follow', /cannot follow the symlink/.test(r.stderr || '') && (r.stderr || '').includes(path.join(dir, 'nanojira')), r.stderr || '');
  T.check('no readlink: the decoy did not run', !/decoy/.test(r.stdout || ''), r.stdout || '');
}

/* The .cmd launcher, by its text. */
{
  const cmd = fs.readFileSync(path.join(ROOT, 'bin', 'nanojira.cmd'), 'utf8');
  const code = cmd.split('\n').filter((l) => !/^\s*REM\b/i.test(l));
  T.check('.cmd: delayed expansion is disabled', /^setlocal DisableDelayedExpansion$/m.test(cmd), cmd.split('\n').slice(0, 4).join('\n'));
  T.check('.cmd: never enables it', !/EnableDelayedExpansion/i.test(cmd), '');
  T.check('.cmd: no !VAR! expansion in any command line', !code.some((l) => l.includes('!')), code.filter((l) => l.includes('!')).join('\n'));
  T.check('.cmd: the entry path in an echo is quoted', code.filter((l) => /^\s*echo\b/.test(l) && l.includes('%ENTRY%')).every((l) => l.includes('"%ENTRY%"')),
    code.filter((l) => /^\s*echo\b/.test(l)).join('\n'));
  T.check('.cmd: the node line passes the arguments as %*', /^"%NODE_BIN%" "%ENTRY%" %\*$/m.test(cmd), '');
}

T.finish();
