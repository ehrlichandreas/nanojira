'use strict';

// Configuration and backlog discovery.

const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('./constants.js');
const { fail } = require('./output.js');

// ------------------------------------------------------------ configuration

function validateConfig(obj) {
  const errs = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return ['configuration must be a JSON object'];
  }
  if (obj.schema !== undefined && obj.schema !== 1) errs.push(`unsupported schema ${JSON.stringify(obj.schema)} (expected 1)`);
  const st = obj.statuses;
  if (!Array.isArray(st)) errs.push('statuses must be an array');
  else {
    if (st.length < 2) errs.push('statuses needs at least two entries');
    if (st.some((s) => typeof s !== 'string' || !/^[a-z_]+$/.test(s))) errs.push('every status must match [a-z_]+');
    if (new Set(st).size !== st.length) errs.push('statuses must be unique');
    if (st.length > 0 && st[st.length - 1] !== 'done') errs.push("the last status must be 'done'");
  }
  const sec = obj.sections;
  if (sec === null || typeof sec !== 'object' || Array.isArray(sec)) errs.push('sections must be an object');
  else {
    for (const role of ['description', 'acceptance']) {
      const list = sec[role];
      if (!Array.isArray(list) || list.length === 0 || list.some((n) => typeof n !== 'string' || n.trim() === '')) {
        errs.push(`sections.${role} must be a non-empty array of heading names`);
      }
    }
  }
  return errs;
}

function loadConfig(backlog) {
  const file = path.join(backlog, '.nanojira.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { config: DEFAULT_CONFIG, errors: [`.nanojira.json is missing`] };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { config: DEFAULT_CONFIG, errors: [`.nanojira.json is not valid JSON: ${e.message}`] };
  }
  const errors = validateConfig(obj);
  if (errors.length > 0) return { config: DEFAULT_CONFIG, errors };
  return {
    config: { schema: 1, statuses: obj.statuses.slice(), sections: { description: obj.sections.description.slice(), acceptance: obj.sections.acceptance.slice() } },
    errors: [],
  };
}

// ----------------------------------------------------------------- discover

function findBacklog(lenient) {
  const env = process.env.NJ_BACKLOG;
  if (env !== undefined && env !== '') {
    const dir = path.resolve(env);
    if (!isDir(dir)) fail('invalid_backlog_env', `NJ_BACKLOG points at '${dir}', which is not a directory`);
    if (!lenient && !fs.existsSync(path.join(dir, '.nanojira.json'))) {
      fail('backlog_without_config', `no .nanojira.json in NJ_BACKLOG '${dir}'`, 'run `nj doctor` for details, or `nj init` to create a backlog');
    }
    return dir;
  }
  let dir = process.cwd();
  let headless = null;
  for (;;) {
    const candidate = path.join(dir, 'backlog');
    if (fs.existsSync(path.join(candidate, '.nanojira.json'))) return candidate;
    if (lenient && isDir(candidate)) return candidate;
    if (headless === null && isDir(candidate)) headless = candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // A backlog folder without its config is a different failure from "none at
  // all" and must say so rather than send the caller hunting (§ 4).
  if (headless !== null) {
    fail('backlog_without_config', `${headless} exists but has no .nanojira.json`,
      'run `nj doctor` — it tolerates the missing file and reports config:invalid');
  }
  fail('no_backlog', 'no backlog found (looked for backlog/.nanojira.json upward from the working directory)',
    'run `nj init` to create one, or set NJ_BACKLOG');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listMd(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.md')).sort().map((n) => path.join(dir, n));
}

module.exports = { loadConfig, findBacklog, listMd };
