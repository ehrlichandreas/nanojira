'use strict';

// `nanojira tags`: the same tag vocabulary TAGS.md carries, on demand — a read
// command, no write side effects, works the same whether `layout.tagsFile` is
// on or off (it computes straight from the elements, same as `nanojira list
// --json` does not depend on STATUS.md either).

import type { Flags } from '../core/types.ts';

import { checkFlags } from '../core/args.ts';
import { context } from '../core/context.ts';
import { tagCounts } from '../core/tags.ts';
import { out } from '../core/output.ts';

function cmdTags(flags: Flags) {
  checkFlags(flags, [], new Set(['json']), false);
  const ctx = context(flags);
  const counts = tagCounts(ctx.elements);
  const names = Array.from(counts.keys()).sort();

  if (flags.has('json')) {
    out(JSON.stringify({ ok: true, tags: names.map((name) => ({ name, count: counts.get(name) })) }, null, 2));
    return 0;
  }
  if (names.length === 0) out('(no tags in use)');
  for (const name of names) out(`${name} (${counts.get(name)})`);
  return 0;
}

export { cmdTags };
