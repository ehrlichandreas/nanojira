'use strict';

// The acting name (§ 9 "The acting name"): who is acting, for `nanojira note` and
// `nanojira claim`/`nanojira release`. --as outranks NJ_AUTHOR. "Empty counts as unset"
// (DECISIONS 89) applies only to NJ_AUTHOR; for a name "from either source",
// § 9 requires non-empty, so an empty --as= is invalid_value, not unset
// (DECISIONS 119). A name is valid when, trimmed of leading/trailing spaces
// and tabs only, it is non-empty, a single line (any \n or \r left, trailing
// included, is multi-line), and has no ':' -- Unicode spaces are literal,
// not trimmed.

import type { Flags } from './types.ts';

import { flagString } from './args.ts';
import { fail } from './output.ts';

function validActorName(raw: string): string | null {
  const trimmed = raw.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (trimmed === '' || /[\n\r]/.test(trimmed) || trimmed.includes(':')) return null;
  return trimmed;
}

/**
 * Resolves `--as` (when the command has it) over `NJ_AUTHOR`, failing on an
 * invalid name from either source. `required` is the one difference between
 * `nanojira note` (false: falls back to `assignee`/`?`, § 10) and
 * `nanojira claim`/`nanojira release` (true: `missing_argument` when neither is set,
 * § 12a).
 */
function resolveActingName(flags: Flags, required: boolean): string | null {
  const asRaw = flagString(flags, 'as');
  if (asRaw !== undefined) {
    const name = validActorName(asRaw);
    if (name === null) fail('invalid_value', `invalid --as '${asRaw}' (must be non-empty after trimming spaces/tabs, a single line, and contain no ':')`);
    return name;
  }
  const envRaw = process.env.NJ_AUTHOR;
  if (envRaw !== undefined && envRaw !== '') {
    const name = validActorName(envRaw);
    if (name === null) {
      fail('invalid_env', `invalid NJ_AUTHOR '${envRaw}' (must be non-empty after trimming spaces/tabs, a single line, and contain no ':')`,
        'fix NJ_AUTHOR, or pass --as=<name>, which outranks it');
    }
    return name;
  }
  if (required) fail('missing_argument', 'an acting name is required: pass --as=<name> or set NJ_AUTHOR');
  return null;
}

/**
 * `list --ready` condition 5 (§ 9, § 12 "Claims"): reads never fail on the
 * acting name -- an invalid or absent `NJ_AUTHOR` is treated as no name,
 * never an error. `list` has no `--as`.
 */
function actingNameForRead(): string | null {
  const envRaw = process.env.NJ_AUTHOR;
  if (envRaw === undefined || envRaw === '') return null;
  return validActorName(envRaw);
}

export { validActorName, resolveActingName, actingNameForRead };
