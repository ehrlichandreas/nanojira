/* Edge — no file nanojira reads can hang it or grow without bound (§ 7
 * `file:unreadable`, DECISIONS 215).
 *
 * `id-path-escape.ts` covers element files. The same hazard sat in six more
 * reads (ImprovementScout, attack script N1): a FIFO at STATUS.md, TAGS.md,
 * `.nanojira/config.json`, a claim entry, README.md or .gitignore blocked
 * the open forever. Every one of them now goes through the same reader:
 * opened non-blocking, regular files only, a cap per kind of file. Each
 * caller keeps its own answer for a file it cannot read: STATUS.md and
 * TAGS.md count as stale and are rewritten, the configuration is
 * `invalid_config`, a claim entry is skipped, README.md and .gitignore are
 * left alone.
 *
 * Every run here carries a 20 s timeout: a hang is a failure, not a stuck
 * suite.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as H from '../lib/harness.ts';
const T = H.T;

const NOW = H.FIXED_NOW;
const p = (d: string, rel: string) => path.join(d, 'backlog', rel);
const RUN = { timeout: 20000 };

function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({ id: 'EPIC-001', type: 'epic', title: 'E1', status: 'todo', created: NOW, updated: NOW }, '# E1\n\n## Description\nD\n'),
    },
    tombstones: ['EPIC-001'],
  });
}

function mkfifo(file: string): boolean {
  fs.rmSync(file, { force: true });
  const r = spawnSync('mkfifo', [file]);
  return r.status === 0;
}

function returned(desc: string, r: H.JsonRunResult): boolean {
  return T.check(desc + ' — returns instead of hanging', r.status !== null, H.describeRun(r));
}

const haveMkfifo = process.platform !== 'win32';

if (!haveMkfifo) {
  T.notCovered('non-regular reads', 'mkfifo is not available here');
} else {
  /* ---- STATUS.md / TAGS.md: a FIFO is stale, and is replaced ------------ */
  for (const name of ['STATUS.md', 'TAGS.md']) {
    const d = fixture('edge-nonreg-' + name.toLowerCase().replace('.', '-'));
    if (!mkfifo(p(d, name))) { T.notCovered(name + ' as a FIFO', 'mkfifo failed'); continue; }
    const r = H.runJson(['set', '--id=EPIC-001', '--title=Renamed'], Object.assign({ cwd: d }, RUN));
    if (returned(name + ' as a FIFO, set --title', r)) {
      T.exit(name + ' as a FIFO, set --title — succeeds', r, 0);
      T.check(name + ' as a FIFO — rewritten as a regular file', fs.lstatSync(p(d, name)).isFile(), '');
    }
    if (!mkfifo(p(d, name))) continue;
    const doc = H.runJson(['doctor'], Object.assign({ cwd: d }, RUN));
    if (returned(name + ' as a FIFO, doctor', doc)) {
      const code = name === 'STATUS.md' ? 'backlog:status_stale' : 'backlog:tags_stale';
      T.check(name + ' as a FIFO, doctor — reported as ' + code,
        ((doc.json && doc.json.problems) || []).some((x: any) => x.code === code), JSON.stringify(doc.json && doc.json.problems).slice(0, 400));
    }
  }

  /* ---- the configuration: invalid_config, never a hang ------------------ */
  {
    const d = fixture('edge-nonreg-config');
    if (mkfifo(p(d, H.CONFIG_REL))) {
      const r = H.runJson(['set', '--id=EPIC-001', '--title=Renamed'], Object.assign({ cwd: d }, RUN));
      if (returned('config.json as a FIFO, set --title', r)) {
        T.eq('config.json as a FIFO — invalid_config', r.json && r.json.error, 'invalid_config');
        T.contains('config.json as a FIFO — the message says why', r.stderr, 'not a regular file');
      }
    }
    const d2 = fixture('edge-nonreg-config-big');
    fs.writeFileSync(p(d2, H.CONFIG_REL), H.DEFAULT_CONFIG);
    fs.truncateSync(p(d2, H.CONFIG_REL), 1024 * 1024 + 1);
    const r2 = H.runJson(['list'], Object.assign({ cwd: d2 }, RUN));
    if (returned('config.json of 1 MiB + 1 byte, list', r2)) {
      T.eq('config.json of 1 MiB + 1 byte — invalid_config', r2.json && r2.json.error, 'invalid_config');
      T.contains('config.json of 1 MiB + 1 byte — the message says why', r2.stderr, '1 MiB');
    }
  }

  /* ---- a claim entry: skipped, never a hang ----------------------------- */
  {
    const d = fixture('edge-nonreg-claim');
    const dir = p(d, '.nanojira/claims/EPIC-001');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '1'), 'claimed\nalice\n' + NOW + '\n');
    if (mkfifo(path.join(dir, '2'))) {
      const show = H.runJson(['show', '--id=EPIC-001'], Object.assign({ cwd: d }, RUN));
      if (returned('a claim entry as a FIFO, show', show)) {
        T.exit('a claim entry as a FIFO, show — succeeds', show, 0);
        T.contains('a claim entry as a FIFO — the readable entry below it still counts', show.stdout, 'alice');
      }
      returned('a claim entry as a FIFO, list', H.runJson(['list'], Object.assign({ cwd: d }, RUN)));
      returned('a claim entry as a FIFO, log', H.runJson(['log', '--id=EPIC-001'], Object.assign({ cwd: d }, RUN)));
      returned('a claim entry as a FIFO, doctor', H.runJson(['doctor'], Object.assign({ cwd: d }, RUN)));
    }
    /* a symlinked entry is not followed either */
    const d2 = fixture('edge-nonreg-claim-link');
    const dir2 = p(d2, '.nanojira/claims/EPIC-001');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(d2, 'planted'), 'claimed\nmallory\n' + NOW + '\n');
    fs.symlinkSync(path.join(d2, 'planted'), path.join(dir2, '1'));
    const show2 = H.runJson(['show', '--id=EPIC-001'], Object.assign({ cwd: d2 }, RUN));
    T.check('a claim entry that is a symlink — not read', show2.status === 0 && !show2.stdout.includes('mallory'), show2.stdout.slice(0, 400));
  }

  /* ---- README.md / .gitignore under doctor --fix ------------------------ */
  for (const name of ['README.md', '.gitignore']) {
    const d = fixture('edge-nonreg-' + name.replace(/\W/g, ''));
    fs.mkdirSync(p(d, '.nanojira/claims'), { recursive: true }); // makes doctor read .gitignore
    if (!mkfifo(p(d, name))) { T.notCovered(name + ' as a FIFO', 'mkfifo failed'); continue; }
    const doc = H.runJson(['doctor'], Object.assign({ cwd: d }, RUN));
    returned(name + ' as a FIFO, doctor', doc);
    const fix = H.runJson(['doctor', '--fix'], Object.assign({ cwd: d }, RUN));
    if (returned(name + ' as a FIFO, doctor --fix', fix)) {
      T.check(name + ' as a FIFO, doctor --fix — ran to the end', fix.json !== null, H.describeRun(fix));
      T.check(name + ' as a FIFO, doctor --fix — left in place', fs.lstatSync(p(d, name)).isFIFO(), '');
    }
  }
}

T.finish();
