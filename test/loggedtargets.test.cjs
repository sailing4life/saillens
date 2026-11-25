const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({});
for (const name of ['core','core2','sessionflow']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),ctx);
}
const SL = vm.runInContext('SL',ctx);
const n = 600;
const filled = (value,length=n) => new Float64Array(length).fill(value);
const log = (angle, channels, length=n) => ({
  n:length, t0:Date.UTC(2026,10,8,10), ch:{BSP:filled(6,length), TWA:filled(angle,length), TWS:filled(12,length), ...channels}
});

test('signed and compass-encoded logged VMG targets generate the same upwind phases on both tacks', () => {
  for (const [angle,target] of [[43,42],[-43,-42],[-43,318]]) {
    const raw = log(angle,{'Targ Twa':filled(target),'Targ Bsp':filled(6),PolBsp:filled(6)});
    const D = SL.analyse(raw,{cfg:{},phaseRules:{mode:'Upwind'}});
    assert.equal(D.phases.length,15);
    assert.equal(D.phases[0].tack,angle < 0 ? 'Port' : 'Stbd');
    assert.equal(D.ch.Target_TWA[0],42);
    assert.equal(D.ch['ΔTWA'][0],1);
    assert.equal(raw.ch['Targ Twa'][0],target);
  }
});

test('unavailable and opposite-sector targets fall back for classification without inventing performance targets', () => {
  const original=Float64Array.from([0,360,999,-240,-145,NaN,-42,-145]);
  const raw=log(-43,{Target_TWA:original,Target_BSP:filled(6,original.length)},original.length);
  raw.ch.TWA[7]=-150;
  const D=SL.analyse(raw,{cfg:{},skipPhases:true});
  assert.deepEqual(Array.from(D.mode),[0,0,0,0,0,0,0,3]);
  assert.deepEqual(Array.from(D.ch.Target_TWA),[NaN,NaN,NaN,NaN,NaN,NaN,42,145]);
  assert.ok(Number.isNaN(D.ch['VMG%'][0]));
  assert.equal(D.ch.Target_BSP[0],NaN);
  assert.equal(D.ch.Target_BSP[5],6);
  assert.equal(raw.ch.Target_TWA[6],-42);
});

test('independent logged target channels support classification and only their own derived metrics', () => {
  const angleOnly=SL.analyse(log(57,{'Targ TWA':filled(49)}),{cfg:{}});
  assert.equal(angleOnly.polarSrc,'log');
  assert.equal(angleOnly.phases[0].mode,'Upwind'); // fallback 45 + 10 would classify reaching
  assert.equal(angleOnly.ch.Target_TWA[0],49);
  assert.ok(Number.isNaN(angleOnly.ch['BSPpol%'][0]));
  assert.ok(Number.isNaN(angleOnly.ch['VMG%'][0]));

  const speedOnly=SL.analyse(log(43,{'Pol Bsp':filled(8)}),{cfg:{}});
  assert.equal(speedOnly.ch['BSPpol%'][0],75);
  assert.ok(Number.isNaN(speedOnly.ch.Target_BSP[0]));
  assert.ok(Number.isNaN(speedOnly.ch.Target_TWA[0]));
});

test('widening the upwind margin keeps beam and deeper reaching out of the upwind phases', () => {
  for (const angle of [90,105,-105]) {
    const D=SL.analyse(log(angle,{}),{cfg:{upMargin:60},phaseRules:{mode:'Upwind'}});
    assert.equal(D.phases.length,0);
    assert.notEqual(D.mode[0],0);
  }
});
