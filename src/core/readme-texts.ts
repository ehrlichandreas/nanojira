'use strict';

// The README.md text `nj init` writes, and the v2 text it replaces on
// migration (§ 14 step 0, DECISIONS 102). Kept in one module, never a
// per-command literal, so the two texts cannot drift apart from each other
// by accident.

// The exact bytes a v2 `nj init` wrote (frozen at commit 5318888). Step 0
// replaces a migrated backlog's README ONLY when it is byte-identical to
// this — a user's own edit is never overwritten, by this text or any other.
const V2_README = `# Backlog

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

// The v3 text (docs/MIGRATION-v3.md appendix, DECISIONS 102): accurate for
// v3 with defaults, and free of details a configuration can change.
const V3_README = `# Backlog

This folder is a NanoJira backlog: one Markdown file per element (epics,
tasks, subtasks). Where the files lie is set by \`layout\` in
\`.nanojira/config.json\` — by default one folder per type (\`epics/\`,
\`tasks/\`, \`subtasks/\`), with finished work in \`archive/\`.

Every file has a frontmatter block between \`---\` lines and a free Markdown
body. The frontmatter is the truth; the body belongs to you, except for the
\`# H1\` (mirrors \`title\`), the \`## Notes\` section written by \`nj note\`, and
the sections \`nj new\`/\`nj set\` write when asked to.

An element is *ready to work* when its status is the first configured status,
all \`depends_on\` targets are done, it carries no error, and it has a
non-empty \`## Description\` (plus \`## Acceptance Criteria\` for tasks and
subtasks). A heading with nothing under it counts as absent — that is
deliberate.

\`STATUS.md\` is a generated overview by status. Do not edit it; \`nj\` rewrites
it after every change, and \`nj doctor --fix\` repairs it.

\`.nanojira/\` holds what only \`nj\` needs: the configuration and \`ids/\`, one
empty tombstone file per allocated ID. Both are versioned and must be
committed — the tombstones are what guarantee IDs are never reused. Do not
delete them. Only \`.nanojira/index.json\` (a cache) and temporary files are
ignored.

Useful commands: \`nj\`, \`nj list --ready\`, \`nj show --id=…\`,
\`nj new --type=task --parent=EPIC-001 --title="…"\`, \`nj doctor\`.
`;

export { V2_README, V3_README };
