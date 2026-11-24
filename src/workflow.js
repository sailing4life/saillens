'use strict';
/* The boat-first workspace. Legacy specialist plots remain available inside Analyse. */
const WF = (() => {
  let library = SL.freshWorkspace(), session = null, timer, dirty = false, revision = 0, savedRevision = 0, loading = false;
  const db = SL.createStore(indexedDB), write = SL.serialWriter(entries => db.setMany(entries));
  let saveMessage = 'Opslag wordt geopend…', analysisMode = 'Overzicht', reviewMode = 'Fases', mobileView = 'Beide', selectedKey = null;
  const analysisTabs = new Set(['analysis', 'summary', 'perf', 'xy', 'man', 'wind', 'polar', 'sails', 'ml']);
  const boat = () => library.boats.find(b => b.id === session?.boatId) || library.boats[0];
  const btn = (label, fn, primary = false, attrs = {}) => h('button', { type: 'button', class: primary ? 'primary' : '', onclick: fn, ...attrs }, label);
  const help = text => h('p', { class: 'muted' }, text);
  const notice = text => h('div', { class: 'wf-notice', role: 'status' }, text);
  const safe = fn => async (...args) => { try { return await fn(...args); } catch (e) { banner(e.message, true); } };
  function snapshot(clone=true) {
    if (!session) return null;
    const s = { ...session, raw: A.raw, events: A.events, polar: A.polar ? { rows: A.polar.rows, src: A.polar.src } : null, chart: A.chart,
      cfg: A.cfg, calib: A.calib || SL.CAL0, files: A.files, cur: A.cur, view: A.view,
      tab: ['home', 'boat', 'season'].includes(A.tab) ? (session.tab || 'setup') : A.tab, demo: A.demo,
      ui: { filt: A.filt, cst: A.cst, xst: A.xst, st: A.st, fst: A.fst, mnst: A.mnst, rst: A.rst, est: A.est, pol: A.pol, analysisMode, reviewMode, mobileView, selectedKey }, updated: Date.now() };
    return clone ? structuredClone(s) : s;
  }
  function status() {
    const e = $('#wf-save'); if (e) { e.textContent = saveMessage; e.className = dirty ? 'chip dirty' : 'chip'; }
    if ($('#dirty')) $('#dirty').hidden = true;
  }
  function touch() {
    if (loading) return; revision++; dirty = true; saveMessage = 'Wijzigingen opslaan…'; status(); clearTimeout(timer);
    timer = setTimeout(() => persist().catch(() => {}), 500);
  }
  async function persist() {
    clearTimeout(timer); const rev = revision, s = snapshot(), next = SL.copy(library);
    if (s) { const item = SL.sessionSummary(s), i = next.sessions.findIndex(x => x.id === s.id); if (i >= 0) next.sessions[i] = item; else next.sessions.push(item); next.lastSession = s.id; }
    try {
      await write([['workspace', next], ...(s ? [['session:' + s.id, s]] : [])]);
      // Newer edits may have arrived while this transaction was writing.
      if (rev === revision) { library.sessions = next.sessions; library.lastSession = next.lastSession; savedRevision = rev; dirty = false; saveMessage = 'Opgeslagen in deze browser'; A.evDirty = false; }
      status(); return true;
    } catch (e) { dirty = true; saveMessage = 'Niet opgeslagen — maak een projectbackup'; status(); banner('Opslaan mislukt: ' + e.message + '. Je kunt het project nog exporteren en opnieuw proberen.', true); throw e; }
  }
  function process(s, calib = s.calib, raw = s.raw, cfg = s.cfg) {
    if (!raw) return null;
    const mapped = SL.mappedRaw(raw, s.profile.channels || []);
    cfg = {...cfg, ...(s.phaseBuild?.rules ? Object.fromEntries(SL.phaseKeys.map(k=>[k,s.phaseBuild.rules[k]])) : {})};
    return SL.analyse(mapped, { cfg, skipPhases: s.phaseBuild && (!s.phaseBuild.generated || Array.isArray(s.phaseBuild.ranges)), turnEdits:s.turnEdits, phaseBuild:s.phaseBuild, phaseRules:s.phaseBuild?.rules, events: s.events, polar: s.polar ? SL.makePolar(s.polar.rows, s.polar.src || 'file') : null, calib,
      formulas: s.profile.formulas || [], originalChannels: raw.ch, invalidRanges: Object.values(s.reviews).filter(r => r.invalid) });
  }
  function recompute() {
    if (!session || !A.raw) return true;
    try {
      const s = snapshot(), next = process(s); A.D = next; A.cur = Math.max(next.i0, Math.min(next.i1 - 1, A.cur)); A.view ||= { z: 1, x: 0, y: 0 }; A.ml = {};
      const keys = new Set(objects(next).map(x => x.key));
      session.staleReviews = Object.values(session.reviews).filter(r => r.kind !== 'interval' && !keys.has(SL.reviewKey(r))).length;
      banner(next.warn.join(' ')); touch(); return true;
    } catch (e) { banner('Berekening mislukt; het laatste resultaat blijft zichtbaar. ' + e.message, true); return false; }
  }
  function adopt(s, D) {
    for(const input of [s,...(s.analysisVersions||[]).map(v=>v.input)]){
      const build=input.phaseBuild;
      if(!build?.sourceKey)continue;
      try{
        const stored=JSON.parse(build.sourceKey);
        if(!Array.isArray(stored.events)){
          stored.events=(stored.events?.events||[]).filter(e=>e.type!=='MiscEvent').map(({type,tl,attr})=>[type,tl,attr]);
          build.sourceKey=JSON.stringify(stored);
        }
      }catch{ /* An unreadable signature still requires regeneration. */ }
    }
    session = s;
    Object.assign(A, { raw: s.raw, events: s.events, polar: s.polar ? SL.makePolar(s.polar.rows, s.polar.src) : null, chart: s.chart || SL.newChart(), cfg: s.cfg,
      calib: s.calib, files: s.files, cur: s.cur || 0, view: s.view || { z: 1, x: 0, y: 0 }, D: D || null, demo: !!s.demo, scope: 'day', ml: {}, evDirty: false,
      filt: { sails: '', leg: '', tack: '', day: '' }, cst: undefined, xst: undefined, st: undefined, fst: undefined, mnst: undefined, rst: undefined, est: undefined, pol: undefined });
    for (const k of ['filt', 'cst', 'xst', 'st', 'fst', 'mnst', 'rst', 'est', 'pol']) if (s.ui?.[k]) A[k] = s.ui[k];
    analysisMode = s.ui?.analysisMode || 'Overzicht'; reviewMode = s.ui?.reviewMode || 'Fases'; mobileView = s.ui?.mobileView || 'Beide'; selectedKey = s.ui?.selectedKey || null;
  }
  async function open(id) {
    if (dirty) await persist();
    const s = SL.validateSession(await db.get('session:' + id)), D = process(s);
    loading = true; adopt(s, D); loading = false;
    show(!s.tab || ['home', 'boat', 'season'].includes(s.tab) ? 'setup' : s.tab);
  }
  async function openVersion(number) {
    const version=session.analysisVersions.find(v=>v.number===number);
    if(!version)return;
    await persist();
    const copy=SL.copy(version.input);
    copy.id=SL.uid();
    copy.name=session.name+' · kopie v'+number;
    copy.analysisVersions=[SL.copy(version)];
    copy.analysisVersions[0].input.id=copy.id;
    copy.analysisVersions[0].input.name=copy.name;
    copy.reportItems=[];copy.tab='analysis';copy.stage='analysis';
    const next=SL.copy(library);
    next.sessions.push(SL.sessionSummary(copy));
    next.lastSession=copy.id;
    const data=process(copy);
    await write([['workspace',next],['session:'+copy.id,copy]]);
    library=next;adopt(copy,data);show('analysis');
  }
  async function create(boatId, demo = false) {
    if (dirty) await persist();
    const b = library.boats.find(x => x.id === boatId); if (!b) throw new Error('Kies eerst een boot.');
    const s = SL.newSession(b, demo ? 'Voorbeeldtraining' : 'Training ' + new Date().toLocaleDateString('nl-NL'));
    if (demo) { const d = SL.demo(); Object.assign(s, { raw: d.raw, events: d.events, polar: { rows: d.polar.rows, src: 'file' }, demo: true }); s.cfg.evOff = 2; s.cfg.dispOff = 2; s.files.log = 'Synthetische voorbeelddata'; }
    loading = true; adopt(s, process(s)); loading = false; touch(); await persist(); show(demo?'events':'setup');
  }
  function resolve(tab) {
    if(tab==='chart') { selectedKey=null; if(A.D) session.viewport=[Math.max(A.D.i0,A.cur-90),Math.min(A.D.i1,A.cur+120)]; tab=session?.stage==='analysis'?'daycharts':'events'; }
    if(tab==='phases')tab='review';
    return typeof STUDIO!=='undefined'?STUDIO.route(tab):tab;
  }
  function rangeIndices(range = session?.selections.analysis, D = A.D) {
    return range ? [Math.max(D.i0, Math.floor((range.start - D.raw.t0) / 1000)), Math.min(D.i1, Math.ceil((range.end - D.raw.t0) / 1000))] : [D.i0, D.i1];
  }
  function filteredPhases(ps, purpose = 'performance') {
    if (!session || season()) return ps;
    if (purpose === 'calibration') return SL.calibrationReferences(A.D,session).phases;
    const r = session.selections.analysis;
    return ps.filter(p => SL.sampleMatches(A.D,p.i,session.analysisFilter||{}) && SL.performanceAllowed({ start: p.t, end: iT(p.i1) }, session.reviews) && (!r || (p.t >= r.start && iT(p.i1) <= r.end)));
  }
  function objects(D = A.D) {
    if (!D) return [];
    return D.phases.map(p => ({ kind: 'phase', obj: p, label: p.mode + ' · ' + p.tack, range: SL.objectRange(D, p, 'phase') })).concat(D.mans.map(m => ({ kind: 'manoeuvre', obj: m, label: m.type + ' → ' + m.to, range: SL.objectRange(D, m, 'manoeuvre') }))).map(x => ({ ...x, key: SL.reviewKey(x.range) }));
  }
  function setReview(item, changes) {
    const prev = session.reviews[item.key] || { ...item.range, calibration: false, performance: true, invalid: false, reason: '' };
    session.reviews[item.key] = { ...prev, ...changes, updated: Date.now() };
    if (changes.invalid !== undefined && !recompute()) { session.reviews[item.key] = prev; return; }
    touch(); show('review');
  }
  async function hash(text) { const out = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(out)].map(n => n.toString(16).padStart(2, '0')).join(''); }
  function kindOf(name, text) {
    const head = text.slice(0, 3000), first = head.split('\n')[0];
    if (/^\s*\{/.test(head)) { const o = JSON.parse(text); return o.type === 'project' ? 'project' : o.type === 'calibration' ? 'calib' : o.type === 'sailchart' ? 'chart' : 'season'; }
    if (/DistanceLost_m|StartDateTime/.test(first)) return 'season';
    if (/<daysail|<events[\s>]/.test(text.slice(0, 20000))) return 'ev';
    if (/^\s*</.test(head)) return 'chart';
    if (/^!boat/i.test(head) || /(^|[,;\t])\s*"?(utc|time|timestamp|datetime|date_time|date|isodatetime)"?\s*([,;\t]|$)/i.test(first)) return 'log';
    return 'polar';
  }
  async function importFiles(files, forced) {
    if (!files.length) return;
    try {
      const items = [];
      for (const f of files) { const text = (await f.text()).replace(/^\uFEFF/, ''); items.push({ name: f.name, text, hash: await hash(text), kind: forced || kindOf(f.name, text) }); }
      if (items.some(x => ['project', 'season'].includes(x.kind))) {
        if (items.length !== 1) throw new Error('Importeer een project- of seizoensbestand apart van logbestanden.');
        if (items[0].kind === 'project') await importProject(items[0].text); else { seasonImport(items[0].text, items[0].name); show('season'); } return;
      }
      if (!session) throw new Error('Maak eerst een boot en een nieuwe sessie aan.');
      const staged = snapshot(); let duplicates = 0;
      if (staged.demo && items.some(x => x.kind === 'log')) throw new Error('Maak een nieuwe sessie voor je eigen log. Deze sessie bevat voorbeelddata.');
      const logParts = staged.raw ? [staged.raw] : [];
      for (const item of items) {
        if (staged.sources.some(x => x.hash === item.hash)) { duplicates++; continue; }
        const source = { ...item, size: new TextEncoder().encode(item.text).length };
        if (item.kind === 'log') { const r = SL.parseLog(item.text); logParts.push(r); source.start = r.t0; source.end = r.t0 + r.n * 1000; source.channels = Object.keys(r.ch); }
        else if (item.kind === 'ev') { const ev = SL.parseEvents(item.text); ev.sails = SL.parseSailList(item.text); ev.xml = item.text;
          if (staged.sources.some(x=>x.kind==='ev') && staged.events && (staged.events.evOff !== ev.evOff || staged.events.logOff !== ev.logOff)) throw new Error('Eventbestanden hebben verschillende klokinstellingen. Importeer ze als aparte sessies.');
          if (staged.events) {
            // Manually placed events may precede the first import with a declared UTC offset.
            const old=staged.events;
            const prior=staged.raw?SL.logOffset(staged.raw,staged.cfg):(old.logOff||0);
            const next=staged.raw?SL.logOffset(staged.raw,{...staged.cfg,logOff:ev.logOff}):ev.logOff;
            const shift=(ev.evOff-(old.evOff||0)+prior-next)*36e5;
            const existing=old.events.map(e=>({...e,tl:e.tl+shift})), key=e=>JSON.stringify([e.tl,e.type,e.attr,e.comments]), counts=new Map();
            for(const e of existing)counts.set(key(e),(counts.get(key(e))||0)+1);
            for(const e of ev.events){const k=key(e);if(counts.get(k))counts.set(k,counts.get(k)-1);else existing.push(e);}
            ev.events=existing.sort((a,b)=>a.tl-b.tl);ev.sails=[...new Map([...staged.events.sails||[],...ev.sails].map(s=>[s.name,s])).values()]; }
          staged.eventUndo=[];staged.events = ev; staged.cfg.evOff = ev.evOff; staged.cfg.logOff = ev.logOff;
        } else if (item.kind === 'polar') staged.polar = { rows: SL.parsePolar(item.text), src: 'file' };
        else if (item.kind === 'chart') staged.chart = SL.parseSailChart(item.text, item.name);
        else if (item.kind === 'calib') { staged.draft = validateCalib(JSON.parse(item.text)); }
        staged.files[item.kind] = item.name; staged.sources.push(source);
      }
      if (logParts.length) staged.raw = SL.mergeLogs(logParts);
      if (staged.raw) { staged.cfg.logOff = SL.logOffset(staged.raw, staged.cfg); staged.cfg.dispOff = (staged.cfg.evOff || 0) - staged.cfg.logOff; }
      const D = process(staged);
      if (staged.polar) { const b = library.boats.find(x => x.id === staged.boatId); b.polar = SL.copy(staged.polar); }
      if (staged.events?.sails?.length) {
        const b=library.boats.find(x=>x.id===staged.boatId);
        b.sails=[...new Map([...(b.sails||[]),...staged.events.sails].map(v=>[v.name,v])).values()];
        staged.profile.sails=SL.copy(b.sails);
      }
      adopt(staged, D); touch(); await persist(); show(D && items.some(x=>x.kind==='log'||x.kind==='ev')?'events':'setup');
      banner(`${items.length - duplicates} bestand(en) toegevoegd${duplicates ? '; ' + duplicates + ' duplicaten overgeslagen' : ''}.`);
    } catch (e) { banner(e.message, true); }
  }
  async function exportProject() {
    const sessions = [];
    for (const x of library.sessions) { const s = x.id === session?.id ? snapshot() : await db.get('session:' + x.id); if (s) sessions.push(s); }
    if (session && !sessions.some(x => x.id === session.id)) sessions.push(snapshot());
    dl('SailLens-project.json', SL.encodeProject({ app: 'SailLens', type: 'project', version: 1, exported: new Date().toISOString(), boats: library.boats, sessions, season: A.S }));
  }
  async function importProject(text) {
    const incoming = SL.decodeProject(text); if (dirty) await persist();
    const next = SL.copy(library), entries = [], boatMap = new Map();
    // Restore as new boats/sessions so an old backup cannot silently overwrite newer work.
    for (const b of incoming.boats) { const id = SL.uid(); boatMap.set(b.id, id); next.boats.push({ ...b, id, name: b.name + ' (import)' }); }
    for (const old of incoming.sessions) { const s = { ...old, id: SL.uid(), boatId: boatMap.get(old.boatId) }; s.profile.id = s.boatId;
      const signatures=new Map();for(const v of s.analysisVersions||[]){const previous=v.signature;v.input.id=s.id;v.input.boatId=s.boatId;v.input.profile.id=s.boatId;v.signature=SL.preparationKey(v.input);signatures.set(previous,v.signature);}
      for(const item of [...(s.reportItems||[]),...(s.reportTrash||[])])for(const state of [item,...(item.history||[])])if(signatures.has(state.signature))state.signature=signatures.get(state.signature);
      process(s); entries.push(['session:' + s.id, s]); next.sessions.push(SL.sessionSummary(s)); }
    let restoredSeason = null;
    if (incoming.season) { restoredSeason = SL.copy(A.S); SL.seasonMerge(restoredSeason, incoming.season.days); entries.push(['season', restoredSeason]); }
    await write([['workspace', next], ...entries]); library = next; if (restoredSeason) { A.S = restoredSeason; seasonChanged(false); } show('home'); banner('Project hersteld als aparte bootprofielen; je bestaande sessies blijven beschikbaar.');
  }
  function afterShow() {
    if (session && !['home','boat','season'].includes(A.tab)) session.tab=A.tab;
    $('#status').textContent=session?session.profile.name+' · '+session.name+(A.demo?' · voorbeeld':''):'Bootwerkruimte';
    STUDIO.chrome(); status(); if(!loading&&session)touch();
  }
  function selectionBar() {
    const D = A.D, selected = session.selections.analysis, [i0, i1] = rangeIndices();
    const local = t => new Date(t + A.cfg.dispOff * 36e5).toISOString().slice(0, 19);
    const from = h('input', { type: 'datetime-local', step: 1, value: local(iT(i0)), id: 'range-from' });
    const to = h('input', { type: 'datetime-local', step: 1, value: local(iT(i1)), id: 'range-to' });
    return h('div', { class: 'wf-selection noprint' }, h('div', { class: 'bar' }, h('b', {}, selected ? 'Actieve selectie' : 'Hele sessie'),
      field('Van', from), field('Tot', to), btn('Selecteer', () => { const a = Date.parse(from.value + 'Z') - A.cfg.dispOff * 36e5, b = Date.parse(to.value + 'Z') - A.cfg.dispOff * 36e5; if (!fin(a) || !fin(b) || b <= a || a < iT(D.i0) || b > iT(D.i1)) return banner('Kies een geldig tijdvak binnen deze sessie.', true); session.selections.analysis = { start: a, end: b }; A.cur = (a - A.raw.t0) / 1000; touch(); show(A.tab); }),
      btn('Hele sessie', () => { session.selections.analysis = null; selectedKey = null; show(A.tab); }),
      ['A', 'B'].map(k => btn('Bewaar als ' + k, () => { session.selections[k] = { start: iT(i0), end: iT(i1) }; touch(); show(A.tab); }))),
      help(`${dur(i1 - i0)} geselecteerd · zoomen verplaatst alleen het beeld. Kalibratiereferenties worden apart goedgekeurd.`));
  }
  function timePanel(container) {
    if (!A.D) return;
    const D = A.D, map = h('canvas', { class: 'wf-map', 'aria-label': 'Track van de boot' }), strip = h('canvas', { class: 'wf-strip', 'aria-label': 'Tijdreeks. Sleep om een tijdvak te selecteren.' });
    const vars = varList(), key = session.plotVariable && vars.includes(session.plotVariable) ? session.plotVariable : 'BSP', vp = session.viewport || [D.i0, D.i1];
    const viewControls = bar(['Kaart', 'Grafieken', 'Beide'].map(name => btn(name, () => { mobileView = name; show(A.tab); }, mobileView === name)), field('Variabele', sel('wf-variable', vars, key, v => { session.plotVariable = v; show(A.tab); })), btn('+ Variabele', () => show('boat')));
    const mapBox = h('div', { class: 'wf-mapbox', hidden: mobileView === 'Grafieken' }, map);
    const graphBox = h('div', { class: 'wf-graphbox', hidden: mobileView === 'Kaart' }, strip);
    const box = card('Track & tijdreeks', viewControls, h('div', { class: 'wf-timeviews' }, mapBox, graphBox)); container.append(box);
    let geo, p, drag, mapDrag;
    const cursor = h('input', { type: 'range', min: D.i0, max: D.i1 - 1, value: A.cur, 'aria-label': 'Tijdcursor', oninput: e => { A.cur = +e.target.value; draw(); } });
    const readout = h('span');
    function draw() {
      if (!mapBox.hidden) {
        geo = drawMap(map, { v: key, cur: A.cur, view: A.view, h: 330 });
        const r = session.selections.analysis;
        if (geo && r) { const [lo, hi] = rangeIndices(r), c = map.getContext('2d'); c.strokeStyle = css('--ink'); c.lineWidth = 5; c.beginPath(); let on = false; for (let i = lo; i < hi; i++) { if (!fin(geo.X(i)) || !fin(geo.Y(i))) { on = false; continue; } on ? c.lineTo(geo.X(i), geo.Y(i)) : c.moveTo(geo.X(i), geo.Y(i)); on = true; } c.stroke(); }
      }
      if (!graphBox.hidden) {
        const a = D.ch[key], lo = Math.max(D.i0, vp[0]), hi = Math.min(D.i1, vp[1]), vals = a ? Array.from(a.subarray(lo, hi)).filter(fin) : [], min = SL.quant(vals, A.tab==='pairreview'?0:.01), max = SL.quant(vals, A.tab==='pairreview'?1:.99), pad = (max - min) * .12 || 1;
        p = plot(strip, { xr: [lo, hi], yr: fin(min) ? [min - pad, max + pad] : [0, 1], h: 330, yl: key, xfmt: i => tstr(iT(i)), xTickGap: 110, pb: 30 });
        for (const r of Object.values(session.reviews).filter(r => r.invalid)) { p.c.fillStyle = alpha(css('--bad'), .18); p.c.fillRect(p.X((r.start - A.raw.t0) / 1000), p.pt, (r.end - r.start) / 1000 * (p.W - p.pl - p.pr) / (hi - lo), p.H - p.pt - p.pb); }
        if(A.tab==='pairreview' && session.activePairKey){const q=session.manoeuvrePairs?.[session.activePairKey];for(const [r,col]of [[q?.before,'--s1'],[q?.after,'--s3']])if(r){p.c.fillStyle=alpha(css(col),.15);p.c.fillRect(p.X((r.start-A.raw.t0)/1000),p.pt,(r.end-r.start)/1000*(p.W-p.pl-p.pr)/(hi-lo),p.H-p.pt-p.pb);}}
        if (session.selections.analysis) { const [a, b] = rangeIndices(); p.c.fillStyle = alpha(css('--accent'), .16); p.c.fillRect(p.X(a), p.pt, p.X(b) - p.X(a), p.H - p.pt - p.pb); }
        if (a) { const step = Math.max(1, Math.floor((hi - lo) / 1800)); const pts = []; for (let i = lo; i < hi; i += step) pts.push([i, a[i]]); p.line(pts, css('--s1')); }
        p.c.strokeStyle = css('--ink'); p.c.beginPath(); p.c.moveTo(p.X(A.cur), p.pt); p.c.lineTo(p.X(A.cur), p.H - p.pb); p.c.stroke();
      }
      readout.textContent = tstr(iT(A.cur)) + ' · ' + key + ' ' + f1(D.ch[key]?.[A.cur], 2); cursor.value = A.cur;
    }
    box.append(cursor, bar(readout, btn('Zoom op selectie', () => { session.viewport = rangeIndices(); show(A.tab); }), btn('Volledig beeld', () => { session.viewport = null; A.view = { z: 1, x: 0, y: 0 }; show(A.tab); }), btn('Kaart +', () => { A.view.z = Math.min(80, A.view.z * 1.4); draw(); touch(); }), btn('Kaart −', () => { A.view.z = Math.max(.5, A.view.z / 1.4); draw(); touch(); })), help('Klik voor de tijdcursor; sleep in de grafiek voor een selectie. Versleep de kaart om te pannen. De selectie is ook met de tijdvelden instelbaar.'));
    const at = e => Math.max(D.i0, Math.min(D.i1, Math.round(p.xr[0] + (e.offsetX - p.pl) / (p.W - p.pl - p.pr) * (p.xr[1] - p.xr[0]))));
    strip.addEventListener('pointerdown', e => { if (!p) return; drag = at(e); strip.setPointerCapture(e.pointerId); });
    strip.addEventListener('pointerup', e => { if (drag == null) return; const end = at(e); A.cur = Math.min(D.i1 - 1, end); if (Math.abs(end - drag) > 2) session.selections.analysis = { start: iT(Math.min(end, drag)), end: iT(Math.max(end, drag)) }; drag = null; selectedKey = null; show(A.tab); });
    map.addEventListener('pointerdown', e => { mapDrag = { x: e.offsetX, y: e.offsetY, vx: A.view.x, vy: A.view.y }; map.setPointerCapture(e.pointerId); });
    map.addEventListener('pointermove', e => { if (!mapDrag) return; const dx = e.offsetX - mapDrag.x, dy = e.offsetY - mapDrag.y; if (Math.abs(dx) + Math.abs(dy) > 5) { mapDrag.moved = true; A.view.x = mapDrag.vx - dx / A.view.z; A.view.y = mapDrag.vy - dy / A.view.z; draw(); } });
    map.addEventListener('pointerup', e => { if (geo && !mapDrag?.moved) { let best = -1, dist = 900; for (let i = D.i0; i < D.i1; i++) { const d = (geo.X(i) - e.offsetX) ** 2 + (geo.Y(i) - e.offsetY) ** 2; if (d < dist) { best = i; dist = d; } } if (best >= 0) A.cur = best; } mapDrag = null; draw(); touch(); });
    draw();
  }
  function home() {
    const c = pane('home'), name = h('input', { id: 'new-boat-name', placeholder: 'Bijvoorbeeld Cape 31', 'aria-label': 'Nieuwe bootnaam' });
    const file = h('input', { type: 'file', accept: '.json', hidden: '', onchange: e => e.target.files[0] && importFiles([e.target.files[0]]) });
    c.append(h('div', { class: 'wf-hero' }, h('div', {}, h('span', { class: 'eyebrow' }, 'SAILLENS / WORKSPACE'), h('h1', {}, 'Van log naar inzicht.'), help('Kies je boot, beoordeel de data en maak van iedere sessie een bruikbare debrief.')), btn('Projectbackup', safe(exportProject))),
      card('Jouw boten', h('div', { class: 'wf-boats' }, library.boats.map(b => h('article', { class: 'wf-boat' }, h('span', { class: 'eyebrow' }, 'BOOTPROFIEL · V' + b.revision), h('h2', {}, b.name), help(library.sessions.filter(s => s.boatId === b.id).length + ' sessies · ' + b.formulas.length + ' eigen variabelen'), bar(btn('Nieuwe sessie', safe(() => create(b.id)), true), btn('Instellingen', () => { WF.editBoatId = b.id; show('boat'); }))))),
        bar(field('Nieuwe boot', name), btn('Boot toevoegen', safe(async () => { const b = SL.newBoat(name.value); library.boats.push(b); touch(); await persist(); await create(b.id); }), true))),
      card('Recente sessies', library.sessions.length ? table(['Boot', 'Sessie', 'Begintijd log', 'Laatst bewerkt', ''], [...library.sessions].sort((a, b) => b.updated - a.updated).map(s => [library.boats.find(b => b.id === s.boatId)?.name || 'Boot', s.name, s.start ? new Date(s.start).toISOString().slice(0, 16).replace('T', ' ') : 'Nog geen log', new Date(s.updated).toLocaleString('nl-NL'), btn('Open sessie', safe(() => open(s.id)))])) : help('Je eerste sessie verschijnt hier zodra je een boot toevoegt.'),
        bar(btn('Project importeren', () => file.click()), file, btn('Bekijk voorbeeld', safe(async () => { let b = library.boats.find(b => b.example); if (!b) { b = SL.newBoat('Voorbeeldboot'); b.example = true; library.boats.push(b); } await create(b.id, true); })), btn('Opslaan opnieuw proberen', safe(persist)))),
      help('Automatisch opgeslagen op dit apparaat en in deze browser. Een projectbackup bevat je bronbestanden, bootprofielen, beoordelingen, kalibratie en formules.'));
  }
  function setup() {
    const c = pane('setup'); if (!session) { c.append(card('Start een sessie', help('Kies eerst een boot.'), btn('Naar boten', () => show('home'), true))); return; }
    const file = h('input', { type: 'file', multiple: '', id: 'session-files', accept: '.csv,.xml,.txt,.log,.pol,.json', onchange: e => importFiles([...e.target.files]) });
    c.append(h('div', { class: 'wf-pagehead' }, h('div', {}, h('span', { class: 'eyebrow' }, session.profile.name + ' · PROFIEL V' + session.profile.revision), h('h1', {}, 'Nieuwe data, vaste basis.')), btn('Nieuwe sessie', safe(() => create(session.boatId)))),
      card('Sessiedetails', h('div', { class: 'form' }, field('Naam', h('input', { id: 'session-name', value: session.name, oninput: e => { session.name = e.target.value.trim() || 'Training'; touch(); } })), field('Kalibratie aan boord / context', h('input', { id: 'session-baseline', value: session.baseline, placeholder: 'Bijv. H5000, MHU +1,5° sinds 12 november', oninput: e => { session.baseline = e.target.value; touch(); } })),
        field('Instrumentinstelling tijdens de sessie gewijzigd', h('input', { type: 'checkbox', checked: session.calibrationChanged, onchange: e => { session.calibrationChanged = e.target.checked; touch(); } }))),
        help('Geloggede waarden kunnen al door de instrumenten zijn gekalibreerd. SailLens bewaart ze en past alleen jouw extra sessiecorrectie toe.')),
      card('Log & bestanden', h('div', { class: 'wf-drop' }, h('b', {}, 'Sleep je log, events en polar hierheen'), help('Meerdere bestanden mogen samen. De app herkent het type en controleert overlap.'), file),
        session.sources.length ? table(['Bestand', 'Type', 'Tijdsbereik in log', ''], session.sources.map(s => [s.name, { log: 'Log', ev: 'Events', polar: 'Polar', calib: 'Kalibratievoorstel', chart: 'Zeilkaart' }[s.kind] || s.kind, s.start ? dstr(s.start) + ' – ' + dstr(s.end) : '—', Math.round(s.size / 1024) + ' kB'])) : help(A.demo ? 'Synthetische voorbeeldtraining geladen.' : 'Voeg bestanden toe aan deze sessie.')));
    if (A.raw) {
      const clock = (k, label, step = .5) => field(label, h('input', { type: 'number', step, value: A.cfg[k] || 0, onchange: e => { const old = A.cfg[k]; A.cfg[k] = +e.target.value; if (!recompute()) A.cfg[k] = old; show('setup'); } }));
      c.append(card('Tijd & datakwaliteit', help(`Bronklok: ${A.raw.timeBasis === 'utc' ? 'UTC (tijdzone uit bestand verwerkt)' : 'lokale klok zonder tijdzone'}. Analyse op 1 seconde; de originele bestanden blijven in het project bewaard.`),
        h('div', { class: 'form' }, clock('logOff', 'Logklok UTC + (uur)'), clock('evOff', 'Eventklok UTC + (uur)'), clock('dispOff', 'Weergave t.o.v. logklok (uur)'), clock('evShiftSec', 'Events extra verschuiven (seconden)', 1), clock('magVar', 'Magnetische variatie °O')),
        help('De logoffset wordt alleen gebruikt voor tijdstempels zonder tijdzone. Wijzig de weergave om labels te verschuiven; dit verandert geen meettijd.'),
        h('details', {}, h('summary', {}, Object.keys(A.raw.ch).length + ' kanalen — bekijk dekking'), table(['Kanaal', 'Gemeten', 'Kort aangehouden', 'Ontbreekt'], Object.keys(A.raw.ch).map(k => { const q = A.raw.diagnostics?.channels[k]; return [k, q?.observed ?? A.raw.n, q?.held || 0, q?.missing || 0]; }))),
        A.D?.warn.length ? notice(A.D.warn.join(' ')) : help('Geen importwaarschuwingen.'), bar(btn('Events & zeilwissels', () => show('events')), btn('Kanaaltoewijzing', () => show('boat')))));
      c.append(selectionBar()); timePanel(c);
      c.append(bar(btn('Selectie als sessievenster', () => { if (!session.selections.analysis) return banner('Selecteer eerst een tijdvak.', true); const old = { ...A.cfg }; A.cfg.tStart = session.selections.analysis.start; A.cfg.tEnd = session.selections.analysis.end; if (!recompute()) A.cfg = old; show('setup'); }), btn('Volledig log verwerken', () => { A.cfg.tStart = A.cfg.tEnd = null; session.viewport = null; session.selections.analysis = null; recompute(); show('setup'); })));
      c.append(bar(btn('Verder: events & sessie indelen', () => show('events'), true)));
    }
  }
  function review() {
    const c = pane('review'); if (!A.D) return;
    reviewMode = 'Fases';
    const reviewVar = session.reviewVariable || 'VMG%', all = objects(), list = all.filter(x => x.kind === (reviewMode === 'Fases' ? 'phase' : 'manoeuvre'));
    const detail = !session.selections.analysis&&list.find(x => x.key === selectedKey);
    function focusPhase(x){
      selectedKey=x.key;A.cur=x.obj.i;session.selections.analysis=null;
      session.deskMap={...session.deskMap,z:1,x:0,y:0};session.reviewPage=Math.floor(list.indexOf(x)/40);
      session.viewport=[Math.max(A.D.i0,x.obj.i-90),Math.min(A.D.i1,x.obj.i1+120)];
    }
    const {side,toolbar}=PrepDesk.mount(c,'Fases · '+list.length,{phase:detail?.range,selectPhase:p=>{const x=list.find(x=>x.obj===p);if(x){focusPhase(x);show('review');}}});
    toolbar.append(btn('Manoeuvres →',()=>show('pairreview')));
    if (session.staleReviews) side.append(notice(`${session.staleReviews} eerdere beoordelingen hebben gewijzigde grenzen. Ze worden niet als kalibratiereferentie gebruikt; beoordeel de nieuwe fases opnieuw.`));
    const range = session.selections.analysis;
    if (detail || range) {
      const item = detail || { key: SL.reviewKey({ kind: 'interval', ...range }), range: { kind: 'interval', ...range }, label: 'Geselecteerd tijdvak' };
      const r = session.reviews[item.key] || {}, reason = h('input', { id: 'review-reason', value: r.reason || '', placeholder: 'Bijv. windshift, vuile sensor of slechte uitvoering' });
      side.append(card(item.label, help([dstr(item.range.start)+' – '+tstr(item.range.end),detail?.obj.raceLeg,detail?.obj.sails].filter(Boolean).join(' · ')), field('Reden / notitie', reason),
        bar(btn(r.calibration ? 'Kalibratie: goedgekeurd ✓' : 'Goedkeuren voor kalibratie', () => setReview(item, { calibration: !r.calibration, reason: reason.value }), !!r.calibration),
          detail&&list.indexOf(detail)<list.length-1?btn('Goedkeuren & volgende',()=>{focusPhase(list[list.indexOf(detail)+1]);setReview(item,{calibration:true,reason:reason.value});},true,{disabled:!!r.invalid}):null,
          btn('Buiten kalibratie houden', () => { if (!reason.value.trim()) return banner('Vul een reden in, zodat je deze keuze later kunt volgen.', true); setReview(item, { calibration: false, reason: reason.value }); }),
          btn(r.performance === false ? 'Weer in performance' : 'Buiten performance houden', () => { if (!reason.value.trim()) return banner('Vul een reden in.', true); setReview(item, { performance: r.performance === false, reason: reason.value }); }),
          btn(r.invalid ? 'Meting weer geldig' : 'Meting ongeldig', () => { if (!reason.value.trim()) return banner('Geef aan waarom de meting ongeldig is.', true); setReview(item, { invalid: !r.invalid, calibration: false, reason: reason.value }); })),
        help('“Meting ongeldig” sluit dit tijdvak uit voor alle berekeningen. Alleen een slechte manoeuvre? Houd die in performance en sluit hem uit voor kalibratie.')));
    }
    const visible = list;
    const page = Math.min(session.reviewPage || 0, Math.max(0, Math.ceil(visible.length / 40) - 1)), shown = visible.slice(page * 40, (page + 1) * 40);
    const approved = all.filter(x => SL.allowed(session.reviews[x.key], 'calibration')).length;
    side.append(card('Fasetabel', bar(h('span', { class: 'chip' }, approved + ' goedgekeurde referenties'), field('Extra variabele', sel('review-variable', varList(), reviewVar, v => { session.reviewVariable = v; show('review'); })), btn('Fases CSV', () => dl('SailLens-fases.csv', phasesCsv(filteredPhases(A.D.phases)))),
      btn('Getoonde selectie goedkeuren', () => { for (const x of shown) { const r = session.reviews[x.key]; if (!r?.invalid) session.reviews[x.key] = { ...x.range, ...r, calibration: true, performance: r?.performance !== false, reason: r?.reason || 'Handmatig goedgekeurd', updated: Date.now() }; } touch(); show('review'); })),
      table(['Fase · tijd', 'Boeg', 'BSP', reviewVar, 'Status', ''], shown.map(x => { const r = session.reviews[x.key]; return ['F'+(A.D.phases.indexOf(x.obj)+1)+' · '+tstr(x.range.anchor || x.range.start), x.obj.tack, f1(x.obj.v?.BSP, 2), f1(x.obj.v?.[reviewVar], 2), r?.invalid ? 'Ongeldig' : r?.calibration ? 'Goedgekeurd' : r?.reason ? 'Uitgesloten' : 'Te beoordelen', btn('Bekijk', () => { focusPhase(x);show('review'); })]; })),
      !visible.length ? help('Geen objecten in deze selectie. Bekijk de hele sessie of pas de detectie-instellingen aan.') : null,
      bar(btn('Vorige', () => { session.reviewPage = Math.max(0, page - 1); show('review'); }, false, { disabled: page === 0 }), h('span', {}, `${Math.min(page * 40 + 1, visible.length)}–${Math.min((page + 1) * 40, visible.length)} van ${visible.length}`), btn('Volgende', () => { session.reviewPage = page + 1; show('review'); }, false, { disabled: (page + 1) * 40 >= visible.length }))));
    const exclusions = Object.entries(session.reviews).filter(([k, r]) => r.invalid || r.performance === false || (!r.calibration && r.reason));
    if (exclusions.length) side.append(card('Bewaarde uitsluitingen', table(['Tijdvak', 'Reden', 'Gebruik', ''], exclusions.map(([key, r]) => [tstr(r.start) + '–' + tstr(r.end), r.reason, r.invalid ? 'Meting ongeldig' : r.performance === false ? 'Buiten performance' : 'Buiten kalibratie', btn('Uitsluiting herstellen', () => { delete session.reviews[key]; recompute(); show('review'); })]))));

  }
  function validateCalib(value) {
    const c = { ...SL.copy(SL.CAL0), ...value };
    for (const [k, lo, hi] of [['bspK', .2, 3], ['awsK', .2, 3], ['hdgOff', -180, 180], ['awaOff', -180, 180], ['heelOff', -90, 90], ['rudOff', -90, 90], ['leewayGain', 0, 5], ['twsDnPct', -90, 100]]) if (!fin(c[k]) || c[k] < lo || c[k] > hi) throw new Error('Ongeldige correctie: ' + k);
    if (!Array.isArray(c.twa) || c.twa.length > 100 || c.twa.some(r => !fin(r.tws) || r.tws <= 0 || !fin(r.up) || !fin(r.dn) || Math.abs(r.up) > 90 || Math.abs(r.dn) > 90) || new Set(c.twa.map(r => r.tws)).size !== c.twa.length) throw new Error('Ongeldige TWA-tabel: unieke positieve TWS en eindige correcties nodig.');
    SL.checkSpeedos(c.speedos,A.D.raw.ch);
    return c;
  }
  function windReview(c,refs,draft,step){
    const live=SL.windPairEvidence(refs.pairs),result=h('div',{'aria-live':'polite'}),message=h('p',{role:'status'});
    const panel=card('Windkalibratie uit vensterparen',help('Controleer eerst de MHU met aandewindse tacks. Controleer daarna de resterende TWD-sprong per windband, aandewinds en voor de wind. Een echte windshift, asymmetrische trim of kompasfout kan dezelfde sprong geven.'),result,message);
    c.append(panel);
    if(!refs.phases.length){
      result.append(help('Nog geen bruikbare goedgekeurde paren voor de schatting. Kies stabiele vensters vóór en na een tack of gijp. Controleparen tellen alleen mee voor de toets.'),btn('Manoeuvres beoordelen',()=>show('pairreview')));return;
    }
    function render(){
      const cfg=validateCalib(draft);
      const D=JSON.stringify(cfg)===JSON.stringify(A.calib)?A.D:process(snapshot(false),cfg);
      const pairs=refs.pairs.map(reference=>({pair:reference.pair,reference,before:SL.windowPhase(D,reference.pair.before),after:SL.windowPhase(D,reference.pair.after)}));
      const proposed=SL.windPairEvidence(pairs);
      const signature=JSON.stringify(draft);
      const med=values=>SL.median(values),degrees=v=>fin(v)?f1(v,1)+'°':'—';
      const summary=(values,factor=1)=>values?.length?degrees(factor*med(values)):'—';
      const update=fn=>()=>{if(JSON.stringify(draft)!==signature){message.textContent='Voorstel gewijzigd. Bereken de restfout opnieuw.';return;}
        try{const next=SL.copy(draft);fn(next);session.draft=validateCalib(next);session.preview=false;touch();show('cal');}catch(e){message.textContent=e.message;}};
      const alignment=med(proposed.alignment);
      result.replaceChildren();
      if(step===2)result.append(h('h4',{},'1 · AWA en MHU-uitlijning'),table(['Tackparen','Extra offset bij actieve waarden','Extra offset bij voorstel'],[[proposed.alignment.length,summary(live.alignment),degrees(alignment)]]),
        btn('MHU-restfout naar voorstel',update(next=>{next.awaOff=Math.round((next.awaOff+alignment)*10)/10;}),false,{disabled:proposed.alignment.length<3||!fin(alignment)||Math.abs(alignment)<.05}));
      if(step===3){
        result.append(
        h('h4',{},'2 · TWA-tabel uit de TWD-sprong'),help('Δ TWD en Δ TWS zijn bakboord min stuurboord. De tabelcorrectie is de helft van de resterende TWD-sprong. Beide kolommen gebruiken de windband van het actieve log.'));
        if(proposed.bands.length){
          result.append(table(['TWS · koers','Paren','Δ TWD actief','Δ TWD voorstel','TWD P25–P75','Δ TWS voorstel','Extra TWA',''],proposed.bands.map(g=>{
            const old=live.bands.find(b=>b.band===g.band&&b.mode===g.mode);
            const residual=med(g.errors)/2,tws=BAND_TWS[g.band];
            return [SL.BANDS[g.band][2]+' kn · '+(g.mode==='up'?'aandewinds':'voor de wind'),g.errors.length,summary(old?.errors),summary(g.errors),degrees(SL.quant(g.errors,.25))+' / '+degrees(SL.quant(g.errors,.75)),f1(med(g.speeds),2)+' kn',degrees(residual),
              btn('Naar tabel bij '+tws+' kn',update(next=>{
                const rows=next.twa.length?next.twa:BAND_TWS.map(t=>({tws:t,up:0,dn:0}));
                next.twa=SL.addTableResidual(rows,tws,g.mode,residual);
              }),false,{disabled:g.errors.length<3||Math.abs(residual)<.05})];
          })));
        }else result.append(help('Geen paren met voldoende TWD- en TWS-metingen in deze windbanden.'));
      }
      if(step===4){
        const extremes=refs.phases.map(w=>D===A.D?w:SL.windowPhase(D,{start:w.t,end:iT(w.i1)})).filter(w=>w&&(w.mode==='Upwind'&&Math.abs(w.v.TWA)<=60||w.mode==='Downwind'&&Math.abs(w.v.TWA)>=120));
        const tws=SL.calWind(extremes).twsDn,qualified=tws&&fin(tws.pct)&&tws.pct>-100&&Math.abs(tws.pct)>Math.max(3,2*tws.se);
        result.append(h('h4',{},'3 · TWS aandewinds en voor de wind'));
        if(tws){
          const adjusted=Math.round(1000*((1+(cfg.twsDnPct||0)/100)/(1+tws.pct/100)-1))/10;
          result.append(help('Geschat verschil voor de wind t.o.v. aandewinds bij het voorstel: '+f1(tws.pct,1)+'% (standaardfout '+f1(tws.se,1)+'%). Vergelijk rakken in dezelfde omstandigheden.'),
            btn('TWS downwind naar voorstel',update(next=>{next.twsDnPct=adjusted;}),false,{disabled:!qualified}));
        }else result.append(help('Voor de TWS-vergelijking zijn goedgekeurde aandewindse én voor-de-windse vensters nodig, met dekking op beide boegen. De absolute AWS-schaal vraagt een onafhankelijke referentie.'));
      }
      if(pairs.length && step!==4){
        const rows=pairs.filter(r=>r.before&&r.after).map(({pair,before,after})=>{
          const [p,s]=before.tack==='Port'?[before.v,after.v]:[after.v,before.v];
          return [tstr(pair.anchor),pair.type,degrees(p.AWA)+' / '+degrees(s.AWA),degrees(p.TWD)+' / '+degrees(s.TWD),degrees(SL.w180(p.TWD-s.TWD)),btn('Bekijk paar',()=>{
            session.activePairKey=pair.key;session.pairType='Alle';const i=Math.round((pair.anchor-A.raw.t0)/1000);
            if(!A.D.L.race[i])session.pairRaceOnly=false;
            A.cur=i;session.viewport=[Math.max(A.D.i0,i-150),Math.min(A.D.i1,i+150)];session.selections.analysis=null;show('pairreview');
          })];
        });
        result.append(h('details',{},h('summary',{},'Meetwaarden per goedgekeurd paar'),table(['Tijd','Type','AWA BB / SB','TWD BB / SB','Δ TWD',''],rows)));
      }
      result.append(help('De hoekcorrecties zijn medianen. Overnemen kan vanaf drie bruikbare paren per hoekschatting. Na een wijziging rekent SailLens de restfout op het voorstel opnieuw uit. Met Voorstel toepassen maak je de correcties actief.'));
    }
    const recalc=()=>{try{render();message.textContent='';}catch(e){result.replaceChildren();message.textContent=e.message;}};
    panel.insertBefore(btn('Bereken restfout opnieuw',recalc),result);recalc();
    c.addEventListener('input',e=>{if(e.target.id.startsWith('draft-')||e.target.matches('[aria-label^="TWA "]'))message.textContent='Voorstel gewijzigd. Bereken de restfout opnieuw.';},{signal:windListeners.signal});
  }
  let windListeners;
  function speedoEditor(draft, phases, bspModel) {
    const ch=A.D.raw.ch, settings=SL.speedoConfig(ch,draft.speedos || session.profile.speedoLayout);
    const report=h('div',{'aria-live':'polite'}), controls=h('div', {class:'form'});
    const box=card('BSP per fysieke sensor',controls,report);
    const config=h('div',{class:'form'});
    function changed(key,value) {
      settings[key]=value;
      draft.speedos={...settings};
      session.preview=false;touch();refresh();
    }
    const mode=h('input',{type:'checkbox',checked:settings.enabled,onchange:e=>changed('enabled',e.target.checked)});
    controls.append(field('Gebruik twee BSP-sensoren',mode));
    function choose(key,label) {
      const select=h('select',{'aria-label':label,onchange:e=>changed(key,e.target.value)},
        h('option',{value:''},'Kies kanaal'),Object.keys(ch).sort().map(k=>h('option',{value:k,selected:k===settings[key]},k)));
      return field(label,select);
    }
    function number(key,label,step) {
      return field(label,h('input',{type:'number',id:'draft-'+key,step,value:settings[key],
        oninput:e=>changed(key,e.target.value===''?null:e.target.valueAsNumber)}));
    }
    config.append(choose('selector','Actieve sensor behouden uit'),choose('port','Bakboordsensor (kn)'),number('portCode','Code BB',1),number('portK','Factor BB',.001),
      choose('starboard','Stuurboordsensor (kn)'),number('starboardCode','Code SB',1),number('starboardK','Factor SB',.001));
    box.insertBefore(config,report);
    const ranges=phases.length?phases.map(p=>[p.i,p.i1]):[[A.D.i0,A.D.i1]];
    const seconds=new Uint8Array(A.D.n);
    for(const [lo,hi] of ranges) seconds.fill(1,lo,hi);
    const measured=(key,i)=>A.D.invalid?.[i] || (A.D.raw.age?.[key]?.[i]??0)>A.D.cfg.maxHold ? NaN : ch[key]?.[i];
    function refresh(){
      config.hidden=!settings.enabled;
      if(!settings.enabled){
        report.replaceChildren(help(settings.port&&settings.starboard?'Twee sensorkanalen gevonden: '+settings.port+' en '+settings.starboard+'. Het actieve voorstel gebruikt de gelogde BSP.':'Het voorstel gebruikt de gelogde BSP en de globale factor.'));return;
      }
      try{SL.checkSpeedos(settings,ch);}catch(e){report.replaceChildren(notice(e.message));return;}
      const rows=[],fitRows=[],matched=new Uint8Array(A.D.n);
      for(const [side,label] of [['port','Bakboord'],['starboard','Stuurboord']]){
        const source=settings[side],code=settings[side+'Code'],samples=[],proposed=[],delta=[];
        for(let i=A.D.i0;i<A.D.i1;i++){
          if(!seconds[i]||measured(settings.selector,i)!==code)continue;
          const v=measured(source,i);if(!fin(v)||v<0)continue;
          matched[i]=1;samples.push(v);
          const corrected=v*settings[side+'K']*draft.bspK;proposed.push(corrected);
          const original=measured('BSP',i);if(fin(original))delta.push(corrected-original);
        }
        const residuals=[];
        for(const {p,r} of bspModel.ratio||[]){
          let sum=0,count=0;
          for(let i=p.i;i<p.i1;i++){
            const v=measured(source,i);
            if(measured(settings.selector,i)===code&&fin(v)&&v>0){sum+=v;count++;}
          }
          // Exclude windows spanning a source change or a sensor outage.
          if(count===p.i1-p.i && count){
            const reference=r*p.v.BSP;
            residuals.push(reference-sum/count*settings[side+'K']*draft.bspK);
          }
        }
        fitRows.push([label,residuals.length,f1(SL.median(residuals),2)]);
        rows.push([label,source,samples.length,f1(SL.median(samples),2),f1(SL.median(proposed),2),f1(SL.median(delta),2)]);
      }
      let other=0,missing=0;
      for(let i=A.D.i0;i<A.D.i1;i++)if(seconds[i]&&!matched[i]){if(fin(measured('BSP',i)))other++;else missing++;}
      report.replaceChildren(help(phases.length?'Goedgekeurde referenties, gegroepeerd op de actieve sensor.':'Hele sessie, inclusief stilliggen. Keur fases goed om de vergelijking tot referenties te beperken.'),
        table(['Sensor','Logkanaal','Actief (s)','Ruw (kn)','Voorstel (kn)','Verschil met log (kn)'],rows),
        table(['Sensor','Referenties met stroomschatting','Restfout (kn)'],fitRows),
        help('Restfout = snelheid uit GPS en het actieve stroommodel minus het voorstel. Een positieve waarde betekent dat de sensor te laag leest. Elk venster telt één keer en moet volledig door dezelfde sensor zijn gedekt.'),
        help('Medianen per sensor. Bij onbekende selectie of ontbrekende sensordata gebruikt het voorstel de gelogde BSP ('+other+' s). Geen bruikbare BSP: '+missing+' s.'));
    }
    box.addEventListener('bsp-factor',refresh);
    config.append(btn('Kanaalkeuze bij boot bewaren',safe(async()=>{
      SL.checkSpeedos({...settings,enabled:true},ch);
      const {port,starboard,selector,portCode,starboardCode}=settings;
      const layout={port,starboard,selector,portCode,starboardCode};
      boat().speedoLayout=layout;session.profile.speedoLayout={...layout};touch();await persist();banner('Sensorkanalen en codes opgeslagen bij de boot.');
    })));
    refresh();return box;
  }
  function residualPanel(c,kind,phases,bspModel,draft,getProposal){
    const options=session.diagnosticCurrent ||= {mode:'model',set:null,drift:null};
    const views=session.diagnosticViews ||= {};
    const view=views[kind] ||= {};
    const source=h('select',{id:'cal-current-source'},[
      ['model','Geschat per kwartier'],['logged','Gelogde Set / Drift'],['manual','Handmatige set en drift']
    ].map(([value,label])=>h('option',{value,selected:value===options.mode},label)));
    const manual=h('div',{class:'form'});
    function number(key,label,max){
      const input=h('input',{type:'number',id:'cal-current-'+key,step:'any',min:0,max,value:options[key]??''});
      input.oninput=()=>{options[key]=fin(input.valueAsNumber)?input.valueAsNumber:null;touch();render();};
      return field(label,input);
    }
    manual.append(number('set','Stroom naar (° waar)',360),number('drift','Stroomsnelheid (kn)'));
    const output=h('div'),status=h('span',{role:'status'}),controls=bar(field('Stroombron',source));
    const panel=card('Stroomcorrectie',controls,manual,output);
    c.append(panel);
    let data=A.D,windows=phases,displayedCal=A.calib,signature=null;
    const drawProposal=btn('Teken voorstel',safe(()=>{
      const next=getProposal();
      const fixed=phases.map(p=>{
        const w=SL.windowPhase(next,{start:iT(p.i),end:iT(p.i1)});
        return w && {...p,v:w.v,coverage:w.coverage};
      }).filter(Boolean);
      data=next;windows=fixed;displayedCal=SL.copy(draft);signature=JSON.stringify(draft);render();
    }),false,{disabled:!phases.length});
    const drawActive=btn('Toon actieve kalibratie',()=>{
      data=A.D;windows=phases;displayedCal=A.calib;signature=null;render();
    });
    controls.append(drawProposal,drawActive,status);
    function sensorAt(row,layout){
      const {ch,age}=data.raw;
      if(!ch[layout.selector]||!ch[layout.port]||!ch[layout.starboard])return null;
      const first=ch[layout.selector][row.i];
      const side=first===layout.portCode?'port':first===layout.starboardCode?'starboard':null;
      if(side)for(let i=row.i;i<row.i1;i++){
        const sensor=layout[side];
        if(ch[layout.selector][i]!==first||!fin(ch[sensor][i])||ch[sensor][i]<0||data.invalid?.[i]||
            age?.[layout.selector]?.[i]>data.cfg.maxHold||age?.[sensor]?.[i]>data.cfg.maxHold)return 'Onbekend / wissel';
      }
      return side==='port'?'Bakboord':side==='starboard'?'Stuurboord':'Onbekend / wissel';
    }
    function updateStatus(){
      drawActive.hidden=signature===null;
      status.textContent=signature===null?'Grafiek met actieve kalibratie':signature===JSON.stringify(draft)?'Grafiek met voorstel':'Voorstel gewijzigd. Kies Teken voorstel om de grafiek bij te werken.';
    }
    function render(){
      manual.hidden=options.mode!=='manual';
      const diagnostic=SL.calibrationResiduals(data,windows,bspModel,kind,options);
      if(kind==='speed'){
        const layout=SL.speedoConfig(data.raw.ch,displayedCal?.speedos||session.profile.speedoLayout);
        for(const row of diagnostic.rows)row.sensor=sensorAt(row,layout);
      }
      output.replaceChildren();
      CalibrationPlots.render(output,diagnostic,view);
      updateStatus();
    }
    source.onchange=()=>{options.mode=source.value;touch();render();};
    for(const event of ['input','change'])c.addEventListener(event,updateStatus,{signal:windListeners.signal});
    if(session.preview&&phases.length)drawProposal.click();else render();
  }
  function calibration() {
    const c = pane('cal'); if (!session || !A.D) return;
    windListeners?.abort();windListeners=new AbortController();
    const refs=SL.calibrationReferences(A.D,session), ps = refs.phases, draft = session.draft ||= SL.copy(A.calib || SL.CAL0);
    const approvedMans = A.D.mans.filter(m => SL.allowed(SL.reviewed(A.D, m, 'manoeuvre', session.reviews), 'calibration'));
    const pairAllowed = (a, b) => approvedMans.some(m => iT(m.i) > a.t && iT(m.i) < b.t);
    const model = { bsp: SL.calBsp(A.D, ps), wind: SL.calWind(ps), awa: SL.calAwa(ps), cur: SL.calCurrent(ps, A.D.magVar, pairAllowed, refs.pairs) }; model.score = SL.calScore(model.bsp, model.wind, model.awa);
    c.append(h('div', { class: 'wf-pagehead' }, h('div', {}, h('h1', {}, 'Controleer. Vergelijk. Pas toe.'), help(`${ps.length} goedgekeurde fases · ${refs.pairs.length} goedgekeurde vensterparen. Alle correcties zijn ten opzichte van het oorspronkelijke log.`)), btn('Sessie opslaan & analyseren', safe(()=>STUDIO.publish()), true)));
    if (!ps.length) c.append(notice('Keur eerst stabiele fases goed bij Beoordelen. Je kunt al een handmatig voorstel bekijken; de modellen wachten op referenties.'), btn('Referenties beoordelen', () => show('review')));
    if (session.calibrationChanged) c.append(notice('De instrumentkalibratie is tijdens deze sessie gewijzigd. Eén correctie voor de hele sessie is dan niet betrouwbaar. Maak aparte sessies met een constant instrumentprofiel; toepassen is hier geblokkeerd.'));
    const steps=['BSP-sensoren','Kompas & leeway','AWA / MHU','TWA / TWD','TWS','Afronden'];
    const index=Math.max(0,steps.indexOf(session.calibrationStep));
    function go(i){session.calibrationStep=steps[i];show('cal');}
    c.append(h('nav',{'aria-label':'Kalibratieonderdelen',class:'bar'},steps.map((name,i)=>btn(name,()=>go(i),i===index,{'aria-current':i===index?'step':null}))));
    const form=h('div',{class:'form'}), editor=card(steps[index],form);
    c.append(editor);
    const fields=[
      [['bspK','Globale BSP-factor ×',.001]],
      [['hdgOff','Heading-offset °',.1],['leewayGain','Leeway-factor ×',.05],['heelOff','Helling-offset °',.1],['rudOff','Roer-offset °',.1]],
      [['awaOff','AWA / MHU-offset °',.1]],[],[['awsK','AWS-factor ×',.001],['twsDnPct','TWS downwind %',.1]],[]];
    for(const [k,label,step] of fields[index]) form.append(field(label,h('input',{id:'draft-'+k,type:'number',step,value:draft[k],oninput:e=>{
      draft[k]=e.target.value===''?null:e.target.valueAsNumber;session.preview=false;touch();speedBox?.dispatchEvent(new Event('bsp-factor'));
    }})));
    const speedBox=index===0?speedoEditor(draft,ps,model.bsp):null;if(speedBox)c.append(speedBox);
    let cachedProposal,cachedKey;
    function getProposal(){
      const cfg=validateCalib(draft),key=JSON.stringify(cfg);
      if(key!==cachedKey){
        cachedProposal=key===JSON.stringify(A.calib)?A.D:process(snapshot(false),cfg);
        cachedKey=key;
      }
      return cachedProposal;
    }
    if(index<2)residualPanel(c,index===0?'speed':'heading',ps,model.bsp,draft,getProposal);
    if(index===1)editor.append(help('Heading en leeway veranderen samen de geschatte stroom. Controleer de fit op goedgekeurde rakken over beide boegen.'),
      table(['Referentie','Uitkomst'],[['Goedgekeurde fases',ps.length],['Heading-offset uit BSP/stroom-fit',model.bsp.err?'Onvoldoende dekking':f1(model.bsp.delta,1)+'°']]));
    if(index===2)editor.append(help('Een positieve offset wordt opgeteld bij de gesigneerde AWA. Gebruik stabiele vensters rond aandewindse tacks.'));
    if(index===4)editor.append(help('Controleer de AWS-schaal met een onafhankelijke referentie en vergelijk TWS aandewinds en voor de wind.'));
    if(index===3){
      const cell=(r,key)=>h('input',{type:'number',step:.1,value:r[key],'aria-label':'TWA '+key+' bij '+r.tws,oninput:e=>{r[key]=e.target.value===''?null:e.target.valueAsNumber;session.preview=false;touch();}});
      editor.append(help('Correcties in graden op de absolute TWA, geïnterpoleerd over TWS. TWD volgt de hoekcorrectie.'),
        table(['TWS kn','Upwind °','Downwind °',''],draft.twa.map((r,i)=>[cell(r,'tws'),cell(r,'up'),cell(r,'dn'),btn('Verwijder',()=>{draft.twa.splice(i,1);session.preview=false;show('cal');})])),
        btn('TWA-rij toevoegen',()=>{draft.twa.push({tws:(draft.twa.at(-1)?.tws||4)+2,up:0,dn:0});session.preview=false;show('cal');}));
    }
    if(index>=2&&index<=4)windReview(c,refs,draft,index);
    if(index===5)editor.append(table(['Instelling','Actief','Voorstel'],fields.flat().map(([k,label])=>[label,A.calib[k],draft[k]])),
      help('Vergelijk de instellingen op dezelfde tijdvakken. Pas het voorstel toe om de sessie met deze correcties te analyseren.'));
    if(index===5 && (A.calib.speedos?.enabled || draft.speedos?.enabled)){
      const status=(cfg,side)=>cfg.speedos?.enabled?cfg.speedos[side]+' × '+cfg.speedos[side+'K']:'Gelogde BSP';
      editor.append(table(['Sensor','Actief','Voorstel'],[['port','Bakboord'],['starboard','Stuurboord']].map(([side,label])=>[label,status(A.calib,side),status(draft,side)])));
    }
    c.append(bar(index>0?btn('Vorige',()=>go(index-1)):null,index<5?btn('Volgende',()=>go(index+1),true):null,
        btn('Modelsuggesties naar voorstel', () => {
          const proposed=SL.copy(draft);
          if(!proposed.twa?.length)proposed.twa=BAND_TWS.map(tws=>({tws,up:0,dn:0}));
          const found=calibSuggest(model,proposed);
          if(found.length){session.draft=proposed;session.preview=false;touch();show('cal');}
          banner(found.length?found.join(' · '):'Geen voldoende onderbouwde correctie gevonden.');
        }),
        btn('Voorstel vergelijken', safe(() => { validateCalib(draft); session.preview = true; show('cal'); }), true),
        btn('Voorstel toepassen', safe(() => applyCalibration(draft)), false, { disabled: session.calibrationChanged }),
        btn('Voorstel wissen', () => { session.draft = SL.copy(SL.CAL0); session.preview = false; show('cal'); })));
    if (session.preview) {
      try { const s = snapshot(false), original = process(s, null), proposed = getProposal();
        const references = ps.length ? ps.map(p => [p.i, p.i1]) : [[A.D.i0, A.D.i1]];
        const avg = (D, k) => { const values = []; for (const [lo, hi] of references) for (let i = lo; i < hi; i++) values.push(D.ch[k]?.[i]); return (SL.ANG.test(k) ? SL.cmean : SL.mean)(values); };
        c.append(card('Gelogd · actief · voorstel', help(ps.length ? 'Exact dezelfde goedgekeurde tijdvakken voor alle drie de berekeningen.' : 'Geen goedgekeurde referenties: dit zijn alleen beschrijvende sessiegemiddelden.'), table(['Variabele', 'Gelogd', 'Actief', 'Voorstel'], ['BSP', 'AWA', 'TWA', 'TWS', 'TWD', 'VMG', ...s.profile.formulas.map(d => d.name)].map(k => [k, f1(avg(original, k), 2), f1(avg(A.D, k), 2), f1(avg(proposed, k), 2)]))));
        const cv = h('canvas'); c.append(card('Dezelfde referenties, dezelfde schaal · BSP', cv));
        const vals = references.map(([a, b]) => [a, SL.mean(original.ch.BSP.subarray(a, b)), SL.mean(A.D.ch.BSP.subarray(a, b)), SL.mean(proposed.ch.BSP.subarray(a, b))]);
        const vv = vals.flatMap(x => x.slice(1)).filter(fin), lo = SL.quant(vv, 0), hi = SL.quant(vv, 1); const p = plot(cv, { xr: [0, Math.max(1, vals.length - 1)], yr: fin(lo) ? [lo - .2, hi + .2] : [0, 1], h: 230, yl: 'BSP kn', xl: 'Vaste referenties' });
        [1, 2, 3].forEach((j, i) => p.line(vals.map((v, k) => [k, v[j]]), [css('--muted'), css('--s1'), css('--s2')][i])); c.append(legend([[css('--muted'), 'Gelogd'], [css('--s1'), 'Actief'], [css('--s2'), 'Voorstel']]));
      } catch (e) { c.append(notice(e.message)); }
    }
    if(index===0||index===3)RaceTools.calibration(c,model,session,index===0?'speed':'wind');
    if(index!==5)return;
    const modelBox=h('details',{},h('summary',{},'Modeluitkomsten'));c.append(modelBox);blkCalModel(modelBox,model,{logMagVar:A.D.logMagVar,mv:A.D.magVar});
    const historyRows = session.calibrationHistory.map((v, i) => [
      'v' + (i + 1), new Date(v.at).toLocaleString('nl-NL'), v.note,
      btn('Terugzetten', safe(() => applyCalibration(v.value, 'Terug naar v' + (i + 1))), false, { disabled: session.calibrationChanged })
    ]);
    const history = card('Kalibratiegeschiedenis', help('Terugzetten maakt een nieuwe versie. De originele data blijft altijd beschikbaar.'), table(['Versie', 'Moment', 'Notitie', ''], historyRows));
    history.append(bar(
      btn('Terug naar gelogd', safe(() => applyCalibration(SL.CAL0, 'Terug naar gelogde waarden')), false, { disabled: session.calibrationChanged }),
      btn('Bewaar in bootgeschiedenis', safe(async () => {
        const b = boat(); b.calibrationHistory.push({ at: Date.now(), sessionId: session.id, baseline: session.baseline, value: SL.copy(A.calib) });
        touch(); await persist(); banner('Opgeslagen bij de boot. Nieuwe logs starten met nul extra correctie om dubbele kalibratie te voorkomen.');
      })),
      btn('Kalibratie exporteren', () => dl('SailLens.calibration.json', JSON.stringify({ app: 'SailLens', type: 'calibration', ...A.calib }, null, 2)))
    ));
    c.append(history);
  }
  function applyCalibration(value, note = 'Handmatig toegepast') {
    if (session.calibrationChanged) throw new Error('Splits eerst de sessie op instrumentinstelling.');
    const cal = validateCalib(value), s = snapshot(), D = process(s, cal);
    session.calibrationHistory.push({ at: Date.now(), value: SL.copy(cal), previous: SL.copy(A.calib), note, manoeuvrePairs:SL.copy(session.manoeuvrePairs||{}), references: Object.values(session.reviews).filter(r => r.calibration).map(r => SL.copy(r)), profileRevision: session.profile.revision });
    A.calib = cal; session.calib = cal; session.draft = SL.copy(cal); A.D = D; session.preview = false; recompute(); show('cal');
  }
  function analyse() {
    const c = pane('analysis'); if (!A.D) return;
    const threshold = session.slowThreshold || 95, stats = SL.slowStats(A.D, session.reviews, session.selections.analysis, threshold, session.analysisFilter);
    c.append(h('div', { class: 'wf-pagehead' }, h('div', {}, h('h1', {}, 'Wat gebeurde er op het water?'), help('Bekijk snelheid, manoeuvres en omstandigheden op dezelfde tijdlijn.')), btn('Maak debrief', () => show('report'), true)), selectionBar(),
      h('div', { class: 'kpis' }, kpi('Geldige vaartijd', dur(stats.valid)), kpi('Onder ' + threshold + '% polar', dur(stats.slow), '', f1(stats.percent) + '% van tijd met target'), kpi('Tijdens manoeuvre / herstel', dur(stats.manoeuvre)), kpi('Rechtuit langzaam', dur(stats.straight)), kpi('Zonder target', dur(stats.unknown), '', 'targetdekking ' + f1(stats.coverage) + '%')),
      card('Hoe vaak voeren we langzaam?', bar(field('Drempel polar %', h('input', { type: 'number', min: 1, max: 150, value: threshold, onchange: e => { session.slowThreshold = Math.max(1, Math.min(150, +e.target.value || 95)); show('analysis'); } }))),
        help('Noemer: alle geldige vaartijd binnen de selectie mét onafhankelijke polar of gelogde target. Niet beperkt tot stabiele fases. Ontbrekende targets staan apart; een zelfgeleerde polar telt niet als onafhankelijke referentie.'),
        table(['Langzaam tijdvak', 'Duur', ''], stats.slowRanges.filter(x => x.seconds >= 10).sort((a, b) => b.seconds - a.seconds).slice(0, 12).map(r => [tstr(r.start) + ' – ' + tstr(r.end), dur(r.seconds), btn('Onderzoek', () => RaceTools.compareSlow(r))])),
        h('details', {}, h('summary', {}, 'Herkomst en berekening'), help(`BSP / Polar_BSP × 100. Manoeuvrevenster: ${A.cfg.manBefore}s ervoor t/m ${A.cfg.manAfter}s erna. Vaartijd: race actief, of TWS ≥ 2 kn, |TWA| ≥ 25° en BSP ≥ 0,2 kn. ${stats.invalid}s ongeldige metingen en ${stats.excluded}s expliciet buiten performance gehouden. Polarbron: ${A.D.polarSrc}. Bootprofiel v${session.profile.revision}; kalibratie v${session.calibrationHistory.length}. VMG in de bestaande analyse is de absolute component BSP × cos(TWA).`))));
    timePanel(c); comparison(c); notes(c);
  }
  function comparison(c) {
    if (!session) return;
    const ranges = ['A', 'B'].map(k => session.selections[k]);
    const avg = (r, key) => { if (!r) return NaN; const [lo, hi] = rangeIndices(r), values = []; for (let i = lo; i < hi; i++) if (SL.sampleMatches(A.D,i,session.analysisFilter||{}) && SL.performanceAllowed({ start: iT(i), end: iT(i + 1) }, session.reviews)) values.push(A.D.ch[key]?.[i]); return (SL.ANG.test(key) ? SL.cmean : SL.mean)(values); };
    const comparisonCard=card('Vergelijk A / B', help('Bewaar twee tijdvakken met de knoppen boven de tijdlijn. Verschillen zijn aanwijzingen; controleer wind, boeg, zeilen en vaarmodus voordat je een oorzaak toeschrijft.'),
      table(['Variabele', ranges[0] ? 'A · ' + tstr(ranges[0].start) : 'A niet gekozen', ranges[1] ? 'B · ' + tstr(ranges[1].start) : 'B niet gekozen'], ['BSP', 'TWS', 'absTWA', 'VMG', 'VMG%', 'Heel', 'Rudder', ...session.profile.formulas.map(x => x.name)].filter(k => A.D.ch[k]).map(k => [k, f1(avg(ranges[0], k), 2), f1(avg(ranges[1], k), 2)])),
      bar(['A', 'B'].map((k, i) => btn('Bekijk ' + k, () => { session.viewport=rangeIndices(ranges[i]);A.cur=session.viewport[0];show('analysis');document.querySelector('#t-analysis .wf-map')?.scrollIntoView?.({block:'center'}); }, false, { disabled: !ranges[i] }))),
      ranges.every(Boolean) && (Math.abs(avg(ranges[0], 'TWS') - avg(ranges[1], 'TWS')) > 2 || Math.abs(avg(ranges[0], 'absTWA') - avg(ranges[1], 'absTWA')) > 10) ? notice('A en B hebben verschillende windcondities of vaarhoeken. Vergelijk de ruwe verschillen niet als een zuiver trimeffect.') : null);comparisonCard.classList.add('compare-reference');c.append(comparisonCard);
  }
  function notes(c) {
    const text = h('textarea', { rows: 3, class: 'note', id: 'debrief-note', placeholder: 'Wat viel op? Wat wil je de volgende sessie testen?' });
    c.append(card('Notities voor de debrief', text, btn('Notitie bewaren bij selectie', () => { if (!text.value.trim()) return; session.notes.push({ id: SL.uid(), text: text.value.trim(), range: SL.copy(session.selections.analysis), at: Date.now(), calibrationVersion: session.calibrationHistory.length, profileRevision: session.profile.revision }); touch(); show(A.tab); }), session.notes.map(n => h('article', { class: 'wf-note' }, h('b', {}, n.range ? tstr(n.range.start) + ' – ' + tstr(n.range.end) : 'Hele sessie'), h('p', {}, n.text), help('Profiel v' + n.profileRevision + ' · kalibratie v' + n.calibrationVersion)))));
  }
  function boatSettings() {
    const c = pane('boat'), b = library.boats.find(x => x.id === WF.editBoatId) || boat(); if (!b) { c.append(card('Bootprofiel', btn('Boot toevoegen', () => show('home'), true))); return; }
    WF.editBoatId = b.id;
    const changed = () => { b.revision++; b.updated = Date.now(); touch(); };
    c.append(h('h1', {}, b.name), bar(field('Boot', sel('boat-picker', library.boats.map(x => x.name), b.name, name => { WF.editBoatId = library.boats.find(x => x.name === name).id; show('boat'); }))),
      card('Vaste instellingen', h('div', { class: 'form' }, field('Bootnaam', h('input', { value: b.name, oninput: e => { if (e.target.value.trim()) { b.name = e.target.value.trim(); changed(); } } })), field('Instrumenten / uitgangskalibratie', h('input', { value: b.baseline, oninput: e => { b.baseline = e.target.value; changed(); } }))),
        help(`Profiel v${b.revision}. Nieuwe sessies nemen deze instellingen over. Bestaande sessies behouden hun eigen versie.`),
        session?.boatId === b.id ? bar(btn('Profiel toepassen op deze sessie', safe(() => { const old = session.profile, oldCfg = A.cfg; session.profile = SL.copy(b); A.cfg = { ...A.cfg, boat: b.name }; if (!recompute()) { session.profile = old; A.cfg = oldCfg; return; } touch(); show('boat'); banner('Bootprofiel overgenomen; variabelen opnieuw berekend.'); }), true), btn('Huidige detectie als bootstandaard', () => { b.cfg = { ...SL.copy(A.cfg), tStart: null, tEnd: null }; b.chart = SL.copy(A.chart); changed(); show('boat'); })) : null));
    const mappings = b.channels || (b.channels = []);
    c.append(card('Kanalen & eenheden', help('Selecteer de bron en de canonieke naam. Standaard: knopen en graden; stuurboord positieve AWA/TWA. Gebruik factor −1 voor een omgekeerd teken, 1,943844 voor m/s → kn of 57,29578 voor rad → deg.'),
      table(['Bronkanaal', 'Gebruik als', 'Factor', 'Offset', ''], mappings.map((m, i) => [h('input', { value: m.source, 'aria-label': 'Bronkanaal', oninput: e => { m.source = e.target.value; changed(); } }), h('input', { value: m.target, 'aria-label': 'Doelkanaal', oninput: e => { m.target = e.target.value; changed(); } }), h('input', { type: 'number', step: 'any', value: m.factor, 'aria-label': 'Kanaalfactor', oninput: e => { m.factor = +e.target.value; changed(); } }), h('input', { type: 'number', step: 'any', value: m.offset, 'aria-label': 'Kanaaloffset', oninput: e => { m.offset = +e.target.value; changed(); } }), btn('Verwijder', () => { mappings.splice(i, 1); changed(); show('boat'); })])),
      btn('Kanaaltoewijzing toevoegen', () => { mappings.push({ source: 'BSP', target: 'BSP', factor: 1, offset: 0 }); changed(); show('boat'); }),
      help(A.raw ? 'Beschikbare bronkanalen: ' + Object.keys(A.raw.ch).join(', ') : 'Open een sessie om de beschikbare bronkanalen te zien.')));
    const edit = WF.formulaEdit || { name: '', expression: '', unit: '', type: 'number', description: '' };
    const input = (key, id, placeholder) => h('input', { id, value: edit[key], placeholder, oninput: e => { edit[key] = e.target.value; WF.formulaEdit = edit; } });
    const preview = h('div', { id: 'formula-preview', role: 'status' });
    const candidate = () => { const defs = SL.copy(b.formulas); const idx = defs.findIndex(x => x.name === (edit.originalName || edit.name)); const d = { name: edit.name.trim(), expression: edit.expression, unit: edit.unit.trim(), type: edit.type, description: edit.description, version: idx >= 0 ? (defs[idx].version || 1) + 1 : 1 }; if (idx >= 0) defs[idx] = d; else defs.push(d); const reserved = A.D ? Object.keys(A.D.ch).filter(k => !(session?.profile.formulas || []).some(d => d.name === k)) : ['BSP', 'TWA', 'TWS', 'TWD', 'AWA', 'AWS', 'SOG', 'HDG', 'VMG']; SL.compileFormulas(defs, reserved); return defs; };
    c.append(card('Variabelen & formules', help('Formules horen bij deze boot. Ze gebruiken de actieve gekalibreerde kanalen. raw.BSP gebruikt het oorspronkelijke logkanaal; [VMG%] verwijst naar een naam met speciale tekens.'),
      table(['Naam', 'Formule', 'Eenheid', 'Versie', ''], b.formulas.map(d => [d.name, d.expression, d.unit, d.version, bar(btn('Bewerk', () => { WF.formulaEdit = { ...d, originalName: d.name }; show('boat'); }), btn('Verwijder', safe(() => { const next = b.formulas.filter(x => x.name !== d.name); if (next.some(x => SL.expression(x.expression).refs.includes(d.name))) throw new Error('Een andere formule gebruikt deze variabele. Pas die eerst aan.'); b.formulas = next; changed(); show('boat'); })))])),
      h('div', { class: 'form' }, field('Naam', input('name', 'formula-name', 'VMG_signed')), field('Formule', input('expression', 'formula-expression', 'BSP * cosD(TWA)')), field('Eenheid', input('unit', 'formula-unit', 'kn')), field('Type', sel('formula-type', ['number', 'angle', 'boolean'], edit.type, v => { edit.type = v; WF.formulaEdit = edit; })), field('Beschrijving', input('description', 'formula-description', 'Wat beschrijft deze variabele?'))),
      bar(btn('Voorbeeld berekenen', safe(() => { const defs = candidate(); if (!A.raw || session.boatId !== b.id) throw new Error('Open een sessie van deze boot om een voorbeeld te berekenen.'); const s = snapshot(); s.profile.formulas = defs; const D = process(s); const q = D.formulaDiagnostics.find(x => x.name === edit.name); const arr = Array.from(D.ch[edit.name]).filter(fin); preview.textContent = q.missing.length ? 'Ontbreekt: ' + q.missing.join(', ') : `${q.valid} geldige waarden · gemiddelde ${f1(SL.mean(arr), 3)} ${edit.unit} · ${q.invalid} ontbrekend/ongeldig`; })),
        btn('Formule opslaan bij boot', safe(() => { b.formulas = candidate(); changed(); WF.formulaEdit = null; show('boat'); banner('Formule opgeslagen. Pas het profiel expliciet toe om ook deze sessie opnieuw te berekenen.'); }), true), btn('Nieuw', () => { WF.formulaEdit = null; show('boat'); })), preview,
      h('details', {}, h('summary', {}, 'Functies & rekenregels'), help('+, −, *, /, ^, vergelijkingen, && en ||. abs, sqrt, min, max, clamp, sinD, cosD, tanD, atan2D, wrap180, wrap360, angleDiff, if en coalesce. Hoekfuncties gebruiken graden. Ontbrekende waarden en delen door nul blijven ontbrekend. Eenheden worden vastgelegd; controleer zelf de dimensies van je formule.'))));
    c.append(card('Referenties van de boot', help((b.polar ? 'Polar opgeslagen · ' : 'Nog geen polar · ') + b.sails.length + ' zeilen · ' + b.calibrationHistory.length + ' kalibraties'),
      b.calibrationHistory.length ? table(['Datum', 'Context', 'BSP factor', 'MHU offset'], b.calibrationHistory.map(v => [new Date(v.at).toLocaleString('nl-NL'), v.baseline || '—', f1(v.value.bspK, 3), f1(v.value.awaOff)])) : null,
      help('Een opgeslagen kalibratie is geschiedenis en context. Een nieuw log begint met nul extra correctie; zo pas je een reeds aan boord ingevoerde correctie niet dubbel toe.')));
  }
  async function init() {
    const extra = [['boat', 'Bootinstellingen'], ['review', 'Beoordelen'], ['analysis', 'Analyse']];
    for (const [id, title] of extra) { TITLE[id] = title; $('#nav').append(btn(title, () => show(id), false, { class: 'nav', 'data-tab': id })); $('#panes').append(h('div', { id: 't-' + id, class: 'tabpane', hidden: '' })); }
    TITLE.home = 'Boten & sessies'; TITLE.setup = 'Gegevens'; TITLE.cal = 'Kalibratie'; ANY.add('boat'); DAYONLY.add('review'); DAYONLY.add('analysis');
    $('#nav [data-tab="home"]').textContent = 'Boten & sessies';
    $('.topbar').append(h('span', { id: 'wf-save', class: 'chip', role: 'status', 'aria-live': 'polite' }));
    R.home = home; R.setup = setup; R.boat = boatSettings; R.review = review; R.cal = calibration; R.analysis = analyse;
    const oldReport = R.report; R.report = () => { oldReport(); if (!session) return; const c = $('#t-report .report') || $('#t-report'); c.prepend(h('section', { class: 'rsec' }, h('h2', {}, session.name + ' · debrief'), help('Boot: ' + session.profile.name + ' · profiel v' + session.profile.revision + ' · kalibratie v' + session.calibrationHistory.length), help(session.baseline || 'Geen instrumentcontext ingevuld.'), help('Samenvatting en track tonen de volledige sessie. Fasegrafieken en eigen variabelen volgen de actieve selectie en beoordelingen. ' + (session.selections.analysis ? dstr(session.selections.analysis.start) + ' – ' + dstr(session.selections.analysis.end) : 'Geen tijdselectie.')), session.notes.map(n => h('p', {}, (n.range ? tstr(n.range.start) + '–' + tstr(n.range.end) + ': ' : '') + n.text)))); if (session.profile.formulas.length) c.append(card('Eigen variabelen', table(['Naam', 'Formule', 'Eenheid', 'Versie', 'Fasegemiddelde'], session.profile.formulas.map(d => [d.name, d.expression, d.unit, d.version, f1((d.type === 'angle' ? SL.cmean : SL.mean)(filteredPhases(A.D.phases).map(p => p.v[d.name])), 3)])))); };
    STUDIO.init();
    document.addEventListener('change', () => { if (session) touch(); });
    document.addEventListener('input', e => { if (session && e.target.matches('textarea.note,input,select')) touch(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) persist().catch(() => {}); });
    try { const saved = await db.get('workspace'); if (saved?.version === 1 && saved.type === 'workspace') library = saved; saveMessage = 'Opgeslagen in deze browser'; }
    catch (e) { saveMessage = 'Opslag niet beschikbaar'; banner(e.message + '. Gebruik projectexport om je werk te bewaren.', true); }
    loading = true;
    if (library.lastSession) { try { const s = SL.validateSession(await db.get('session:' + library.lastSession)); adopt(s, process(s)); } catch (e) { banner('Laatste sessie kon niet worden geopend: ' + e.message, true); } }
    show('home'); loading = false; status();
  }
  return { selectionBar, timePanel, notes, comparison, openVersion, open, create, init, resolve, afterShow, touch, persist, importFiles, filteredPhases, rangeIndices, exportProject, get session() { return session; }, get library() { return library; }, get dirty() { return dirty; }, recompute, process, snapshot, applyCalibration, objects, comparison, editBoatId: null, formulaEdit: null };
})();
