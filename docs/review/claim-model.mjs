#!/usr/bin/env node
// Exhaustive interleaving explorer for the `nj claim` protocol of
// docs/proposals/v3.1.md § C (commit 5d1c83d). Review artefact, not shipped,
// not part of the test suite. Findings: docs/review/claim-protocol.md.
//
//   node docs/review/claim-model.mjs            all scenarios, both variants
//   node docs/review/claim-model.mjs S4 --trace  one scenario, print traces
//
// Model. One element, one claim directory. Every filesystem call is one
// atomic step; a readdir is two steps (begin, end) and returns every entry
// present throughout plus any subset of the entries added or removed in
// between: the POSIX readdir guarantee, not APFS's (stronger, unspecified)
// behaviour. Any actor may crash before any step (scenarios with `crash`).
// A ghost log keeps every entry ever linked, with the entry its writer read
// (`base`), so pruned entries stay checkable.
//
// Variant P0 is the proposal as written. Variant P1 is the proposal with the
// fixes recommended in claim-protocol.md § 5: no live pruning (and so no
// post-check), a rollback that restores the previous entry and runs only if
// this invocation appended, doctor removes claim directories only of archived
// or removed elements, link ENOENT is a retry round.

const ROUNDS = 3; // the proposal's 100; 3 suffices to exhaust every scenario here

const VARIANTS = {
  P0: { livePrune: true, postCheck: true, rollbackRestores: false, rollbackOnlyIfAppended: false, orphanDone: true, enoent: 'unspecified' },
  P1: { livePrune: false, postCheck: false, rollbackRestores: true, rollbackOnlyIfAppended: true, orphanDone: false, enoent: 'retry' },
  P2: { livePrune: false, postCheck: false, rollbackRestores: true, rollbackOnlyIfAppended: true, orphanDone: false, enoent: 'retry', stealFinal: true },
  // P3 = P2 + idemReasserts (Verifier, claim-protocol.md § 5.6): the plain
  // "already held" idempotent read (no --status) still re-asserts via one
  // real CAS append instead of trusting the read. Closes S12's remaining
  // I1-samename gap, which P1/P2 leave open.
  P3: { livePrune: false, postCheck: false, rollbackRestores: true, rollbackOnlyIfAppended: true, orphanDone: false, enoent: 'retry', stealFinal: true, idemReasserts: true },
};

// Ops: claim {n, st (with --status), mf (mirror write may fail)}, steal {n, h, mf},
// release {n}, prune (doctor --fix 7a, live dir), orphans (doctor --fix 7a, orphaned dir),
// rmtmp (doctor --fix step 7), done (nj set --status=done), archive.
const SCENARIOS = [
  { id: 'S1', what: 'three plain claimants, crashes', crash: true,
    actors: [['A', [{ t: 'claim' }]], ['B', [{ t: 'claim' }]], ['C', [{ t: 'claim' }]]] },
  { id: 'S2', what: 'holder releases while two steal it, crashes', crash: true,
    actors: [['A', [{ t: 'claim' }, { t: 'release' }]], ['B', [{ t: 'steal', h: 'A' }]], ['C', [{ t: 'steal', h: 'A' }]]] },
  { id: 'S3', what: 'right- and wrong-holder steals, crashes', crash: true,
    actors: [['A', [{ t: 'claim' }]], ['B', [{ t: 'steal', h: 'A' }]], ['C', [{ t: 'steal', h: 'Z' }, { t: 'steal', h: 'B' }]]] },
  { id: 'S4', what: 'mirror failures and rollback racing a stealer and a claimant', crash: false,
    actors: [['A', [{ t: 'claim', mf: true }]], ['B', [{ t: 'steal', h: 'A', mf: true }]], ['C', [{ t: 'claim' }]]] },
  { id: 'S5', what: 'holder re-claims with --status and the write fails', crash: false,
    actors: [['A', [{ t: 'claim' }, { t: 'claim', st: true, mf: true }]], ['B', [{ t: 'claim' }]]] },
  { id: 'S6', what: 'live pruning racing claim/release/claim and a claimant', crash: false,
    actors: [['A', [{ t: 'claim' }, { t: 'release' }, { t: 'claim' }]], ['B', [{ t: 'claim' }, { t: 'release' }]], ['D', [{ t: 'prune' }, { t: 'prune' }]]] },
  { id: 'S7', what: 'claim on a done element, doctor --fix removes it as orphaned', crash: false, done: true,
    actors: [['A', [{ t: 'claim' }]], ['D', [{ t: 'orphans' }]], ['B', [{ t: 'claim' }]], ['C', [{ t: 'steal', h: 'A' }]]] },
  { id: 'S8', what: 'doctor --fix step 7 removes a live claimant\'s temp file', crash: false,
    actors: [['A', [{ t: 'claim' }]], ['D', [{ t: 'rmtmp' }]]] },
  { id: 'S9', what: 'archive racing a claimant and a stealer', crash: false, done: true,
    actors: [['A', [{ t: 'claim' }]], ['D', [{ t: 'archive' }]], ['B', [{ t: 'steal', h: 'A' }]]] },
  { id: 'S10', what: 'victim\'s mirror write racing its stealer\'s', crash: false,
    actors: [['A', [{ t: 'claim' }]], ['B', [{ t: 'steal', h: 'A' }]]] },
  { id: 'S11', what: 'release racing a steal, then a claimant, crashes', crash: true,
    actors: [['A', [{ t: 'claim' }, { t: 'release' }]], ['B', [{ t: 'steal', h: 'A' }]], ['C', [{ t: 'claim' }]]] },
  { id: 'S12', what: 'two processes of the same name, one rolls back', crash: false,
    actors: [['A', [{ t: 'claim' }]], ['A', [{ t: 'claim', st: true, mf: true }]], ['B', [{ t: 'steal', h: 'A' }]]] },
  // D115 (P-6): unarchive removes a leftover orphaned claim dir, the same
  // wholesale removal archive/rm use, before the first move. C is the one
  // kind of actor that can race either cleanup: it starts (passes the
  // `gone` check) before D archives, then its retry loop never re-checks
  // `gone` (the proposal's text checks `refused:archived` once, up front,
  // not on every CAS retry round) and so can land a fresh entry during
  // either D's or U's cleanup window.
  { id: 'S13', what: 'unarchive removes a leftover claim dir before the first move, racing a straggler', crash: false, done: true,
    actors: [['A', [{ t: 'claim' }]], ['D', [{ t: 'archive' }]], ['C', [{ t: 'claim' }]], ['U', [{ t: 'unarchive' }]]] },
];

// ------------------------------------------------------------------ state

function initial(sc) {
  return {
    dir: null,                         // null | {ent: [[gen, eid]...], tmp: [[tid, kind, name, target]...]}
    log: [],                           // ghost: {gen, kind, name, target, base, by, op}
    elem: { ver: 0, asg: '', done: !!sc.done, gone: false },
    A: sc.actors.map(() => ({ i: 0, pc: 'START', alive: true, bel: null })),
    out: [],                           // finished ops: {by, op, t, res, eids}
    tid: 0,
  };
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const key = (s) => JSON.stringify(s);
const entAt = (s, g) => s.dir && s.dir.ent.find((e) => e[0] === g);
const maxEnt = (s) => (s.dir && s.dir.ent.length ? s.dir.ent.reduce((a, b) => (b[0] > a[0] ? b : a)) : null);

function subsets(arr) {
  const r = [];
  for (let m = 0; m < 1 << arr.length; m++) r.push(arr.filter((_, i) => m & (1 << i)));
  return r;
}

// ---------------------------------------------------------------- stepping

// Returns [[label, nextState], ...] for actor k, or [] when it is finished.
function steps(s, k, sc, V) {
  const a = s.A[k];
  if (!a.alive) return [];
  const [name, ops] = sc.actors[k];
  const op = ops[a.i];
  if (!op) return [];
  const res = [];
  const L = (msg) => `${name}#${k}.${op.t}${op.h ? '=' + op.h : ''}: ${msg}`;
  const next = (msg, f) => { const n = clone(s); const r = f(n, n.A[k]); if (r !== false) res.push([L(msg), n]); };
  const finish = (n, b, r) => {
    n.out.push({ by: k, name, op: a.i, t: op.t, h: op.h || null, res: r, eids: b.eids || [], pre: b.pre ?? null, leftover: b.leftover });
    const keep = { i: b.i + 1, pc: 'START', alive: true, bel: b.bel };
    n.A[k] = keep;
  };
  // readdir as two steps; on end, branch over the ambiguous entries
  const readdir = (pcBegin, pcEnd, then) => {
    if (a.pc === pcBegin) return next('readdir begin', (n, b) => { b.snap = n.dir ? n.dir.ent.map((e) => e.join(':')) : []; b.pc = pcEnd; });
    const now = s.dir ? s.dir.ent.map((e) => e.join(':')) : [];
    const both = now.filter((x) => a.snap.includes(x));
    const diff = [...now.filter((x) => !a.snap.includes(x)), ...a.snap.filter((x) => !now.includes(x))];
    for (const extra of subsets(diff)) {
      const gens = [...both, ...extra].map((x) => +x.split(':')[0]);
      next(`readdir end -> {${[...new Set(gens)].sort((p, q) => p - q)}}`, (n, b) => { delete b.snap; return then(n, b, gens); });
    }
  };
  const round = (n, b, why) => {
    b.round = (b.round || 0) + 1;
    if (b.round >= ROUNDS) { finish(n, b, 'changed_in_parallel'); return; }
    b.pc = 'RD0'; b.relist = 0; void why;
  };
  const enoent = (n, b, where) => {
    if (V.enoent === 'retry') {
      // A rollback retries its OWN append (the restore it already decided
      // on) at a fresh generation — it must never fall back into RDC and
      // re-decide the operation from scratch, the same way EEXIST's
      // `if (b.rb) return finish(..., 'write_failed')` already refuses to
      // treat a rollback's lost race as "try deciding again". A fresh
      // claim/steal/release retry, which has no restore to protect, still
      // goes through the normal re-decide path.
      if (b.rb) {
        b.round = (b.round || 0) + 1;
        if (b.round >= ROUNDS) { finish(n, b, 'changed_in_parallel'); return; }
        b.pc = 'RBRD0';
        return;
      }
      round(n, b, 'enoent'); return;
    }
    // proposal: unspecified. Treat as an error exit, and record it as such.
    if (b.tid != null && n.dir) n.dir.tmp = n.dir.tmp.filter((t) => t[0] !== b.tid);
    finish(n, b, `UNSPECIFIED:ENOENT@${where}`);
  };

  // crash before any step
  if (sc.crash && a.pc !== 'START' && ['claim', 'steal', 'release'].includes(op.t)) {
    const n = clone(s);
    n.out.push({ by: k, name, op: a.i, t: op.t, h: op.h || null, res: 'crash', eids: a.eids || [], pre: a.pre ?? null });
    n.A[k] = { i: 99, pc: 'DEAD', alive: false, bel: null };
    res.push([L(`CRASH at ${a.pc}`), n]);
  }

  if (['claim', 'steal', 'release'].includes(op.t)) {
    switch (a.pc) {
      case 'START':
        next('start', (n, b) => {
          if (op.t === 'release') b.bel = null; // the agent gives the claim up as it asks to release
          if (op.t !== 'release' && n.elem.gone) return finish(n, b, 'refused:archived');
          Object.assign(b, { pc: 'RD0', round: 0, relist: 0, eids: [], rb: false });
        });
        break;
      case 'RD0': case 'RD1':
        readdir('RD0', 'RD1', (n, b, gens) => {
          const g = gens.length ? Math.max(...gens) : 0;
          b.g = g; b.pc = 'RDC';
        });
        break;
      // A rollback's own ENOENT retry: re-read just the generation, then
      // retry the SAME append (b.nk/nn/nt, already decided) — never RDC.
      case 'RBRD0': case 'RBRD1':
        readdir('RBRD0', 'RBRD1', (n, b, gens) => {
          b.g = gens.length ? Math.max(...gens) : 0;
          b.pc = n.dir ? 'TMP' : 'MKDIR';
        });
        break;
      case 'RDC': // read the content of the highest entry seen
        next(`read entry ${a.g}`, (n, b) => {
          let c = null;
          if (b.g > 0) {
            const e = entAt(n, b.g);
            if (!e) { // vanished (pruned): list again (proposal: unbounded)
              b.relist++;
              if (b.relist > 3) return finish(n, b, 'UNSPECIFIED:relist-unbounded');
              b.pc = 'RD0'; return;
            }
            b.base = e[1]; c = n.log[e[1] - 1];
          } else b.base = 0;
          b.pre = c ? { kind: c.kind, name: c.name } : null;
          const held = c && c.kind === 'claimed' ? c.name : null;
          if (op.t === 'release') {
            if (held === name) return append(n, b, 'released', name, null);
            if (held) return finish(n, b, `refused:claimed(${held})`);
            return finish(n, b, 'success');
          }
          if (op.t === 'claim' && held === name) {
            if (V.idemReasserts) return append(n, b, 'claimed', name, null); // re-assert via CAS either way; b.idem stays unset, so b.bel below uses the fresh entry
            if (op.st) { b.idem = true; b.pc = 'MREAD'; return; }
            b.bel = { eid: b.base, name };
            return finish(n, b, 'success');
          }
          if (op.t === 'steal') {
            if (held === op.h) return append(n, b, 'claimed', name, op.h);
            if (held) return finish(n, b, `refused:claimed(${held})`);
            return append(n, b, 'claimed', name, null);
          }
          if (held) return finish(n, b, `refused:claimed(${held})`);
          return append(n, b, 'claimed', name, null);
        });
        break;
      case 'MKDIR':
        next('mkdir -p', (n, b) => { if (!n.dir) n.dir = { ent: [], tmp: [] }; b.pc = 'TMP'; });
        break;
      case 'TMP':
        next('write+fsync temp', (n, b) => {
          if (!n.dir) return enoent(n, b, 'tmp');
          b.tid = ++n.tid; n.dir.tmp.push([b.tid, b.nk, b.nn, b.nt]); b.pc = 'LINK';
        });
        break;
      case 'LINK':
        next(`link temp -> ${a.g + 1}`, (n, b) => {
          const tmp = n.dir && n.dir.tmp.find((t) => t[0] === b.tid);
          if (!n.dir || !tmp) return enoent(n, b, 'link');
          if (entAt(n, b.g + 1)) { // EEXIST
            n.dir.tmp = n.dir.tmp.filter((t) => t[0] !== b.tid); b.tid = null;
            if (b.rb) return finish(n, b, 'write_failed'); // rollback meets a newer transition: leave it
            return round(n, b, 'eexist');
          }
          n.log.push({ gen: b.g + 1, kind: b.nk, name: b.nn, target: b.nt, base: b.base, by: k, op: b.i, rb: b.rb });
          const eid = n.log.length;
          n.dir.ent.push([b.g + 1, eid]); n.dir.ent.sort((p, q) => p[0] - q[0]);
          b.myEid = eid; b.myGen = b.g + 1; b.eids.push(eid); b.pc = 'UNTMP';
        });
        break;
      case 'UNTMP':
        next('unlink temp', (n, b) => {
          if (n.dir) n.dir.tmp = n.dir.tmp.filter((t) => t[0] !== b.tid);
          b.tid = null;
          if (b.rb) return finish(n, b, 'write_failed');
          if (V.postCheck) { b.pc = 'PC0'; return; }
          afterLink(n, b);
        });
        break;
      case 'PC0': case 'PC1':
        readdir('PC0', 'PC1', (n, b, gens) => {
          if (gens.some((g) => g > b.myGen)) return round(n, b, 'lost');
          afterLink(n, b);
        });
        break;
      case 'MREAD':
        next('mirror: read element', (n, b) => { b.ver = n.elem.gone ? -1 : n.elem.ver; b.pc = 'MWRITE'; });
        break;
      case 'MWRITE': {
        if (op.mf) next('mirror: FAULT', (n, b) => mirrorFailed(n, b));
        next('mirror: compare+rename', (n, b) => {
          if (n.elem.gone || n.elem.ver !== b.ver) return mirrorFailed(n, b);
          n.elem.asg = name; n.elem.ver++;
          b.bel = { eid: b.idem ? b.base : b.myEid, name };
          finish(n, b, 'success');
        });
        break;
      }
    }
    return res;

    function append(n, b, kind, nn, nt) { Object.assign(b, { nk: kind, nn, nt }); b.pc = n.dir ? 'TMP' : 'MKDIR'; }
    function afterLink(n, b) {
      if (op.t === 'release') return finish(n, b, 'success');
      b.pc = 'MREAD';
    }
    function mirrorFailed(n, b) {
      const appended = b.eids.length > 0;
      if (V.stealFinal && op.t === 'steal' && appended && b.nt) { // a landed steal is final; the mirror is reported, not undone
        b.bel = { eid: b.myEid, name };
        return finish(n, b, 'success:mirror_failed');
      }
      if (V.rollbackOnlyIfAppended && !appended) return finish(n, b, 'write_failed');
      // roll back: append after our own entry (idempotent case: after the entry we read)
      b.g = appended ? b.myGen : b.g;
      b.base = appended ? b.myEid : b.base;
      b.rb = true;
      if (V.rollbackRestores && b.pre && b.pre.kind === 'claimed') Object.assign(b, { nk: 'claimed', nn: b.pre.name, nt: null });
      else Object.assign(b, { nk: 'released', nn: name, nt: null });
      b.pc = n.dir ? 'TMP' : 'MKDIR';
    }
  }

  // ---- doctor / other commands
  switch (op.t) {
    case 'done':
      next('set status=done', (n, b) => { n.elem.done = true; n.elem.ver++; finish(n, b, 'success'); });
      break;
    case 'prune':
      if (!V.livePrune) { next('prune disabled', (n, b) => finish(n, b, 'noop')); break; }
      if (a.pc === 'START') next('start', (n, b) => { b.pc = 'RD0'; });
      else if (a.pc === 'RD0' || a.pc === 'RD1') readdir('RD0', 'RD1', (n, b, gens) => {
        const m = gens.length ? Math.max(...gens) : 0;
        b.list = [...new Set(gens)].filter((g) => g < m).sort((p, q) => p - q); b.pc = 'PU';
      });
      else if (a.pc === 'PU') {
        if (!a.list.length) next('prune done', (n, b) => finish(n, b, 'success'));
        else next(`unlink ${a.list[0]}`, (n, b) => {
          const g = b.list.shift();
          if (n.dir) n.dir.ent = n.dir.ent.filter((e) => e[0] !== g);
        });
      }
      break;
    case 'rmtmp':
      if (a.pc === 'START') next('list temps', (n, b) => { b.list = n.dir ? n.dir.tmp.map((t) => t[0]) : []; b.pc = 'RT'; });
      else if (!a.list.length) next('rmtmp done', (n, b) => finish(n, b, 'success'));
      else next(`unlink temp ${a.list[0]}`, (n, b) => { const t = b.list.shift(); if (n.dir) n.dir.tmp = n.dir.tmp.filter((x) => x[0] !== t); });
      break;
    case 'orphans': case 'archive':
      if (a.pc === 'START') next(op.t === 'archive' ? 'archive: move element' : 'check orphaned', (n, b) => {
        if (op.t === 'archive') {
          if (!n.elem.done) return finish(n, b, 'refused:open');
          n.elem.gone = true; n.elem.ver++;
          // Archiving ends every live claim relationship by design ("archive/
          // rm remove its claim"); a believer's eid is about to be unlinked by
          // this same op's cleanup below, so no actor can go on believing it
          // holds a claim on an archived element.
          for (const act of n.A) if (act.alive) act.bel = null;
        }
        const orphan = n.elem.gone || (n.elem.done && V.orphanDone);
        if (!orphan || !n.dir) return finish(n, b, op.t === 'archive' ? 'success' : 'noop');
        b.pc = 'RD0';
      });
      else if (a.pc === 'RD0' || a.pc === 'RD1') readdir('RD0', 'RD1', (n, b, gens) => { b.list = [...new Set(gens)].sort((p, q) => p - q); b.pc = 'OU'; });
      else if (a.list.length) next(`unlink ${a.list[0]}`, (n, b) => { const g = b.list.shift(); if (n.dir) n.dir.ent = n.dir.ent.filter((e) => e[0] !== g); });
      else next('rmdir', (n, b) => { if (n.dir && !n.dir.ent.length && !n.dir.tmp.length) n.dir = null; finish(n, b, 'success'); });
      break;
    // D115 (P-6): nj unarchive removes a leftover orphaned claim dir
    // wholesale, the same removal archive/rm use, while the element is
    // still archived and before the first move. Only meaningful once `gone`
    // (claim refuses on an archived element, so nothing can start fresh
    // while this runs); the cleanup is identical to archive's/orphans',
    // then the move completes (`gone` clears). `b.leftover` records whether
    // the directory was still non-empty at that instant, for checkEnd.
    case 'unarchive':
      if (a.pc === 'START') next('unarchive: remove leftover claim dir', (n, b) => {
        if (!n.elem.gone) return finish(n, b, 'noop'); // nothing archived to unarchive
        if (!n.dir) { n.elem.gone = false; n.elem.ver++; return finish(n, b, 'success'); }
        b.pc = 'RD0';
      });
      else if (a.pc === 'RD0' || a.pc === 'RD1') readdir('RD0', 'RD1', (n, b, gens) => { b.list = [...new Set(gens)].sort((p, q) => p - q); b.pc = 'OU'; });
      else if (a.list.length) next(`unlink ${a.list[0]}`, (n, b) => { const g = b.list.shift(); if (n.dir) n.dir.ent = n.dir.ent.filter((e) => e[0] !== g); });
      else next('rmdir + move', (n, b) => {
        b.leftover = !!(n.dir && (n.dir.ent.length || n.dir.tmp.length));
        if (n.dir && !n.dir.ent.length && !n.dir.tmp.length) n.dir = null;
        n.elem.gone = false; n.elem.ver++; // the move completes regardless
        finish(n, b, 'success');
      });
      break;
  }
  return res;
}

// -------------------------------------------------------------- invariants

function chainList(s) { // eids from the highest entry back to the first
  const m = maxEnt(s);
  const list = [];
  let e = m ? m[1] : 0;
  while (e) { list.push(e); e = s.log[e - 1].base; }
  return list;
}
const chainOf = (s) => new Set(chainList(s));
const holderOf = (s, eid) => (eid && s.log[eid - 1].kind === 'claimed' ? s.log[eid - 1].name : null);

// Checked in every state.
function checkAlways(s) {
  const v = [];
  if (s.elem.gone) return v; // archive/rm drop the claim by design
  const cl = chainList(s).reverse(); // oldest first
  const failed = (e) => s.out.some((o) => o.by === e.by && o.op === e.op && !o.res.startsWith('success') && o.res !== 'crash');
  const holders = new Set();
  for (const a of s.A) {
    if (!a.alive || !a.bel) continue;
    const b = a.bel;
    let i = cl.indexOf(b.eid);
    // I4: the entry a believer relies on is on the chain of the highest entry
    if (i < 0) { v.push('I4'); continue; }
    // I1: a believer loses its claim only by its own release or by a steal naming it
    let lost = false;
    for (i++; i < cl.length; i++) {
      const e = s.log[cl[i] - 1];
      if (e.kind === 'claimed' && e.name === b.name) continue;
      if (e.kind === 'released' && e.name === b.name && !e.rb) { lost = true; break; }
      if (e.kind === 'released' && e.name === b.name) { v.push('I1-samename'); lost = true; break; }
      if (e.kind === 'claimed' && e.target === b.name) {
        if (!failed(e)) { lost = true; break; }
        const nx = i + 1 < cl.length ? s.log[cl[i + 1] - 1] : null;
        if (nx && nx.rb && nx.kind === 'claimed' && nx.name === b.name && nx.by === e.by) { i++; continue; } // restored
        if (!nx && s.A[e.by].alive && s.A[e.by].i === e.op) { lost = true; break; } // its rollback is still running
        v.push('I3'); lost = true; break; // taken by a steal that reported failure
      }
      v.push('I1'); lost = true; break;
    }
    if (!lost) holders.add(b.name);
  }
  if (holders.size > 1) v.push('I1');
  // I4: every reported successful transition stays on the chain of the highest entry
  const ch = new Set(cl);
  for (const o of s.out) if (o.res.startsWith('success') && o.eids.length && !ch.has(o.eids[o.eids.length - 1])) { v.push('I4'); break; }
  return v;
}

// Checked in terminal states.
function checkEnd(s, sc) {
  const v = [];
  const ch = chainOf(s);
  for (const o of s.out) {
    if (o.res.startsWith('UNSPECIFIED')) v.push('I5');
    if (o.res.startsWith('success') || o.res === 'crash' || !['claim', 'steal', 'release'].includes(o.t)) continue;
    // I3: a failed claim/steal/release leaves the holder as it was
    const mine = o.eids.filter((e) => ch.has(e));
    if (!mine.length || s.elem.gone) continue;
    const first = mine[0], last = mine[mine.length - 1];
    const before = holderOf(s, s.log[first - 1].base);
    const after = holderOf(s, last);
    // the documented exception: the op's entry was taken over by a steal naming it
    const cl = chainList(s), at = cl.indexOf(last), succ = at > 0 ? s.log[cl[at - 1] - 1] : null;
    const stolen = succ && succ.kind === 'claimed' && succ.target === o.name;
    if (before !== after && !stolen) v.push(o.t === 'steal' ? 'I3' : 'I3x');
  }
  // I6: temps are left only by crashed actors
  const crashed = new Set(s.out.filter((o) => o.res === 'crash').map((o) => o.by));
  void crashed;
  if (s.dir && s.dir.tmp.length && !s.out.some((o) => o.res === 'crash')) v.push('I6');
  // info: claim:mismatch without any crash
  const m = maxEnt(s);
  if (m && !s.elem.gone && holderOf(s, m[1]) && holderOf(s, m[1]) !== s.elem.asg && !s.out.some((o) => o.res === 'crash')) v.push('mismatch-no-crash');
  // info (D115 P-6): unarchive's own cleanup finished with the directory
  // still non-empty — a straggler's append raced it, same as archive's own
  // cleanup can leave `claim:orphaned` behind; not a safety violation (no
  // belief is ever formed on it — claim refuses while gone, and beliefs are
  // cleared when archive sets gone, above), but it means "always starts
  // unclaimed" is, like archive's own cleanup, a best-effort wholesale
  // removal, not an atomic guarantee.
  for (const o of s.out) if (o.t === 'unarchive' && o.res === 'success' && o.leftover) v.push('unarchive-leftover');
  // info: phantom — an entry on the chain whose writer reported that it failed
  // (split by whether the entry was then taken over by a steal naming its writer)
  const cl = chainList(s);
  for (const o of s.out) {
    if (o.res.startsWith('success') || o.res === 'crash') continue;
    if (o.eids.some((e) => ch.has(e) && s.log[e - 1].rb)) continue; // rolled back on the chain
    for (const e of o.eids) {
      if (!ch.has(e) || s.log[e - 1].rb) continue;
      const at = cl.indexOf(e), succ = at > 0 ? s.log[cl[at - 1] - 1] : null;
      v.push(succ && succ.kind === 'claimed' && succ.target === o.name ? 'phantom-stolen' : 'phantom');
    }
  }
  void sc;
  return v;
}

// --------------------------------------------------------------- explorer

function explore(sc, V, wantTrace) {
  const seen = new Set();
  const found = {};
  let terminal = 0, transitions = 0;
  const path = [];
  const stack = [[initial(sc), null, 0]];
  // iterative DFS; path reconstructed by depth
  while (stack.length) {
    const [s, label, depth] = stack.pop();
    path.length = Math.max(0, depth - 1);
    if (label) path.push(label);
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const x of checkAlways(s)) if (!found[x]) found[x] = [...path];
    let any = false;
    for (let a = 0; a < s.A.length; a++) {
      for (const [lab, n] of steps(s, a, sc, V)) { any = true; transitions++; stack.push([n, lab, depth + 1]); }
    }
    if (!any) {
      terminal++;
      for (const x of checkEnd(s, sc)) if (!found[x]) found[x] = [...path, `END ${summary(s)}`];
    }
  }
  void wantTrace;
  return { states: seen.size, terminal, transitions, found };
}

function summary(s) {
  const d = s.dir ? `dir{${s.dir.ent.map(([g, e]) => `${g}:${s.log[e - 1].kind[0]}${s.log[e - 1].name}`).join(' ')}${s.dir.tmp.length ? ' +' + s.dir.tmp.length + 'tmp' : ''}}` : 'no dir';
  const o = s.out.map((x) => `${x.name}#${x.by}.${x.t}${x.h ? '=' + x.h : ''}=${x.res}`).join(', ');
  return `${d} assignee=${s.elem.asg || '-'}${s.elem.gone ? ' archived' : ''} | ${o}`;
}

// -------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const only = argv.filter((a) => /^S\d+$/.test(a));
const onlyV = argv.filter((a) => /^P\d$/.test(a));
const trace = argv.includes('--trace');
const ORDER = ['I1', 'I1-samename', 'I3', 'I3x', 'I4', 'I5', 'I6', 'mismatch-no-crash', 'phantom', 'phantom-stolen', 'unarchive-leftover'];
const pick = argv.filter((a) => ORDER.includes(a));
let total = 0;
for (const sc of SCENARIOS) {
  if (only.length && !only.includes(sc.id)) continue;
  for (const [vn, V] of Object.entries(VARIANTS)) {
    if (onlyV.length && !onlyV.includes(vn)) continue;
    const t0 = Date.now();
    const r = explore(sc, V, trace);
    total += r.states;
    const hits = ORDER.filter((x) => r.found[x]);
    const bad = hits.filter((x) => /^I/.test(x)), info = hits.filter((x) => !/^I/.test(x));
    console.log(`${sc.id.padEnd(3)} ${vn}  ${String(r.states).padStart(8)} states ${String(r.terminal).padStart(7)} terminal  ${String(Date.now() - t0).padStart(6)} ms  ${(bad.length ? 'VIOLATES ' + bad.join(' ') : 'I1-I6 hold').padEnd(30)} ${info.length ? '(info: ' + info.join(' ') + ')' : ''}  — ${sc.what}`);
    if (trace) for (const x of hits.filter((h) => !pick.length || pick.includes(h))) {
      console.log(`  --- ${x} (${r.found[x].length} steps)`);
      for (const l of r.found[x]) console.log('    ' + l);
    }
  }
}
console.log(`total states explored: ${total}`);
