'use strict';
/* Edge — the two discovery failures must not be told with one message (§ 4).
 *
 * § 4 "Backlog discovery", step 3:
 *   "If nothing is found: exit 1 with a hard error. Never fall back to a
 *    relative path, never operate on an empty backlog, never auto-create
 *    outside `nj init`. If a `backlog/` exists but `.nanojira/config.json` is missing,
 *    the error says exactly that and points at `nj doctor` (which tolerates the
 *    missing file and reports `config:invalid`) — never a plain 'no backlog
 *    found'."
 *
 * Two situations that look alike from the outside and want opposite repairs:
 * "there is no backlog here" sends an agent to the right directory, or to
 * `nj init`; "your `backlog/` is right there, its config is gone" sends it to
 * `nj doctor`. Collapsing the second into the first costs the agent the one
 * fact it needs, which is why § 4 spends a sentence forbidding it — and why
 * this probe asserts on the shape of the message, not only on the exit code.
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness.js');
const T = H.T;

/* § 4 step 1 short-circuits the walk, so every discovery probe unsets
 * NJ_BACKLOG: the upward walk is what is under test. */
const WALK = { unsetEnv: ['NJ_BACKLOG'] };

/* stdout + stderr: § 4 pins the *message*, not the stream it is written to,
 * and a caller that reads both must not be able to confuse the two cases. */
const prose = r => (r.stdout || '') + (r.stderr || '');

/* ---- a `backlog/` that exists without its `.nanojira/config.json` -------------- */

const bare = H.mkBacklog({ label: 'edge-disc-noconfig', tombstones: [] });
const bareConfig = path.join(bare, 'backlog', H.CONFIG_REL);
try { fs.rmSync(bareConfig); } catch (e) { /* the check below reports it */ }
T.check('fixture: backlog/ exists, .nanojira/config.json is gone',
  H.readOrNull(bareConfig) === null && H.lsOrEmpty(path.join(bare, 'backlog')).length > 0,
  JSON.stringify(H.lsOrEmpty(path.join(bare, 'backlog'))));

const bareHuman = H.runNj(['list'], Object.assign({ cwd: bare }, WALK));
T.exit('a backlog/ without .nanojira/config.json is a hard error (exit 1)', bareHuman, 1);
T.check('the failure reaches stderr (§ 9: the prose error text additionally goes to stderr)',
  bareHuman.stderr.trim().length > 0, 'stderr was empty; stdout: ' + JSON.stringify(bareHuman.stdout));

const bareMsg = prose(bareHuman);
T.contains('the error names the missing file', bareMsg, H.CONFIG_REL);
T.contains('the error points at nj doctor', bareMsg, 'nj doctor');
/* The wording § 4 names as the wrong answer for this case. */
T.check('the error is not a plain "no backlog found"',
  !/no backlog found/i.test(bareMsg), JSON.stringify(bareMsg));

const bareJson = H.runJson(['list'], Object.assign({ cwd: bare }, WALK));
T.exit('the same failure with --json is exit 1', bareJson, 1);
T.check('--json failure shape: {ok:false, error:"<code>"} (§ 9)',
  !!bareJson.json && bareJson.json.ok === false && typeof bareJson.json.error === 'string',
  JSON.stringify(bareJson.json || bareJson.stdout).slice(0, 300));
/* AMBIGUOUS: § 9 gives a closed set of failure codes but does not map exit
 * paths to codes; § 4 pins the *distinction* between this case and a plain
 * "no backlog found", not the two code names. The mapping is inferred from the
 * closed vocabulary's self-describing names, and it is asserted here because it
 * is the machine-readable half of § 4's sentence: an agent branching on the
 * code must be able to tell "no backlog" from "backlog without config". */
T.eq('the config-less backlog is reported as backlog_without_config',
  bareJson.json && bareJson.json.error, 'backlog_without_config');

/* ---- no backlog at all, in an unrelated directory ----------------------- */

const empty = H.freshDir('edge-disc-empty');

const emptyHuman = H.runNj(['list'], Object.assign({ cwd: empty }, WALK));
T.exit('a directory with no backlog at all is a hard error (exit 1)', emptyHuman, 1);

const emptyMsg = prose(emptyHuman);
T.check('the hard error is not silent', emptyMsg.trim().length > 0, 'no output at all');
T.check('the two discovery failures do not share one message',
  emptyMsg.trim() !== bareMsg.trim(),
  'both were ' + JSON.stringify(emptyMsg.trim()));
/* The pinned substance: a config file is not the *subject* of this failure. The
 * missing-config diagnosis (§ 4's "says exactly that", plus the `nj doctor`
 * pointer) belongs to the other case, and hearing it here would send the agent
 * looking for a file that was never meant to be there.
 *
 * AMBIGUOUS: § 4 does not forbid the absent case from *naming* the path it
 * searched — "looked for backlog/.nanojira/config.json upward from the working
 * directory" is a search breadcrumb, not a config diagnosis, and a message that
 * says what it looked for is more useful than one that does not. So the oracle
 * asserts that no config defect is reported, not that the file name never
 * appears; likewise, whether the absent case may also mention `nj doctor` is
 * unpinned (the pointer is pinned for the missing-config case only) and is
 * therefore not asserted in either direction. */
T.check('the absent-backlog case reports no config defect',
  !/no \.nanojira\.json|\.nanojira\.json (is )?(missing|absent)|backlog_without_config/i.test(emptyMsg),
  JSON.stringify(emptyMsg));

const emptyJson = H.runJson(['list'], Object.assign({ cwd: empty }, WALK));
T.exit('the absent case with --json is exit 1', emptyJson, 1);
T.check('--json failure shape for the absent case too',
  !!emptyJson.json && emptyJson.json.ok === false && typeof emptyJson.json.error === 'string',
  JSON.stringify(emptyJson.json || emptyJson.stdout).slice(0, 300));
/* AMBIGUOUS: as above — the code mapping is inferred from the closed
 * vocabulary's names rather than stated path by path in § 9. */
T.eq('the absent case is reported as no_backlog',
  emptyJson.json && emptyJson.json.error, 'no_backlog');

T.finish();
