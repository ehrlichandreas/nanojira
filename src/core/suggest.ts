'use strict';

// Did-you-mean (§ 9 "Did-you-mean", DECISIONS 158 EV-3): a suggestion for
// the HINT only, never the message or the accepted vocabulary itself — an
// invalid --type/--status/--priority value stays invalid_value exactly as
// before. Shared by every call site that already builds a "Known <field>:
// ..." hint, so the ordering rule (synonym first, then edit distance) and
// the tie-breaking discipline live in exactly one place.

import { osaDistance, nearestMatch, listHint } from './kernel.ts';

type VocabField = 'type' | 'status' | 'priority';

// A tiny, fixed table, checked first and verbatim regardless of edit
// distance ("medium" is six edits from "normal" — a distance rule alone
// would never catch it).
const SYNONYMS: Record<VocabField, Record<string, string>> = {
  type: {},
  status: {},
  priority: { medium: 'normal' },
};

const FIELD_LABEL: Record<VocabField, string> = { type: 'types', status: 'statuses', priority: 'priorities' };

// `osaDistance`, `nearestMatch` (DECISIONS 160 addendum) and `listHint`
// live in the project-neutral kernel (DECISIONS 231).

/**
 * The one suggestion, or null when none is unambiguous (§ 9, DECISIONS
 * 160): the synonym table first, verbatim; otherwise `nearestMatch`.
 */
function suggestValue(field: VocabField, value: string, allowed: string[]): string | null {
  const synonym = SYNONYMS[field][value];
  if (synonym !== undefined && allowed.includes(synonym)) return synonym;
  return nearestMatch(value, allowed);
}

/** The hint text every `unknown <field> '<value>'` failure already builds,
 * with a leading "did you mean '<value>'?" sentence when one is found —
 * the `Known <field>: ...` list itself is unchanged in content and order. */
function valueHint(field: VocabField, value: string, allowed: string[]): string {
  const known = `Known ${FIELD_LABEL[field]}: ${allowed.join(', ')}`;
  const suggestion = suggestValue(field, value, allowed);
  return suggestion === null ? known : `did you mean '${suggestion}'? ${known}`;
}

export type { VocabField };
export { suggestValue, valueHint, listHint, nearestMatch, osaDistance };
