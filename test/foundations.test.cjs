const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({ console });
for (const name of ['core.js', 'core2.js', 'core3.js', 'storage.js', 'sessionflow.js']) vm.runInContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), context, { filename: name });
const SL = vm.runInContext('SL', context);
const base = Date.UTC(2026, 10, 15, 10);
const iso = (second = 0) => new Date(base + second * 1000).toISOString();
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function log(n = 120, modify = () => {}) {
  const rows = ['time,BSP,TWA,TWS,HDG'];
  for (let i = 0; i < n; i++) { const values = [iso(i), 7, 45, 12, 359]; modify(values, i); rows.push(values.join(',')); }
  return rows.join('\n');
}
const analysis = (raw, cfg = {}, extra = {}) => SL.analyse(raw, { cfg, ...extra });

test('timestamps respect zones, fractions and calendar validity', () => {
  assert.equal(SL.parseTime('2026-11-15T12:00:00+02:00'), base);
  assert.equal(SL.parseTime('2026-11-15T04:30:00-0530'), base);
  assert.equal(SL.parseTime('15/11/2026 10:00:00.040'), base + 40);
  assert.equal(SL.parseTime('2026-11-15 10:00'), base);
  assert.equal(SL.parseTime(String(base / 1000)), base);
  assert.equal(SL.parseTime(String(base)), base);
  near(SL.parseTime(String(base / 864e5 + 25569)), base, 1);
  for (const value of [null, '', '2026-02-30 12:00:00', '2026-11-15 25:00:00', '2026-11-15 10:00:00junk', '2026-11-15T10:00:00+02:65']) assert.ok(Number.isNaN(SL.parseTime(value)), String(value));
});

test('25 Hz import averages every observation and retains counts', () => {
  const rows = ['time,BSP,TWA,TWS,TWD'];
  for (let second = 0; second < 10; second++) for (let j = 0; j < 25; j++) rows.push([iso(second + j / 25), j === 24 ? 9 : 5, 45, 12, j % 2 ? 1 : 359].join(','));
  const raw = SL.parseLog(rows.join('\n'));
  assert.equal(raw.n, 10); near(raw.ch.BSP[0], 5.16); assert.equal(raw.counts.BSP[0], 25);
  assert.ok(Math.abs(SL.w180(raw.ch.TWD[0])) < 0.1); assert.equal(raw.diagnostics.rows, 250);
});

test('CSV quoting, decimal comma and multiline fields share one delimiter', () => {
  const raw = SL.parseLog('time;BSP;TWA;TWS;Note\r\n"' + iso() + '";"7,5";45;12;"one; two\nthree"\r\n"' + iso(1) + '";;45;12;"say ""go"""');
  near(raw.ch.BSP[0], 7.5); assert.equal(raw.counts.BSP[1], 0);
  assert.deepEqual(plain(SL.csvParse('a\tb\n1,5\t"two, three"')), [['a', 'b'], ['1,5', 'two, three']]);
  assert.throws(() => SL.parseLog('time,BSP\n"unfinished'), /unclosed/);
});

test('Expedition sparse row formats map channels and never turn blanks into zero', () => {
  const raw = SL.parseLog(`!boat,UTC,BSP,TWA,TWS\n!boat,0,1,2,3\n1,${iso()},1,,2,45,3,12\n1,0,${iso(10)},1,7,2,45,3,12`);
  assert.ok(Number.isNaN(raw.ch.BSP[0])); assert.equal(raw.ch.BSP[10], 7);
  assert.equal(raw.ch.TWA[0], 45); assert.equal(raw.n, 11);
});

test('out-of-order rows survive; mixed clock conventions fail visibly', () => {
  const raw = SL.parseLog(`time,BSP\n${iso(10)},8\n${iso()},7\nbad-time,9`);
  assert.equal(raw.t0, base); assert.equal(raw.ch.BSP[0], 7); assert.equal(raw.ch.BSP[10], 8);
  assert.equal(raw.diagnostics.outOfOrder, 1); assert.equal(raw.diagnostics.invalidTimes, 1);
  assert.throws(() => SL.parseLog(`time,BSP\n${iso()},7\n2026-11-15 10:00:01,7`), /Mixed UTC/);
});

test('long held gaps cannot become stable phases or reliable manoeuvres', () => {
  const raw = SL.parseLog(log(120, (values, i) => { if (i >= 20 && i < 29) values[1] = ''; }));
  assert.equal(raw.ch.BSP[25], 7); assert.equal(raw.age.BSP[25], 6);
  const result = analysis(raw, { phaseLen: 10, phaseGap: 0 });
  assert.ok(Number.isNaN(result.ch.BSP[25])); assert.equal(raw.ch.BSP[25], 7);
  assert.ok(result.phases.length > 0);
  assert.ok(result.phases.every(p => p.i1 <= 22 || p.i >= 29));
  const strict = analysis(raw, { phaseLen: 10, phaseGap: 0, maxHold: 0 });
  assert.ok(strict.phases.every(p => p.i1 <= 20 || p.i >= 29));
  assert.ok(result.warn.some(s => /Gaps present/.test(s)));
});

test('derived channels do not mutate raw channels and repeated analysis is identical', () => {
  const raw = SL.parseLog(log()); raw.ch.VMG = new Float64Array(raw.n).fill(123);
  const before = Object.fromEntries(Object.entries(raw.ch).map(([k, v]) => [k, Array.from(v)]));
  const a = analysis(raw, {}, { calib: { bspK: 1.05 } });
  const b = analysis(raw, {}, { calib: { bspK: 1.05 } });
  assert.deepEqual(plain(a.phases), plain(b.phases));
  assert.deepEqual(Object.fromEntries(Object.entries(raw.ch).map(([k, v]) => [k, Array.from(v)])), before);
  near(a.ch.VMG[0], 7 * 1.05 * Math.cos(Math.PI / 4));
});

test('deriving one missing true-wind channel preserves the logged other channel', () => {
  for (const missing of ['TWA', 'TWS']) {
    const raw = SL.parseLog(log()); raw.ch.AWA = new Float64Array(raw.n).fill(30); raw.ch.AWS = new Float64Array(raw.n).fill(15); delete raw.ch[missing];
    const result = analysis(raw);
    assert.equal(result.ch[missing === 'TWA' ? 'TWS' : 'TWA'][0], missing === 'TWA' ? 12 : 45);
    assert.ok(Number.isFinite(result.ch[missing][0]));
  }
});

test('bad settings and non-overlapping windows fail without processing the whole log', () => {
  const raw = SL.parseLog(log());
  for (const cfg of [{ phaseLen: 0 }, { phaseLen: 2.5 }, { phaseGap: -1 }, { maxHold: 11 }, { sdTwa: NaN }, { polMin: 130 }, { tStart: base + 130000 }, { tStart: base + 30000, tEnd: base + 10000 }]) assert.throws(() => analysis(raw, cfg));
  const small = analysis(raw, { tStart: base + 10000, tEnd: base + 30000, phaseLen: 10 });
  assert.equal(small.i0, 10); assert.equal(small.i1, 30);
});

test('explicit event offsets align once with UTC logs and survive XML round-trip', () => {
  const raw = SL.parseLog(log());
  const events = SL.parseEvents('<events utc_offset_hours="2"><event datetime="2026-11-15T12:00:15+02:00" type="RaceStartGun" attribute="1" /></events>');
  for (const ev of [events, SL.parseEvents(SL.eventsXml(events))]) {
    const result = analysis(raw, { evOff: 2, logOff: 2, phaseLen: 10, phaseGap: 0 }, { events: ev });
    assert.equal(result.L.list[0].i, 15);
    assert.ok(result.phases.every(p => p.i1 <= 15 || p.i >= 15));
  }
});

test('phase boundaries never cross race marks or testing state changes', () => {
  const raw = SL.parseLog(log());
  const events = { events: [{ tl: base, type: 'RaceStartGun', attr: '1' }, { tl: base + 15000, type: 'RaceMark', attr: '1' }, { tl: base + 65000, type: 'StartTesting', attr: '' }, { tl: base + 85000, type: 'StopTesting', attr: '' }] };
  const result = analysis(raw, { phaseLen: 30, phaseGap: 0 }, { events });
  for (const p of result.phases) for (const boundary of [15, 65, 85]) assert.ok(p.i >= boundary || p.i1 <= boundary);
});

test('a stable phase can straddle a polar band edge, and its mode survives a session reload',()=>{
  const raw=SL.parseLog(log(600,(r,i)=>{r[2]=i%3===0?55.1:54.9;}));
  const rules={...SL.phaseDefaults(SL.DEF),mode:'Upwind'};
  const options={phaseRules:rules,phaseBuild:{generated:true}};
  const result=analysis(raw,{},options);
  assert.equal(result.phases.length,15);assert.equal(result.phaseDiagnostics.byMode.Upwind,15);
  assert.ok(result.phases.every(p=>p.mode==='Upwind' && p.i1-p.i===30));
  const ranges=result.phases.map(p=>({start:p.t,end:base+p.i1*1000}));
  const restored=analysis(raw,{}, {...options,skipPhases:true,phaseBuild:{generated:true,ranges}});
  assert.deepEqual(plain(restored.phases.map(p=>p.mode)),plain(result.phases.map(p=>p.mode)));
  const other=analysis(raw,{}, {...options,phaseRules:{...rules,mode:'Reaching'}});
  assert.equal(other.phases.length,0);assert.ok(other.phaseDiagnostics.reasons.scope>0);
});

test('lasting mode changes, race and leg edges split phases without losing the first valid second',()=>{
  const raw=SL.parseLog(log(90,(r,i)=>{r[2]=i<30?52:58;})); // shift stays within sdTwa
  const ev={events:[{tl:base,type:'RaceStartGun',attr:'1'},{tl:base+60000,type:'RaceMark',attr:'1'}]};
  const result=analysis(raw,{phaseLen:30,phaseGap:0},{events:ev});
  assert.deepEqual(plain(result.phases.map(p=>[p.i,p.i1,p.leg,p.mode])),[[0,30,1,'Upwind'],[30,60,1,'Reaching'],[60,90,2,'Reaching']]);
  const crossing=analysis(raw,{phaseLen:45,phaseGap:0},{events:ev});
  assert.equal(crossing.phases.length,0);assert.equal(crossing.phaseDiagnostics.reasons.boundary,46);
});

test('all start seconds are eligible after failed candidate windows and explicit scope wins',()=>{
  const raw=SL.parseLog(log(31,(r,i)=>{r[1]=i===0?1:7;}));
  const rules=SL.phaseDefaults(SL.DEF),config={phaseLen:30,phaseGap:0,racingOnly:true};
  const result=analysis(raw,config,{phaseRules:rules});
  assert.deepEqual(plain(result.phases.map(p=>p.i)),[1]);
  assert.equal(result.phaseDiagnostics.reasons.speed,1);assert.equal(result.phaseDiagnostics.checkedWindowStarts,2);
  assert.equal(result.phaseDiagnostics.upwindSailingSeconds,30);assert.equal(result.phaseDiagnostics.upwindReasons.speed,0);
  assert.equal(analysis(raw,config).phases.length,0);
  const turn=SL.parseLog(log(31,(r,i)=>{r[2]=i===0?70:45;}));
  const stable=analysis(turn,{phaseLen:30,sdTwa:.5,phaseGap:0});
  assert.deepEqual(plain(stable.phases.map(p=>p.i)),[1]);assert.equal(stable.phaseDiagnostics.reasons.stabilityTwa,1);
  const short=analysis(raw,{phaseLen:4,phaseGap:0});
  const ranges=short.phases.map(p=>({start:p.t,end:base+p.i1*1000}));
  assert.ok(ranges.length>0);
  assert.equal(analysis(raw,{}, {skipPhases:true,phaseBuild:{generated:true,ranges}}).phases.length,ranges.length);
  assert.equal(SL.windowPhase(short,ranges[0]),null); // manoeuvre review still requires five seconds
});

test('upwind rejection counts exclude time outside the selected sailing conditions',()=>{
  const raw=SL.parseLog(log(300,(r,i)=>{r[1]=i<150?0:7;r[2]=i>260?100:45;r[4]=i%2?20:0;}));
  const events={events:[{tl:base+100000,type:'RaceStartGun',attr:'1'},{tl:base+220000,type:'RaceFinish',attr:'1'}]};
  const rules={...SL.phaseDefaults(SL.DEF),scope:'racing'};
  const {phaseDiagnostics:d}=analysis(raw,{sdHdg:1},{phaseRules:rules,events});
  assert.equal(d.upwindSailingSeconds,70);
  assert.equal(d.upwindReasons.stabilityHdg,41);
  assert.equal(d.upwindReasons.scope,29);
  assert.equal(d.upwindReasons.speed,0);
  assert.ok(d.reasons.scope>d.upwindReasons.scope);
  assert.equal(Object.values(d.reasons).reduce((a,b)=>a+b,0)+d.accepted,d.checkedWindowStarts);
});

test('events wholly before the log fail; open testing intervals extend to the end', () => {
  const raw = SL.parseLog(log());
  assert.throws(() => analysis(raw, {}, { events: { events: [{ tl: base - 3600000, type: 'DayStop' }] } }), /does not overlap/);
  const result = analysis(raw, {}, { events: { events: [{ tl: base + 30000, type: 'StartTesting' }] } });
  assert.equal(result.L.testing[29], 0); assert.equal(result.L.testing[119], 1);
});

test('insufficient calibration data does not produce a perfect score', () => {
  assert.equal(SL.calScore({ err: 'no' }, { err: 'no' }, { err: 'no' }), null);
  const bsp = { k: 1, delta: 0 }, wind = { bins: [{ e: 0 }], twsDn: { pct: 0 } }, awa = { read: 0 };
  assert.equal(SL.calScore(bsp, wind, awa), 100);
  assert.equal(SL.calScore(bsp, { bins: [] }, awa), null);
  assert.equal(SL.calScore(bsp, wind, { read: NaN }), null);
  assert.ok(SL.calScore({ k: 1.05, delta: 3 }, wind, awa) < 100);
});

function record(second = 0, boat = 'Test boat') {
  const raw = SL.parseLog(log()); raw.t0 += second * 1000;
  return SL.dayRecord(analysis(raw), { boat }, { files: { log: 'fixture.csv' } });
}
test('same-day sessions and boats stay separate; duplicates are idempotent', () => {
  const season = SL.newSeason(), morning = record(), afternoon = record(3600), otherBoat = record(0, 'Other');
  assert.equal(SL.seasonMerge(season, [morning, afternoon, otherBoat]).add, 3);
  assert.equal(SL.seasonMerge(season, [{ ...morning, added: morning.added + 1 }]).same, 1);
  assert.equal(season.days.length, 3);
  const pool = SL.seasonPool(season); assert.equal(new Set(pool.map(p => p.sessionId)).size, 3);
  assert.equal(morning.recipe.files.log, 'fixture.csv'); assert.equal(morning.recipe.cfg.maxHold, 2);
});

test('season timestamps use UTC for both zoned and floating source clocks', () => {
  const utc = SL.parseLog(log()), floating = SL.parseLog(log().replaceAll('T10:', 'T12:').replaceAll('Z', ''));
  const first = SL.dayRecord(analysis(utc, { dispOff: 2 }), { boat: 'Test' }, {});
  const second = SL.dayRecord(analysis(floating, { logOff: 2, evOff: 2, dispOff: 0 }), { boat: 'Test' }, {});
  assert.equal(first.id, second.id); assert.equal(first.off, second.off);
  assert.deepEqual(plain(first.phases), plain(second.phases));
});

test('conflicting, overlapping and malformed imports are atomic', () => {
  const season = SL.newSeason(), first = record(); SL.seasonMerge(season, [first]);
  const before = JSON.stringify(season);
  assert.throws(() => SL.seasonMerge(season, [record(3600), { ...first, desc: 'changed' }]), /different data/);
  assert.equal(JSON.stringify(season), before);
  assert.throws(() => SL.seasonMerge(season, [record(30)]), /overlaps/);
  assert.throws(() => SL.seasonMerge(season, [{ ...record(3600), phases: [{ t: 1, d: -1 }] }]), /Invalid phase/);
  assert.equal(JSON.stringify(season), before);
});

test('legacy season records remain readable without silent replacement', () => {
  const legacy = plain(record()); delete legacy.recipe; delete legacy.start; delete legacy.end; legacy.id = 'Test boat|2026-11-15';
  const season = { app: 'SailLens', version: 1, days: [legacy] };
  assert.ok(SL.seasonPool(season).length > 0); assert.equal(SL.seasonMerge(season, [legacy]).same, 1); assert.equal(season.version, 2);
});

test('calibration refuses to pool different boats', () => {
  const phases = SL.seasonPool({ days: [record(), record(0, 'Other boat')] });
  for (const result of [SL.calBsp({}, phases), SL.calWind(phases), SL.calAwa(phases), SL.calCurrent(phases, 0)]) assert.match(result.err, /one boat/);
});

test('BSP solver uses each session magnetic variation without mixing current windows', () => {
  const phases = [];
  for (let day = 0; day < 2; day++) for (let i = 0; i < 12; i++) {
    const hdg = i % 2 ? 40 : 320, variation = day ? 12 : -8, trueHeading = hdg + variation;
    phases.push({ t: base + day * 86400000 + i * 60000, sessionId: 'session-' + day, boat: 'Test', day: 'date-' + day, magVar: variation, tack: i % 2 ? 'Port' : 'Stbd', mode: 'Upwind', v: { BSP: 7, SOG: 7, HDG: hdg, COG: trueHeading } });
  }
  const result = SL.calBsp({ magVar: 0 }, phases);
  assert.equal(result.err, undefined); near(result.k, 1); near(result.delta, 0);
  const separate = phases.map((p, i) => ({ ...p, t: base + i * 1000, sessionId: 'one-heading-' + (i % 2) }));
  assert.match(SL.calBsp({}, separate).err, /two 15-minute/);
});

test('RaceReplay missing mode stays unknown; dates and decimal commas parse correctly', () => {
  const days = SL.seasonFromPhaseCsv('StartDateTime;Duration;TWS;TWA;BSP;VMG;BoatName;PhaseTackStr\n15/11/2026 10:00:00;30;12,5;140;7,5;4;Test;Port');
  assert.equal(days[0].date, '2026-11-15'); assert.equal(days[0].unknownModes, 1);
  const p = SL.seasonPool({ days })[0]; assert.equal(p.mode, 'Unknown'); assert.equal(p.v.TWA, -140); assert.equal(p.v.BSP, 7.5);
  assert.equal(p.v.TWS, 12.5); assert.ok(days[0].id.endsWith('|' + base + '|' + (base + 30000)));
});

test('the complete demo pipeline produces stable, finite metrics and preserves input', () => {
  const demo = SL.demo(), initialBsp = Array.from(demo.raw.ch.BSP);
  const result = analysis(demo.raw, { evOff: 2 }, { events: demo.events, polar: demo.polar });
  assert.ok(result.phases.length > 30); assert.ok(result.mans.length > 0); assert.ok(result.sum.dist > 0);
  assert.ok(result.phases.every(p => Number.isFinite(p.v.BSP) && Number.isFinite(p.v['VMG%'])));
  assert.deepEqual(Array.from(demo.raw.ch.BSP), initialBsp);
});

test('every shipped source and the built standalone script parse', () => {
  for (const name of fs.readdirSync(path.join(root, 'src')).filter(n => n.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(root, 'src', name), 'utf8'), { filename: name });
  const html = fs.readFileSync(path.join(root, 'SailLens.html'), 'utf8'), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script, { filename: 'SailLens.html' });
});

test('IndexedDB transaction aborts reject instead of reporting saved', async () => {
  let tx;
  const factory = { open() { const req = {}; queueMicrotask(() => { req.result = { transaction() { tx = { objectStore() { return { put() {}, get() { return {}; } }; } }; return tx; } }; req.onsuccess(); }); return req; } };
  const store = SL.createStore(factory), result = store.set('season', { days: [] });
  await new Promise(resolve => setImmediate(resolve));
  tx.error = new Error('quota exhausted'); tx.onabort();
  await assert.rejects(result, /quota exhausted/);
  const second = store.set('season', { days: [] }); await new Promise(resolve => setImmediate(resolve)); tx.oncomplete(); assert.equal(await second, true);
});

test('queued saves keep order and recover after a failed write', async () => {
  const seen = [], releases = [];
  const write = SL.serialWriter(async value => { seen.push(value); if (value === 1) await new Promise(resolve => releases.push(resolve)); if (value === 2) throw new Error('disk full'); return value; });
  const first = write(1), second = write(2), secondCheck = assert.rejects(second, /disk full/), third = write(3);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(seen, [1]); releases[0]();
  assert.equal(await first, 1); await secondCheck; assert.equal(await third, 3); assert.deepEqual(seen, [1, 2, 3]);
});

test('dual speedos use the selector, preserve valid zero and recompute dependent wind and VMG', () => {
  const rows=['time,BSP,BSP active,BSP Bsp,BSP Sb,AWA,AWS,HDG'];
  for(const [i,code,bb,sb] of [[0,1,5,0],[1,2,0,7],[2,0,4,6],[3,1,0,4],[4,2,7,'']]){
    rows.push([iso(i),6,code,bb,sb,50,12,210].join(','));
  }
  const raw=SL.parseLog(rows.join('\n')),speedos={...SL.speedoConfig(raw.ch),enabled:true,portK:1.1,starboardK:.9};
  const d=analysis(raw,{maxHold:0},{calib:{...SL.CAL0,speedos}});
  [5.5,6.3,6,0,6].forEach((v,i)=>{
    near(d.ch.BSP[i],v);near(d.ch.TWA[i],SL.trueWind(50,12,v).twa);
    near(d.ch.VMG[i],Math.abs(v*Math.cos(d.ch.TWA[i]*SL.D2R)));
  });
  assert.deepEqual([...raw.ch.BSP],[6,6,6,6,6]);
  assert.throws(()=>SL.checkSpeedos({...speedos,portCode:2},raw.ch),/selectiecode/);
  assert.throws(()=>SL.checkSpeedos({...speedos,portK:0},raw.ch),/sensorfactoren/);
  delete raw.ch.BSP;
  const onlySensors=analysis(raw,{maxHold:0},{calib:{...SL.CAL0,speedos}});
  near(onlySensors.ch.BSP[0],5.5);near(onlySensors.ch.TWA[0],SL.trueWind(50,12,5.5).twa);
  assert.ok(Number.isNaN(onlySensors.ch.BSP[2]));
});
test('a switch within a second cannot be averaged into a different active sensor',()=>{
  const raw=SL.parseLog('time,BSP active\n'+iso(0)+',0\n'+iso(.4)+',2\n'+iso(2)+',1');
  assert.ok(Number.isNaN(raw.ch['BSP active'][0]));assert.ok(Number.isNaN(raw.ch['BSP active'][1]));
  assert.equal(raw.ch['BSP active'][2],1);
});
test('track rendering fills only short coherent GPS gaps and preserves excluded seconds',()=>{
  const ctx=vm.createContext({SL,fin:Number.isFinite});
  vm.runInContext(fs.readFileSync(path.join(root,'src','trackmap.js'),'utf8'),ctx);
  const map=vm.runInContext('TrackMap',ctx),lon=Float64Array.from({length:16},(_,i)=>4+i*.00002);
  const lat=new Float64Array(16).fill(52),ages=new Uint8Array(16);ages[2]=1;ages.fill(2,8,14);
  lon[5]+=.003;
  const d={ch:{Lat:lat,Lon:lon,SOG:new Float64Array(16).fill(6)},raw:{age:{Lat:ages,Lon:ages}},n:16,i0:0,i1:16,invalid:new Uint8Array(16)};
  d.invalid[7]=1;
  const clean=map.geometry(d),raw=map.geometry(d,true);
  assert.equal(clean.spikes,1);assert.equal(clean.interpolated,2);assert.ok(Math.abs(clean.x[5]-raw.x[5])>.001);
  assert.ok(Number.isFinite(clean.x[2]));assert.ok(Number.isNaN(clean.x[7]));assert.ok(Number.isNaN(clean.x[10]));
  assert.equal(map.geometry(d),clean);
});
