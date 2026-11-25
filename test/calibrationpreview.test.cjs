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

test('dual BSP gaps use the selected unscaled sensor for the wind baseline, in session and preview',()=>{
  const t0=Date.UTC(2026,10,10), n=8;
  const col=values=>Float64Array.from(values), filled=value=>new Float64Array(n).fill(value);
  const ch={
    BSP:col([5,NaN,99,NaN,NaN,NaN,NaN,0]), port:filled(6), stbd:filled(7),
    index:col([1,1,2,0,2,1,2,0]), HDG:filled(355), AWA:filled(37), AWS:filled(12),
    TWA:col([42,NaN,48,43,NaN,44,45,46]), TWS:col([10,11,NaN,10,NaN,10,10,10]),
    TWD:col([4,7,NaN,9,NaN,9,9,10])
  };
  const raw={n,t0,ch,age:{BSP:col([0,0,6,0,0,0,0,0]),stbd:col([0,0,0,0,6,0,0,0]),index:col([0,0,0,0,0,0,6,0])}};
  const settings={cfg:{maxHold:2},skipPhases:true,invalidRanges:[{start:t0+5000,end:t0+6000}]};
  const calib={...SL.CAL0,bspK:1.05,speedos:{enabled:true,port:'port',starboard:'stbd',selector:'index',
    portCode:1,starboardCode:2,portK:.9,starboardK:1.12}};
  const active=SL.analyse(raw,{...settings,calib:SL.CAL0}), proposed=SL.analyse(raw,{...settings,calib});
  const windows=[{i:0,i1:n}], wind=SL.windPlotPreview(active,windows,calib);
  const speed=SL.speedPlotPreview(active,windows,calib).data;
  const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} vs ${expected}`);
  for (const [i,baseline,scaled] of [[0,5,6*.9*1.05],[1,6,6*.9*1.05],[2,7,7*1.12*1.05],[7,0,0]]) {
    const original=SL.trueWind(37,12,baseline), corrected=SL.trueWind(37,12,scaled);
    const delta=SL.w180(corrected.twa-original.twa);
    const twa=Number.isFinite(ch.TWA[i]) ? SL.w180(ch.TWA[i]+delta) : corrected.twa;
    const tws=Number.isFinite(ch.TWS[i]) ? ch.TWS[i]*corrected.tws/original.tws : corrected.tws;
    const twd=Number.isFinite(ch.TWD[i]) ? SL.w360(ch.TWD[i]+delta) : SL.w360(ch.HDG[i]+twa);
    close(proposed.ch.BSP[i],scaled);close(speed.ch.BSP[i],scaled);
    for (const [key,expected] of [['TWA',twa],['TWS',tws],['TWD',twd]]) {
      close(proposed.ch[key][i],expected);close(wind.ch[key][i],expected);
    }
  }
  for (const i of [3,4,5,6]) {
    assert.ok(Number.isNaN(proposed.ch.BSP[i]));
    assert.ok(Number.isNaN(speed.ch.BSP[i]));
    for (const key of ['TWA','TWS','TWD']) {
      const expected=i===5?NaN:ch[key][i];
      assert.equal(proposed.ch[key][i],expected);assert.equal(wind.ch[key][i],expected);
    }
  }
  assert.deepEqual(Array.from(raw.ch.BSP),[5,NaN,99,NaN,NaN,NaN,NaN,0]);
  assert.ok(Number.isNaN(raw.ch.TWA[1]) && Number.isNaN(raw.ch.TWS[2]) && Number.isNaN(raw.ch.TWD[2]));
});

test('TWD follows the actual TWA table correction at head to wind and dead downwind',()=>{
  const col=values=>Float64Array.from(values);
  const raw={n:4,t0:0,ch:{BSP:col([6,6,6,6]),TWS:col([10,10,10,10]),TWA:col([-2,2,-178,178]),TWD:col([359,1,1,359])}};
  const calib={...SL.CAL0,twa:[{tws:10,up:-10,dn:10}]};
  const D=SL.analyse(raw,{cfg:{},skipPhases:true,calib});
  assert.deepEqual(Array.from(D.ch.TWA,Math.abs),[0,0,180,180]);
  assert.deepEqual(Array.from(D.ch.TWD),[1,359,359,1]);
});

test('a gap in logged TWS can be recomputed even when the original wind speed was zero',()=>{
  const col=values=>Float64Array.from(values);
  const raw={n:2,t0:0,ch:{BSP:col([6,6]),AWA:col([0,0]),AWS:col([6,6]),TWS:col([NaN,1.2])}};
  const D=SL.analyse(raw,{cfg:{},skipPhases:true,calib:{...SL.CAL0,bspK:1.1}});
  assert.ok(Math.abs(D.ch.TWS[0]-.6)<1e-9);
  assert.equal(D.ch.TWS[1],1.2);
});

test('unsigned mapped and saved wind angles keep port and starboard corrections symmetric',()=>{
  const values=Float64Array.from([315,45,315,45,180,-180,360,999,-999]), n=values.length;
  const filled=v=>new Float64Array(n).fill(v);
  const raw={n,t0:0,ch:{vane:values,HDG:filled(50),TWD:Float64Array.from([7,100,NaN,NaN,90,90,90,90,90]),TWS:filled(12),BSP:filled(6)}};
  const mapped=SL.mappedRaw(raw,[{source:'vane',target:'TWA',factor:1,offset:0}]);
  const saved={...raw,ch:{...raw.ch,TWA:values}};
  const expected=[-45,45,-45,45,-180,-180,0,NaN,NaN];
  for (const source of [mapped,saved]) {
    const settings={cfg:{},skipPhases:true};
    const active=SL.analyse(source,settings);
    assert.deepEqual([...active.ch.TWA],expected);
    assert.deepEqual([...active.ch.TWD],[7,100,5,95,90,90,90,90,90]);
    const calib={...SL.CAL0,twa:[{tws:12,up:2,dn:-2}]};
    const proposed=SL.analyse(source,{...settings,calib});
    assert.deepEqual([...proposed.ch.TWA],[-47,47,-47,47,-178,-178,2,NaN,NaN]);
    assert.deepEqual([...proposed.ch.TWD],[5,102,3,97,92,92,92,90,90]);
    const plot=SL.windPlotPreview(active,[{i:0,i1:n}],calib);
    assert.deepEqual([...plot.ch.TWA],[...proposed.ch.TWA]);assert.deepEqual([...plot.ch.TWD],[...proposed.ch.TWD]);
    assert.deepEqual([...source.ch.TWA],[315,45,315,45,180,-180,360,999,-999]);
  }
});

test('manual wind angle entries and imported invalid codes follow the same angle convention',()=>{
  const t0=Date.UTC(2026,10,8,9), n=30, filled=v=>new Float64Array(n).fill(v);
  const raw={n,t0,ch:{BSP:filled(6),TWA:filled(40),TWS:filled(12),HDG:filled(51),TWD:filled(9)}};
  const events={events:[{tl:t0,type:'ManualEntry',attr:'TWA=315;AWA=330;MWA=329'}]};
  const calib={...SL.CAL0,twa:[{tws:12,up:2,dn:2}]};
  const active=SL.analyse(raw,{cfg:{},events}), proposed=SL.analyse(raw,{cfg:{},events,calib});
  assert.deepEqual([active.ch.TWA[0],active.ch.AWA[0],active.ch.MWA[0]],[-45,-30,-31]);
  assert.equal(active.phases[0].tack,'Port');assert.equal(proposed.phases[0].tack,'Port');
  assert.equal(proposed.ch.TWD[0],7);assert.equal(active.L.manual.TWA[0],315);
  assert.equal(raw.ch.TWA[0],40);
  const preview=SL.windPlotPreview(active,[{i:0,i1:n}],calib);
  assert.deepEqual([...preview.ch.TWD],[...proposed.ch.TWD]);
  const parsed=SL.parseLog('time,TWA,AWA,MWA\n2026-11-08T09:00:00Z,999,-999,999\n2026-11-08T09:00:01Z,315,330,329');
  assert.equal(parsed.diagnostics.invalidValues,3);
  assert.ok(Number.isNaN(parsed.ch.TWA[0]));
  assert.deepEqual([parsed.ch.TWA[1],parsed.ch.AWA[1],parsed.ch.MWA[1]],[-45,-30,-31]);
});
