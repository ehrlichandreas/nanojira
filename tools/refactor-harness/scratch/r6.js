'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
// Scratch base made self-sufficient: these probes hardcoded /tmp/v2, so the
// corpus part they feed vanished on reboot and `record` aborted with code 4.
// os.tmpdir() always exists; HARNESS_SCRATCH_BASE overrides it.
const SCRATCH_BASE = process.env.HARNESS_SCRATCH_BASE || require('os').tmpdir();
const { track } = require('./lib/cleanup.js');
// argv[2] zuerst: ohne das laeuft die Sonde am Shim vorbei, traegt nichts
// zum Korpus bei -- und prueft obendrein ein anderes nj als das, das
// gerade unter Test steht.
const NJ = process.argv[2] || path.join(__dirname, '..', '..', '..', 'src', 'nj.ts');
const NOW = '2026-09-21T18:00:00Z', LATER = '2026-09-21T19:30:00Z';
const CFG = (sec) => JSON.stringify({ schema: 1, statuses: ['todo','doing','blocked','review','done'], sections: sec || { description: ['Description'], acceptance: ['Acceptance Criteria'] } }, null, 2) + '\n';
let n = 0, bad = 0;
function ok(desc, cond, detail) { n++; if (!cond) { bad++; console.log('  ✗ ' + desc + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 700) : '')); } else console.log('  ✓ ' + desc); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const FM = (extra) => '---\nid: TSK-001\ntype: task\nparent: EPIC-001\ntitle: T\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n' + (extra || '') + '---\n';
const EPIC = '---\nid: EPIC-001\ntype: epic\ntitle: E\nstatus: todo\ncreated: ' + NOW + '\nupdated: ' + NOW + '\n---\n\n# E\n\n## Description\nD\n';
function mk(label, body, cfg, extraFiles) {
  const d = track(fs.mkdtempSync(path.join(SCRATCH_BASE, 'r6-' + label + '-'))); const bl = path.join(d, 'backlog');
  for (const s of ['epics','tasks','subtasks','archive','.nanojira/ids']) fs.mkdirSync(path.join(bl, s), { recursive: true });
  fs.writeFileSync(path.join(bl, '.nanojira/config.json'), cfg || CFG());
  fs.writeFileSync(path.join(bl, 'epics', 'EPIC-001.md'), EPIC);
  if (body !== null) fs.writeFileSync(path.join(bl, 'tasks', 'TSK-001.md'), Buffer.isBuffer(body) ? body : FM() + body);
  for (const [rel, c] of Object.entries(extraFiles || {})) fs.writeFileSync(path.join(bl, rel), c);
  for (const t of ['EPIC-001','TSK-001']) fs.writeFileSync(path.join(bl, '.nanojira/ids', t), '');
  return d;
}
function run(args, cwd, opts) { const o = opts || {}; const r = spawnSync(process.execPath, [NJ].concat(args), { cwd, input: o.input, env: Object.assign({}, process.env, { NJ_NOW: o.now || LATER }, o.env || {}), encoding: 'utf8', timeout: 20000 }); let json = null; try { json = JSON.parse(r.stdout); } catch {} return { status: r.status, out: r.stdout, err: r.stderr, json }; }
const task = d => path.join(d, 'backlog', 'tasks', 'TSK-001.md');
const bodyOf = d => fs.readFileSync(task(d), 'utf8').split('\n---\n')[1];
const probs = (d, id) => (run(['list','--all','--json'], d).json.entries.find(e => e.id === (id || 'TSK-001')) || {})._problems;

console.log('[1] heading aliases, colon, case');
{
  const d = mk('colon', '# T\n\n## Description:\nold\n\n## acceptance criteria\n- [ ] x\n');
  const r = run(['set','--id=TSK-001','--description=new','--json'], d);
  ok('write matches `## Description:` (colon tolerated on read) instead of inserting a second heading', r.status === 0 && bodyOf(d) === '\n# T\n\n## Description:\nnew\n\n## acceptance criteria\n- [ ] x\n', bodyOf(d));
  const r2 = run(['set','--id=TSK-001','--acceptance=- [ ] y','--json'], d);
  ok('write matches lower-case `## acceptance criteria` (case-insensitive)', r2.status === 0 && (bodyOf(d).match(/^## /mg) || []).length === 2 && /## acceptance criteria\n- \[ \] y\n$/.test(bodyOf(d)), bodyOf(d));
  const d2 = mk('alias', '# T\n\n## Beschreibung\nalt\n\n## Akzeptanzkriterien\n- [ ] x\n', CFG({ description: ['Description', 'Beschreibung'], acceptance: ['Acceptance Criteria', 'Akzeptanzkriterien'] }));
  const r3 = run(['set','--id=TSK-001','--description=neu','--json'], d2);
  ok('write matches the second configured alias `## Beschreibung` (no new `## Description` inserted)', r3.status === 0 && bodyOf(d2) === '\n# T\n\n## Beschreibung\nneu\n\n## Akzeptanzkriterien\n- [ ] x\n', bodyOf(d2));
  const d3 = mk('hdr-trail', '# T\n\n## Description   \nold\n\n## Acceptance Criteria\n- [ ] x\n');
  const r4 = run(['set','--id=TSK-001','--description=new','--json'], d3);
  ok('heading with trailing spaces matched, heading bytes preserved', r4.status === 0 && bodyOf(d3).includes('## Description   \nnew\n\n## Acceptance'), bodyOf(d3));
  const d4 = mk('h3', '# T\n\n## Description\nold\n### Detail\nmore\n\n## Acceptance Criteria\n- [ ] x\n');
  run(['set','--id=TSK-001','--description=new','--json'], d4);
  ok('### subsection is part of the region and gets replaced (decision 11)', bodyOf(d4) === '\n# T\n\n## Description\nnew\n\n## Acceptance Criteria\n- [ ] x\n', bodyOf(d4));
  const d5 = mk('nospace', '# T\n\n##Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  run(['set','--id=TSK-001','--description=new','--json'], d5);
  ok('`##Description` (no space) is not a heading: a real `## Description` is inserted after the H1', /^\n# T\n\n## Description\nnew\n\n##Description\nold\n/.test(bodyOf(d5)), bodyOf(d5));
}

console.log('\n[2] BOM + CRLF file, content normalisation');
{
  const crlf = Buffer.from('﻿' + FM().replace(/\n/g, '\r\n') + '\r\n# T\r\n\r\n## Description\r\nold\r\n\r\n## Acceptance Criteria\r\n- [ ] x\r\n', 'utf8');
  const d = mk('crlf', crlf);
  const r = run(['set','--id=TSK-001','--description=a\r\nb\r\n\r\n','--json'], d);
  const buf = fs.readFileSync(task(d));
  ok('BOM+CRLF file rewritten LF/no-BOM; CRLF content normalised, trailing newlines stripped', r.status === 0 && !buf.includes(0x0d) && buf[0] !== 0xef && bodyOf(d) === '\n# T\n\n## Description\na\nb\n\n## Acceptance Criteria\n- [ ] x\n', bodyOf(d));
  const d2 = mk('lead', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  run(['set','--id=TSK-001','--description=\n\nlead','--json'], d2);
  console.log('    note: leading blank lines in content → ' + JSON.stringify(bodyOf(d2).split('## Description\n')[1].split('\n## ')[0]) + ' (spec: "text as given", only trailing newlines stripped)');
  const d3 = mk('ws', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  const r3 = run(['set','--id=TSK-001','--description=   ','--json'], d3);
  ok('whitespace-only content → section counts absent → _problems has incomplete:description', r3.json && r3.json._problems.includes('incomplete:description') && r3.json.changed.includes('description'), r3.json);
  const d4 = mk('inject', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  run(['set','--id=TSK-001','--description=intro\n## Rollout\nlater','--json'], d4);
  const r4 = run(['set','--id=TSK-001','--description=again','--json'], d4);
  console.log('    note: content containing a `## ` line splits the section; second write replaces only up to the injected heading → ' + JSON.stringify(bodyOf(d4)));
  ok('injected heading survives as its own section (region ends at next level-2 heading)', bodyOf(d4) === '\n# T\n\n## Description\nagain\n\n## Rollout\nlater\n\n## Acceptance Criteria\n- [ ] x\n', bodyOf(d4));
}

console.log('\n[3] empty / degenerate bodies');
{
  const d = mk('empty', '');
  const r = run(['set','--id=TSK-001','--description=D','--json'], d);
  ok('empty body: description inserted, file well-formed', r.status === 0 && fs.readFileSync(task(d), 'utf8').endsWith('---\n\n## Description\nD\n'), fs.readFileSync(task(d), 'utf8').slice(-40));
  console.log('    empty-body result tail: ' + JSON.stringify(fs.readFileSync(task(d), 'utf8').slice(-30)));
  const dn = mk('nl', '\n');
  run(['set','--id=TSK-001','--acceptance=- [ ] a','--json'], dn);
  ok('body "\\n" only: acceptance inserted, exactly one blank line after ---, one trailing newline', fs.readFileSync(task(dn), 'utf8').endsWith('---\n\n## Acceptance Criteria\n- [ ] a\n'), fs.readFileSync(task(dn), 'utf8').slice(-50));
  const d2 = mk('nonl', '# T\n\n## Description\nold');
  const r2 = run(['set','--id=TSK-001','--acceptance=- [ ] a','--json'], d2);
  ok('body without trailing newline: insert at end yields exactly one trailing newline', r2.status === 0 && /\n## Acceptance Criteria\n- \[ \] a\n$/.test(bodyOf(d2)) && !bodyOf(d2).endsWith('\n\n'), bodyOf(d2));
  const d3 = mk('lastempty', '# T\n\n## Description\n\n## Acceptance Criteria');
  const r3 = run(['set','--id=TSK-001','--acceptance=- [ ] a','--json'], d3);
  ok('heading as last line without newline: content appended, one trailing newline', r3.status === 0 && bodyOf(d3) === '\n# T\n\n## Description\n\n## Acceptance Criteria\n- [ ] a\n', bodyOf(d3));
  const d4 = mk('h1only', '# T\n');
  run(['set','--id=TSK-001','--acceptance=- [ ] a','--description=D','--json'], d4);
  ok('H1-only body: description then acceptance inserted in canonical order', bodyOf(d4) === '\n# T\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] a\n', bodyOf(d4));
  const d5 = mk('noh1-dblblank', '\n\n## Acceptance Criteria\n- [ ] x\n');
  run(['set','--id=TSK-001','--description=D','--json'], d5);
  console.log('    note: no-H1 body with TWO leading blank lines → ' + JSON.stringify(bodyOf(d5)));
  const d6 = mk('notes-first', '# T\n\n## Notes\n- n\n\n## Description\nD\n');
  run(['set','--id=TSK-001','--acceptance=- [ ] a','--json'], d6);
  console.log('    note: Notes BEFORE Description → acceptance lands: ' + JSON.stringify(bodyOf(d6)) + ' (spec: before Notes wins over after description)');
  const d7 = mk('desc-content-h1', '## Acceptance Criteria\n- [ ] x\n');
  const r7 = run(['set','--id=TSK-001','--description=# Not a title\ntext','--json'], d7);
  console.log('    note: no-H1 body + description content starting with "# " → _problems ' + JSON.stringify(r7.json && r7.json._problems) + ' (content becomes the H1 → title:h1_mismatch?)');
}

console.log('\n[4] epic + acceptance, every type');
{
  const d = mk('epic', null);
  const r = run(['set','--id=EPIC-001','--acceptance=- [ ] e','--json'], d);
  ok('epic accepts --acceptance: inserted after description, changed [acceptance], no incomplete:*', r.status === 0 && JSON.stringify(r.json.changed) === '["acceptance"]' && r.json._problems.length === 0 && fs.readFileSync(path.join(d,'backlog','epics','EPIC-001.md'),'utf8').endsWith('## Description\nD\n\n## Acceptance Criteria\n- [ ] e\n'), r.json);
  const r2 = run(['set','--id=EPIC-001','--description=','--json'], d);
  ok('epic --description= (empty) → incomplete:description returns', r2.json && r2.json._problems.includes('incomplete:description'), r2.json);
  const r3 = run(['new','--type=epic','--title=E2','--acceptance=- [ ] a','--json'], d);
  ok('new epic with --acceptance: body gets acceptance after description; changed = [id,type,title,status,acceptance]', r3.status === 0 && JSON.stringify(r3.json.changed) === '["id","type","title","status","acceptance"]' && fs.readFileSync(path.join(d,'backlog','epics','EPIC-002.md'),'utf8').endsWith('# E2\n\n## Description\n\n## Acceptance Criteria\n- [ ] a\n'), r3.json && r3.json.changed);
}

console.log('\n[5] stdin + --json, file sources, mutual exclusion');
{
  const d = mk('stdin', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  const r = run(['set','--id=TSK-001','--description-file=-','--json'], d, { input: 'from stdin\n' });
  ok('stdin + --json: JSON on stdout, content written', r.status === 0 && r.json && r.json.ok && bodyOf(d).includes('## Description\nfrom stdin\n\n## Acceptance'), r.out);
  const r0 = run(['set','--id=TSK-001','--description-file=-','--json'], d, { input: '' });
  ok('empty stdin → section emptied (changed [description])', r0.status === 0 && JSON.stringify(r0.json.changed) === '["description"]' && bodyOf(d).includes('## Description\n\n## Acceptance'), r0.json);
  const rb = run(['set','--id=TSK-001','--description-file=-','--json'], d, { input: Buffer.from('﻿bom\r\nx\r\n', 'utf8') });
  ok('stdin with BOM+CRLF normalised', rb.status === 0 && bodyOf(d).includes('## Description\nbom\nx\n\n## Acceptance'), bodyOf(d));
  const src = path.join(d, 'src.txt'); fs.writeFileSync(src, 'file content\n\n\n');
  const rf = run(['set','--id=TSK-001','--description-file=' + src,'--acceptance-file=-','--json'], d, { input: '- [ ] via stdin\n' });
  ok('file for one role + stdin for the other in one call works', rf.status === 0 && bodyOf(d) === '\n# T\n\n## Description\nfile content\n\n## Acceptance Criteria\n- [ ] via stdin\n', bodyOf(d));
  const h = sha(fs.readFileSync(task(d)));
  for (const [args, code] of [[['--description=a','--description-file=' + src], 'invalid_value'], [['--description-file=-','--acceptance-file=-'], 'invalid_value'], [['--description-file=' + path.join(d, 'nope')], 'not_found'], [['--description-file='], 'not_found'], [['--description'], 'missing_value'], [['--description-file'], 'missing_value'], [['--acceptance=a','--acceptance-file=-'], 'invalid_value']]) {
    const x = run(['set','--id=TSK-001'].concat(args, ['--json']), d, { input: 'stdin data' });
    ok(`set ${args.map(a => a.replace(d, '<d>')).join(' ')} → ${code}, nothing written`, x.status === 1 && x.json && x.json.error === code && sha(fs.readFileSync(task(d))) === h, x.json);
  }
  const dir = path.join(d, 'adir'); fs.mkdirSync(dir);
  const xd = run(['set','--id=TSK-001','--description-file=' + dir,'--json'], d);
  ok('--description-file=<directory> → not_found (EISDIR), nothing written', xd.status === 1 && xd.json.error === 'not_found' && sha(fs.readFileSync(task(d))) === h, xd.json);
  // stdin drained before a later failure? (ordering)
  const xo = run(['set','--id=TSK-001','--description-file=-','--acceptance-file=' + path.join(d,'nope'),'--json'], d, { input: 'x' });
  ok('stdin for description + missing acceptance file → not_found, nothing written', xo.status === 1 && xo.json.error === 'not_found' && sha(fs.readFileSync(task(d))) === h);
  // new: rejection burns no tombstone, even with stdin
  const ids = fs.readdirSync(path.join(d,'backlog','.nanojira/ids')).sort().join();
  const xn = run(['new','--type=task','--parent=EPIC-001','--title=N','--description-file=-','--acceptance-file=-','--json'], d, { input: 'x' });
  ok('new with - for both roles → invalid_value, no tombstone, no file', xn.json.error === 'invalid_value' && fs.readdirSync(path.join(d,'backlog','.nanojira/ids')).sort().join() === ids && fs.readdirSync(path.join(d,'backlog','tasks')).length === 1);
  const xn2 = run(['new','--type=task','--parent=NOPE','--title=N','--description-file=-','--json'], d, { input: 'x' });
  ok('new: parent not_found reported before stdin matters', xn2.json.error === 'not_found');
  const xdup = run(['set','--id=TSK-001','--description=one','--description=two','--json'], d);
  console.log('    note: --description given twice → exit ' + xdup.status + ' ' + JSON.stringify(xdup.json && (xdup.json.error || xdup.json.changed)) + ' body has "two"? ' + bodyOf(d).includes('\ntwo\n'));
  // unknown_field listing includes the section fields
  const xu = run(['set','--id=TSK-001','--descripton=x','--json'], d);
  ok('typo → unknown_field, hint lists description/acceptance fields', xu.json.error === 'unknown_field' && /description/.test(xu.json.hint) && /acceptance/.test(xu.json.hint), xu.json);
  const xr = run(['rm','--id=TSK-001','--description=x','--json'], d);
  ok('section flag on rm → unknown_field', xr.json.error === 'unknown_field');
  const xnote = run(['note','--id=TSK-001','hi','--description=x','--json'], d);
  ok('section flag on note → unknown_field', xnote.json.error === 'unknown_field');
}

console.log('\n[6] changed ordering + composition with --title');
{
  const d = mk('order', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n');
  const r = run(['set','--id=TSK-001','--acceptance=- [ ] new','--description=new','--status=doing','--title=T2','--json'], d);
  ok('set changed order: fields first (title,status) then roles in canonical order (description, acceptance) regardless of flag order', JSON.stringify(r.json.changed) === '["title","status","description","acceptance"]', r.json.changed);
  ok('--title + sections compose: H1 synced AND sections written', bodyOf(d) === '\n# T2\n\n## Description\nnew\n\n## Acceptance Criteria\n- [ ] new\n', bodyOf(d));
  const r2 = run(['set','--id=TSK-001','--acceptance=- [ ] new','--description=other','--json'], d);
  ok('only the role whose bytes changed is listed', JSON.stringify(r2.json.changed) === '["description"]', r2.json.changed);
  const r3 = run(['set','--id=TSK-001','--description=other','--json'], d);
  ok('identical content → changed [], updated untouched, file byte-identical', JSON.stringify(r3.json.changed) === '[]' && /updated: 2026-09-21T19:30:00Z/.test(fs.readFileSync(task(d), 'utf8')), r3.json);
  const d2 = mk('neworder', null);
  const r4 = run(['new','--type=task','--parent=EPIC-001','--title=N','--acceptance=- [ ] a','--tags=x','--description=d','--json'], d2);
  ok('new changed: FIELD_ORDER fields then description, acceptance', JSON.stringify(r4.json.changed) === '["id","type","parent","title","status","tags","description","acceptance"]', r4.json.changed);
  ok('new with sections: no incomplete:*, ready', r4.json._problems.length === 0 && run(['list','--ready','--json'], d2).json.entries.some(e => e.id === r4.json.id));
  ok('new golden still exact (scaffold + sections)', fs.readFileSync(path.join(d2,'backlog','tasks',r4.json.id + '.md'),'utf8').endsWith('# N\n\n## Description\nd\n\n## Acceptance Criteria\n- [ ] a\n'));
}

console.log('\n[7] write refusals still apply to section writes');
{
  const d = mk('refuse', '# T\n\n## Description\nold\n\n## Acceptance Criteria\n- [ ] x\n', null, { 'archive/TSK-009.md': FM().replace('TSK-001','TSK-009').replace(/status: todo/, 'status: done').replace('---\n$', 'archived: ' + NOW + '\n---\n') + '\n# A\n\n## Description\nD\n\n## Acceptance Criteria\n- [ ] x\n', 'tasks/TSK-002.md': FM().replace('TSK-001','TSK-002').replace('title: T', 'title: B\nbroken line') + '\n# B\n' });
  fs.writeFileSync(path.join(d,'backlog','.nanojira/ids','TSK-009'), ''); fs.writeFileSync(path.join(d,'backlog','.nanojira/ids','TSK-002'), '');
  ok('archived → refused:archived', run(['set','--id=TSK-009','--description=x','--json'], d).json.error === 'refused:archived');
  ok('frontmatter-unreadable → refused:unreadable', run(['set','--id=TSK-002','--description=x','--json'], d).json.error === 'refused:unreadable');
  fs.writeFileSync(path.join(d,'backlog','tasks','TSK-001-copy.md'), FM() + '# T\n');
  ok('duplicate id → duplicate_id', run(['set','--id=TSK-001','--description=x','--json'], d).json.error === 'duplicate_id');
  const r = run(['set','--file=tasks/TSK-001-copy.md','--description=x','--json'], d);
  ok('--file escape + section write works', r.status === 0 && r.json.changed[0] === 'description');
  const h = sha(fs.readFileSync(task(d)));
  const f = run(['set','--file=tasks/TSK-001.md','--description=fault','--json'], d, { env: { NJ_FAULT: 'before-rename' } });
  ok('NJ_FAULT=before-rename: section write aborted, target byte-identical, fault code', f.status === 1 && f.json.error === 'fault:before-rename' && sha(fs.readFileSync(task(d))) === h);
}
console.log(`\n${n - bad}/${n} checks passed, ${bad} failed`);
