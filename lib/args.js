'use strict';

// Command-line flag parsing.

const fs = require('fs');
const { SECTION_ROLES } = require('./constants.js');
const { fail } = require('./output.js');
const { normalizeSectionContent } = require('./parse.js');

// -------------------------------------------------------------- arg parsing

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (const a of argv) {
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const value = eq === -1 ? true : a.slice(eq + 1);
      if (name === 'depends-on') name = 'depends_on';
      flags.set(name, value);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function checkFlags(flags, allowedFields, allowedControls, isWrite) {
  for (const name of flags.keys()) {
    if (allowedControls.has(name)) continue;
    if (allowedFields.includes(name)) continue;
    const suffix = isWrite ? ' Nothing written.' : '';
    const known = allowedFields.length > 0
      ? `Known fields: ${allowedFields.join(', ')}`
      : `Known flags: ${Array.from(allowedControls).sort().map((f) => '--' + f).join(', ')}`;
    fail('unknown_field', `unknown field '${name}'.${suffix}`, known);
  }
}

function flagString(flags, name) {
  const v = flags.get(name);
  if (v === undefined) return undefined;
  if (v === true) fail('missing_value', `--${name} needs a value (use --${name}=…)`);
  return v;
}

function parseListFlag(flags, name) {
  const v = flagString(flags, name);
  if (v === undefined) return undefined;
  if (v === '') return [];
  const items = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
  for (const it of items) {
    if (it.includes(']')) fail('invalid_value', `--${name.replace('_', '-')} item '${it}' contains ']', which is not accepted on the command line`);
  }
  return items;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) {
    fail('invalid_value', `cannot read stdin — ${e.message}`, 'pipe the text in, or pass a path with --<role>-file=<path>');
  }
}

// Value sources per role are mutually exclusive, and only one role may read
// stdin — a stream can be drained once (§ 9). Everything is validated before
// the first read, so a rejected invocation consumes nothing and writes nothing.
function readSectionFlags(flags) {
  const src = new Map();
  for (const role of SECTION_ROLES) {
    const inline = flagString(flags, role);
    const file = flagString(flags, role + '-file');
    if (inline !== undefined && file !== undefined) {
      fail('invalid_value', `--${role} and --${role}-file are mutually exclusive. Nothing written.`,
        `pass the text with --${role}=… or the path with --${role}-file=…`);
    }
    if (inline !== undefined) src.set(role, { inline });
    else if (file !== undefined) src.set(role, { file });
  }
  const viaStdin = SECTION_ROLES.filter((r) => src.has(r) && src.get(r).file === '-');
  if (viaStdin.length > 1) {
    fail('invalid_value', `--${viaStdin[0]}-file=- and --${viaStdin[1]}-file=- both read stdin, which can only be consumed once. Nothing written.`,
      'read one role from a file or pass it inline');
  }

  const wanted = new Map();
  for (const role of SECTION_ROLES) {
    if (!src.has(role)) continue;
    const s = src.get(role);
    if (s.inline !== undefined) { wanted.set(role, normalizeSectionContent(s.inline)); continue; }
    if (s.file === '-') { wanted.set(role, normalizeSectionContent(readStdin())); continue; }
    let raw;
    try { raw = fs.readFileSync(s.file, 'utf8'); } catch (e) {
      fail('not_found', `--${role}-file: cannot read '${s.file}' — ${e.message}. Nothing written.`,
        'give a readable path, or `-` to read stdin');
    }
    wanted.set(role, normalizeSectionContent(raw));
  }
  return wanted;
}

module.exports = { parseArgs, checkFlags, flagString, parseListFlag, readSectionFlags };
