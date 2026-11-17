'use strict';
/* Boat/session records and processing rules; independent of the user interface. */
(() => {
  const copy = v => structuredClone(v), uid = () => globalThis.crypto.randomUUID();
  const freshWorkspace = () => ({ app: 'SailLens', type: 'workspace', version: 1, boats: [], sessions: [], lastSession: null });
  function newBoat(name) {
    if (!String(name).trim()) throw new Error('Geef de boot een naam.');
    return { id: uid(), name: String(name).trim(), revision: 1, formulas: [], channels: [], cfg: { ...SL.DEF, dispOff: 0 }, sails: [], polar: null, chart: null, calibrationHistory: [], baseline: '', updated: Date.now() };
  }
  function newSession(boat, name) {
    return { id: uid(), boatId: boat.id, name: name || 'Nieuwe sessie', created: Date.now(), updated: Date.now(), profile: copy(boat), raw: null, sources: [], events: null, polar: copy(boat.polar), chart: copy(boat.chart), cfg: { ...copy(boat.cfg), boat: boat.name, tStart: null, tEnd: null }, calib: copy(SL.CAL0), draft: copy(SL.CAL0), calibrationHistory: [], reviews: {}, notes: [], files: {}, selections: { analysis: null, A: null, B: null }, view: { z: 1, x: 0, y: 0 }, phaseBuild: {generated:false}, manoeuvrePairs: {}, analysisVersions: [], reportItems: [], analysisFilter: {}, stage:'prepare', tab: 'setup', cur: 0, baseline: boat.baseline || '', calibrationChanged: false };
  }
  function sessionSummary(s) { return { id: s.id, boatId: s.boatId, name: s.name, updated: s.updated, created: s.created, start: s.raw?.t0 ?? null, duration: s.raw?.n || 0, tab: s.tab, demo: !!s.demo }; }
  function mergeLogs(logs) {
    if (!logs.length) return null;
    if (new Set(logs.map(x => x.timeBasis || 'floating')).size > 1) throw new Error('Combineer alleen logbestanden met dezelfde tijdconventie.');
    const t0 = Math.min(...logs.map(x => x.t0)), end = Math.max(...logs.map(x => x.t0 + x.n * 1000)), n = (end - t0) / 1000;
    if (n > 7 * 86400) throw new Error('Kies een sessie van maximaal zeven dagen.');
    const ch = {}, age = {}, counts = {}, diagnostics = { rows: 0, invalidTimes: 0, outOfOrder: 0, aggregatedSamples: 0, invalidValues: 0, channels: {} };
    for (const raw of logs) {
      for (const k of ['rows', 'invalidTimes', 'outOfOrder', 'aggregatedSamples', 'invalidValues']) diagnostics[k] += raw.diagnostics?.[k] || 0;
      const offset = (raw.t0 - t0) / 1000;
      for (const [key, a] of Object.entries(raw.ch)) {
        if (!ch[key]) { ch[key] = new Float64Array(n).fill(NaN); age[key] = new Uint8Array(n).fill(255); counts[key] = new Uint32Array(n); }
        for (let j = 0; j < raw.n; j++) {
          const i = j + offset, v = a[j], ag = raw.age?.[key]?.[j] ?? (Number.isFinite(v) ? 0 : 255);
          if (!Number.isFinite(v)) continue;
          if (Number.isFinite(ch[key][i]) && ag === 0 && age[key][i] === 0 && Math.abs(ch[key][i] - v) > 1e-7) throw new Error('Tegenstrijdige overlappende metingen: ' + key + ' op ' + new Date(t0 + i * 1000).toISOString() + '. Importeer deze logs als aparte sessies.');
          if (ag <= age[key][i]) { ch[key][i] = v; age[key][i] = ag; counts[key][i] = raw.counts?.[key]?.[j] || (ag === 0 ? 1 : 0); }
        }
      }
    }
    for (const k of Object.keys(ch)) { let observed = 0, held = 0; for (let i = 0; i < n; i++) if (Number.isFinite(ch[k][i])) { if (age[k][i] === 0) observed++; else held++; } diagnostics.channels[k] = { observed, held, missing: n - observed - held }; }
    return { t0, n, ch, age, counts, timeBasis: logs[0].timeBasis || 'floating', diagnostics, format: logs.length > 1 ? logs.length + ' logbestanden' : logs[0].format };
  }
  function mappedRaw(raw, mappings = []) {
    if (!raw) return null;
    const out = { ...raw, ch: { ...raw.ch }, age: { ...raw.age } };
    for (const m of mappings) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(m.target) || ['__proto__', 'constructor', 'prototype'].includes(m.target) || !Number.isFinite(m.factor) || !Number.isFinite(m.offset)) throw new Error('Ongeldige kanaaltoewijzing.');
      if (!Object.hasOwn(raw.ch, m.source)) { out.ch[m.target] = new Float64Array(raw.n).fill(NaN); continue; }
      out.ch[m.target] = Float64Array.from(raw.ch[m.source], v => v * m.factor + m.offset);
      if (raw.age?.[m.source]) out.age[m.target] = raw.age[m.source];
    }
    return out;
  }
  function objectRange(D, obj, kind) {
    const t = D.raw.t0 + obj.i * 1000;
    return kind === 'phase' ? { kind, start: t, end: D.raw.t0 + obj.i1 * 1000 } : { kind, start: t - 50000, end: t + 60000, anchor: t, type: obj.type };
  }
  const reviewKey = r => [r.kind, r.anchor ?? r.start, r.end, r.type || ''].join(':');
  function reviewed(D, obj, kind, reviews) { return reviews[reviewKey(objectRange(D, obj, kind))]; }
  const allowed = (r, purpose) => !r?.invalid && (purpose === 'calibration' ? r?.calibration === true : r?.performance !== false);
  const overlap = (a, b) => a.start < b.end && a.end > b.start;
  const performanceAllowed = (range, reviews) => !Object.values(reviews).some(r => (r.invalid || r.performance === false) && overlap(range, r));
  function calibrationPhases(D, reviews) {
    const ranges = Object.values(reviews).filter(r => r.kind === 'interval' && r.calibration && !r.invalid);
    const veto = Object.values(reviews).filter(r => r.invalid || (r.kind === 'interval' && r.calibration === false));
    return D.phases.filter(p => { const range = objectRange(D, p, 'phase'), review = reviewed(D, p, 'phase', reviews); if (veto.some(r => overlap(range, r)) || review?.calibration === false || review?.invalid) return false; return allowed(review, 'calibration') || ranges.some(r => range.start >= r.start && range.end <= r.end); });
  }
  function slowStats(D, reviews = {}, range = null, threshold = 95, filter = null) {
    const out = { valid: 0, target: 0, unknown: 0, slow: 0, manoeuvre: 0, straight: 0, invalid: 0, excluded: 0, slowRanges: [] }, man = new Uint8Array(D.n);
    D.mans.forEach(m => man.fill(1, Math.max(0, m.i - D.cfg.manBefore), Math.min(D.n, m.i + D.cfg.manAfter)));
    const excluded = Object.values(reviews).filter(r => r.performance === false && !r.invalid); let span = null;
    for (let i = D.i0; i < D.i1; i++) {
      const t = D.raw.t0 + i * 1000; if (range && (t < range.start || t >= range.end)) continue;
      if(filter && !SL.sampleMatches(D,i,filter)){span=null;continue;}
      if (excluded.some(r => t >= r.start && t < r.end)) { out.excluded++; span = null; continue; }
      if (!Number.isFinite(D.ch.BSP[i]) || D.invalid?.[i]) { out.invalid++; span = null; continue; }
      // Low-speed sailing belongs in the denominator. Activity is determined by wind/angle or a race event, not target percentage.
      const sailing = D.L.race[i] > 0 || (Number.isFinite(D.ch.TWA[i]) && Math.abs(D.ch.TWA[i]) >= 25 && D.ch.TWS[i] >= 2 && D.ch.BSP[i] >= 0.2);
      if (!sailing || (D.cfg.racingOnly && !D.L.race[i])) { span = null; continue; }
      out.valid++;
      const pct = D.ch['BSPpol%'][i];
      if (!Number.isFinite(pct) || D.polarSrc === 'learned') { out.unknown++; span = null; continue; }
      out.target++;
      if (pct < threshold) { out.slow++; out[man[i] ? 'manoeuvre' : 'straight']++; if (!span) { span = { start: t, end: t + 1000, seconds: 0 }; out.slowRanges.push(span); } span.end = t + 1000; span.seconds++; }
      else span = null;
    }
    out.percent = out.target ? out.slow / out.target * 100 : NaN;
    out.coverage = out.valid ? out.target / out.valid * 100 : NaN;
    return out;
  }
  function validateSession(s, nested = false) {
    if (!s || typeof s.id !== 'string' || typeof s.boatId !== 'string' || !s.profile || !s.cfg || !Array.isArray(s.sources) || !s.selections || !s.reviews) throw new Error('Ongeldige sessie in projectbestand.');
    SL.compileFormulas(s.profile.formulas || []);
    if (s.raw) {
      if (!Number.isFinite(s.raw.t0) || !Number.isInteger(s.raw.n) || s.raw.n < 1 || s.raw.n > 604800 || !s.raw.ch) throw new Error('Ongeldige log in projectbestand.');
      for (const a of Object.values(s.raw.ch)) if (!(a instanceof Float64Array) || a.length !== s.raw.n) throw new Error('Ongeldige meetreeks in projectbestand.');
    }
    for(const key of ['analysisVersions','reportItems','reportTrash'])if(s[key]!==undefined&&!Array.isArray(s[key]))throw new Error('Ongeldige '+key+' in projectbestand.');
    if(!nested)for(const v of s.analysisVersions||[]){if(!Number.isInteger(v.number)||v.number<1||typeof v.signature!=='string'||!v.input||v.input.analysisVersions)throw new Error('Ongeldige opgeslagen sessieversie.');validateSession(v.input,true);}
    for(const item of [...(s.reportItems||[]),...(s.reportTrash||[])]){if(!item||typeof item.id!=='string'||typeof item.title!=='string'||!Array.isArray(item.blocks)||(item.history!==undefined&&!Array.isArray(item.history)))throw new Error('Ongeldig reportonderdeel.');for(const state of [item,...(item.history||[])]){if(!Array.isArray(state.blocks)||state.blocks.some(b=>!b||!['heading','text','image','table'].includes(b.type)||(b.type==='table'&&(!Array.isArray(b.rows)||b.rows.some(r=>!Array.isArray(r))))))throw new Error('Ongeldige reportinhoud.');}}
    return s;
  }
  function encodeProject(value) { return JSON.stringify(value, (k, v) => ArrayBuffer.isView(v) ? { $array: v.constructor.name, values: Array.from(v, x => Number.isFinite(x) ? x : null) } : v); }
  function decodeProject(text) {
    const types = { Float64Array, Uint8Array, Uint32Array, Int8Array, Int16Array, Int32Array };
    const o = JSON.parse(text, (k, v) => {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Reserved property in project file.');
      if (v && v.$array) { if (!Object.hasOwn(types, v.$array) || !Array.isArray(v.values) || v.values.length > 604800 || v.values.some(x => x !== null && !Number.isFinite(x))) throw new Error('Invalid array in project file.'); return types[v.$array].from(v.values, x => x === null ? NaN : x); } return v;
    });
    if (o.app !== 'SailLens' || o.type !== 'project' || o.version !== 1 || !Array.isArray(o.boats) || !Array.isArray(o.sessions)) throw new Error('Dit is geen ondersteund SailLens-projectbestand.');
    const ids = new Set(); for (const b of o.boats) { if (typeof b.id !== 'string' || !b.name || ids.has(b.id)) throw new Error('Ongeldig bootprofiel.'); ids.add(b.id); SL.compileFormulas(b.formulas || []); }
    const sessions = new Set(); for (const s of o.sessions) { validateSession(s); if (!ids.has(s.boatId) || sessions.has(s.id)) throw new Error('Sessies moeten uniek zijn en bij een boot horen.'); sessions.add(s.id); }
    return o;
  }
  Object.assign(SL, { copy, uid, freshWorkspace, newBoat, newSession, sessionSummary, mergeLogs, mappedRaw, objectRange, reviewKey, reviewed, allowed, performanceAllowed, calibrationPhases, slowStats, validateSession, encodeProject, decodeProject });
})();
