'use strict';

// The per-command context: backlog, configuration, elements, target resolution.

import type { Element, Context, Flags } from './types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { flagString } from './args.ts';
import { loadConfig, findBacklog, isLegacyBacklog } from './config.ts';
import { V3_CONFIG_REL, V3_IDS_REL, LEGACY_CONFIG_REL, LEGACY_IDS_REL } from './constants.ts';
import { compareElements } from './derive.ts';
import { loadBacklog } from './load.ts';
import { fail } from './output.ts';

// ------------------------------------------------------------------ context

// `lenient` is `doctor`'s own flag: only it may open a legacy backlog (it
// reads the v2 places and reports `backlog:legacy_layout`, § 14); every
// other command refuses with `legacy_layout` before anything is loaded —
// unconditionally, even an ambiguous one (DECISIONS 95 B21, AMBIGUITIES 71).
function context(flags: Flags, opts?: { lenient?: boolean; tolerateConfig?: boolean }): Context {
  const backlog = findBacklog(flags, Boolean(opts && opts.lenient));
  const legacy = isLegacyBacklog(backlog);
  if (legacy && !(opts && opts.lenient)) {
    fail('legacy_layout', `${backlog} is a legacy (v2) backlog — every command but \`doctor\` refuses it`,
      'run `nj doctor --fix` to migrate it to the v3 layout');
  }
  const { config, errors, warnings, needsNewerNj } = loadConfig(backlog, legacy);
  // minVersion (§ 5, DECISIONS 166): applies to every command, including
  // `doctor` -- `tolerateConfig` exempts it from `invalid_config` only;
  // there is nothing `doctor --fix` could repair about the running
  // binary's own version, so this gate is unconditional.
  if (needsNewerNj) {
    fail('needs_newer_nj', `this backlog requires nj ${needsNewerNj.required} or newer; running ${needsNewerNj.running}`,
      `running ${needsNewerNj.running}, requires ${needsNewerNj.required} — upgrade nj`);
  }
  if (errors.length > 0 && !(opts && opts.tolerateConfig)) {
    const configFile = path.join(backlog, legacy ? LEGACY_CONFIG_REL : V3_CONFIG_REL);
    fail('invalid_config', `invalid configuration in ${configFile}: ${errors[0]}`, 'run `nj doctor` for the full report');
  }
  const idsDir = path.join(backlog, legacy ? LEGACY_IDS_REL : V3_IDS_REL);
  // Taken before the first file is read: STATUS.md's refresh trusts the
  // elements loaded here only for files whose ctime predates it (DECISIONS 103).
  const loadedAt = Date.now();
  const { elements, scan } = loadBacklog(backlog, config, idsDir);
  return { backlog, cfg: config, configErrors: errors, configWarnings: warnings, elements, scan, loadedAt, legacy, idsDir };
}

// resolveTarget (below) bundles the --id/--file argument-syntax checks
// (missing_value via flagString, missing_argument when neither is given,
// invalid_target when both are given) together with the actual lookup
// (not_found, duplicate_id). Commands whose own precedence rule puts
// something else (an acting name's invalid_env/invalid_value, § 9/§ 10/
// § 12a) between argument parsing and target resolution run this syntax
// half early, on its own, then still call resolveTarget for the lookup --
// which harmlessly re-derives the same flags (DECISIONS 111, D104 ambiguity
// 77). Shared by `nj note`, `nj claim` and `nj release`.
function requireTargetFlagSyntax(flags: Flags) {
  const file = flagString(flags, 'file');
  const id = flagString(flags, 'id');
  if (file !== undefined && id !== undefined) fail('invalid_target', 'use either --id or --file, not both');
  if (file === undefined && id === undefined) fail('missing_argument', '--id is required');
}

function resolveTarget(ctx: Context, flags: Flags, forWrite?: boolean): Element {
  const file = flagString(flags, 'file');
  const id = flagString(flags, 'id');
  if (file !== undefined && id !== undefined) fail('invalid_target', 'use either --id or --file, not both');
  if (file !== undefined) {
    const abs = path.isAbsolute(file) ? file : path.resolve(ctx.backlog, file);
    // Compare through symlinks: on macOS /tmp and /var are symlinked, so a
    // caller-supplied absolute path rarely matches the scanned path literally.
    // A dangling symlink (or an unreadable stub) makes realpath throw on both
    // sides; resolving only the parent directory still lets the two paths meet
    // at the same real location (decision 48).
    const real = (p: string) => {
      try { return fs.realpathSync.native(p); } catch { /* dangling, missing or unreadable */ }
      const dir = path.dirname(p);
      let rdir;
      try { rdir = fs.realpathSync.native(dir); } catch { rdir = path.resolve(dir); }
      return path.join(rdir, path.basename(p));
    };
    const want = real(abs);
    const el = ctx.elements.find((e) => real(e.file) === want);
    if (!el) return fail('not_found', `no element file at '${abs}'`);
    return el;
  }
  if (id === undefined) return fail('missing_argument', '--id is required');
  return resolveById(ctx, id, forWrite);
}

// The --id-by-name half of resolveTarget, factored out so a batch write
// (§ 9 "Batch writes") can resolve each of --id=A,B,C's names the same way,
// without re-deriving --id/--file from flags (a batch has already decided
// --file does not apply, § 9).
function resolveById(ctx: Context, id: string, forWrite?: boolean): Element {
  const matches = ctx.elements.filter((e) => e.id === id);
  if (matches.length === 0) return fail('not_found', `no element with id '${id}'`);
  if (matches.length > 1) {
    if (forWrite) {
      const paths = matches.map((m) => '  ' + m.file).join('\n');
      fail('duplicate_id', `duplicate_id: '${id}' is carried by more than one file — refusing to write.\n${paths}`,
        `edit the frontmatter 'id' of one file to a free number and rename the file to match, then re-run; or address one file directly with --file=<path>`);
    }
    return matches[0];
  }
  return matches[0];
}

function requireWritable(el: Element) {
  if (el.problems.has('file:unreadable')) {
    fail('refused:unreadable', `${el.id} (${el.file}) cannot be read — refusing to write`,
      'check the file and its permissions, then run `nj doctor`');
  }
  if (el.problems.has('frontmatter:unreadable')) {
    fail('refused:unreadable', `${el.id} (${el.file}) has unreadable frontmatter — refusing to write`,
      'repair the file by hand, then run `nj doctor`');
  }
}

// `rm` and `archive` are subtree operations, and a stub carries no readable
// `parent` (decision 46) — so while any stub exists, no subtree can be
// determined: a cascade could orphan it, an archive could split it. Refusing
// for the whole backlog is the only answer that honours § 9's "a mode that
// leaves orphaned elements does not exist"; single `rm` falls under the same
// rule for the same reason.
function requireNoStubs(ctx: Context, verb: string) {
  const stubs = ctx.elements.filter((e) => e.problems.has('file:unreadable')).sort(compareElements);
  if (stubs.length === 0) return;
  const names = stubs.map((s) => `  ${s.id}  ${s.file}`).join('\n');
  fail('refused:unreadable', `${verb} is refused while the backlog contains unreadable files — their parents cannot be read, so no subtree can be determined:\n${names}`,
    'make the files readable (or move them out of the backlog), then run `nj doctor` and retry');
}

// An unreadable directory (`backlog:unreadable_dir`, § 7) hides whatever
// element files lie inside it from every scan — not a stub, not even
// visible, so `descendants()` and the open-children check cannot see what
// they are missing. `archive`, `rm` and a `done` transition all rely on
// having seen the whole subtree; refusing while ANY such directory exists
// anywhere in the backlog is the same rule `requireNoStubs` already applies
// to unreadable files, for the same reason: the guard is a property of the
// backlog, not of the addressed element (DECISIONS 106 F4).
function requireNoUnreadableDirs(ctx: Context, verb: string) {
  if (ctx.scan.unreadable.length === 0) return;
  const names = ctx.scan.unreadable.map((u) => `  ${path.relative(ctx.backlog, u.dir)}`).join('\n');
  fail('refused:unreadable_dir', `${verb} is refused while the backlog contains an unreadable directory — files inside it are not seen, so no subtree can be determined:\n${names}`,
    'make the directory readable, then run `nj doctor` and retry');
}

// Round one has no `nj unarchive`, so the archive is read-only (§ 9).
function requireActive(el: Element, verb: string) {
  if (el.archived) {
    fail('refused:archived', `${el.id} is archived — ${verb} is refused on archived elements`,
      'archived elements are read-only in round one; `nj unarchive` is round two');
  }
}

export { context, requireTargetFlagSyntax, resolveTarget, resolveById, requireWritable, requireNoStubs, requireNoUnreadableDirs, requireActive };
