'use strict';

// Constants: types, fields, statuses, severities.

// ---------------------------------------------------------------- constants

const TYPE_PREFIX = { epic: 'EPIC', task: 'TSK', subtask: 'SUB' };
const PREFIX_TYPE = { EPIC: 'epic', TSK: 'task', SUB: 'subtask' };
const TYPE_DIR = { epic: 'epics', task: 'tasks', subtask: 'subtasks' };
const TYPES = ['epic', 'task', 'subtask'];
const PARENT_TYPE = { task: 'epic', subtask: 'task' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_WEIGHT = { urgent: 4, high: 3, normal: 2, low: 1 };

const FIELD_ORDER = ['id', 'type', 'parent', 'title', 'status', 'priority',
  'assignee', 'tags', 'depends_on', 'created', 'updated', 'archived'];
const LIST_FIELDS = new Set(['tags', 'depends_on']);
// Body sections are addressed by ROLE (§ 5), never by heading name: the heading
// written is the role's first configured name (§ 9).
const SECTION_ROLES = ['description', 'acceptance'];
const SECTION_FLAGS = ['description', 'description-file', 'acceptance', 'acceptance-file'];
const SETTABLE_FIELDS = ['title', 'status', 'priority', 'assignee', 'tags', 'depends_on'].concat(SECTION_FLAGS);
const NEW_FIELDS = ['type', 'parent', 'title', 'status', 'priority', 'assignee', 'tags', 'depends_on'].concat(SECTION_FLAGS);

const DEFAULT_CONFIG = {
  schema: 1,
  statuses: ['todo', 'doing', 'blocked', 'review', 'done'],
  sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] },
};

// Closed problem vocabulary (§ 7). severity null === workflow-only code.
const SEVERITY = {
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
  'config:invalid': 'error',
};

const BLOCKS_READY = new Set([
  'frontmatter:unreadable', 'file:unreadable', 'duplicate_id', 'missing:title', 'id:mismatch',
  'type:folder', 'parent:dangling', 'parent:cycle', 'parent:hierarchy',
  'depends_on:dangling', 'depends_on:cycle', 'unknown:status',
  'done:open_children', 'archive:not_done', 'archive:split',
  'incomplete:description', 'incomplete:acceptance',
]);

const BACKLOG_LEVEL = new Set(['backlog:stray_tmp', 'backlog:ids_missing', 'config:invalid']);

module.exports = { TYPE_PREFIX, PREFIX_TYPE, TYPE_DIR, TYPES, PARENT_TYPE, PRIORITIES, PRIORITY_WEIGHT, FIELD_ORDER, LIST_FIELDS, SECTION_ROLES, SETTABLE_FIELDS, NEW_FIELDS, DEFAULT_CONFIG, SEVERITY, BLOCKS_READY, BACKLOG_LEVEL };
