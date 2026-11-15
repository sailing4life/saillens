'use strict';
/* SailLens tabs (part 2): calibration, ML, season database, report, boot. */
const withScope = (s, fn) => { const sv = A.scope; A.scope = s; try { return fn(); } finally { A.scope = sv; } };
const pm = (v, se, d = 1) => f1(v, d) + (fin(se) ? ' ± ' + f1(se, d) : '');

/* ---------------- Calibration ---------------- */
function calAll(ps, mv) { const bsp = SL.calBsp({ magVar: mv || 0 }, ps), wind = SL.calWind(ps), awa = SL.calAwa(ps), cur = SL.calCurrent(ps, mv || 0); return { bsp, wind, awa, cur, score: SL.calScore(bsp, wind, awa) }; }
function calFindings(r, logMagVar, mv) {
  const out = [], { bsp, wind, awa } = r;
  if (!bsp.err) {
    const pct = (bsp.k - 1) * 100, sure = bsp.kLo > 1 || bsp.kHi < 1;
    out.push([sure && Math.abs(pct) > 0.7 ? 'warn' : 'good', sure && Math.abs(pct) > 0.7 ? `BSP reads ${f1(Math.abs(pct))}% ${pct > 0 ? 'low' : 'high'} against GPS. Multiply the BSP calibration by ${bsp.k.toFixed(3)} (90% range ${bsp.kLo.toFixed(3)}–${bsp.kHi.toFixed(3)}).` : `BSP agrees with GPS: factor ${bsp.k.toFixed(3)} (90% range ${bsp.kLo.toFixed(3)}–${bsp.kHi.toFixed(3)}), current solved separately.`]);
    const dsure = bsp.dLo > 0 || bsp.dHi < 0;
    if (dsure && Math.abs(bsp.delta) > 1) { let t = `Heading reads ${f1(Math.abs(bsp.delta))}° ${bsp.delta > 0 ? 'low' : 'high'}: the boat's track through the water has to be turned ${bsp.delta > 0 ? 'clockwise' : 'anticlockwise'} to match GPS (90% range ${f1(bsp.dLo)}° to ${f1(bsp.dHi)}°).`; if (logMagVar != null && Math.abs(bsp.delta - (logMagVar - (mv || 0))) < 1) t += ` That matches the magnetic variation Expedition logged (${f1(logMagVar)}°), so HDG looks magnetic: set Mag variation to ${f1(logMagVar)} on Setup.`; else t += ` Add ${f1(bsp.delta)}° to the compass offset.`; out.push(['warn', t]); }
    else out.push(['good', `Heading agrees with GPS within ${f1(Math.max(Math.abs(bsp.dLo), Math.abs(bsp.dHi)))}°.`]);
    const tp = bsp.byTack.find(x => x.k === 'Port'), ts = bsp.byTack.find(x => x.k === 'Stbd');
    if (tp && ts && Math.abs(tp.r - ts.r) > 0.012) out.push(['warn', `BSP reads ${f1(Math.abs(tp.r - ts.r) * 100)}% ${tp.r > ts.r ? 'lower on port than on starboard' : 'lower on starboard than on port'}: an off-centre paddle wheel or a heel correction.`]);
    if (bsp.drift) out.push(['bad', `BSP changed by ${f1(-bsp.drift.d * 100)}% against GPS from about ${tstr(bsp.drift.at)} onwards and stayed there: check the paddle wheel for weed or fouling.`]);
  }
  const cur = r.cur;
  if (cur && !cur.err) {
    const lsure = cur.hasLee && (cur.lLo > 1 || cur.lHi < 1) && Math.abs(cur.lam - 1) > 0.15;
    out.push([cur.rms0 > 0.2 ? 'warn' : 'good', `Current before and after each tack or gybe differs by ${f1(cur.rms0, 2)} kn on average over ${cur.n} manoeuvres` + (cur.rms0 - cur.rms1 > 0.04 ? `; the corrections in the current card bring that down to ${f1(cur.rms1, 2)} kn.` : ', and no BSP, heading or leeway change makes it clearly smaller.')]);
    if (lsure) out.push(['warn', `Leeway: the logged leeway looks ${cur.lam < 1 ? 'too large' : 'too small'}. The current lines up across tacks with leeway at ${f1(cur.lam * 100, 0)}% of what is logged (90% range ${f1(cur.lLo * 100, 0)}–${f1(cur.lHi * 100, 0)}%).`]);
  }
  if (!wind.err) {
    for (const b of wind.bins) if (Math.abs(b.e) > 1 && Math.abs(b.e) > 2 * b.se) out.push(['warn', `${b.mode} in ${b.band} kn: TWD jumps ${f1(Math.abs(2 * b.e))}° from tack to tack. ${b.e > 0 ? 'Add' : 'Subtract'} ${f1(Math.abs(b.e))}° ${b.e > 0 ? 'to' : 'from'} TWA in the calibration table for that wind band (±${f1(b.se)}°).`]);
    if (!wind.bins.some(b => Math.abs(b.e) > 1 && Math.abs(b.e) > 2 * b.se)) out.push(['good', 'TWD is consistent from tack to tack in every wind band with enough data.']);
    if (wind.twsDn && Math.abs(wind.twsDn.pct) > 3 && Math.abs(wind.twsDn.pct) > 2 * wind.twsDn.se) out.push(['warn', `TWS reads ${f1(Math.abs(wind.twsDn.pct))}% ${wind.twsDn.pct > 0 ? 'higher' : 'lower'} downwind than upwind at the same moment (±${f1(wind.twsDn.se)}%). A downwind TWS correction of ${f1(-wind.twsDn.pct, 0)}% would line them up.`]);
  }
  if (!awa.err) {
    const agree = fin(awa.fromTws) && awa.fromTws * awa.read > 0 && Math.abs(awa.fromTws) < 3 * Math.abs(awa.read) + 0.5;
    if (Math.abs(awa.read) > 0.5 && Math.abs(awa.read) > 2 * awa.se) out.push([agree ? 'warn' : '', `Upwind, |AWA| reads ${f1(Math.abs(2 * awa.read))}° larger on ${awa.read > 0 ? 'starboard' : 'port'} than on ${awa.read > 0 ? 'port' : 'starboard'} for the same wind and speed: the masthead unit looks ${f1(Math.abs(awa.read))}° off towards ${awa.read > 0 ? 'starboard' : 'port'} (±${f1(awa.se)}°). ` + (agree ? `The TWS difference between tacks points the same way, so an AWA offset of ${f1(-awa.read)}° is worth trying.` : `The TWS difference between tacks does not confirm it, so part of this is real (current, waves or a different mode per tack). Try ${f1(-awa.read)}° below before changing anything.`)]);
    else out.push(['good', `Masthead unit: |AWA| upwind is the same on both tacks within ${f1(Math.abs(awa.read) + 2 * awa.se)}°.`]);
  }
  return out;
}
function blkCalModel(c, r, o) {
  o = o || {}; const { bsp, wind, awa } = r, cl = (v, a, b) => !fin(v) ? '' : Math.abs(v) <= a ? 'good' : Math.abs(v) <= b ? 'warn' : 'bad';
  const up = wind.err ? [] : wind.bins.filter(b => b.mode === 'Upwind'), wmax = wind.err || !wind.bins.length ? NaN : wind.bins.reduce((a, b) => Math.abs(b.e) > Math.abs(a.e) ? b : a).e;
  c.append(h('div', { class: 'kpis' }, kpi('Calibration score', f1(r.score, 0), fin(r.score) ? '/100' : '', fin(r.score) ? 'rough overall figure' : 'insufficient data for a complete score', !fin(r.score) ? '' : r.score >= 85 ? 'good' : r.score >= 65 ? 'warn' : 'bad'),
    kpi('BSP factor', bsp.err ? '–' : bsp.k.toFixed(3), '', bsp.err ? 'not enough data' : `range ${bsp.kLo.toFixed(3)}–${bsp.kHi.toFixed(3)}`, bsp.err ? '' : cl((bsp.k - 1) * 100, 1, 2.5)),
    kpi('Heading vs GPS', bsp.err ? '–' : f1(bsp.delta), '°', bsp.err ? '' : `range ${f1(bsp.dLo)} to ${f1(bsp.dHi)}`, bsp.err ? '' : cl(bsp.delta, 1.5, 3)),
    kpi('Masthead offset', awa.err ? '–' : f1(awa.read), '°', awa.err ? 'not enough data' : '± ' + f1(awa.se) + ' · + is to starboard', awa.err ? '' : cl(awa.read, 0.7, 1.5)),
    kpi('Largest TWA error', fin(wmax) ? f1(wmax) : '–', '°', 'tack-to-tack TWD ÷ 2', cl(wmax, 1.5, 3)),
    kpi('TWS down vs up', wind.err || !wind.twsDn ? '–' : (wind.twsDn.pct > 0 ? '+' : '') + f1(wind.twsDn.pct), '%', wind.err || !wind.twsDn ? '' : '± ' + f1(wind.twsDn.se), wind.err || !wind.twsDn ? '' : cl(wind.twsDn.pct, 3, 7))));
  const fnd = calFindings(r, o.logMagVar, o.mv);
  if (fnd.length) c.append(h('ul', { class: 'insight' }, fnd.map(([k, t]) => h('li', {}, h('span', { class: 'verdict ' + k }, k === 'good' ? 'OK · ' : k === 'bad' ? 'Check · ' : k === 'warn' ? 'Adjust · ' : 'Note · '), t))));
  if (o.compact) return;
  if (o.after) o.after();
  // boat speed card
  const s1 = card(['Boat speed, compass and current ', mlTag()]); c.append(s1);
  if (bsp.err) s1.append(h('p', { class: 'muted' }, bsp.err)); else {
    s1.append(h('p', { class: 'muted' }, `Fits one model to ${bsp.nPh} phases in ${bsp.nWin} windows of 15 minutes: speed over ground = factor × BSP along the ${bsp.useCse ? 'course (heading plus logged leeway)' : 'heading'}, turned by a heading offset, plus a current that is free to change every window. Only windows with both tacks count, so a steady current cannot pass for a BSP error. The ranges come from re-fitting on 200 resamples of the windows.`));
    const cv = h('canvas'), xs = bsp.ratio.map((x, i) => i), ys = bsp.ratio.map(x => (x.r - 1) * 100), lim = Math.max(4, SL.quant(ys.map(Math.abs), 0.97) * 1.2);
    s1.append(legend([[css('--port'), 'Port'], [css('--stbd'), 'Stbd']]), h('div', {}, cv));
    const p = plot(cv, { xr: [0, xs.length], yr: [-lim, lim], h: 230, yl: 'GPS speed − BSP (%)', ysuf: '%', xl: 'phases in time order', noX: true }); p.zero(0); p.note('BSP reads low', true); p.note('BSP reads high', false);
    bsp.ratio.forEach((x, i) => p.dot(i, ys[i], css(x.p.tack === 'Port' ? '--port' : '--stbd'), ptip(x.p, 'GPS along-track speed is ' + f1(ys[i]) + '% ' + (ys[i] > 0 ? 'above' : 'below') + ' BSP'), x.p, x.p.tack === 'Stbd', 3));
    p.line(SL.loess(xs, ys, 0.4, 40), css('--ink'), 2); if (bsp.drift) { const X = p.X(bsp.drift.c); p.c.strokeStyle = css('--bad'); p.c.setLineDash([5, 4]); p.c.beginPath(); p.c.moveTo(X, p.pt); p.c.lineTo(X, p.H - p.pb); p.c.stroke(); p.c.setLineDash([]); p.label('change ' + tstr(bsp.drift.at), bsp.drift.c, lim * 0.8, css('--bad')); }
    const gt = (title, rows) => h('div', {}, h('h4', {}, title), table(['', 'Phases', 'GPS ÷ BSP'], rows.map(x => [{ t: x.k, c: 'b' }, x.n, { t: (x.r * 100).toFixed(1) + '%', s: heat(x.r * 100, scale('BSPpol%', [])) }]), 'num'));
    s1.append(h('div', { class: 'cols' }, gt('By tack', bsp.byTack), gt('By speed', bsp.bySpeed), gt('By mode', bsp.byMode)));
    if (bsp.cur.length <= 40) s1.append(h('h4', {}, 'Current the model found'), table(['Window from', 'Phases', 'Rate (kn)', 'Setting towards'], bsp.cur.map(x => [o.season ? new Date(x.t).toISOString().slice(0, 16).replace('T', ' ') : tstr(x.t), x.n, f1(x.rate, 2), f1(x.dir, 0) + '°']), 'num'));
  }
  // current across tacks
  const cur = r.cur, sc0 = card(['Current before and after each tack ', mlTag()]); c.append(sc0);
  if (!cur || cur.err) sc0.append(h('p', { class: 'muted' }, cur ? cur.err : '')); else {
    sc0.append(h('p', { class: 'muted' }, `The water does not know which tack you are on, so the current worked out just before a tack should equal the current just after. What is left over is instrument error, and the three errors behave differently across a tack: a BSP factor changes the length of the boat's vector, a heading offset turns it the same way on both tacks, a leeway error turns it opposite ways. The model finds the combination that makes the current match across all ${cur.n} manoeuvres (${cur.nTack} tacks, ${cur.n - cur.nTack} gybes).`),
      h('div', { class: 'kpis' }, kpi('Mismatch as logged', f1(cur.rms0, 2), 'kn', 'current after − before'), kpi('After the fit', f1(cur.rms1, 2), 'kn', cur.rms0 > 0 ? f1((1 - cur.rms1 / cur.rms0) * 100, 0) + '% smaller' : '', cur.rms1 < cur.rms0 * 0.75 ? 'good' : ''), kpi('BSP factor', cur.k.toFixed(3), '', `range ${cur.kLo.toFixed(3)}–${cur.kHi.toFixed(3)}`), kpi('Heading', f1(cur.delta), '°', `range ${f1(cur.dLo)} to ${f1(cur.dHi)}`), kpi('Leeway', cur.hasLee ? f1(cur.lam * 100, 0) : '–', cur.hasLee ? '% of logged' : '', cur.hasLee ? `range ${f1(cur.lLo * 100, 0)}–${f1(cur.lHi * 100, 0)}%` : 'no Leeway channel in the log')));
    const cv = h('canvas'), lim = Math.max(0.3, SL.quant(cur.rows.flatMap(x => [Math.abs(x.d0[0]), Math.abs(x.d0[1])]), 0.97) * 1.25); sc0.append(legend([[css('--muted'), 'as logged'], [css('--accent'), 'after the fit']]), h('div', { style: 'max-width:460px' }, cv));
    const p = plot(cv, { xr: [-lim, lim], yr: [-lim, lim], h: 380, xl: 'change in current across the manoeuvre, east (kn)', yl: 'north (kn)' }); p.zero(0); p.c.strokeStyle = css('--ink2'); p.c.beginPath(); p.c.moveTo(p.X(0), p.pt); p.c.lineTo(p.X(0), p.H - p.pb); p.c.stroke();
    cur.rows.forEach(x => { p.c.strokeStyle = css('--line'); p.c.beginPath(); p.c.moveTo(p.X(x.d0[0]), p.Y(x.d0[1])); p.c.lineTo(p.X(x.d1[0]), p.Y(x.d1[1])); p.c.stroke(); });
    cur.rows.forEach(x => { const tip = `<b>${ptime(x.q)}</b> ${x.type}<br>current before ${f1(x.bef.rate, 2)} kn setting ${f1(x.bef.dir, 0)}°, after ${f1(x.aft.rate, 2)} kn setting ${f1(x.aft.dir, 0)}°<br>mismatch ${f1(x.mis0, 2)} kn as logged, ${f1(x.mis1, 2)} kn after the fit`; p.dot(x.d0[0], x.d0[1], css('--muted'), tip, x.q, false, 4); p.dot(x.d1[0], x.d1[1], css('--accent'), tip, x.q, false, 4); });
    sc0.append(h('p', { class: 'muted' }, 'Each manoeuvre is a pair of dots joined by a line: grey is the change in current as logged, teal the change once the fitted corrections are applied. A perfect calibration puts every dot on the centre.'));
    const sm = scale('ΔX', [0.3]); sc0.append(table(['Time', 'Type', 'TWS', 'Before kn', 'Before set', 'After kn', 'After set', 'Mismatch', 'After fit'], cur.rows.slice(0, 40).map(x => { const row = [ptime(x.q), x.type, f1(x.tws), f1(x.bef.rate, 2), f1(x.bef.dir, 0) + '°', f1(x.aft.rate, 2), f1(x.aft.dir, 0) + '°', { t: f1(x.mis0, 2), s: heat(x.mis0, sm) }, { t: f1(x.mis1, 2), s: heat(x.mis1, sm) }]; if (x.q.i != null) row._attrs = { class: 'click', onclick: () => { A.cur = x.q.i; show('chart'); } }; return row; }), 'num'));
    sc0.append(h('p', { class: 'muted' }, 'This is a second, independent look at the same question as the card above: that one frees the current every 15 minutes and takes the logged leeway as given, this one compares only the phases either side of a manoeuvre and solves the leeway too. Where the two agree you can act on it.'));
  }
  // wind card
  const s2 = card(['Wind angle and wind speed ', mlTag()]); c.append(s2);
  if (wind.err) s2.append(h('p', { class: 'muted' }, wind.err)); else {
    s2.append(h('p', { class: 'muted' }, `The true wind direction cannot depend on which tack you are on. The model fits a smooth wind history through all ${wind.n} upwind and downwind phases${wind.days > 1 ? ' (each of the ' + wind.days + ' days on its own)' : ''} and asks how much TWD steps with the tack in each wind band. Half that step is the TWA error: the number for the TWA calibration (upwash) table. It uses every phase, not only the ones either side of a tack, and down-weights shifts.`));
    s2.append(table(['Mode', 'TWS band', 'Phases'].concat(wind.days > 1 ? ['Days'] : [], ['Add to TWA', 'Verdict']), wind.bins.map(b => { const sig = Math.abs(b.e) > 1 && Math.abs(b.e) > 2 * b.se; return [{ t: b.mode, c: 'b' }, b.band + ' kn', b.n].concat(wind.days > 1 ? [b.days] : [], [{ t: pm(b.e, b.se) + '°', c: 'b' }, { t: sig ? 'adjust' : Math.abs(b.e) > 1 ? 'not sure yet' : 'fine', c: 'verdict ' + (sig ? 'warn' : Math.abs(b.e) > 1 ? '' : 'good') }]); }), 'num'));
    const cv = h('canvas'); s2.append(legend([[css('--s1'), 'Upwind'], [css('--s2'), 'Downwind']]), h('div', { style: 'max-width:720px' }, cv)); const lim = Math.max(3, ...wind.bins.map(b => Math.abs(b.e) + b.se)) * 1.15, tx = wind.bins.map(b => b.tws);
    const p = plot(cv, { xr: [Math.min(...tx) - 1.5, Math.max(...tx) + 1.5], yr: [-lim, lim], h: 240, xl: 'TWS (kn)', yl: 'add to TWA (°)', ysuf: '°' }); p.zero(0);
    for (const [m, col] of [['Upwind', css('--s1')], ['Downwind', css('--s2')]]) { const g = wind.bins.filter(b => b.mode === m); p.line(g.map(b => [b.tws, b.e]), col, 2); for (const b of g) { p.c.strokeStyle = col; p.c.lineWidth = 1.5; p.c.beginPath(); p.c.moveTo(p.X(b.tws), p.Y(b.e - b.se)); p.c.lineTo(p.X(b.tws), p.Y(b.e + b.se)); p.c.stroke(); p.dot(b.tws, b.e, col, `${m} · ${b.band} kn<br>add ${pm(b.e, b.se)}° to TWA<br>${b.n} phases`, null, false, 5); } }
    s2.append(h('p', { class: 'muted' }, [wind.twsDn ? `TWS downwind vs upwind: ${wind.twsDn.pct > 0 ? '+' : ''}${pm(wind.twsDn.pct, wind.twsDn.se)}%. ` : '', wind.twsTack ? `TWS starboard vs port: ${wind.twsTack.pct > 0 ? '+' : ''}${pm(wind.twsTack.pct, wind.twsTack.se)}%.` : ''].join('')));
  }
  const s3 = card(['Masthead unit offset ', mlTag()]); c.append(s3);
  if (awa.err) s3.append(h('p', { class: 'muted' }, awa.err)); else s3.append(h('p', { class: 'muted' }, `A regression on ${awa.nP} port and ${awa.nS} starboard upwind phases explains |AWA| from AWS, BSP and heel, and reads what is left over between the tacks. A masthead unit that is twisted adds to |AWA| on one tack and takes away on the other.`),
    table(['Estimate', 'Offset towards starboard'], [['Regression (wind, speed and heel held equal)', { t: pm(awa.read, awa.se) + '°', c: 'b' }], ['Plain port/starboard difference ÷ 2', f1(awa.raw) + '°'], ['Implied by the TWS difference between tacks', f1(awa.fromTws) + '°']], 'num'));
}
R.cal = () => {
  const c = pane('cal'), st = A.cal = A.cal || { off: 0 }, ps = phases(), mv = season() ? 0 : A.D.magVar, r = calAll(ps, mv);
  c.append(bar(filterBar(() => R.cal())));
  blkCalModel(c, r, { logMagVar: season() ? null : A.D.logMagVar, mv, season: season(), after: season() ? null : () => blkCalib(c, r) });
  if (!season()) { const b = h('div'), inp = h('input', { type: 'number', id: 'cal-off', step: 0.1, value: st.off, onchange: e => { st.off = +e.target.value || 0; b.textContent = ''; blkCal(b, st.off); } });
    c.append(card('Tables and what-if', bar(field('Try AWA offset (°)', inp), !r.awa.err && Math.abs(r.awa.read) > 0.3 ? h('button', { onclick: () => { st.off = Math.round(-r.awa.read * 10) / 10; R.cal(); } }, 'Try the suggested ' + f1(-r.awa.read) + '°') : null), b)); blkCal(b, st.off); }
  else c.append(h('p', { class: 'muted' }, 'Per-day tables are on the Calibration tab in This day mode; the day-by-day trend is on the Season database tab.'));
};

/* ---------------- ML ---------------- */
const TRIM = ['Forestay', 'Trim', 'Vang', 'Trav', 'Main', 'BackStay', 'Cunningham', 'Outhaul', 'Rake', 'MastButt', 'Downhaul', 'Boom', 'Twist', 'Heave', 'WvSigHt', 'Load S', 'Load P', 'RunnerS', 'RunnerP', 'JibH', 'MainH'];
function mlModel(mode) {
  const key = A.scope + '|' + mode + '|' + JSON.stringify(A.filt) + '|' + pool().length; A.ml = A.ml || {}; if (A.ml[key]) return A.ml[key];
  const ps = phases(mode); ps.forEach(p => { p.v['Stbd tack'] = p.tack === 'Stbd' ? 1 : 0; });
  const feats = ['TWS', 'absTWA', 'abs_heel', 'abs_rudder', 'Stbd tack'].concat(TRIM, manualKeys()).filter(k => k === 'Stbd tack' || hasVar(k));
  return A.ml[key] = SL.driverModel(ps, mode === 'Reaching' ? 'BSPpol%' : 'VMG%', feats);
}
const COND = { TWS: 1, 'Stbd tack': 1 };
function mlInsights(m) {
  const out = []; if (m.err || m.cvR2 <= 0.08) return out;
  for (const im of m.imp.slice(0, 5)) { if (im.v < 0.04) continue; const g = m.pd(im.f), best = g.reduce((a, b) => b[1] > a[1] ? b : a), worst = g.reduce((a, b) => b[1] < a[1] ? b : a), gain = best[1] - worst[1]; if (gain < 0.3) continue;
    if (im.f === 'Stbd tack') out.push(`Tack asymmetry: the model expects ${f1(Math.abs(g[g.length - 1][1] - g[0][1]))} points ${g[g.length - 1][1] > g[0][1] ? 'better' : 'worse'} ${m.target} on starboard than on port in the same conditions. Check the Calibration tab before blaming the trimmers.`);
    else if (im.f === 'TWS') out.push(`Wind speed: ${m.target} is best around ${f1(best[0])} kn and weakest around ${f1(worst[0])} kn (${f1(gain)} points apart). That gap usually means the targets are too hard or too easy in part of the range.`);
    else out.push(`${im.f}: best ${m.target} around ${f1(best[0], 1)}, weakest around ${f1(worst[0], 1)} (${f1(gain)} points apart, other inputs held as sailed).`); }
  return out;
}
function blkML(c, mode, compact) {
  const m = mlModel(mode); if (m.err) { c.append(h('p', { class: 'muted' }, m.err)); return m; }
  const q = m.cvR2 > 0.5 ? 'strong' : m.cvR2 > 0.25 ? 'moderate' : m.cvR2 > 0.08 ? 'weak' : 'not reliable';
  c.append(h('p', {}, h('b', { class: 'verdict ' + (m.cvR2 > 0.25 ? 'good' : m.cvR2 > 0.08 ? 'warn' : 'bad') }, `Model quality: ${q}. `), `It explains ${Math.max(0, m.cvR2 * 100).toFixed(0)}% of the variation in ${m.target} on phases it was not trained on (${m.n} ${mode.toLowerCase()} phases, 4 time-blocked folds). ` + (m.cvR2 <= 0.08 ? 'Treat the charts below as noise until there is more data.' : m.n < 150 ? 'With this few phases, read the findings as hints to test, not conclusions.' : '')));
  const ins = mlInsights(m); if (ins.length) c.append(h('ul', { class: 'insight' }, ins.map(t => h('li', {}, t))));
  const cv = h('canvas'), top = m.imp.slice(0, 8), g = h('div', { class: 'grid2' }); c.append(h('h4', {}, 'What drives ' + m.target), h('div', { style: 'max-width:560px' }, cv));
  const p = plot(cv, { xr: [0, Math.max(0.05, top[0].v) * 1.15], yr: [0, top.length], h: 26 * top.length + 40, pl: 96, xl: 'share of model importance', xfmt: v => (v * 100).toFixed(0) + '%' }); const x = p.c;
  x.fillStyle = css('--surface'); x.fillRect(0, 0, p.pl - 1, p.H - p.pb);
  top.forEach((im, i) => { const y = p.Y(top.length - i) + 5, hh = p.Y(top.length - i - 1) - y - 5; x.fillStyle = COND[im.f] ? css('--muted') : css('--s1'); x.beginPath(); x.roundRect(p.pl, y, Math.max(1, p.X(im.v) - p.pl), hh, [0, 4, 4, 0]); x.fill(); x.fillStyle = css('--ink'); x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(im.f, p.pl - 6, y + hh / 2); x.textAlign = 'left'; x.fillText((im.v * 100).toFixed(0) + '%', p.X(im.v) + 5, y + hh / 2); cv._hits.push([p.X(im.v), y + hh / 2, `${im.f}: ${(im.v * 100).toFixed(0)}% of importance`]); });
  c.append(h('p', { class: 'muted' }, 'Importance = how much the prediction error grows when that channel is shuffled. Grey bars are conditions you cannot trim.'));
  if (compact) return m;
  c.append(h('h4', {}, 'Effect of each input on ' + m.target), g); const jobs = [];
  for (const im of m.imp.slice(0, 4)) { const pd = m.pd(im.f), cv2 = h('canvas'); g.append(h('div', {}, cv2)); jobs.push(() => { const ys = pd.map(d => d[1]), lo = Math.min(...ys), hi = Math.max(...ys), sp = Math.max(1, hi - lo); const p2 = plot(cv2, { xr: [pd[0][0], pd[pd.length - 1][0]], yr: [lo - sp * 0.25, hi + sp * 0.25], xl: im.f, yl: 'expected ' + m.target, h: 200, title: im.f }); p2.line(pd, css('--s1'), 2); const b = pd.reduce((a, d) => d[1] > a[1] ? d : a); p2.dot(b[0], b[1], css('--s1'), `best around ${f1(b[0], 1)}: ${f1(b[1])}`, null, false, 5); pd.forEach(d => cv2._hits.push([p2.X(d[0]), p2.Y(d[1]), `${im.f} ${f1(d[0], 2)} → ${m.target} ${f1(d[1])}`])); }); }
  jobs.forEach(j => j());
  return m;
}
function allMans() { if (!season()) return A.D.mans.map(m => ({ ...m, t: iT(m.i), lab: tstr(iT(m.i)) })); const out = []; for (const d of A.S.days) { if (A.sOff.has(d.id) || (A.filt.day && d.date !== A.filt.day)) continue; for (const m of d.mans || []) out.push({ ...m, i: null, lab: d.date + ' ' + new Date(m.t + (d.off || 0) * 36e5).toISOString().slice(11, 19) }); } return out; }
R.ml = () => {
  const c = pane('ml'), st = A.mst = A.mst || { mode: 'Upwind' }, go = p => p.i != null ? { class: 'click', onclick: () => { A.cur = p.i; show('chart'); } } : {};
  const b1 = h('div'), s1 = card(['Performance drivers ', mlTag()], bar(field('Mode', sel('ml-mode', ['Upwind', 'Downwind', 'Reaching'], st.mode, v => { st.mode = v; R.ml(); })), filterBar(() => R.ml())), h('p', { class: 'muted' }, `A gradient-boosted tree model, trained here in the browser on ${season() ? 'the season\'s' : 'this day\'s'} phases, predicts VMG% (BSPpol% when reaching) from the conditions and the trim channels in the log.`), b1);
  c.append(s1); const m = blkML(b1, st.mode);
  if (!m.err) c.append(card(['Slow phases the conditions do not explain (' + m.anomalies.length + ') ', mlTag()], h('p', { class: 'muted' }, `Phases where ${m.target} was far below what the model expected for that wind, angle and trim: bad air, weed, a wave set, or a mode problem.` + (season() ? '' : ' Click to see where it happened.')), m.anomalies.length ? table(['Time', 'Leg', 'Sails', 'TWS', 'TWA', 'Actual', 'Expected', 'Gap'], m.anomalies.slice(0, 15).map(a => { const r = [ptime(a.p), a.p.raceLeg, a.p.sails, f1(a.p.v.TWS), f1(a.p.v.absTWA), f1(a.actual), f1(a.expected), { t: f1(a.actual - a.expected), c: 'b' }]; r._attrs = go(a.p); return r; }), 'num') : h('p', {}, 'None found.')));
  const up = st.mode !== 'Downwind' ? 'Upwind' : 'Downwind', cl = SL.modeClusters(phases(), up), s3 = card(['Sailing modes (' + up.toLowerCase() + ') ', mlTag()]); c.append(s3);
  if (cl) { const cols = [css('--s1'), css('--s2'), css('--s3')], names = cl.cl.map(x => x.name); s3.append(h('p', { class: 'muted' }, 'Phases grouped by k-means on angle and speed relative to target. Compare VMG% between the groups to see which mode pays.'), legend(cl.cl.map((x, i) => [cols[i], x.name])));
    const cv = h('canvas'); s3.append(h('div', { style: 'max-width:760px' }, cv)); const xs = cl.ps.map(p => p.v['ΔTWA']), ys = cl.ps.map(p => p.v['BSP_trg%']); const p = plot(cv, { xr: [SL.quant(xs, 0.01) - 1, SL.quant(xs, 0.99) + 1], yr: [SL.quant(ys, 0.01) - 2, SL.quant(ys, 0.99) + 2], xl: 'ΔTWA to target (°)  ·  ' + (up === 'Upwind' ? 'left = higher, right = lower' : 'left = hotter, right = deeper'), yl: 'BSP_trg%', h: 300 }); p.zero(100);
    cl.ps.forEach((ph, i) => { const k = cl.cl.findIndex(x => x.c === cl.lab[i]); p.dot(ph.v['ΔTWA'], ph.v['BSP_trg%'], cols[k], ptip(ph, names[k] + ' · VMG% ' + f1(ph.v['VMG%'])), ph, ph.tack === 'Stbd', 3); });
    const best = cl.cl.reduce((a, b) => b.vmgPct > a.vmgPct ? b : a); s3.append(table(['Mode', 'Phases', 'ΔTWA', 'BSP_trg%', 'VMG%', '|Heel|', 'TWS'], cl.cl.map(x => [{ t: x.name, c: 'b' }, x.n, f1(x.dTwa), f1(x.bspTrg), { t: f1(x.vmgPct), c: x === best ? 'b hl' : '' }, f1(x.heel), f1(x.tws)]), 'num'), h('p', { class: 'insight' }, `${best.name} gave the best VMG% (${f1(best.vmgPct)}) on ${best.n} phases.`)); }
  else s3.append(h('p', { class: 'muted' }, 'Needs at least 30 phases with targets.'));
  const lt = SL.learnTargets(phases()), s4 = card('Targets learned from your best sailing');
  if (lt.length) s4.append(h('p', { class: 'muted' }, 'For each wind band: the median angle and speed of the top quarter of phases by VMG, next to the current target.'), table(['Mode', 'TWS', 'Phases', 'Best TWA', 'Target TWA', 'Δ', 'Best BSP', 'Target BSP', 'Δ', '|Heel|'], lt.map(r => [r.mode, { t: r.tws, c: 'b' }, r.n, f1(r.twa), f1(r.tTwa), { t: f1(r.twa - r.tTwa), c: 'b' }, f1(r.bsp, 2), f1(r.tBsp, 2), { t: f1(r.bsp - r.tBsp, 2), c: 'b' }, f1(r.heel)]), 'num'), bar(h('button', { onclick: () => dl('learned_polar.txt', SL.polarText(SL.learnPolar(phases(), 0.7))) }, 'Export learned polar (Expedition format)')), h('p', { class: 'muted' }, season() ? 'Based on every day in the season database that matches the filters.' : 'One day is thin evidence for changing a polar. Add days to the season database and look again in Season mode.'));
  else s4.append(h('p', { class: 'muted' }, 'Needs at least 10 upwind or downwind phases in a 2-knot wind band.'));
  c.append(s4);
  if (!season()) { const gl = SL.glitches(A.D).filter(x => x.n); c.append(card('Sensor spikes', gl.length ? table(['Channel', 'Single-sample spikes'], gl.map(x => [x.k, x.n]), 'num') : h('p', {}, 'No single-sample spikes found in BSP, wind, heading, heel or rudder.'))); }
  c.append(h('p', { class: 'muted' }, 'Manoeuvre losses and wind shifts have their own tabs: Manoeuvres and Wind.'));
};

/* ---------------- Season database ---------------- */
const idb = SL.createStore(indexedDB);
async function writeLinked(handle, text) {
  if (!handle) return false;
  const writer = await handle.createWritable();
  try { await writer.write(text); await writer.close(); return true; }
  catch (error) { try { await writer.abort(); } catch (_) {} throw error; }
}
const persistSeason = SL.serialWriter(async job => {
  let browserOK = false, fileOK = false, failure = '';
  try { browserOK = await idb.set('season', job.snapshot); } catch (error) { failure = 'Browser save failed: ' + error.message; }
  if (job.handle) { try { fileOK = await writeLinked(job.handle, job.text); } catch (error) { failure += (failure ? ' ' : '') + 'File save failed: ' + error.message; } }
  if (job.rev !== A.sRev) return;
  A.sDirty = job.handle ? !fileOK : !browserOK;
  A.sSaved = [browserOK ? 'Saved in this browser.' : '', fileOK ? 'Saved to ' + job.handle.name + '.' : '', failure, !job.handle && browserOK ? 'Export a season file for a separate backup.' : ''].filter(Boolean).join(' ');
  const element = $('#s-saved'); if (element) element.textContent = A.sSaved;
  if (failure) banner(A.sSaved, true);
});
function saveSeasonSnapshot() {
  const text = JSON.stringify(A.S), rev = A.sRev = (A.sRev || 0) + 1;
  A.sDirty = true; A.sSaved = 'Saving...';
  return persistSeason({ rev, text, snapshot: JSON.parse(text), handle: A.fh });
}
function seasonChanged(save) {
  A.sOff = A.sOff || new Set(); A.SP = SL.seasonPool({ days: A.S.days.filter(d => !A.sOff.has(d.id)) }); A.SK = new Set(); A.S.days.forEach(d => { if (!A.sOff.has(d.id)) d.keys.forEach(k => A.SK.add(k)); }); if (A.SK.has('AWA')) A.SK.add('absAWA'); A.ml = {}; A.dayCal = new Map();
  if (save !== false) saveSeasonSnapshot();
}
function seasonImport(text, name) {
  let days, importedName; if (/^\s*\{/.test(text.replace(/^\uFEFF/, ''))) { const o = JSON.parse(text.replace(/^\uFEFF/, '')); if (o.app !== 'SailLens' || !Array.isArray(o.days) || (o.version != null && ![1, 2].includes(o.version))) throw new Error('Unsupported SailLens season file.'); days = o.days; importedName = o.name; } else days = SL.seasonFromPhaseCsv(text);
  const r = SL.seasonMerge(A.S, days); if (importedName && (!A.S.days.length || A.S.name === 'Season')) A.S.name = importedName; seasonChanged(); banner(`${name}: ${r.add} session(s) added, ${r.same} identical session(s) skipped. The season now has ${A.S.days.length} sessions and ${A.S.days.reduce((s, d) => s + d.phases.length, 0)} phases.${days.some(d => d.unknownModes) ? " Missing sailing modes are labelled Unknown and excluded from upwind/downwind models." : ""}`);
}
function addDay() {
  if (!A.D) return; if (A.demo) { banner('This is the example data. Load your own log first.', true); return; }
  const r = withScope('day', () => calAll(A.D.phases, A.D.magVar)), w = r.wind.err ? [] : r.wind.bins;
  const rec = SL.dayRecord(A.D, meta(), { polar: A.files.polar || (A.D.polarSrc === 'log' ? 'Expedition targets' : A.D.polarSrc), files: A.files, calibration: A.calib, events: A.events, cal: { score: r.score, k: r.bsp.err ? null : r.bsp.k, delta: r.bsp.err ? null : r.bsp.delta, awa: r.awa.err ? null : r.awa.read } });
  try { const res = SL.seasonMerge(A.S, [rec]); seasonChanged(); banner(`${rec.date}: ${res.same ? 'identical session already saved' : 'session added'} (${rec.phases.length} phases, ${rec.mans.length} manoeuvres).`); } catch (error) { banner(error.message, true); }
}
async function openSeasonFile() { if (window.showOpenFilePicker) { try { const [fh] = await window.showOpenFilePicker({ types: [{ description: 'SailLens season or RaceReplay phase export', accept: { 'application/json': ['.json'], 'text/csv': ['.csv'] } }] }); const f = await fh.getFile(), t = await f.text(); seasonImport(t, f.name); show('season'); } catch (e) { if (e.name !== 'AbortError') banner(e.message, true); } } else $('#s-file').click(); }
async function saveSeasonFile() { const name = (A.S.name || 'season').replace(/[^\w-]+/g, '_') + '.saillens.json'; if (window.showSaveFilePicker) { try { A.fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'SailLens season', accept: { 'application/json': ['.json'] } }] }); await saveSeasonSnapshot(); show('season'); } catch (e) { if (e.name !== 'AbortError') banner(e.message, true); } } else dl(name, JSON.stringify(A.S)); }
function dayCal(d) { A.dayCal = A.dayCal || new Map(); if (!A.dayCal.has(d.id)) A.dayCal.set(d.id, calAll(SL.seasonPool({ days: [d] }), d.magVar || 0)); return A.dayCal.get(d.id); }
R.season = () => {
  const c = pane('season'), S = A.S, st = A.sst = A.sst || { binVar: 'BSPpol%', xmode: 'Upwind', clear: false }, on = S.days.filter(d => !A.sOff.has(d.id)), nPh = on.reduce((s, d) => s + d.phases.length, 0);
  const fin0 = h('input', { type: 'file', id: 's-file', hidden: '', accept: '.json,.csv', onchange: async e => { const f = e.target.files[0]; if (f) { try { seasonImport(await f.text(), f.name); } catch (x) { banner(x.message, true); } show('season'); } } });
  c.append(h('div', { class: 'kpis' }, kpi('Sessions', on.length, '', S.days.length !== on.length ? S.days.length + ' in file' : (S.days.length ? S.days[0].date + ' → ' + S.days[S.days.length - 1].date : 'empty')), kpi('Phases', nPh.toLocaleString()), kpi('Upwind VMG%', f1(SL.mean(A.SP.filter(p => p.mode === 'Upwind').map(p => p.v['VMG%']))), '%'), kpi('Downwind VMG%', f1(SL.mean(A.SP.filter(p => p.mode === 'Downwind').map(p => p.v['VMG%']))), '%'), kpi('Manoeuvres', on.reduce((s, d) => s + (d.mans || []).length, 0))));
  c.append(card('Season database',
    h('div', { class: 'bar' }, field('Season name', h('input', { type: 'text', id: 's-name', value: S.name, style: 'width:220px', onchange: e => { S.name = e.target.value; seasonChanged(); } })),
      h('button', { class: 'primary', disabled: !A.D || A.demo ? '' : null, onclick: () => { addDay(); show('season'); } }, A.D && !A.demo ? `Add ${dstr(A.D.sum.t0).slice(0, 10)} to the season` : 'Add current day'), h('button', { onclick: openSeasonFile }, 'Open season file or RaceReplay export…'), h('button', { onclick: saveSeasonFile }, A.fh ? 'Save to another file…' : 'Save season file…'), fin0,
      h('button', { class: 'danger', onclick: () => { if (!st.clear) { st.clear = true; show('season'); return; } st.clear = false; A.S = SL.newSeason(); A.fh = null; seasonChanged(); show('season'); } }, st.clear ? 'Click again to empty the season' : 'Empty season')),
    h('p', { class: 'muted', id: 's-saved' }, A.sSaved || ''),
    h('p', { class: 'muted' }, 'Each session you add stores its processing settings and phases (with sails, race legs and about 40 channels), its tacks and gybes and its calibration figures. The season is kept in this browser and, once you save a season file, written back to that file after every change. Raw log files are not stored here: keep the originals to reprocess a session. Imports never replace an existing session with different data. To bring in history from RaceReplay, export the T_Phase table from the Access database as a CSV text file and open it here.')));
  if (!S.days.length) { c.append(card(null, h('p', { class: 'muted' }, 'The season is empty. Process a day and press “Add current day”, or open a season file.'))); return; }
  // days
  c.append(card('Sessions', table(['Use', 'Date', 'Boat', 'Start', 'Description', 'Location', 'Phases', 'TWS', 'Sails', 'Polar', 'Source', ''], S.days.map(d => [h('input', { type: 'checkbox', 'aria-label': 'Use ' + d.date, checked: A.sOff.has(d.id) ? null : '', onchange: e => { e.target.checked ? A.sOff.delete(d.id) : A.sOff.add(d.id); seasonChanged(false); show('season'); } }), { t: d.date, c: 'b' }, d.boat || 'Boat', Number.isFinite(d.start) ? new Date(d.start + (d.off || 0) * 36e5).toISOString().slice(11, 19) : '-', d.desc || '', d.location || '', d.phases.length, d.sum && fin(d.sum.tws) ? `${f1(d.sum.twsMin, 0)}–${f1(d.sum.twsMax, 0)} kn` : '', (d.sum && d.sum.sails || []).join(', '), d.polar || '', d.src || 'SailLens', h('button', { class: 'mini danger', onclick: () => { S.days.splice(S.days.indexOf(d), 1); seasonChanged(); show('season'); } }, 'Remove')]), 'num')));
  if (!on.length) return;
  withScope('season', () => {
    // trend
    const s2 = card('Day-by-day trend'), cv = h('canvas'); c.append(s2); s2.append(legend([[css('--s1'), 'Upwind VMG%'], [css('--s2'), 'Downwind VMG%']]), h('div', {}, cv));
    const per = on.map(d => { const ps = A.SP.filter(p => p.sessionId === d.id), m = (md, k) => SL.mean(ps.filter(p => p.mode === md).map(p => p.v[k])), tk = (d.mans || []).filter(x => x.type === 'Tack' && fin(x.loss)), gy = (d.mans || []).filter(x => x.type === 'Gybe' && fin(x.loss)); return { d, up: m('Upwind', 'VMG%'), dn: m('Downwind', 'VMG%'), nUp: ps.filter(p => p.mode === 'Upwind').length, nDn: ps.filter(p => p.mode === 'Downwind').length, tack: SL.median(tk.map(x => x.loss)), gybe: SL.median(gy.map(x => x.loss)), nT: tk.length, nG: gy.length }; });
    const vals = per.flatMap(x => [x.up, x.dn]).filter(fin), p = plot(cv, { xr: [-0.5, per.length - 0.5], yr: [Math.min(92, ...vals) - 1, Math.max(102, ...vals) + 1], h: 250, yl: 'mean VMG%', ysuf: '%', xfmt: v => Number.isInteger(v) && per[v] ? per[v].d.date.slice(5) : '' }); p.zero(100);
    for (const [k, col, nk] of [['up', css('--s1'), 'nUp'], ['dn', css('--s2'), 'nDn']]) { p.line(per.map((x, i) => [i, x[k]]), col, 2); per.forEach((x, i) => p.dot(i, x[k], col, `<b>${x.d.date}</b> ${x.d.desc || ''}<br>${k === 'up' ? 'Upwind' : 'Downwind'} VMG% ${f1(x[k])} on ${x[nk]} phases`, null, false, 5)); }
    s2.append(h('h4', {}, 'Calibration and manoeuvres per day'), table(['Day', 'Cal score', 'BSP factor', 'Heading °', 'Masthead °', 'TWA up °', 'TWA down °', 'TWS dn %', 'Tack loss m', 'Gybe loss m'], per.map(x => { const r = dayCal(x.d), wb = m => r.wind.err ? NaN : SL.mean(r.wind.bins.filter(b => b.mode === m).map(b => b.e)), sc = scale('ΔTWD', [3]); return [{ t: x.d.date, c: 'b' }, { t: f1(r.score, 0), c: 'b verdict ' + (!fin(r.score) ? '' : r.score >= 85 ? 'good' : r.score >= 65 ? 'warn' : 'bad') }, r.bsp.err ? '–' : r.bsp.k.toFixed(3), r.bsp.err ? '–' : { t: f1(r.bsp.delta), s: heat(r.bsp.delta, sc) }, r.awa.err ? '–' : { t: f1(r.awa.read), s: heat(r.awa.read * 2, sc) }, { t: f1(wb('Upwind')), s: heat(wb('Upwind'), sc) }, { t: f1(wb('Downwind')), s: heat(wb('Downwind'), sc) }, r.wind.err || !r.wind.twsDn ? '–' : f1(r.wind.twsDn.pct), x.nT ? f1(x.tack, 0) + ' (' + x.nT + ')' : '–', x.nG ? f1(x.gybe, 0) + ' (' + x.nG + ')' : '–']; }), 'num'),
      h('p', { class: 'muted' }, 'A calibration figure that sits at the same value day after day is an instrument offset; one that moves around is wind shear, current or noise. For the pooled season estimate, open Calibration in Season mode.'));
    // crossover
    const s3 = card(['Sail crossover ', mlTag()], bar(field('Mode', sel('x-mode', ['Upwind', 'Downwind', 'Reaching'], st.xmode, v => { st.xmode = v; R.season(); }))));
    c.append(s3); const yk = st.xmode === 'Reaching' ? 'BSPpol%' : 'VMG%', co = SL.crossover(A.SP, st.xmode, yk);
    if (co.curves.length) { const cv2 = h('canvas'), ci = catInfo('Sails'), colOf = s => ci.all.includes(s) ? ci.col(s) : css('--muted'); s3.append(h('p', { class: 'muted' }, `${yk} against wind speed for each sail combination with at least 12 phases, with a local-regression trend. Where two trends cross is the crossover the data supports.`), legend(co.curves.map(x => [colOf(x.sail), `${x.sail} (${x.n})`])), h('div', {}, cv2));
      const ys = co.ps.map(q => q.v[yk]), xs = co.ps.map(q => q.v.TWS), p2 = plot(cv2, { xr: [SL.quant(xs, 0.005) - 0.5, SL.quant(xs, 0.995) + 0.5], yr: [SL.quant(ys, 0.02) - 1, SL.quant(ys, 0.98) + 1], h: 320, xl: 'TWS (kn)', yl: yk, ysuf: '%' }); p2.zero(100);
      co.ps.forEach(q => { if (co.curves.some(x => x.sail === q.sails)) p2.dot(q.v.TWS, q.v[yk], alpha(colOf(q.sails), 0.55), ptip(q, yk + ' ' + f1(q.v[yk])), q, q.tack === 'Stbd', 2.5); });
      co.curves.forEach(x => { p2.line(x.pts.filter(q => q[0] >= x.lo && q[0] <= x.hi), colOf(x.sail), 2.5); const mid = x.pts[Math.floor(x.pts.length / 2)]; if (mid) p2.label(x.sail, mid[0], mid[1], colOf(x.sail), 'center'); });
      for (const x of co.cross) { const X = p2.X(x.tws); p2.c.strokeStyle = css('--ink'); p2.c.setLineDash([5, 4]); p2.c.beginPath(); p2.c.moveTo(X, p2.pt); p2.c.lineTo(X, p2.H - p2.pb); p2.c.stroke(); p2.c.setLineDash([]); }
      s3.append(co.cross.length ? h('ul', { class: 'insight' }, co.cross.map(x => h('li', {}, `${x.below} is better below about ${f1(x.tws)} kn, ${x.above} above it.`))) : h('p', { class: 'muted' }, co.curves.length > 1 ? 'No clear crossover inside the wind range the sails share: one sail is ahead throughout, or the difference is within noise.' : 'Only one sail combination has enough phases in this mode.')); }
    else s3.append(h('p', { class: 'muted' }, 'Needs at least 12 phases per sail combination. Sails come from the SailsUp events.'));
    const s4 = card('Season bin report'), b4 = h('div'), rb = () => withScope('season', () => { b4.textContent = ''; blkBins(b4, st.binVar); });
    s4.append(bar(filterBar(() => R.season()), field('Average of', sel('s-bin-var', varList(), st.binVar, v => { st.binVar = v; rb(); }))), b4); c.append(s4); rb();
  });
};

/* ---------------- Report ---------------- */
R.report = () => withScope('day', () => {
  const c = pane('report'), D = A.D, m = meta(), st = A.rst = A.rst || { notes: {} }, W = 760;
  const note = k => h('textarea', { class: 'note', id: 'note-' + k, placeholder: 'Notes…', rows: 2, oninput: e => { st.notes[k] = e.target.value; e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; } }, st.notes[k] || '');
  const page = h('div', { class: 'report', style: 'width:' + W + 'px' });
  const sec = (title, k, fill) => { const s = h('section', { class: 'rsec' }, h('h2', {}, title)); page.append(s); fill(s); s.append(note(k)); };
  c.append(bar(h('button', { class: 'primary', onclick: () => window.print() }, 'Print / save as PDF'), h('span', { class: 'muted' }, 'Uses the filters and settings from the other tabs. Type notes under each section before printing.')), h('div', { class: 'scroll' }, page));
  page.append(h('header', {}, h('h1', { contenteditable: 'true' }, 'Performance Report'), h('p', { contenteditable: 'true' }, [m.boat, dstr(D.sum.t0).slice(0, 10), m.desc, m.daytype].filter(Boolean).join(' · '))));
  sec('Day summary', 'sum', s => blkSummary(s));
  sec('Bin report', 'bin', s => blkBins(s, 'BSPpol%'));
  sec('Race track: BSPpol%', 'map', s => { const cv = h('canvas'); s.append(cv); drawMap(cv, { v: 'BSPpol%', w: W, h: 470, barbs: true }); });
  if (D.ch.TWD) sec('Race track: TWD', 'map2', s => { const cv = h('canvas'); s.append(cv); drawMap(cv, { v: 'TWD', w: W, h: 470 }); });
  sec('Leg averages', 'legs', s => blkLegs(s));
  for (const md of ['Upwind', 'Downwind']) { if (D.phases.filter(p => p.mode === md).length < 5) continue;
    sec(md + ' distribution', 'dist' + md, s => blkDist(s, md));
    sec(md + ' performance', 'perf' + md, s => blkPerf(s, md, 'Tack'));
    sec(md + ' XY graphs', 'xy' + md, s => { for (const x of ['abs_heel', 'absTWA', 'Rudder_norm']) if (D.ch[x]) blkXY(s, { x, y: 'VMG%', mode: md, by: 'Tack', h: 260, title: `VMG% vs ${x} (${md.toLowerCase()})` }); }); }
  if (!SL.chartEmpty(A.chart)) sec('Sail chart', 'sails', s => { const st = SL.chartStats(A.chart, D.phases.filter(p => SL.sailTokens(p.sails).length)), tot = st.on + st.off; s.append(h('p', {}, tot ? `${f1(st.on / tot * 100, 0)}% of the ${tot} phases on the chart were sailed with sails the chart allows there (${A.chart.name || 'sail chart'}).` : 'No phases fell in charted cells.')); if (st.rows.length) s.append(table(['TWS', 'TWA', 'Chart allows', 'Sails used', 'Phases', 'Used %', 'To chart %'], st.rows.slice(0, 12).map(r => [r.tws + ' kn', r.twa + '°', r.chart, r.used, r.n, f1(r.perf), f1(r.perfChart)]), 'num')); });
  sec('Calibration', 'cal', s => { if (D.calibrated) s.append(h('p', { class: 'b' }, 'Calibration file applied: ' + (A.calib.name || 'unnamed') + '.')); blkCalModel(s, calAll(phases(), D.magVar), { compact: true, logMagVar: D.logMagVar, mv: D.magVar }); blkCal(s, (A.cal && A.cal.off) || 0); });
  sec('Model findings (upwind)', 'ml', s => blkML(s, 'Upwind', true));
});

/* ---------------- boot ---------------- */
async function boot() {
  initTips();
  const nav = $('#nav'), panes = $('#panes');
  for (const [g, items] of TABS) { if (g) nav.append(h('h6', {}, g)); for (const [id, lab, d] of items) { const b = h('button', { class: 'nav', type: 'button', 'data-tab': id, onclick: () => show(id) }); b.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`; b.append(lab); nav.append(b); panes.append(h('div', { id: 't-' + id, class: 'tabpane', hidden: '' })); } }
  document.querySelectorAll('#scope button').forEach(b => b.addEventListener('click', () => { A.scope = b.dataset.scope; show(A.tab); }));
  const themes = ['auto', 'light', 'dark']; let th = 'auto'; try { th = localStorage.getItem('saillens-theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  const setTheme = () => { if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th); $('#theme').textContent = 'Theme: ' + th; };
  setTheme(); $('#theme').addEventListener('click', () => { th = themes[(themes.indexOf(th) + 1) % 3]; try { localStorage.setItem('saillens-theme', th); } catch (e) { /* ignore */ } setTheme(); show(A.tab); });
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
  window.addEventListener('drop', async e => { e.preventDefault(); document.body.classList.remove('drop'); for (const f of e.dataTransfer.files) await loadFile(f); });
  window.addEventListener('beforeunload', e => { if (A.evDirty || A.sDirty) { e.preventDefault(); e.returnValue = ''; } });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (A.tab !== 'setup' && A.tab !== 'report' && A.tab !== 'events') show(A.tab); }, 200); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => show(A.tab));
  A.chart = store.get('saillens-chart'); if (!A.chart || A.chart.type !== 'sailchart') A.chart = SL.newChart(); A.chart.shapes = A.chart.shapes || []; A.chart.cells = A.chart.cells || {};
  A.S = SL.newSeason(); A.sOff = new Set(); try { const saved = await idb.get('season'); if (saved) { if (saved.app !== 'SailLens' || !Array.isArray(saved.days) || (saved.version != null && ![1, 2].includes(saved.version))) throw new Error('Unsupported season format'); SL.seasonMerge(A.S, saved.days); A.S.name = saved.name || 'Season'; A.sSaved = 'Loaded from this browser.'; } } catch (error) { A.sSaved = 'Could not restore browser data: ' + error.message; } seasonChanged(false);
  loadDemo(); show('home');
}
document.addEventListener('DOMContentLoaded', boot);
