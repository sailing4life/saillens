const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({});
for (const s of ['core','core2','core3','workspace','sessionflow','calibrationpreview']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+s+'.js'),'utf8'),ctx);
const SL=vm.runInContext('SL',ctx);
function log(loggedBsp=true,loggedWind=true){
  const n=180, t0=Date.UTC(2026,10,8,9), seq=fn=>Float64Array.from({length:n},(_,i)=>fn(i));
  const ch={HDG:seq(i=>i<60?350:70),Heel:seq(i=>i<60?-15:12),SOG:seq(()=>7.1),COG:seq(i=>i<60?355:75),
    AWA:seq(i=>i<60?-29:28),AWS:seq(()=>13),MWA:seq(i=>i<60?-30:31),
    sensorBB:seq(i=>5+i/70),sensorSB:seq(i=>6+.01*i),active:seq(i=>i<25?0:i<70?1:2)};
  if(loggedBsp)ch.BSP=seq(()=>6.5);
  if(loggedWind)Object.assign(ch,{TWA:seq(i=>i<60?-41:42),TWS:seq(()=>10),TWD:seq(i=>i<60?359:1)});
  const raw={n,t0,ch,age:{sensorBB:new Uint8Array(n),AWA:new Uint8Array(n)}};
  raw.age.sensorBB[30]=4;raw.age.AWA[36]=4;
  const settings={cfg:{tStart:t0+10e3,tEnd:t0+170e3,maxHold:2},skipPhases:true,
    events:loggedBsp?{events:[{tl:t0+26e3,type:'ManualEntry',attr:'sensorBB=6.4'}]}:null,
    invalidRanges:[{start:t0+31e3,end:t0+32e3}]};
  const c={...SL.CAL0,heelOff:2.2,hdgOff:-1.2,bspK:1.04,awaOff:.8,twsDnPct:1,awsK:.98,twa:[{tws:10,up:-.7,dn:.2}],
    speedos:{enabled:true,port:'sensorBB',starboard:'sensorSB',selector:'active',portCode:1,starboardCode:2,portK:1.03,starboardK:.95}};
  const active=SL.analyse(raw,{...settings,calib:{...c,bspK:1.01,awaOff:-1}});
  const proposed=SL.analyse(raw,{...settings,calib:c});
  const phases=[[20,40],[24,36],[85,99]].map(([i,i1])=>SL.windowPhase(active,{start:t0+i*1000,end:t0+i1*1000}));
  return {active,proposed,phases,c};
}
for(const [loggedBsp,loggedWind] of [[true,true],[false,false]])test('reference previews match full pipeline, logged BSP/wind='+loggedBsp,()=>{
 const {active,proposed,phases,c}=log(loggedBsp,loggedWind);
 const speed=SL.speedPlotPreview(active,phases,c),wind=SL.windPlotPreview(active,phases,c);
 for(const p of phases){
   for(const [dataset,keys] of [[speed.data,['BSP','HDG','Heel','SOG','COG']],[wind,['AWA','TWA','TWS','TWD','MWA']]])
     for(const k of keys)
       assert.deepEqual(Array.from(dataset.ch[k].subarray(p.i,p.i1)),Array.from(proposed.ch[k].subarray(p.i,p.i1)),k);
   const expected=SL.windowPhase(proposed,{start:p.t,end:proposed.raw.t0+1000*p.i1}), w=speed.windows.find(w=>w.i===p.i);
   for(const k of ['BSP','Heel','HDG'])assert.equal(w.v[k],expected.v[k],k);
 }
 assert.equal(speed.data.raw,active.raw);
 assert.equal(wind.L,active.L);
});
test('preview falls back when a plotted value depends on boat formulas',()=>{
 const {active,phases,c}=log();
 active.formulaDiagnostics=[{name:'SOG'}];assert.equal(SL.speedPlotPreview(active,phases,c),null);
 active.formulaDiagnostics=[{name:'MWA'}];assert.equal(SL.windPlotPreview(active,phases,c),null);
});
