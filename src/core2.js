'use strict';
/* SailLens core, part 2: calibration models, event writing, season database. No DOM access. */
(() => {
const { D2R, R2D, fin, w180, w360, mean, sd, cmean, quant, median, MODES } = SL;
const mixedBoats = ps => new Set(ps.map(p => p.boat || 'Boat')).size > 1;
const boatError = () => ({ err: 'Select sessions from one boat before deriving calibration.' });

/* dense linear solve (Gaussian elimination, partial pivoting); returns null if singular */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  const x = new Array(n); for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; } return x;
}
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/* ---------- boat speed, compass and current ----------
   Model per phase: SOG vector = k * R(delta) * (BSP along water heading) + current(window).
   Current is free per 15-minute window, so only changes in the boat's own vector identify k and delta. */
function calBsp(D, phases) {
  if (mixedBoats(phases || D.phases)) return boatError();
  const ps = (phases || D.phases).filter(p => fin(p.v.SOG) && fin(p.v.COG) && fin(p.v.HDG) && p.v.BSP > 2);
  if (ps.length < 12) return { err: 'Needs at least 12 phases with BSP, HDG, SOG and COG.' };
  const useCse = ps.every(p => fin(p.v.Course)), mv = D.magVar || 0;
  const rows = ps.map(p => { const th = ((useCse ? p.v.Course : p.v.HDG) + (p.magVar ?? mv)) * D2R, cg = p.v.COG * D2R, b = p.v.BSP; return { p, w: Math.floor(p.t / 9e5) + (p.sessionId || p.day ? '|' + (p.sessionId || p.day) : ''), W: [b * Math.sin(th), b * Math.cos(th)], Wp: [b * Math.cos(th), -b * Math.sin(th)], S: [p.v.SOG * Math.sin(cg), p.v.SOG * Math.cos(cg)], th }; });
  const wins = new Map(); for (const r of rows) { if (!wins.has(r.w)) wins.set(r.w, []); wins.get(r.w).push(r); }
  const good = [...wins.values()].filter(g => { if (g.length < 4) return false; let sx = 0, sy = 0; for (const r of g) { sx += Math.sin(r.th); sy += Math.cos(r.th); } return Math.hypot(sx, sy) / g.length < 0.92; }); // needs a spread of headings
  if (good.length < 2) return { err: 'Needs at least two 15-minute windows that contain both tacks (or a clear change of heading).' };
  const fit = gs => { let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0; for (const g of gs) { const m = k => [mean(g.map(r => r[k][0])), mean(g.map(r => r[k][1]))], mW = m('W'), mP = m('Wp'), mS = m('S'); for (const r of g) { const w = [r.W[0] - mW[0], r.W[1] - mW[1]], q = [r.Wp[0] - mP[0], r.Wp[1] - mP[1]], s = [r.S[0] - mS[0], r.S[1] - mS[1]]; a11 += w[0] * w[0] + w[1] * w[1]; a12 += w[0] * q[0] + w[1] * q[1]; a22 += q[0] * q[0] + q[1] * q[1]; b1 += w[0] * s[0] + w[1] * s[1]; b2 += q[0] * s[0] + q[1] * s[1]; } } const x = solve([[a11, a12], [a12, a22]], [b1, b2]); return x ? { k: x[0], delta: x[1] / x[0] * R2D } : null; };
  const f = fit(good); if (!f) return { err: 'Could not solve: headings too similar.' };
  const rnd = rng(11), bk = [], bd = []; for (let it = 0; it < 200; it++) { const gs = good.map(() => good[Math.floor(rnd() * good.length)]), x = fit(gs); if (x) { bk.push(x.k); bd.push(x.delta); } }
  const cur = [], ratio = [];
  for (const g of good) { const dl = f.delta * D2R, rot = r => [f.k * (r.W[0] + dl * r.Wp[0]), f.k * (r.W[1] + dl * r.Wp[1])]; const cx = mean(g.map(r => r.S[0] - rot(r)[0])), cy = mean(g.map(r => r.S[1] - rot(r)[1])); cur.push({ t: g[0].p.t, n: g.length, rate: Math.hypot(cx, cy), dir: w360(Math.atan2(cx, cy) * R2D) }); for (const r of g) { const u = [Math.sin(r.th + dl), Math.cos(r.th + dl)], al = (r.S[0] - cx) * u[0] + (r.S[1] - cy) * u[1]; ratio.push({ p: r.p, r: al / r.p.v.BSP }); } }
  ratio.sort((a, b) => a.p.t - b.p.t);
  const grp = fn => { const o = {}; for (const x of ratio) { const k = fn(x.p); (o[k] = o[k] || []).push(x.r); } return Object.keys(o).sort().map(k => ({ k, n: o[k].length, r: median(o[k]) })); };
  const b3 = [quant(ratio.map(x => x.p.v.BSP), 1 / 3), quant(ratio.map(x => x.p.v.BSP), 2 / 3)];
  // drift: best single change point in the along-track ratio (paddle wheel fouling, weed)
  let drift = null; const R = ratio.map(x => x.r), n = R.length;
  if (n >= 30 && !ratio.some(x => x.p.day)) { let best = null; for (let c = 12; c <= n - 12; c++) { const a = R.slice(0, c), b = R.slice(c), d = mean(b) - mean(a), se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length) || 1e-9, t = Math.abs(d) / se; if (!best || t > best.t) best = { c, d, t, at: ratio[c].p.t }; } if (best && best.t > 6 && Math.abs(best.d) > 0.02) drift = best; }
  return { k: f.k, kLo: quant(bk, 0.05), kHi: quant(bk, 0.95), delta: f.delta, dLo: quant(bd, 0.05), dHi: quant(bd, 0.95), nPh: good.reduce((s, g) => s + g.length, 0), nWin: good.length, cur, ratio, byTack: grp(p => p.tack), bySpeed: grp(p => p.v.BSP < b3[0] ? 'slow (< ' + b3[0].toFixed(1) + ' kn)' : p.v.BSP < b3[1] ? 'medium' : 'quick (> ' + b3[1].toFixed(1) + ' kn)'), byMode: grp(p => p.mode === 'Upwind' ? 'Upwind' : p.mode === 'Downwind' ? 'Downwind' : 'Reaching'), useCse, drift };
}

/* ---------- current before and after each tack or gybe ----------
   The water does not know which tack the boat is on, so the current worked out just before a tack should equal the current just after.
   Whatever is left over is instrument error. Each pair gives two equations in three unknowns that act differently across a tack:
   a BSP factor (changes the length of the boat's vector), a heading offset (turns it the same way on both tacks) and a leeway
   gain (turns it opposite ways). Least squares over all pairs, bootstrap over pairs for the ranges. */
function calCurrent(phases, mv, pairAllowed, explicitPairs) {
  if (mixedBoats(phases)) return boatError();
  const ps = phases.filter(p => fin(p.v.SOG) && fin(p.v.COG) && fin(p.v.HDG) && p.v.BSP > 2).slice().sort((a, b) => (a.sessionId || a.day || '') < (b.sessionId || b.day || '') ? -1 : (a.sessionId || a.day || '') > (b.sessionId || b.day || '') ? 1 : a.t - b.t);
  const hasLee = ps.length > 0 && ps.every(p => fin(p.v.Leeway)), fam = p => p.mode === 'Upwind' ? 0 : p.mode === 'Downwind' ? 2 : 1, pairs = [];
  const vec = p => { const th = (p.v.HDG + (p.magVar ?? mv ?? 0)) * D2R, cg = p.v.COG * D2R, b = p.v.BSP, le = hasLee ? p.v.Leeway * D2R : 0; return { S: [p.v.SOG * Math.sin(cg), p.v.SOG * Math.cos(cg)], W: [b * Math.sin(th), b * Math.cos(th)], Q: [b * Math.cos(th), -b * Math.sin(th)], le }; };
  for (let i = 0; !explicitPairs && i + 1 < ps.length; i++) { const a = ps[i], b = ps[i + 1]; if (a.tack === b.tack || fam(a) !== fam(b) || fam(a) === 1 || (a.sessionId || a.day || '') !== (b.sessionId || b.day || '') || b.t - a.t > 300000 || (pairAllowed && !pairAllowed(a, b))) continue;
    const bef = [], aft = []; for (let j = i; j >= 0 && bef.length < 3 && ps[j].tack === a.tack && fam(ps[j]) === fam(a) && a.t - ps[j].t < 200000 && (ps[j].sessionId || ps[j].day || '') === (a.sessionId || a.day || ''); j--) bef.push(ps[j]); for (let j = i + 1; j < ps.length && aft.length < 3 && ps[j].tack === b.tack && fam(ps[j]) === fam(b) && ps[j].t - b.t < 200000 && (ps[j].sessionId || ps[j].day || '') === (b.sessionId || b.day || ''); j++) aft.push(ps[j]);
    const avg = g => { const v = g.map(vec), m = k => [mean(v.map(x => x[k][0])), mean(v.map(x => x[k][1]))]; return { S: m('S'), W: m('W'), Q: m('Q'), L: [mean(v.map(x => x.le * x.Q[0])), mean(v.map(x => x.le * x.Q[1]))] }; };
    pairs.push({ p: a, q: b, type: fam(a) === 0 ? 'Tack' : 'Gybe', tws: mean(bef.concat(aft).map(x => x.v.TWS)), A: avg(bef), B: avg(aft), n: bef.length + aft.length }); }
  if(explicitPairs)for(const x of explicitPairs){const a=x.before,b=x.after;if(![a,b].every(p=>fin(p.v.SOG)&&fin(p.v.COG)&&fin(p.v.HDG)&&p.v.BSP>2))continue;const avg=p=>{const v=vec(p);return {...v,L:v.Q.map(q=>q*v.le)};};pairs.push({p:a,q:b,type:x.pair.type,tws:mean([a.v.TWS,b.v.TWS]),A:avg(a),B:avg(b),n:2});}
  if (pairs.length < 3) return { err: 'Needs at least 3 tacks or gybes with steady phases on both sides, and BSP, HDG, SOG and COG.' };
  const fit = P => { const d = hasLee ? 3 : 2, M = Array.from({ length: d }, () => new Array(d).fill(0)), r = new Array(d).fill(0); for (const x of P) for (let j = 0; j < 2; j++) { const f = [x.B.W[j] - x.A.W[j], x.B.Q[j] - x.A.Q[j], x.B.L[j] - x.A.L[j]].slice(0, d), y = x.B.S[j] - x.A.S[j]; for (let a = 0; a < d; a++) { r[a] += f[a] * y; for (let b = 0; b < d; b++) M[a][b] += f[a] * f[b]; } } for (let a = 0; a < d; a++) M[a][a] += 1e-4; if (hasLee) { M[2][2] += 0.05; r[2] += 0.05; } const s = solve(M, r); return s ? { k: s[0], delta: s[1] / s[0] * R2D, lam: hasLee ? s[2] / s[0] : 1 } : null; };
  const f = fit(pairs); if (!f) return { err: 'Could not solve the tack pairs.' };
  const rnd = rng(5), bk = [], bd = [], bl = []; for (let it = 0; it < 200; it++) { const x = fit(pairs.map(() => pairs[Math.floor(rnd() * pairs.length)])); if (x) { bk.push(x.k); bd.push(x.delta); bl.push(x.lam); } }
  const cur = (g, k, de, la) => [0, 1].map(j => g.S[j] - k * (g.W[j] + de * D2R * g.Q[j] + la * g.L[j])), pol = c => ({ rate: Math.hypot(c[0], c[1]), dir: w360(Math.atan2(c[0], c[1]) * R2D) });
  const rows = pairs.map(x => { const a0 = cur(x.A, 1, 0, 1), b0 = cur(x.B, 1, 0, 1), a1 = cur(x.A, f.k, f.delta, f.lam), b1 = cur(x.B, f.k, f.delta, f.lam); return { p: x.p, q: x.q, type: x.type, tws: x.tws, n: x.n, bef: pol(a0), aft: pol(b0), d0: [b0[0] - a0[0], b0[1] - a0[1]], d1: [b1[0] - a1[0], b1[1] - a1[1]], mis0: Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), mis1: Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) }; });
  const rms = k => Math.sqrt(mean(rows.map(r => r[k] * r[k])));
  return { ...f, hasLee, n: pairs.length, nTack: rows.filter(r => r.type === 'Tack').length, kLo: quant(bk, 0.05), kHi: quant(bk, 0.95), dLo: quant(bd, 0.05), dHi: quant(bd, 0.95), lLo: quant(bl, 0.05), lHi: quant(bl, 0.95), rows, rms0: rms('mis0'), rms1: rms('mis1') };
}

/* ---------- wind: upwash table, TWS up/down, tack asymmetry ----------
   TWD_i = g(t) + x_i * e[bin],  x = +1 on port, -1 on starboard.  g(t) is a smooth wind history (piecewise linear, 6-minute knots),
   e[bin] is the angle to ADD to |TWA| for that mode and wind band.  Fitted by penalised least squares with Huber re-weighting. */
function smoothFit(ps, y, cols, o) {
  o = { knot: 360, lam: 2, ...o };
  const t0 = Math.min(...ps.map(p => p.t)), K = Math.max(2, Math.ceil((Math.max(...ps.map(p => p.t)) - t0) / 1000 / o.knot) + 1), P = cols.length, N = K + P, n = ps.length;
  const X = ps.map((p, i) => { const u = (p.t - t0) / 1000 / o.knot, k = Math.min(K - 2, Math.floor(u)), f = u - k, row = new Map([[k, 1 - f], [k + 1, f]]); cols.forEach((c, j) => { const v = c(p, i); if (v) row.set(K + j, v); }); return row; });
  let wts = new Array(n).fill(1), beta = null, res = null;
  for (let it = 0; it < 4; it++) {
    const A = Array.from({ length: N }, () => new Array(N).fill(0)), b = new Array(N).fill(0);
    X.forEach((row, i) => { for (const [a, va] of row) { b[a] += wts[i] * va * y[i]; for (const [c, vc] of row) A[a][c] += wts[i] * va * vc; } });
    for (let k = 1; k < K - 1; k++) { const idx = [k - 1, k, k + 1], cf = [1, -2, 1]; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A[idx[a]][idx[c]] += o.lam * cf[a] * cf[c]; }
    for (let k = 0; k < N; k++) A[k][k] += k < K ? 1e-6 : 0.02;
    beta = solve(A, b); if (!beta) return null;
    res = X.map((row, i) => { let s = 0; for (const [a, va] of row) s += va * beta[a]; return y[i] - s; });
    const sc = 1.4826 * median(res.map(Math.abs)) || 1; wts = res.map(r => { const z = Math.abs(r) / (1.5 * sc); return z <= 1 ? 1 : 1 / z; });
    if (it === 3) { // standard errors of the P parameters of interest
      const s2 = res.reduce((s, r, i) => s + wts[i] * r * r, 0) / Math.max(1, n - N / 2), se = []; for (let j = 0; j < P; j++) { const e = new Array(N).fill(0); e[K + j] = 1; const x = solve(A, e); se.push(x ? Math.sqrt(Math.max(0, s2 * x[K + j])) : NaN); }
      return { coef: beta.slice(K), se, rms: Math.sqrt(mean(res.map(r => r * r))), n };
    }
  }
}
const BANDS = [[0, 7, '< 7'], [7, 9, '7–9'], [9, 11, '9–11'], [11, 14, '11–14'], [14, 18, '14–18'], [18, 99, '> 18']];
function calWindDay(ps) {
  ps = ps.filter(p => (p.mode === 'Upwind' || p.mode === 'Downwind') && fin(p.v.TWD) && fin(p.v.TWS)).sort((a, b) => a.t - b.t);
  if (ps.length < 16 || !ps.some(p => p.tack === 'Port') || !ps.some(p => p.tack === 'Stbd')) return null;
  const tw0 = cmean(ps.map(p => p.v.TWD)), y = ps.map(p => w180(p.v.TWD - tw0)), bins = [];
  for (const m of ['Upwind', 'Downwind']) BANDS.forEach((b, bi) => { const g = ps.filter(p => p.mode === m && p.v.TWS >= b[0] && p.v.TWS < b[1]); if (g.filter(p => p.tack === 'Port').length >= 3 && g.filter(p => p.tack === 'Stbd').length >= 3) bins.push({ mode: m, bi, band: b[2], n: g.length, tws: mean(g.map(p => p.v.TWS)) }); });
  if (!bins.length) return null;
  const inBin = (p, b) => p.mode === b.mode && p.v.TWS >= BANDS[b.bi][0] && p.v.TWS < BANDS[b.bi][1];
  const f = smoothFit(ps, y, bins.map(b => p => inBin(p, b) ? (p.tack === 'Port' ? 1 : -1) : 0)); if (!f) return null;
  bins.forEach((b, j) => { b.e = f.coef[j]; b.se = f.se[j]; });
  // TWS: log(TWS) = h(t) + d*[downwind] + a*(stbd=+1, port=-1)
  const g = smoothFit(ps, ps.map(p => Math.log(Math.max(1, p.v.TWS))), [p => p.mode === 'Downwind' ? 1 : 0, p => p.tack === 'Stbd' ? 0.5 : -0.5], { lam: 4 });
  const hasBoth = ps.some(p => p.mode === 'Upwind') && ps.some(p => p.mode === 'Downwind');
  return { bins, rms: f.rms, n: ps.length, twsDn: g && hasBoth ? { pct: (Math.exp(g.coef[0]) - 1) * 100, se: g.se[0] * 100 } : null, twsTack: g ? { pct: (Math.exp(g.coef[1]) - 1) * 100, se: g.se[1] * 100 } : null };
}
/* phases may span several days: fit each day on its own wind history, then pool the per-band results by inverse variance */
function calWind(phases) {
  if (mixedBoats(phases)) return boatError();
  const days = new Map(); for (const p of phases) { const k = p.sessionId || p.day || 'day'; if (!days.has(k)) days.set(k, []); days.get(k).push(p); }
  const fits = [...days.values()].map(calWindDay).filter(Boolean); if (!fits.length) return { err: 'Needs upwind or downwind phases on both tacks (at least 3 per tack in a wind band).' };
  const pool = xs => { xs = xs.filter(x => x && fin(x.v) && x.se > 0); if (!xs.length) return null; const w = xs.map(x => 1 / (x.se * x.se + 0.04)), sw = w.reduce((a, b) => a + b, 0); return { v: xs.reduce((s, x, i) => s + w[i] * x.v, 0) / sw, se: Math.sqrt(1 / sw), k: xs.length }; };
  const bins = []; for (const m of ['Upwind', 'Downwind']) BANDS.forEach((b, bi) => { const xs = fits.map(f => f.bins.find(q => q.mode === m && q.bi === bi)).filter(Boolean); if (!xs.length) return; const pv = pool(xs.map(x => ({ v: x.e, se: x.se }))); if (pv) bins.push({ mode: m, band: b[2], n: xs.reduce((s, x) => s + x.n, 0), days: xs.length, e: pv.v, se: pv.se, tws: mean(xs.map(x => x.tws)) }); });
  const d = pool(fits.map(f => f.twsDn && { v: f.twsDn.pct, se: f.twsDn.se })), a = pool(fits.map(f => f.twsTack && { v: f.twsTack.pct, se: f.twsTack.se }));
  return { bins, days: fits.length, n: fits.reduce((s, f) => s + f.n, 0), rms: mean(fits.map(f => f.rms)), twsDn: d && { pct: d.v, se: d.se }, twsTack: a && { pct: a.v, se: a.se } };
}
/* masthead unit offset from the port/starboard asymmetry of |AWA| upwind, controlling for wind and how hard the boat is being sailed */
function calAwa(phases) {
  if (mixedBoats(phases)) return boatError();
  const ps = phases.filter(p => p.mode === 'Upwind' && fin(p.v.AWA) && fin(p.v.AWS) && fin(p.v.BSP)); const nP = ps.filter(p => p.tack === 'Port').length, nS = ps.length - nP;
  if (nP < 5 || nS < 5) return { err: 'Needs at least 5 upwind phases on each tack with AWA and AWS.' };
  const f = [p => 1, p => p.tack === 'Stbd' ? 1 : -1, p => p.v.AWS - 14, p => p.v.BSP - 7, p => (p.v['Heel_norm'] != null && fin(p.v['Heel_norm']) ? Math.abs(p.v['Heel_norm']) : 15) - 15], k = f.length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0), y = ps.map(p => Math.abs(p.v.AWA));
  ps.forEach((p, i) => { const x = f.map(g => g(p)); for (let a = 0; a < k; a++) { b[a] += x[a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += x[a] * x[c]; } }); for (let a = 0; a < k; a++) A[a][a] += 1e-6;
  const be = solve(A, b); if (!be) return { err: 'Could not solve.' };
  const res = ps.map((p, i) => y[i] - f.reduce((s, g, j) => s + g(p) * be[j], 0)), s2 = res.reduce((s, r) => s + r * r, 0) / Math.max(1, ps.length - k), e = new Array(k).fill(0); e[1] = 1; const inv = solve(A, e);
  const raw = (mean(ps.filter(p => p.tack === 'Stbd').map(p => Math.abs(p.v.AWA))) - mean(ps.filter(p => p.tack === 'Port').map(p => Math.abs(p.v.AWA)))) / 2;
  // cross-check from TWS asymmetry: how much TWS changes per degree of AWA at the typical upwind point
  const m = k2 => mean(ps.map(p => Math.abs(p.v[k2]))), tw = d => SL.trueWind(m('AWA') + d, m('AWS'), m('BSP')).tws, sens = tw(0.5) - tw(-0.5);
  const twsAsym = (mean(ps.filter(p => p.tack === 'Stbd').map(p => p.v.TWS)) - mean(ps.filter(p => p.tack === 'Port').map(p => p.v.TWS))) / 2;
  return { read: be[1], se: inv ? Math.sqrt(Math.max(0, s2 * inv[1])) : NaN, raw, nP, nS, twsAsym, sens, fromTws: Math.abs(sens) > 0.02 ? twsAsym / sens : NaN };
}
function calScore(bsp, wind, awa) { // 0..100, a rough single number to trend over a season
  if (!bsp || bsp.err || !fin(bsp.k) || !fin(bsp.delta) || !wind || wind.err || !wind.bins || !wind.bins.length || wind.bins.some(b => !fin(b.e)) || !wind.twsDn || !fin(wind.twsDn.pct) || !awa || awa.err || !fin(awa.read)) return null;
  let s = 100; const pen = (v, tol, w) => { if (fin(v)) s -= Math.min(w, Math.max(0, Math.abs(v) - tol) / tol * w / 2); };
  if (bsp && !bsp.err) { pen((bsp.k - 1) * 100, 1, 25); pen(bsp.delta, 1.5, 20); }
  if (wind && !wind.err) { for (const b of wind.bins) pen(b.e, 1.5, 30 / wind.bins.length); if (wind.twsDn) pen(wind.twsDn.pct, 3, 10); }
  if (awa && !awa.err) pen(awa.read, 0.7, 15);
  return Math.max(0, Math.round(s));
}

/* ---------- events ---------- */
const xesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, '&#x9;').replace(/\r?\n/g, '&#13;&#10;');
const p2 = n => String(n).padStart(2, '0');
const tsParts = tl => { const d = new Date(tl); return [d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()), p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds())]; };
function eventsXml(ev) {
  const off = ev.evOff || 0, m = ev.meta || {};
  const evs = ev.events.slice().sort((a, b) => a.tl - b.tl).map(e => { const [d, t] = tsParts(e.tl); return `    <event date="${d}" time="${t}" type="${xesc(e.type)}" attribute="${xesc(e.attr)}" comments="${xesc(e.comments)}" ${Object.entries({labelalign:'Top',...e.xmlAttrs}).filter(([k])=>/^[A-Za-z_][\w.:-]*$/.test(k)&&!['date','time','datetime','type','attribute','attr','comments'].includes(k)).map(([k,v])=>k+'="'+xesc(v)+'"').join(' ')} />`; }).join('\r\n');
  const block = `<events utc_offset_hours="${off}">\r\n${evs}\r\n  </events>`;
  const sailItem = s => {
    const a={...s.xmlAttrs,name:s.name,sailtype:s.type,sailgroup:s.xmlAttrs?.sailgroup||(s.type==='Mainsail'?'M':'H'),weight:s.xmlAttrs?.weight??'0'};
    return '    <item '+Object.entries(a).filter(([k])=>/^[A-Za-z_][\w.:-]*$/.test(k)).map(([k,v])=>k+'="'+xesc(v)+'"').join(' ')+' />';
  };
  const sails = '<saillist>\r\n'+(ev.sails||[]).map(sailItem).join('\r\n')+'\r\n  </saillist>';
  if (ev.xml && /<events[\s\S]*?<\/events>/.test(ev.xml)) { // keep everything RaceReplay wrote, replace only what was edited here
    let x = ev.xml.replace(/<events\b[^>]*>[\s\S]*?<\/events>/, () => block);
    const nativeNames=new Set(parseSailList(x).map(v=>v.name));
    const added=(ev.sails||[]).filter(v=>!nativeNames.has(v.name));
    if(added.length){
      if(/<\/saillist>/.test(x))x=x.replace('</saillist>',()=>added.map(sailItem).join('\r\n')+'\r\n  </saillist>');
      else if(/<saillist\s*\/>/.test(x))x=x.replace(/<saillist\s*\/>/,()=>sails);
      else x=x.replace('<events',()=>sails+'\r\n  <events');
    }
    for(const [tag,value] of [['event_file',off],['log_file',ev.logOff||0]]) x=x.replace(new RegExp('(<'+tag+'\\b[^>]*?hours=")[^"]*(")'),(_,a,b)=>a+value+b);
    const setv = (tag,v) => {if(v!=null)x=x.replace(new RegExp('<'+tag+'\\s+val="[^"]*"'),()=>'<'+tag+' val="'+xesc(v)+'"');};
    setv('boat', m.boat); setv('boatdaydescription', m.desc); setv('location', m.location); setv('daygoals', m.goals); setv('daycomments', m.comments); return x;
  }
  const date = m.date || (ev.events[0] ? tsParts(ev.events[0].tl)[0] : '');
  return `<?xml version="1.0" encoding="utf-8"?>\r\n<daysail>\r\n  <boat val="${xesc(m.boat)}" />\r\n  <confignum val="0" />\r\n  <date val="${date}" />\r\n  <boatdaydescription val="${xesc(m.desc)}" />\r\n  <location val="${xesc(m.location)}" />\r\n  <daytypestr val="${xesc(m.daytype)}" />\r\n  <utc_offset>\r\n    <event_file hours="${off}" />\r\n    <log_file hours="${ev.logOff || 0}" />\r\n  </utc_offset>\r\n  <dailycomments>\r\n    <boatname val="${xesc(m.boat)}" />\r\n    <date val="${date}" />\r\n    <daygoals val="${xesc(m.goals)}" />\r\n    <daycomments val="${xesc(m.comments)}" />\r\n  </dailycomments>\r\n  ${sails}\r\n  ${block}\r\n</daysail>\r\n`;
}
function parseSailList(xml) { const out = []; const blk = (xml.match(/<saillist[\s\S]*?<\/saillist>/) || [''])[0]; blk.replace(/<item\s+([^>]*?)\/?>/g, (m, a) => { const o=SL.attrs(a);if(o.name)out.push({name:o.name,type:o.sailtype||'Jib',xmlAttrs:o}); }); return out; }
/* places where the boat goes from upwind to downwind or back: candidates for race marks */
function suggestMarks(D) {
  const out = [], a = D.ch.absTWA, W = 25; let prev = 0, since = 0;
  for (let i = D.i0 + W; i < D.i1 - W; i += 5) { const m = median(a.subarray(i - W, i + W)); if (!fin(m) || !(D.ch.BSP[i] > D.cfg.minBsp)) continue; const c = m < 70 ? 1 : m > 110 ? -1 : 0; if (!c) continue; if (prev && c !== prev && i - since > 180) { let j = i; while (j > since && ((a[j] < 90) === (c > 0))) j--; out.push({ i: j, top: prev > 0 }); since = i; } if (c !== prev) since = Math.max(since, i - 1); prev = c; }
  return out;
}

/* ---------- season database ---------- */
const SVARS = ['TWS', 'TWA', 'absTWA', 'TWD', 'BSP', 'SOG', 'COG', 'HDG', 'Course', 'AWA', 'absAWA', 'AWS', 'Heel', 'Heel_norm', 'abs_heel', 'Rudder', 'Rudder_norm', 'abs_rudder', 'Leeway', 'Trim', 'Forestay', 'Polar_BSP', 'Target_TWA', 'Target_BSP', 'BSPpol%', 'BSP_trg%', 'VMG', 'VMG%', 'ΔBSP', 'ΔTWA', 'ΔVMG', 'ΔVMG%', 'BSP-SOG', 'HDG-COG', 'Cur_E', 'Cur_N', 'CUR_RATE', 'CUR_DIR', 'Vang', 'Trav', 'Main', 'BackStay', 'Cunningham', 'Outhaul', 'Rake', 'MastButt', 'Downhaul', 'Boom', 'Twist', 'Heave', 'WvSigHt', 'Load S', 'Load P', 'RunnerS', 'RunnerP', 'JibH', 'MainH', 'Depth', 'SeaTemp'];
const r3 = v => fin(v) ? Math.round(v * 1000) / 1000 : null;
function dayRecord(D, meta, extra) {
  const keys = [...new Set(SVARS.concat(Object.keys(D.ch)))].filter(k => D.ch[k]), clockOffset = SL.logOffset(D.raw, D.cfg), shift = clockOffset * 36e5, off = (D.cfg.dispOff || 0) + clockOffset, start = D.sum.t0 - shift, end = D.sum.t1 - shift, date = new Date(start + off * 36e5).toISOString().slice(0, 10);
  return { id: (meta.boat || 'Boat') + '|' + date + '|' + start + '|' + end, boat: meta.boat || 'Boat', date, start, end, timeBasis: 'utc', desc: meta.desc || '', location: meta.location || '', dayType: meta.daytype || '', polar: extra.polar || '', off, added: Date.now(), magVar: D.magVar,
    recipe: JSON.parse(JSON.stringify({ version: 2, cfg: D.cfg, calibration: extra.calibration || null, polarRows: D.P ? D.P.rows : null, files: extra.files || {}, events: extra.events || null, importQuality: D.raw.diagnostics || null, timeBasis: D.raw.timeBasis || 'floating' })),
    sum: { tws: r3(D.sum.TWS.avg), twsMin: r3(D.sum.TWS.min), twsMax: r3(D.sum.TWS.max), twd: D.sum.TWD ? r3(D.sum.TWD.avg) : null, tacks: D.sum.tacks, gybes: D.sum.gybes, sailing: D.sum.sailing, racing: D.sum.racing, dist: r3(D.sum.dist), sails: D.sum.sails }, cal: extra.cal || null,
    keys, phases: D.phases.map(p => ({ t: p.t - shift, d: p.i1 - p.i, m: MODES.indexOf(p.mode), k: p.tack === 'Stbd' ? 1 : p.tack === 'Port' ? 0 : -1, s: p.sails, r: p.race, l: p.leg, x: p.testing ? 1 : 0, v: keys.map(k => r3(p.v[k])) })),
    mans: D.mans.map(m => ({ t: D.raw.t0 + m.i * 1000 - shift, type: m.type, to: m.to, tws: r3(m.tws), loss: r3(m.loss), lossGps: r3(m.lossGps), rate: r3(m.rate), angle: r3(m.angle), bspIn: r3(m.bspIn), bspMin: r3(m.bspMin), sail: m.sail >= 0 ? D.L.sailNames[m.sail] : '-' })) };
}
function seasonPool(S) { // expand to the same phase objects the day analysis uses
  const out = []; for (const d of S.days) { const lab = d.date + ' ' + (d.boat || 'Boat') + (d.desc ? ' ' + d.desc : ''); for (const q of d.phases) { const v = {}; d.keys.forEach((k, i) => { v[k] = q.v[i] == null ? NaN : q.v[i]; }); if (fin(v.AWA) && !fin(v.absAWA)) v.absAWA = Math.abs(v.AWA); out.push({ t: q.t, i: null, i1: null, dur: q.d, tack: q.k === -1 ? 'Onbekend' : q.k ? 'Stbd' : 'Port', mode: MODES[q.m] || 'Unknown', sails: q.s, race: q.r, leg: q.l, raceLeg: q.r ? 'R' + q.r + 'L' + q.l : '-', testing: q.x, v, day: d.date, sessionId: d.id, boat: d.boat, dayLabel: lab, off: d.off, magVar: d.magVar }); } }
  return out;
}
/* import a CSV export of RaceReplay's T_Phase table (Access: External Data > Export > Text file) */
function csvParse(text) { return [...SL.csvRows(text)]; }
const RRMAP = { HEEL: 'Heel_norm', RUDDER: 'Rudder_norm', BSPpol: 'Polar_BSP', BSP_trg: 'Target_BSP', TWA_trg: 'Target_TWA', FORESTAY: 'Forestay', TRIM: 'Trim', CSE: 'Course' };
const RRSKIP = /^(id|ConfigNum|StartDateTime|StopDateTime|Duration|SailingMode$|PhaseType$|DataFrequency|RaceLegNum|RaceNum|PhaseTack$|BalanceType|MadeOnboard|TestRating|NumPoints|PointDensity|GPS_|MainsailReef|.*_Bin$|Burn|DayNight|DistToLn|Name$|BoatName|.*Str$|TestSubject|Mainsail|Headsail|Staysail|Spinnaker|Comments|COG_mag|CSE_mag|HDG_mag|TWD_mag|MagVar|VMG_trg|DistanceNM|geo)/;
function seasonFromPhaseCsv(text, dayInfo) {
  const rows = csvParse(text), hd = (rows[0] || []).map(s => s.trim()), ix = n => hd.indexOf(n); if (ix('StartDateTime') < 0 || ix('TWS') < 0) throw new Error('This CSV does not look like a T_Phase export (needs StartDateTime and TWS columns).');
  const num = hd.map((n, i) => RRSKIP.test(n) ? null : n), days = new Map();
  for (const r of rows.slice(1)) {
    if (r.length < hd.length - 2) continue; const g = n => ix(n) >= 0 ? r[ix(n)] : '', dur = SL.csvNumber(g('Duration')); if (!(dur > 0 && dur <= 180) || /CompleteRaceLeg|PortStbd/.test(g('PhaseTypeStr'))) continue;
    const tl = SL.parseTime(g('StartDateTime')); if (!fin(tl)) continue; const date = new Date(tl).toISOString().slice(0, 10), boat = g('BoatName') || 'Boat', id = boat + '|' + date, off = 0;
    const v = {}; num.forEach((n, i) => { const value = SL.csvNumber(r[i]); if (n && fin(value)) v[RRMAP[n] || n] = value; });
    const port = /port/i.test(g('PhaseTackStr')) || v.TWA < 0, sg = port ? -1 : 1, md = MODES.indexOf(g('SailingModeStr'));
    if (fin(v.TWA)) v.TWA = sg * Math.abs(v.TWA);
    if (fin(v.Heel_norm)) { v.Heel = sg * v.Heel_norm; v.abs_heel = Math.abs(v.Heel_norm); } if (fin(v.Rudder_norm)) { v.Rudder = sg * v.Rudder_norm; v.abs_rudder = Math.abs(v.Rudder_norm); } if (fin(v.AWA)) v.AWA = sg * Math.abs(v.AWA);
    v.absTWA = Math.abs(v.TWA); const vt = SL.csvNumber(g('VMG_trg')); v.VMG = Math.abs(v.VMG); v['ΔBSP'] = v.BSP - v.Target_BSP; v['ΔTWA'] = v.absTWA - v.Target_TWA; if (fin(vt)) v['ΔVMG'] = v.VMG - Math.abs(vt); v['ΔVMG%'] = v['VMG%'] - 100; if (md === 1 || md === 2) v['VMG%'] = v['BSPpol%'];
    if (fin(v.SOG)) v['BSP-SOG'] = v.BSP - v.SOG; if (fin(v.HDG) && fin(v.COG)) v['HDG-COG'] = w180(v.HDG - v.COG);
    const sails = [g('Spinnaker'), g('Headsail'), g('Staysail')].filter(Boolean).join('/') || (g('Mainsail') ? g('Mainsail') + ' only' : '-');
    if (!days.has(id)) { const inf = (dayInfo && dayInfo[date]) || {}; days.set(id, { id, boat, date, desc: inf.desc || '', location: inf.location || '', dayType: inf.dayType || '', polar: inf.polar || '', off: 0, local: true, added: Date.now(), magVar: 0, sum: null, cal: null, keys: [], phases: [], mans: [], src: 'RaceReplay database' }); }
    days.get(id).phases.push({ t: tl, d: dur, m: md, k: port ? 0 : 1, s: sails, r: +g('RaceNum') || 0, l: +g('RaceLegNum') || 0, x: /Testing/.test(g('PhaseTypeStr')) ? 1 : 0, _v: v });
  }
  const out = [...days.values()];
  for (const d of out) { const ks = new Set(); d.phases.forEach(p => Object.keys(p._v).forEach(k => ks.add(k))); d.keys = [...ks]; d.phases.forEach(p => { p.v = d.keys.map(k => r3(p._v[k])); delete p._v; }); d.phases.sort((a, b) => a.t - b.t); const tw = d.phases.map(p => p.v[d.keys.indexOf('TWS')]); d.sum = { tws: r3(mean(tw)), twsMin: r3(Math.min(...tw)), twsMax: r3(Math.max(...tw)), sails: [...new Set(d.phases.flatMap(p => p.s.replace(/ only$/, '').split('/')))].sort() }; }
  if (!out.length) throw new Error('No valid phases found in the CSV.');
  for (const d of out) { d.start = d.phases[0].t; d.end = Math.max(...d.phases.map(p => p.t + p.d * 1000)); d.id += '|' + d.start + '|' + d.end; d.unknownModes = d.phases.filter(p => p.m < 0).length; }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
/* import a CSV export of RaceReplay's T_TackJibe table: tacks and gybes for days already in (or added to) the season */
function seasonFromTackCsv(text) {
  const rows = csvParse(text), hd = rows[0].map(s => s.trim()), ix = n => hd.indexOf(n); if (ix('DateTime') < 0 || ix('DistanceLost_m') < 0) throw new Error('This CSV does not look like a T_TackJibe export (needs DateTime and DistanceLost_m columns).');
  const yes = v => /^(true|-1|1|yes)$/i.test(String(v).trim()), days = new Map();
  for (const r of rows.slice(1)) { if (r.length < hd.length - 2) continue; const g = n => ix(n) >= 0 ? r[ix(n)] : '', t = SL.parseTime(g('DateTime')); if (!fin(t)) continue; const num = n => g(n) !== '' && fin(+g(n)) ? +g(n) : null, valid = ix('IsValidPerf') < 0 || yes(g('IsValidPerf'));
    const id = (g('BoatName') || 'Boat') + '|' + g('DateTime').slice(0, 10), sail = [g('Spinnaker'), g('Headsail'), g('Staysail')].filter(Boolean).join('/') || '-';
    if (!days.has(id)) days.set(id, []);
    days.get(id).push({ t, type: yes(g('IsTack')) ? 'Tack' : 'Gybe', to: yes(g('IsPortToStbd')) ? 'Stbd' : 'Port', tws: num('TWS'), loss: valid ? num('DistanceLost_m') : null, lossGps: valid ? num('DistanceLostGPS_m') : null, rate: num('Rotation_Max') == null ? null : Math.abs(num('Rotation_Max')), angle: num('TJAngle'), bspIn: num('BSP_bfr'), bspMin: null, bspOut: num('BSP_aft'), sail }); }
  return days;
}
function seasonMergeMans(S, days) { let n = 0, miss = 0; for (const [id, mans] of days) { const d = S.days.find(x => x.id === id) || S.days.find(x => x.date === id.split('|')[1]); if (!d) { miss += mans.length; continue; } d.mans = mans.sort((a, b) => a.t - b.t); n += mans.length; } return { n, miss }; }
function validateDay(d) {
  if (!d || typeof d.id !== 'string' || !d.id || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Array.isArray(d.keys) || d.keys.some(k => typeof k !== 'string') || new Set(d.keys).size !== d.keys.length || !Array.isArray(d.phases)) throw new Error('Invalid session in season file.');
  for (const p of d.phases) if (!p || !fin(p.t) || !fin(p.d) || p.d <= 0 || !Number.isInteger(p.m) || p.m < -1 || p.m > 3 || !Array.isArray(p.v) || p.v.length !== d.keys.length || p.v.some(v => v != null && !fin(v))) throw new Error('Invalid phase in session ' + d.id + '.');
}
function seasonMerge(S, days) {
  // Validate and resolve the entire import before changing the existing season.
  const next = S.days.slice(); let add = 0, same = 0;
  const content = d => JSON.stringify(d, (k, v) => k === 'added' ? undefined : v);
  const span = d => [fin(d.start) ? d.start : Math.min(...d.phases.map(p => p.t)), fin(d.end) ? d.end : Math.max(...d.phases.map(p => p.t + p.d * 1000))];
  for (const d of days) { validateDay(d); const old = next.find(x => x.id === d.id);
    if (old) { if (content(old) !== content(d)) throw new Error('Session ' + d.id + ' already exists with different data. Export a backup, then remove that session explicitly before replacing it. Nothing was imported.'); same++; }
    else {
      const [start, end] = span(d), overlap = next.find(x => { const [a, b] = span(x); return (x.boat || 'Boat') === (d.boat || 'Boat') && start < b && end > a; });
      if (overlap) throw new Error('Session ' + d.id + ' overlaps existing data for this boat. Nothing was imported; resolve the overlap before adding it.');
      next.push(d); add++;
    }
  }
  next.sort((a, b) => a.date.localeCompare(b.date) || ((a.start || a.phases[0]?.t || 0) - (b.start || b.phases[0]?.t || 0)));
  S.days = next; S.version = 2; return { add, same, rep: 0 };
}
const newSeason = () => ({ app: 'SailLens', version: 2, name: 'Season', days: [] });
/* sail crossover: per mode, where one sail's trend of VMG% against TWS overtakes another's */
function crossover(phases, mode, yKey) {
  const ps = phases.filter(p => (p.mode === mode || (mode === 'Reaching' && p.mode === 'BroadReaching')) && fin(p.v[yKey]) && p.sails && p.sails !== '-' && !/ only$/.test(p.sails)), by = {};
  for (const p of ps) (by[p.sails] = by[p.sails] || []).push(p);
  const sails = Object.keys(by).filter(k => by[k].length >= 12).sort(), curves = sails.map(s => ({ sail: s, n: by[s].length, lo: quant(by[s].map(p => p.v.TWS), 0.05), hi: quant(by[s].map(p => p.v.TWS), 0.95), pts: SL.loess(by[s].map(p => p.v.TWS), by[s].map(p => p.v[yKey]), 0.8, 40) })), cross = [];
  const at = (c, x) => { const p = c.pts; if (!p.length || x < c.lo || x > c.hi) return NaN; for (let i = 1; i < p.length; i++) if (x <= p[i][0]) { const f = (x - p[i - 1][0]) / ((p[i][0] - p[i - 1][0]) || 1); return p[i - 1][1] + f * (p[i][1] - p[i - 1][1]); } return NaN; };
  for (let a = 0; a < curves.length; a++) for (let b = a + 1; b < curves.length; b++) { let prev = NaN; for (let x = 4; x <= 30; x += 0.25) { const d = at(curves[a], x) - at(curves[b], x); const dm = at(curves[a], x - 1.25) - at(curves[b], x - 1.25), dp = at(curves[a], x + 1) - at(curves[b], x + 1); if (fin(d) && fin(prev) && d * prev < 0 && fin(dm) && fin(dp) && dm * dp < 0 && Math.abs(dm) >= 0.4 && Math.abs(dp) >= 0.4) cross.push({ a: curves[a].sail, b: curves[b].sail, tws: x - 0.125, below: prev > 0 ? curves[a].sail : curves[b].sail, above: prev > 0 ? curves[b].sail : curves[a].sail }); if (fin(d)) prev = d; } }
  return { curves, cross, ps };
}
/* ---------- sail chart (crossover chart) ----------
   Two layers: shapes (RaceReplay crossover chart: one polygon per sail, shapes may overlap, e.g. a staysail over a gennaker)
   and cells (a painted grid of TWS 2 kn x TWA 10 deg, each holding one sail or combination). */
const CH_TWS = Array.from({ length: 15 }, (v, i) => 2 + 2 * i), CH_TWA = Array.from({ length: 16 }, (v, i) => 30 + 10 * i);
const chKey = (tws, twa) => Math.max(2, Math.min(30, Math.round(tws / 2) * 2)) + '|' + Math.max(30, Math.min(180, Math.round(Math.abs(twa) / 10) * 10));
const newChart = () => ({ app: 'SailLens', type: 'sailchart', name: 'Sail chart', polar: '', shapes: [], cells: {} });
function inPoly(pts, x, y) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const _sm = new WeakMap();
function outline(s) { // the area's edge as a polygon: straight, or a smooth closed curve through the points
  if (s.straight || s.pts.length < 3) return s.pts; const sig = JSON.stringify(s.pts), c = _sm.get(s); if (c && c.sig === sig) return c.out;
  const p = s.pts, n = p.length, out = [], K = 14;
  for (let i = 0; i < n; i++) { const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]; for (let k = 0; k < K; k++) { const t = k / K, t2 = t * t, t3 = t2 * t, f = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3); out.push([Math.max(0, f(0)), Math.max(0, Math.min(180, f(1)))]); } }
  _sm.set(s, { sig, out }); return out;
}
const sailTokens = s => (s || '').replace(/ only$/, '').split('/').map(x => x.trim()).filter(x => x && x !== '-' && !/^main$/i.test(x));
function chartAt(ch, tws, twa) { const out = []; if (!ch || !fin(tws) || !fin(twa)) return out; const a = Math.abs(twa); for (const s of ch.shapes || []) if (s.visible !== false && s.pts.length >= 3 && inPoly(outline(s), tws, a) && !out.includes(s.name)) out.push(s.name); const c = (ch.cells || {})[chKey(tws, a)]; if (c) for (const t of sailTokens(c)) if (!out.includes(t)) out.push(t); return out; }
const chartSail = (ch, tws, twa) => chartAt(ch, tws, twa).join(' / ');
const chartEmpty = ch => !ch || (!(ch.shapes || []).length && !Object.keys(ch.cells || {}).length);
/* on the chart when every sail that was up (mainsail aside) is one the chart allows at that wind speed and angle */
const sailOn = (used, set) => { const t = sailTokens(used); return t.length > 0 && t.every(x => set.includes(x)); };
const xa = s => { const o = {}; s.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k.toLowerCase()] = v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }); return o; };
function parseSailChart(text, name) {
  if (/^﻿?\s*\{/.test(text.slice(0, 50))) { const o = JSON.parse(text.replace(/^﻿/, '')); if (o.type !== 'sailchart') throw new Error('Not a SailLens sail chart.'); o.shapes = o.shapes || []; o.cells = o.cells || {}; return o; }
  const ch = newChart(); ch.name = name || 'Sail chart'; const pm = text.match(/<polar\s+([^>]*?)\/?>/); if (pm) ch.polar = xa(pm[1]).path || '';
  text.replace(/<element\s+([^>]*)>([\s\S]*?)<\/element>/g, (m, at, body) => {
    const a = xa(at), val = t => { const q = body.match(new RegExp('<' + t + '\\s+([^>]*?)\\/?>')); return q ? xa(q[1]) : {}; }, pts = [];
    ((body.match(/<bezierpoints>[\s\S]*?<\/bezierpoints>/) || body.match(/<points>[\s\S]*?<\/points>/) || [body])[0]).replace(/<point\s+([^>]*?)\/?>/g, (mm, p) => { const q = xa(p); if (fin(+q.tws) && fin(+q.twa)) pts.push([+q.tws, +q.twa]); });
    if (!a.name || pts.length < 3) return m; const col = val('colour'), lab = val('labelposition');
    ch.shapes.push({ name: a.name, group: a.group || '', kind: a.type || 'Sail', pts, colour: fin(+col.r) ? [+col.r, +col.g, +col.b] : null, visible: (val('visible').val || 'True') !== 'False', straight: (val('straightline').val || 'False') === 'True', comments: val('comments').val || '', createdby: val('createdby').val || '', datecreated: val('datecreated').val || '', opacity: +val('shapeopacity').val || 40, label: fin(+lab.tws) ? [+lab.tws, +lab.twa] : null });
    return m; });
  if (!ch.shapes.length) { // other XML: named sails followed by TWS/TWA points
    let cur = null; text.replace(/<([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*\/?>/g, (m, tag, at) => { const a = xa(at), nm = a.name || a.sail || a.sailname, x = fin(+a.tws) && a.tws !== undefined ? +a.tws : null, y = fin(+a.twa) && a.twa !== undefined ? +a.twa : null; if (nm && x === null) { cur = { name: nm, group: '', kind: 'Sail', pts: [], colour: null, visible: true, straight: true, comments: '', opacity: 40, label: null }; ch.shapes.push(cur); } if (cur && x !== null && y !== null) cur.pts.push([x, y]); return m; });
    ch.shapes = ch.shapes.filter(s => s.pts.length >= 3);
  }
  if (!ch.shapes.length) throw new Error('No sail areas found in this file (expected a RaceReplay crossover chart with <element> and <point tws twa>).');
  return ch;
}
const xq = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function chartXml(ch) {
  const r1 = v => Math.round(v * 10) / 10, cen = s => [r1(mean(s.pts.map(p => p[0]))), r1(mean(s.pts.map(p => p[1])))];
  return `<?xml version="1.0" encoding="utf-8"?>\r\n<crossoverchart>\r\n  <polar path="${xq(ch.polar || '')}" type="Expedition" />\r\n  <elements>\r\n` + (ch.shapes || []).map(s => { const c = s.colour || [128, 128, 128], l = s.label || cen(s); return `    <element name="${xq(s.name)}" group="${xq(s.group || 'Other')}" type="${xq(s.kind || 'Sail')}">\r\n      <createdby val="${xq(s.createdby || 'SailLens')}" />\r\n      <datecreated val="${xq(s.datecreated || new Date().toISOString().slice(0, 10))}" />\r\n      <visible val="${s.visible === false ? 'False' : 'True'}" />\r\n      <colour r="${c[0]}" g="${c[1]}" b="${c[2]}" />\r\n      <straightline val="${s.straight ? 'True' : 'False'}" />\r\n` + (s.comments ? `      <comments val="${xq(s.comments)}" />\r\n` : '') + `      <bezierpoints>\r\n` + s.pts.map(p => `        <point tws="${r1(p[0])}" twa="${r1(p[1])}" />`).join('\r\n') + `\r\n      </bezierpoints>\r\n      <shapepattern val="Solid" />\r\n      <shapeopacity val="${s.opacity || 40}" />\r\n      <linepattern val="Solid" />\r\n      <linewidth val="2" />\r\n      <labelposition tws="${l[0]}" twa="${l[1]}" />\r\n      <labelfont size="14" bold="True" italic="False" underline="False" r="0" g="0" b="0" />\r\n    </element>`; }).join('\r\n') + `\r\n  </elements>\r\n</crossoverchart>\r\n`;
}
/* how the sails actually used compare with the chart */
function chartStats(ch, phases) {
  const cells = {}, perf = p => (p.mode === 'Upwind' || p.mode === 'Downwind') ? p.v['VMG%'] : p.v['BSPpol%']; let on = 0, off = 0, un = 0;
  for (const p of phases) { if (!sailTokens(p.sails).length || !fin(p.v.TWS) || !fin(p.v.TWA)) continue; const set = chartAt(ch, p.v.TWS, p.v.TWA), k = chKey(p.v.TWS, p.v.TWA), c = cells[k] = cells[k] || { k, by: {}, onPerf: [], offBy: {} }; (c.by[p.sails] = c.by[p.sails] || []).push(perf(p));
    if (!set.length) { un++; p._ch = 0; } else if (sailOn(p.sails, set)) { on++; p._ch = 1; c.onPerf.push(perf(p)); } else { off++; p._ch = -1; const o = c.offBy[p.sails] = c.offBy[p.sails] || { perf: [], chart: {} }; o.perf.push(perf(p)); o.chart[set.join(' / ')] = 1; } }
  const rows = []; for (const k in cells) { const c = cells[k], g = c.onPerf.filter(fin); for (const s in c.offBy) rows.push({ k, tws: +k.split('|')[0], twa: +k.split('|')[1], chart: Object.keys(c.offBy[s].chart).join(' or '), used: s, n: c.offBy[s].perf.length, perf: median(c.offBy[s].perf.filter(fin)), nChart: g.length, perfChart: g.length ? median(g) : NaN }); }
  rows.sort((a, b) => b.n - a.n); return { cells, on, off, un, rows };
}
/* painted layer suggested by the data: in every cell the sail with the best median performance (at least 3 phases) */
function chartFromData(phases, ch, overwrite) {
  const st = chartStats({ shapes: [], cells: {} }, phases); let n = 0;
  for (const k in st.cells) { if (ch.cells[k] && !overwrite) continue; let best = null; for (const s in st.cells[k].by) { const v = st.cells[k].by[s].filter(fin); if (v.length < 3) continue; const m = median(v); if (!best || m > best.m) best = { s, m }; } if (best) { ch.cells[k] = best.s; n++; } }
  return n;
}
function chartFillGaps(ch) { const have = Object.keys(ch.cells).map(k => ({ w: +k.split('|')[0], a: +k.split('|')[1], s: ch.cells[k] })); let n = 0; if (!have.length) return 0; for (const w of CH_TWS) for (const a of CH_TWA) { const k = w + '|' + a; if (ch.cells[k]) continue; let b = null, bd = 9.01; for (const h of have) { const d = ((h.w - w) / 2) ** 2 + ((h.a - a) / 10) ** 2 * 2; if (d < bd) { bd = d; b = h; } } if (b) { ch.cells[k] = b.s; n++; } } return n; }
Object.assign(SL, { outline, CH_TWS, CH_TWA, chKey, newChart, chartAt, chartSail, chartEmpty, sailOn, sailTokens, inPoly, parseSailChart, chartXml, chartStats, chartFromData, chartFillGaps });
Object.assign(SL, { calCurrent, solve, calBsp, calWind, calAwa, calScore, eventsXml, parseSailList, suggestMarks, SVARS, dayRecord, seasonPool, seasonFromPhaseCsv, seasonFromTackCsv, seasonMergeMans, seasonMerge, newSeason, crossover, csvParse, BANDS });
})();
