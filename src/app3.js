'use strict';
/* SailLens tabs (part 3): sail chart (crossover chart) and the calibration file editor. */
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } } };
function chartChanged() { store.set('saillens-chart', A.chart); }
const rgb = c => 'rgb(' + c.join(',') + ')';
function sailNames() { const s = new Set(); (A.chart.shapes || []).forEach(x => s.add(x.name)); Object.values(A.chart.cells || {}).forEach(x => s.add(x)); pool().forEach(p => { if (SL.sailTokens(p.sails).length) s.add(p.sails); }); return [...s].sort(); }
/* a sail takes the colour of its area on the chart; anything not on the chart takes the next series colour */
function sailColours() { const byName = {}; (A.chart.shapes || []).forEach(x => { if (x.colour) byName[x.name] = rgb(x.colour); }); let i = 0; const extra = {}; return s => { const t = SL.sailTokens(s); if (byName[s]) return byName[s]; if (t.length && byName[t[0]]) return byName[t[0]]; if (!extra[s]) extra[s] = SER(i++); return extra[s]; }; }

/* ---------------- Sail chart ---------------- */
R.sails = () => {
  const c = pane('sails'), ch = A.chart, st = A.scs = A.scs || { brush: '', edit: false, dots: true, tool: 'points', shape: 0, vi: -1 }, names = sailNames(), col = sailColours(), ps = phases().filter(p => SL.sailTokens(p.sails).length);
  ch.shapes = ch.shapes || []; ch.cells = ch.cells || {};
  if (st.brush !== '(erase)' && !names.includes(st.brush)) st.brush = names[0] || '';
  if (st.shape >= ch.shapes.length) st.shape = 0;
  const stats = SL.chartStats(ch, ps), tot = stats.on + stats.off, nCells = Object.keys(ch.cells).length;
  c.append(h('div', { class: 'kpis' }, kpi('Sail areas', ch.shapes.length, '', nCells ? '+ ' + nCells + ' painted cells' : (ch.polar ? 'made for ' + ch.polar.split(/[\\/]/).pop() : SL.chartEmpty(ch) ? 'chart is empty' : '')), kpi('On the chart', tot ? f1(stats.on / tot * 100, 0) : '–', '%', tot ? stats.on + ' of ' + tot + ' phases' : 'no phases on the chart', tot ? (stats.on / tot > 0.8 ? 'good' : stats.on / tot > 0.6 ? '' : 'warn') : ''), kpi('Off chart', stats.off, '', 'a sail up outside its area'), kpi('Not charted', stats.un, '', 'phases where the chart is blank')));
  const cv = h('canvas', { style: 'touch-action:none' }), info = h('p', { class: 'muted' }, 'Hover the chart to see which sails it allows there and what was sailed.'), nameIn = h('input', { type: 'text', id: 'sc-new', placeholder: 'e.g. J3-26', style: 'width:120px' });
  const fileIn = h('input', { type: 'file', id: 'file-chart2', hidden: '', accept: '.xml,.json', onchange: e => e.target.files[0] && loadFile(e.target.files[0], 'chart') });
  const act = (lab, fn, cls) => h('button', { class: cls || '', onclick: () => { const msg = fn(); chartChanged(); show('sails'); if (msg) banner(msg); } }, lab);
  const fname = (ch.name || 'sailchart').replace(/[^\w.-]+/g, '_'), PAL = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0], [232, 123, 164], [0, 131, 0], [98, 80, 214], [227, 73, 72]];
  const tools = !st.edit ? h('span', { class: 'muted' }, 'Tick to move the points of an area, add areas, or paint cells.') : [field('Tool', sel('sc-tool', ['Move points', 'Paint cells'], st.tool === 'paint' ? 'Paint cells' : 'Move points', v => { st.tool = v === 'Paint cells' ? 'paint' : 'points'; show('sails'); }))].concat(st.tool === 'points' ?
    [field('Area', sel('sc-shape', ch.shapes.map(s => s.name), ch.shapes[st.shape] ? ch.shapes[st.shape].name : '', v => { st.shape = ch.shapes.findIndex(s => s.name === v); st.vi = -1; draw(); })),
      act('Add point', () => { const s = ch.shapes[st.shape]; if (!s) return; let bi = 0, bd = -1; s.pts.forEach((p, i) => { const q = s.pts[(i + 1) % s.pts.length], d = ((p[0] - q[0]) * 5) ** 2 + (p[1] - q[1]) ** 2; if (d > bd) { bd = d; bi = i; } }); const p = s.pts[bi], q = s.pts[(bi + 1) % s.pts.length]; s.pts.splice(bi + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); st.vi = bi + 1; }),
      act('Remove point', () => { const s = ch.shapes[st.shape]; if (!s || s.pts.length <= 3) return 'An area needs at least three points.'; s.pts.splice(st.vi >= 0 ? st.vi : s.pts.length - 1, 1); st.vi = -1; }),
      field('New area for sail', nameIn), act('Add area', () => { const v = nameIn.value.trim(); if (!v) return 'Type the sail name first.'; ch.shapes.push({ name: v, group: 'Other', kind: 'Sail', pts: [[10, 60], [16, 60], [16, 100], [10, 100]], colour: PAL[ch.shapes.length % 8], visible: true, straight: false, comments: '', opacity: 40, label: null }); st.shape = ch.shapes.length - 1; }),
      act('Delete area', () => { if (ch.shapes[st.shape]) ch.shapes.splice(st.shape, 1); st.shape = 0; }, 'danger')] :
    [field('Paint with', sel('sc-brush', names.concat(['(erase)']), st.brush, v => { st.brush = v; })),
      act('Fill empty cells from data', () => `${SL.chartFromData(ps, ch, false)} cell(s) filled with the sail that performed best there (at least 3 phases).`),
      act('Rebuild cells from data', () => { ch.cells = {}; return `${SL.chartFromData(ps, ch, true)} cell(s) set from the data. Use “Fill gaps” to extend to neighbouring cells.`; }),
      act('Fill gaps', () => `${SL.chartFillGaps(ch)} neighbouring cell(s) filled from the nearest painted cell.`), act('Clear painted cells', () => { ch.cells = {}; }, 'danger')]);
  const leg = h('div', { class: 'legend' }, ch.shapes.map(s => h('button', { class: 'lg' + (s.visible === false ? ' off' : ''), title: s.comments || s.group || '', onclick: () => { s.visible = s.visible === false; chartChanged(); show('sails'); } }, h('i', { style: 'background:' + col(s.name) }), s.name)), names.filter(n => !ch.shapes.some(s => s.name === n) && ps.some(p => p.sails === n)).map(n => h('span', {}, h('i', { style: 'background:' + col(n) }), n)), st.dots ? h('span', {}, h('i', { style: 'background:none;border:2px solid ' + css('--ink') + ';border-radius:50%' }), 'ringed = off chart') : null);
  c.append(card('Sail chart',
    bar(field('Chart name', h('input', { type: 'text', id: 'sc-name', value: ch.name || '', style: 'width:220px', onchange: e => { ch.name = e.target.value; chartChanged(); } })), filterBar(() => R.sails()),
      field('Show phases', h('input', { type: 'checkbox', id: 'sc-dots', checked: st.dots ? '' : null, onchange: e => { st.dots = e.target.checked; draw(); } })),
      h('button', { onclick: () => fileIn.click() }, 'Open chart file…'), fileIn, h('button', { onclick: () => dl(fname.replace(/\.xml$/i, '') + '.xml', SL.chartXml(ch)) }, 'Save as RaceReplay chart (.xml)'), nCells ? h('button', { onclick: () => dl(fname + '.sailchart.json', JSON.stringify(ch)) }, 'Save with painted cells (.json)') : null,
      act('New empty chart', () => { A.chart = SL.newChart(); }, 'danger')),
    bar(field('Edit the chart', h('input', { type: 'checkbox', id: 'sc-edit', checked: st.edit ? '' : null, onchange: e => { st.edit = e.target.checked; show('sails'); } })), tools),
    leg, h('div', {}, cv), info));
  let G = null;
  const draw = () => {
    const W = cv.parentElement.clientWidth || 800, H = 640, dp = window.devicePixelRatio || 1; cv.width = W * dp; cv.height = H * dp; cv.style.height = H + 'px'; const x = cv.getContext('2d'); x.setTransform(dp, 0, 0, dp, 0, 0); x.clearRect(0, 0, W, H); cv._hits = [];
    // TWA across, TWS up: the same way round as the RaceReplay crossover chart
    const pl = 46, pr = 14, pt = 12, pb = 40, X = a => pl + a / 180 * (W - pl - pr), Y = w => H - pb - w / 36 * (H - pt - pb); G = { X, Y, pl, pr, pt, pb, W, H };
    x.font = '11px ' + css('--font'); x.lineWidth = 1; x.strokeStyle = css('--grid'); x.fillStyle = css('--muted'); x.beginPath();
    for (let a = 0; a <= 180; a += 10) { x.moveTo(X(a), pt); x.lineTo(X(a), H - pb); } for (let w = 0; w <= 36; w += 2) { x.moveTo(pl, Y(w)); x.lineTo(W - pr, Y(w)); } x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'top'; for (let a = 0; a <= 180; a += 10) x.fillText(a + '°', X(a), H - pb + 6); x.textAlign = 'right'; x.textBaseline = 'middle'; for (let w = 0; w <= 36; w += 2) x.fillText(w, pl - 6, Y(w));
    x.fillStyle = css('--ink2'); x.textAlign = 'center'; x.textBaseline = 'bottom'; x.fillText('TWA', pl + (W - pl - pr) / 2, H - 4); x.save(); x.translate(12, pt + (H - pt - pb) / 2); x.rotate(-Math.PI / 2); x.textBaseline = 'middle'; x.fillText('TWS (kn)', 0, 0); x.restore();
    for (const w of SL.CH_TWS) for (const a of SL.CH_TWA) { const s = ch.cells[w + '|' + a]; if (!s) continue; const x0 = X(a - 5), y0 = Y(w + 1), cw = X(a + 5) - x0, chh = Y(w - 1) - y0; x.fillStyle = alpha(col(s), 0.3); x.fillRect(x0, y0, cw, chh); x.strokeStyle = alpha(col(s), 0.7); x.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, chh - 1); }
    ch.shapes.forEach((s, si) => { if (s.visible === false) return; const o = SL.outline(s); x.beginPath(); o.forEach((p, i) => { i ? x.lineTo(X(p[1]), Y(p[0])) : x.moveTo(X(p[1]), Y(p[0])); }); x.closePath(); x.fillStyle = alpha(col(s.name), (s.opacity || 40) / 150); x.fill(); x.strokeStyle = col(s.name); x.lineJoin = 'round'; x.lineWidth = st.edit && st.tool === 'points' && si === st.shape ? 3 : 2; x.stroke(); });
    if (st.dots) for (const p of ps) { if (!fin(p.v.TWS) || !fin(p.v.TWA) || p.v.TWS > 36) continue; const px = X(Math.abs(p.v.TWA)), py = Y(p.v.TWS), bad = p._ch === -1; x.fillStyle = col(p.sails); x.strokeStyle = bad ? css('--ink') : css('--surface'); x.lineWidth = bad ? 1.6 : 0.8; x.beginPath(); x.arc(px, py, bad ? 4 : 3, 0, 7); x.fill(); x.stroke(); if (!st.edit) cv._hits.push([px, py, ptip(p, p._ch === 0 ? 'The chart is blank here' : 'Chart allows ' + SL.chartSail(ch, p.v.TWS, p.v.TWA) + (bad ? ' · sailed ' + p.sails : '')), p]); }
    x.font = '600 12px ' + css('--font'); x.textAlign = 'center'; x.textBaseline = 'middle';
    ch.shapes.forEach(s => { if (s.visible === false) return; const l = s.label || [SL.mean(s.pts.map(p => p[0])), SL.mean(s.pts.map(p => p[1]))], lx = X(l[1]), ly = Y(l[0]), w = x.measureText(s.name).width + 12; x.fillStyle = alpha(css('--surface'), 0.9); x.strokeStyle = col(s.name); x.lineWidth = 1.5; x.beginPath(); x.roundRect(lx - w / 2, ly - 10, w, 20, 5); x.fill(); x.stroke(); x.fillStyle = css('--ink'); x.fillText(s.name, lx, ly + 0.5); });
    if (st.edit && st.tool === 'points') ch.shapes.forEach((s, si) => { if (s.visible === false) return; s.pts.forEach((p, i) => { const sel2 = si === st.shape; x.fillStyle = sel2 && i === st.vi ? css('--ink') : css('--surface'); x.strokeStyle = col(s.name); x.lineWidth = 2; x.beginPath(); x.rect(X(p[1]) - (sel2 ? 5 : 3.5), Y(p[0]) - (sel2 ? 5 : 3.5), sel2 ? 10 : 7, sel2 ? 10 : 7); x.fill(); x.stroke(); }); });
  };
  const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, a: (e.clientX - r.left - G.pl) / (G.W - G.pl - G.pr) * 180, w: (G.H - G.pb - (e.clientY - r.top)) / (G.H - G.pt - G.pb) * 36 }; };
  let down = null; const paint = q => { if (q.w < 1 || q.w > 31 || q.a < 25 || q.a > 185) return; const k = SL.chKey(q.w, q.a); if (st.brush === '(erase)') delete ch.cells[k]; else if (st.brush) ch.cells[k] = st.brush; draw(); };
  cv.addEventListener('pointerdown', e => { if (!st.edit || !G) return; const q = at(e); cv.setPointerCapture(e.pointerId);
    if (st.tool === 'paint') { down = { paint: true }; paint(q); return; }
    let best = null; ch.shapes.forEach((s, si) => { if (s.visible === false) return; s.pts.forEach((p, i) => { const d = (G.X(p[1]) - q.x) ** 2 + (G.Y(p[0]) - q.y) ** 2; if (d < 144 && (!best || d < best.d || (si === st.shape && d <= best.d + 1))) best = { si, i, d }; }); });
    if (best) { st.shape = best.si; st.vi = best.i; down = { drag: best }; const sl = $('#sc-shape'); if (sl) sl.value = ch.shapes[best.si].name; draw(); } });
  cv.addEventListener('pointermove', e => { if (!G) return; const q = at(e);
    if (down && down.paint) { paint(q); return; }
    if (down && down.drag) { const p = ch.shapes[down.drag.si].pts[down.drag.i]; p[0] = Math.round(Math.max(0, Math.min(36, q.w)) * 10) / 10; p[1] = Math.round(Math.max(0, Math.min(180, q.a)) * 10) / 10; draw(); info.textContent = `${ch.shapes[down.drag.si].name}: point at TWS ${f1(p[0])} kn, TWA ${f1(p[1])}°`; return; }
    if (q.w < 0 || q.w > 36 || q.a < 0 || q.a > 180) return; const set = SL.chartAt(ch, q.w, q.a), cs = stats.cells[SL.chKey(q.w, q.a)];
    info.textContent = `TWA ${f1(q.a, 0)}° · TWS ${f1(q.w, 0)} kn: chart allows ${set.join(' / ') || 'nothing (blank)'}` + (cs && q.w >= 1 && q.a >= 25 ? ' · sailed nearby: ' + Object.keys(cs.by).map(s => `${s} ×${cs.by[s].length} (${f1(SL.median(cs.by[s].filter(fin)))}%)`).join(', ') : ''); });
  cv.addEventListener('pointerup', () => { if (down) { down = null; chartChanged(); show('sails'); } });
  draw();
  const verdict = r => r.nChart < 3 || r.n < 3 || !fin(r.perf) || !fin(r.perfChart) ? ['too few phases to compare', ''] : r.perf - r.perfChart > 1 ? ['what you sailed was faster: the chart may be wrong here', 'warn'] : r.perf - r.perfChart < -1 ? ['sailing to the chart was faster', 'bad'] : ['no real difference', 'good'];
  c.append(card('Sailed off the chart', stats.rows.length ? [h('p', { class: 'muted' }, 'Where a sail was up outside its area on the chart, grouped by 2-knot and 10-degree band, with VMG% (BSPpol% when reaching) next to the phases in the same band that were sailed to the chart. This is the evidence for moving a crossover line.'),
    table(['TWS', 'TWA', 'Chart allows', 'Sails used', 'Phases', 'Used %', 'To chart %', 'Phases to chart', 'Verdict'], stats.rows.slice(0, 40).map(r => { const [t, k] = verdict(r); return [{ t: r.tws + ' kn', c: 'b' }, r.twa + '°', r.chart, r.used, r.n, f1(r.perf), f1(r.perfChart), r.nChart, { t, c: 'verdict ' + k }]; }), 'num')] : h('p', { class: 'muted' }, SL.chartEmpty(ch) ? 'Open a crossover chart file, or tick “Edit the chart” to draw one.' : 'Every phase on the chart was sailed with sails the chart allows there.')),
    h('p', { class: 'muted' }, 'Each area is a smooth closed curve through its points, as in RaceReplay; the exact curve RaceReplay draws is not published, so an edge can differ slightly from what you see there. A phase counts as on the chart when every sail that was up, apart from the mainsail, has its area there. The chart is kept in this browser.'));
};

/* ---------------- Calibration file ---------------- */
const BAND_TWS = [6, 8, 10, 12.5, 16, 20];
function calibEnsure() { if (!A.calib) A.calib = { app: 'SailLens', type: 'calibration', name: '', ...SL.CAL0, twa: BAND_TWS.map(t => ({ tws: t, up: 0, dn: 0 })) }; if (!A.calib.twa || !A.calib.twa.length) A.calib.twa = BAND_TWS.map(t => ({ tws: t, up: 0, dn: 0 })); return A.calib; }
function calibSuggest(r, cb=calibEnsure(), active) {
  const done = [], r1 = v => Math.round(v * 10) / 10;
  const available = key => !active || cb[key] === active[key];
  if (!r.bsp.err) {
    if (available('bspK') && (r.bsp.kLo > 1 || r.bsp.kHi < 1) && Math.abs(r.bsp.k - 1) > 0.007) {
      cb.bspK = Math.round(cb.bspK * r.bsp.k * 1000) / 1000; done.push('BSP factor ' + cb.bspK);
    }
    if (available('hdgOff') && (r.bsp.dLo > 0 || r.bsp.dHi < 0) && Math.abs(r.bsp.delta) > 1) {
      cb.hdgOff = r1(cb.hdgOff + r.bsp.delta); done.push('heading ' + cb.hdgOff + '°');
    }
  }
  if (available('leewayGain') && r.cur && !r.cur.err && r.cur.hasLee && (r.cur.lLo > 1 || r.cur.lHi < 1) && Math.abs(r.cur.lam - 1) > 0.15) { cb.leewayGain = Math.round((cb.leewayGain ?? 1) * r.cur.lam * 100) / 100; done.push('leeway ×' + cb.leewayGain); }
  if (available('awaOff') && !r.awa.err && Math.abs(r.awa.read) > 0.5 && Math.abs(r.awa.read) > 2 * r.awa.se) { cb.awaOff = r1(cb.awaOff - r.awa.read); done.push('AWA ' + cb.awaOff + '°'); }
  // A session-wide wind fit may confound sailing on one tack with a change in the wind.
  // The TWA table is proposed from reviewed local pairs after these upstream corrections.
  if (available('twsDnPct') && !r.wind.err && r.wind.twsDn && Math.abs(r.wind.twsDn.pct) > 3 && Math.abs(r.wind.twsDn.pct) > 2 * r.wind.twsDn.se) {
    cb.twsDnPct = r1(100 * ((1 + cb.twsDnPct / 100) / (1 + r.wind.twsDn.pct / 100) - 1)); done.push('TWS downwind ' + cb.twsDnPct + '%');
  }
  return done;
}
function logCsv() { const D = A.D, keys = Object.keys(A.raw.ch), rows = [['Utc'].concat(keys).join(',')]; for (let i = D.i0; i < D.i1; i++) rows.push(new Date(iT(i)).toISOString().slice(0, 19).replace('T', ' ') + ',' + keys.map(k => { const v = D.ch[k][i]; return fin(v) ? (k === 'Lat' || k === 'Lon' ? v.toFixed(6) : String(Math.round(v * 1000) / 1000)) : ''; }).join(',')); return rows.join('\r\n'); }
function blkCalib(c, r) {
  const cb = calibEnsure(), on = SL.calibActive(cb), re = () => { recompute(); show('cal'); };
  const num = (k, lab, step) => field(lab, h('input', { type: 'number', id: 'cb-' + k, step, value: cb[k], style: 'width:110px', onchange: e => { cb[k] = e.target.value === '' ? SL.CAL0[k] : +e.target.value; } }));
  const cell = (row, k) => h('input', { type: 'number', step: 0.1, value: row[k], style: 'width:76px', 'aria-label': k + ' at ' + row.tws, onchange: e => { row[k] = +e.target.value || 0; } });
  const fileIn = h('input', { type: 'file', id: 'file-calib2', hidden: '', accept: '.json', onchange: e => e.target.files[0] && loadFile(e.target.files[0], 'calib') });
  c.append(card(['Calibration file ', h('span', { class: 'chip' + (on ? ' dirty' : '') }, on ? 'applied to this log' : 'nothing applied')],
    h('p', { class: 'muted' }, 'Corrections applied to the log before phases, targets and everything else are worked out, so you can see what a calibration change would have done to the day. True wind keeps the corrections Expedition already made: only the change caused by the new BSP, AWA and AWS is added to the logged TWA and TWS.'),
    h('div', { class: 'bar' }, field('Name', h('input', { type: 'text', id: 'cb-name', value: cb.name || '', style: 'width:180px', onchange: e => { cb.name = e.target.value; } })), num('bspK', 'BSP factor (×)', 0.001), num('hdgOff', 'Heading offset (°)', 0.1), num('awaOff', 'AWA offset (°)', 0.1), num('awsK', 'AWS factor (×)', 0.001), num('twsDnPct', 'TWS downwind (%)', 0.5), num('leewayGain', 'Leeway (× logged)', 0.05), num('heelOff', 'Heel offset (°)', 0.1), num('rudOff', 'Rudder offset (°)', 0.1)),
    h('h4', {}, 'TWA correction table (degrees added to TWA, by wind speed)'),
    table(['TWS (kn)', 'Upwind', 'Downwind', ''], cb.twa.map((row, i) => [h('input', { type: 'number', step: 0.5, value: row.tws, style: 'width:76px', 'aria-label': 'TWS', onchange: e => { row.tws = +e.target.value || 0; } }), cell(row, 'up'), cell(row, 'dn'), h('button', { class: 'mini danger', onclick: () => { cb.twa.splice(i, 1); show('cal'); } }, 'Remove')])),
    h('p', { class: 'muted' }, 'Between rows the correction is interpolated; between 60° and 120° TWA it blends from the upwind to the downwind column. TWS downwind % is blended the same way.'),
    bar(h('button', { class: 'primary', onclick: re }, 'Apply to this log'),
      h('button', { onclick: () => { const d = calibSuggest(r); re(); banner(d.length ? 'Added from the models: ' + d.join(', ') + '. The figures above now show what is left.' : 'The models found nothing certain enough to add.'); } }, 'Add the models\' suggestions'),
      h('button', { onclick: () => { cb.twa.push({ tws: (cb.twa[cb.twa.length - 1] || { tws: 20 }).tws + 4, up: 0, dn: 0 }); show('cal'); } }, 'Add table row'),
      h('button', { onclick: () => { const n = cb.name; A.calib = null; calibEnsure().name = n; re(); } }, 'Reset to none'),
      h('button', { onclick: () => fileIn.click() }, 'Open calibration file…'), fileIn,
      h('button', { onclick: () => dl((cb.name || 'calibration').replace(/[^\w-]+/g, '_') + '.calibration.json', JSON.stringify(cb, null, 1)) }, 'Save calibration file'),
      on ? h('button', { onclick: () => dl((A.files.log || 'log').replace(/\.\w+$/, '') + '.postcal.csv', logCsv()) }, 'Export recalibrated log (CSV)') : null)));
}
