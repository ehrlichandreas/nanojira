'use strict';
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || require('os').tmpdir();
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || '/home/dev/workspace/portable/projects/nanojira/nj';
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo','done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
const FM = '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: T\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n';
const d = fs.mkdtempSync(SCRATCH_BASE + '/r6bc-'); const bl = path.join(d, 'backlog');
for (const s of ['epics','tasks','subtasks','archive','.ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
fs.writeFileSync(path.join(bl, '.nanojira.json'), CFG); fs.writeFileSync(path.join(bl, '.ids', 'TSK-001'), '');
const f = path.join(bl, 'tasks', 'TSK-001.md'); fs.writeFileSync(f, FM + '\n# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
const c = spawn(process.execPath, [NJ, 'set', '--id=TSK-001', '--description=mine', '--json'], { cwd: d, env: Object.assign({}, process.env, { NJ_NOW: LATER, NJ_FAULT: 'before-compare' }) });
let out = ''; c.stdout.on('data', x => out += x);
setTimeout(() => { fs.writeFileSync(f, FM + '\n# T\n\n## Description\ntheirs\n\n## Acceptance Criteria\n- [ ] x\n'); fs.writeFileSync(path.join(bl, '.nj-fault-go'), ''); }, 800);
c.on('close', code => { const j = JSON.parse(out); const after = fs.readFileSync(f, 'utf8'); console.log((code === 1 && j.error === 'changed_in_parallel' && after.includes('\ntheirs\n') ? '  ✓' : '  ✗') + ' section write under before-compare: exit ' + code + ' ' + j.error + ', parallel bytes kept=' + after.includes('\ntheirs\n')); });
