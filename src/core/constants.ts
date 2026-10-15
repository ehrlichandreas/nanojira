'use strict';

// Constants: fields, statuses, severities. Shared types live in types.ts —
// see there for why: this file must not carry an `export` of its own, or
// esbuild bundles it broken (dist/nanojira gate caught this; do not reintroduce).

import type { Config } from './types.ts';

// ---------------------------------------------------------------- constants

const TYPE_PREFIX: Record<string, string> = { epic: 'EPIC', task: 'TSK', subtask: 'SUB' };
const PREFIX_TYPE: Record<string, string> = { EPIC: 'epic', TSK: 'task', SUB: 'subtask' };
const TYPES = ['epic', 'task', 'subtask'];
const PARENT_TYPE: Record<string, string> = { task: 'epic', subtask: 'task' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

const FIELD_ORDER = ['id', 'type', 'parent', 'title', 'status', 'priority',
  'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived'];
const LIST_FIELDS = new Set(['tags', 'depends_on']);
// Body sections are addressed by ROLE (§ 5), never by heading name: the heading
// written is the role's first configured name (§ 9).
const SECTION_ROLES: ('description' | 'acceptance')[] = ['description', 'acceptance'];
const SECTION_FLAGS = ['description', 'description-file', 'acceptance', 'acceptance-file'];
const SETTABLE_FIELDS = ['title', 'parent', 'status', 'priority', 'assignee', 'tags', 'depends_on'].concat(SECTION_FLAGS);
const NEW_FIELDS = ['type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on'].concat(SECTION_FLAGS);

// Folder-name roles per element type; `layout.folders` maps each role (and
// `archive`) to the name actually used (§ 5).
const TYPE_FOLDER_ROLE: Record<string, 'epics' | 'tasks' | 'subtasks'> = { epic: 'epics', task: 'tasks', subtask: 'subtasks' };
const FOLDER_ROLES: ('epics' | 'tasks' | 'subtasks' | 'archive')[] = ['epics', 'tasks', 'subtasks', 'archive'];
const GROUPS = ['type', 'hierarchy', 'flat'];

// The v3 bookkeeping lives in one hidden folder; the v2 (legacy) places are
// at the backlog's top level. `.ids` always means the legacy folder; the v3
// one is `.nanojira/ids` (§ 4, § 8, DECISIONS 95 B22).
const V3_DIR_REL = '.nanojira';
const V3_CONFIG_REL = '.nanojira/config.json';
const V3_IDS_REL = '.nanojira/ids';
const V3_INDEX_REL = '.nanojira/index.json';
const LEGACY_CONFIG_REL = '.nanojira.json';
const LEGACY_IDS_REL = '.ids';
const LEGACY_INDEX_REL = '.nanojira-index.json';

const DEFAULT_CONFIG: Config = {
  schema: 1,
  statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
  sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
  layout: {
    group: 'type',
    folders: { epics: 'epics', tasks: 'tasks', subtasks: 'subtasks', archive: 'archive' },
    statusFile: true,
    tagsFile: true,
  },
  claims: { staleAfterHours: 24 },
  problems: { ignore: [] },
  ids: { shardSize: 0 },
};

// Zero-padded width for a bucket directory name under `ids/<TYPE>/` (§ 8).
// Fixed forever: `allocateId`'s "highest bucket via a sorted listing" trick
// (store.ts) only works when every bucket name in a directory has the same
// width, so this can never grow or shrink once chosen. At `shardSize=1` that
// is still room for 999,999 buckets per type -- effectively unreachable.
const IDS_BUCKET_PAD = 6;

// Closed problem vocabulary (§ 7). severity null === workflow-only code.
const SEVERITY: Record<string, string | null> = {
  'frontmatter:unreadable': 'error',
  'file:unreadable': 'error',
  'duplicate_id': 'error',
  'missing:title': 'error',
  'missing:status': 'warning',
  'missing:created': 'warning',
  'missing:updated': 'warning',
  'id:derived': 'warning',
  'id:mismatch': 'error',
  'type:derived': 'warning',
  'type:folder': 'error',
  'layout:misplaced': 'error',
  'parent:orphaned': 'warning',
  'parent:dangling': 'error',
  'parent:cycle': 'error',
  'parent:hierarchy': 'error',
  'depends_on:dangling': 'error',
  'depends_on:cycle': 'error',
  'unknown:status': 'warning',
  'unknown:priority': 'warning',
  'done:open_children': 'warning',
  'archive:not_done': 'error',
  'archive:split': 'error',
  'title:h1_mismatch': 'warning',
  'incomplete:description': null,
  'incomplete:acceptance': null,
  'active_refs_archived': null,
  'id:no_tombstone': 'warning',
  'backlog:stray_tmp': 'warning',
  'backlog:ids_missing': 'error',
  'backlog:unreadable_dir': 'error',
  'config:invalid': 'error',
  'claim:mismatch': 'warning',
  'claim:orphaned': 'warning',
  'claim:stale': 'warning',
  'backlog:claims_unignored': 'warning',
  'acceptance:no_checkbox': 'warning',
  'done:no_acceptance': 'warning',
  'done:open_acceptance': 'warning',
  'config:unknown_key': 'warning',
  'config:unknown_code': 'warning',
};

const BLOCKS_READY = new Set([
  'frontmatter:unreadable', 'file:unreadable', 'duplicate_id', 'missing:title', 'id:mismatch',
  'type:folder', 'layout:misplaced', 'parent:dangling', 'parent:cycle', 'parent:hierarchy',
  'depends_on:dangling', 'depends_on:cycle', 'unknown:status',
  'done:open_children', 'archive:not_done', 'archive:split',
  'incomplete:description', 'incomplete:acceptance',
]);

const BACKLOG_LEVEL = new Set(['backlog:stray_tmp', 'backlog:ids_missing', 'backlog:unreadable_dir', 'config:invalid', 'config:unknown_key', 'config:unknown_code']);

export { TYPE_PREFIX, PREFIX_TYPE, TYPE_FOLDER_ROLE, FOLDER_ROLES, GROUPS, TYPES, PARENT_TYPE, PRIORITIES, PRIORITY_WEIGHT, FIELD_ORDER, LIST_FIELDS, SECTION_ROLES, SETTABLE_FIELDS, NEW_FIELDS, DEFAULT_CONFIG, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL, V3_DIR_REL, V3_CONFIG_REL, V3_IDS_REL, V3_INDEX_REL, LEGACY_CONFIG_REL, LEGACY_IDS_REL, LEGACY_INDEX_REL, IDS_BUCKET_PAD };
