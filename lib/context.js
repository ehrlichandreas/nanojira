'use strict';

// The per-command context: backlog, configuration, elements, target resolution.

const fs = require('fs');
const path = require('path');
const { flagString } = require('./args.js');
const { loadConfig, findBacklog } = require('./config.js');
const { compareElements } = require('./derive.js');
const { loadBacklog } = require('./load.js');
const { fail } = require('./output.js');

// ------------------------------------------------------------------ context

function context(opts) {
  const backlog = findBacklog(Boolean(opts && opts.lenient));
  const { config, errors } = loadConfig(backlog);
  if (errors.length > 0 && !(opts && opts.tolerateConfig)) {
    fail('invalid_config', `invalid configuration in ${path.join(backlog, '.nanojira.json')}: ${errors[0]}`, 'run `nj doctor` for the full report');
  }
  const elements = loadBacklog(backlog, config);
  return { backlog, cfg: config, configErrors: errors, elements };
}

function resolveTarget(ctx, flags, forWrite) {
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
    const real = (p) => {
      try { return fs.realpathSync.native(p); } catch { /* dangling, missing or unreadable */ }
      const dir = path.dirname(p);
      let rdir;
      try { rdir = fs.realpathSync.native(dir); } catch { rdir = path.resolve(dir); }
      return path.join(rdir, path.basename(p));
    };
    const want = real(abs);
    const el = ctx.elements.find((e) => real(e.file) === want);
    if (!el) fail('not_found', `no element file at '${abs}'`);
    return el;
  }
  if (id === undefined) fail('missing_argument', '--id is required');
  const matches = ctx.elements.filter((e) => e.id === id);
  if (matches.length === 0) fail('not_found', `no element with id '${id}'`);
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

function requireWritable(el) {
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
function requireNoStubs(ctx, verb) {
  const stubs = ctx.elements.filter((e) => e.problems.has('file:unreadable')).sort(compareElements);
  if (stubs.length === 0) return;
  const names = stubs.map((s) => `  ${s.id}  ${s.file}`).join('\n');
  fail('refused:unreadable', `${verb} is refused while the backlog contains unreadable files — their parents cannot be read, so no subtree can be determined:\n${names}`,
    'make the files readable (or move them out of the backlog), then run `nj doctor` and retry');
}

// Round one has no `nj unarchive`, so the archive is read-only (§ 9).
function requireActive(el, verb) {
  if (el.archived) {
    fail('refused:archived', `${el.id} is archived — ${verb} is refused on archived elements`,
      'archived elements are read-only in round one; `nj unarchive` is round two');
  }
}

module.exports = { context, resolveTarget, requireWritable, requireNoStubs, requireActive };
