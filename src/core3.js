'use strict';
/* SailLens core, part 3: time lost against target, favoured tack, starts, manoeuvre traces, wind statistics. No DOM access. */
(() => {
const { D2R, R2D, fin, w180, w360, mean, sd, cmean, quant, median, MODES } = SL;

/* spans to report on: race legs when the event file has them, otherwise the automatic legs */
function legSpans(D) {
  const out = [], L = D.L;
  if (D.phases.some(p => p.race)) { let s = -1, key = ''; for (let i = D.i0; i <= D.i1; i++) { const k = i < D.i1 && L.race[i] ? 'R' + L.race[i] + 'L' + L.leg[i] : ''; if (k !== key) { if (key) out.push({ name: key, i0: s, i1: i }); s = i; key = k; } } }
  else for (const l of D.legs) out.push({ name: l.name, i0: l.i0, i1: l.i1 });
  return out;
}
/* seconds given away against the target: each second sailed at x% of target VMG (or polar speed when reaching) costs (1 - x) seconds.
   Split into steady sailing and the 45 s around each tack or gybe. Also: how much of each leg was sailed on the favoured board. */
function timeLost(D) {
  const vp = D.ch['VMG%'], bsp = D.ch.BSP, inMan = new Uint8Array(D.n); for (const m of D.mans) for (let k = Math.max(D.i0, m.i - 20); k < Math.min(D.i1, m.i + 16); k++) inMan[k] = 1;
  const legs = legSpans(D).map(s => {
    let steady = 0, man = 0, n = 0, nUp = 0, nDn = 0; const tw = D.ch.TWD ? cmean(D.ch.TWD.subarray(s.i0, s.i1)) : NaN; let fav = 0, favN = 0;
    for (let i = s.i0; i < s.i1; i++) { if (!(bsp[i] > 1) || !fin(vp[i])) continue; const l = 1 - Math.max(0, Math.min(130, vp[i])) / 100; n++; if (inMan[i]) man += l; else steady += l; const md = D.mode[i]; if (md === 0) nUp++; else if (md === 3) nDn++;
      if (fin(tw) && (md === 0 || md === 3) && !inMan[i]) { const d = w180(D.ch.TWD[i] - tw); if (Math.abs(d) >= 2) { const lifted = D.tack[i] > 0 ? d > 0 : d < 0; favN++; if (md === 0 ? lifted : !lifted) fav++; } } }
    const mode = nUp > n * 0.5 ? 'Upwind' : nDn > n * 0.5 ? 'Downwind' : 'Reaching';
    return { name: s.name, i0: s.i0, i1: s.i1, mode, dur: s.i1 - s.i0, sailed: n, steady, man, total: steady + man, tacks: D.mans.filter(m => m.i >= s.i0 && m.i < s.i1).length, fav: favN > 60 && mode !== 'Reaching' ? fav / favN * 100 : NaN };
  }).filter(l => l.sailed > 60);
  return { legs, steady: legs.reduce((a, l) => a + l.steady, 0), man: legs.reduce((a, l) => a + l.man, 0), total: legs.reduce((a, l) => a + l.total, 0), sailed: legs.reduce((a, l) => a + l.sailed, 0) };
}
/* what happened at each start gun */
function starts(D) {
  const out = [], bt = D.ch['BSP_trg%'], bp = D.ch['BSPpol%'];
  for (const e of D.L.list) { if (e.type !== 'RaceStartGun' || e.i < D.i0 + 5 || e.i >= D.i1 - 60) continue; const i = e.i, pct = k => (Math.abs(D.ch.TWA[k]) < 70 && fin(bt[k])) ? bt[k] : bp[k], at = mean([pct(i - 1), pct(i), pct(i + 1)]);
    let t95 = NaN; for (let k = i; k < Math.min(D.i1 - 5, i + 180); k++) { let ok = true; for (let j = 0; j < 5; j++) if (!(pct(k + j) >= 95)) { ok = false; break; } if (ok) { t95 = k - i; break; } }
    let d60 = 0; if (D.ch.SOG) for (let k = i; k < i + 60; k++) if (fin(D.ch.SOG[k])) d60 += D.ch.SOG[k] * 0.5144;
    const m = (e.comments || '').match(/(-?[\d.]+)\s*below line/i);
    out.push({ i, race: e.attr, bsp: mean(D.ch.BSP.subarray(i - 1, i + 2)), pct: at, twa: mean(D.ch.TWA.subarray(i - 1, i + 2)), tws: mean(D.ch.TWS.subarray(i - 5, i + 5)), t95, d60, below: m ? +m[1] : NaN, note: e.comments || '', pre: mean(Array.from({ length: 20 }, (v, j) => pct(i - 20 + j))), post: mean(Array.from({ length: 30 }, (v, j) => pct(i + j))) }); }
  return out;
}
/* each tack or gybe as a trace from 20 s before to 60 s after: BSP relative to the speed going in, and VMG along the wind axis relative to steady VMG */
function manTraces(D) {
  const ch = D.ch, out = [];
  for (const m of D.mans) { const i = m.i; if (i - 30 < D.i0 || i + 70 > D.i1 || !(m.bspIn > 2)) continue; const bsp = [], vmg = []; let v = null;
    if (fin(m.loss) && fin(m.vb)) { const s = m.type === 'Tack' ? 1 : -1; v = k => s * ch.BSP[k] * Math.cos((ch.HDG[k] - (k < i ? m.twB : m.twA)) * D2R) / (k < i ? m.vb : m.va) * 100; }
    for (let k = i - 20; k <= i + 60; k++) { bsp.push(ch.BSP[k] / m.bspIn * 100); vmg.push(v ? v(k) : NaN); }
    out.push({ m, bsp, vmg }); }
  return out;
}
/* the day's wind: trend, oscillation, gustiness */
function windStats(D) {
  const tw = D.ch.TWD, ws = D.ch.TWS; if (!tw) return null; const st = 10, t = [], d = [], s = [], m0 = cmean(tw.subarray(D.i0, D.i1));
  for (let i = D.i0 + 30; i < D.i1 - 30; i += st) { if (!(D.ch.BSP[i] > 1)) continue; const a = cmean(tw.subarray(i - 30, i + 30)); if (!fin(a)) continue; t.push(i); d.push(w180(a - m0)); s.push(mean(ws.subarray(i - 30, i + 30))); }
  if (t.length < 30) return null;
  // linear trend in degrees per hour
  const mt = mean(t), md = mean(d); let sxx = 0, sxy = 0; for (let k = 0; k < t.length; k++) { sxx += (t[k] - mt) ** 2; sxy += (t[k] - mt) * (d[k] - md); } const slope = sxx ? sxy / sxx * 3600 : 0;
  // oscillation: detrend with a 20-minute running mean, then the first clear peak of the autocorrelation
  const W = Math.round(600 / st), det = d.map((v, k) => v - mean(d.slice(Math.max(0, k - W), Math.min(d.length, k + W + 1)))), v0 = mean(det.map(x => x * x)); let per = NaN, best = 0.2;
  if (v0 > 0) { const ac = lag => { let a = 0, n = 0; for (let k = 0; k + lag < det.length; k++) { a += det[k] * det[k + lag]; n++; } return n ? a / n / v0 : 0; }; let prev = ac(Math.round(90 / st)), rising = false; for (let lag = Math.round(120 / st); lag < Math.min(det.length / 2, Math.round(2400 / st)); lag++) { const c = ac(lag); if (c > prev) rising = true; else if (rising && prev > best) { per = (lag - 1) * st; best = prev; break; } prev = c; } }
  const tws = Array.from(ws.subarray(D.i0, D.i1)).filter((x, k) => fin(x) && D.ch.BSP[D.i0 + k] > 1);
  return { t, d, s, mean: m0, slope, period: per, acPeak: best, amp: sd(det) * 1.4, lo: quant(d, 0.05), hi: quant(d, 0.95), twsMed: median(tws), gust: quant(tws, 0.95) / (median(tws) || 1), lull: quant(tws, 0.05) / (median(tws) || 1), twsSd: sd(tws), first: w360(m0 + mean(d.slice(0, Math.ceil(d.length / 6)))), last: w360(m0 + mean(d.slice(-Math.ceil(d.length / 6)))) };
}
Object.assign(SL, { legSpans, timeLost, starts, manTraces, windStats });
})();
