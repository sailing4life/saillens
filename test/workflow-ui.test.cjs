const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const html=fs.readFileSync(require('node:path').join(__dirname,'../SailLens.html'),'utf8');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function app(indexedDB=new IDBFactory()){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'https://saillens.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.indexedDB=indexedDB;w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;
  for(const k of ['Float64Array','Uint8Array','Uint32Array','Int8Array','Int16Array','Int32Array'])w[k]=global[k];
  Object.defineProperty(w,'crypto',{value:crypto});
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:t=>({width:String(t).length*7})},{get:(x,k)=>x[k]||(()=>{}),set:(x,k,v)=>(x[k]=v,true)});
 }});
 const w=dom.window;await pause(50);const $=s=>w.document.querySelector(s);
 const click=async name=>{const buttons=[...w.document.querySelectorAll('button')];const b=buttons.find(b=>b.textContent===name&&!b.closest('[hidden]'));assert.ok(b,'Button: '+name);b.click();await pause(30);};
 const fill=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));$(s).dispatchEvent(new w.Event('change',{bubbles:true}));};
 return {dom,w,$,click,fill,errors,indexedDB,run:code=>w.eval(code),close:()=>w.close()};
}
test('complete demo workflow: review, draft/apply/revert, formulas, notes, reload and boat isolation',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');assert.equal(a.run('A.tab'),'setup');assert.ok(a.run('A.D.phases.length')>100);
  a.run("show('review')");await a.click('Getoonde selectie goedkeuren');assert.equal(a.run('SL.calibrationPhases(A.D,WF.session.reviews).length'),40);
  a.run("WF.session.selections.analysis={start:A.raw.t0+100000,end:A.raw.t0+500000};A.view={z:2,x:4,y:7};show('cal')");
  const before=a.run('A.D.ch.BSP[200]');a.fill('#draft-bspK','1.05');assert.equal(a.run('A.D.ch.BSP[200]'),before);
  await a.click('Voorstel vergelijken');assert.equal(a.run('A.D.ch.BSP[200]'),before);
  await a.click('Voorstel toepassen');assert.ok(Math.abs(a.run('A.D.ch.BSP[200]')/before-1.05)<1e-9);
  assert.equal(a.run('A.view.z'),2);assert.equal(a.run('WF.session.selections.analysis.start'),a.run('A.raw.t0+100000'));
  await a.click('Terug naar gelogd');assert.equal(a.run('A.D.ch.BSP[200]'),before);
  a.run("show('boat')");a.fill('#formula-name','SignedVMG');a.fill('#formula-expression','BSP * cosD(TWA)');a.fill('#formula-unit','kn');
  await a.click('Voorbeeld berekenen');assert.match(a.$('#formula-preview').textContent,/geldige waarden/);
  await a.click('Formule opslaan bij boot');assert.equal(a.run('WF.session.profile.formulas.length'),0);
  await a.click('Profiel toepassen op deze sessie');assert.ok(a.run('A.D.ch.SignedVMG.length')>100);
  a.run("show('analysis')");a.fill('#debrief-note','Controleer herstel na de tack');await a.click('Notitie bewaren bij selectie');
  const id=a.run('WF.session.id');await a.run('WF.persist()');
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
  const b=await app(a.indexedDB);try{
    assert.equal(b.run('WF.session.id'),id);assert.equal(b.run('WF.session.notes[0].text'),'Controleer herstel na de tack');assert.ok(b.run('A.D.ch.SignedVMG.length')>100);
    b.run("show('boat')");b.fill('input[value="Voorbeeldboot"]','Voorbeeld hernoemd');await b.run('WF.persist()');
    b.fill('input[value="Voorbeeldboot"]','Tweede naam');await b.run('WF.persist()');assert.equal(b.run('WF.library.boats[0].name'),'Tweede naam');
    b.run("show('home')");b.fill('#new-boat-name','J/109');await b.click('Boot toevoegen');assert.equal(b.run('WF.session.profile.name'),'J/109');assert.equal(b.run('WF.session.profile.formulas.length'),0);assert.equal(b.run('A.calib.bspK'),1);assert.equal(b.run('A.raw'),null);
    assert.equal(b.errors.length,0,b.errors.map(e=>e.message).join('\n'));
  }finally{b.close();}
 }finally{a.close();}
});
test('all specialist views remain reachable and missing wind does not break navigation',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');
  for(const tab of ['setup','review','cal','analysis','perf','xy','man','wind','summary','polar','sails','report','events','boat','season']){a.run(`show('${tab}')`);assert.equal(a.run('A.tab'),tab);}
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
  a.run('delete A.raw.ch.TWA;delete A.raw.ch.TWS;delete A.raw.ch.AWA;delete A.raw.ch.AWS;recompute()');
  for(const tab of ['setup','review','cal','analysis','perf','xy','man','summary','report'])a.run(`show('${tab}')`);
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
 }finally{a.close();}
});
test('multi-file imports, duplicate detection, failed import rollback and project restore',async()=>{
 const a=await app();try{
  a.fill('#new-boat-name','Import boat');await a.click('Boot toevoegen');
  const t=Date.UTC(2026,10,17,10),csv=(start,n,bsp=7)=>['Time,BSP,TWA,TWS',...Array.from({length:n},(_,i)=>[new Date(t+(start+i)*1000).toISOString(),bsp,45,12].join(','))].join('\n');
  a.w.testFiles=[{name:'one.csv',text:async()=>csv(0,120)},{name:'two.csv',text:async()=>csv(180,120)}];
  await a.run('WF.importFiles(testFiles)');assert.equal(a.run('A.raw.n'),300);assert.equal(a.run('WF.session.sources.length'),2);
  await a.run('WF.importFiles([testFiles[0]])');assert.equal(a.run('WF.session.sources.length'),2);
  a.w.badFile={name:'conflict.csv',text:async()=>csv(60,120,9)};
  await a.run('WF.importFiles([badFile])');assert.equal(a.run('A.raw.n'),300);assert.equal(a.run('WF.session.sources.length'),2);assert.match(a.$('#banner').textContent,/overlappende/);
  const backup=a.run("SL.encodeProject({app:'SailLens',type:'project',version:1,boats:WF.library.boats,sessions:[WF.snapshot()],season:A.S})");
  a.w.backupFile={name:'project.json',text:async()=>backup};await a.run('WF.importFiles([backupFile])');
  assert.equal(a.run('WF.library.boats.length'),2);assert.equal(a.run('WF.library.sessions.length'),2);
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
 }finally{a.close();}
});
test('invalid measurement can be restored after its generated phase disappears',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run("show('review')");await a.click('Bekijk');a.fill('#review-reason','Sensor dropout');await a.click('Meting ongeldig');
  assert.ok(a.run('A.D.invalid.some(Boolean)'));assert.ok(a.$('#t-review').textContent.includes('Bewaarde uitsluitingen'));
  await a.click('Uitsluiting herstellen');assert.equal(a.run('A.D.invalid.some(Boolean)'),false);assert.equal(a.errors.length,0);
 }finally{a.close();}
});
test('unblurred edits survive saving, calibration comparison and reload',async()=>{
 const a=await app();try{
  const type=(selector,value)=>{a.$(selector).value=value;a.$(selector).dispatchEvent(new a.w.Event('input',{bubbles:true}));};
  await a.click('Bekijk voorbeeld');
  type('#session-name','Invoer zonder blur');await a.run('WF.persist()');
  a.run("show('cal')");type('#draft-awaOff','1.5');
  await a.run('WF.persist()');await a.click('Voorstel vergelijken');
  assert.equal(a.$('#draft-awaOff').value,'1.5');assert.equal(a.run('A.calib.awaOff'),0);
  assert.equal(a.run('WF.session.draft.awaOff'),1.5);
  await a.run('WF.persist()');
  await a.click('Boten & sessies');await a.run('WF.persist()');
  const b=await app(a.indexedDB);try{
   await b.click('Open sessie');assert.equal(b.run('A.tab'),'cal');
   assert.equal(b.run('WF.session.name'),'Invoer zonder blur');
   assert.equal(b.run('WF.session.draft.awaOff'),1.5);
   assert.equal(b.errors.length,0);
  }finally{b.close();}
 }finally{a.close();}
});
