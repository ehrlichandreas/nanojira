/* Edge — the CLI kernel stays project-neutral (DECISIONS 231, TSK-050).
 *
 * `src/core/kernel.ts` is meant to be copied verbatim into another project,
 * so it imports only `node:*` built-ins (never another module here), and no
 * file under src/ or dist/ names the project it was taken back from. Its
 * `parseArgs` takes the flag table as an optional spec: a `string` flag
 * takes the next token as its value; without the spec every bare flag is
 * `true`. Aliases and value sameness come from the caller.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.ts';
const T = H.T;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KERNEL = path.join(ROOT, 'src', 'core', 'kernel.ts');

/* A. imports ------------------------------------------------------------- */
{
  const src = fs.readFileSync(KERNEL, 'utf8');
  // `import x from '…'`, `export … from "…"` and a bare side-effect
  // `import '…'`, either quote; then `import(…)` / `require(…)`.
  const specs = Array.from(src.matchAll(/^\s*(?:import|export)\b[^;'"]*?['"]([^'"]+)['"]/gm), (m) => m[1]);
  const dynamic = Array.from(src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g), (m) => m[1]);
  T.check('A kernel.ts has at least one import', specs.length > 0, '');
  T.eq('A kernel.ts imports only node:* built-ins', [...specs, ...dynamic].filter((s) => !s.startsWith('node:')), []);
  T.check('A the header says it is copied verbatim', /copy verbatim, project-neutral/.test(src.slice(0, 400)), '');
  // No provenance stamp either (DECISIONS 231): the copier records where
  // it came from. The NJ_NOW clock variable is the shared convention.
  T.eq('A kernel.ts names no project', Array.from(src.matchAll(/^.*nanojira.*$/gim), (m) => m[0].trim()), []);
}

/* B. no "agent-skills" in src/ or dist/ ---------------------------------- */
{
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && fs.readFileSync(p, 'utf8').includes('agent-skills')) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'dist'));
  T.eq('B no file under src/ or dist/ names agent-skills', hits, []);
}

/* C. parseArgs' spec param ----------------------------------------------- */
(async () => {
  const K = await import(KERNEL);
  const kinds = { title: 'string', json: 'boolean' } as const;
  const flat = (r: { flags: Map<string, string | true>; positional: string[]; repeated: unknown[] }) =>
    ({ flags: Object.fromEntries(r.flags), positional: r.positional, repeated: r.repeated });

  T.eq('C a string flag takes the next token',
    flat(K.parseArgs(['--title', 'Two words', 'x'], kinds)), { flags: { title: 'Two words' }, positional: ['x'], repeated: [] });
  T.eq('C a boolean flag never takes the next token',
    flat(K.parseArgs(['--json', 'x'], kinds)), { flags: { json: true }, positional: ['x'], repeated: [] });
  T.eq('C without the spec every bare flag is true',
    flat(K.parseArgs(['--title', 'x'])), { flags: { title: true }, positional: ['x'], repeated: [] });
  T.eq('C a flag the spec does not know is true',
    flat(K.parseArgs(['--other', 'x'], kinds)), { flags: { other: true }, positional: ['x'], repeated: [] });
  T.eq('C a next token starting with -- is not taken as the value',
    flat(K.parseArgs(['--title', '--json'], kinds)), { flags: { title: true, json: true }, positional: [], repeated: [] });
  T.eq('C `-` is a value', flat(K.parseArgs(['--title', '-'], kinds)), { flags: { title: '-' }, positional: [], repeated: [] });
  T.eq('C `--` ends the options',
    flat(K.parseArgs(['--', '--title', 'x'], kinds)), { flags: {}, positional: ['--title', 'x'], repeated: [] });
  T.eq('C =value wins over the next token',
    flat(K.parseArgs(['--title=a', 'b'], kinds)), { flags: { title: 'a' }, positional: ['b'], repeated: [] });
  T.eq('C a different repeat is reported with the spelling typed',
    flat(K.parseArgs(['--title=a', '--name=b'], kinds, { aliases: new Map([['name', 'title']]) })),
    { flags: { title: 'b' }, positional: [], repeated: [{ name: 'title', typed: 'name' }] });
  T.eq('C an identical repeat is not reported',
    flat(K.parseArgs(['--title=a', '--title', 'a'], kinds)).repeated, []);
  T.eq('C the caller decides which values are the same',
    flat(K.parseArgs(['--title=a', '--title=A'], kinds, { sameValue: (_n: string, a: string | true, b: string | true) => String(a).toLowerCase() === String(b).toLowerCase() })).repeated, []);
  T.eq('C allowedControlSet adds the caller\'s global controls',
    Array.from(K.allowedControlSet(['force'], ['backlog'])), ['force', 'backlog']);
  T.finish();
})().catch((e) => {
  console.log('FAIL edge/kernel-neutral.ts — unexpected error');
  console.log('  ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
