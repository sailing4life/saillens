const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const name of ['core','core2','calibrationcurrent']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'), context);
}
const SL = vm.runInContext('SL',context);
const start = Date.UTC(2026,10,8,10);
const data = {cfg:{magVar:2},raw:{ch:{}}};
const compare = (n,expected) => assert.ok(Math.abs(n-expected)<1e-8, n+' vs '+expected);
const phase = (overrides={}) => ({t:start,i:0,i1:20,tack:'Port',v:{
  SOG:Math.hypot(1,6), COG:Math.atan2(1,6)*SL.R2D, HDG:359, BSP:5.75, Heel:-14,...overrides
}});

test('subtracting eastward current recovers speed and course through the water across north',()=>{
  const p=phase(),manual={mode:'manual',set:90,drift:1};
  const [speed]=SL.calibrationResiduals(data,[p],null,'speed',manual).rows;
  compare(speed.raw,p.v.SOG-5.75);compare(speed.corrected,.25);
  const [heading]=SL.calibrationResiduals(data,[p],null,'heading',manual).rows;
  compare(heading.raw,1-p.v.COG);compare(heading.corrected,1);
  assert.equal(heading.heading,1);assert.equal(heading.heel,-14);assert.equal(heading.source,'manual');
  assert.equal(heading.i1,20);assert.equal(heading.bsp,5.75);
});

test('unconfirmed magnetic reference is presented as logged, zero current does not require COG for speed',()=>{
  const p=phase({SOG:6,COG:0}),D={cfg:{magVar:null},logMagVar:8,magVar:0,raw:{ch:{}}};
  const heading=SL.calibrationResiduals(D,[p],null,'heading',{mode:'manual',set:null,drift:0});
  compare(heading.rows[0].raw,-1);assert.match(heading.reference,/noordreferentie van het log/);
  const speed=SL.calibrationResiduals(D,[phase({SOG:6,COG:NaN})],null,'speed',{mode:'manual',set:null,drift:0});
  compare(speed.rows[0].corrected,.25);
});

test('missing, invalid and weak inputs never produce spurious direction corrections',()=>{
  const p=phase({SOG:2,COG:0});
  const run=(p,drift,set)=>SL.calibrationResiduals(data,[p],null,'heading',{mode:'manual',drift,set});
  assert.ok(Number.isNaN(run(p,2,0).rows[0].corrected)); // no motion through water
  assert.equal(run(phase({SOG:.05,COG:90}),1,90).rows.length,0);
  assert.equal(run(phase({HDG:NaN}),1,90).rows.length,0);
  const invalid=run(p,-1,90);
  assert.ok(Number.isNaN(invalid.rows[0].corrected));assert.match(invalid.issue,/stroomrichting/);
});

test('local estimate matches exact contributing ranges on a fresh draft without extrapolating',()=>{
  const phases=[],windows=[{east:1,north:.25},{east:-.75,north:.5}];
  for(let w=0;w<2;w++){
    for(let j=0;j<8;j++){
      const i=w*900+j*100,hdg=j%2?45:315,bsp=5+.1*j;
      const e=bsp*Math.sin(hdg*SL.D2R)+windows[w].east,n=bsp*Math.cos(hdg*SL.D2R)+windows[w].north;
      phases.push({t:start+i*1000,i,i1:i+30,tack:j%2?'Port':'Stbd',v:{HDG:hdg,BSP:bsp,SOG:Math.hypot(e,n),COG:SL.w360(Math.atan2(e,n)*SL.R2D)}});
    }
  }
  const D={cfg:{magVar:0},magVar:0,raw:{ch:{}}},fit=SL.calBsp(D,phases);
  assert.equal(fit.nWin,2);
  const reviewed=structuredClone(phases);
  reviewed[0].v.BSP+=.25;
  reviewed.push({...reviewed[0],i1:reviewed[0].i1+1});
  reviewed.push({...reviewed[0],t:start+1800000,i:1800,i1:1830});
  const {rows}=SL.calibrationResiduals(D,reviewed,fit,'speed',{mode:'model'});
  const fitted=rows.filter(r=>r.source==='model');
  assert.equal(fitted.length,16);compare(fitted[0].corrected,-.25);
  for (const r of fitted.slice(1)) compare(r.corrected,0);
  assert.equal(rows.filter(r=>Number.isNaN(r.corrected)).length,2);
});

test('logged flow averages paired measured components at north and honours gaps and exclusions',()=>{
  const Set=Array.from({length:20},(_,i)=>i%2?45:315),Drift=Array(20).fill(Math.SQRT2);
  const D={cfg:{maxHold:1,magVar:0},raw:{ch:{Set,Drift},age:{Set:new Uint8Array(20)}},invalid:new Uint8Array(20)};
  const p=phase({COG:0,SOG:6,BSP:4.5});
  D.ch={COG:Set.map(a=>SL.w360(Math.atan2(a===45?1:-1,6)*SL.R2D)), SOG:Array(20).fill(Math.hypot(1,6)), BSP:Array(20).fill(4.5)};
  function run(){return SL.calibrationResiduals(D,[p],null,'speed',{mode:'logged'});}
  compare(run().rows[0].corrected,.5);
  compare(run().rows[0].currentDrift,1);compare(SL.w180(run().rows[0].currentSet),0);
  D.invalid[0]=1;D.raw.age.Set[1]=2;
  assert.ok(Number.isNaN(run().rows[0].corrected));assert.match(run().issue,/Set\/Drift/);
  D.raw.ch={Cur_E:Array(20).fill(0),Cur_N:Array(20).fill(1),PredSet:Set,PredDrift:Drift};
  assert.ok(Number.isNaN(run().rows[0].corrected));
});

test('individual phase averages cannot hide disjoint instrument coverage',()=>{
  const p=phase(),ch=Object.fromEntries(Object.entries(p.v).map(([k,v])=>[k,Array(20).fill(v)]));
  // Each individual channel still has 95% coverage.
  ch.COG[0]=NaN;ch.BSP[1]=NaN;
  const D={cfg:{magVar:0},ch,raw:{ch:{}}};
  const speed=SL.calibrationResiduals(D,[p],null,'speed',{mode:'manual',set:90,drift:1});
  assert.ok(Number.isFinite(speed.rows[0].raw));assert.ok(Number.isNaN(speed.rows[0].corrected));
  ch.HDG[2]=NaN;
  assert.equal(SL.calibrationResiduals(D,[p],null,'heading',{mode:'manual',set:90,drift:1}).rows.length,0);
});
