'use strict';

// The clock: cli-kernel's `checkClockEnv`, `nowIso` and `nowMs`, pinned
// through NJ_NOW (§ 12, DECISIONS 207, 239). From cli-kernel v1.0.0 the
// kernel reads no variable until the project names it, so this module
// names it at load, before anything can tell the time. Every clock read
// goes through here (via `store.ts`); no other module imports the clock
// from `kernel.ts` (test/edge/kernel-neutral.ts pins both).

import { setClockEnv, checkClockEnv, nowIso, nowMs } from './kernel.ts';

setClockEnv('NJ_NOW');

export { checkClockEnv, nowIso, nowMs };
