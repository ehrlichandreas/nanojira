'use strict';

// Storage: clock, tombstones, atomic writes.

const fs = require('fs');
const path = require('path');
const { TYPE_PREFIX } = require('./constants.js');
const { fail, hardExit } = require('./output.js');
const { serialize } = require('./parse.js');

// -------------------------------------------------------------------- clock

function nowIso() {
  const pinned = process.env.NJ_NOW;
  if (pinned !== undefined && pinned !== '') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pinned) || Number.isNaN(Date.parse(pinned))) {
      fail('invalid_env', `invalid NJ_NOW '${pinned}' (expected ISO-8601 UTC, e.g. 2026-09-21T18:02:44Z)`);
    }
    return pinned;
  }
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mtimeIso(file) {
  try {
    return new Date(fs.statSync(file).mtime).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return '1970-01-01T00:00:00Z';
  }
}

// A sync sleep without dependencies — only used by the before-compare fault hook.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// --------------------------------------------------------------- tombstones

function readTombstones(backlog) {
  const dir = path.join(backlog, '.ids');
  const out = new Set();
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n.startsWith('.')) continue;
    out.add(n);
  }
  return out;
}

function allocateId(backlog, type, elements) {
  const prefix = TYPE_PREFIX[type];
  const dir = path.join(backlog, '.ids');
  fs.mkdirSync(dir, { recursive: true });

  let max = 0;
  const consider = (id) => {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  };
  for (const t of readTombstones(backlog)) consider(t);
  for (const el of elements) consider(el.id);

  let n = max + 1;
  for (let i = 0; i < 100; i++) {
    const id = prefix + '-' + String(n).padStart(3, '0');
    try {
      fs.closeSync(fs.openSync(path.join(dir, id), 'wx'));
      return id;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      n++;
    }
  }
  hardExit('id_allocation_failed', `nj: id allocation failed after 100 retries (${prefix})`);
}

// ------------------------------------------------------------ atomic writes

function atomicWrite(target, content) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.nj-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  const fault = process.env.NJ_FAULT;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    if (fault === 'after-tmp-write') {
      fs.closeSync(fd);
      hardExit('fault:after-tmp-write', 'nj: aborted at fault injection point after-tmp-write');
    }
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (fault === 'before-rename') {
    hardExit('fault:before-rename', 'nj: aborted at fault injection point before-rename');
  }
  fs.renameSync(tmp, target);
}

// Compare-before-write, shared by `set`, `note` and `archive` (§ 12) so that
// NJ_FAULT=before-compare covers all three.
// `hint` is caller-specific: `archive` takes no `--force`, so pointing at it
// there would name a flag the command rejects as unknown_field.
function compareGuard(el, force, backlog, hint) {
  // Fault hook: hold between the first read and the compare re-read so a test
  // can deterministically change the target underneath us (§ 12).
  if (process.env.NJ_FAULT === 'before-compare' && backlog) {
    const marker = path.join(backlog, '.nj-fault-go');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(marker)) {
      if (Date.now() >= deadline) {
        hardExit('fault:before-compare', 'nj: before-compare timed out after 10s waiting for .nj-fault-go');
      }
      sleepMs(50);
    }
  }
  if (force) return;
  let current;
  try { current = fs.readFileSync(el.file, 'utf8'); } catch { current = null; }
  if (current !== el.raw) {
    fail('changed_in_parallel', `${el.id} changed in parallel, please run again`,
      hint === undefined ? 'use --force to overwrite deliberately' : hint);
  }
}

function guardedWrite(el, content, force, backlog) {
  compareGuard(el, force, backlog);
  atomicWrite(el.file, content);
}

function renderElement(el, fieldOverrides, bodyOverride) {
  const fields = new Map(el.fields);
  for (const [k, v] of fieldOverrides) {
    if (v === undefined) fields.delete(k);
    else fields.set(k, v);
  }
  const order = el.order.slice();
  for (const k of fields.keys()) if (!order.includes(k)) order.push(k);
  return serialize(fields, order, bodyOverride === undefined ? el.body : bodyOverride);
}

module.exports = { nowIso, mtimeIso, readTombstones, allocateId, atomicWrite, compareGuard, guardedWrite, renderElement };
