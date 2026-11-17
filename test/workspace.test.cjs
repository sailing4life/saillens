const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({console, structuredClone, crypto, Float64Array, Uint8Array, Uint32Array, Int8Array, Int16Array, Int32Array});
for (const name of ['core.js','core2.js','core3.js','formulas.js','workspace.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),ctx);
const SL = vm.runInContext('SL',ctx), plain = x => JSON.parse(JSON.stringify(x));
const base = Date.UTC(2026,10,17,10);
const csv = (start=0,n=120,bsp=7) => ['Time,BSP,TWA,TWS,HDG',...Array.from({length:n},(_,i)=>[new Date(base+(start+i)*1000).toISOString(),bsp,45,12,270].join(','))].join('\n');
const formula = (name,expression,unit='kn',type='number') => ({name,expression,unit,type,version:1});

test('calculated variables use calibrated channels and explicit original values without mutation',()=>{
 const raw=SL.parseLog(csv()),defs=[formula('SpeedDelta','BSP - raw.BSP'),formula('VMGSigned','BSP * cosD(TWA)'),formula('DeltaPct','100 * SpeedDelta / raw.BSP','%')];
 const d=SL.analyse(raw,{cfg:{},calib:{bspK:1.1},formulas:defs});
 assert.ok(Math.abs(d.ch.SpeedDelta[0]-.7)<1e-10); assert.ok(Math.abs(d.ch.DeltaPct[0]-10)<1e-10);
 assert.equal(raw.ch.BSP[0],7);assert.equal(raw.ch.SpeedDelta,undefined);assert.ok(d.phases[0].v.VMGSigned>0);
});
test('formula dependencies are ordered, missing values never become false zeros',()=>{
 const ch={BSP:new Float64Array([7,NaN,0])};
 const ds=SL.evaluateFormulas(ch,ch,[formula('Double','Base * 2'),formula('Base','BSP / 2'),formula('Ratio','1 / BSP'),formula('Missing','Unknown + 1')],3);
 assert.equal(ch.Double[0],7);assert.ok(Number.isNaN(ch.Double[1]));assert.ok(Number.isNaN(ch.Ratio[2]));assert.ok(Number.isNaN(ch.Missing[0]));assert.deepEqual(plain(ds.find(d=>d.name==='Missing').missing),['Unknown']);
});
test('formula language rejects cycles, collisions, arbitrary code and excessive complexity',()=>{
 assert.throws(()=>SL.compileFormulas([formula('A','B+1'),formula('B','A+1')]),/Circular/);
 assert.throws(()=>SL.compileFormulas([formula('BSP','1')],['BSP']),/already exists/);
 for(const exp of ['window.alert(1)','raw.constructor','this','BSP; alert(1)','new Function(1)','BSP[0]','sinD(1,2)']){
  if(exp==='this') continue; // An unknown channel is allowed, and is diagnosed as missing.
  assert.throws(()=>SL.expression(exp), exp);
 }
 assert.throws(()=>SL.expression('('.repeat(80)+'1'+')'.repeat(80)),/nested/);
 assert.throws(()=>SL.compileFormulas([formula('Angle','1','kn','angle')]),/deg/);
});
test('angles and special channel names have explicit safe syntax',()=>{
 const ch={'VMG%':new Float64Array([95]),A:new Float64Array([359]),B:new Float64Array([1])};
 SL.evaluateFormulas(ch,ch,[formula('Diff','angleDiff(A,B)','deg','angle'),formula('Rel','[VMG%] / 100','1')],1);
 assert.equal(ch.Diff[0],-2);assert.equal(ch.Rel[0],.95);
});
test('boats and sessions have stable independent identity and frozen formula versions',()=>{
 const boat=SL.newBoat('Cape 31');boat.formulas=[formula('Gain','BSP-6')];
 const a=SL.newSession(boat),b=SL.newSession(boat);assert.notEqual(a.id,b.id);
 boat.formulas[0].expression='BSP-7';boat.revision++;
 assert.equal(a.profile.formulas[0].expression,'BSP-6');assert.equal(a.profile.revision,1);
 a.profile.formulas[0].expression='BSP-8';assert.equal(b.profile.formulas[0].expression,'BSP-6');
 const other=SL.newSession(SL.newBoat('J/109'));assert.equal(other.profile.formulas.length,0);assert.equal(other.calib.bspK,1);
});
test('multiple logs preserve gaps, reject conflicts and do not duplicate overlapping seconds',()=>{
 const a=SL.parseLog(csv(0,20)),b=SL.parseLog(csv(40,20));const merged=SL.mergeLogs([a,b]);
 assert.equal(merged.n,60);assert.ok(Number.isNaN(merged.ch.BSP[30]));
 assert.equal(SL.mergeLogs([a,a]).n,20);assert.equal(SL.mergeLogs([a,a]).counts.BSP[0],1);
 assert.throws(()=>SL.mergeLogs([a,SL.parseLog(csv(5,20,8))]),/overlappende/);assert.equal(a.ch.BSP[5],7);
});
test('calibration eligibility is separate from poor performance; invalid data is reversible',()=>{
 const raw=SL.parseLog(csv()),D=SL.analyse(raw,{cfg:{}}),p=D.phases[0],r=SL.objectRange(D,p,'phase'),key=SL.reviewKey(r);
 const reviews={[key]:{...r,calibration:false,performance:true,reason:'Poor trim'}};
 assert.equal(SL.calibrationPhases(D,reviews).length,0);assert.equal(SL.performanceAllowed(r,reviews),true);
 reviews[key].calibration=true;assert.equal(SL.calibrationPhases(D,reviews).length,1);
 reviews[key].invalid=true;const masked=SL.analyse(raw,{cfg:{},invalidRanges:[r]});
 assert.ok(Number.isNaN(masked.ch.BSP[p.i]));assert.equal(raw.ch.BSP[p.i],7);assert.equal(SL.performanceAllowed(r,reviews),false);
 assert.equal(SL.analyse(raw,{cfg:{}}).ch.BSP[p.i],7);
 const changed=SL.analyse(raw,{cfg:{phaseLen:35}});assert.equal(SL.calibrationPhases(changed,reviews).length,0);
});
test('interval exclusions take precedence over positive calibration references',()=>{
 const D=SL.analyse(SL.parseLog(csv()),{cfg:{}}),p=D.phases[0],r=SL.objectRange(D,p,'phase');
 const reviews={all:{kind:'interval',start:base,end:base+120000,calibration:true},no:{kind:'interval',start:base,end:r.end,calibration:false}};
 assert.ok(!SL.calibrationPhases(D,reviews).some(x=>x.i===p.i));
 reviews.no.performance=false;assert.equal(SL.performanceAllowed(r,reviews),false);
});
test('slow sailing denominator includes low speed and rejected calibration phases',()=>{
 const raw=SL.parseLog(csv()),polar=SL.makePolar([{tws:12,pts:[[0,0],[45,7],[90,8],[150,8],[180,5]]}],'file');
 raw.ch.BSP.fill(3,0,60);const D=SL.analyse(raw,{cfg:{minBsp:5,polMin:80},polar});
 const stats=SL.slowStats(D,{});assert.equal(stats.valid,120);assert.equal(stats.slow,60);assert.equal(stats.percent,50);
 const noPolar=SL.analyse(raw,{cfg:{}}),missing=SL.slowStats(noPolar,{});assert.equal(missing.unknown,120);assert.ok(Number.isNaN(missing.percent));
});
test('backup round trip retains missing samples, source text, reviews, formulas and versions',()=>{
 const b=SL.newBoat('Boat'),s=SL.newSession(b);s.raw=SL.parseLog(csv());s.raw.ch.BSP[3]=NaN;s.sources=[{name:'source.csv',text:csv()}];
 const decoded=SL.decodeProject(SL.encodeProject({app:'SailLens',type:'project',version:1,boats:[b],sessions:[s]}));
 assert.ok(decoded.sessions[0].raw.ch.BSP instanceof Float64Array);assert.ok(Number.isNaN(decoded.sessions[0].raw.ch.BSP[3]));assert.equal(decoded.sessions[0].sources[0].text,csv());
 assert.throws(()=>SL.decodeProject('{"app":"SailLens","type":"project","version":99}'),/ondersteund/);
 assert.throws(()=>SL.decodeProject('{"__proto__":{"polluted":true}}'),/Reserved/);
});
test('mapping converts units without modifying original samples and missing wind permits partial analysis',()=>{
 const raw=SL.parseLog(csv());raw.ch.SpeedMS=new Float64Array(raw.n).fill(3);
 const mapped=SL.mappedRaw(raw,[{source:'SpeedMS',target:'BSP',factor:1.943844,offset:0}]);assert.ok(Math.abs(mapped.ch.BSP[0]-5.831532)<1e-8);assert.equal(raw.ch.BSP[0],7);
 delete raw.ch.TWS;delete raw.ch.TWA;const D=SL.analyse(raw,{cfg:{}});assert.equal(D.phases.length,0);assert.ok(D.warn.some(s=>s.includes('ontbreekt')));assert.equal(D.ch.BSP[0],7);
});
test('event fine adjustment is in seconds and independent of display timezone',()=>{
 const raw=SL.parseLog(csv()),events={events:[{tl:base+10000,type:'RaceStartGun',attr:'1'}]};
 const D=SL.analyse(raw,{cfg:{evShiftSec:15,dispOff:4},events});assert.equal(D.L.list[0].i,25);assert.equal(D.L.race[24],0);assert.equal(D.L.race[25],1);
});
test('TWA tables also apply when true wind has to be derived from apparent wind',()=>{
 const raw=SL.parseLog(csv());delete raw.ch.TWA;delete raw.ch.TWS;raw.ch.AWA=new Float64Array(raw.n).fill(30);raw.ch.AWS=new Float64Array(raw.n).fill(15);
 const before=SL.analyse(raw,{cfg:{}}),after=SL.analyse(raw,{cfg:{},calib:{twa:[{tws:10,up:3,dn:3}]}});
 assert.ok(Math.abs(after.ch.TWA[0]-before.ch.TWA[0]-3)<1e-9);assert.ok(Math.abs(SL.w180(after.ch.TWD[0]-before.ch.TWD[0])-3)<1e-9);
});
