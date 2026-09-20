// D189 (docs/DECISIONS.md 189): every scratch probe's mkdtemp fixture gets
// removed when the probe exits, on success and on failure alike -- wrap
// each fs.mkdtempSync(...) call with track() and the directory it returns
// is queued for removal in a single process-wide `exit` handler, which node
// still runs after an uncaught exception (the default handler prints the
// trace and calls process.exit(1), which fires 'exit' first). Only paths a
// probe created itself are ever queued -- nothing else under
// HARNESS_SCRATCH_BASE is touched.
import fs from 'fs';

const created: string[] = [];
function cleanup(): void {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanup);

// A caller with its own timeout (test/run-all.mjs's spawnSync, the gate's own
// tee()) kills a probe that overruns it with SIGTERM, not by waiting for the
// event loop to drain -- node's default disposition for SIGTERM/SIGINT/SIGHUP
// terminates the process immediately without ever firing 'exit', so the
// handler above never runs. These three signals get their own handler
// instead: clean up, drop the handler, then re-raise the same signal against
// our own pid so the default disposition finishes the job -- the parent
// still sees the probe die BY that signal (spawnSync's own `signal` field),
// exactly as it would have with no handler at all, and nothing a probe did
// not already print itself appears on stdout or stderr.
const SIGNALS: NodeJS.Signals[] = ['SIGHUP', 'SIGINT', 'SIGTERM'];
for (const name of SIGNALS) {
  const handler = () => {
    cleanup();
    process.removeListener(name, handler);
    process.kill(process.pid, name);
  };
  process.on(name, handler);
}

export function track(dir: string): string {
  created.push(dir);
  return dir;
}
