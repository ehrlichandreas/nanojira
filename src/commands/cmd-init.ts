'use strict';

// `nj init`.

import type { Flags } from '../core/types.ts';

import * as fs from 'fs';
import * as path from 'path';
import { checkFlags } from '../core/args.ts';
import { DEFAULT_CONFIG } from '../core/constants.ts';
import { fail, out } from '../core/output.ts';

function cmdInit(flags: Flags) {
  checkFlags(flags, [], new Set(['json']), false);
  const json = flags.has('json');
  const backlog = path.resolve(process.cwd(), 'backlog');
  if (fs.existsSync(backlog)) fail('exists', `${backlog} already exists`);

  fs.mkdirSync(backlog, { recursive: true });
  for (const d of ['epics', 'tasks', 'subtasks', 'archive', '.ids']) {
    fs.mkdirSync(path.join(backlog, d), { recursive: true });
  }
  fs.writeFileSync(path.join(backlog, '.nanojira.json'), JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(backlog, '.gitignore'), '.nanojira-index.json\n.nj-tmp-*\n', 'utf8');
  fs.writeFileSync(path.join(backlog, 'README.md'), README, 'utf8');

  if (json) out(JSON.stringify({ ok: true, backlog, changed: ['created'] }, null, 2));
  else {
    out(`Created backlog at ${backlog}`);
    out('  epics/ tasks/ subtasks/ archive/ .ids/');
    out('  .nanojira.json .gitignore README.md');
  }
  return 0;
}

const README = `# Backlog

This folder is a NanoJira backlog. One Markdown file per element, grouped by
type: epics/, tasks/, subtasks/. Archived work lives in archive/.

Every file has a YAML-ish frontmatter block between \`---\` lines and a free
Markdown body. The frontmatter is the truth; the body belongs to you, except
for the \`# H1\` (mirrors \`title\`) and the \`## Notes\` section written by
\`nj note\`.

An element is *ready to work* when its status is the first configured status,
all \`depends_on\` targets are done, it carries no error, and it has a
non-empty \`## Description\` (plus \`## Acceptance Criteria\` for tasks and
subtasks). A heading with nothing under it counts as absent — that is
deliberate.

\`.ids/\` holds one empty tombstone file per allocated ID. It is versioned and
must be committed: it is what guarantees IDs are never reused. Do not delete
it.

The only uncommitted artifact is \`.nanojira-index.json\` (a cache).

Useful commands: \`nj\`, \`nj list --ready\`, \`nj show --id=…\`,
\`nj new --type=task --parent=EPIC-001 --title="…"\`, \`nj doctor\`.
`;

export { cmdInit };
