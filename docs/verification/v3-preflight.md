# v3 pre-flight — reference gate on v2, spec review of v3

Verifier, 2026-09-28. Independent of the Oracle (AC-21) and the Implementer
(V3-1) per DECISIONS 86/87. Read-only on `src/`, `dist/`, `test/`,
`backlog/`; this file is the only write.

- **Part A** reruns the DECISIONS 84 gate on `5b666a0` (the last v2
  `dist/nj`). It is the baseline V3-1 gets compared against.
- **Part B** reviews spec v3 at HEAD `7f48bd3`, read together with
  DECISIONS 86–88. While I worked, HEAD moved on to `664d4c2` (DECISIONS 89,
  AC-21, `b69aa5a` for AC-15). Findings those commits already rule are marked
  **ruled** and listed only so nobody reopens them.

---

## Part A — reference gate on `5b666a0`

### Setup

```sh
git worktree add --detach /tmp/nj-v2-ref 5b666a0      # main tree never switched
ln -s <main>/node_modules /tmp/nj-v2-ref/node_modules  # see deviation A1
export PATH=/home/dev/workspace/portable/runtime/darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin
node -v   # v24.21.0
```

`dist/nj` at `5b666a0`: sha256 `d649de32c7aa556deb2b5c05c2ace7535f7b258b237c5685f63d313f17448a0b`.
`c2-baseline:dist/nj` (the recording source): `e445981e…a838`, which matches `header.njSha256`.

### Results

| Gate item | Command | Result |
|---|---|---|
| artefact | `npm run build:check` | exit 0, "byte-identical to a fresh build" |
| types | `npm run typecheck` | exit 0, tsc strict 0 errors |
| type counter-probes | one mutation at a time + `tsc --noEmit`, reverted with `git checkout -- src` in the worktree | cross-module call `cmdList(flags, positional)` → **TS2554**; `final.parent = ''` → **TS2322**; `deriveTitle`/`deriveStatus` swapped → **TS2345**; `fixStep3`/`fixStep4` swapped → **TS2345** (`FixCtx<3>` vs `FixCtx<4>`). All four still hold. |
| oracle, in `/tmp/nj-v2-ref` | `node test/run-all.js dist/nj` | **63/64, exit 1**: AC-15 fails, 15 of 21 checks (see A2) |
| oracle, same, `NJ_NODE` pinned | `NJ_NODE=$(which node) node test/run-all.js dist/nj` | **63/64**: AC-15 still fails, 5 of 21 checks: its lone-copy leg ignores `NJ_NODE` (A2) |
| oracle, layout the old AC-15 expects | worktree at `/tmp/nj-ac15/projects/nanojira`, `/tmp/nj-ac15/runtime/darwin-arm64` → symlink to the real runtime | **64/64, 2556 checks, exit 0** |
| oracle, AC-15 from `b69aa5a` | that one file checked out in the worktree, `NJ_NODE` set | PASS, 22 checks; without `NJ_NODE` from `/tmp`: exit 1, with a clear "Set NJ_NODE" message |
| corpus replay | `node tools/refactor-harness/baseline.js verify --nj=/tmp/nj-v2-ref/dist/nj` (NJ_NODE set) | **exit 0, BEHAVIOUR UNCHANGED**: 3454 calls, **0 diffs / 2943 compared** (511 excluded, AC-7 concurrency). Corpus parts: fixtures 1878, oracle 1341, scratch 235. Test digest `4ede7689…490d` = header. Took 7 min 03 s. Note: this was with AC-15 red (A3). |
| white-box probe | `NJ=… node tools/refactor-harness/scratch/verify.js dist/nj` | **122/123**, exit 0. The one ✗, "no backlog at all → no_backlog", is environmental (A4). |
| lone `dist/nj`, no network | `sandbox-exec -p '(version 1)(allow default)(deny network*)' node <empty dir>/nj …`, `env -i` | `init`, `new --type=epic`, `list --json`, `doctor`: exit 0, stderr 0 bytes each. A `net.connect` inside the same sandbox gets `EPERM`, so the block really applies. Only `backlog/` and `nj` in the directory afterwards. |
| perf § 13 | `npm run perf` | **not reproducible as an absolute bar**, see A5. 1st try: exit 3 (not quiet, 318 % foreign CPU). 2nd try: exit 1, all over the bar: list 480/489, list --json 421/443, tree 407/457, doctor 417/442 ms (median/max). |
| perf, interleaved A/B | ad-hoc script, below: one 10k backlog built like `perf.js`'s, 7 rounds alternating the three builds | **no regression**, the three builds are equal within noise. `5b666a0` 396/467, 386/429, 418/532, 395/512 · `c2-baseline` 381/426, 390/437, 404/550, 408/450 · `2ca5c9f` (the D84 build) 389/466, 394/481, 396/471, 406/452 (list, list --json, tree, doctor). Node v26.7.0 vs v24.21.0 on `2ca5c9f`: no systematic difference. |

**Reference for V3-1:** replay 0 diffs / 2943. Oracle 64/64 (2556 checks)
where AC-15 finds a runtime. `verify.js` 122/123, with that one environmental
✗. Perf is judged by interleaved A/B against `/tmp/nj-5b666a0-dist-nj`
(= `git show 5b666a0:dist/nj`), not by the absolute bar, until A5 is resolved.

A/B script, so the V3-1 run can repeat it exactly (`node ab.js <nj> <nj> …`):

```js
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const NODE=process.execPath, BINS=process.argv.slice(2);
const dir=fs.mkdtempSync('/tmp/nj-ab-'); spawnSync(NODE,[BINS[0],'init'],{cwd:dir});
const b=path.join(dir,'backlog'),ids=path.join(b,'.ids'),ts='2026-01-01T00:00:00Z',pad=(n,w)=>String(n).padStart(w,'0');
for(let i=1;i<=100;i++){const id='EPIC-'+pad(i,3);fs.writeFileSync(path.join(b,'epics',id+'.md'),`---\nid: ${id}\ntype: epic\ntitle: E${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# E${i}\n\n## Description\nx\n`);fs.writeFileSync(path.join(ids,id),'');}
for(let i=1;i<=9900;i++){const id='TSK-'+pad(i,5),p='EPIC-'+pad((i%100)+1,3);fs.writeFileSync(path.join(b,'tasks',id+'.md'),`---\nid: ${id}\ntype: task\nparent: ${p}\ntitle: T${i}\nstatus: todo\ncreated: ${ts}\nupdated: ${ts}\n---\n\n# T${i}\n\n## Description\nx\n\n## Acceptance Criteria\ny\n`);fs.writeFileSync(path.join(ids,id),'');}
const CMDS=[['list'],['list','--json'],['tree'],['doctor']], ROUNDS=Number(process.env.ROUNDS||7), t={};
for(const bin of BINS)for(const c of CMDS)t[bin+'|'+c]=[];
for(let r=0;r<ROUNDS;r++)for(const c of CMDS)for(const bin of(r%2?BINS.slice().reverse():BINS)){const s=process.hrtime.bigint();const x=spawnSync(NODE,[bin,...c],{cwd:dir,maxBuffer:1<<26});if(x.status!==0)throw new Error(bin+' '+c);t[bin+'|'+c].push(Number(process.hrtime.bigint()-s)/1e6);}
const med=a=>{a=a.slice().sort((x,y)=>x-y);const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2};
for(const c of CMDS)console.log(c.join(' ').padEnd(12)+BINS.map(bin=>{const a=t[bin+'|'+c];return path.basename(bin)+' '+med(a).toFixed(0)+'/'+Math.max(...a).toFixed(0)}).join('   '));
fs.rmSync(dir,{recursive:true,force:true});
```

### What did not run as documented

- **A1. A fresh worktree has no `node_modules`.** `build:check` and
  `typecheck` need esbuild and tsc. I symlinked the main tree's copy, whose
  esbuild 0.25.12 and TypeScript 5.9.3 match `package-lock.json`, rather than
  run `npm ci` with network access. The README's worktree-free procedure never
  meets this problem.
- **A2. AC-15 at `5b666a0` depends on where the checkout sits.** It takes the
  runtime from four directories above `test/ac/`, i.e. it assumes
  `<portable>/projects/nanojira`. The project now lives at
  `workspace/nanojira`, which gives `/Users/…/Downloads/runtime/…`, a path
  that doesn't exist. So AC-15 was red **in the main tree as well**, not just
  in `/tmp`. The lone-copy leg spawned that path directly, so `NJ_NODE` didn't
  help. `b69aa5a` fixes this: it walks upward for `runtime/` or
  `portable/runtime/`, a missing runtime becomes CANNOT RUN, and `NJ_NODE`
  governs every spawn. Verified above.
- **A3. `baseline.js verify` does not gate on the oracle's verdict.** With AC-15
  red it printed `oracle suite FAILED: ac/ac-15-no-dependencies.js` and
  `passed 63/64`, then exited **0** with "BEHAVIOUR UNCHANGED". `verify` checks
  diffs, the digest, the suite list and coverage gaps. It never reads
  `oracle.failed`; only `record` does, via exit 5. So a failing verdict-only
  suite (`stdout-epipe.js`, `det-id-retry.js`), or a leg that bypasses the shim
  (AC-15's lone copy), is **invisible to `verify`**. D85's "its verdict still
  gates" holds only because the D84 gate also runs `run-all.js` separately. That
  separate run is mandatory, not optional.
- **A4. `scratch/verify.js` always exits 0.** It prints `N/M checks passed,
  K failed` and exits normally, and the harness reads only the exit status. So
  its verdict never gates: a failed check lands under "ran and passed, but NOT
  byte-recorded". On this machine one check fails for environmental reasons:
  it runs `nj` with cwd `$HOME/Downloads`, and this session's `HOME`
  (`team-a/state/home`) has no `Downloads`, so the spawn fails.
  **Whoever verifies must read its output and diff the ✗ lines against this
  reference (1 ✗).**
- **A5. The absolute § 13 bar can't be reproduced on this machine right now.**
  The Mac is on battery with **Low Power Mode on** (`pmset -g`:
  `lowpowermode 1`). Other agents are running too (foreign CPU 107–318 %).
  `2ca5c9f`, which D84 measured at 206/208 ms, now takes ~390–430 ms, and so
  does every other build. `perf.js`'s quiet check sees CPU load but not power
  mode, so it passed and the run reported OVER BAR on unchanged code. That is
  exactly the false alarm the harness README warns about. The user's power
  settings were not touched.
- **A6. Node version.** The corpus header records `node v26.7.0` (Homebrew);
  the gate now runs on the runtime Node v24.21.0. The replay was 0 diffs
  anyway, so the corpus doesn't depend on the Node version. Worth knowing,
  since `dist/nj`'s shebang picks whichever `node` comes first on `PATH`.

---

## Part B — spec v3 review

Ranked by how much each finding blocks V3-1 and then the later steps. "Open"
means not ruled as of `664d4c2`.

### Blocks V3-1 — gate procedure, not spec text

**B1. As DECISIONS 86 describes it, the V3-1 gate can't run with the harness
as it is.** "Replay 0 diffs + new AC-21 suite" collides with the harness's
own guards:

- `test/` at HEAD has digest `3596ed52…` (AC-21 added, AC-15 changed in
  `b69aa5a`). The baseline says `4ede7689…`, so `verify` **aborts with exit 6**
  ("stale baseline") before comparing a single call.
- Re-recording doesn't help. D85 says to record against `c2-baseline:dist/nj`,
  but that is v2 and fails AC-21, so `record` **aborts with exit 5**.

**Proposal:** replay the frozen suite, then run the new one separately.

1. In a throwaway worktree at the V3-1 commit:
   `git checkout oracle-frozen-7 -- test/` (digest `4ede7689…`, the same
   tree as `5b666a0`), then
   `baseline.js verify --nj=<V3-1 dist/nj>`. Every diff must fall into one of
   D88's named classes.
2. Then run the full HEAD `test/`, AC-21 included, with
   `run-all.js <V3-1 dist/nj>`.
3. After acceptance, V3-1 becomes `c3-baseline` and is recorded with the new
   `test/` (DECISIONS 85's rule, applied once more).

The lead should rule on this before the verification round starts.

**B2. D88's list of intended replay diffs is missing one class, and a gating
probe pins the old behaviour.** D88 makes a source target that is a directory
without `.nanojira.json` into `invalid_backlog_{flag,env,njrc}`. In v2,
`NJ_BACKLOG` at such a directory is **`backlog_without_config`**
(`config.ts:70-71`), so this is a code change, not just a message change.
D88's diff list names only the non-directory message.

- The corpus contains **0** such calls; I checked all 8 corpus calls with
  `NJ_BACKLOG` set. So the replay won't show it.
- But `scratch/verify.js:207` asserts
  `NJ_BACKLOG at configless dir → backlog_without_config`. Under V3-1 that
  becomes a second ✗, and per A4 nobody would notice unless they read the
  output.

**Proposal:** name it in D88 as intended. Either amend `verify.js:207` in the
same commit, or record the expected ✗ as the V3-1 reference (2 ✗: A4 + this).

**B3. The frozen oracle's closed vocabularies predate v3.**
`edge/failure-vocabulary.js`, `edge/exit-fault-vocabulary.js` and
`fault/det-id-retry.js` hard-code the v2 set, without `invalid_backlog_flag`,
`invalid_backlog_njrc`, `invalid_njrc` or `legacy_layout`.

- Harmless for V3-1: frozen suites never produce these codes.
- But a `.njrc` anywhere above `os.tmpdir()` or a scratch directory would
  now change frozen results. It would surface as "error outside the closed
  set", which points the diagnosis the wrong way.
- The V3-4 test batch has to extend these sets additively.

### V3-1 spec text — open, small

- **B4. `.njrc` that isn't a regular readable file.** § 4 says nothing about a
  `.njrc` that is a directory, a dangling symlink or unreadable (EACCES). For
  a symlinked `.njrc` it also doesn't say which directory "the directory
  containing that `.njrc`" means: the link's or the target's.
  **Proposal:** base the path on the directory where the search found it, no
  realpath. Any reached `.njrc` that is not a readable regular file is
  `invalid_njrc` with a reason. That fits "a chosen source is binding"; a
  silent skip would contradict it.
- **B5. `.njrc` lexing details.** Still unpinned:
  - a value containing `=` (proposal: split at the first `=`)
  - key case (`Backlog`; proposal: case-sensitive → unknown key)
  - an inline `# …` after a value (proposal: part of the literal value, as
    "literal" implies)
  - CRLF and a leading BOM (JS `trim()` removes both `\r` and `\uFEFF`; say
    so)
  - line numbers 1-based and physical (comment and blank lines count)
  - whether the `~/` rule also covers a value that is exactly `~`
    (proposal: no, literal)
- **B6. `~/.njrc` *on* the search path.** AC-21 pins that a `~/.njrc` *off*
  the path is not read. By § 4's text, though, every cwd under `$HOME` that
  finds nothing nearer does read `~/.njrc`. That makes it a de-facto global
  default, and a malformed one fails all such runs with `invalid_njrc`.
  That's consistent with "not `~/.njrc`" only in the sense of "no special
  lookup". **Proposal:** add one sentence to § 4 so it doesn't read as a
  contradiction of D86.
- **B7. § 9's spec-named table lacks "`init` target exists → `exists`".** § 4
  names it; the table promises every named condition is mapped. Additive fix.
- **B8. AC-21 says "A chosen source that holds no backlog exits 1 with its own
  code".** Read literally, that includes `init`, for which an empty target is
  the success case. § 4's "commands that *need* a backlog" exempts `init`.
  AC-21 should say "every command except `init`", so the criterion doesn't
  contradict D89 §52/55.
- **B9. Path identity.** No rule says whether the absolute path in the binding
  errors and in the JSON `backlog` field is `path.resolve` (logical) or
  realpath. It matters on macOS (`/tmp` vs `/private/tmp`) and for symlinked
  targets. v2 uses `path.resolve`. **Proposal:** keep it and state it.
- **Ruled already** (so nobody reopens them): the V3-1 marker is
  `.nanojira.json` (D88/49). Binding errors use one form with the `Error: `
  prefix (D88). Nearest `backlog/` wins strictly (D88). `--backlog` is in
  every "Known flags:" line (D88). `invalid_backlog_env` is no longer reserved
  (`c473e75`). Repeated key → line of the repetition, empty key → unknown key,
  `init` never looks at `backlog/`, `--backlog=` → `missing_value`, empty
  `NJ_BACKLOG` = unset, `~/` expanded only in `.njrc`, empty directory =
  `exists` (D89). A `.njrc` without `backlog` next to a `backlog/` → `backlog/`
  is used (AC-21 A8 asserts it).

### V3-2 — layout

- **B10. Contradiction: under `hierarchy`, archiving a child first makes the
  parent un-archivable.**
  - § 11: archiving `TSK-003` alone moves it to
    `archive/EPIC-001/TSK-003/` and creates `archive/EPIC-001/` as a
    placeholder with no element file.
  - Later, `nj archive --id=EPIC-001` has to move `EPIC-001/` "as a whole,
    with one `rename`" (§ 11, § 12) onto `archive/EPIC-001/`. That target
    exists, so § 11 says abort with `exists`; `rename(2)` onto a non-empty
    directory fails with `ENOTEMPTY` anyway.
  - Result: once any descendant is archived first, the epic can never be
    archived. The same applies to a task after one of its subtasks.
  - § 14 step 3 ("every target must be free") has the same issue when
    regrouping a backlog with a partial archive.
  - **Needs a rule:** merge into a placeholder-only folder (not one `rename`,
    so the atomicity story changes), or forbid archiving below the top level
    under `hierarchy`.
- **B11. The recursive element scan has no bounds.** "Every `*.md` below the
  backlog" says nothing about:
  - symlinked directories or symlink loops (a loop spins the scan, against
    § 7's promise that errors never crash)
  - dot-directories (`.git` when `--backlog=.` at a repository root,
    `.obsidian`)
  - `node_modules`
  - `.MD` casing

  **Proposal:** don't follow directory symlinks, skip every dot-directory
  (which covers `.nanojira/`), and treat `.md` as case-sensitive.
- **B12. How deep do the `README.md` / `STATUS.md` exclusions reach?** Only
  the top level, or any depth? Under `hierarchy`, a hand-written
  `EPIC-001/README.md` is plausible. Unstated. **Proposal:** top level only;
  anything else is an element file and gets reported.
- **B13. A layout folder named `backlog` breaks discovery from inside the
  backlog.** `[A-Za-z0-9][A-Za-z0-9_-]*` allows `backlog`. With
  `folders.epics = "backlog"`, any cwd inside `<backlog>` finds
  `<backlog>/backlog/` first, and strict nearest-wins (D88) gives
  `backlog_without_config`. **Proposal:** forbid the name `backlog`
  (case-insensitively) in `layout.folders`.
- **B14. Case-insensitive filesystems.** APFS is case-insensitive by default.
  So "pairwise distinct" should compare case-insensitively (`Tasks` vs
  `tasks`), and so should the `EPIC-<n>`/`TSK-<n>`/`SUB-<n>` check
  (`epic-001` as the archive name).
- **B15. Under `hierarchy`, an element whose place can't be computed** (orphan
  task, `parent:dangling`, `parent:cycle`) has no defined layout code. If it
  also gets `layout:misplaced` (error, blocks `--ready`), a task that is only
  `parent:orphaned` (a warning, not blocking) silently leaves the ready set.
  AC-22 says only "reported and never moved". Which code, and does it block?
- **B16. `hierarchy` archive: order and atomicity.** § 11 writes `archived:`
  into every moved file, with compare-before-write, and § 12 moves the folder
  with one `rename`. The order is undefined, and so is what
  `NJ_FAULT=before-rename` means with N files and one folder rename. A crash
  between the two leaves active files carrying `archived:`; which code do
  they get? "A partially executed archive is forbidden" needs a defined
  sequence.
- **B17 (code, not spec).** `load.ts` still derives
  `archived: folder === 'archive'`, and `loadElement(file, folder, cfg)` takes
  one folder name. V3-2 has to change the staged-type chain, and should repeat
  the D84 deriver-order counter-probe afterwards. Likewise, § 14 now has
  steps 0 and 9, so the phantom `FixCtx<0..8>` chain has to grow, followed by
  the step-order probe.

### V3-3 — `STATUS.md`

- **B18. Content is underspecified for problem elements:**
  - a `file:unreadable` stub (no status, no title)
  - `missing:status` (stored nothing, derived `statuses[0]`: which section?)
  - `missing:title`
  - `duplicate_id` (both files listed?)
  - titles containing `]`, which break the link syntax "as stored"

  AC-23's golden needs these pinned.
- **B19. A failed overview under `--json`:** is there any signal in the
  result object, or only the stderr line? And what exit code does
  `doctor --fix` return when step 9 is the step that fails?
- **B20. No perf gate for writes.** § 4 puts the price at one full scan per
  write (≈200 ms at 10k); `perf.js` measures reads only.

### V3-4 — `.nanojira/` and migration

- **B21. The § 14 step 0 ambiguity case** (v2 and v3 places both exist) says
  "nothing is moved". It doesn't say whether steps 1–9 still run, against
  which configuration, or what the exit code is (does
  `backlog:legacy_layout` remain an error → 2?).
- **B22. § 8's shorthand clashes with the legacy name.** "`.ids/` below, for
  short" means `.nanojira/ids/`, while § 4, § 14 and AC-24 use `.ids/` for
  the *legacy* top-level folder. § 14's check list ("a missing or empty
  `.ids/`") is therefore ambiguous. **Proposal:** write `ids/` or the full
  path.
- **B23. Documentation.** D86's "new failure codes" lists four; the new
  *problem* codes (`layout:misplaced`, `backlog:legacy_layout`,
  `backlog:status_stale`) are only in § 7. Also, § 12 still says `NJ_FAULT`
  "accepts two distinct injection points" and then lists three (from v2).

---

## Cleanup

Both worktrees (`/tmp/nj-v2-ref`, `/tmp/nj-ac15/projects/nanojira`) were
removed with `git worktree remove` after this file was written. The copies
`/tmp/nj-5b666a0-dist-nj`, `/tmp/nj-c2-dist-nj` and `/tmp/nj-2ca5c9f-dist-nj`
are left in place for the V3-1 A/B.
