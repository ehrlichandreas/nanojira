# Architecture

For someone opening this repository for the first time. Every claim below was
measured against the code on 2026-09-23 (exports, import edges, commands) —
not recalled from memory or from the task history that produced this code.

It describes the code as built, which implements spec **v2** plus the first
v3 step, V3-1 (backlog location: `--backlog`, `NJ_BACKLOG`, `.njrc`, in
`core/config.ts`; DECISIONS 86, 88). The remaining v3 steps change
`core/config.ts` (`layout`), `core/load.ts` (element scan wherever files lie),
the writers (`STATUS.md`) and `cmd-doctor.ts` (`--fix` steps 0, 3 and 9), and
this document follows.

## 1. Build

```
src/nj.ts  (entry, ES module)
 └─ import()s src/commands/*.ts + src/core/*.ts  (22 modules, native TypeScript, ES modules)
                              │
                              │  esbuild --bundle --format=cjs
                              ▼
                         dist/nj  (one file, checked into git, what ships)
```

`src/nj.ts` is a real ES module like every other file under `src/`, which a
single `src/package.json` (`{"type": "module"}`) marks for the whole
subtree — one file, not one per module directory: a directory-scoped
`package.json` would leave the entry's import boundary untyped (`import`
inside a CommonJS-resolved `.ts` file elaborates to `any`; a probe proved it
directly — a wrong-arity call across that boundary passed `tsc` with zero
errors) and Node would additionally warn `MODULE_TYPELESS_PACKAGE_JSON` on
every direct run. `node src/nj.ts` runs with neither warning, and the same
probe (a wrong-arity `cmdList` call in `src/nj.ts`) is now a `tsc` error
(TS2554), confirming the entry boundary is type-checked again. Node's native
`.ts` execution needs no build step for any of this. `core/types.ts` is the
one exception among the modules: it holds only `export
interface`/`export type` declarations and is never imported for value use —
only ever reached through `import type`, which erases completely under
`erasableSyntaxOnly`. That is not incidental: esbuild classifies any file
with its own `export` as an ES module regardless of whether the export is
type-only, and a file that is both ES-module-shaped *and* does
`module.exports = {…}` at runtime gets a broken bundle (found live during the
`import`/`export` conversion — `dist/nj` crashed with `NEW_FIELDS` undefined
while `tsc` reported zero errors). Keeping every real declaration in
`types.ts` sidesteps the whole class of bug.

Every module otherwise only *defines* — functions, constants, nothing runs
until a command calls into it — except `core/output.ts` (TSK-018, `5ea3701`):
importing it registers a `process.stdout.on('error', …)` handler immediately,
since it is the one module every command's output already flows through and
the handler has to be in place before the first line is printed (§ 4's EPIPE
decision).

| Command | What it checks |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | `strict: true` + `erasableSyntaxOnly` over all of `src/**/*.ts`, `src/nj.ts` included directly (it carries a real `.ts` extension, so tsc needs no shadow copy) |
| `npm run build` (`node tools/bundle.js`) | writes `dist/nj` from `src/nj.ts` + `src/commands/` + `src/core/`; refuses to bundle a source file missing its own `'use strict'` |
| `npm run build:check` (`node tools/bundle.js --check`) | rebuilds in memory, exits 1 unless byte-identical to the committed `dist/nj` — catches a stale bundle |
| `npm test` (`build:check && node test/run-all.js dist/nj`) | the oracle (§ 5) against the shipped bundle |
| `npm run perf` (`build:check && node tools/perf.js`) | TSK-003: builds a 10 000-element backlog under `/tmp` and measures `dist/nj list`/`list --json`/`tree`/`doctor` against SPECIFICATION.md:849's comfort bar (median ≤ 250 ms, worst ≤ 500 ms); aborts instead of measuring if another `node` process is running, so machine load is never reported as an `nj` regression |

`tools/refactor-harness/baseline.js` (record/verify) and
`tools/blindness-matrix/run.js` are not wired into `npm test` — they are run
by hand, deliberately (§ 5).

## 2. Module map

Layered bottom-up by import depth (measured; no module imports anything from
a layer above it — the graph is acyclic). "Exports" lists what a newcomer
would actually reach for, not every name; "imported by" is exact.

| Module | Purpose | Key exports | Imported by |
|---|---|---|---|
| `core/types.ts` | Every shared interface/type (`Element`, `Context`, `Flags`, the nine-stage `Skeleton→…→Element` chain, `NonEmptyString`) — never `require()`d, only `import type` | `Element`, `Context`, `Flags`, `Config`, `Finding`, `EntryJson`, staged-builder types | all 21 other modules (type-only) |
| `core/constants.ts` | Field tables, status/priority vocab, the closed `SEVERITY` map | `TYPE_DIR`, `PARENT_TYPE`, `SEVERITY`, `DEFAULT_CONFIG`, `SETTABLE_FIELDS`, `NEW_FIELDS` | 11 modules: `args`, `config`, `derive`, `load`, `parse`, `store`, 5×`cmd-*` |
| `core/help.ts` | The `nj help` text, nothing else | `HELP` | `nj` |
| `core/derive.ts` | Read-only views over a loaded `Element`: sort order, readiness, JSON entry shape | `elementProblems`, `isReady`, `compareElements`, `entryJson`, `countsOf` | `context`, `output`, 7×`cmd-*` |
| `core/parse.ts` | Frontmatter grammar and body-section editing, no `Element` knowledge | `parseFile`, `serialize`, `syncH1`, `applySections` | `args`, `load`, `store`, 3×`cmd-*` |
| `core/output.ts` | The `Fail` error type, `--json` state, all printing — and the one module with a real load-time side effect (below) | `fail`, `hardExit`, `out`, `writeFeedback`, `emitWriteResult`, `emitFailure` | 16 modules: `args`, `config`, `context`, `nj`, `store`, every `cmd-*` |
| `core/args.ts` | CLI flag parsing and validation, no filesystem access; `--backlog` is accepted by every command here, in `checkFlags` | `parseArgs`, `checkFlags`, `flagString`, `readSectionFlags` | `config`, `context`, `nj`, every `cmd-*` |
| `core/config.ts` | `.nanojira.json` load/validate, backlog location (`--backlog` > `NJ_BACKLOG` > upward search, `.njrc` before `backlog/` per directory), the strict `.njrc` parser | `loadConfig`, `findBacklog`, `initLocation`, `listMd` | `context`, `load`, `cmd-init` |
| `core/store.ts` | Clock, tombstones, atomic file writes, the write-time compare guard | `nowIso`, `atomicWrite`, `compareGuard`, `guardedWrite`, `renderElement` | `load`, 5×`cmd-*` |
| `core/load.ts` | `loadElement` (nine derivers), `deriveGraph` (ten passes), `loadBacklog` | `loadElement`, `deriveGraph`, `childMap`, `descendants`, `loadBacklog` | `context`, 6×`cmd-*` |
| `core/context.ts` | Per-command setup: backlog+config+elements, target resolution, the four `require*` guards | `context`, `resolveTarget`, `requireWritable`, `requireNoStubs`, `requireActive` | all 10 `cmd-*` modules |
| `commands/cmd-init.ts` … `commands/cmd-tree.ts` (11 modules) | One per verb (`init new set note show list tree rm archive doctor status`) | one `cmdX` function each | `nj` only |

Nothing above `context.ts`/`args.ts`/`output.ts` is imported by anything
below it — a `cmd-*` module may use CLI helpers and printing, but no CLI
helper or printer calls back into a command (TSK-006's rule, checked against
every import edge above, not assumed).

## 3. Data flow of one call

```
argv
 └─ parseArgs (args.ts)                  → { flags, positional }
     └─ context() (context.ts)
         ├─ findBacklog(flags) + loadConfig (config.ts)
         └─ loadBacklog (load.ts)
             ├─ loadElement × N          — nine derivers, Skeleton→…→Element
             └─ deriveGraph × 1          — ten passes over the whole set
     └─ cmdX(flags, …) (cmd-*.ts)        — resolves target, reads/writes,
                                           re-derives after a write
         └─ out / writeFeedback / emitWriteResult / emitFailure (output.ts)
```

`loadElement` runs once per file and only ever sees that one file; `deriveGraph`
runs once per loaded set and is the only place duplicate IDs, parent/depends_on
cycles, and open-children checks exist — a single element can never detect
these on its own. A write command (`set`, `note`, `archive`, `new`) calls
`deriveGraph` a second time after writing, on the changed array, so the
printed feedback reflects the post-write graph, not the pre-write one.

## 4. Invariants and who protects them

| Invariant | Protected by | Where |
|---|---|---|
| `parent` is never `''` — empty/whitespace normalises to `null` | **Compiler** (branded type `NonEmptyString`; `el.parent = ''` is a `tsc` error) | `types.ts` (brand), `load.ts` `deriveParent` (the one cast site) |
| The nine derivers run in `Skeleton→WithId→…→Element` order | **Compiler** (staged types; a swapped call is a `tsc` error) | `load.ts` `loadElement` |
| `doctorFix`'s nine steps (mtime snapshot + § 14's eight) run in order | **Compiler** (phantom `FixCtx<S>`; a swapped call is a `tsc` error) — *and*, independently, **Oracle**, because `exit-doctor-fix.js` pins `fixed[]` in step order | `cmd-doctor.ts` |
| `deriveGraph`'s ten passes may run in any order **only while** (1) no pass reads another's `problems`, (2) no pass writes any field but `problems`, (3) no mark pass reads `byId`/`children` | **Corpus** convention, not mechanically enforced — a comment at `deriveGraph`, checked by a differential mutant | `load.ts` `deriveGraph`; DECISIONS 77 |
| `assignee` stays `''` (never normalised to `null` like `parent`) — `cmdSet`'s `--assignee=` delete depends on the distinction | **Oracle** (`cmd-set.ts` behaviour is spec-pinned) — nothing mechanical stops someone from "cleaning up" the asymmetry | `load.ts` `deriveOptionals` |
| The `childMap`/`ctx.kids` memo across `deriveGraph`'s calls is harmless **only** while no verb moves parentage | **None mechanical** — a property of round one (no command takes `--parent`), not a guarantee the type system or a fixture enforces; the trigger for a fixture is the first verb that moves an element | `load.ts` `childMap`/`descendants`; DECISIONS 81 |
| EPIPE on stdout (reader closed early, e.g. `\| head`) exits 0 silently; any other stdout write error still crashes visibly | **Code**, one place: `output.ts`'s `process.stdout` error handler re-throws everything except `EPIPE` | `output.ts` (registered at load time); AMBIGUITIES.md 48 |

DECISIONS 77 and 81 are cited, not repeated: both record a case where the
*rule* was right and an accompanying *reason* for it was wrong, found only by
an independent check — read them there for the reasoning, not here.

## 5. Safety net

Three independent nets; the team refers to them as the Oracle, the Corpus,
and the Blindness matrix (Orakel/Korpus/Blindheits-Matrix in team shorthand).

**Oracle** (`test/`, 62 files derived only from `SPECIFICATION.md`, run via
`npm test`): black-box, spawns `nj`/`dist/nj`, asserts exit code/stdout/
stderr/file bytes, never reads implementation source. Reach for it to answer
"is this still spec-conformant" — it is what CI-equivalent gating runs by
default.

**Corpus** (`tools/refactor-harness`, `record`/`verify` against the frozen
`c1-baseline` tag): answers a different question — "does this behave
*exactly* like the pre-refactor revision", including things the spec never
pins (byte order of `_problems`, the sequence `fixed[]` reports actions in).
Run `verify` by hand after any change that is supposed to be behaviour-
preserving; it is not part of `npm test` because it is slow (4–6 minutes,
measured) and only meaningful for refactors, not features.

**Blindness matrix** (`tools/blindness-matrix`): answers a third question —
"if I mutate this one line, does *any* suite in the other two nets go red?"
A mutant that survives green is a documented gap, not a bug. Run it after
touching test infrastructure itself (a needle can silently stop matching, as
happened during this project's ES-module conversion) or before trusting a
"no regression" claim about coverage, since neither the oracle nor the corpus
can tell you that on their own.
