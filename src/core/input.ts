'use strict';

// `--input` JSON plans for `new`/`set` (§ 9, DECISIONS 171 A, 172): reading
// the raw JSON source, shared by both commands.

import * as fs from 'fs';
import { fail } from './output.ts';

/** `--input=-` reads stdin; `--input=<path>` reads a file, relative to the
 * working directory (§ 9) — the same convention `--description-file` already
 * has. An unreadable path is `not_found`, matching `--<role>-file`. */
function readInputText(value: string): string {
  if (value === '-') {
    try { return fs.readFileSync(0, 'utf8'); } catch (e: any) {
      return fail('invalid_value', `cannot read stdin — ${e.message}`, 'pipe the JSON in, or pass a path with --input=<path>');
    }
  }
  try { return fs.readFileSync(value, 'utf8'); } catch (e: any) {
    return fail('not_found', `--input: cannot read '${value}' — ${e.message}`);
  }
}

/** Text that does not parse as JSON is `invalid_value` (§ 9). */
function parseInputJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch (e: any) {
    return fail('invalid_value', `--input is not valid JSON — ${e.message}`);
  }
}

export { readInputText, parseInputJson };
