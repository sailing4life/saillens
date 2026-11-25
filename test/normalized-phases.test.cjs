const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['core.js','core2.js','core3.js','sessionflow.js']) {
  vm.runInContext(readFileSync(path.join(__dirname,'../src',file),'utf8'),context,{filename:file});
}
const SL = vm.runInContext('SL',context);
const start = Date.UTC(2026,10,8,12);
const time = i => start + i*1000;
function raw(n, columns) {
  return {t0:start,n,ch:Object.fromEntries(Object.entries(columns).map(([name,value])=>
    [name,Float64Array.from({length:n},(_,i)=>typeof value==='function'?value(i):value)]))};
}
const rules = {method:'normalized',scope:'all'};
const options = {phaseRules:rules,phaseBuild:{generated:true,rules}};
function candidates(input, cfg={}, opts={}) {
  return SL.analyse(input,{...options,cfg:{phaseLen:10,phaseGap:0,...cfg},...opts});
}
const bounds = d => Array.from(d.phases,p=>[p.i,p.i1]);

test('uniform windows survive changes of mode, low wind angles and legacy quality limits',()=>{
  const input=raw(80,{TWA:i=>i<20?i%2?24:26:i<50?i%10<5?40:72:90,TWS:12,
    BSP:i=>i%2?3.2:1.2,HDG:i=>i%2?358:2,PolBsp:10});
  const cfg={phaseLen:15,phaseGap:5,minBsp:6,sdHdg:0,sdTwa:0,sdBsp:0,polMin:95,polMax:105};
  const d=candidates(input,cfg);
  assert.deepEqual(bounds(d),[[0,15],[20,35],[40,55],[60,75]]);
  assert.equal(d.phases[0].mode,'Upwind');
  assert.equal(d.phases.at(-1).mode,'Reaching');
  const first=d.phases[0];
  assert.ok(first.spread.HDG>1.9 && first.spread.HDG<2.2);
  assert.ok(first.v['BSPpol%']<25);
  assert.ok(!d.phases.some(p=>SL.phaseMatchesQuality(p,{polMin:90})));
  assert.ok(d.phases.every(p=>SL.phaseMatchesQuality(p,{})));
  assert.ok(SL.phaseMatchesQuality(first,{sdHdg:2.5,tack:'Stbd',mode:'Upwind'}));
  assert.ok(!SL.phaseMatchesQuality(first,{sdHdg:1.5}));
});

test('a sensor gap only limits the metric that needs it, and the same ranges restore on reload',()=>{
  const input=raw(40,{SOG:i=>i<20?6:NaN,BSP:i=>i<20?NaN:6,TWA:i=>i<10?NaN:45,
    TWS:i=>i===21?11:NaN,HDG:i=>i%10<5?0:NaN});
  const d=candidates(input);
  assert.deepEqual(bounds(d),[[0,10],[10,20],[20,30],[30,40]]);
  assert.equal(d.phases[0].mode,'Onbekend');assert.equal(d.phases[0].tack,'Onbekend');
  assert.equal(d.phases[1].mode,'Upwind');
  assert.ok(!SL.phaseMatchesQuality(d.phases[0],{minBsp:2}));
  assert.ok(SL.phaseMatchesQuality(d.phases[0],{sdHdg:null,polMin:''}));
  assert.ok(!SL.phaseMatchesQuality(d.phases[0],{sdHdg:5}));
  assert.ok(!SL.phaseMatchesQuality(d.phases[2],{sdTws:5}));
  const ranges=Array.from(d.phases,p=>({start:p.t,end:time(p.i1)}));
  const restored=candidates(input,{}, {skipPhases:true,phaseBuild:{generated:true,rules,ranges}});
  assert.deepEqual(bounds(restored),bounds(d));
  for(let i=0;i<d.phases.length;i++) assert.deepEqual(restored.phases[i].spread,d.phases[i].spread);
  const gap=candidates(raw(31,{SOG:i=>i===7?NaN:6}));
  assert.deepEqual(bounds(gap),[[8,18],[18,28]]);
});

test('race, log validity, sailing context and selected time range bound normalized windows',()=>{
  const input=raw(82,{BSP:6,TWA:60,TWS:15});
  const events={events:[
    {tl:time(5),type:'RaceStartGun',attr:'1'}, {tl:time(17),type:'RaceMark',attr:'1'},
    {tl:time(30),type:'SailsUp',attr:'Main;J2'}, {tl:time(42),type:'MotorStart',attr:''},
    {tl:time(48),type:'MotorStop',attr:''}, {tl:time(76),type:'RaceFinish',attr:'1'}
  ]};
  const opts={phaseRules:{...rules,scope:'racing',range:{start:time(6),end:time(72)}},
    events,invalidRanges:[{start:time(59),end:time(61)}]};
  const d=candidates(input,{},opts);
  assert.deepEqual(bounds(d),[[6,16],[17,27],[30,40],[48,58],[61,71]]);
  assert.ok(d.phases.every(p=>SL.phaseMatchesQuality(p,{race:'1'})));
  assert.deepEqual(Array.from(d.phases.filter(p=>SL.phaseMatchesQuality(p,{sail:'J2'})),p=>p.i),[30,48,61]);
});

test('padding comes from the reviewed manoeuvre anchors and zero padding still splits the window',()=>{
  const input=raw(160,{BSP:7,TWA:i=>i<75?45:-45,HDG:i=>i<75?315:45,TWS:12});
  const normal=candidates(input), legacy=SL.analyse(input,{cfg:{}});
  assert.equal(legacy.mans.length,1);
  assert.deepEqual(Array.from(normal.mans,m=>m.i),Array.from(legacy.mans,m=>m.i));
  const anchor=legacy.mans[0].i;
  const moved={turnEdits:[{type:'Tack',original:time(anchor),time:time(77)}]};
  const noPad=candidates(input,{phaseLen:20,manBefore:0,manAfter:0},moved);
  assert.deepEqual(Array.from(noPad.mans,m=>m.i),[77]);
  assert.ok(noPad.phases.every(p=>p.i1<=77 || p.i>=77));
  assert.ok(noPad.phases.some(p=>p.i===77));
  const padded=candidates(input,{phaseLen:15,phaseGap:4,manBefore:8,manAfter:16},moved);
  assert.ok(padded.phases.every(p=>p.i1<=69 || p.i>=93));
  assert.ok(padded.phases.some(p=>p.i===93));
});

test('circular wind spread crosses 180 degrees and percentages use genuine references',()=>{
  const input=raw(30,{BSP:7,TWA:i=>i%2?-179:179,HDG:i=>i%2?359:1,TWS:12,'Targ Twa':150,'Targ Bsp':8,'PolBsp':10});
  const phase=candidates(input).phases[0];
  assert.ok(phase.spread.TWA>1 && phase.spread.TWA<1.1);
  assert.ok(Math.abs(Math.abs(phase.v.TWA)-180)<1e-5);
  assert.ok(SL.phaseMatchesQuality(phase,{polMin:70,polMax:70,vmgMin:90,vmgMax:110}));
  assert.equal(phase.v['BSP_trg%'],87.5);
  assert.ok(!SL.phaseMatchesQuality(phase,{vmgMax:60}));
  const none=candidates(raw(20,{BSP:7,TWA:45,TWS:12})).phases[0];
  assert.ok(Number.isNaN(none.v['BSPpol%']));
  assert.ok(!SL.phaseMatchesQuality(none,{polMin:0}));
  assert.ok(SL.phaseMatchesQuality(none,{}));
});
