// Neighbour fixture shapes: which of them separate the Notes rule from the fallback?
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || os.tmpdir();
import { track } from './lib/cleanup.ts';
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = JSON.stringify({ schema: 1, statuses: ['todo', 'done'], sections: { description: ['Description'], acceptance: ['Acceptance Criteria'] } }) + '\n';
const FM = '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: T\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n';
const shapes: Record<string, string> = {
  'A old form: Description then Notes':            '\n# T\n\n## Description\nD\n\n## Notes\n- n\n',
  'B new form: Description, Other, Notes':          '\n# T\n\n## Description\nD\n\n## Other\nO\n\n## Notes\n- n\n',
  'C no Description, only Notes':                   '\n# T\n\n## Notes\n- n\n',
  'D Notes BEFORE Description':                     '\n# T\n\n## Notes\n- n\n\n## Description\nD\n',
  'E two Notes headings':                           '\n# T\n\n## Description\nD\n\n## Notes\n- n1\n\n## Other\nO\n\n## Notes\n- n2\n',
  'F Notes then Other at end':                      '\n# T\n\n## Description\nD\n\n## Notes\n- n\n\n## Other\nO\n',
};
const bins = process.argv.slice(2);
for (const [name, body] of Object.entries(shapes)) {
  const outs = bins.map((nj) => {
    const d = track(fs.mkdtempSync(SCRATCH_BASE + '/r8-')); const bl = path.join(d, 'backlog');
    for (const s of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira/ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
    fs.writeFileSync(path.join(bl, '.nanojira/config.json'), CFG); fs.writeFileSync(path.join(bl, '.nanojira/ids', 'TSK-001'), '');
    fs.writeFileSync(path.join(bl, 'tasks', 'TSK-001.md'), FM + body);
    spawnSync(process.execPath, [nj, 'set', '--id=TSK-001', '--acceptance=- [ ] a'], { cwd: d, env: Object.assign({}, process.env, { NJ_NOW: LATER }), encoding: 'utf8' });
    return fs.readFileSync(path.join(bl, 'tasks', 'TSK-001.md'), 'utf8').split('\n---\n')[1].split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3)).join(' > ');
  });
  const distinct = new Set(outs).size;
  console.log((distinct > 1 ? 'SEPARATES ' : 'BLIND     ') + name + '\n    real: ' + outs[0] + '\n    M1:   ' + outs[1] + (outs[2] !== undefined ? '\n    M2:   ' + outs[2] : '') + (outs[3] !== undefined ? '\n    M3:   ' + outs[3] : ''));
}
