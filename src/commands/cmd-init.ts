'use strict';

// `nanojira init`.

import type { Flags } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkCommandFlags } from '../core/cli-flags.ts';
import { initLocation, oneLine } from '../core/config.ts';
import { DEFAULT_CONFIG, V3_IDS_REL } from '../core/constants.ts';
import { isDryRun, sandboxFor } from '../core/dry-run.ts';
import { fail, out } from '../core/output.ts';
import { recordChange } from '../core/on-change.ts';
import { V3_README } from '../core/readme-texts.ts';
import { refreshStatus } from '../core/status.ts';
import { refreshTags } from '../core/tags.ts';

/**
 * A dry run creates its backlog in a scratch directory, so the real
 * target's own `io_error` cases are checked here instead: the nearest
 * existing ancestor must be a directory this user may write into. Same code
 * as the real call; the OS message may be worded differently.
 */
function probeCreatable(target: string) {
  let dir = path.dirname(target);
  for (;;) {
    let st: fs.Stats | null;
    try { st = fs.statSync(dir); } catch { st = null; }
    if (st !== null) {
      if (!st.isDirectory()) fail('io_error', `cannot create the backlog at ${target}: ENOTDIR: not a directory, mkdir '${target}'`);
      try { fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK); } catch (e: any) {
        fail('io_error', `cannot create the backlog at ${target}: ${oneLine(e)}`);
      }
      return;
    }
    const up = path.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}

function cmdInit(flags: Flags) {
  checkCommandFlags(flags, 'init');
  const json = flags.has('json');
  const target = initLocation(flags);
  if (fs.existsSync(target)) fail('exists', `${target} already exists`);
  if (isDryRun()) probeCreatable(target);
  // During a dry run, a path in a scratch directory that does not exist yet
  // (§ 9 "`--dry-run`"); the real target is never created.
  const backlog = sandboxFor(target);

  // A parent that is a file, or one the user may not write, is `io_error`:
  // one line naming the path and the OS reason, never a stack (DECISIONS 93 F4).
  try {
    fs.mkdirSync(backlog, { recursive: true });
    for (const d of ['epics', 'tasks', 'subtasks', 'archive', V3_IDS_REL]) {
      fs.mkdirSync(path.join(backlog, d), { recursive: true });
    }
    // The full block, so the defaults are visible where they are changed
    // (§ 5, DECISIONS 92 Q1) — at the v3 place, nothing at the top level.
    // `claims`, `problems` and `ids` are all excluded: § 5 says none of
    // them is "written by init" — their absence IS the default (24h
    // staleness, empty ignore list, flat tombstones), not merely an unset
    // key (DECISIONS 130, 165; `ids` follows the same rule, § 8).
    const { claims, problems, ids, ...written } = DEFAULT_CONFIG;
    void claims;
    void problems;
    void ids;
    fs.writeFileSync(path.join(backlog, '.nanojira', 'config.json'), JSON.stringify(written, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(backlog, '.gitignore'), '.nanojira/index.json\n.nj-tmp-*\n.nanojira/claims/\n', 'utf8');
    fs.writeFileSync(path.join(backlog, 'README.md'), V3_README, 'utf8');
  } catch (e: any) {
    fail('io_error', `cannot create the backlog at ${backlog}: ${oneLine(e)}`);
  }
  // The overview of an empty backlog: every configured status, all empty (§ 4).
  refreshStatus(backlog, { ...DEFAULT_CONFIG });
  refreshTags(backlog, { ...DEFAULT_CONFIG });

  const built = { ok: true, backlog, changed: ['created'] };
  recordChange(backlog, () => built);
  if (json) out(JSON.stringify(built, null, 2));
  else {
    out(`Created backlog at ${backlog}`);
    out('  epics/ tasks/ subtasks/ archive/ .nanojira/');
    out('  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md TAGS.md');
  }
  return 0;
}

export { cmdInit };
