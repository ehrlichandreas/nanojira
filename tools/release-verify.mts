// tools/release-verify.mts -- what tools/release.ts checks after the squash,
// and what `release.ts --verify-only vX.Y.Z` checks after the push
// (DECISIONS 228, TSK-040 step C). Until 4.4.0 a team script did this; it
// lived on tmpfs and was versioned nowhere.
//
// Seven sections, one `verify: <check>: OK|FAIL <why>|SKIPPED (<why>)`
// line each. Read-only: the one scratch directory (the export in
// "content") is removed again.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveTag, checkSigner } from './release-key.mts';

interface Line { check: string; status: 'OK' | 'FAIL' | 'SKIPPED'; detail: string }
interface VerifyOptions {
  name: string;
  /** vX.Y.Z */
  tag: string;
  pin: string;
  /** The head before the squash: its tree must be the release commit's. Unknown in --verify-only. */
  pre?: string;
  /** --verify-only: origin must have main and the tag exactly as here. */
  requirePushed: boolean;
}

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const SIG_BLOCK = /^-----BEGIN PGP SIGNATURE-----$/gm;

function newer(a: string, b: string): boolean {
  const n = (v: string) => v.slice(1).split('.').map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function verifyRelease(root: string, o: VerifyOptions): Line[] {
  const run = (args: string[], input?: string) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });
  const out = (args: string[]) => String(run(args).stdout || '').trim();
  const lines = (s: string) => s.split('\n').filter((l) => l !== '');
  const result: Line[] = [];
  const section = (check: string, problems: string[], note = '') =>
    result.push({ check, status: problems.length === 0 ? 'OK' : 'FAIL', detail: problems.length === 0 ? note : problems.join('; ') });
  const version = o.tag.slice(1);

  // The pinned key as the keyring has it, read-only, through git's own
  // gpg.program. DECISIONS 190 (git-history-tools D10): tail signs at the
  // key's creation time + 60 s, so a release never carries the real
  // signing time. And the release identity must be one of the key's user
  // IDs (not revoked): the owner, never a WIP name, with nothing
  // hard-coded here.
  const key = (() => {
    const gpg = out(['config', 'gpg.program']) || 'gpg';
    const records = String(spawnSync(gpg, ['--batch', '--with-colons', '--list-keys', '--', o.pin], { encoding: 'utf8' }).stdout || '')
      .split('\n').map((l) => l.split(':'));
    const created = (records.find((r) => r[0] === 'pub') || [])[5] || '';
    // --with-colons escapes ':' and control characters as \xHH.
    const uids = records.filter((r) => r[0] === 'uid' && r[1] !== 'r')
      .map((r) => (r[9] || '').replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
    return { sigPin: /^\d+$/.test(created) ? String(Number(created) + 60) : '', uids };
  })();
  const sigPin = key.sigPin;
  const ownerIdentity = (p: string[], who: string, identity: string) => {
    if (!key.uids.includes(identity)) {
      p.push(`${who} ${JSON.stringify(identity)} is not a user ID of the release key (${key.uids.length === 0 ? 'none in the keyring' : key.uids.map((u) => JSON.stringify(u)).join(', ')})`);
    }
  };
  const signedAtPin = (p: string[], signer: ReturnType<typeof checkSigner>) => {
    if (!signer.ok) { p.push(`${signer.error}: ${signer.message}`); return; }
    if (sigPin === '' || signer.created.length !== 1 || signer.created[0] !== sigPin) {
      p.push(`signature time ${signer.created.join(', ') || 'unknown'}, expected the DECISIONS 190 pin ${sigPin === '' ? '(release key creation time unknown)' : `${sigPin} (release key creation + 60 s)`}`);
    }
  };

  const rel = out(['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/tags/${o.tag}^{commit}`]);
  if (rel === '') return [{ check: 'squash', status: 'FAIL', detail: `no tag ${JSON.stringify(o.tag)}` }];
  const relAncestors = new Set(lines(out(['rev-list', rel])));
  const releaseTags = lines(out(['tag', '--list', 'v*', '--sort=-v:refname'])).filter((t) => RELEASE_TAG.test(t) && t !== o.tag);
  const prev = releaseTags.find((t) => relAncestors.has(out(['rev-parse', `refs/tags/${t}^{commit}`])));
  const prevCommit = prev === undefined ? '' : out(['rev-parse', `refs/tags/${prev}^{commit}`]);

  // (1) the squash: vPREV + exactly one commit, nothing tagged in between,
  // the pre-squash tree kept, main at the release.
  {
    const p: string[] = [];
    let note = '';
    if (prev === undefined) {
      p.push('no previous vX.Y.Z release in its history');
    } else {
      if (!newer(o.tag, prev)) p.push(`${o.tag} is not newer than ${prev}`);
      const parents = out(['rev-list', '--parents', '-n1', rel]).split(' ').slice(1);
      const count = out(['rev-list', '--count', `${prevCommit}..${rel}`]);
      if (count !== '1' || parents.length !== 1 || parents[0] !== prevCommit) {
        p.push(`the release commit is ${count} commit(s) after ${prev}, parent(s) ${parents.map((c) => c.slice(0, 7)).join(' ') || 'none'}; expected exactly 1, on ${prev}`);
      }
      const between = lines(out(['for-each-ref', '--contains', prevCommit, '--merged', rel,
        '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags']))
        .map((l) => l.split(' ')).filter(([t, obj, peeled]) => t !== o.tag && (peeled || obj) !== prevCommit).map(([t]) => t);
      if (between.length > 0) p.push(`tag(s) between ${prev} and the release: ${between.join(', ')}`);
    }
    if (o.pre !== undefined && out(['rev-parse', `${rel}^{tree}`]) !== out(['rev-parse', `${o.pre}^{tree}`])) {
      p.push('the release tree differs from the pre-squash head\'s');
    }
    const main = out(['rev-parse', '--verify', '--quiet', 'refs/heads/main']);
    if (main !== rel) {
      if (main !== '' && run(['merge-base', '--is-ancestor', rel, main]).status === 0) note = `main is ${out(['rev-list', '--count', `${rel}..${main}`])} commit(s) past ${o.tag}`;
      else p.push(`main (${main.slice(0, 7) || 'missing'}) does not contain the release commit`);
    }
    section('squash', p, note);
  }

  // (2) the release commit: one identity, the anonymous date for its
  // position, the subject, one signature, by the pinned key.
  const [author, committer, authorDate, committerDate, subject] = out(['show', '-s', '--format=%an <%ae>%x09%cn <%ce>%x09%at%x09%ct%x09%s', rel]).split('\t');
  const resolved = resolveTag(root, o.tag);
  const tagObject = resolved.ok ? run(['cat-file', 'tag', resolved.oid]).stdout : '';
  {
    const p: string[] = [];
    if (author !== committer) p.push(`author ${author} is not the committer ${committer}`);
    ownerIdentity(p, 'author', author);
    // git-release-squash's anonDateAt(position): position = the distinct
    // tagged commits before the release.
    const tagged = new Set(lines(out(['for-each-ref', '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags']))
      .map((l) => l.split(' ')).filter(([t]) => t !== o.tag).map(([, obj, peeled]) => peeled || obj));
    const before = prevCommit === '' ? new Set<string>() : new Set(lines(out(['rev-list', prevCommit])));
    const position = [...tagged].filter((c) => before.has(c)).length;
    const want = String((position + 1) * 86400 + 43200);
    if (authorDate !== want || committerDate !== want) p.push(`dates ${authorDate}/${committerDate}, expected anonDateAt(${position}) = ${want}`);
    const title = tagObject.split('\n\n').slice(1).join('\n\n').split('\n')[0];
    if (subject !== `${o.name} ${o.tag}: ${title}`) p.push(`subject ${JSON.stringify(subject)}, expected ${JSON.stringify(`${o.name} ${o.tag}: ${title}`)}`);
    const header = run(['cat-file', 'commit', rel]).stdout.split('\n\n')[0];
    const sigs = (header.match(/^gpgsig(-sha256)? /gm) || []).length;
    if (sigs !== 1) p.push(`${sigs} signature headers, expected 1`);
    signedAtPin(p, checkSigner(root, 'commit', rel, o.tag + '^{commit}', o.pin));
    section('release commit', p);
  }

  // (3) the tag: annotated and named for itself, one signature block, by
  // the pinned key, tagged by the commit's identity at its date.
  {
    const p: string[] = [];
    if (!resolved.ok) {
      p.push(resolved.message);
    } else {
      const blocks = (tagObject.match(SIG_BLOCK) || []).length;
      if (blocks !== 1) p.push(`${blocks} signature blocks, expected 1`);
      signedAtPin(p, checkSigner(root, 'tag', resolved.oid, o.tag, o.pin));
      const tagger = out(['for-each-ref', '--format=%(taggername) <%(taggeremail:trim)> %(taggerdate:raw)', `refs/tags/${o.tag}`]);
      if (tagger !== `${author} ${authorDate} +0000`) p.push(`tagger ${JSON.stringify(tagger)}, expected ${JSON.stringify(`${author} ${authorDate} +0000`)}`);
      ownerIdentity(p, 'tagger', tagger.replace(/ \S+ \S+$/, ''));
    }
    section('release tag', p);
  }

  // (4) origin: every older tag byte-identical, nothing extra, main and
  // the tag either not pushed yet or pushed exactly as here.
  let pushed = false;
  let reachable = false;
  {
    const ls = spawnSync('git', ['ls-remote', 'origin'], { cwd: root, encoding: 'utf8', timeout: 60000,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' }) });
    if (ls.status !== 0) {
      result.push({ check: 'old tags vs origin', status: 'SKIPPED', detail: 'origin unreachable' });
    } else {
      reachable = true;
      const remote = new Map(lines(String(ls.stdout)).map((l) => l.split('\t')).map(([sha, ref]) => [ref, sha] as [string, string]));
      const p: string[] = [];
      const local = lines(out(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/tags'])).map((l) => l.split(' '));
      const differ = local.filter(([t, oid]) => t !== o.tag && remote.get(`refs/tags/${t}`) !== oid).map(([t]) => t);
      if (differ.length > 0) p.push(`tag(s) missing on or differing from origin: ${differ.join(', ')}`);
      const known = new Set(local.map(([t]) => `refs/tags/${t}`));
      const extra = [...remote.keys()].filter((r) => r.startsWith('refs/tags/') && !r.endsWith('^{}') && !known.has(r));
      if (extra.length > 0) p.push(`origin has tag(s) this repo lacks: ${extra.map((r) => r.slice('refs/tags/'.length)).join(', ')}`);
      const rMain = remote.get('refs/heads/main');
      const rTag = remote.get(`refs/tags/${o.tag}`);
      pushed = rMain === rel && resolved.ok && rTag === resolved.oid;
      const prePush = rMain === prevCommit && rTag === undefined;
      if (!pushed && !prePush) p.push(`origin is neither before the push (main at ${prev}, no ${o.tag}) nor after it: main ${(rMain || 'missing').slice(0, 7)}, ${o.tag} ${(rTag || 'absent').slice(0, 7)}`);
      const heads = [...remote.keys()].filter((r) => r.startsWith('refs/heads/') && r !== 'refs/heads/main');
      if (heads.length > 0) p.push(`origin has branch(es) besides main: ${heads.join(', ')}`);
      section('old tags vs origin', p, pushed ? 'pushed' : 'not pushed yet');
    }
  }

  // (5) the content at the tag: the version everywhere, CHANGES, the
  // version in dist, and an export of it.
  {
    const p: string[] = [];
    const show = (rel: string) => { const r = run(['show', `${o.tag}^{commit}:${rel}`]); return r.status === 0 ? String(r.stdout) : null; };
    const json = (rel: string): any => { try { return JSON.parse(show(rel) || ''); } catch { return null; } };
    const pkg = json('package.json'), lock = json('package-lock.json');
    const skill = show('SKILL.md');
    const seen = [pkg && pkg.version, lock && lock.version, lock && lock.packages && lock.packages[''] && lock.packages[''].version,
      skill === null ? undefined : (/^\s*version:\s*"([^"]*)"/m.exec(skill) || [])[1]];
    if (seen.some((v) => v !== version)) p.push(`versions (package.json, lock x2, SKILL.md): ${seen.map((v) => v === undefined || v === null ? 'missing' : v).join(' ')}`);
    const changes = show('docs/CHANGES.md') ?? show('CHANGES.md');
    if (changes === null || !new RegExp(`^## ${version.replace(/\./g, '\\.')}( |$)`, 'm').test(changes)) p.push(`no "## ${version}" heading in CHANGES`);
    const inDist = (ref: string, s: string) => lines(out(['grep', '-l', '-F', s, `${ref}^{commit}`, '--', 'dist']));
    if (inDist(o.tag, version).length === 0) p.push(`no dist file embeds ${version}`);
    if (prev !== undefined && inDist(prev, prev.slice(1)).length > 0 && inDist(o.tag, prev.slice(1)).length > 0) {
      p.push(`dist still embeds ${prev.slice(1)}: ${inDist(o.tag, prev.slice(1)).map((f) => f.replace(/^[^:]*:/, '')).join(', ')}`);
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verify-'));
    try {
      const dest = path.join(scratch, 'export');
      const exp = spawnSync(process.execPath, [path.join(root, 'tools', 'export-skill.mts'), o.tag, dest], { cwd: root, encoding: 'utf8' });
      if (exp.status !== 0) {
        p.push(`export-skill failed: ${String(exp.stderr || '').trim().split('\n').pop()}`);
      } else {
        const exported = fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
        const ev = (/^\s*version:\s*"([^"]*)"/m.exec(exported) || [])[1];
        if (ev !== version) p.push(`exported SKILL.md metadata.version ${JSON.stringify(ev)}`);
        const said = String(spawnSync('sh', [path.join(dest, 'bin', o.name), '--version'], { encoding: 'utf8' }).stdout || '').trim();
        if (said !== `${o.name} ${version}`) p.push(`exported bin/${o.name} --version ${JSON.stringify(said)}`);
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    section('content', p);
  }

  // (6) refs: main and tags only, no other worktree.
  {
    const p: string[] = [];
    const others = lines(out(['for-each-ref', '--format=%(refname)']))
      .filter((r) => !r.startsWith('refs/tags/') && !r.startsWith('refs/remotes/') && r !== 'refs/heads/main');
    if (others.length > 0) p.push(`refs besides main and tags: ${others.join(', ')}`);
    const worktrees = lines(out(['worktree', 'list', '--porcelain'])).filter((l) => l.startsWith('worktree ')).slice(1);
    if (worktrees.length > 0) p.push(`other worktree(s): ${worktrees.map((l) => l.slice('worktree '.length)).join(', ')}`);
    section('refs', p);
  }

  // (7) the whole history: every commit on a branch or tag and every
  // annotated tag signed by the pinned key, one signature block each.
  {
    const p: string[] = [];
    const commits = lines(out(['rev-list', '--branches', '--tags']));
    const badCommits = commits.filter((c) => !checkSigner(root, 'commit', c, c, o.pin).ok);
    if (badCommits.length > 0) p.push(`commit(s) not signed by the release key: ${badCommits.map((c) => c.slice(0, 7)).join(' ')}`);
    const annotated = lines(out(['for-each-ref', '--format=%(objecttype) %(objectname) %(refname:short)', 'refs/tags']))
      .map((l) => l.split(' ')).filter(([type]) => type === 'tag');
    const badTags = annotated.filter(([, oid, t]) =>
      !checkSigner(root, 'tag', oid, t, o.pin).ok || (String(run(['cat-file', 'tag', oid]).stdout).match(SIG_BLOCK) || []).length !== 1).map(([, , t]) => t);
    if (badTags.length > 0) p.push(`annotated tag(s) not signed once by the release key: ${badTags.join(', ')}`);
    section('history signatures', p, `${commits.length} commit(s), ${annotated.length} annotated tag(s)`);
  }

  if (o.requirePushed) {
    result.push(!reachable ? { check: 'origin == local', status: 'FAIL', detail: 'origin unreachable' }
      : pushed ? { check: 'origin == local', status: 'OK', detail: '' }
      : { check: 'origin == local', status: 'FAIL', detail: `origin's main and ${o.tag} are not this repo's` });
  }
  return result;
}

function formatLine(l: Line): string {
  if (l.status === 'SKIPPED') return `verify: ${l.check}: SKIPPED (${l.detail})`;
  if (l.status === 'FAIL') return `verify: ${l.check}: FAIL ${l.detail}`;
  return `verify: ${l.check}: OK${l.detail ? ` (${l.detail})` : ''}`;
}

export { verifyRelease, formatLine };
export type { Line };
