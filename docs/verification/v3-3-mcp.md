# V3.3 verification — `nj-mcp` (`8995a5d`, `e471974`, `9ccb046`), § 17 / AC-32..38

Verifier, 2026-10-04. Independent verification, assigned by the Lead.
Work in `/tmp/verifier-v33-mcp` (detached worktree at `9ccb046`),
`/tmp/verifier-v33-nested/projects/nanojira` (for `gate.js`), `/tmp/
verifier-v33-probe` (scratch backlog + a small hand-rolled JSON-RPC
stdio probe client I wrote for this task, never committed), `/tmp/
verifier-v33-badsibling` (one crash-scenario probe). All removed before
writing this. Read: SPECIFICATION.md § 17 (as of `05485ae`) and § 3's
update in full, D144–D147 in full, the three commits' full diffs,
`src/core/flag-table.ts`, `src/nj-mcp.ts` in full. Checked protocol
claims against the MCP spec revision `2026-07-28` I already fetched for
the proposal review.

**VERDICT: accept.** Every one of the seven check areas held up under
live probing, not just reading. `gate.js` reports `BEHAVIOUR UNCHANGED`
at both `8995a5d` and `9ccb046` against `c7-baseline`; all three MCP
suites pass at their stated counts (36, 7, 11) once I installed the
SDK devDependency myself (network was available in this environment);
every protocol, confinement, concurrency and safety probe I built
matched § 17 exactly, including several deliberately adversarial ones
the task specifically asked for (backlog injection via tool args, a
crashing child, a stale `NJ_BACKLOG` in the environment). No findings
that block promotion.

## 1. AC-36 — the flag-table refactor leaves the CLI byte-identical

**`gate.js --step=8995a5d --frozen=c7-baseline`**: `replay: exit 0`,
`BEHAVIOUR UNCHANGED — the recorded surface is identical` (6463 of 7086
calls compared, 623 excluded as the usual concurrency windows). `gate`
itself exits 4 ("coverage gap") only because the three MCP suites
correctly report `CANNOT RUN` at this commit — `dist/nj-mcp` doesn't
exist yet (`e471974` hasn't landed) — exactly the "by design" case the
task described, confirmed live, not assumed.

**`gate.js --step=9ccb046 --frozen=c7-baseline`**: `replay: exit 0`,
same `BEHAVIOUR UNCHANGED`. Oracle run-all: **`ac-32-mcp.js` 36/36,
`ac-38-mcp-no-dependencies.js` 11/11**. `ac-32-mcp-sdk.js` reported
`CANNOT RUN` *inside the gate's own throwaway worktree* (no network
there) — but I had network access in my own session, so I ran `npm
install --no-save` in my worktree and confirmed **`ac-32-mcp-sdk.js`
7/7** directly (not through the gate run, which I didn't want to risk
re-running with a modified `node_modules` state). `git status` stayed
clean afterward (`node_modules` is gitignored, nothing else touched);
I removed it before finishing.

**Diff-reviewed the flag-table refactor for subtle changes, line by
line, not just the commit message's claim.** The one place this kind
of refactor could silently change behaviour is the `allowedFields` vs.
`commandControls` split inside each `checkFlags` call — which list a
flag lands in determines whether an unknown-flag error says "Known
fields: ..." or "Known flags: --backlog, ...". Checked every changed
call site against its pre-refactor form:

- `cmd-doctor.ts`: `allowedFields` stays `[]` (empty) both before and
  after — the "Known flags" path is preserved, and `cliFieldNames
  ('doctor')` evaluates to exactly `['fix']`, matching the old
  hard-coded `'fix'` in `commandControls`. **Confirmed live**: `nj
  doctor --bogus` → `Known flags: --backlog, --fix, --json`, unchanged.
- `cmd-set.ts`: the new call explicitly filters `id`/`file` back out of
  `cliFieldNames('set')` before passing it as `allowedFields` — with a
  comment explaining exactly why (the original error text never named
  them there). **Confirmed live**: `nj set --bogus=x` → `Known fields:
  title, status, priority, assignee, tags, depends_on, description,
  description-file, acceptance, acceptance-file` — byte-identical to
  the pre-refactor list.
- `cmd-claim.ts`: `allowedFields` stays `['status']` only (not the
  other claim flags), with the same kind of explanatory comment.
  **Confirmed live**: `nj claim --bogus` → `Known fields: status`.
- Every other moved command (`new`, `note`, `check`, `release`,
  `archive`, `unarchive`, `list`, `show`, `tree`, `find`) reconstructs
  its old `allowedFields`/`commandControls` split exactly, verified by
  reading each diff hunk against the flag-table's own field list — no
  command silently reclassified a flag between the two categories.

This is exactly the kind of drift the replay gate is built to catch,
and it reported none — but I didn't want to take "the gate is green"
as the only evidence for a refactor whose entire risk is in a detail
(hint-text wording) a byte-level JSON replay would absolutely catch
too, so the two checks (gate + direct diff/live spot-check) corroborate
each other rather than one standing in for the other.

## 2. Protocol — every probe from the task's list, run live

All against `dist/nj-mcp` directly, via a small hand-rolled stdio
JSON-RPC client I wrote for this task (`/tmp/verifier-v33-probe/
client.js`, never committed).

- **Both eras work.** `server/discover` with a matching `_meta`
  protocol version returns the exact `DiscoverResult` § 17 specifies
  (`resultType: "complete"`, both supported versions, `capabilities:
  {tools: {}}`, the `serverInfo` `_meta`). A literal `initialize`
  request (no `_meta`) returns the legacy response pinned to
  `2025-11-25`, same `capabilities`.
- **Per-request `_meta` and `-32022`.** `server/discover` sent with an
  unsupported version (`"1900-01-01"`) gets exactly
  `{code: -32022, message: "Unsupported protocol version", data:
  {supported: ["2026-07-28","2025-11-25"], requested: "1900-01-01"}}`
  — confirmed the version check applies *uniformly*, before dispatch,
  not only to `tools/call` (read in source, confirmed live).
- **`-32601`**: an unknown method (`"bogus/method"`) → `Method not
  found`, with the request's own `id` (a string, `"str-id"`) echoed
  back correctly — id-type fidelity (string vs. number) holds both
  ways, confirmed in the same probe batch as the numeric-id calls.
- **`-32602` only before a spawn, confirmed by absence of a write, not
  just by the error being returned.** Sent three kinds of malformed
  `tools/call`s against `TSK-001`'s own `set`: an unknown argument
  (`bogus_field`), a wrong-typed value (`priority: 123`, a number where
  a string is required), and an unknown tool name (`"rm"` — confirming
  it is genuinely absent, not merely hidden from `tools/list`). All
  three got `-32602`, and **`TSK-001.md`'s `priority` field was
  unchanged on disk afterward** — proof no child was ever spawned for
  any of them, not an inference from the error code alone.
- **A CLI rejection as `isError` with the unmodified body**: `set --id=
  TSK-999 --priority=urgent` (schema-valid, CLI-rejected) returned a
  normal tool *result* (not a protocol error), `isError: true`,
  `structuredContent: {ok: false, error: "not_found"}` — the exact,
  untouched CLI JSON body, confirmed byte for byte.
- **Stdout purity, including a crashing child.** Spawned `nj-mcp` with
  its sibling `dist/nj` deliberately missing (`ENOENT` on the
  `require` inside the crashing child) — the server's own stdout
  contained **exactly one well-formed JSON-RPC line**, a `-32603`
  whose `message` safely embeds (not leaks raw) the child's Node stack
  trace as a string; `stderr` was empty on the server's own side. No
  partial JSON, no raw crash text on stdout, under the one failure mode
  most likely to produce one.
- **Malformed JSON** → `-32700`, `id: null`. **A batch JSON-RPC array**
  → `-32600 Invalid Request` — correctly rejected: the current stdio
  transport spec states "Each message is a single JSON-RPC request,
  notification, or response," ruling out batching on this transport,
  and `nj-mcp`'s `Array.isArray(msg)` check enforces exactly that.
  **A very large message** (a 500 KB `note` text) round-tripped
  correctly, no truncation, no stall. **A notification without an
  id** (`notifications/cancelled`) produced no response at all,
  confirmed by its absence from the response list, not merely by not
  erroring.

## 3. Confinement — tried to escape, three different ways, all failed safely

- **No `backlog` field in any schema**: enumerated every tool in a live
  `tools/list` (with and without `--allow-destructive`) and confirmed
  no tool's `inputSchema.properties` names `backlog`, anywhere, in
  either mode.
- **Every child gets `--backlog` explicitly, confirmed against a
  deliberately wrong `NJ_BACKLOG`.** Launched `nj-mcp --backlog=<real>`
  with `NJ_BACKLOG=<a different, decoy backlog>` set in its own
  environment (which it inherits and would pass to children) — a
  `list` tool call still returned the **real**, `--backlog`-resolved
  backlog's contents, confirming the explicit per-child flag outranks
  the inherited env var exactly as § 4's own `--backlog`-beats-
  `NJ_BACKLOG` precedence requires.
- **`--backlog` injected as a tool argument value**: rejected at
  schema validation, `-32602: unknown argument 'backlog' for tool
  'set'` — never reaches a spawn.
- **A value starting with `--`**: set `id` to the literal string
  `"TSK-001 --backlog=/tmp/.../evil_backlog"` — `nj-mcp` spawns with
  `child_process.spawn(path, argvArray, ...)` (no shell), so this
  entire string becomes **one** literal `--id=...` argv token; the CLI
  reads it as a (nonsensical but harmless) literal id and returns
  `not_found`. No second flag was ever synthesized from it.
- **`--file` outside the backlog**: a `show` call with `file` pointing
  at a path inside a second, entirely separate real backlog I created
  for this probe returns `not_found` — confirmed `resolveTarget`'s
  existing confinement (matches only against already-scanned
  `ctx.elements`) applies unchanged through the MCP path, since it's
  the same CLI binary.

## 4. Concurrency and cancellation

- **Pipelined calls matched by id, out of completion order.** Fired
  five `tools/call`s back-to-back without waiting for responses;
  observed response order `[101, 103, 102, 104, 105]` — genuinely
  out-of-order completion (concurrent child processes finishing in
  whatever order the OS scheduled them), every response correctly
  correlated to its own request id, every one correct.
- **`notifications/cancelled` is a true no-op, confirmed against a
  deliberately slow call.** Started a `set` under `NJ_FAULT=before-
  compare` (a 10 s wait unless a marker appears), sent
  `notifications/cancelled` referencing it after 1 s, then supplied the
  marker — the call **completed normally and its response was still
  sent**, exactly matching § 17's stated design (and the current MCP
  spec's own "SHOULD stop," not "MUST," language for cancellation).
- **The server exiting on stdin EOF while a child is still running —
  no zombie.** Started the same 10 s-stalled `set` call, closed stdin
  after 1 s (simulating the client disconnecting): `nj-mcp` exited
  promptly (`code 0`), and a process listing 3 seconds later showed
  **no lingering `nj set` process** — the child was killed, not
  orphaned, confirming the commit message's "children are tracked and
  killed on stdin close" claim directly, not by reading the code alone.

## 5. Safety

**`rm` is genuinely absent, not merely unlisted** — confirmed via a
direct `tools/call` naming `"rm"`: `-32602: unknown tool 'rm'`, the
same error an entirely made-up tool name would get, not a different
"exists but refused" code. **`doctor`'s `fix` field is schema-level
gated, not call-time-rejected**: without `--allow-destructive`, `tools/
list` shows `doctor` with `inputSchema.properties: {}` (no `fix` key
at all) — a client literally cannot construct a schema-valid call that
includes it; with `--allow-destructive`, the same `tools/list` shows
`fix: {type: "boolean"}`. Both confirmed live, in both modes, in the
same session.

## 6. Dependencies

- `grep -i modelcontextprotocol dist/nj-mcp dist/nj`: the only matches
  are `nj-mcp`'s own protocol-constant strings (`io.modelcontextprotocol/
  protocolVersion`, `.../serverInfo`) — not an import, not SDK code.
  No `require`/`import` of `@modelcontextprotocol/sdk` anywhere in
  either bundle.
- **`AC-38` (11/11) and `AC-32-mcp-sdk` (7/7) both pass** — the latter
  only after I installed the devDependency myself (`npm install
  --no-save`, network available in this session); confirmed `git
  status` stayed clean and removed `node_modules` again afterward.
- **With the SDK actually installed, rebuilt and confirmed `dist/nj-
  mcp` is still byte-identical**: `node tools/bundle.js --check` →
  `dist/nj-mcp is byte-identical to a fresh build` — proving the SDK
  isn't bundled even when it's physically available to the build, not
  merely absent because it wasn't installed.
- `package.json`/`package-lock.json`: `"@modelcontextprotocol/sdk":
  "1.32.0"` — exact version, no caret, present in both files, listed
  only under `devDependencies`. `node_modules/` stays gitignored and
  untracked.

## 7. Performance — re-measured under today's (non-quiet) load

Conditions: this machine had `gate.js`'s own ~9-minute replay running
concurrently in the background for most of this measurement window —
explicitly **not** a quiet-machine measurement, stated as such per the
task's own instruction, not presented as a comfort-bar-grade number.

- **Bundle size**: `dist/nj-mcp` is **17,565 bytes (17.5 KB)** —
  matches the Implementer's reported figure exactly.
- **Cold start**: five spawn-to-`initialize`-response round trips under
  this load: 20, 21, 21, 21, 20 ms — **p50 ≈ 21 ms**, in the same
  ballpark as the reported 18.6 ms (the small gap is consistent with
  concurrent background load, not a discrepancy worth chasing further).
- **Per-call overhead**: direct `dist/nj list --json` wall time ≈ 20 ms;
  four `nj-mcp` `list` tool calls over one warm connection: 46, 30, 23,
  24 ms (the first elevated, plausibly JIT/first-call warm-up) — steady-
  state overhead on the order of a few ms, well inside the ≤ 50 ms p50
  budget even under today's contended conditions. Re-measuring on an
  actually quiet machine would tighten this number, but nothing here
  suggests the budget is at risk.

## Summary

Nothing found that blocks promotion. The flag-table refactor is
byte-identical (gate-proven and independently diff/live-confirmed at
the exact spots most likely to drift). The dual-era protocol
implementation matches every clause of § 17 I could construct a probe
for, including several adversarial ones. Backlog confinement held
against three distinct escape attempts. Concurrency, cancellation and
shutdown all behave exactly as specified, confirmed live rather than
read. Safety gating is schema-level in both directions (absent
entirely for `rm`, conditionally present for `doctor --fix`).
Dependency-freedom holds even with the SDK physically installed.
Performance is within budget under non-ideal conditions. **Accept.**
