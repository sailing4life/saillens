const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({});
for(const name of ['core','windplotdata'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),ctx);
const SL=vm.runInContext('SL',ctx);
const t0=Date.UTC(2026,10,8,8);
function data(){
  const n=160,ch={};
  for(const key of ['TWA','AWA','MWA','TWS','TWD'])ch[key]=new Float64Array(n);
  ch.TWS.fill(12);ch.MWA.fill(NaN);
  return {ch,raw:{t0},i0:0,i1:n,n,invalid:new Uint8Array(n),L:{sailState:new Int16Array(n),sailConfigs:['Main;J1;;','Main;J3;;']}};
}
function window(D,i,angle,direction,mode='Upwind',sail=0){
  D.ch.TWA.fill(angle,i,i+20);D.ch.AWA.fill(angle*.7,i,i+20);D.ch.TWD.fill(direction,i,i+20);D.L.sailState.fill(sail,i,i+20);
  return {i,i1:i+20,t:t0+i*1000,tack:angle<0?'Port':'Stbd',sails:'Jib',mode};
}
function pair(before,after,type='Tack',fields={}){
  const anchor=t0+after.i*1000-5000;
  return {before,after,pair:{approved:true,anchor,key:type+':'+anchor,type,...fields}};
}
const near=(v,w)=>assert.ok(Math.abs(v-w)<1e-6,v+' vs '+w);

test('pair differences always use port minus starboard and TWD wraps at north',()=>{
  for(const reverse of [false,true]){
    const d=data(),p=window(d,reverse?40:0,-49,0),s=window(d,reverse?0:40,43,358);
    // Bearing samples around north must average to north, not south.
    d.ch.TWD.fill(359,p.i,p.i+10);d.ch.TWD.fill(1,p.i+10,p.i1);
    const out=SL.windPlotData(d,{phases:[],pairs:[reverse?pair(s,p):pair(p,s)]});
    assert.equal(out.pairs.length,1);
    const row=out.pairs[0];near(row.active.TWA,6);near(row.active.AWA,4.2);near(row.active.TWD,2);
    assert.ok(Number.isNaN(row.active.MWA));assert.equal(row.sail,'Main / J1');near(row.tws,12);
    assert.equal(out.phases.length,2);assert.ok(out.phases.every(w=>w.source==='pair'));
  }
});
test('fixed phase windows preserve side, wind band and sail when recomputing a proposal',()=>{
  const d=data(),q=data(),p=window(d,0,-145,358,'Downwind'),s=window(d,40,135,3,'Downwind');
  window(q,0,-143,0,'Downwind');window(q,40,137,1,'Downwind');q.ch.TWS.fill(17);
  const out=SL.windPlotData(d,{phases:[p],pairs:[pair(p,s,'Gybe')]},q);
  assert.equal(out.hasProposal,true);const row=out.pairs[0];
  near(row.active.TWA,10);near(row.proposed.TWA,6);near(row.active.TWD,-5);near(row.proposed.TWD,-1);
  near(row.proposed.stbdTWD,1);near(row.proposed.portTWA,143);assert.equal(row.mode,'dn');near(row.tws,12);
  assert.equal(out.phases[0].proposed.TWS,17);assert.equal(out.phases[0].side,'Port');assert.equal(out.phases[0].tws,12);
});
test('held-out windows and overlapping pair fallback windows do not feed phase trends twice',()=>{
  const d=data(),p=window(d,0,-45,359),s=window(d,40,45,1),pv=window(d,80,-47,358),sv=window(d,120,44,2);
  const p0={...p,i:5,i1:15},leak={...p,i:75,i1:85};
  const out=SL.windPlotData(d,{stablePhases:[p0,p0,leak],pairs:[pair(p,s)],validationPairs:[pair(pv,sv,'Tack',{validation:true})]});
  assert.equal(out.pairs.length,2);assert.equal(out.pairs[1].validation,true);
  assert.deepEqual(Array.from(out.phases,w=>w.i),[5,40]);assert.equal(out.phases[1].source,'pair');
});
test('each metric needs concurrent wind speed and angle; TWD and vane validity are independent',()=>{
  const d=data(),p=window(d,0,-45,0),s=window(d,40,43,1);
  d.ch.TWS[0]=NaN;d.ch.TWD[1]=NaN;d.ch.MWA.fill(315,0,20);d.ch.MWA.fill(42,40,60);
  const out=SL.windPlotData(d,{pairs:[pair(p,s)]});
  assert.equal(out.pairs.length,1);near(out.pairs[0].active.TWA,2);near(out.pairs[0].active.MWA,3);
  assert.ok(Number.isNaN(out.pairs[0].active.TWD));
});
test('discard maneuvers with an invalid sample, side transition, midwindow sail change or different sail configurations',()=>{
  const d=data(),p=window(d,0,-49,359),s=window(d,40,43,2);
  const run=()=>SL.windPlotData(d,{pairs:[pair(p,s)]}).pairs.length;
  assert.equal(run(),1);d.invalid[8]=1;assert.equal(run(),0);d.invalid[8]=0;
  d.ch.TWA[40]=-43;assert.equal(run(),0);d.ch.TWA[40]=43;
  d.L.sailState[4]=1;assert.equal(run(),0);d.L.sailState[4]=0;
  d.L.sailState.fill(1,s.i,s.i1);assert.equal(run(),0);
});
test('tactical pair endpoints retain their TWD and are marked outside MHU symmetry',()=>{
  const d=data(),p=window(d,0,-49,359),s=window(d,40,43,2);
  const out=SL.windPlotData(d,{stablePhases:[p],pairs:[pair(p,s,'Tack',{vmgToVmg:false})]});
  assert.equal(out.pairs[0].vmgToVmg,false);near(out.pairs[0].active.TWD,-3);
  assert.ok(out.phases.length===2&&out.phases.every(w=>!w.vmgToVmg));
});

test('MHU residual uses signed upwind AWA and the proposed measurement independently',()=>{
  const d=data(),q=data(),p=window(d,0,-49,359),s=window(d,40,43,2);
  window(q,0,-49,359);window(q,40,43,2);
  d.ch.AWA.fill(330,p.i,p.i1);d.ch.AWA.fill(26,s.i,s.i1);d.ch.TWS.fill(14,p.i,p.i1);
  q.ch.AWA.fill(30,p.i,p.i1);q.ch.AWA.fill(26,s.i,s.i1);
  const run=extra=>SL.windPlotData(d,{pairs:[pair(p,s,'Tack',extra)]},q).pairs[0];
  const row=run({});near(row.active.mhuResidual,2);near(row.active.TWS,2);
  assert.ok(Number.isNaN(row.proposed.mhuResidual));near(row.proposed.AWA,4);
  assert.ok(Number.isNaN(run({validation:true}).active.mhuResidual));
  assert.ok(Number.isNaN(run({vmgToVmg:false}).active.mhuResidual));
});

test('reaching exits remain visible but never suggest a pure wind-angle table correction',()=>{
  const d=data(),p=window(d,0,-147,356,'Downwind'),s=window(d,40,117,0,'BroadReaching');
  const out=SL.windPlotData(d,{pairs:[pair(p,s,'Gybe',{vmgToVmg:false})]});
  assert.equal(out.pairs.length,1);near(out.pairs[0].active.TWD,-4);assert.equal(out.pairs[0].tableEligible,false);
  window(d,40,85,0,'Reaching');
  assert.equal(SL.windPlotData(d,{pairs:[pair(p,s,'Gybe')]}).pairs.length,0);
});

test('subsecond measured wind angles crossing the stern are binned around 180 degrees',()=>{
  const t=new Date(t0),later=new Date(t0+400);
  const raw=SL.parseLog(['time,MWA',t.toISOString()+',179',later.toISOString()+',-179'].join('\n'));
  near(Math.abs(raw.ch.MWA[0]),180);
});
