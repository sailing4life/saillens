const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ctx = vm.createContext({});
for (const name of ['core','windplotdata','tackangles']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), ctx);
}
const SL = vm.runInContext('SL', ctx), t0 = Date.UTC(2026, 10, 8, 9), n = 120;
function data() {
  const ch = {};
  for (const key of ['TWA','TWS','TWD','HDG','Course','COG','SOG','Leeway','Target_TWA']) ch[key] = new Float64Array(n).fill(NaN);
  ch.SOG.fill(5); ch.TWS.fill(12);
  return {n, i0:0, i1:n, raw:{t0}, ch, invalid:new Uint8Array(n), cfg:{magVar:3}, polarSrc:'log',
    L:{sailState:new Int16Array(n), sailConfigs:['Main;J2','Main;J3']}};
}
function leg(D, i, tack) {
  const values = tack === 'Port'
    ? {TWA:316, HDG:44, Course:48, COG:53, Leeway:4, TWD:4, Target_TWA:40}
    : {TWA:44, HDG:316, Course:312, COG:305, Leeway:-4, TWD:356, Target_TWA:42};
  for (const [k,v] of Object.entries(values)) D.ch[k].fill(v, i, i + 20);
  return {i, i1:i + 20, tack, mode:'Upwind'};
}
function pair(D, reverse = false, offset = 0, options = {}) {
  const before = leg(D, offset, reverse ? 'Stbd' : 'Port'), after = leg(D, offset + 35, reverse ? 'Port' : 'Stbd');
  const anchor = t0 + (offset + 26) * 1000;
  return {valid:true, before, after, pair:{key:'Tack:' + anchor, anchor, type:'Tack', approved:true, ...options}};
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`); }
const rowFor = (D, ref, proposal) => SL.tackAngleData(D, {pairs:[ref]}, proposal).rows[0];

test('turn and bisector cross north correctly in either sequence; compare compass, water course, and GPS on a common north', () => {
  for (const reverse of [false, true]) {
    const D = data(), row = rowFor(D, pair(D, reverse));
    assert.equal(row.direction, reverse ? 'Stbd → Port' : 'Port → Stbd');
    assert.equal(row.sail, 'Main / J2'); assert.equal(row.targetSource, 'log');
    const {HDG, Course, COG} = row.active;
    close(HDG.port, 47); close(HDG.stbd, 319); close(HDG.angle, 88); close(HDG.axis, 3);
    close(HDG.twaPort, -44); close(HDG.twaStbd, 44); close(HDG.twaSum, 88); close(HDG.residual, 0);
    close(HDG.twdDelta, 8); close(HDG.twd, 3); close(HDG.twdAxisDelta, 0);
    close(HDG.closure, 4); close(Course.closure, 0); // Onboard TWD follows Course+TWA in this example.
    close(Course.angle, 96); close(Course.halfResidual, 4); close(COG.angle, 108); close(COG.axis, 359); close(COG.twdAxisDelta, -4);
    close(COG.leewayPort, 4); close(COG.leewayStbd, -4); close(HDG.targetHalf, 41);
    assert.equal(HDG.nPort, 20); assert.strictEqual(row.proposed.Course, Course);
    D.cfg.magVar = -7;
    const zero = rowFor(D, pair(D, reverse)).active;
    close(zero.HDG.angle, 88); close(zero.HDG.axis, 353); close(zero.COG.axis, 359);
    close(zero.HDG.closure, 4); close(zero.COG.twdAxisDelta, 6);
  }
});

test('new calibration uses the proposed TWA, logged TWD offset, heading, leeway, and targets on the same windows', () => {
  const D = data(), Q = data(), ref = pair(D); pair(Q);
  Q.ch.TWA.fill(-48, 0, 20); Q.ch.TWA.fill(48, 35, 55);
  Q.ch.HDG.fill(46, 0, 20); Q.ch.HDG.fill(318, 35, 55);
  Q.ch.TWD.fill(2, 0, 20); Q.ch.TWD.fill(2, 35, 55);
  Q.ch.Course.fill(52, 0, 20); Q.ch.Course.fill(312, 35, 55);
  Q.ch.Leeway.fill(6, 0, 20); Q.ch.Leeway.fill(-6, 35, 55); Q.ch.Target_TWA.fill(45);
  const row = rowFor(D, ref, Q), h = row.proposed.HDG;
  close(row.active.HDG.halfResidual, 0); close(h.halfResidual, -4); close(h.axis, 5);
  close(h.twd, 5); close(h.twdDelta, 0); close(h.closure, 4); close(h.targetHalf, 45);
  close(row.proposed.Course.angle, 100); close(h.leewayPort, 6); close(h.leewayStbd, -6);
  Q.ch.TWA[3] = 48;
  const bad = rowFor(D, ref, Q); assert.ok(bad.active.HDG); assert.equal(bad.proposed.HDG, null);
});

test('each metric uses concurrent measurement seconds and preserves valid independent channels and missing targets', () => {
  const D = data(), Q = data(), ref = pair(D); pair(Q);
  D.ch.HDG[0] = NaN; D.ch.TWA[1] = NaN;
  Q.ch.Course[0] = NaN; Q.ch.TWD.fill(NaN, 35, 37);
  D.ch.Target_TWA.fill(NaN, 35, 37); D.ch.Leeway.fill(NaN, 35, 55);
  D.ch.SOG.fill(.1, 35, 37);
  const r = rowFor(D, ref, Q);
  assert.equal(r.active.HDG, null); assert.equal(r.proposed.HDG, null);
  assert.equal(r.active.Course.nPort, 19); assert.equal(r.proposed.Course, null);
  assert.equal(r.active.COG, null); assert.ok(Number.isNaN(r.active.Course.targetHalf));
  assert.ok(Number.isNaN(r.active.Course.leewayStbd)); close(r.active.Course.leewayPort, 4);
  D.ch.TWA[1] = 316; D.ch.Course[0] = 80;
  const q = rowFor(D, ref, Q);
  assert.equal(q.active.Course.nPort, 19); close(q.active.Course.port, 51); close(q.proposed.Course.port, 51);
  assert.ok(Number.isNaN(q.proposed.Course.twd)); assert.ok(Number.isNaN(q.proposed.Course.closure));
  close(q.proposed.Course.angle, 96);
  delete D.ch.Course;
  assert.equal(rowFor(D, ref).active.Course, null);
});

test('wrap-aware means survive north crossings, while reversed, coincident, antipodal and indeterminate tracks have no directed upwind solution', () => {
  const D = data(), ref = pair(D); D.cfg.magVar = 0;
  D.ch.HDG.fill(359, 0, 10); D.ch.HDG.fill(1, 10, 20); D.ch.HDG.fill(274, 35, 55);
  const h = rowFor(D, ref).active.HDG; close(h.angle, 86); close(h.axis, 317);
  for (const [p, s] of [[310, 50], [55, 55], [55, 235]]) {
    D.ch.Course.fill(p, 0, 20); D.ch.Course.fill(s, 35, 55);
    assert.equal(rowFor(D, ref).active.Course, null);
  }
  D.ch.COG.fill(60, 0, 10); D.ch.COG.fill(240, 10, 20);
  assert.equal(rowFor(D, ref).active.COG, null);
});

test('reviewed holdouts and tactical tacks stay flagged and deduplicated; unapproved, invalid, changed-sail and downwind pairs are not eligible', () => {
  const D = data(), tactical = pair(D, false, 0, {vmgToVmg:false}), holdout = pair(D, true, 65, {validation:true});
  const refs = {pairs:[tactical, tactical], validationPairs:[holdout]};
  const reusable = SL.windPlotData(D, refs);
  const rows = SL.tackAngleData(D, refs, D, reusable).rows;
  assert.equal(rows.length, 2); assert.equal(rows[0].vmgToVmg, false); assert.equal(rows[1].validation, true);
  tactical.pair.approved = false; assert.equal(rowFor(D, tactical), undefined); tactical.pair.approved = true;
  D.invalid[1] = 1; assert.equal(rowFor(D, tactical), undefined); D.invalid[1] = 0;
  D.L.sailState.fill(1, 35, 55); assert.equal(rowFor(D, tactical), undefined); D.L.sailState.fill(0);
  D.ch.TWA.fill(-68, 0, 20); D.ch.TWA.fill(72, 35, 55);
  close(rowFor(D, tactical).active.HDG.twaSum, 140); // A suspected over-wide TWA remains diagnosable.
  tactical.pair.type = 'Gybe'; D.ch.TWA.fill(-140, 0, 20); D.ch.TWA.fill(140, 35, 55);
  assert.equal(rowFor(D, tactical), undefined);
});

test('closure exposes the TWD input actually used, including gap fills, hold expiry and manual or calculated sources', () => {
  const D = data(), ref = pair(D), origin = () => rowFor(D, ref).active.HDG.twdSource;
  assert.equal(origin(), 'unknown');
  D.raw.ch = {}; assert.equal(origin(), 'derived');
  D.raw.ch.TWD = Float64Array.from(D.ch.TWD); assert.equal(origin(), 'log');
  D.raw.ch.TWD[5] = NaN; assert.equal(origin(), 'mixed');
  D.raw.ch.TWD[5] = 4; D.raw.age = {TWD:new Uint16Array(n).fill(3)}; assert.equal(origin(), 'derived');
  D.cfg.maxHold = 3; assert.equal(origin(), 'log');
  D.L.manual = {TWD:Float64Array.from(D.ch.TWD)}; assert.equal(origin(), 'manual');
  D.L.manual.TWD[0] = NaN; assert.equal(origin(), 'mixed');
  D.formulaDiagnostics = [{name:'TWD'}]; assert.equal(origin(), 'formula');
  D.ch.TWD.fill(NaN, 35, 37); assert.equal(origin(), 'missing');
});
