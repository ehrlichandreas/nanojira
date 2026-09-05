'use strict';

// `nanojira init`.

import type { Flags } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { initLocation, oneLine } from '../core/config.ts';
import { DEFAULT_CONFIG, V3_IDS_REL } from '../core/constants.ts';
import { fail, out } from '../core/output.ts';
import { V3_README } from '../core/readme-texts.ts';
import { refreshStatus } from '../core/status.ts';

function cmdInit(flags: Flags) {
  checkFlags(flags, [], new Set(['json']), false);
  const json = flags.has('json');
  const backlog = initLocation(flags);
  if (fs.existsSync(backlog)) fail('exists', `${backlog} already exists`);

  // A parent that is a file, or one the user may not write, is `io_error`:
  // one line naming the path and the OS reason, never a stack (DECISIONS 93 F4).
  try {
    fs.mkdirSync(backlog, { recursive: true });
    for (const d of ['epics', 'tasks', 'subtasks', 'archive', V3_IDS_REL]) {
      fs.mkdirSync(path.join(backlog, d), { recursive: true });
    }
    // The full block, so the defaults are visible where they are changed
    // (§ 5, DECISIONS 92 Q1) — at the v3 place, nothing at the top level.
    // `claims` and `problems` are both excluded: § 5 says neither is
    // "written by init" — their absence IS the default (24h staleness,
    // empty ignore list), not merely an unset key (DECISIONS 130, 165).
    const { claims, problems, ...written } = DEFAULT_CONFIG;
    void claims;
    void problems;
    fs.writeFileSync(path.join(backlog, '.nanojira', 'config.json'), JSON.stringify(written, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(backlog, '.gitignore'), '.nanojira/index.json\n.nj-tmp-*\n.nanojira/claims/\n', 'utf8');
    fs.writeFileSync(path.join(backlog, 'README.md'), V3_README, 'utf8');
  } catch (e: any) {
    fail('io_error', `cannot create the backlog at ${backlog}: ${oneLine(e)}`);
  }
  // The overview of an empty backlog: every configured status, all empty (§ 4).
  refreshStatus(backlog, { ...DEFAULT_CONFIG });

  if (json) out(JSON.stringify({ ok: true, backlog, changed: ['created'] }, null, 2));
  else {
    out(`Created backlog at ${backlog}`);
    out('  epics/ tasks/ subtasks/ archive/ .nanojira/');
    out('  .nanojira/config.json .nanojira/ids/ .gitignore README.md STATUS.md');
  }
  return 0;
}

export { cmdInit };
