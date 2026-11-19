'use strict';
/* SailLens UI infrastructure: DOM helpers, canvas plotting, colour scales, reusable blocks. */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) { const e = document.createElement(tag); for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (k === 'style') e.style.cssText = v; else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c); return e; }
const fin = Number.isFinite, f1 = (v, d = 1) => fin(v) ? v.toFixed(d) : '–';
const A = { scope: 'day', S: null, SP: [], SK: new Set(), sdays: null, raw: null, events: null, polar: null, cfg: { ...SL.DEF, dispOff: 0 }, D: null, cur: 0, demo: false, files: {}, filt: { sails: '', leg: '', tack: '', day: '' }, tab: 'setup', playing: false, speed: 30 };
const pad2 = n => String(n).padStart(2, '0');
function tparts(ms) { const d = new Date(ms + A.cfg.dispOff * 36e5); return [d.getUTCFullYear(), pad2(d.getUTCMonth() + 1), pad2(d.getUTCDate()), pad2(d.getUTCHours()), pad2(d.getUTCMinutes()), pad2(d.getUTCSeconds())]; }
const tstr = ms => { const p = tparts(ms); return p[3] + ':' + p[4] + ':' + p[5]; };
const dstr = ms => { const p = tparts(ms); return p[0] + '-' + p[1] + '-' + p[2] + ' ' + p[3] + ':' + p[4] + ':' + p[5]; };
const dur = s => pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(Math.floor(s % 60));
const iT = i => A.raw.t0 + i * 1000;
const season = () => A.scope === 'season';
const pool = () => season() ? A.SP : (A.D ? WF.filteredPhases(A.D.phases) : []);
const hasVar = k => season() ? A.SK.has(k) : !!(A.D && A.D.ch[k]);
const manualKeys = () => season() ? ['Mast_Base'].filter(hasVar) : Object.keys(A.D.L.manual);
const ptime = p => p.i == null ? p.day + ' ' + new Date(p.t + (p.off || 0) * 36e5).toISOString().slice(11, 19) : tstr(p.t);

/* ---- theme & colour ---- */
let _css = null; const css = n => { if (!_css) _css = getComputedStyle(document.documentElement); return _css.getPropertyValue(n).trim(); };
const SER = i => css('--s' + ((i % 8) + 1));
const hex2 = c => { c = c.replace('#', ''); return [0, 2, 4].map(k => parseInt(c.slice(k, k + 2), 16)); };
const mix = (a, b, f) => { const x = hex2(a), y = hex2(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',') + ')'; };
const alpha = (c, a) => { if (c.startsWith('#')) return 'rgba(' + hex2(c).join(',') + ',' + a + ')'; return c.replace('rgb(', 'rgba(').replace(')', ',' + a + ')'); };
function scale(name, vals) {
  const pct = /%/.test(name), dl = name[0] === 'Δ' || name === 'HDG-COG' || name === 'BSP-SOG';
  if (pct || dl) { const c = pct && name[0] !== 'Δ' ? 100 : 0, r = pct ? (name[0] === 'Δ' ? 10 : 15) : (SL.quant(vals.map(Math.abs), 0.95) || 1); return { lo: c - r, hi: c + r, mid: c, div: true, col: v => { if (!fin(v)) return css('--muted'); const f = Math.max(-1, Math.min(1, (v - c) / r)); return f < 0 ? mix(css('--div-mid'), css('--div-lo'), -f) : mix(css('--div-mid'), css('--div-hi'), f); } }; }
  const lo = SL.quant(vals, 0.03), hi = SL.quant(vals, 0.97);
  return { lo, hi, col: v => fin(v) ? mix(css('--seq0'), css('--seq1'), Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)))) : css('--muted') };
}
/* stable categorical colours: colour follows the entity, not its rank in the current filter */
function catInfo(by) {
  const ph = pool(), key = by === 'Day' ? p => p.day || 'This day' : by === 'Tack' ? p => p.tack : by === 'Sails' ? p => p.sails : by === 'Race leg' ? p => p.raceLeg : by === 'Mode' ? p => p.mode : by === 'TWS bin' ? p => 'TWS ' + pad2(Math.round(p.v.TWS / 2) * 2) : () => 'All';
  if (by === 'Tack') return { key, col: k => k === 'Port' ? css('--port') : css('--stbd'), all: ['Port', 'Stbd'] };
  const cnt = {}; ph.forEach(p => { const k = key(p); cnt[k] = (cnt[k] || 0) + 1; });
  let all = Object.keys(cnt).sort(); if (by === 'TWS bin') return { key, all, col: k => mix(css('--seq0'), css('--seq1'), all.length > 1 ? 0.25 + 0.75 * all.indexOf(k) / (all.length - 1) : 1) };
  const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 7).sort();
  return { all: top.concat(all.length > 7 ? ['Other'] : []), key: p => top.includes(key(p)) ? key(p) : 'Other', col: k => k === 'Other' ? css('--muted') : SER(top.indexOf(k)) };
}
function legend(items) { return h('div', { class: 'legend' }, items.map(([c, t, shape]) => h('span', {}, h('i', { class: shape === 'tri' ? 'tri' : '', style: shape === 'tri' ? 'border-bottom-color:' + c : 'background:' + c }), t))); }

/* ---- canvas plot ---- */
function ticks(lo, hi, n) { const sp = (hi - lo) || 1, st0 = Math.pow(10, Math.floor(Math.log10(sp / n))), e = sp / n / st0, st = st0 * (e >= 5 ? 5 : e >= 2 ? 2 : 1), out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-6; v += st) out.push(Math.abs(v) < st * 1e-6 ? 0 : v); return { out, dec: Math.max(0, -Math.floor(Math.log10(st) + 1e-9)) }; }
function plot(cv, o) {
  const W = o.w || cv.parentElement.clientWidth || 700, H = o.h || 260, d = window.devicePixelRatio || 1;
  cv.width = W * d; cv.height = H * d; cv.style.height = H + 'px'; const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, W, H);
  const pl = o.pl ?? 46, pr = o.pr ?? 12, pt = o.title ? 26 : 10, pb = o.pb ?? (o.xl ? 38 : 22);
  let [x0, x1] = o.xr, [y0, y1] = o.yr; if (x0 === x1) { x0 -= 1; x1 += 1; } if (y0 === y1) { y0 -= 1; y1 += 1; }
  const g = { c, W, H, pl, pr, pt, pb, X: v => pl + (v - x0) / (x1 - x0) * (W - pl - pr), Y: v => H - pb - (v - y0) / (y1 - y0) * (H - pt - pb), xr: [x0, x1], yr: [y0, y1] };
  cv._hits = []; c.font = '11px ' + css('--font'); c.lineWidth = 1;
  const tx = ticks(x0, x1, Math.max(2, Math.floor((W - pl - pr) / (o.xTickGap || 70)))), ty = ticks(y0, y1, Math.max(2, Math.floor((H - pt - pb) / 34)));
  c.strokeStyle = css('--grid'); c.fillStyle = css('--muted'); c.beginPath();
  if (!o.noX) for (const v of tx.out) { c.moveTo(g.X(v), pt); c.lineTo(g.X(v), H - pb); } for (const v of ty.out) { c.moveTo(pl, g.Y(v)); c.lineTo(W - pr, g.Y(v)); } c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'top'; if (!o.noX) for (const v of tx.out) c.fillText(o.xfmt ? o.xfmt(v) : v.toFixed(tx.dec), g.X(v), H - pb + 5);
  c.textAlign = 'right'; c.textBaseline = 'middle'; for (const v of ty.out) c.fillText(v.toFixed(ty.dec) + (o.ysuf || ''), pl - 6, g.Y(v));
  c.fillStyle = css('--ink2'); c.textAlign = 'center'; c.textBaseline = 'bottom'; if (o.xl) c.fillText(o.xl, pl + (W - pl - pr) / 2, H - 4);
  if (o.yl) { c.save(); c.translate(11, pt + (H - pt - pb) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText(o.yl, 0, 0); c.restore(); }
  if (o.title) { c.fillStyle = css('--ink'); c.font = '600 12px ' + css('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(o.title, pl, 6); c.font = '11px ' + css('--font'); }
  g.zero = v => { if (v > y0 && v < y1) { c.strokeStyle = css('--ink2'); c.beginPath(); c.moveTo(pl, g.Y(v)); c.lineTo(W - pr, g.Y(v)); c.stroke(); } };
  g.line = (pts, col, w = 2) => { c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.beginPath(); let on = false; for (const p of pts) { if (!fin(p[0]) || !fin(p[1])) { on = false; continue; } const X = g.X(p[0]), Y = Math.max(pt - 2, Math.min(H - pb + 2, g.Y(p[1]))); on ? c.lineTo(X, Y) : c.moveTo(X, Y); on = true; } c.stroke(); c.lineWidth = 1; };
  g.dot = (x, y, col, tip, data, tri, r = 3.5) => { if (!fin(x) || !fin(y) || x < x0 || x > x1 || y < y0 || y > y1) return; const X = g.X(x), Y = g.Y(y); c.fillStyle = col; c.strokeStyle = css('--surface'); c.beginPath(); if (tri) { c.moveTo(X, Y - r - 1); c.lineTo(X + r + 0.5, Y + r); c.lineTo(X - r - 0.5, Y + r); c.closePath(); } else c.arc(X, Y, r, 0, 7); c.fill(); c.stroke(); if (tip) cv._hits.push([X, Y, tip, data]); };
  g.label = (t, x, y, col, al = 'left') => { c.font = '600 11px ' + css('--font'); const w = c.measureText(t).width + 8, X = Math.max(pl + 2, Math.min(W - pr - w - 2, g.X(x) - (al === 'center' ? w / 2 : 0))), Y = Math.max(pt + 2, Math.min(H - pb - 18, g.Y(y) - 8)); c.fillStyle = css('--surface'); c.strokeStyle = col; c.beginPath(); c.roundRect(X, Y, w, 16, 4); c.fill(); c.stroke(); c.fillStyle = css('--ink'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(t, X + 4, Y + 8.5); c.font = '11px ' + css('--font'); };
  g.note = (t, top) => { c.fillStyle = css('--muted'); c.font = '600 10px ' + css('--font'); c.textAlign = 'left'; c.textBaseline = top ? 'top' : 'bottom'; c.fillText(t, pl + 5, top ? pt + 4 : H - pb - 4); c.font = '11px ' + css('--font'); };
  return g;
}
/* one tooltip for every canvas */
const tipEl = h('div', { class: 'tip', hidden: '' });
function initTips() {
  document.body.append(tipEl);
  document.addEventListener('mousemove', e => { const cv = e.target; if (!(cv instanceof HTMLCanvasElement) || !cv._hits || !cv._hits.length) { tipEl.hidden = true; return; } const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let b = null, bd = 196; for (const p of cv._hits) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; b = p; } } if (!b) { tipEl.hidden = true; cv._hot = null; return; } cv._hot = b; tipEl.textContent = String(b[2]).replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]*>/g, ""); tipEl.hidden = false; const tw = tipEl.offsetWidth; tipEl.style.left = Math.min(window.innerWidth - tw - 8, e.clientX + 14) + 'px'; tipEl.style.top = (e.clientY + 14) + 'px'; });
  document.addEventListener('click', e => { const cv = e.target; if (cv instanceof HTMLCanvasElement && cv._hot && cv._hot[3] && cv._hot[3].i != null) { A.cur = cv._hot[3].i; show('chart'); } });
}
const ptip = (p, extra) => `<b>${ptime(p)}</b> ${p.mode} · ${p.tack} · ${p.sails}${p.race ? ' · ' + p.raceLeg : ''}<br>TWS ${f1(p.v.TWS)} · TWA ${f1(Math.abs(p.v.TWA))} · BSP ${f1(p.v.BSP, 2)} · pol ${f1(p.v['BSPpol%'])}%${extra ? '<br>' + extra : ''}`;

/* ---- tables ---- */
function table(head, rows, cls) {
  const t = h('table', { class: 'tbl ' + (cls || '') }, h('thead', {}, h('tr', {}, head.map(x => h('th', {}, x)))));
  const tb = h('tbody'); for (const r of rows) tb.append(h('tr', r._attrs || {}, r.map(c => (c && typeof c === 'object' && !(c instanceof Node)) ? h('td', { style: c.s || '', class: c.c || '' }, c.t) : h('td', {}, c ?? ''))));
  t.append(tb); return h('div', { class: 'scroll' }, t);
}
const heat = (v, sc) => fin(v) ? 'background:' + alpha(sc.col(v), 0.55) : '';
const sel = (id, opts, val, on) => { const s = h('select', { id, onchange: e => on(e.target.value) }, opts.map(o => h('option', { value: o, selected: o === val ? '' : null }, o === '' ? 'All' : o))); return s; };
const field = (lab, ctl) => h('label', { class: 'field' }, h('span', {}, lab), ctl);

/* ---- phase filtering ---- */
function phases(mode) { const f = A.filt; return pool().filter(p => (!f.day || !season() || p.day === f.day) && (!mode || mode === 'All' || p.mode === mode || (mode === 'Reaching' && p.mode === 'BroadReaching')) && (!f.sails || p.sails === f.sails) && (!f.leg || p.raceLeg === f.leg || (f.leg === 'Racing' && p.race)) && (!f.tack || p.tack === f.tack)); }
function filterBar(redraw) {
  const u = k => [...new Set(pool().map(k))].sort();
  return (season() ? [field('Day', sel('f-day', [''].concat(u(p => p.day)), A.filt.day, v => { A.filt.day = v; redraw(); }))] : []).concat([field('Sails', sel('f-sails', [''].concat(u(p => p.sails)), A.filt.sails, v => { A.filt.sails = v; redraw(); })),
    field('Race / leg', sel('f-leg', ['', 'Racing'].concat(u(p => p.raceLeg).filter(x => x !== '-')), A.filt.leg, v => { A.filt.leg = v; redraw(); })),
    field('Tack', sel('f-tack', ['', 'Port', 'Stbd'], A.filt.tack, v => { A.filt.tack = v; redraw(); }))]);
}
function varList() { const first = ['TWS', 'absTWA', 'TWA', 'BSP', 'BSPpol%', 'BSP_trg%', 'VMG', 'VMG%', 'ΔBSP', 'ΔTWA', 'ΔVMG', 'ΔVMG%', 'Heel', 'Heel_norm', 'abs_heel', 'Rudder', 'Rudder_norm', 'abs_rudder', 'Forestay', 'Trim', 'Leeway', 'AWA', 'absAWA', 'AWS', 'TWD', 'HDG', 'COG', 'SOG', 'BSP-SOG', 'HDG-COG'].filter(hasVar); const skip = /^(Lat|Lon|GPS|Gps|PDOP|Altitude|GeoSep|Mk |Port l|Stbd l|TWD[+-]|DistToLn|Rch|TmTo|Burn|BelowLn|GunBlw|User|HPE|DiffStn|MagVar|Stbd tack)/; const all = season() ? [...A.SK] : Object.keys(A.D.ch); return first.concat(all.filter(k => !first.includes(k) && !skip.test(k)).sort()); }

/* ================= reusable blocks (used by tabs and by the report) ================= */
function blkSummary(c) {
  const D = A.D, s = D.sum, m = (A.events && A.events.meta) || {}, pc = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '';
  c.append(h('div', { class: 'cols' },
    h('div', {}, table(['', ''], [['Boat', A.cfg.boat || m.boat || '–'], ['Event / location', [m.desc, m.location].filter(Boolean).join(' · ') || '–'], ['Day type', m.daytype || '–'], ['Start', dstr(s.t0)], ['End', dstr(s.t1)], ['Sails used', s.sails.join(', ') || '–'], ['Polar', D.polarSrc === 'file' ? (A.files.polar || 'loaded file') : D.polarSrc === 'log' ? 'targets logged by Expedition' : D.polarSrc === 'learned' ? 'learned from this data' : 'none']], 'kv')),
    h('div', {}, table(['Stats', 'Min', 'Avg', 'Max'], [['BSP (kn)', f1(s.BSP.min), { t: f1(s.BSP.avg), c: 'b' }, f1(s.BSP.max)], ['TWS (kn)', f1(s.TWS.min), { t: f1(s.TWS.avg), c: 'b' }, f1(s.TWS.max)], s.TWD ? ['TWD (°)', f1(s.TWD.min, 0), { t: f1(s.TWD.avg, 0), c: 'b' }, f1(s.TWD.max, 0)] : ['TWD', '–', '–', '–'],
      ['Tacks / gybes', s.tacks + ' / ' + s.gybes, '', ''], ['Sailing time', dur(s.sailing), '', ''], ['Active (pol% > 80)', dur(s.active), pc(s.active, s.sailing), ''], ['Racing', dur(s.racing), pc(s.racing, s.sailing), ''], ['Trip distance', f1(s.dist, 2) + ' nm', '', ''], ['Phases', D.phases.length + ' × ' + D.cfg.phaseLen + ' s', '', '']], 'num'))));
}
const TWAB = [35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const nearest = (arr, v) => arr.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b, arr[0]);
function blkBins(c, v) {
  const ps = phases(), bin = {}; if (!ps.length) { c.append(h('p', { class: 'muted' }, 'No phases match the current filter.')); return; }
  for (const p of ps) { const k = Math.max(4, Math.round(p.v.TWS / 2) * 2) + '|' + nearest(TWAB, Math.abs(p.v.TWA)); (bin[k] = bin[k] || []).push(p); }
  const tws = [...new Set(Object.keys(bin).map(k => +k.split('|')[0]))].sort((a, b) => b - a), used = TWAB.filter(a => tws.some(w => bin[w + '|' + a]));
  const mx = Math.max(...Object.values(bin).map(b => b.length)), sails = catInfo('Sails'), vs = v ? scale(v, ps.map(p => p.v[v])) : null;
  const mk = (title, cell) => h('div', {}, h('h4', {}, title), table(['TWS \\ TWA'].concat(used), tws.map(w => [{ t: w, c: 'b' }].concat(used.map(a => { const b = bin[w + '|' + a]; return b ? cell(b) : ''; }))), 'num bins'));
  c.append(mk('Bin count (phases)', b => ({ t: b.length, s: 'background:' + alpha(css('--seq1'), 0.08 + 0.5 * b.length / mx) })),
    mk('Sails up (most used in bin)', b => { const sname = SL.mostCommon(b.map(p => p.sails)); return { t: sname, s: 'background:' + alpha(sails.col(sails.all.includes(sname) ? sname : 'Other'), 0.3) + ';font-size:10px' }; }));
  if (v) c.append(mk('Average ' + v, b => { const x = SL.mean(b.map(p => p.v[v])); return { t: f1(x, /%/.test(v) ? 0 : 1), s: heat(x, vs) }; }));
}
function blkLegs(c) {
  const D = A.D; if (!D.legs.length) { c.append(h('p', { class: 'muted' }, 'No legs found.')); return; }
  const ex = ['Forestay'].concat(manualKeys()).filter(hasVar), s1 = scale('BSPpol%', []), s2 = scale('ΔTWA', [6]);
  const ar = { Upwind: '↑ Up', Downwind: '↓ Down', Reaching: '→ Reach', BroadReaching: '↘ Broad' };
  const tlm = {}; SL.timeLost(D).legs.forEach(l => { tlm[l.name] = l; });
  c.append(table(['Leg', 'Mode', 'Duration', 'Sails', 'Ph', 'TWS', 'BSP', 'BSP_trg%', 'BSPpol%', 'TWA', 'ΔTwaTrg', 'VMG', 'VMG%', 'Heel', 'Rudder'].concat(ex, ['Lost s', 'Tacks', 'Fav %']),
    D.legs.map(l => [{ t: l.name, c: 'b' }, ar[l.mode], dur(l.dur), l.sails, l.n, f1(l.v.TWS), f1(l.v.BSP, 2), { t: f1(l.v['BSP_trg%']), s: heat(l.v['BSP_trg%'], s1) }, { t: f1(l.v['BSPpol%']), s: heat(l.v['BSPpol%'], s1) }, f1(l.v.absTWA), { t: f1(l.v['ΔTWA']), s: heat(-Math.abs(l.v['ΔTWA']) + 3, s2) }, f1(l.v.VMG, 2), { t: f1(l.v['VMG%']), s: heat(l.v['VMG%'], s1) }, f1(l.v.Heel), f1(l.v.Rudder)].concat(ex.map(k => f1(l.v[k], 2)), tlm[l.name] ? [{ t: f1(tlm[l.name].total, 0), c: 'b' }, tlm[l.name].tacks, fin(tlm[l.name].fav) ? f1(tlm[l.name].fav, 0) : '–'] : ['', '', ''])), 'num'));
}
function blkDist(c, mode) {
  const D = A.D, md = SL.MODES.indexOf(mode), vars = ['TWS', 'absTWA', 'BSPpol%', 'BSP_trg%', 'abs_heel', 'abs_rudder'].filter(k => D.ch[k]);
  const g = h('div', { class: 'grid2' }), jobs = []; c.append(legend([[css('--port'), 'Port'], [css('--stbd'), 'Stbd']]), g);
  for (const k of vars) {
    const a = D.ch[k], P = [], S = []; for (let i = D.i0; i < D.i1; i++) if (D.mode[i] === md && D.ch.BSP[i] > D.cfg.minBsp && fin(a[i])) (D.tack[i] < 0 ? P : S).push(a[i]);
    const all = P.concat(S); if (all.length < 30) continue; let lo = SL.quant(all, 0.01), hi = SL.quant(all, 0.99); if (/%/.test(k)) { lo = Math.max(lo, 80); hi = Math.min(hi, 120); }
    const nb = 30, w = (hi - lo) / nb || 1, hp = new Array(nb).fill(0), hs = new Array(nb).fill(0); for (const v of P) { const b = Math.floor((v - lo) / w); if (b >= 0 && b < nb) hp[b]++; } for (const v of S) { const b = Math.floor((v - lo) / w); if (b >= 0 && b < nb) hs[b]++; }
    const tot = all.length, mx = Math.max(...hp, ...hs) / tot * 100, cv = h('canvas'); g.append(h('div', {}, cv));
    jobs.push(() => {
    const p = plot(cv, { xr: [lo, hi], yr: [0, mx * 1.1], xl: k, yl: 'time %', title: k + ' · ' + mode, h: 200 }), bw = Math.max(1, (p.X(lo + w) - p.X(lo)) / 2 - 1);
    for (let b = 0; b < nb; b++) for (const [arr, col, off] of [[hp, css('--port'), 0], [hs, css('--stbd'), bw + 1]]) { if (!arr[b]) continue; const y = p.Y(arr[b] / tot * 100), x = p.X(lo + b * w) + off; p.c.fillStyle = col; p.c.fillRect(x, y, bw, p.H - p.pb - y); cv._hits.push([x + bw / 2, y, `${k} ${f1(lo + b * w)}–${f1(lo + (b + 1) * w)}<br>${off ? 'Stbd' : 'Port'}: ${(arr[b] / tot * 100).toFixed(1)}% of time`]); }
    });
  }
  jobs.forEach(j => j());
}
/* trend settings shared by every phase scatter (XY, Performance, report) */
function trendCfg() { return A.trend = A.trend || { type: 'Local (smooth)', fvar: '', fmin: '', hide: false, band: false, resid: false }; }
const trendSel = () => { const T = trendCfg(); return T.fvar && T.fmin !== '' && fin(+T.fmin) ? p => p.v[T.fvar] >= +T.fmin : null; };
function trendControls(redraw, o) {
  const T = trendCfg(), vars = varList();
  return [field('Trend line', sel('tr-type', SL.TRENDS, T.type, v => { T.type = v; redraw(); })),
    field('Fit trend only where', sel('tr-fvar', [''].concat(vars), T.fvar, v => { T.fvar = v; if (v && T.fmin === '') T.fmin = /%/.test(v) ? '98' : ''; redraw(); })),
    field('is at least', h('input', { type: 'number', id: 'tr-fmin', step: 'any', value: T.fmin, style: 'width:84px', onchange: e => { T.fmin = e.target.value; redraw(); } })),
    field('Hide the rest', h('input', { type: 'checkbox', id: 'tr-hide', checked: T.hide ? '' : null, onchange: e => { T.hide = e.target.checked; redraw(); } })),
    field('Uncertainty band', h('input', { type: 'checkbox', id: 'tr-band', checked: T.band ? '' : null, onchange: e => { T.band = e.target.checked; redraw(); } }))].concat(o && o.resid ? [field('Take out TWS', h('input', { type: 'checkbox', id: 'tr-resid', checked: T.resid ? '' : null, onchange: e => { T.resid = e.target.checked; redraw(); } }))] : []);
}
const isCol = c => c.startsWith('#') || c.startsWith('rgb');
/* scatter of phases with a trend per group */
function blkXY(c, o) {
  const T = trendCfg(), all = o.ps || phases(o.mode), inSel = trendSel() || (() => true), filt = !!trendSel();
  let gx = p => o.fx ? o.fx(p) : p.v[o.x], gy = p => o.fy ? o.fy(p) : p.v[o.y], sfx = '';
  if (o.resid && T.resid && o.x !== 'TWS' && o.y !== 'TWS') { const tw = all.map(p => p.v.TWS), rx = SL.residual(tw, all.map(gx)), ry = SL.residual(tw, all.map(gy)), mx = new Map(all.map((p, i) => [p, rx[i]])), my = new Map(all.map((p, i) => [p, ry[i]])); gx = p => mx.get(p); gy = p => my.get(p); sfx = ' (TWS taken out)'; }
  const ok = all.filter(p => fin(gx(p)) && fin(gy(p))), pts = T.hide && filt ? ok.filter(inSel) : ok; if (pts.length < 3) { c.append(h('p', { class: 'muted' }, `Not enough phases for ${o.y} vs ${o.x}.`)); return null; }
  const cvS = o.cvar && hasVar(o.cvar) ? scale(o.cvar, pts.map(p => p.v[o.cvar])) : null, ci = cvS ? { all: ['All'], key: () => 'All', col: () => css('--ink') } : catInfo(o.by || 'Tack');
  const xs = pts.map(gx), ys = pts.map(gy), q = (a, f) => SL.quant(a, f), xr = [q(xs, 0.005), q(xs, 0.995)], yr0 = [q(ys, 0.01), q(ys, 0.99)], pd = (yr0[1] - yr0[0]) * 0.08 || 1, yr = [yr0[0] - pd, yr0[1] + pd], px = (xr[1] - xr[0]) * 0.03 || 1;
  const cv = h('canvas'); c.append(h('div', {}, cv));
  const xl = (o.xl || o.x) + sfx, yl = (o.yl || o.y) + sfx, p = plot(cv, { xr: [xr[0] - px, xr[1] + px], yr, xl, yl, title: o.title, h: o.h || 300, ysuf: o.ysuf });
  if (o.zero != null && !sfx) p.zero(o.zero); if (o.notes) { p.note(o.notes[0], true); p.note(o.notes[1], false); }
  const sel = pts.filter(inSel), trends = [], lab = filt ? `${T.fvar} ≥ ${T.fmin}` : '';
  if (T.type !== 'None' && o.trend !== false) for (const k of ci.all) { const g = sel.filter(pt => ci.key(pt) === k); if (g.length < 6) continue; const gxs = g.map(gx), gys = g.map(gy), col = ci.col(k), l = SL.fitTrend(gxs, gys, T.type, 30); if (!l.length) continue;
    if (T.band && ci.all.length <= 4) { const bd = SL.trendBand(gxs, gys, T.type, 24, 50); if (bd.length) { const x = p.c, cl = v => Math.max(p.pt, Math.min(p.H - p.pb, p.Y(v))); x.fillStyle = alpha(isCol(col) ? col : css('--ink'), 0.16); x.beginPath(); bd.forEach((d, i) => { i ? x.lineTo(p.X(d[0]), cl(d[2])) : x.moveTo(p.X(d[0]), cl(d[2])); }); for (let i = bd.length - 1; i >= 0; i--) x.lineTo(p.X(bd[i][0]), cl(bd[i][1])); x.closePath(); x.fill(); } }
    trends.push({ k, l, n: g.length, col }); }
  for (const pt of pts) { const on = inSel(pt), col = cvS ? cvS.col(pt.v[o.cvar]) : ci.col(ci.key(pt)); p.dot(gx(pt), gy(pt), on ? col : alpha(isCol(col) ? col : css('--muted'), 0.28), ptip(pt, `${xl} ${f1(gx(pt), 2)} · ${yl} ${f1(gy(pt), 2)}` + (cvS ? ` · ${o.cvar} ${f1(pt.v[o.cvar], 1)}` : '')), pt, pt.tack === 'Stbd', on ? 3 : 2.5); }
  for (const t of trends) { p.line(t.l, t.col, 2.5); const mid = t.l[Math.floor(t.l.length / 2)], txt = [ci.all.length > 1 ? t.k : '', lab].filter(Boolean).join(' · '); if (txt && mid) p.label(txt, mid[0], mid[1], t.col, 'center'); }
  if (cvS) { const x = p.c, lw = 110, lx = p.W - p.pr - lw - 8, ly = p.pt + 6; x.fillStyle = alpha(css('--surface'), 0.85); x.fillRect(lx - 6, ly - 4, lw + 12, 36); for (let i = 0; i < lw; i++) { x.fillStyle = cvS.col(cvS.lo + i / lw * (cvS.hi - cvS.lo)); x.fillRect(lx + i, ly + 12, 1.5, 8); } x.fillStyle = css('--ink'); x.font = '600 10px ' + css('--font'); x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(o.cvar, lx, ly - 1); x.font = '10px ' + css('--font'); x.fillStyle = css('--ink2'); x.fillText(f1(cvS.lo, 0), lx, ly + 22); x.textAlign = 'right'; x.fillText(f1(cvS.hi, 0), lx + lw, ly + 22); }
  return { n: pts.length, nSel: sel.length, filt, lab, r: SL.corr(xs, ys), rs: SL.spearman(xs, ys), ci, trends, xl, yl, cvS: !!cvS };
}
function blkPerf(c, mode, by) {
  const ps = phases(mode), ci = catInfo(by);
  c.append(legend(ci.all.filter(k => ps.some(p => ci.key(p) === k)).map(k => [ci.col(k), k]).concat([[css('--muted'), '● port tack'], [css('--muted'), 'stbd tack', 'tri']])));
  if (mode === 'Reaching') { blkXY(c, { ps, x: 'absTWA', y: 'BSPpol%', by: by === 'Tack' ? 'TWS bin' : by, title: 'BSPpol% vs |TWA| (reaching)', zero: 100, h: 340, ysuf: '%' }); return; }
  const up = mode === 'Upwind';
  for (const [y, n] of [['ΔBSP', ['Faster', 'Slower']], ['ΔTWA', ['Lower', 'Higher']], ['ΔVMG', ['Better', 'Worse']], ['ΔVMG%', ['Better', 'Worse']]])
    blkXY(c, { ps, x: 'TWS', y, by, zero: 0, notes: n, h: 190, xl: y === 'ΔVMG%' ? 'TWS (kn)' : '', ysuf: y === 'ΔTWA' ? '°' : y === 'ΔVMG%' ? '%' : '' });
}
/* track map */
function mapGeom(D) { if (D._geo) return D._geo; const la = D.ch.Lat, lo = D.ch.Lon; if (!la || !lo) return null; const la0 = SL.median(la.subarray(D.i0, D.i1)), k = Math.cos(la0 * SL.D2R), x = new Float64Array(D.n), y = new Float64Array(D.n); let a = Infinity, b = -Infinity, cc = Infinity, d = -Infinity; for (let i = D.i0; i < D.i1; i++) { x[i] = lo[i] * k; y[i] = -la[i]; if (fin(x[i]) && fin(y[i])) { if (x[i] < a) a = x[i]; if (x[i] > b) b = x[i]; if (y[i] < cc) cc = y[i]; if (y[i] > d) d = y[i]; } } return D._geo = { x, y, bx: [a, b], by: [cc, d], k }; }
function drawMap(cv, o) {
  const D = A.D, G = mapGeom(D), W = o.w || cv.parentElement.clientWidth || 700, H = o.h || 520, dp = window.devicePixelRatio || 1;
  cv.width = W * dp; cv.height = H * dp; cv.style.height = H + 'px'; const c = cv.getContext('2d'); c.setTransform(dp, 0, 0, dp, 0, 0); c.fillStyle = css('--water'); c.fillRect(0, 0, W, H);
  if (!G || !fin(G.bx[0])) { c.fillStyle = css('--muted'); c.font = '13px ' + css('--font'); c.fillText('Geen geldige GPS-posities in dit log.', 20, 30); return null; }
  const v = o.view, rot=(o.bearing||0)*SL.D2R, co=Math.cos(rot), si=Math.sin(rot);
  const bx=o.bounds?.bx||G.bx, by=o.bounds?.by||G.by, dx=bx[1]-bx[0], dy=by[1]-by[0];
  const s0=Math.min((W-60)/Math.max(1e-6,Math.abs(dx*co)+Math.abs(dy*si)),(H-60)/Math.max(1e-6,Math.abs(dx*si)+Math.abs(dy*co))), sc=s0*(v?.z||1);
  const cx=(bx[0]+bx[1])/2, cy=(by[0]+by[1])/2;
  const X=i=>W/2+((G.x[i]-cx)*co+(G.y[i]-cy)*si)*sc-(v?.x||0)*(v?.z||1);
  const Y=i=>H/2+((G.y[i]-cy)*co-(G.x[i]-cx)*si)*sc-(v?.y||0)*(v?.z||1);
  // graticule: 1 nm squares
  const nm = sc / 60, stepNm = nm > 200 ? 0.25 : nm > 60 ? 1 : nm > 12 ? 5 : 20; c.strokeStyle = css('--grid'); c.lineWidth = 1; c.beginPath(); for (let gx = (W / 2) % (nm * stepNm); gx < W; gx += nm * stepNm) { c.moveTo(gx, 0); c.lineTo(gx, H); } for (let gy = (H / 2) % (nm * stepNm); gy < H; gy += nm * stepNm) { c.moveTo(0, gy); c.lineTo(W, gy); } c.stroke();
  c.fillStyle = css('--muted'); c.font = '10px ' + css('--font'); c.textAlign = 'left'; c.fillText('grid ' + stepNm + ' nm · ' + (o.bearing==null?'North up':'Wind up '+Math.round(o.bearing)+'°'), 8, H - 8);
  const [lo,hi]=o.range||[D.i0,D.i1];
  const a = D.ch[o.v], vals = []; for (let i = lo; i < hi; i += 7) if (a && fin(a[i]) && D.ch.BSP[i] > 1) vals.push(a[i]); const S = a ? scale(o.v, vals) : null;
  const NB = 24, buckets = Array.from({ length: NB + 1 }, () => []), bk = val => !fin(val) ? NB : Math.max(0, Math.min(NB - 1, Math.floor((val - S.lo) / ((S.hi - S.lo) || 1) * NB)));
  for (let i = lo + 1; i < hi; i++) { if (!fin(G.x[i]) || !fin(G.x[i - 1])) continue; buckets[S ? bk(a[i]) : 0].push(i); }
  c.lineWidth = 3; c.lineCap = 'round';
  buckets.forEach((b, k) => { if (!b.length) return; c.strokeStyle = !S ? css('--s1') : k === NB ? css('--muted') : S.col(S.lo + (k + 0.5) / NB * (S.hi - S.lo)); c.beginPath(); for (const i of b) { c.moveTo(X(i - 1), Y(i - 1)); c.lineTo(X(i), Y(i)); } c.stroke(); });
  if (o.barbs && D.ch.TWD) { const st = Math.max(60, Math.round((D.i1 - D.i0) / 45)); c.strokeStyle = css('--ink2'); c.fillStyle = css('--ink2'); c.lineWidth = 1; c.font = '10px ' + css('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; for (let i = D.i0 + st; i < D.i1; i += st) { if (!fin(G.x[i]) || !fin(D.ch.TWD[i]) || !(D.ch.BSP[i] > 1)) continue; const t = (D.ch.TWD[i] + D.magVar) * SL.D2R, x = X(i), y = Y(i), ux = Math.sin(t), uy = -Math.cos(t); c.beginPath(); c.moveTo(x, y); c.lineTo(x + ux * 20, y + uy * 20); c.moveTo(x + ux * 20, y + uy * 20); c.lineTo(x + ux * 20 + uy * 6 - ux * 3, y + uy * 20 - ux * 6 - uy * 3); c.stroke(); c.fillText(f1(D.ch.TWS[i], 0), x + ux * 30, y + uy * 30); } }
  c.font = '600 10px ' + css('--font'); c.textAlign = 'left'; c.textBaseline = 'middle';
  for (const m of D.mans) { if(m.i<lo||m.i>=hi)continue; c.fillStyle = css('--surface'); c.strokeStyle = css('--ink'); c.lineWidth = 1.5; c.beginPath(); c.arc(X(m.i), Y(m.i), 3.5, 0, 7); c.fill(); c.stroke(); }
  let ly = -99, lx = -99; for (const e of D.L.list) { if (!e.label || e.i < lo || e.i >= hi || !fin(G.x[e.i])) continue; const x = X(e.i), y = Y(e.i), race = e.type !== 'SailsUp'; c.fillStyle = race ? css('--ink') : css('--surface'); c.strokeStyle = css('--ink'); c.lineWidth = 1.5; c.beginPath(); c.rect(x - 4, y - 4, 8, 8); c.fill(); c.stroke(); if (Math.abs(y - ly) < 12 && Math.abs(x - lx) < 80) continue; ly = y; lx = x; const t = e.label; c.lineWidth = 3; c.strokeStyle = css('--surface'); c.strokeText(t, x + 8, y); c.fillStyle = css('--ink'); c.fillText(t, x + 8, y); }
  // wind arrow (mean TWD, arrow points downwind)
  if (D.sum.TWD) { const t = (D.sum.TWD.avg + D.magVar) * SL.D2R - rot, ax = W - 46, ay = 48, dx = -Math.sin(t), dy = Math.cos(t); c.strokeStyle = c.fillStyle = css('--ink2'); c.lineWidth = 2.5; c.beginPath(); c.moveTo(ax - dx * 24, ay - dy * 24); c.lineTo(ax + dx * 20, ay + dy * 20); c.stroke(); c.beginPath(); c.moveTo(ax + dx * 28, ay + dy * 28); c.lineTo(ax + dx * 14 - dy * 7, ay + dy * 14 + dx * 7); c.lineTo(ax + dx * 14 + dy * 7, ay + dy * 14 - dx * 7); c.fill(); c.font = '600 11px ' + css('--font'); c.textAlign = 'center'; c.fillText('TWD ' + D.sum.TWD.avg.toFixed(0) + '°', ax, ay + 42); }
  if (S) { const lw = 150, lx0 = 12, ly0 = 26; c.fillStyle = alpha(css('--surface'), 0.85); c.fillRect(4, 4, lw + 16, 50); for (let k = 0; k < lw; k++) { c.fillStyle = S.col(S.lo + k / lw * (S.hi - S.lo)); c.fillRect(lx0 + k, ly0, 1.5, 9); } c.fillStyle = css('--ink'); c.font = '600 11px ' + css('--font'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(o.v, lx0, 9); c.font = '10px ' + css('--font'); c.fillStyle = css('--ink2'); c.fillText(f1(S.lo), lx0, ly0 + 12); c.textAlign = 'right'; c.fillText(f1(S.hi), lx0 + lw, ly0 + 12); }
  for(const [lo,hi,color] of o.highlights||[]) {
    c.beginPath(); c.lineWidth=5; c.strokeStyle=color; let active=false;
    for(let i=Math.max(D.i0,lo);i<Math.min(D.i1,hi);i++){
      if(!fin(X(i))||!fin(Y(i))){active=false;continue;}
      if(active)c.lineTo(X(i),Y(i));else c.moveTo(X(i),Y(i));active=true;
    }
    c.stroke();
  }
  if (o.cur != null && fin(G.x[o.cur])) { const x = X(o.cur), y = Y(o.cur), hd = ((D.ch.HDG ? D.ch.HDG[o.cur] + D.magVar : D.ch.COG ? D.ch.COG[o.cur] : 0) || 0) * SL.D2R; c.save(); c.translate(x, y); c.rotate(hd-rot); c.fillStyle = css('--accent'); c.strokeStyle = css('--surface'); c.lineWidth = 2; c.beginPath(); c.moveTo(0, -13); c.lineTo(7, 9); c.lineTo(0, 5); c.lineTo(-7, 9); c.closePath(); c.fill(); c.stroke(); c.restore(); }
  return { X, Y, s0 };
}
function blkCal(c, off) {
  const D = A.D, ct = SL.calTable(D), keys = ['TWS', 'TWA', 'Heel', 'BSP', 'SOG', 'BSP-SOG', 'BSP/SOG%', 'HDG', 'COG', 'HDG-COG', 'CUR_DIR', 'CUR_RATE'];
  const rows = []; for (const g of ct) { for (const r of g.rows) rows.push([{ t: g.mode, c: 'b' }, { t: r.tack, s: 'background:' + alpha(css(r.tack === 'Port' ? '--port' : '--stbd'), 0.18) }, r.n].concat(keys.map(k => f1(r[k], k === 'BSP' || k === 'SOG' || k === 'BSP-SOG' ? 2 : 1)))); if (g.rows.length === 2) rows.push(['', { t: 'Δ P−S', c: 'b' }, ''].concat(keys.map(k => ({ t: /HDG$|COG$/.test(k) && k !== 'HDG-COG' ? '' : k === 'CUR_DIR' ? f1(SL.w180(g.rows[0][k] - g.rows[1][k]), 0) : f1(g.rows[0][k] - g.rows[1][k], 2), c: 'b' })))); }
  c.append(h('h4', {}, 'Boat speed: port vs starboard'), table(['Mode', 'Tack', '#Ph'].concat(keys), rows, 'num'), h('p', { class: 'muted' }, 'BSP−SOG that differs by tack points at a paddle-wheel offset or heel correction; an equal offset on both tacks is current or a BSP scale error. HDG−COG mirrors leeway plus current.'));
  const aw = SL.awaTable(D, off || 0); if (aw.some(Boolean)) {
    const r2 = []; for (let k = 0; k < 4; k += 2) { const a = aw[k], b = aw[k + 1]; for (const x of [a, b]) if (x) r2.push([{ t: x.lab, c: 'b' }, x.n, f1(x.oAWA), { t: f1(x.nAWA), c: 'hl' }, f1(x.oTWS), { t: f1(x.nTWS), c: 'hl' }, f1(x.oTWA), { t: f1(x.nTWA), c: 'hl' }]); if (a && b) r2.push([{ t: 'delta', c: 'b' }, '', f1(a.oAWA - b.oAWA), { t: f1(a.nAWA - b.nAWA), c: 'hl b' }, f1(a.oTWS - b.oTWS), { t: f1(a.nTWS - b.nTWS), c: 'hl b' }, f1(a.oTWA - b.oTWA), { t: f1(a.nTWA - b.nTWA), c: 'hl b' }]); }
    c.append(h('h4', {}, 'AWA offset check (offset ' + f1(off || 0) + '°)'), table(['', '#Ph', 'old AWA', 'new AWA', 'old TWS', 'new TWS', 'old TWA', 'new TWA'], r2, 'num'), h('p', { class: 'muted' }, 'True wind is recomputed here from AWA, AWS and BSP only (no leeway or upwash tables), so compare old against new, not against the logged TWA. A positive offset increases AWA on starboard tack.'));
  }
  const sc = scale('ΔTWD', [8]), g = h('div', { class: 'cols' }); c.append(h('h4', {}, 'Wand offset and upwash, manoeuvre by manoeuvre'), g);
  for (const [ty, lab] of [['Tack', 'Upwind: across each tack'], ['Gybe', 'Downwind: across each gybe']]) { const r = SL.twdPairs(D, ty, off ? off : null); if (!r.length) { g.append(h('div', {}, h('p', { class: 'muted' }, lab + ': no usable pairs.'))); continue; }
    const m = k => SL.mean(r.map(x => x[k])), rr = r.map(x => [tstr(iT(x.i)), f1(x.tws), f1(x.awaP), f1(x.awaS), { t: f1(x.awaP - x.awaS), s: heat(x.awaP - x.awaS, sc) }, f1(x.twaP), f1(x.twaS), { t: f1(x.twaP - x.twaS), s: heat(x.twaP - x.twaS, sc) }, f1(x.P), f1(x.S), { t: f1(x.d), s: heat(x.d, sc) }]);
    rr.push([{ t: 'Mean', c: 'b' }, { t: f1(m('tws')), c: 'b' }, { t: f1(m('awaP')), c: 'b' }, { t: f1(m('awaS')), c: 'b' }, { t: f1(m('awaP') - m('awaS')), c: 'b' }, { t: f1(m('twaP')), c: 'b' }, { t: f1(m('twaS')), c: 'b' }, { t: f1(m('twaP') - m('twaS')), c: 'b' }, { t: f1(SL.cmean(r.map(x => x.P))), c: 'b' }, { t: f1(SL.cmean(r.map(x => x.S))), c: 'b' }, { t: f1(m('d')), c: 'b' }]);
    g.append(h('div', {}, h('p', { class: 'b' }, lab), table(['Time', 'TWS', 'AWA port', 'AWA stbd', 'ΔAWA', 'TWA port', 'TWA stbd', 'ΔTWA', 'TWD port', 'TWD stbd', 'ΔTWD'], rr, 'num'))); }
}
