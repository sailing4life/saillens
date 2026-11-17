// Smoke tests for the SailLens engine. Run: node tests/smoke.js
// Uses only the built-in example data, so no sailing data is needed in the repository.
const fs = require('fs'), path = require('path'), src = path.join(__dirname, '..', 'src');
global.SL = require(path.join(src, 'core.js'));
for (const f of ['core2.js', 'core3.js']) eval(fs.readFileSync(path.join(src, f), 'utf8'));
let failed = 0;
const ok = (name, cond, info) => { if (!cond) failed++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  [' + info + ']' : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const d = SL.demo(), D = SL.analyse(d.raw, { events: d.events, polar: d.polar, cfg: { evOff: 2, dispOff: 2 } });
ok('demo: phases found', D.phases.length > 120, D.phases.length);
ok('demo: tacks and gybes found', D.sum.tacks >= 10 && D.sum.gybes >= 5, D.sum.tacks + '/' + D.sum.gybes);
ok('demo: race legs from events', D.legs.length >= 8 && D.legs[0].name === 'R1L1', D.legs.length);
ok('demo: upwind VMG% is plausible', near(SL.mean(D.phases.filter(p => p.mode === 'Upwind').map(p => p.v['VMG%'])), 96, 6));
ok('demo: sails come from events', D.phases.some(p => p.sails === 'J2') && D.phases.some(p => p.sails === 'A2'));
ok('manoeuvre loss measured', D.mans.filter(m => SL.fin(m.loss)).length >= 8, D.mans.filter(m => SL.fin(m.loss)).length);

// polar
const P = SL.makePolar(SL.parsePolar('\tTwa0\tBsp0\tTwaUp\tBspUp\tTwa1\tBsp1\tTwaDn\tBspDn\tTwa2\tBsp2\n8\t0\t0\t44\t6.95\t90\t8.2\t143\t7.23\t180\t4.5\n10\t0\t0\t40\t7.42\t90\t8.88\t146\t8.17\t180\t5.5\n'), 'file');
ok('polar: header row and explicit targets', P.rows.length === 2 && P.up(8).twa === 44 && P.dn(10).twa === 146);
ok('polar: interpolates between wind speeds', near(P.up(9).bsp, 7.185, 0.001) && near(P.bsp(9, 90), 8.54, 0.001));

// calibration applied to the log shows up in the models, with the right sign and size
const cal = c => { const X = SL.analyse(d.raw, { events: d.events, polar: d.polar, cfg: { evOff: 2 }, calib: c }); return { bsp: SL.calBsp(X), cur: SL.calCurrent(X.phases, 0) }; };
const c0 = cal(null), c1 = cal({ bspK: 1.04 }), c2 = cal({ hdgOff: 3 });
ok('calibration: BSP factor is recovered', near(c1.bsp.k / c0.bsp.k, 1 / 1.04, 0.012), (c1.bsp.k / c0.bsp.k).toFixed(3));
ok('calibration: heading offset is recovered', near(c2.bsp.delta - c0.bsp.delta, -3, 0.5), (c2.bsp.delta - c0.bsp.delta).toFixed(2));
ok('calibration: tack-pair model agrees on heading', near(c2.cur.delta - c0.cur.delta, -3, 0.6), (c2.cur.delta - c0.cur.delta).toFixed(2));
ok('calibration: wind model runs', !SL.calWind(D.phases).err && !SL.calAwa(D.phases).err);

// events round trip
const xml = SL.eventsXml({ ...d.events, sails: [{ name: 'J2', type: 'Jib' }] }), back = SL.parseEvents(xml);
ok('events: written file reads back the same', back.events.length === d.events.events.length && back.evOff === 2 && SL.parseSailList(xml)[0].name === 'J2');

// sail chart
const ch = SL.parseSailChart('<crossoverchart><polar path="p.txt" type="Expedition" /><elements><element name="J2" group="Jib" type="Sail"><colour r="1" g="2" b="3" /><straightline val="True" /><bezierpoints><point tws="4" twa="20" /><point tws="20" twa="20" /><point tws="20" twa="70" /><point tws="4" twa="70" /></bezierpoints></element></elements></crossoverchart>', 't');
ok('sail chart: reads areas and answers lookups', ch.shapes.length === 1 && SL.chartSail(ch, 10, -45) === 'J2' && SL.chartSail(ch, 10, 150) === '');
ok('sail chart: written file reads back', SL.parseSailChart(SL.chartXml(ch), 't').shapes[0].pts.length === 4);
const st = SL.chartStats(ch, D.phases); ok('sail chart: compares with sails used', st.on > 20 && st.un > 20, st.on + '/' + st.off + '/' + st.un);

// season
const S = SL.newSeason(); SL.seasonMerge(S, [SL.dayRecord(D, { boat: 'Demo' }, {})]); const pool = SL.seasonPool(S);
ok('season: a day goes in and comes back as phases', S.days.length === 1 && pool.length === D.phases.length && near(pool[5].v.BSP, D.phases[5].v.BSP, 0.001));
ok('season: same session is idempotent', SL.seasonMerge(S, [SL.dayRecord(D, { boat: 'Demo' }, {})]).same === 1 && S.days.length === 1);
const tk = SL.seasonFromTackCsv('BoatName,DateTime,IsTack,IsPortToStbd,IsValidPerf,TWS,BSP_bfr,BSP_aft,DistanceLost_m,DistanceLostGPS_m,Rotation_Max,TJAngle,Headsail,Spinnaker,Staysail\r\nDemo,' + S.days[0].date + ' 12:00:00,True,False,True,10,7,6.5,8.5,7,-9,95,J2,,\r\n');
ok('season: RaceReplay tacks import', SL.seasonMergeMans(S, tk).n === 1 && S.days[0].mans[0].loss === 8.5 && S.days[0].mans[0].to === 'Port');

// trends, time lost, wind, starts
const up = D.phases.filter(p => p.mode === 'Upwind'), xs = up.map(p => p.v.TWS), ys = up.map(p => p.v.BSP);
ok('trend: every type returns a line', SL.TRENDS.filter(t => t !== 'None').every(t => SL.fitTrend(xs, ys, t, 10).length >= 3));
ok('trend: band brackets the line', (() => { const b = SL.trendBand(xs, ys, 'Straight line', 10, 30), l = SL.fitTrend(xs, ys, 'Straight line', 10); return b.length > 0 && b.every(q => q[1] <= SL.lineAt(l, q[0]) + 0.05 && q[2] >= SL.lineAt(l, q[0]) - 0.05); })());
const tl = SL.timeLost(D); ok('time lost: legs add up', tl.legs.length >= 8 && near(tl.steady + tl.man, tl.total, 1e-6), tl.total.toFixed(0) + ' s');
ok('wind statistics', (() => { const w = SL.windStats(D); return w && near(w.mean, 215, 8) && w.gust > 1; })());
ok('starts found', SL.starts(D).length >= 2);
ok('driver model trains', (() => { const m = SL.driverModel(up, 'VMG%', ['TWS', 'absTWA', 'abs_heel', 'Forestay']); return !m.err && m.imp.length >= 3; })());

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed'); process.exit(failed ? 1 : 0);
