'use strict';

// Did-you-mean (§ 9 "Did-you-mean", DECISIONS 158 EV-3): a suggestion for
// the HINT only, never the message or the accepted vocabulary itself — an
// invalid --type/--status/--priority value stays invalid_value exactly as
// before. Shared by every call site that already builds a "Known <field>:
// ..." hint, so the ordering rule (synonym first, then edit distance) and
// the tie-breaking discipline live in exactly one place.

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

/**
 * Optimal string alignment distance (DECISIONS 160 addendum): insert,
 * delete, substitute (each cost 1), plus an adjacent transposition — also
 * cost 1, not two substitutions — since a swapped pair of letters is the
 * most common typo and plain Levenshtein otherwise puts "hgih" two edits
 * from "high" instead of one, pushing it over the <= 4-character
 * threshold for no good reason. "Optimal string alignment" (unlike full
 * Damerau-Levenshtein) never edits the same substring twice, which is
 * all a single did-you-mean comparison ever needs.
 */
function osaDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d.push([i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[m][n];
}

/**
 * The one suggestion, or null when none is unambiguous (§ 9, DECISIONS
 * 160): the synonym table first, verbatim; otherwise the allowed value(s)
 * at the smallest OSA distance, only when that distance is at or under
 * the length-dependent threshold — <= 1 for a value of <= 4 characters,
 * <= 2 otherwise, since for a short word distance 2 replaces half of it
 * (noise, not a hint) — AND exactly one allowed value reaches it. A tie,
 * or everything over the threshold, suggests nothing ("never guess wrong"
 * over "always say something").
 */
function suggestValue(field: VocabField, value: string, allowed: string[]): string | null {
  const synonym = SYNONYMS[field][value];
  if (synonym !== undefined && allowed.includes(synonym)) return synonym;
  const threshold = value.length <= 4 ? 1 : 2;
  let best: string[] = [];
  let bestDist = Infinity;
  for (const v of allowed) {
    const d = osaDistance(value, v);
    if (d < bestDist) { bestDist = d; best = [v]; } else if (d === bestDist) best.push(v);
  }
  return bestDist <= threshold && best.length === 1 ? best[0] : null;
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
export { suggestValue, valueHint };
