/* Edge — `set --input=-` reads stdin once (§ 9 "--input").
 *
 * "With `--input=-` the JSON itself is read from stdin, so a
 *  `<role>-file: "-"` inside it is refused with invalid_value — stdin is
 *  already consumed." `new` has always refused it; `set` used to read stdin a
 * second time, get nothing and write an empty description over the old one.
 * The control: with the JSON in a file, `"description-file": "-"` still reads
 * stdin as before.
 */
import fs from 'fs';
import path from 'path';
import * as H from '../lib/harness.ts';
const T = H.T;

function fixture(label: string): string {
  return H.mkBacklog({
    label,
    files: {
      'epics/EPIC-001.md': H.element({
        id: 'EPIC-001', type: 'epic', title: 'Auth', status: 'todo',
        created: H.FIXED_NOW, updated: H.FIXED_NOW,
      }, '# Auth\n\n## Description\nKEEP-THIS-TEXT\n\n## Acceptance Criteria\n- [ ] keep this box\n'),
    },
    tombstones: ['EPIC-001'],
  });
}

const epicPath = (d: string) => path.join(d, 'backlog', 'epics', 'EPIC-001.md');

for (const role of ['description', 'acceptance']) {
  const d = fixture(`edge-set-stdin-once-${role}`);
  const before = fs.readFileSync(epicPath(d), 'utf8');
  const r = H.runJson(['set', '--id=EPIC-001', '--input=-'],
    { cwd: d, input: JSON.stringify({ [`${role}-file`]: '-' }) });
  T.exit(`set --input=- with "${role}-file":"-" is refused`, r, 1);
  T.eq(`${role}: the code is invalid_value`, r.json && r.json.error, 'invalid_value');
  T.contains(`${role}: the message says stdin is already consumed`, r.stdout + r.stderr, 'already consumed');
  T.eq(`${role}: nothing was written (checksum)`,
    H.sha256(fs.readFileSync(epicPath(d), 'utf8')), H.sha256(before));
}

/* ---- control: the JSON from a file leaves stdin free ------------------- */
{
  const d = fixture('edge-set-stdin-once-control');
  const input = path.join(d, 'input.json');
  fs.writeFileSync(input, JSON.stringify({ 'description-file': '-' }));
  const r = H.runJson(['set', '--id=EPIC-001', `--input=${input}`],
    { cwd: d, input: 'FROM-STDIN\n', env: { NJ_NOW: H.LATER_NOW } });
  T.exit('set --input=<file> with "description-file":"-" reads stdin', r, 0);
  const after = fs.readFileSync(epicPath(d), 'utf8');
  T.contains('the description came from stdin', after, '## Description\nFROM-STDIN\n');
  T.check('the old description is gone', !after.includes('KEEP-THIS-TEXT'), JSON.stringify(after));
}

T.finish();
