#!/usr/bin/env node
'use strict';

// NanoJira — local, file-based task tool for agents.
// Round one, per docs/SPECIFICATION.md v2. Node built-ins only.

// Node's native .ts execution needs the .ts extension on every import path
// below. The targets are real ES modules (export/import throughout, S4);
// this entry is one too now, so tsc resolves the same import calls against
// their real exports, so a wrong name or a wrong call shape here is a
// compile error like anywhere else -- no cast needed, unlike the JSDoc-era
// module.exports boundary this replaced.
import { parseArgs } from './core/args.ts';
import { cmdArchive } from './commands/cmd-archive.ts';
import { cmdCheck } from './commands/cmd-check.ts';
import { cmdClaim } from './commands/cmd-claim.ts';
import { cmdFind } from './commands/cmd-find.ts';
import { cmdDoctor } from './commands/cmd-doctor.ts';
import { cmdInit } from './commands/cmd-init.ts';
import { cmdList } from './commands/cmd-list.ts';
import { cmdNew } from './commands/cmd-new.ts';
import { cmdNote } from './commands/cmd-note.ts';
import { cmdRelease } from './commands/cmd-release.ts';
import { cmdRm } from './commands/cmd-rm.ts';
import { cmdSet } from './commands/cmd-set.ts';
import { cmdShow } from './commands/cmd-show.ts';
import { cmdStatus } from './commands/cmd-status.ts';
import { cmdTree } from './commands/cmd-tree.ts';
import { cmdUnarchive } from './commands/cmd-unarchive.ts';
import { HELP } from './core/help.ts';
import { Fail, fail, output, emitFailure } from './core/output.ts';
import { VERSION } from './core/version.ts';

// --------------------------------------------------------------------- main

function main(argv: string[]) {
  // `--version` is checked on the raw, full argument list — before a
  // command is even picked out of it — so it works ahead of any backlog
  // resolution a command (including bare `nj`) would otherwise perform
  // (§ 9 "--version"). It recognises only itself and `--json`; combined
  // with anything else (another flag, or a bare word that would otherwise
  // be a command/positional) it is `unknown_field`, not a special case.
  const pre = parseArgs(argv);
  output.json = pre.flags.has('json');
  if (pre.flags.has('version')) {
    const onlyVersionAndJson = Array.from(pre.flags.keys()).every((k) => k === 'version' || k === 'json');
    if (onlyVersionAndJson && pre.positional.length === 0) {
      process.stdout.write(output.json ? JSON.stringify({ version: VERSION }) + '\n' : `nj ${VERSION}\n`);
      return 0;
    }
    fail('unknown_field', `unknown field 'version'.`, '--version takes no other flag and names no command');
  }

  const cmd = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : null;
  const { flags, positional } = parseArgs(cmd === null ? argv : argv.slice(1));

  if (cmd === 'help' || flags.has('help')) { process.stdout.write(HELP); return 0; }

  switch (cmd) {
    case null: return cmdStatus(flags);
    case 'init': return cmdInit(flags);
    case 'new': return cmdNew(flags);
    case 'set': return cmdSet(flags);
    case 'note': return cmdNote(flags, positional);
    case 'check': return cmdCheck(flags);
    case 'show': return cmdShow(flags);
    case 'list': return cmdList(flags);
    case 'find': return cmdFind(flags, positional);
    case 'tree': return cmdTree(flags);
    case 'rm': return cmdRm(flags);
    case 'archive': return cmdArchive(flags);
    case 'unarchive': return cmdUnarchive(flags);
    case 'claim': return cmdClaim(flags);
    case 'release': return cmdRelease(flags);
    case 'doctor': return cmdDoctor(flags);
    default:
      fail('unknown_command', `unknown command '${cmd}'`, 'run `nj help` for the command list');
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e: any) {
  if (e instanceof Fail) {
    emitFailure(e.code, e.message, e.hint);
  } else {
    // `io_error` is reported only where a command already knows what named
    // target it was acting on — `init`'s own target, `workingDir()` — and
    // wraps that specific operation itself. A generic catch here cannot know
    // the target, so it cannot tell an OS answer about a path from a real
    // bug; conflating the two once hid a genuine defect (an archive's own
    // `mkdir` failing mid-move) behind an innocent-looking environment label,
    // with the stack that would have said "bug" gone (TSK-029 T2). Anything
    // that reaches here keeps its stack.
    emitFailure('internal_error', e && e.stack ? e.stack : String(e));
  }
}
