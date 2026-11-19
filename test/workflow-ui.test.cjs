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
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,dGVzdA==';
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:t=>({width:String(t).length*7})},{get:(x,k)=>x[k]||(()=>{}),set:(x,k,v)=>(x[k]=v,true)});
 }});
 const w=dom.window;const $=s=>w.document.querySelector(s);for(let n=0;n<200&&!$('#new-boat-name');n++)await pause(10);assert.ok($('#new-boat-name'),'workspace initialized');
 const click=async name=>{const buttons=[...w.document.querySelectorAll('button')];const b=buttons.find(b=>b.textContent===name&&!b.closest('[hidden]'));assert.ok(b,'Button: '+name);b.click();await pause(30);if(name==='Bekijk voorbeeld')for(let n=0;n<200&&w.eval('A.tab')!=='events';n++)await pause(10);};
 const fill=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));$(s).dispatchEvent(new w.Event('change',{bubbles:true}));};
 return {dom,w,$,click,fill,errors,indexedDB,run:code=>w.eval(code),close:()=>w.close()};
}
test('complete demo workflow: review, draft/apply/revert, formulas, notes, reload and boat isolation',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');assert.equal(a.run('A.tab'),'events');assert.equal(a.run('A.D.phases.length'),0);a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');assert.ok(a.run('A.D.phases.length')>100);
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
  await a.run("STUDIO.publish()");a.fill('#debrief-note','Controleer herstel na de tack');await a.click('Notitie bewaren bij selectie');
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
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');await a.run('STUDIO.publish()');
  for(const tab of ['setup','review','cal','analysis','daycharts','dist','prestart','perf','xy','man','wind','summary','polar','sails','report','events','boat','season']){a.run(`show('${tab}')`);assert.equal(a.run('A.tab'),tab);}
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
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');a.run("show('review')");await a.click('Bekijk');a.fill('#review-reason','Sensor dropout');await a.click('Meting ongeldig');
  assert.ok(a.run('A.D.invalid.some(Boolean)'));assert.ok(a.$('#t-review').textContent.includes('Bewaarde uitsluitingen'));
  await a.click('Uitsluiting herstellen');assert.equal(a.run('A.D.invalid.some(Boolean)'),false);assert.equal(a.errors.length,0);
 }finally{a.close();}
});
test('unblurred edits survive saving, calibration comparison and reload',async()=>{
 const a=await app();try{
  const type=(selector,value)=>{a.$(selector).value=value;a.$(selector).dispatchEvent(new a.w.Event('input',{bubbles:true}));};
  await a.click('Bekijk voorbeeld');
  a.run("show('setup')");type('#session-name','Invoer zonder blur');await a.run('WF.persist()');
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
test('explicit phases, pair review, immutable reports and new saved versions',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');assert.equal(a.run('A.D.phases.length'),0);
  a.run("show('analysis')");assert.equal(a.run('A.tab'),'cal');
  a.run("show('events')");await a.click('+ Event');assert.ok(a.$('#event-time'));a.fill('#event-kind','MiscEvent');a.fill('#event-note','Controle moment');await a.click('Event toevoegen');
  assert.ok(a.run("A.events.events.some(e=>e.comments==='Controle moment')"));
  a.run("STUDIO.generate({...SL.phaseDefaults(A.cfg),scope:'racing',race:'1'})");
  assert.ok(a.run('A.D.phases.length')>0);assert.equal(a.run('A.D.phases.every(p=>p.race===1)'),true);
  const ranges=a.run('JSON.stringify(WF.session.phaseBuild.ranges)');
  a.run("show('pairreview')");assert.ok(a.$('#pair-before-start'));assert.ok(a.run('Object.keys(WF.session.manoeuvrePairs).length')>0);
  a.run("show('cal')");a.fill('#draft-bspK','1.02');await a.click('Voorstel toepassen');assert.equal(a.run('JSON.stringify(WF.session.phaseBuild.ranges)'),ranges);
  await a.run('STUDIO.publish()');assert.equal(a.run('A.tab'),'analysis');assert.equal(a.run('WF.session.analysisVersions.length'),1);
  a.run("show('dist')");await a.click('Voeg toe aan report');const frozen=a.run('JSON.stringify(WF.session.reportItems[0])');
  a.run("show('report')");a.fill('[aria-label="Toelichting 1"]','Snelheid verder onderzoeken');a.fill('[aria-label="Reporttitel"]','Debrief race 1');assert.equal(a.$('.studio-report h1').textContent,'Debrief race 1');
  a.run("show('cal')");a.fill('#draft-bspK','1.04');await a.click('Voorstel toepassen');assert.equal(a.run('STUDIO.current()'),false);
  assert.equal(a.run('JSON.stringify(WF.session.reportItems[0].blocks)'),JSON.stringify(JSON.parse(frozen).blocks));
  await a.run('STUDIO.publish()');assert.equal(a.run('WF.session.analysisVersions.length'),2);
  a.run("show('report')");await a.click('Vernieuwen met huidige sessieversie');assert.equal(a.run('WF.session.reportItems[0].version'),2);assert.equal(a.run('WF.session.reportItems[0].note'),'Snelheid verder onderzoeken');assert.equal(a.run('WF.session.reportItems[0].history.length'),1);
  await a.run('WF.persist()');const b=await app(a.indexedDB);try{assert.equal(b.run('WF.session.analysisVersions.length'),2);assert.equal(b.run('WF.session.reportItems[0].version'),2);assert.equal(b.run('STUDIO.current()'),true);}finally{b.close();}
  a.run("show('events')");await a.click('+ Event');a.fill('#event-kind','MiscEvent');a.fill('#event-note','Nieuwe notitie');await a.click('Event toevoegen');await a.run('STUDIO.publish()');assert.equal(a.run('A.tab'),'analysis');a.run("show('events')");await a.click('+ Event');a.fill('#event-kind','MotorStart');await a.click('Event toevoegen');await assert.rejects(a.run('STUDIO.publish()'),/Maak de fases opnieuw/);
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
 }finally{a.close();}
});
test('pair windows use circular angles and explicit calibration exclusions',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');
  a.run(`STUDIO.generate({...SL.phaseDefaults(A.cfg),sdBsp:10,sdTwa:180,sdTws:20,sdHdg:180});
    window.validPair=A.D.mans.map(m=>SL.defaultPair(A.D,m)).find(p=>SL.inspectPair(A.D,p,WF.session.phaseBuild.rules).valid);`);
  assert.ok(a.w.validPair,a.run("JSON.stringify(A.D.mans.slice(0,5).map(m=>SL.inspectPair(A.D,SL.defaultPair(A.D,m),WF.session.phaseBuild.rules).errors))"));a.run('validPair.approved=true;WF.session.manoeuvrePairs[validPair.key]=validPair');assert.equal(a.run('SL.approvedPairs(A.D,WF.session).length'),1);
  a.run("WF.session.reviews.veto={kind:'interval',...validPair.before,calibration:false}");assert.equal(a.run('SL.approvedPairs(A.D,WF.session).length'),0);
  a.run("delete WF.session.reviews.veto;window.old=validPair.before.end;validPair.before.end=validPair.anchor");assert.equal(a.run('SL.inspectPair(A.D,validPair,WF.session.phaseBuild.rules).valid'),false);
  a.run("validPair.before.end=old;const i=Math.round((validPair.before.start-A.raw.t0)/1000);A.D.ch.HDG.fill(359,i,i+25);A.D.ch.HDG.fill(1,i+25,i+50)");assert.ok(a.run('SL.windowPhase(A.D,validPair.before).spread.HDG')<2);
 }finally{a.close();}
});
test('pending calibration cannot be silently published and a failed save does not add versions',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');a.run("show('cal')");a.fill('#draft-awaOff','1.5');
  await assert.rejects(a.run('STUDIO.publish()'),/niet-toegepast/);assert.equal(a.run('WF.session.analysisVersions.length'),0);
  a.run("show('cal')");await a.click('Actieve kalibratie overnemen');assert.equal(a.run('WF.session.draft.awaOff'),0);
  a.run("window.persistOriginal=WF.persist;WF.persist=async()=>{throw new Error('disk unavailable')}");await assert.rejects(a.run('STUDIO.publish()'),/disk unavailable/);assert.equal(a.run('WF.session.analysisVersions.length'),0);assert.equal(a.run('WF.session.stage'),'prepare');
  a.run('WF.persist=persistOriginal');await a.run('STUDIO.publish()');assert.equal(a.run('WF.session.analysisVersions.length'),1);
  a.run("show('cal');WF.persist=async()=>{throw new Error('disk unavailable')}");await assert.rejects(a.run('STUDIO.publish()'),/disk unavailable/);assert.equal(a.run('WF.session.analysisVersions.length'),1);a.run('WF.persist=persistOriginal');
 }finally{a.close();}
});
test('report refresh restores analysis context, handles legacy settings and supports undo',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');await a.run('STUDIO.publish()');a.run("show('dist')");await a.click('Voeg toe aan report');
  a.run("window.item=WF.session.reportItems[0];delete item.settings.view;delete item.settings.cur;WF.session.analysisFilter={race:'2'};WF.session.slowThreshold=90;WF.session.distVariable='TWA';window.oldBlocks=JSON.stringify(item.blocks);STUDIO.refreshReport(item)");
  assert.equal(a.run('WF.session.analysisFilter.race'),'2');assert.equal(a.run('WF.session.distVariable'),'TWA');assert.equal(a.run('WF.session.slowThreshold'),90);assert.ok(a.run('A.view.z')>0);assert.ok(Number.isFinite(a.run('A.cur')));
  assert.equal(a.run('item.history.length'),1);await a.click('Vorige reportversie herstellen');assert.equal(a.run('JSON.stringify(item.blocks)'),a.run('oldBlocks'));assert.equal(a.run('item.history.length'),0);
  a.run("item.title='No longer present'");assert.throws(()=>a.run('STUDIO.refreshReport(item)'),/veranderd/);assert.equal(a.run('A.tab'),'report');assert.equal(a.run('WF.session.analysisFilter.race'),'2');
  a.run("window.backup=SL.encodeProject({app:'SailLens',type:'project',version:1,boats:WF.library.boats,sessions:[WF.snapshot()]})");assert.equal(a.run('SL.decodeProject(backup).sessions[0].analysisVersions.length'),1);
  a.w.projectFile={name:'saved.json',text:async()=>a.run('backup')};await a.run('WF.importFiles([projectFile])');await a.run('WF.open(WF.library.sessions.at(-1).id)');assert.equal(a.run('STUDIO.current()'),true);
  assert.throws(()=>a.run("const bad=WF.snapshot();bad.reportItems={};SL.decodeProject(SL.encodeProject({app:'SailLens',type:'project',version:1,boats:WF.library.boats,sessions:[bad]}))"),/reportItems/);
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
 }finally{a.close();}
});
test('race-day tools keep held-out samples independent and reopen a frozen version separately',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');
  a.run("window.p=A.D.mans.map(m=>RaceTools.suggest(A.D,m,WF.session)).find(p=>p.suggested);WF.session.manoeuvrePairs[p.key]=Object.assign(p,{approved:true,validation:true});");
  assert.ok(a.run('SL.approvedPairs(A.D,WF.session).length'));assert.equal(a.run('SL.calibrationReferences(A.D,WF.session).pairs.length'),0);
  a.run("show('cal')");await a.click('Toets voorstel op aparte manoeuvres');assert.match(a.$('#t-cal').textContent,/Controlepaar/);
  await a.run('STUDIO.publish()');const id=a.run('WF.session.id');
  a.run("show('report')");await a.run('WF.openVersion(1)');assert.notEqual(a.run('WF.session.id'),id);assert.equal(a.run('A.tab'),'analysis');assert.equal(a.run('STUDIO.current()'),true);
  a.run("show('events');A.cur=100");await a.click('Tack toevoegen');assert.ok(a.run('A.D.mans.some(m=>m.manual&&m.i===100)'));await a.click('Laatste draaipuntwijziging herstellen');assert.equal(a.run('A.D.mans.some(m=>m.manual&&m.i===100)'),false);
  assert.equal(a.errors.length,0,a.errors.map(e=>e.message).join('\n'));
 }finally{a.close();}
});
test('native strip and prestart geometry retain fractional time and respect pin ends',async()=>{
 const a=await app();try{
  assert.equal(a.run("SL.parseLog('Time,BSP\\n2026-01-01T00:00:00.040Z,6\\n2026-01-01T00:00:00.080Z,7',{start:0,end:Infinity,channel:'BSP'}).map(x=>x[0]%1000).join(',')"),'40,80');
  assert.ok(a.run("RaceTools.geometry([0,0,0,.01],-.001,.005,0,10).eta")>20);
  assert.ok(Number.isNaN(a.run("RaceTools.geometry([0,0,0,.01],-.001,.02,0,10).eta")));
 }finally{a.close();}
});
test('investigating a slow interval finds a faster comparable phase and opens its track',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run('STUDIO.generate(SL.phaseDefaults(A.cfg))');await a.run('STUDIO.publish()');
  a.run("window.candidate=A.D.phases.find(p=>p.sails!=='-');window.src={start:candidate.t,end:A.raw.t0+candidate.i1*1000};A.D.ch.BSP.fill(2,candidate.i,candidate.i1);A.D.ch['BSPpol%'].fill(50,candidate.i,candidate.i1);RaceTools.compareSlow(src)");
  assert.equal(a.run('WF.session.selections.A.start'),a.run('src.start'));assert.ok(a.run('WF.session.selections.B'));await a.click('Bekijk B');assert.equal(a.run('A.raw.t0+A.cur*1000'),a.run('WF.session.selections.B.start'));assert.equal(a.errors.length,0);
 }finally{a.close();}
});

test('late RaceLogger import maps clock, full sail state and race boundaries to the log',async()=>{
 const a=await app();try{
  a.fill('#new-boat-name','Testboot');await a.click('Boot toevoegen');
  const base=Date.UTC(2026,7,3,12),rows=['Time,BSP,TWA,TWS,HDG'];
  for(let i=0;i<360;i++)rows.push(new Date(base+i*1000).toISOString()+',7,44,12,50');
  const tag=(time,type,attribute)=>'<event date="2026-08-03" time="'+time+'" type="'+type+'" attribute="'+attribute+'" comments="" labelalign="Top" />';
  const xml='<daysail><utc_offset><event_file hours="2"/><log_file hours="0"/></utc_offset><saillist><item name="J&amp;2" sailtype="Jib" sailgroup="H" weight="12" /></saillist><events utc_offset_hours="2">'+[
    tag('13:59:55','RaceStartGun','4'),tag('13:59:56','SailsUp','M1;J&amp;2;;'),tag('14:02:00','RaceMark','1'),tag('14:03:00','SailsUp','M1(1);;SS;A2'),tag('14:05:00','RaceFinish','4')
  ].join('')+'</events><annotations><item custom="keep" /></annotations></daysail>';
  a.w.logFile={name:'training.csv',text:async()=>rows.join('\n')};a.w.evFile={name:'training.ev.xml',text:async()=>xml};
  await a.run('WF.importFiles([logFile])');await a.click('+ Event');a.fill('#event-note','Before import');await a.click('Event toevoegen');
  await a.run('WF.importFiles([evFile])');
  assert.equal(a.run("A.D.L.list.find(e=>e.comments==='Before import').i"),0);
  assert.equal(a.run('A.D.L.race[0]'),4);assert.equal(a.run('A.D.L.leg[119]'),1);assert.equal(a.run('A.D.L.leg[120]'),2);
  assert.equal(a.run('A.D.L.race[299]'),4);assert.equal(a.run('A.D.L.race[300]'),0);
  a.run('A.cur=190');await a.click('Zeilwissel');
  assert.deepEqual([0,1,2,3].map(i=>a.$('#event-slot-'+i).value),['M1','','SS','A2']);assert.equal(a.$('#event-reef').value,'1');
  a.fill('#event-slot-3','A4');await a.click('Event toevoegen');const saved=a.run('SL.eventsXml(A.events)');
  assert.match(saved,/M1\(1\);;SS;A4/);assert.match(saved,/weight="12"/);assert.match(saved,/custom="keep"/);
  await a.click('Ongedaan maken');assert.equal(a.run('A.events.events.length'),6);
  a.run('A.cur=30');await a.click('Boeironding');await a.click('Event toevoegen');
  assert.equal(a.run("A.events.events.filter(e=>e.type==='RaceMark').map(e=>e.attr).join(',')"),'1,2');
  await a.click('Ongedaan maken');a.run('A.cur=325');await a.click('Finish');await a.click('Event toevoegen');
  assert.ok(a.$('.event-error').textContent);assert.equal(a.run('A.events.events.length'),6);
  assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});

test('race-only manoeuvre queue rejects in one click, restores decision, and handles an empty selection',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');a.run("show('pairreview')");a.$('#pair-racing').click();
  const keys=a.run("A.D.mans.filter(m=>A.D.L.race[m.i]>0).map(m=>SL.pairKey(A.D,m))");
  const first=a.run('WF.session.activePairKey'),position=keys.indexOf(first);assert.ok(position>=0);
  await a.click('Afwijzen & volgende');
  assert.equal(a.run('WF.session.activePairKey'),keys[position+1]);a.w.firstKey=first;
  assert.ok(a.run('WF.session.manoeuvrePairs[firstKey].rejected'));assert.equal(a.run('WF.session.manoeuvrePairs[firstKey].approved'),false);
  await a.click('Besluit herstellen');assert.equal(a.run('WF.session.activePairKey'),first);
  assert.equal(a.run('!!WF.session.manoeuvrePairs[firstKey].rejected'),false);
  a.fill('#pair-type','Gybe');assert.ok(a.run("A.D.mans.filter(m=>m.type==='Gybe'&&A.D.L.race[m.i]>0).some(m=>SL.pairKey(A.D,m)===WF.session.activePairKey)"));
  a.run("A.D.L.race.fill(0);show('pairreview')");assert.match(a.$('#t-pairreview').textContent,/Geen manoeuvres in deze selectie/);a.$('#pair-racing').click();assert.ok(a.$('#pair-reason'));
  assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
test('strip retains fractional timestamps, original peaks and channel mapping across viewport changes',async()=>{
 const a=await app();try{
  const traces=a.run(`(()=>{
    const t=Date.UTC(2026,10,19,12);
    const csv='Time,Sensor,AWA\\n2026-11-19T12:00:00.040Z,2,-25\\n2026-11-19T12:00:00.080Z,18,-31\\n2026-11-19T12:00:03.100Z,4,28';
    const session={profile:{channels:[{source:'Sensor',target:'BSP',factor:.5,offset:1}]},sources:[{kind:'log',text:csv,channels:['Sensor','AWA']}]};
    const read=(a,b)=>Object.fromEntries(PrepDesk.loggedTraces(session,['BSP','AWA','TWD'],t,a,b));
    return JSON.stringify([read(0,1),read(1,4),SL.parseLog(csv).ch.Sensor[0]]);
  })()`);
  const [first,last,mean]=JSON.parse(traces);
  assert.deepEqual(first.BSP,[[.04,2],[.08,10]]);assert.deepEqual(first.AWA,[[.04,-25],[.08,-31]]);assert.equal(first.TWD,undefined);
  assert.deepEqual(last.BSP,[[3.1,3]]);assert.equal(mean,10);
 }finally{a.close();}
});
test('wind pair corrections keep the same sign in either direction, cross north and separate gybes and validation',async()=>{
 const a=await app();try{
  const result=a.run(`(()=>{
    const window=(tack,awa,twa,twd,tws)=>({tack,v:{AWA:awa,TWA:twa,TWD:twd,TWS:tws},coverage:{AWA:1,TWD:1,TWS:1}});
    const p=window('Port',-27,-44,2,12),s=window('Stbd',33,48,358,13);
    const g=window('Port',-134,-150,352,12),h=window('Stbd',140,150,358,13);
    const pair=(type,before,after,validation=false)=>({pair:{type,validation},before,after});
    const missing={...p,coverage:{AWA:0,TWD:0,TWS:1}};
    return JSON.stringify([SL.windPairEvidence([pair('Tack',p,s),pair('Tack',s,p),pair('Gybe',h,g),pair('Tack',p,s,true),pair('Tack',missing,s)]),
      SL.addTableResidual([{tws:8,up:1,dn:2},{tws:12,up:3,dn:6}],10,'up',1.5)]);
  })()`);
  const [calc,rows]=JSON.parse(result);
  assert.deepEqual(calc.alignment,[-3,-3]);assert.deepEqual(calc.bands.find(b=>b.mode==='up').errors,[4,4]);assert.deepEqual(calc.bands.find(b=>b.mode==='dn').errors,[-6]);
  assert.deepEqual(rows[1],{tws:10,up:3.5,dn:4});
 }finally{a.close();}
});
test('paired MHU action recomputes the draft on fixed windows and leaves active calibration alone',async()=>{
 const a=await app();try{
  await a.click('Bekijk voorbeeld');
  a.run(`A.raw.ch.AWA=Float64Array.from(A.raw.ch.AWA,v=>v+3);WF.recompute();
    for(const m of A.D.mans.filter(m=>m.type==='Tack')){
      const pair=RaceTools.suggest(A.D,m,WF.session);
      if(!pair.suggested)continue;
      WF.session.manoeuvrePairs[pair.key]={...pair,approved:true};
      if(Object.keys(WF.session.manoeuvrePairs).length===5)break;
    }
    show('cal');`);
  const eligible=a.run('SL.windPairEvidence(SL.calibrationReferences(A.D,WF.session).pairs).alignment');
  assert.ok(eligible.length>=3);
  const expected=Math.round(a.run('SL.median(SL.windPairEvidence(SL.calibrationReferences(A.D,WF.session).pairs).alignment)')*10)/10;
  await a.click('MHU-restfout naar voorstel');assert.equal(a.run('WF.session.draft.awaOff'),expected);assert.equal(a.run('A.calib.awaOff'),0);
  assert.match(a.$('#t-cal').textContent,/Meetwaarden per goedgekeurd paar/);
  await a.click('Voorstel vergelijken');assert.ok(a.$('#t-cal').textContent.includes('Gelogd · actief · voorstel'));
  assert.deepEqual(a.errors,[]);
 }finally{a.close();}
});
