'use strict';
/* SailLens core: parsing, processing, phases, calibration, ML. No DOM access - runs in browser and node. */
const SL = (() => {
const D2R = Math.PI / 180, R2D = 180 / Math.PI, fin = Number.isFinite;
const w180 = a => ((a + 180) % 360 + 360) % 360 - 180;
const w360 = a => ((a % 360) + 360) % 360;
function mean(a) { let s = 0, n = 0; for (const v of a) if (fin(v)) { s += v; n++; } return n ? s / n : NaN; }
function sd(a) { const m = mean(a); let s = 0, n = 0; for (const v of a) if (fin(v)) { s += (v - m) ** 2; n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : NaN; }
function cmean(a) { let s = 0, c = 0, n = 0; for (const v of a) if (fin(v)) { s += Math.sin(v * D2R); c += Math.cos(v * D2R); n++; } return n ? w360(Math.atan2(s, c) * R2D) : NaN; }
function quant(a, q) { const b = Array.from(a).filter(fin).sort((x, y) => x - y); if (!b.length) return NaN; const p = (b.length - 1) * q, i = Math.floor(p); return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (p - i); }
const median = a => quant(a, 0.5);
const ANG = /^(HDG|COG|TWD|Course|Set|TWDTwisted|TWDmin|TWDmax|TWDG|TWD_calc|CUR_DIR)$/;

/* ---------- log parsing ---------- */
const ALIAS = { BSP: ['bsp', 'boatspeed', 'boat speed', 'stw'], AWA: ['awa'], AWS: ['aws'], TWA: ['twa'], TWS: ['tws'], TWD: ['twd'],
  HDG: ['hdg', 'heading'], COG: ['cog'], SOG: ['sog'], Lat: ['lat', 'latitude'], Lon: ['lon', 'long', 'longitude', 'lng'],
  Heel: ['heel', 'roll'], Rudder: ['rudder', 'rud'], Forestay: ['forestay'], Trim: ['trim', 'pitch'], Leeway: ['leeway'] };
function canon(name) { const l = name.trim().toLowerCase(); for (const k in ALIAS) if (ALIAS[k].includes(l)) return k; return name.trim(); }
function parseTime(s) {
  s = String(s ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) { const v = +s; if (v > 1e16) return v / 1e4 - 11644473600000; if (v > 1e11) return v; if (v > 1e9) return v * 1000; if (v > 20000 && v < 80000) return Math.round((v - 25569) * 864e5); return NaN; }
  const m = s.match(/^(\d{4}|\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return NaN;
  const y = +(m[1].length === 4 ? m[1] : m[3]), mo = +m[2], d = +(m[1].length === 4 ? m[3] : m[1]), h = +m[4], mi = +m[5], sec = +(m[6] || 0);
  const t = Date.UTC(y, mo - 1, d, h, mi, 0), check = new Date(t);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec >= 60 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN;
  let offset = 0;
  if (m[7] && m[7].toUpperCase() !== 'Z') { const z = m[7].replace(':', ''), zh = +z.slice(1, 3), zm = +z.slice(3); if (zh > 23 || zm > 59) return NaN; offset = (zh * 60 + zm) * (z[0] === '-' ? -1 : 1); }
  return t + Math.round(sec * 1000) - offset * 60000;
}
// Floating clocks retain the file's wall time; explicitly zoned/epoch times are UTC.
const utcTime = s => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(s).trim()) || (/^\d+(?:\.\d+)?$/.test(String(s).trim()) && +s > 1e9);
const logOffset = (raw, cfg) => raw && raw.timeBasis === 'utc' ? 0 : (cfg.logOff || 0);
function csvDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 }; let quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; } else if (!quoted) { if (c === '\n' || c === '\r') break; if (c in counts) counts[c]++; } }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}
function* csvRows(text, delimiter = csvDelimiter(text)) {
  let row = [], value = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else quoted = false; } else value += c; }
    else if (c === '"' && !value.trim()) quoted = true;
    else if (c === delimiter) { row.push(value); value = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(v => v.trim())) yield row; row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (value || row.length) { row.push(value); yield row; }
}
const csvNumber = s => { const v = String(s ?? '').trim(); return v ? Number(v.replace(',', '.')) : NaN; };
function parseLog(text, nativeWindow) {
  text = String(text).replace(/^\uFEFF/, '');
  const expedition = /^!boat/i.test(text), delimiter = expedition ? ',' : csvDelimiter(text), format = expedition ? 'Expedition log' : 'CSV table';
  function* records() {
    const rows = csvRows(text, delimiter), first = rows.next().value;
    if (!first) throw new Error('The log file is empty.');
    const keys = first.map(canon), low = first.map(s => s.trim().toLowerCase()), ids = Object.create(null);
    let hasIds = false, ti = low.findIndex(h => ['utc', 'time', 'utc time', 'timestamp', 'datetime', 'date_time', 'date time', 'isodatetime'].includes(h));
    const di = low.indexOf('date'), tmi = low.findIndex(h => h === 'time' || h === 'utc time');
    if (!expedition && ti < 0 && di < 0) throw new Error('No recognised time column in the CSV header.');
    for (const p of rows) {
      if (expedition && p[0][0] === '!') { if (/^!boat$/i.test(p[0]) && !hasIds) { p.forEach((id, i) => { if (i) ids[id] = keys[i] || 'ch' + id; }); hasIds = true; } continue; }
      let stamp, start = 1;
      if (expedition) { if (p.length % 2 === 0) { stamp = p[1]; start = 2; } else for (let j = 1; j < p.length - 1; j += 2) if (p[j] === '0') stamp = p[j + 1]; }
      else stamp = di >= 0 && tmi >= 0 && di !== tmi ? p[di] + ' ' + p[tmi] : p[ti >= 0 ? ti : di];
      yield { p, stamp, t: parseTime(stamp), start, keys, ids, hasIds, ti, di, tmi };
    }
  }
  if(nativeWindow){
    const points=[];
    for(const row of records()){
      if(!fin(row.t)||row.t<nativeWindow.start||row.t>=nativeWindow.end)continue;
      const add=(key,value)=>{
        if(key!==nativeWindow.channel||!String(value??'').trim())return;
        const number=csvNumber(value);
        if(fin(number))points.push([row.t,number]);
      };
      if(expedition){
        for(let j=row.start;j<row.p.length-1;j+=2){
          if(row.p[j]!=='0')add(row.hasIds?row.ids[row.p[j]]:row.keys[+row.p[j]+1],row.p[j+1]);
        }
      }else row.keys.forEach((key,j)=>add(key,row.p[j]));
    }
    return points.sort((a,b)=>a[0]-b[0]);
  }
  let lo = Infinity, hi = -Infinity, previous = -Infinity;
  const bases = new Set(), diagnostics = { rows: 0, invalidTimes: 0, outOfOrder: 0, aggregatedSamples: 0, invalidValues: 0, channels: {} };
  for (const r of records()) { diagnostics.rows++; if (!fin(r.t)) { diagnostics.invalidTimes++; continue; } bases.add(utcTime(r.stamp) ? 'utc' : 'floating'); if (r.t < previous) diagnostics.outOfOrder++; previous = r.t; lo = Math.min(lo, r.t); hi = Math.max(hi, r.t); }
  if (!fin(lo)) throw new Error('No timestamped rows found in the log file.');
  if (bases.size > 1) throw new Error('Mixed UTC and timezone-free timestamps. Use one time convention per log.');
  const t0 = Math.floor(lo / 1000) * 1000, n = Math.floor((hi - t0) / 1000) + 1;
  if (n > 7 * 86400) throw new Error('Log spans more than seven days. Check timestamps or split it into sessions.');
  const cols = new Map();
  const put = (i, k, value) => {
    if (!k || !String(value ?? '').trim()) return;
    const v = csvNumber(value); if (!fin(v)) { diagnostics.invalidValues++; return; }
    let c = cols.get(k); if (!c) { c = { sum: new Float64Array(n), count: new Uint32Array(n), cos: ANG.test(k) || /^(TWA|AWA)$/.test(k) ? new Float64Array(n) : null }; cols.set(k, c); }
    if (c.count[i]++) diagnostics.aggregatedSamples++;
    if (c.cos) { c.sum[i] += Math.sin(v * D2R); c.cos[i] += Math.cos(v * D2R); } else c.sum[i] += v;
  };
  for (const r of records()) {
    if (!fin(r.t)) continue; const i = Math.floor((r.t - t0) / 1000);
    if (expedition) { for (let k = r.start; k < r.p.length - 1; k += 2) if (r.p[k] !== '0') put(i, r.hasIds ? r.ids[r.p[k]] : r.keys[+r.p[k] + 1] || 'ch' + r.p[k], r.p[k + 1]); }
    else r.keys.forEach((k, j) => { if (j !== r.ti && j !== r.di && j !== r.tmi) put(i, k, r.p[j]); });
  }
  const ch = Object.create(null), age = Object.create(null), counts = Object.create(null);
  for (const [k, c] of cols) {
    const a = c.sum, ages = new Uint8Array(n).fill(255); let last = NaN, elapsed = 255, observed = 0, held = 0;
    for (let i = 0; i < n; i++) {
      if (c.count[i]) { a[i] = c.cos ? (Math.hypot(a[i], c.cos[i]) < 1e-10 ? NaN : (ANG.test(k) ? w360 : w180)(Math.atan2(a[i], c.cos[i]) * R2D)) : a[i] / c.count[i]; last = a[i]; elapsed = fin(last) ? 0 : 255; observed++; }
      else { elapsed = Math.min(255, elapsed + 1); a[i] = elapsed <= 10 ? last : NaN; if (fin(a[i])) held++; }
      ages[i] = elapsed;
    }
    ch[k] = a; age[k] = ages; counts[k] = c.count; diagnostics.channels[k] = { observed, held, missing: n - observed - held };
  }
  if (ch.Lat && ch.Lon) for (let i = 0; i < n; i++) if (ch.Lat[i] === 0 && ch.Lon[i] === 0) { ch.Lat[i] = NaN; ch.Lon[i] = NaN; }
  return { t0, n, ch, age, counts, diagnostics, timeBasis: [...bases][0], format };
}

/* ---------- event file ---------- */
const xdec = s => s.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function attrs(s) { const o = Object.create(null); s.replace(/([\w.:-]+)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k] = xdec(v); }); return o; }
function parseEvents(text) {
  const out = { meta: {}, evOff: 0, logOff: 0, events: [] };
  if (/<\w+/.test(text.slice(0, 2000))) {
    const val = tag => { const m = text.match(new RegExp('<' + tag + '\\s+val="([^"]*)"')); return m ? xdec(m[1]) : ''; };
    out.meta = { boat: val('boat'), date: val('date'), desc: val('boatdaydescription'), location: val('location'), daytype: val('daytypestr'), goals: val('daygoals'), comments: val('daycomments') };
    let m = text.match(/<event_file\s+hours="(-?[\d.]+)"/); if (m) out.evOff = +m[1]; else { m = text.match(/<events\s+utc_offset_hours="(-?[\d.]+)"/); if (m) out.evOff = +m[1]; }
    m = text.match(/<log_file\s+hours="(-?[\d.]+)"/); if (m) out.logOff = +m[1];
    const blk = (text.match(/<events[\s\S]*?<\/events>/) || [text])[0];
    blk.replace(/<event\s+([^>]*?)\/?>/g, (mm, a) => { const o = attrs(a); const ts = o.datetime || ((o.date || '') + ' ' + (o.time || '')); const t = parseTime(ts); if (fin(t) && o.type) out.events.push({ tl: t + (utcTime(ts) ? out.evOff * 36e5 : 0), type: o.type, attr: o.attribute || o.attr || '', comments: o.comments || '', xmlAttrs: Object.fromEntries(Object.entries(o).filter(([k])=>!['date','time','datetime','type','attribute','attr','comments'].includes(k))) }); });
  } else {
    for (const p of csvRows(text)) { if (p.length < 2) continue; const t = parseTime(p[0]); if (fin(t)) out.events.push({ tl: t, type: p[1].trim(), attr: (p[2] || '').trim(), comments: (p[3] || '').trim() }); }
  }
  out.events.sort((a, b) => a.tl - b.tl);
  return out;
}
function sailLabel(attr) { const p = attr.split(';').map(s => s.trim()); const hs = [p[3], p[1], p[2]].filter(Boolean); return hs.length ? (/\(\d+\)$/.test(p[0]) ? p[0]+'/' : '') + hs.join('/') : (p[0] ? p[0] + ' only' : 'None'); }

/* ---------- polar ---------- */
function parsePolar(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '!' && l[0] !== '#');
  const tok = l => l.split(/[\s,;]+/).filter(Boolean);
  const rows = []; if (!lines.length) throw new Error('Polar file is empty.');
  let f0 = tok(lines[0]), upK = -1, dnK = -1, body = lines;
  if (!fin(+f0[0]) && f0.some(s => /^(twa|bsp)/i.test(s))) { // Expedition header row: Twa0 Bsp0 TwaUp BspUp ... TwaDn BspDn
    const tw = f0.filter(s => /^twa/i.test(s)); upK = tw.findIndex(s => /up/i.test(s)); dnK = tw.findIndex(s => /dn|down/i.test(s)); body = lines.slice(1); f0 = tok(body[0] || '0');
  }
  if (!fin(+f0[0])) {
    const tws = f0.slice(1).map(Number);
    tws.forEach(w => rows.push({ tws: w, pts: [] }));
    for (const l of body.slice(1)) { const p = tok(l).map(Number); if (!fin(p[0])) continue; for (let k = 1; k < p.length && k <= tws.length; k++) if (fin(p[k]) && p[k] > 0) rows[k - 1].pts.push([p[0], p[k]]); }
  } else for (const l of body) { const p = tok(l).map(Number); if (!fin(p[0]) || p.length < 3) continue; const r = { tws: p[0], pts: [] }; for (let k = 1; k + 1 < p.length; k += 2) if (fin(p[k]) && fin(p[k + 1])) r.pts.push([p[k], p[k + 1]]); if (upK >= 0 && r.pts[upK]) r.tu = r.pts[upK].slice(); if (dnK >= 0 && r.pts[dnK]) r.td = r.pts[dnK].slice(); rows.push(r); }
  const ok = rows.filter(r => r.pts.length >= 2 && r.tws > 0); if (!ok.length) throw new Error('Could not read any polar rows (expected Expedition format: TWS, then TWA BSP pairs).');
  return ok;
}
function makePolar(rows, src) {
  rows = rows.map(r => ({ tws: r.tws, tu: r.tu, td: r.td, n: r.n, pts: r.pts.slice().sort((a, b) => a[0] - b[0]) })).sort((a, b) => a.tws - b.tws);
  const rowBsp = (r, a) => { const p = r.pts; if (a <= p[0][0]) return p[0][0] > 0 ? p[0][1] * a / p[0][0] : p[0][1]; for (let i = 1; i < p.length; i++) if (a <= p[i][0]) { const f = (a - p[i - 1][0]) / ((p[i][0] - p[i - 1][0]) || 1); return p[i - 1][1] + f * (p[i][1] - p[i - 1][1]); } return p[p.length - 1][1]; };
  for (const r of rows) {
    let bu = { vmg: -1 }, bd = { vmg: -1 };
    for (let a = 25; a <= 180; a += 0.5) { const b = rowBsp(r, a), v = b * Math.cos(a * D2R); if (a < 90 && v > bu.vmg) bu = { twa: a, bsp: b, vmg: v }; if (a > 90 && -v > bd.vmg) bd = { twa: a, bsp: b, vmg: -v }; }
    if (r.tu) bu = { twa: r.tu[0], bsp: r.tu[1], vmg: r.tu[1] * Math.cos(r.tu[0] * D2R) }; if (r.td) bd = { twa: r.td[0], bsp: r.td[1], vmg: -r.td[1] * Math.cos(r.td[0] * D2R) };
    r.up = bu; r.dn = bd;
  }
  const lerp = (w, f) => {
    if (w <= rows[0].tws) { const k = Math.max(0, w / rows[0].tws); return f(rows[0], k); }
    for (let i = 1; i < rows.length; i++) if (w <= rows[i].tws) { const g = (w - rows[i - 1].tws) / (rows[i].tws - rows[i - 1].tws); const a = f(rows[i - 1], 1), b = f(rows[i], 1); return a.map((x, j) => x + g * (b[j] - x)); }
    return f(rows[rows.length - 1], 1);
  };
  return { rows, src,
    bsp: (w, a) => lerp(w, (r, k) => [rowBsp(r, a) * k])[0],
    up: w => { const v = lerp(w, (r, k) => [r.up.twa, r.up.bsp * k]); return { twa: v[0], bsp: v[1] }; },
    dn: w => { const v = lerp(w, (r, k) => [r.dn.twa, r.dn.bsp * k]); return { twa: v[0], bsp: v[1] }; } };
}
function polarText(rows) { return rows.map(r => [r.tws, ...r.pts.map(p => p[0].toFixed(1) + '\t' + p[1].toFixed(2))].join('\t')).join('\r\n') + '\r\n'; }

/* ---------- processing ---------- */
const DEF = { phaseLen: 30, phaseGap: 10, maxHold: 2, minBsp: 2, sdTwa: 6, sdBsp: 0.6, sdTws: 2, manBefore: 15, manAfter: 45, upMargin: 10, dnMargin: 12, polMin: 70, polMax: 125, magVar: null, evOff: 0, logOff: 0, evShiftSec: 0, tStart: null, tEnd: null, useEvents: true, racingOnly: false };
const MODES = ['Upwind', 'Reaching', 'BroadReaching', 'Downwind'];
function validateConfig(cfg) {
  for (const k of ['phaseLen', 'phaseGap', 'manBefore', 'manAfter', 'maxHold']) if (!Number.isInteger(cfg[k]) || cfg[k] < (k === 'phaseLen' ? 2 : 0)) throw new Error(k + ' must be a whole number ' + (k === 'phaseLen' ? 'of at least 2.' : 'of at least 0.'));
  if (!fin(cfg.evShiftSec || 0) || Math.abs(cfg.evShiftSec || 0) > 86400) throw new Error('Event shift must be within one day, in seconds.');
  if (cfg.maxHold > 10) throw new Error('Max held sample age cannot exceed 10 seconds.');
  for (const k of ['minBsp', 'sdTwa', 'sdBsp', 'sdTws', 'upMargin', 'dnMargin', 'polMin', 'polMax']) if (!fin(cfg[k]) || cfg[k] < 0) throw new Error(k + ' must be a non-negative number.');
  if (cfg.polMin >= cfg.polMax) throw new Error('Minimum polar percentage must be below maximum.');
  for (const k of ['evOff', 'logOff', 'dispOff']) if (cfg[k] != null && (!fin(cfg[k]) || Math.abs(cfg[k]) > 24)) throw new Error(k + ' must be a UTC offset between -24 and 24 hours.');
  for (const k of ['tStart', 'tEnd', 'magVar']) if (cfg[k] != null && !fin(cfg[k])) throw new Error(k + ' is invalid.');
  if (cfg.tStart != null && cfg.tEnd != null && cfg.tStart >= cfg.tEnd) throw new Error('The end of the time window must be after its start.');
}

function applyEvents(raw, ev, cfg) {
  const n = raw.n, L = { sail: new Int16Array(n).fill(-1), race: new Int16Array(n), leg: new Int16Array(n), testing: new Uint8Array(n), motor: new Uint8Array(n), sailNames: [], list: [], manual: Object.create(null), dayStart: null, dayStop: null };
  if (!ev || !cfg.useEvents) return L;
  const toI = tl => Math.round((tl - cfg.evOff * 36e5 + logOffset(raw, cfg) * 36e5 + (cfg.evShiftSec || 0) * 1000 - raw.t0) / 1000);
  const E = ev.events.map(e => ({ ...e, i: toI(e.tl) })).sort((a,b)=>a.i-b.i);
  L.list = E;
  const fill = (arr, a, b, v) => { a = Math.max(0, a); b = Math.min(n, b); for (let i = a; i < b; i++) arr[i] = v; };
  L.sailState = new Int32Array(n).fill(-1); L.sailConfigs = []; L.sailSlots = [];
  const sails = E.filter(e => e.type === 'SailsUp');
  sails.forEach((e, k) => { let state=L.sailConfigs.indexOf(e.attr);
    if(state<0){state=L.sailConfigs.push(e.attr)-1;L.sailSlots.push(e.attr.split(';').map(x=>x.trim()).filter(Boolean));}
    fill(L.sailState,e.i,sails[k+1]?.i??n,state);
    const lab = sailLabel(e.attr); let id = L.sailNames.indexOf(lab); if (id < 0) id = L.sailNames.push(lab) - 1; e.label = lab; fill(L.sail, e.i, k + 1 < sails.length ? sails[k + 1].i : n, id); });
  let race = 0, leg = 0, rs = null;
  for (const e of E) {
    if (e.type === 'RaceStartGun') { if(rs!==null){fill(L.race,rs,e.i,race);fill(L.leg,rs,e.i,leg);} race = +e.attr || race + 1; leg = 1; rs = e.i; e.label = 'Start R' + race; }
    else if (e.type === 'RaceMark' && rs !== null) { fill(L.race, rs, e.i, race); fill(L.leg, rs, e.i, leg); leg++; rs = e.i; e.label = 'M' + (e.attr || leg - 1); }
    else if ((e.type === 'RaceFinish' || e.type === 'DayStop') && rs !== null) { fill(L.race, rs, e.i, race); fill(L.leg, rs, e.i, leg); rs = null; e.label = e.type === 'RaceFinish' ? 'Finish R' + race : ''; }
    else if (e.type === 'DayStart') L.dayStart = e.i; if (e.type === 'DayStop') L.dayStop = e.i;
  }
  if (rs !== null) { fill(L.race, rs, n, race); fill(L.leg, rs, n, leg); }
  let ts = null; for (const e of E) { if (e.type === 'StartTesting') ts = e.i; else if (e.type === 'StopTesting' && ts !== null) { fill(L.testing, ts, e.i, 1); ts = null; } }
  if (ts !== null) fill(L.testing, ts, n, 1);
  let motorStart=null; for(const e of E){if(e.type==='MotorStart')motorStart=e.i;else if(e.type==='MotorStop'&&motorStart!==null){fill(L.motor,motorStart,e.i,1);motorStart=null;}} if(motorStart!==null)fill(L.motor,motorStart,n,1);
  const man = E.filter(e => e.type === 'ManualEntry');
  man.forEach(e => e.attr.split(';').forEach(kv => { const [k, v] = kv.split('='); if (!k || !v?.trim() || !fin(+v)) return; const key = k.trim(); if (!L.manual[key]) L.manual[key] = new Float64Array(n).fill(NaN); fill(L.manual[key], e.i, n, +v); }));
  return L;
}

/* calibration file: corrections applied to a copy of the logged channels before anything is derived.
   True wind is not rebuilt from scratch (that would drop Expedition's own leeway and upwash corrections): the change that the
   new BSP / AWA / AWS make to the apparent-to-true conversion is added on top of the logged TWA and TWS. */
const CAL0 = { bspK: 1, hdgOff: 0, awaOff: 0, awsK: 1, heelOff: 0, rudOff: 0, twsDnPct: 0, leewayGain: 1, twa: [] };
function calibActive(c) { if (!c) return false; return (fin(c.bspK) && c.bspK > 0 && c.bspK !== 1) || !!c.hdgOff || !!c.awaOff || (fin(c.awsK) && c.awsK > 0 && c.awsK !== 1) || !!c.heelOff || !!c.rudOff || !!c.twsDnPct || (fin(c.leewayGain) && c.leewayGain >= 0 && c.leewayGain !== 1) || (c.twa || []).some(r => r.up || r.dn); }
function applyCalib(ch, n, c) {
  if (!calibActive(c)) return false;
  const tw = (c.twa || []).filter(r => fin(r.tws)).sort((a, b) => a.tws - b.tws);
  const itp = (w, key) => { if (!tw.length) return 0; if (w <= tw[0].tws) return tw[0][key] || 0; for (let i = 1; i < tw.length; i++) if (w <= tw[i].tws) { const f = (w - tw[i - 1].tws) / (tw[i].tws - tw[i - 1].tws); return (tw[i - 1][key] || 0) + f * ((tw[i][key] || 0) - (tw[i - 1][key] || 0)); } return tw[tw.length - 1][key] || 0; };
  const k = fin(c.bspK) && c.bspK > 0 ? c.bspK : 1, ak = fin(c.awsK) && c.awsK > 0 ? c.awsK : 1, ao = c.awaOff || 0, ho = c.hdgOff || 0, dn = c.twsDnPct || 0;
  const B0 = ch.BSP, A0 = ch.AWA, S0 = ch.AWS, cp = key => ch[key] ? (ch[key] = Float64Array.from(ch[key])) : null;
  const app = !!(A0 && S0 && B0) && (k !== 1 || ak !== 1 || ao !== 0);
  const BSP = k !== 1 ? cp('BSP') : null, TWA = cp('TWA'), TWS = cp('TWS'), TWD = cp('TWD'), HDG = ho ? cp('HDG') : null, CSE = ho ? cp('Course') : null, AWA = ao && A0 ? cp('AWA') : null, AWS = ak !== 1 && S0 ? cp('AWS') : null;
  for (let i = 0; i < n; i++) {
    let dT = 0;
    if (app && TWA && TWS && fin(A0[i]) && fin(S0[i]) && fin(B0[i])) { const o = trueWind(A0[i], S0[i], B0[i]), q = trueWind(A0[i] + ao, S0[i] * ak, B0[i] * k); dT = w180(q.twa - o.twa); if (fin(TWA[i])) TWA[i] = w180(TWA[i] + dT); if (o.tws > 0.3 && fin(TWS[i])) TWS[i] *= q.tws / o.tws; }
    if (BSP) BSP[i] *= k; if (AWA) AWA[i] = w180(A0[i] + ao); if (AWS) AWS[i] = S0[i] * ak;
    if (TWA && TWS && fin(TWA[i]) && fin(TWS[i])) { const a = Math.abs(TWA[i]), wd = Math.max(0, Math.min(1, (a - 60) / 60)), e = (1 - wd) * itp(TWS[i], 'up') + wd * itp(TWS[i], 'dn'), s = TWA[i] < 0 ? -1 : 1; if (e) { TWA[i] = s * Math.max(0, Math.min(180, a + e)); dT += s * e; } if (dn) TWS[i] *= 1 + dn / 100 * wd; }
    if (HDG) HDG[i] = w360(HDG[i] + ho); if (CSE) CSE[i] = w360(CSE[i] + ho);
    if (TWD && fin(TWD[i])) TWD[i] = w360(TWD[i] + ho + dT);
  }
  const lg = fin(c.leewayGain) && c.leewayGain >= 0 ? c.leewayGain : 1;
  if (lg !== 1 && ch.Leeway) { const le = Float64Array.from(ch.Leeway), old = ch.Leeway, cs = ch.Course ? (CSE || cp('Course')) : null; for (let i = 0; i < n; i++) { le[i] = old[i] * lg; if (cs && fin(old[i])) cs[i] = w360(cs[i] + (le[i] - old[i])); } ch.Leeway = le; }
  if (c.heelOff && ch.Heel) { const a = cp('Heel'); for (let i = 0; i < n; i++) a[i] += c.heelOff; }
  if (c.rudOff && ch.Rudder) { const a = cp('Rudder'); for (let i = 0; i < n; i++) a[i] += c.rudOff; }
  return true;
}
function process(raw, opt) {
  const cfg = { ...DEF, ...opt.cfg }, n = raw.n, ch = { ...raw.ch };
  validateConfig(cfg);
  // Derived channels always get their own arrays, including names also present in the source.
  const need = k => (ch[k] = new Float64Array(n).fill(NaN));
  const warn = [];
  for (const k of Object.keys(ch)) if (raw.age && raw.age[k]) { ch[k] = Float64Array.from(ch[k]); for (let i = 0; i < n; i++) if (raw.age[k][i] > cfg.maxHold) ch[k][i] = NaN; }
  if (raw.diagnostics) {
    const q = raw.diagnostics;
    if (q.invalidTimes) warn.push(q.invalidTimes + ' rows skipped because their timestamps were invalid.');
    if (q.outOfOrder) warn.push(q.outOfOrder + ' out-of-order timestamps were placed in chronological order.');
    if (q.invalidValues) warn.push(q.invalidValues + ' non-numeric channel values were ignored.');
    if (q.aggregatedSamples) warn.push('Subsecond samples averaged into 1-second analysis bins. The workspace retains the original source files.');
    if (['BSP', 'TWA', 'TWS', 'AWA', 'AWS'].some(k => q.channels[k] && q.channels[k].observed < n)) warn.push('Gaps present: values are held for at most ' + cfg.maxHold + ' seconds; longer gaps are excluded from phases. See import quality in Setup.');
  }
  if (raw.timeBasis === 'utc' && cfg.logOff) warn.push('The log contains UTC timestamps; the log UTC offset setting is ignored.');
  const invalid = new Uint8Array(n);
  for (const r of opt.invalidRanges || []) {
    const lo = Math.max(0, Math.floor((r.start - raw.t0) / 1000)), hi = Math.min(n, Math.ceil((r.end - raw.t0) / 1000));
    if (hi > lo) invalid.fill(1, lo, hi);
  }
  const L = applyEvents(raw, opt.events, cfg);
  for (const k in L.manual) ch[k] = L.manual[k];
  if (invalid.some(Boolean)) for (const k of Object.keys(ch)) { ch[k] = Float64Array.from(ch[k]); for (let i = 0; i < n; i++) if (invalid[i]) ch[k][i] = NaN; }
  // Complete missing wind inputs before applying a TWA correction table.
  // true wind if missing
  if ((!ch.TWA || !ch.TWS) && ch.AWA && ch.AWS && ch.BSP) { const missing = ['TWA', 'TWS'].filter(k => !ch[k]), twa = !ch.TWA ? need('TWA') : null, tws = !ch.TWS ? need('TWS') : null; for (let i = 0; i < n; i++) { const a = ch.AWA[i] * D2R, x = ch.AWS[i] * Math.cos(a) - ch.BSP[i], y = ch.AWS[i] * Math.sin(a); if (twa) twa[i] = Math.atan2(y, x) * R2D; if (tws) tws[i] = Math.hypot(x, y); } warn.push(missing.join('/') + ' missing; computed from AWA, AWS and BSP.'); }
  const calibrated = applyCalib(ch, n, opt.calib);
  for (const k of ['BSP', 'TWA', 'TWS']) if (!ch[k]) { need(k); warn.push(k + ' ontbreekt: bijbehorende analyses zijn niet beschikbaar. Koppel een kanaal bij bootinstellingen.'); }
  if (!ch.TWD && ch.HDG) { const d = need('TWD'); for (let i = 0; i < n; i++) d[i] = w360(ch.HDG[i] + ch.TWA[i]); }
  const BSP = ch.BSP, TWA = ch.TWA, TWS = ch.TWS;
  let i0 = 0, i1 = n;
  if (cfg.tStart != null) i0 = Math.max(0, Math.round((cfg.tStart - raw.t0) / 1000)); else if (L.dayStart != null) i0 = Math.max(0, L.dayStart);
  if (cfg.tEnd != null) i1 = Math.min(n, Math.round((cfg.tEnd - raw.t0) / 1000)); else if (L.dayStop != null) i1 = Math.min(n, L.dayStop);
  if (i1 <= i0) throw new Error('The selected time window / event file does not overlap the log. Check times and UTC offsets.');
  if (i1 - i0 < cfg.phaseLen) warn.push('Selected window is shorter than one phase.');
  const magVar = cfg.magVar != null ? cfg.magVar : 0, logMagVar = ch.MagVar ? (median(ch.MagVar.subarray(i0, i1)) || 0) : null;

  // polar source
  let P = opt.polar || null, src = P ? P.src : 'none';
  const logT = !P && ch.PolBsp && (ch['Targ Twa'] || ch.TargTwa) && (ch['Targ Bsp'] || ch.TargBsp);
  if (logT) src = 'log';
  const lTwa = ch['Targ Twa'] || ch.TargTwa, lBsp = ch['Targ Bsp'] || ch.TargBsp;
  const aT = need('absTWA'), pol = need('Polar_BSP'), tT = need('Target_TWA'), tB = need('Target_BSP'), vmg = need('VMG'), bp = need('BSPpol%'), bt = need('BSP_trg%'), vp = need('VMG%'),
    dB = need('ΔBSP'), dT = need('ΔTWA'), dV = need('ΔVMG'), dVp = need('ΔVMG%');
  const tack = new Int8Array(n), mode = new Int8Array(n).fill(-1);
  if (ch.Heel) { const a = need('abs_heel'); for (let i = 0; i < n; i++) a[i] = Math.abs(ch.Heel[i]); }
  if (ch.Rudder) { const a = need('abs_rudder'); for (let i = 0; i < n; i++) a[i] = Math.abs(ch.Rudder[i]); }
  for (const k of ['Heel', 'Rudder', 'Leeway']) if (ch[k]) { const a = need(k + '_norm'); for (let i = 0; i < n; i++) a[i] = TWA[i] < 0 ? -ch[k][i] : ch[k][i]; }
  if (ch.AWA) { const a = need('absAWA'); for (let i = 0; i < n; i++) a[i] = Math.abs(ch.AWA[i]); }
  if (ch.SOG) { const a = need('BSP-SOG'); for (let i = 0; i < n; i++) a[i] = BSP[i] - ch.SOG[i]; }
  if (ch.HDG && ch.COG) { const a = need('HDG-COG'); for (let i = 0; i < n; i++) a[i] = w180(ch.HDG[i] + magVar - ch.COG[i]); }
  if (ch.SOG && ch.COG && ch.HDG) { // current = speed over ground minus speed through the water, along the course (heading plus logged leeway)
    const ce = need('Cur_E'), cn = need('Cur_N'), wd = ch.Course || ch.HDG; for (let i = 0; i < n; i++) { const th = (wd[i] + magVar) * D2R, cg = ch.COG[i] * D2R; ce[i] = ch.SOG[i] * Math.sin(cg) - BSP[i] * Math.sin(th); cn[i] = ch.SOG[i] * Math.cos(cg) - BSP[i] * Math.cos(th); } }
  for (let i = 0; i < n; i++) {
    const a = Math.abs(TWA[i]), w = TWS[i], b = BSP[i]; aT[i] = a; tack[i] = TWA[i] >= 0 ? 1 : -1;
    vmg[i] = Math.abs(b * Math.cos(a * D2R));
    if (!fin(a) || !fin(w)) continue;
    let ut, dt_, tt, tb, pb = NaN;
    /* targets follow a 3 s mean of TWS, which matches RaceReplay's percentages; polar speed uses the sample itself */
    if (P) { const w3 = fin(TWS[i - 1]) && fin(TWS[i + 1]) ? (TWS[i - 1] + w + TWS[i + 1]) / 3 : w, u = P.up(w3), d = P.dn(w3); ut = u.twa; dt_ = d.twa; pb = P.bsp(w, a); if (a < 90) { tt = u.twa; tb = u.bsp; } else { tt = d.twa; tb = d.bsp; } }
    else if (logT) { pb = ch.PolBsp[i]; tt = lTwa[i]; tb = lBsp[i]; if (fin(tt) && (tt < 90) !== (a < 90)) { tt = NaN; tb = NaN; } ut = a < 90 && fin(tt) ? tt : 45; dt_ = a >= 90 && fin(tt) ? tt : 142; }
    else { ut = 45; dt_ = 142; }
    const m = a < ut + cfg.upMargin ? 0 : a > dt_ - cfg.dnMargin ? 3 : a < 100 ? 1 : 2; mode[i] = m;
    pol[i] = pb; bp[i] = pb > 0.5 ? b / pb * 100 : NaN;
    tT[i] = tt; tB[i] = tb; const tv = tb * Math.abs(Math.cos(tt * D2R));
    bt[i] = tb > 0.5 ? b / tb * 100 : NaN; dB[i] = b - tb; dT[i] = a - tt; dV[i] = vmg[i] - tv;
    vp[i] = (m === 0 || m === 3) ? (tv > 0.3 ? vmg[i] / tv * 100 : NaN) : bp[i]; dVp[i] = vp[i] - 100;
  }
  // manoeuvres
  const sgn = new Int8Array(n); for (let i = i0; i < i1; i++) { let s = 0; for (let k = -2; k <= 2; k++) { const v = TWA[i + k]; if (fin(v)) s += v >= 0 ? 1 : -1; } sgn[i] = s >= 0 ? 1 : -1; }
  const win = (a, lo, hi, f) => { lo = Math.max(i0, lo); hi = Math.min(i1, hi); return hi > lo ? f(a.subarray(lo, hi)) : NaN; };
  function measureTurn(i,type,outgoing) {
    const m = { i, type, to: outgoing > 0 ? 'Stbd' : 'Port', tws: win(TWS, i - 30, i + 30, mean), bspIn: win(BSP,i-25,i-5,mean), bspMin: win(BSP, i - 5, i + 25, a => Math.min(...a)), bspOut: win(BSP, i + 30, i + 45, mean), sail: L.sail[i] };
    /* distance lost, the way RaceReplay measures it: VMG along the wind axis (BSP and heading against the mean TWD of the reference
       window), compared with the steady 30 s before (ending 20 s ahead of the turn) up to the turn, and with the steady 30 s after
       (16 to 46 s past the turn) from the turn on. Not measured when another manoeuvre falls inside those windows. */
    const TB = 20, TA = 46, AV = 30, wB = i - TB - AV, wA = i + TA;
    if (ch.TWD && ch.HDG && wB >= i0 && wA <= i1) {
      const tB = cmean(ch.TWD.subarray(wB, i - TB)), tA = cmean(ch.TWD.subarray(wA - AV, wA)), s = type === 'Tack' ? 1 : -1;
      const vw = (k, tw) => s * BSP[k] * Math.cos((ch.HDG[k] - tw) * D2R), avg = (f, lo, hi) => { let q = 0, cnt = 0; for (let k = lo; k < hi; k++) { const x = f(k); if (fin(x)) { q += x; cnt++; } } return cnt > (hi - lo) * 0.8 ? q / cnt : NaN; };
      const vb = avg(k => vw(k, tB), wB, i - TB), va = avg(k => vw(k, tA), wA - AV, wA);
      if (vb > 0.5 && va > 0.5) { let loss = 0; for (let k = i - TB; k < i; k++) if (fin(vw(k, tB))) loss += (vb - vw(k, tB)) * 0.5144; for (let k = i; k < wA - AV; k++) if (fin(vw(k, tA))) loss += (va - vw(k, tA)) * 0.5144; m.loss = loss; m.vb = vb; m.va = va; m.twB = tB; m.twA = tA; m.vmgRef = (vb + va) / 2;
        if (ch.COG && ch.SOG) { const vg = (k, tw) => s * ch.SOG[k] * Math.cos((ch.COG[k] - tw - magVar) * D2R), gb = avg(k => vg(k, tB), wB, i - TB), ga = avg(k => vg(k, tA), wA - AV, wA); if (fin(gb) && fin(ga)) { let lg = 0; for (let k = i - TB; k < i; k++) if (fin(vg(k, tB))) lg += (gb - vg(k, tB)) * 0.5144; for (let k = i; k < wA - AV; k++) if (fin(vg(k, tA))) lg += (ga - vg(k, tA)) * 0.5144; m.lossGps = lg; } } }
    }
    if (ch.HDG) { let mx = 0; for (let k = Math.max(i0 + 3, i - 12); k < Math.min(i1, i + 15); k++) { const r = Math.abs(w180(ch.HDG[k] - ch.HDG[k - 3])) / 3; if (r > mx) mx = r; } m.rate = mx; m.angle = Math.abs(w180(win(ch.HDG, i + 20, i + 35, cmean) - win(ch.HDG, i - 30, i - 10, cmean)));  }
    return m;
  }
  const mans = []; let cur = sgn[i0];
  for (let i = i0 + 1; i < i1 - 10; i++) {
    if (sgn[i] === cur) continue; let ok = true; for (let k = 1; k < 8; k++) if (sgn[i + k] !== sgn[i]) { ok = false; break; }
    if (!ok) continue; cur = sgn[i];
    for (let k = Math.max(i0, i - 30); k < Math.min(i1, i + 60); k++) if (!fin(BSP[k]) || !fin(TWA[k]) || !fin(TWS[k])) { ok = false; break; }
    if (!ok) continue;
    const bIn = win(BSP, i - 25, i - 5, mean); if (!(bIn > cfg.minBsp)) continue;
    const a0 = win(aT, i - 25, i - 8, mean), a1 = win(aT, i + 12, i + 30, mean);
    const type = a0 < 90 && a1 < 90 ? 'Tack' : a0 > 90 && a1 > 90 ? 'Gybe' : null; if (!type) continue;
    const m=measureTurn(i,type,cur);
    if(m.angle<30)continue;
    mans.push(m);
  }
  for(const edit of opt.turnEdits||[]){
    const original=mans.findIndex(m=>m.type===edit.type && raw.t0+m.i*1000===edit.original);
    if(original>=0)mans.splice(original,1);
    const i=Math.round((edit.time-raw.t0)/1000);
    if(i<i0||i>=i1||mans.some(m=>m.i===i))continue;
    const turn=measureTurn(i,edit.type,tack[Math.min(i+10,i1-1)]);
    turn.manual=true;
    mans.push(turn);
  }
  mans.sort((a,b)=>a.i-b.i);
  for (const m of mans) if (mans.some(o => o !== m && o.i > m.i - 50 && o.i < m.i + 46)) { m.crowded = true; delete m.loss; delete m.lossGps; }
  // validity mask + phases
  const bad = new Uint8Array(n + 1);
  for (let i = i0; i < i1; i++) if (!(BSP[i] >= cfg.minBsp) || !fin(TWA[i]) || !fin(TWS[i]) || mode[i] < 0 || (cfg.racingOnly && !L.race[i])) bad[i] = 1;
  for (const m of mans) for (let k = Math.max(i0, m.i - cfg.manBefore); k < Math.min(i1, m.i + cfg.manAfter); k++) bad[k] = 1;
  for (let i = i0 + 1; i < i1; i++) if (L.sailState?.[i] !== L.sailState?.[i - 1]) for (let k = Math.max(i0, i - 20); k < Math.min(i1, i + 30); k++) bad[k] = 1;
  for (let i = i0 + 1; i < i1; i++) if (L.race[i] !== L.race[i - 1] || L.leg[i] !== L.leg[i - 1] || L.testing[i] !== L.testing[i - 1] || mode[i] !== mode[i - 1] || tack[i] !== tack[i - 1]) bad[i] = 1;
  const cs = new Int32Array(n + 1);
  const formulaDiagnostics = opt.formulas?.length ? SL.evaluateFormulas(ch, opt.originalChannels || raw.ch, opt.formulas, n) : [];
  for (const q of formulaDiagnostics) if (q.missing.length) warn.push(q.name + ': ontbrekende kanalen ' + q.missing.join(', '));
  const formulaAngles = new Set((opt.formulas || []).filter(d => d.type === 'angle').map(d => d.name));
  const names = Object.keys(ch), phases = [], PL = cfg.phaseLen;
  const phaseDiagnostics={masked:0,stability:0,target:0,accepted:0};
  if(opt.phaseRules)for(let i=i0;i<i1;i++)if(!SL.sampleMatches({raw,i0,i1,L,mode,tack},i,opt.phaseRules))bad[i]=1;
  for(let i=0;i<n;i++)cs[i+1]=cs[i]+bad[i];
  for (let i = i0; !opt.skipPhases && i + PL <= i1;) {
    if (cs[i + PL] - cs[i] > 0) { phaseDiagnostics.masked++; i += 3; continue; }
    const tw = TWA.subarray(i, i + PL);
    const headings=fin(cfg.sdHdg)&&ch.HDG?ch.HDG.subarray(i,i+PL):null;
    const headingMean=headings?cmean(headings):NaN;
    if (sd(tw) > cfg.sdTwa || sd(BSP.subarray(i, i + PL)) > cfg.sdBsp || sd(TWS.subarray(i, i + PL)) > cfg.sdTws || mode[i] !== mode[i + PL - 1] || (headings && sd(Array.from(headings,x=>w180(x-headingMean)))>cfg.sdHdg)) { phaseDiagnostics.stability++; i += 5; continue; }
    const v = {}; for (const k of names) v[k] = (ANG.test(k) || formulaAngles.has(k) ? cmean : mean)(ch[k].subarray(i, i + PL));
    if ((fin(v['BSPpol%']) && (v['BSPpol%'] < cfg.polMin || v['BSPpol%'] > cfg.polMax)) || v.absTWA < 28) { phaseDiagnostics.target++; i += 5; continue; }
    if (fin(v.Cur_E) && fin(v.Cur_N)) { v.CUR_RATE = Math.hypot(v.Cur_E, v.Cur_N); v.CUR_DIR = w360(Math.atan2(v.Cur_E, v.Cur_N) * R2D); }
    const md = mode[i + (PL >> 1)], rc = L.race[i], lg = L.leg[i];
    phases.push({ i, i1: i + PL, t: raw.t0 + i * 1000, tack: v.TWA >= 0 ? 'Stbd' : 'Port', mode: MODES[md], sails: L.sail[i] >= 0 ? L.sailNames[L.sail[i]] : '-', race: rc, leg: lg, raceLeg: rc ? 'R' + rc + 'L' + lg : '-', testing: L.testing[i], v });
    phaseDiagnostics.accepted++; i += PL + cfg.phaseGap;
  }
  const D = { cfg, raw, ch, n, i0, i1, tack, mode, L, mans, phases, magVar, logMagVar, P, polarSrc: src, warn, calibrated, invalid, formulaDiagnostics, phaseDiagnostics, formulaAngles: [...formulaAngles] };
  if(opt.phaseBuild)SL.phaseBuild(D,opt.phaseBuild);
  D.legs = buildLegs(D); D.sum = summary(D);
  return D;
}
function analyse(raw, opt) {
  let D = process(raw, opt);
  if (opt.learnPolar && D.polarSrc === 'none' && D.phases.length >= 40) { const rows = learnPolar(D.phases, 0.7); if (rows.length) { D = process(raw, { ...opt, polar: makePolar(rows, 'learned') }); D.warn.push('No polar loaded and no targets in the log: percentages are relative to a polar learned from this data.'); } }
  if (D.polarSrc === 'none') D.warn.push('No polar available: load a polar file to get BSPpol%, targets and VMG%.');
  return D;
}
function avgPh(ps, k) { return (ANG.test(k) ? cmean : mean)(ps.map(p => p.v[k])); }
function mostCommon(a) { const c = {}; let b = '-', bn = 0; for (const x of a) { c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; b = x; } } return b; }
function buildLegs(D) {
  const groups = [], ph = D.phases;
  if (ph.some(p => p.race)) { const m = new Map(); for (const p of ph) if (p.race) { if (!m.has(p.raceLeg)) m.set(p.raceLeg, []); m.get(p.raceLeg).push(p); } for (const [k, ps] of m) groups.push({ name: k, ps }); }
  else { let g = null; const cls = p => p.mode === 'Upwind' ? 0 : p.mode === 'Downwind' ? 2 : 1; for (const p of ph) { if (!g || cls(p) !== g.c || p.i - g.ps[g.ps.length - 1].i > 300) { g = { c: cls(p), ps: [] }; groups.push(g); } g.ps.push(p); } let k = 0; for (const x of groups.filter(x => x.ps.length >= 3)) x.name = 'L' + (++k); }
  return groups.filter(g => g.name && g.ps.length >= 2).map(g => { const ps = g.ps, v = {}; for (const k in ps[0].v) v[k] = avgPh(ps, k); const i0 = ps[0].i, i1 = ps[ps.length - 1].i1; let d = i1 - i0; if (ps[0].race) { d = 0; for (let i = D.i0; i < D.i1; i++) if (D.L.race[i] === ps[0].race && D.L.leg[i] === ps[0].leg) d++; } return { name: g.name, mode: mostCommon(ps.map(p => p.mode)), dur: d, sails: mostCommon(ps.map(p => p.sails)), n: ps.length, i0, i1, v }; });
}
function summary(D) {
  const { ch, i0, i1 } = D, s = { t0: D.raw.t0 + i0 * 1000, t1: D.raw.t0 + i1 * 1000 };
  const st = k => { if (!ch[k]) return null; const a = ch[k].subarray(i0, i1); if (ANG.test(k)) { const m = cmean(a); let lo = 0, hi = 0; for (const v of a) if (fin(v)) { const d = w180(v - m); if (d < lo) lo = d; if (d > hi) hi = d; } return { min: w360(m + lo), avg: m, max: w360(m + hi) }; } let lo = Infinity, hi = -Infinity; for (const v of a) if (fin(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } return { min: lo, avg: mean(a), max: hi }; };
  s.BSP = st('BSP'); s.TWS = st('TWS'); s.TWD = st('TWD');
  s.tacks = D.mans.filter(m => m.type === 'Tack').length; s.gybes = D.mans.filter(m => m.type === 'Gybe').length;
  let sail = 0, act = 0, rac = 0, dist = 0; const sp = ch.SOG || ch.BSP, bp = ch['BSPpol%'];
  for (let i = i0; i < i1; i++) { if (ch.BSP[i] > 1) { sail++; if (bp[i] > 80) act++; if (D.L.race[i]) rac++; } if (fin(sp[i])) dist += sp[i] / 3600; }
  s.sailing = sail; s.active = act; s.racing = rac; s.dist = dist;
  const used = new Set(); for (let i = i0; i < i1; i += 5) if (D.L.sail[i] >= 0) D.L.sailNames[D.L.sail[i]].replace(/ only$/, '').split('/').forEach(x => used.add(x)); s.sails = [...used].sort();
  return s;
}

/* ---------- calibration ---------- */
function trueWind(awa, aws, bsp) { const a = awa * D2R, x = aws * Math.cos(a) - bsp, y = aws * Math.sin(a); return { twa: Math.atan2(y, x) * R2D, tws: Math.hypot(x, y) }; }
function calTable(D) { const out = []; for (const m of MODES) { const g = { mode: m, rows: [] }; for (const tk of ['Port', 'Stbd']) { const ps = D.phases.filter(p => p.mode === m && p.tack === tk); if (!ps.length) continue; const a = k => ps[0].v[k] === undefined ? NaN : avgPh(ps, k); g.rows.push({ tack: tk, n: ps.length, TWS: a('TWS'), TWA: Math.abs(a('TWA')), Heel: a('Heel'), BSP: a('BSP'), SOG: a('SOG'), 'BSP-SOG': a('BSP-SOG'), 'BSP/SOG%': a('BSP') / a('SOG') * 100, HDG: a('HDG'), COG: a('COG'), 'HDG-COG': a('HDG-COG'), CUR_RATE: Math.hypot(a('Cur_E'), a('Cur_N')), CUR_DIR: w360(Math.atan2(a('Cur_E'), a('Cur_N')) * R2D) }); } if (g.rows.length) out.push(g); } return out; }
function awaTable(D, off) { const res = []; for (const [lab, m] of [['Up', 'Upwind'], ['Dn', 'Downwind']]) for (const tk of ['Port', 'Stbd']) { const ps = D.phases.filter(p => p.mode === m && p.tack === tk && fin(p.v.AWA) && fin(p.v.AWS)); if (!ps.length) { res.push(null); continue; } const o = ps.map(p => trueWind(p.v.AWA, p.v.AWS, p.v.BSP)), w = ps.map(p => trueWind(p.v.AWA + off, p.v.AWS, p.v.BSP)); res.push({ lab: lab + ' ' + tk.toLowerCase(), n: ps.length, oAWA: mean(ps.map(p => Math.abs(p.v.AWA))), nAWA: mean(ps.map(p => Math.abs(p.v.AWA + off))), oTWS: mean(o.map(x => x.tws)), nTWS: mean(w.map(x => x.tws)), oTWA: mean(o.map(x => Math.abs(x.twa))), nTWA: mean(w.map(x => Math.abs(x.twa))) }); } return res; }
function twdPairs(D, type, off) {
  const rows = [], hasA = D.ch.AWA && D.ch.AWS && D.ch.HDG;
  const twd0 = p => hasA ? w360(p.v.HDG + trueWind(p.v.AWA + off, p.v.AWS, p.v.BSP).twa) : p.v.TWD;
  const f = off == null ? (p => p.v.TWD) : twd0;
  for (const m of D.mans) { if (m.type !== type) continue; const b = D.phases.filter(p => p.i1 <= m.i && p.i > m.i - 240), a = D.phases.filter(p => p.i >= m.i && p.i < m.i + 240); if (!b.length || !a.length) continue; const tb = cmean(b.map(f)), ta = cmean(a.map(f)); const P = b[0].tack === 'Port' ? tb : ta, S = b[0].tack === 'Port' ? ta : tb; if (b[0].tack === a[0].tack) continue; const pp = b[0].tack === 'Port' ? b : a, ss = b[0].tack === 'Port' ? a : b, am = (g, k) => mean(g.map(p => Math.abs(p.v[k]))); rows.push({ i: m.i, tws: mean(b.concat(a).map(p => p.v.TWS)), P, S, d: w180(P - S), awaP: am(pp, 'AWA'), awaS: am(ss, 'AWA'), twaP: am(pp, 'TWA'), twaS: am(ss, 'TWA') }); }
  return rows;
}
function solveAwaOffset(D) { if (!(D.ch.AWA && D.ch.AWS && D.ch.HDG)) return null; let best = null; for (let o = -6; o <= 6.001; o += 0.1) { const r = twdPairs(D, 'Tack', o); if (r.length < 2) return null; const e = Math.abs(mean(r.map(x => x.d))); if (!best || e < best.e) best = { off: Math.round(o * 10) / 10, e, n: r.length }; } const base = twdPairs(D, 'Tack', 0); best.before = mean(base.map(x => x.d)); best.atBound = Math.abs(best.off) >= 5.9; return best; }

/* ---------- ML ---------- */
function learnPolar(phases, q) {
  const rows = [];
  for (let w = 4; w <= 30; w += 2) {
    const ps = phases.filter(p => Math.abs(p.v.TWS - w) <= 1.5); if (ps.length < 8) continue; const pts = [];
    for (let a = 30; a <= 175; a += 5) { const g = ps.filter(p => Math.abs(Math.abs(p.v.TWA) - a) <= 4); if (g.length >= 4) pts.push([a, quant(g.map(p => p.v.BSP), q), g.length]); }
    if (pts.length < 3) continue;
    const sm = pts.map((p, i) => [p[0], i > 0 && i < pts.length - 1 ? (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4 : p[1], p[2]]);
    rows.push({ tws: w, pts: sm, n: ps.length });
  }
  return rows;
}
function learnTargets(phases) { // best-VMG quartile per TWS bin
  const out = [];
  for (const m of ['Upwind', 'Downwind']) for (let w = 4; w <= 30; w += 2) { const ps = phases.filter(p => p.mode === m && Math.abs(p.v.TWS - w) <= 1); if (ps.length < 10) continue; const c = quant(ps.map(p => p.v.VMG), 0.75), top = ps.filter(p => p.v.VMG >= c); out.push({ mode: m, tws: w, n: ps.length, twa: median(top.map(p => Math.abs(p.v.TWA))), bsp: median(top.map(p => p.v.BSP)), vmg: median(top.map(p => p.v.VMG)), tTwa: median(ps.map(p => p.v.Target_TWA)), tBsp: median(ps.map(p => p.v.Target_BSP)), heel: median(top.map(p => Math.abs(p.v.Heel))) }); }
  return out;
}
function fitTree(X, r, idx, depth, minLeaf, thr) {
  const n = idx.length; let tot = 0; for (let k = 0; k < n; k++) tot += r[idx[k]];
  if (depth === 0 || n < 2 * minLeaf) return { v: tot / n };
  let bg = tot * tot / n + 1e-9, bj = -1, bc = 0;
  for (let j = 0; j < X.length; j++) { const x = X[j]; for (const c of thr[j]) { let sl = 0, nl = 0; for (let k = 0; k < n; k++) { const i = idx[k]; if (x[i] <= c) { sl += r[i]; nl++; } } if (nl < minLeaf || n - nl < minLeaf) continue; const g = sl * sl / nl + (tot - sl) * (tot - sl) / (n - nl); if (g > bg) { bg = g; bj = j; bc = c; } } }
  if (bj < 0) return { v: tot / n };
  const li = [], ri = []; for (let k = 0; k < n; k++) (X[bj][idx[k]] <= bc ? li : ri).push(idx[k]);
  return { j: bj, c: bc, l: fitTree(X, r, li, depth - 1, minLeaf, thr), r: fitTree(X, r, ri, depth - 1, minLeaf, thr) };
}
const treeAt = (t, X, i) => { while (t.j !== undefined) t = X[t.j][i] <= t.c ? t.l : t.r; return t.v; };
function gbm(X, y, idx, o) {
  o = { trees: 70, lr: 0.1, depth: 3, minLeaf: 6, ...o };
  const thr = X.map(x => { const s = new Set(); for (let q = 1; q < 14; q++) s.add(quant(idx.map(i => x[i]), q / 14)); return [...s]; });
  let base = 0; for (const i of idx) base += y[i]; base /= idx.length;
  const f = new Float64Array(y.length).fill(base), r = new Float64Array(y.length), trees = [];
  for (let t = 0; t < o.trees; t++) { for (const i of idx) r[i] = y[i] - f[i]; const tr = fitTree(X, r, idx, o.depth, o.minLeaf, thr); trees.push(tr); for (const i of idx) f[i] += o.lr * treeAt(tr, X, i); }
  return { base, trees, lr: o.lr, predict(Xp, i) { let v = base; for (const tr of trees) v += o.lr * treeAt(tr, Xp, i); return v; } };
}
const r2 = (y, p, idx) => { let m = 0; for (const i of idx) m += y[i]; m /= idx.length; let a = 0, b = 0; for (const i of idx) { a += (y[i] - p[i]) ** 2; b += (y[i] - m) ** 2; } return b > 0 ? 1 - a / b : 0; };
function driverModel(phases, target, feats) {
  const ps = phases.filter(p => fin(p.v[target])); const n = ps.length; if (n < 40) return { err: 'Need at least 40 phases with ' + target + ' (have ' + n + ').' };
  feats = feats.filter(f => ps.filter(p => fin(p.v[f])).length > n * 0.8 && sd(ps.map(p => p.v[f])) > 1e-6);
  if (feats.length < 2) return { err: 'Not enough usable input channels.' };
  const X = feats.map(f => { const md = median(ps.map(p => p.v[f])); return Float64Array.from(ps, p => fin(p.v[f]) ? p.v[f] : md); });
  const lo = quant(ps.map(p => p.v[target]), 0.01), hi = quant(ps.map(p => p.v[target]), 0.99);
  const y = Float64Array.from(ps, p => Math.min(hi, Math.max(lo, p.v[target]))), all = [...Array(n).keys()];
  // blocked time-series CV (contiguous folds) so neighbouring phases do not leak
  const K = 4, pred = new Float64Array(n);
  for (let k = 0; k < K; k++) { const a = Math.floor(n * k / K), b = Math.floor(n * (k + 1) / K); const tr = all.filter(i => i < a || i >= b); const m = gbm(X, y, tr); for (let i = a; i < b; i++) pred[i] = m.predict(X, i); }
  const cvR2 = r2(y, pred, all), model = gbm(X, y, all), fit = Float64Array.from(all, i => model.predict(X, i));
  const mse = p => { let s = 0; for (let i = 0; i < n; i++) s += (y[i] - p[i]) ** 2; return s / n; }, m0 = mse(fit);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const imp = feats.map((f, j) => { const sav = X[j], sh = Float64Array.from(sav); for (let i = n - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [sh[i], sh[k]] = [sh[k], sh[i]]; } X[j] = sh; const m1 = mse(Float64Array.from(all, i => model.predict(X, i))); X[j] = sav; return { f, v: Math.max(0, m1 - m0) }; });
  const tot = imp.reduce((s, x) => s + x.v, 0) || 1; imp.forEach(x => x.v /= tot); imp.sort((a, b) => b.v - a.v);
  const pd = f => { const j = feats.indexOf(f), sav = X[j], g = [], a = quant(sav, 0.05), b = quant(sav, 0.95), sub = all.filter((i, k) => k % Math.ceil(n / 300) === 0); for (let s = 0; s <= 20; s++) { const xv = a + (b - a) * s / 20; X[j] = new Float64Array(n).fill(xv); let m = 0; for (const i of sub) m += model.predict(X, i); g.push([xv, m / sub.length]); } X[j] = sav; return g; };
  const resid = Float64Array.from(all, i => y[i] - pred[i]), mad = median(Array.from(resid, v => Math.abs(v - median(resid)))) * 1.4826 || 1;
  const anomalies = all.filter(i => resid[i] < -2.5 * mad).map(i => ({ p: ps[i], actual: y[i], expected: pred[i], z: resid[i] / mad })).sort((a, b) => a.z - b.z);
  return { ps, feats, target, n, cvR2, fitR2: r2(y, fit, all), imp, pd, anomalies, sigma: mad };
}
function kmeans(rows, k) {
  const d = rows[0].length, n = rows.length, mu = [], sg = [];
  for (let j = 0; j < d; j++) { mu.push(mean(rows.map(r => r[j]))); sg.push(sd(rows.map(r => r[j])) || 1); }
  const Z = rows.map(r => r.map((v, j) => (v - mu[j]) / sg[j])); let C = []; for (let c = 0; c < k; c++) C.push(Z[Math.floor((c + 0.5) * n / k)].slice());
  const lab = new Int8Array(n);
  for (let it = 0; it < 40; it++) { let ch = false; for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { let s = 0; for (let j = 0; j < d; j++) s += (Z[i][j] - C[c][j]) ** 2; if (s < bd) { bd = s; b = c; } } if (lab[i] !== b) { lab[i] = b; ch = true; } } C = C.map((c0, c) => { const m = Z.filter((z, i) => lab[i] === c); return m.length ? c0.map((x, j) => mean(m.map(z => z[j]))) : c0; }); if (!ch && it) break; }
  return lab;
}
function modeClusters(phases, mode) {
  const ps = phases.filter(p => p.mode === mode && fin(p.v['ΔTWA']) && fin(p.v['BSP_trg%'])); if (ps.length < 30) return null;
  const lab = kmeans(ps.map(p => [p.v['ΔTWA'], p.v['BSP_trg%']]), 3), cl = [];
  for (let c = 0; c < 3; c++) { const g = ps.filter((p, i) => lab[i] === c); if (!g.length) continue; cl.push({ c, n: g.length, dTwa: mean(g.map(p => p.v['ΔTWA'])), bspTrg: mean(g.map(p => p.v['BSP_trg%'])), vmgPct: mean(g.map(p => p.v['VMG%'])), heel: mean(g.map(p => Math.abs(p.v.Heel))), tws: mean(g.map(p => p.v.TWS)) }); }
  const up = mode === 'Upwind'; cl.sort((a, b) => a.dTwa - b.dTwa);
  const nm = up ? ['High mode (pinching)', 'On target angle', 'Low mode (footing)'] : ['Hot mode (sailing high)', 'On target angle', 'Deep mode (soaking)'];
  cl.forEach((c, i) => c.name = nm[cl.length === 3 ? i : Math.min(i * 2, 2)]);
  return { ps, lab, cl };
}
function windShifts(D) {
  const tw = D.ch.TWD; if (!tw) return []; const W = 180, out = []; let last = -1e9;
  for (let i = D.i0 + W; i < D.i1 - W; i += 15) { const a = cmean(tw.subarray(i - W, i)), b = cmean(tw.subarray(i, i + W)), d = w180(b - a); if (Math.abs(d) >= 8) { if (i - last < W && out.length) { if (Math.abs(d) > Math.abs(out[out.length - 1].d)) out[out.length - 1] = { i, d, from: a, to: b }; } else out.push({ i, d, from: a, to: b }); last = i; } }
  return out;
}
function glitches(D) { const out = []; for (const k of ['BSP', 'AWA', 'AWS', 'TWS', 'HDG', 'Heel', 'SOG', 'Rudder']) { const a = D.ch[k]; if (!a) continue; let c = 0; const ang = k === 'HDG' || k === 'AWA', sc = ang ? 25 : k === 'Heel' || k === 'Rudder' ? 10 : 4, df = (x, y) => ang ? w180(x - y) : x - y; for (let i = D.i0 + 1; i < D.i1 - 1; i++) { const d1 = df(a[i], a[i - 1]), d2 = df(a[i], a[i + 1]); if (Math.abs(d1) > sc && Math.abs(d2) > sc && d1 * d2 > 0) c++; } out.push({ k, n: c }); } return out; }
function loess(xs, ys, span, steps) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(p => fin(p[0]) && fin(p[1])).sort((a, b) => a[0] - b[0]); const n = pts.length; if (n < 4) return [];
  const lo = pts[0][0], hi = pts[n - 1][0], k = Math.max(4, Math.min(n, Math.ceil(span * n))), out = [];
  for (let s = 0; s <= steps; s++) { const x = lo + (hi - lo) * s / steps; const dd = pts.map(p => Math.abs(p[0] - x)).sort((a, b) => a - b), h = dd[k - 1] || 1e-9; let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (const p of pts) { const u = Math.abs(p[0] - x) / h; if (u >= 1) continue; const w = (1 - u ** 3) ** 3; sw += w; sx += w * p[0]; sy += w * p[1]; sxx += w * p[0] * p[0]; sxy += w * p[0] * p[1]; } const den = sw * sxx - sx * sx; out.push([x, Math.abs(den) < 1e-9 ? sy / sw : ((sy * sxx - sx * sxy) + (sw * sxy - sx * sy) * x) / den]); }
  return out;
}
/* trend lines: several ways to draw a line through noisy phases, plus a bootstrap band that shows how far the line can be trusted */
function loessW(xs, ys, wt, span, grid) { const n = xs.length, k = Math.max(4, Math.min(n, Math.ceil(span * n))), out = []; for (const x of grid) { const dd = xs.map(v => Math.abs(v - x)).sort((a, b) => a - b), h = dd[k - 1] || 1e-9; let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { const u = Math.abs(xs[i] - x) / h; if (u >= 1) continue; const w = (1 - u ** 3) ** 3 * (wt ? wt[i] : 1); sw += w; sx += w * xs[i]; sy += w * ys[i]; sxx += w * xs[i] * xs[i]; sxy += w * xs[i] * ys[i]; } const den = sw * sxx - sx * sx; out.push([x, sw <= 0 ? NaN : Math.abs(den) < 1e-9 ? sy / sw : ((sy * sxx - sx * sxy) + (sw * sxy - sx * sy) * x) / den]); } return out; }
const lineAt = (pts, x) => { if (!pts.length) return NaN; if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const f = (x - pts[i - 1][0]) / ((pts[i][0] - pts[i - 1][0]) || 1); return pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]); } return pts[pts.length - 1][1]; };
const TRENDS = ['Local (smooth)', 'Local (tight)', 'Robust local', 'Straight line', 'Curve (quadratic)', 'Binned median', 'None'];
function fitTrend(xs0, ys0, type, steps, grid) {
  const P = xs0.map((x, i) => [x, ys0[i]]).filter(p => fin(p[0]) && fin(p[1])).sort((a, b) => a[0] - b[0]), n = P.length; if (n < 4 || type === 'None') return [];
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), lo = quant(xs, 0.02), hi = quant(xs, 0.98); steps = steps || 30; grid = grid || Array.from({ length: steps + 1 }, (v, i) => lo + (hi - lo) * i / steps);
  if (type === 'Straight line' || type === 'Curve (quadratic)') { const d = type === 'Straight line' ? 1 : 2, mx = mean(xs), sx = sd(xs) || 1, A = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0)), b = new Array(d + 1).fill(0); for (let i = 0; i < n; i++) { const z = (xs[i] - mx) / sx, pw = [1, z, z * z]; for (let a = 0; a <= d; a++) { b[a] += pw[a] * ys[i]; for (let q = 0; q <= d; q++) A[a][q] += pw[a] * pw[q]; } }
    for (let a = 0; a <= d; a++) for (let q = a + 1; q <= d; q++) { /* symmetric already */ } const co = gauss(A, b); if (!co) return []; return grid.map(x => { const z = (x - mx) / sx; return [x, co[0] + co[1] * z + (d > 1 ? co[2] * z * z : 0)]; }); }
  if (type === 'Binned median') { const nb = Math.max(3, Math.min(8, Math.floor(n / 5))), out = []; for (let k = 0; k < nb; k++) { const g = P.slice(Math.floor(n * k / nb), Math.floor(n * (k + 1) / nb)); if (g.length >= 3) out.push([median(g.map(p => p[0])), median(g.map(p => p[1]))]); } return out; }
  const span = type === 'Local (tight)' ? 0.4 : 0.75; let l = loessW(xs, ys, null, span, grid);
  if (type === 'Robust local') { const r = xs.map((x, i) => ys[i] - lineAt(l, x)), s = 6 * (median(r.map(Math.abs)) || 1e-9), wt = r.map(v => { const u = Math.abs(v) / s; return u >= 1 ? 0 : (1 - u * u) ** 2; }); l = loessW(xs, ys, wt, span, grid); }
  return l.filter(p => fin(p[1]));
}
function gauss(A, b) { const n = b.length, M = A.map((r, i) => r.concat([b[i]])); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } const x = new Array(n); for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; } return x; }
function trendBand(xs0, ys0, type, steps, B) { // 10th to 90th percentile of the trend over bootstrap resamples of the phases
  const P = xs0.map((x, i) => [x, ys0[i]]).filter(p => fin(p[0]) && fin(p[1])), n = P.length; if (n < 10 || type === 'None') return [];
  const xs = P.map(p => p[0]), lo = quant(xs, 0.02), hi = quant(xs, 0.98), grid = Array.from({ length: (steps || 24) + 1 }, (v, i) => lo + (hi - lo) * i / (steps || 24)), runs = []; let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let b = 0; b < (B || 50); b++) { const s = Array.from({ length: n }, () => P[Math.floor(rnd() * n)]), l = fitTrend(s.map(p => p[0]), s.map(p => p[1]), type, 0, grid); if (l.length) runs.push(grid.map(x => lineAt(l, x))); }
  if (runs.length < 10) return []; return grid.map((x, i) => [x, quant(runs.map(r => r[i]), 0.1), quant(runs.map(r => r[i]), 0.9)]);
}
/* what is left of v after taking out its smooth dependence on a driver (usually TWS); centred back on the mean */
function residual(drv, v) { const ok = drv.map((d, i) => fin(d) && fin(v[i])), l = fitTrend(drv.filter((d, i) => ok[i]), v.filter((d, i) => ok[i]), 'Local (smooth)', 30), m = mean(v.filter((d, i) => ok[i])); return v.map((x, i) => ok[i] && l.length ? x - lineAt(l, drv[i]) + m : NaN); }
function spearman(a, b) { const idx = a.map((v, i) => i).filter(i => fin(a[i]) && fin(b[i])), rk = arr => { const o = idx.slice().sort((p, q) => arr[p] - arr[q]), r = {}; o.forEach((i, k) => { r[i] = k; }); return idx.map(i => r[i]); }; return idx.length > 3 ? corr(rk(a), rk(b)) : NaN; }
function corr(a, b) { let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; for (let i = 0; i < a.length; i++) if (fin(a[i]) && fin(b[i])) { n++; sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i]; } const d = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb)); return n > 3 && d > 0 ? (n * sab - sa * sb) / d : NaN; }

/* ---------- demo data ---------- */
const DEMO_POLAR = '4\t45.5\t2.88\t52.0\t3.35\t60.0\t3.63\t75.0\t3.72\t90.0\t3.72\t110.0\t3.63\t120.0\t3.44\t135.0\t2.98\t143.0\t2.7\t165.0\t2.23\n6\t44.9\t4.46\t52.0\t5.12\t60.0\t5.39\t75.0\t5.58\t90.0\t5.67\t110.0\t5.58\t120.0\t5.3\t135.0\t4.65\t144.0\t4.19\t165.0\t3.44\n8\t42.5\t5.36\t52.0\t5.63\t60.0\t5.91\t75.0\t6.04\t90.0\t6.23\t110.0\t6.42\t120.0\t6.23\t135.0\t5.77\t146.0\t5.21\t165.0\t4.46\n10\t40.5\t5.66\t52.0\t6.02\t60.0\t6.3\t75.0\t6.7\t90.0\t6.88\t110.0\t7.07\t120.0\t6.98\t135.0\t6.6\t150.0\t5.95\t165.0\t5.39\n12\t40.1\t5.95\t52.0\t6.39\t60.0\t6.55\t75.0\t6.79\t90.0\t7.16\t110.0\t7.53\t120.0\t7.63\t135.0\t7.35\t153.0\t6.6\t165.0\t6.14\n14\t40.5\t6.16\t52.0\t6.57\t60.0\t6.75\t75.0\t6.98\t90.0\t7.35\t110.0\t7.91\t120.0\t8.18\t135.0\t8.09\t156.0\t7.25\t165.0\t6.88\n16\t40.5\t6.28\t52.0\t6.64\t60.0\t6.83\t75.0\t7.1\t90.0\t7.53\t110.0\t8.28\t120.0\t8.74\t135.0\t8.93\t158.0\t7.91\t165.0\t7.63\n20\t40.5\t6.36\t52.0\t6.91\t60.0\t7.05\t75.0\t7.35\t90.0\t7.91\t110.0\t8.93\t120.0\t9.67\t135.0\t10.42\t160.0\t9.3\t165.0\t9.02\n';
function demo() {
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, g = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.2;
  const P = makePolar(parsePolar(DEMO_POLAR).map(r => ({ tws: r.tws, pts: r.pts.map(p => [p[0], p[0] >= 160 ? p[1] * 0.8 : p[1]]) })), 'file'), n = 3 * 3600, t0 = Date.UTC(2026, 5, 13, 9, 0, 0);
  const ch = {}; for (const k of ['BSP', 'AWA', 'AWS', 'TWA', 'TWS', 'TWD', 'HDG', 'COG', 'SOG', 'Lat', 'Lon', 'Heel', 'Rudder', 'Forestay']) ch[k] = new Float64Array(n);
  let lat = 52.45, lon = 4.45, tk = 1, up = true, legT = 0, nextMan = 240, bsp = 5, twaC = 42, fs = 2.4, effN = 0;
  const ev = []; const E = (i, type, attr) => ev.push({ tl: t0 + i * 1000 + 2 * 36e5, type, attr: attr || '', comments: '' });
  E(0, 'DayStart'); E(5, 'SailsUp', 'Main;J2;;'); let race = 0, mark = 0, racing = false;
  for (let i = 0; i < n; i++) {
    const tws = 11 + 4 * Math.sin(i / 2100) + 1.2 * Math.sin(i / 170) + 0.5 * g(), twd = 215 + 9 * Math.sin(i / 900) + 3 * Math.sin(i / 140) + 1.5 * g();
    if (i % 3300 === 300) { race++; mark = 0; racing = true; up = true; legT = 0; E(i, 'RaceStartGun', '' + race); E(i - 60, 'SailsUp', 'Main;J2;;'); }
    legT++;
    if (racing && legT > 720 && rnd() < 0.01) { up = !up; legT = 0; mark++; E(i, 'RaceMark', '' + mark); E(i + 15, 'SailsUp', up ? 'Main;J2;;' : 'Main;;;A2'); nextMan = i + 200 + rnd() * 200; if (mark === 4) { racing = false; E(i, 'RaceFinish', '' + race); } }
    if (i >= nextMan) { tk = -tk; nextMan = i + 150 + rnd() * 260; fs = 1.8 + rnd() * 1.6; effN = g() * 1.5; }
    const tg = up ? P.up(tws) : P.dn(tws), want = tg.twa + (up ? 2 : -3) + effN + 1.5 * Math.sin(i / 60);
    twaC += (want - twaC) * 0.12; const sinceMan = i - (nextMan - 200);
    const heel = up ? Math.min(26, 4 + tws * 1.25) + g() : 4 + tws * 0.2 + g() * 0.6;
    const eff = (up ? 1 - 0.0016 * (heel - 19) ** 2 - 0.03 * (fs - 2.6) ** 2 : 0.97) * (1 + 0.012 * g());
    const tb = P.bsp(tws, twaC) * eff; bsp += (tb - bsp) * 0.15; if (Math.abs(want - twaC) > 25) bsp *= 0.985;
    const twa = tk * twaC + g(), hdg = w360(twd - twa), a = twa * D2R, ax = tws * Math.cos(a) + bsp, ay = tws * Math.sin(a);
    ch.BSP[i] = bsp + 0.05 * g(); ch.TWA[i] = twa; ch.TWS[i] = tws; ch.TWD[i] = w360(twd + (tk > 0 ? 1.5 : -1.5)); ch.HDG[i] = hdg; ch.AWA[i] = Math.atan2(ay, ax) * R2D; ch.AWS[i] = Math.hypot(ax, ay);
    ch.COG[i] = w360(hdg + tk * (up ? 3 : 1) + g()); ch.SOG[i] = bsp * 0.99 + 0.08 * g(); ch.Heel[i] = -tk * heel; ch.Rudder[i] = -tk * (up ? 2.2 + (heel - 18) * 0.15 : 1) + 0.4 * g(); ch.Forestay[i] = up ? fs + 0.05 * g() : 0.4 + 0.05 * g();
    const d = ch.SOG[i] / 3600 / 60; lat += d * Math.cos(ch.COG[i] * D2R); lon += d * Math.sin(ch.COG[i] * D2R) / Math.cos(lat * D2R); ch.Lat[i] = lat; ch.Lon[i] = lon;
  }
  E(n - 5, 'DayStop');
  return { raw: { t0, n, ch, format: 'Demo' }, polar: P, events: { meta: { boat: 'Demo boat', date: '2026-06-13', location: 'IJmuiden', daytype: 'Racing; WinLee', goals: 'Example data - load your own files on the Setup tab' }, evOff: 2, logOff: 0, events: ev.sort((a, b) => a.tl - b.tl) } };
}

return { attrs, summary, buildLegs, TRENDS, fitTrend, trendBand, lineAt, residual, spearman, CAL0, calibActive, parseTime, csvRows, csvNumber, logOffset, D2R, R2D, fin, w180, w360, mean, sd, cmean, quant, median, ANG, MODES, DEF, parseLog, parseEvents, parsePolar, makePolar, polarText, analyse, avgPh, mostCommon, calTable, awaTable, twdPairs, solveAwaOffset, learnPolar, learnTargets, driverModel, modeClusters, windShifts, glitches, loess, corr, demo, sailLabel, trueWind };
})();
if (typeof module !== 'undefined') module.exports = SL;
