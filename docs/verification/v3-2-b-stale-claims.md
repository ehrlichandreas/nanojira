# V3.2-B verification — stale claims (`815d697`, `fd4444c`, § 5/7/12/14, AC-29, TSK-035)

Verifier, 2026-10-04. I didn't write any of this code — independent
verification assigned by the Lead. Work in `/tmp/verifier-v32b-claims`
(detached worktree at `fd4444c`), `/tmp/verifier-v32b-nested/projects/
nanojira` (nested under its own `runtime/darwin-arm64` symlink, for
`gate.js`'s own AC-15 check and a second, unclipped `baseline.js` run), and
`/tmp/verifier-v32b-probe` (scratch backlogs). All removed before writing
this file. Runtime Node v24.21.0. Read: § 5/7/12/14 as of `1ccc209`;
`src/core/claims.ts`, `core/config.ts`, `core/constants.ts`, `core/derive.ts`,
`core/store.ts`, `core/types.ts`, `core/output.ts`, and every touched
`src/commands/*.ts`; `test/ac/ac-29-stale-claims.js` (`e8bac6d`).

**VERDICT: accept, with one text-precision finding worth a ruling.** AC-29
43/43, run-all and `gate.js --step=fd4444c --frozen=c6-baseline` all
reproduce exactly (6 calls, same help-text class as V3.2-A, confirmed
byte-for-byte across the full, unclipped corpus — the `_problems`/`_claim`
key-order fix in `fd4444c` is complete: zero diffs anywhere else in 5,366
compared calls, not just a sample). The code review found no unintended
behaviour change beyond `claim:stale` in the 13-file diff. My own probes
(16 scenarios) all matched spec. **The one real finding:** `claim:stale`
is not confined to "`doctor`, `list` and `show`" as § 12's new sentence
states — because it's computed inside the shared `entryJson`/
`emitWriteResult` helper, it surfaces in **every** command that returns an
`entry`, including `set`, `note`, `check`, `claim`, `release`, `new`,
`archive`, `rm`, `unarchive`, `tree`, and bare `nj` — confirmed
empirically, not just by reading the code. This is very likely the
*intended*, more consistent behaviour (matching how `claim:mismatch`/
`claim:orphaned` already appear wherever `_problems` appears, not in a
named subset of commands) — but the spec text under-states its own scope,
and AC-29 only tests the three commands the text happens to name.

## 1. AC-29, run-all, gate — confirmed, including the key-order fix

- `node test/ac/ac-29-stale-claims.js dist/nj`: **43/43**, exact.
- `node test/run-all.js dist/nj`: 75/77 pass, 0 failed, 2 cannot-run (the
  usual two expected gaps).
- `gate.js --step=fd4444c --frozen=c6-baseline`: `BEHAVIOUR CHANGED — 6
  differing call(s): help 4, --help 2`, `replay: exit 1`, `oracle: passed
  76, failed 0, cannot run 1 (1 expected)`, `gate: exit 1, replay CHANGED,
  oracle green` — the same tally and shape as V3.2-A's own accepted
  result, exact.

**Confirmed byte-for-byte, and confirmed the key-order fix holds across
the whole corpus, not a sample.** Reran `baseline.js` directly in a
correctly-nested worktree (`test/` at `c6-baseline`, digest-confirmed) with
my own throwaway clip removal (never committed): **still exactly 6
differing calls, all the same help-text class** already confirmed for
V3.2-A (one inserted `nj check` help line — unrelated to this feature, a
holdover from the prior round; nothing about `claim:stale` or `claims.`
anywhere in any of the 6 diffs). Critically, **`compared: 5366 calls`
include every `list`/`show`/`set`/`note`/`claim` call in the whole
corpus** — the exact population that would have shown the 1,533-call
key-order regression `fd4444c`'s own commit message describes, had the fix
not been complete. Zero diffs outside the 6 help-text calls means the fix
is clean across the entire corpus, not just the cases `gate.js`'s own
40-call cap happened to show. **No existing call gained `claim:stale`**
(none of the 6 diffs mention it, and the corpus predates any claim ever
being made stale by construction — a fixture claim's `since` is always
recent relative to its own fixture's pinned `NJ_NOW`).

## 2. The 13-file diff — reviewed for unintended changes beyond `claim:stale`

Read every file `815d697` touches:

- **`core/claims.ts`**: adds `isClaimStale(since, staleAfterHours, nowMs)`
  only — a pure function, `staleAfterHours <= 0` short-circuits `false`
  (the disabled case), otherwise `ageHours > staleAfterHours` (strict
  inequality, "exceeds" not "at least"). Nothing else in the file changed.
- **`core/config.ts`**: adds `validateClaims`/`readClaims`, wired into
  `validateConfig`/`loadConfig` the same way `validateLayout`/`readLayout`
  already are — same shape, same unknown-key rejection, no existing
  validation path altered.
- **`core/constants.ts`**: `DEFAULT_CONFIG.claims = {staleAfterHours: 24}`
  and `SEVERITY['claim:stale'] = 'warning'` — two additive entries, nothing
  removed or renamed.
- **`core/derive.ts`**: `entryJson` gains a `cfg` parameter and computes
  `claim:stale` into `_problems`, sorted — the only semantic change in the
  file. `_claim` itself (the `{by, since}` object) is untouched — confirmed
  both by reading (the `readClaim` call and its assignment to `e._claim`
  are unmoved apart from the `fd4444c` field-order fix) and empirically
  (§ 7's "E7 `_claim` is exactly `{by, since}`" case, and my own probes
  below).
- **`core/store.ts`**: adds `nowMs()` as `Date.parse(nowIso())` — reuses
  `nowIso()`'s own existing `NJ_NOW`-or-wall-clock logic verbatim, so the
  clock-pinning discipline is inherited, not reimplemented.
- **`core/types.ts`**: one additive field on `Config`.
- **Every `src/commands/*.ts` change** (`archive`, `check`, `claim`, `new`,
  `note`, `release`, `rm`, `set`, `show`, `status`, `tree`, `unarchive`,
  plus `doctor` and `init`): I diffed each one individually. **Every single
  one outside `doctor`/`init` is the identical one-line change** — threading
  `ctx.cfg` through to an existing `entryJson(...)`/`emitWriteResult(...)`
  call that previously didn't take it. No other line changed in any of
  these twelve files. `doctor` adds one new `if` block in
  `collectClaimFindings`, structurally identical to the existing
  `claim:mismatch`/`claim:orphaned` blocks beside it (independent `if`,
  not `else if` — see § 3's archived-element finding on what that implies).
  `init` explicitly destructures `claims` out of `DEFAULT_CONFIG` before
  writing it (`const { claims, ...written } = DEFAULT_CONFIG`), confirming
  **`init` does not write a `claims` block** — verified both by reading
  and empirically (a fresh `nj init`'s `config.json` has no `claims` key).

**No unintended behaviour change found anywhere in the diff.**

## 3. My own probes

- **Boundary: 23h (not stale), exactly 24h (not stale, "exceeds" not
  `>=`), 25h (stale)** — already AC-29's own E1; confirmed by reading
  `isClaimStale`'s strict `>`, not independently re-run (no value in
  duplicating a already-exact boundary test).
- **`NJ_NOW` unset, wall clock, claim seeded in the real past (2020).**
  Confirmed: without `NJ_NOW`, `doctor` correctly falls back to real
  wall-clock time and reports `claim:stale` for a claim genuinely years
  old — `nowMs()`'s reuse of `nowIso()` carries the fallback correctly.
- **`staleAfterHours`: 0 (disabled), 1, a large value (876,000h ≈ 100
  years), 1.5, -1, `"24"`, `true`, `null`, an unknown key.** All nine
  behave as AC-29's own E2/E3/E5 plus my own addition (the large value):
  0 disables unconditionally even for a 1000h-old claim (AC-29 E3); a
  large value (876,000) correctly suppresses staleness for a merely
  1-month-old claim, confirmed live, no `config:invalid` (a huge integer
  is still a valid non-negative integer — no upper bound is specified or
  needed); 1.5/-1/`"24"`/`true`/`null`/the unknown key all correctly
  produce `invalid_config` on `list` and `config:invalid` (only finding)
  on `doctor --json`, exit 2 (AC-29 E5, re-confirmed).
- **A missing `claims` block vs. an empty `{}` block.** § 5's own wording
  — "Default when **the key** or **the whole `claims` block** is absent:
  24" — explicitly covers both readings as the same default. Confirmed
  live: `"claims": {}` (block present, `staleAfterHours` key absent)
  behaves identically to no `claims` key at all — a 1-month-old claim is
  correctly `claim:stale` under the un-configured 24h default either way.
  AC-29's own E4 only tests the fully-absent case; I filled the
  empty-object case myself, matching the spec's own stated equivalence.
- **`--ready` unaffected.** Already AC-29's own E7 (a stale claim still
  hides the element from another acting name, and the holder still sees
  it) — not independently re-run, no value in duplicating an exact test.
- **`doctor --fix` leaves the claim byte-identical; exit code with only a
  stale warning.** Already AC-29's own E7 (`--fix` touches neither the
  element file nor the claim directory; `doctor` alone exits 0 with only
  `claim:stale` present) — confirmed by reading, matches the established
  `claim:mismatch`/`claim:orphaned` precedent exactly (the new `if` block
  in `collectClaimFindings` has no corresponding code anywhere in
  `fixStep7a`).
- **Archived, claimed (orphaned) elements: does `claim:stale` appear?**
  Not tested by AC-29. Built one myself: archived an element with an
  active claim (the claim directory survives only because I hand-recreated
  it after archiving, simulating the already-disclosed `claim:orphaned`
  straggler case), then made it old enough to be stale. **Result: all
  three of `claim:orphaned`, `claim:mismatch` (the mirror disagrees —
  `archive` cleared `assignee`, the stray claim still says `alice`), and
  `claim:stale` fire together**, since `collectClaimFindings`'s three
  checks are independent `if` statements, not mutually exclusive branches.
  This is **not incorrect** — each code states a fact that is
  independently true of this one stray directory — but it does mean a
  single leftover orphaned claim can produce three simultaneous warnings
  for what a human would read as one underlying issue ("there's a stray
  claim directory, clean it up"). Not a defect; worth being aware of if
  the noise ever becomes a usability concern, not something I'd block
  acceptance over.
- **The claims-root cache (`a6bd4e4`'s `claimsRootExists`): no new
  interaction.** `isClaimStale` is a pure function over `(since,
  threshold, now)` — it never touches the cache. `entryJson`'s own guard
  (`if (claim && isClaimStale(...))`) means the cache's already-disclosed,
  one-time-per-backlog staleness window (§ 12 Limits) can at most suppress
  `_claim` itself (returning `null` instead of the real claim); when that
  happens, `claim:stale` is correctly never computed either, for the same
  reason `_claim` is already `null` — the existing limitation extends
  transitively, not through any new mechanism. Confirmed by reading; no
  new disclosure needed.

## 4. The one finding: § 12's scope statement is narrower than the code

§ 12's new sentence: "`doctor`, `list` and `show` report `claim:stale`."
AC-29's own criterion text matches this exactly ("...on every read (`list`,
`show`, `doctor`)"). But `claim:stale` is computed inside `entryJson`
itself, which **every** entry-returning command calls through
`emitWriteResult` or directly — confirmed empirically, not just by
reading the diff: built a stale claim and checked `nj set` (an unrelated
field change), `nj note`, `nj tree`, and bare `nj` (the short-status
command) — **`claim:stale` appears in all four**, in exactly the same
`_problems` array shape `list`/`show`/`doctor` already carry it in.

This is very likely the *right* behaviour, not a bug: it is the same
treatment `claim:mismatch` and `claim:orphaned` already get (neither is
confined to a named subset of commands either — they appear wherever
`_problems` is rendered, which is the established, uniform rule "`_problems`
is always present... derived the same way" already states generically for
every JSON entry). Singling out `claim:stale` as "only these three
commands" would be the actual inconsistency, not the current universal
behaviour. **Recommend:** a one-sentence fix to § 12's wording — broaden
"`doctor`, `list` and `show`" to something like "every read that renders an
element's `_problems`, the same as `claim:mismatch`/`claim:orphaned`" — and
one new AC-29 case confirming it on at least one write command's own
`entry` (the `set`/`note` case I ran above would do), so the suite's own
coverage matches what the code actually, correctly does. This is a text
precision gap, not a behaviour defect; I would not block acceptance on it,
but it should be ruled one way or the other before the next proposal cites
`claim:stale`'s scope as settled.
