// Shared type-only declarations.
//
// This file is never `require()`d — every consumer reaches it only through
// `import type {...} from './types.ts'`, which erases completely under
// `erasableSyntaxOnly` and creates no runtime dependency edge for esbuild to
// follow. That is load-bearing, not incidental: esbuild classifies any file
// as an ES module the moment it contains an `export` (or `import`) statement
// of its own, REGARDLESS of whether that statement survives type-erasure —
// `export type`/`export interface` count just as much as a real value
// export. A file esbuild treats as ESM but which also does `module.exports =
// {...}` at runtime (our CommonJS convention throughout, required by Node's
// native .ts execution) gets wrapped in esbuild's lazy `__esm`/`_exports`
// machinery expecting real, statically-visible named exports to register —
// and since ours are all type-only and erase to nothing, that registration
// never happens, so every consumer destructuring a value out of `require()`
// silently gets `undefined` in the bundled dist/nj (found live: `NEW_FIELDS`
// was `undefined` in dist/nj, `Cannot read properties of undefined (reading
// 'includes')` in checkFlags, even though `node core/constants.ts` alone was
// fine and `tsc` reported zero errors — the bug is bundler-only, and this
// file's separation from constants.ts/derive.ts is the fix: neither of those
// two files may have an `export` of their own again).

// `parent` is branded (`NonEmptyString | null`): empty or whitespace
// normalises to `null`, never `''` (see deriveParent in load.ts). Under
// JSDoc, `string|null` let `el.parent = ''` through silently -- a plain `''`
// literal is a `string`, so it satisfied the annotation without saying
// anything false. `NonEmptyString` adds a property no ordinary string has,
// so `''` (or any bare `string`) is no longer assignable; only the one place
// that performs the actual check (`parent.trim() !== ''`) may cast to it.
//
// `assignee` stays plain `string`, never `null` (a missing one is `''`, on
// purpose -- cmdSet's delete-on-`--assignee=` depends on that); it is NOT
// branded, because unlike `parent` nothing currently reads `''` as a
// distinct "root" case the way `childMap` reads `parent === null`.
export type NonEmptyString = string & { readonly __nonEmpty: unique symbol };

// `Element` used to be one flat interface, mutated by nine deriver functions
// each called from loadElement with a cast to the full shape -- Verifier II
// built the mutant that shows why that is not enough: cast to `Element` at
// EVERY call site accepts the derivers in ANY order, first call included,
// because the cast asserts the full shape regardless of how little of it
// actually exists yet. Staged instead: each deriver's parameter type is
// exactly what the PREVIOUS ones have established, and its return type adds
// only its own field. Swap two derivers and the earlier one's return type no
// longer satisfies the later one's parameter type -- a real compile error,
// not an asserted-away one. The chain mirrors loadElement's calling order
// exactly (deriveId, deriveType, deriveTitle, deriveStatus, deriveParent,
// deriveOptionals, deriveTimestamps, deriveArchiveState, deriveBody).

/** Set directly in loadElement, before any deriver runs. */
export interface Skeleton {
  file: string;
  /** The file's directory relative to the backlog, `/`-separated; `''` at the top. */
  folder: string;
  raw: string | null;
  body: string;
  fields: Map<string, string | string[]>;
  order: string[];
  parsed: boolean;
  readable: boolean;
  detail: { code: string; line?: number; message: string }[];
  problems: Set<string>;
  archived: boolean;
}

export interface WithId extends Skeleton { id: string }
export interface WithType extends WithId { type: string | null }
export interface WithTitle extends WithType { title: string }
export interface WithStatus extends WithTitle { status: string }
export interface WithParent extends WithStatus { parent: NonEmptyString | null }
export interface WithOptionals extends WithParent { priority: string; assignee: string; tags: string[]; depends_on: string[] }
export interface WithTimestamps extends WithOptionals { created: string; updated: string }
/** deriveArchiveState's result -- also deriveBody's input AND output: it adds no field of its own. */
export interface WithArchiveState extends WithTimestamps { archivedAt: string | null }

/**
 * The complete shape loadElement/unreadableElement produce. Identical to
 * `WithArchiveState` plus the two fields `attachGraph` (load.ts) sets
 * afterwards, on the first graph only -- never present on a freshly loaded
 * element, so they stay optional rather than folded into the staged chain.
 */
export interface Element extends WithArchiveState {
  byId?: Map<string, Element>;
  children?: Element[];
}

export interface ParsedFile {
  fields: Map<string, string | string[]>;
  order: string[];
  body: string;
  problems: { code: string; line?: number; message: string }[];
  parsed: boolean;
}

/** § 4: where element files lie. */
export type Group = 'type' | 'hierarchy' | 'flat';

/** § 5 `layout.folders`, keyed by role; every name already validated. */
export interface Folders { epics: string; tasks: string; subtasks: string; archive: string }

export interface Layout {
  group: Group;
  folders: Folders;
  /** Validated now, acted on from V3-3 (STATUS.md). */
  statusFile: boolean;
}

export interface Config {
  schema: number;
  statuses: string[];
  sections: { description: string[]; acceptance: string[] };
  layout: Layout;
}

/** One walk over the backlog (layout.ts `scanBacklog`). */
export interface Scan {
  /** Every element file in scan order, with its folder relative to the backlog (`/`-separated, `''` at the top). */
  files: { file: string; folder: string }[];
  /** Every directory that can hold element or temp files, bookkeeping last. */
  dirs: string[];
  /** Folders that exist but cannot be listed, with the OS reason — never skipped silently. */
  unreadable: { dir: string; reason: string }[];
}

export interface Context {
  backlog: string;
  cfg: Config;
  configErrors: string[];
  elements: Element[];
  /** The walk the elements were loaded from; `doctor` reads its folders too. */
  scan: Scan;
  /** `Date.now()` just before the first element file was read (DECISIONS 103). */
  loadedAt: number;
  /** A v2 (pre-V3-4) backlog: bookkeeping read from the top-level legacy places. */
  legacy: boolean;
  /** The absolute tombstone folder in use — `.nanojira/ids` or, under `legacy`, `.ids` (§ 8, DECISIONS 95 B22). */
  idsDir: string;
  /** memoised by descendants() -- see load.ts, DECISIONS 81 */
  kids?: Map<string, Element[]>;
}

/** A bare `--flag` sets `true`; `false` never occurs. */
export type Flags = Map<string, string | true>;

export interface Finding {
  code: string;
  severity: string | null;
  element?: string;
  file: string;
  line?: number;
  message: string;
}

export interface EntryJson {
  id: string;
  type: string | null;
  parent?: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  tags: string[];
  depends_on: string[];
  created: string;
  updated: string;
  archived?: string;
  file: string;
  _problems: string[];
}
