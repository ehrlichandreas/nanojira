// Is first-wins vs last-wins observable at all? Two files carry id EPIC-001:
// one active, one archived. archive:split on the child resolves through byId,
// so which duplicate wins decides whether the child carries the code.
const H = require('/home/dev/workspace/portable/projects/nanojira/test/lib/harness.js');
const d = H.mkBacklog({label:'lastwins', files:{
  'epics/EPIC-001.md': H.element({id:'EPIC-001',type:'epic',title:'Active twin',status:'todo',
    created:H.FIXED_NOW,updated:H.FIXED_NOW}, H.completeBody('Active twin')),
  'archive/EPIC-001.md': H.element({id:'EPIC-001',type:'epic',title:'Archived twin',status:'done',
    created:H.FIXED_NOW,updated:H.FIXED_NOW,archived:H.FIXED_NOW}, H.completeBody('Archived twin')),
  'tasks/TSK-001.md': H.element({id:'TSK-001',type:'task',parent:'EPIC-001',title:'Child',status:'todo',
    created:H.FIXED_NOW,updated:H.FIXED_NOW}, H.completeBody('Child')),
}, tombstones:['EPIC-001','TSK-001']});
const j = H.runJson(['list','--all'],{cwd:d});
const e = ((j.json&&j.json.entries)||[]).filter(x=>x.id==='TSK-001');
console.log('  TSK-001 _problems :', JSON.stringify(e.map(x=>x._problems)));
const doc = H.runJson(['doctor'],{cwd:d});
console.log('  doctor exit       :', doc.status);
console.log('  archive:split     :', JSON.stringify(((doc.json&&doc.json.problems)||[]).filter(p=>p.code==='archive:split').map(p=>p.element)));
