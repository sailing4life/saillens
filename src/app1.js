'use strict';
/* SailLens tabs (part 1): shell, loading, setup, events, summary, chart, phases, performance, XY, polar. */
const R = {};
const TABS = [['', [['home', 'Home', 'M2 8l6-5 6 5M4 7v6h8V7']]], ['Day', [['setup', 'Setup', 'M3 4h10M3 8h10M3 12h6'], ['events', 'Events', 'M4 2v12M4 3h8l-2 3 2 3H4'], ['summary', 'Summary', 'M2 13h12M4 13V8M8 13V3M12 13V6'], ['chart', 'Chart & replay', 'M2 12l4-7 3 4 2-3 3 6z'], ['phases', 'Phases', 'M2 4h12M2 8h12M2 12h12']]],
  ['Analysis', [['perf', 'Performance', 'M2 13l4-5 3 2 5-7M11 3h3v3'], ['xy', 'XY & correlation', 'M2 2v12h12M5 10h.01M8 7h.01M11 5h.01M7 11h.01'], ['polar', 'Polar', 'M3 2v12M3 14a6 6 0 0 0 0-12a9 9 0 0 1 9 6 9 9 0 0 1-9 6'], ['sails', 'Sail chart', 'M2 2v12h12M2 9c4 0 4-5 12-5M6 14c0-4 4-6 8-6'], ['cal', 'Calibration', 'M8 2v3M8 11v3M2 8h3M11 8h3M8 8l2-2'], ['man', 'Manoeuvres', 'M2 12c3 0 3-8 6-8s3 8 6 8'], ['wind', 'Wind', 'M2 6h8a2 2 0 1 0-2-2M2 10h10a2 2 0 1 1-2 2'], ['ml', 'ML insights', 'M8 2l1.5 4L14 8l-4.5 2L8 14l-1.5-4L2 8l4.5-2z']]],
  ['Season', [['season', 'Season database', 'M3 4c0-1 2-2 5-2s5 1 5 2v8c0 1-2 2-5 2s-5-1-5-2zM3 4c0 1 2 2 5 2s5-1 5-2M3 8c0 1 2 2 5 2s5-1 5-2']]],
  ['Output', [['report', 'Report', 'M4 2h6l3 3v9H4zM10 2v3h3M6 8h5M6 11h5']]]];
const TITLE = Object.fromEntries(TABS.flatMap(g => g[1].map(t => [t[0], t[1]])));
const DAYONLY = new Set(['summary', 'chart', 'events', 'report', 'wind']), ANY = new Set(['setup', 'season', 'home']);
const pane = id => { const e = $('#t-' + id); e.textContent = ''; return e; };
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', {}, title) : null, kids);
const mlTag = () => h('span', { class: 'tag' }, 'model');
const bar = (...kids) => h('div', { class: 'bar noprint' }, kids);
const kpi = (lab, val, unit, sub, cls) => h('div', { class: 'kpi ' + (cls || '') }, h('span', {}, lab), h('b', {}, val, unit ? h('small', {}, unit) : null), sub ? h('em', {}, sub) : null);
function dl(name, text) { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove(); }
function show(tab) {
  A.tab = tab; A.playing = false; _css = null;
  if ((A.bannerAge = (A.bannerAge || 0) + 1) > 2 && !(A.D && A.D.warn.length && $('#banner').textContent === A.D.warn.join(' '))) banner('');
  document.querySelectorAll('button.nav').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.id !== 't-' + tab; if (p.hidden) p.textContent = ''; });
  const hasS = !!(A.S && A.S.days.length > 0); if ((!hasS || !A.SP.length) && season()) A.scope = 'day';
  $('#title').textContent = TITLE[tab] + (!DAYONLY.has(tab) && !ANY.has(tab) && season() ? ' · season' : '');
  document.querySelectorAll('#scope button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.scope === A.scope); if (b.dataset.scope === 'season') { b.disabled = !hasS; b.textContent = hasS ? `Season · ${A.S.days.length} days` : 'Season'; } });
  $('#scope').hidden = DAYONLY.has(tab) || ANY.has(tab);
  $('#dirty').hidden = !A.evDirty;
  const ok = ANY.has(tab) || (DAYONLY.has(tab) ? !!A.D : season() ? A.SP.length > 0 : !!A.D);
  if (ok) R[tab](); else pane(tab).append(card(null, h('p', { class: 'muted' }, DAYONLY.has(tab) || !hasS ? 'Load a log file on the Setup tab first.' : 'No day is loaded. Switch to Season at the top right to analyse the season database.')));
}

/* ---------------- loading & processing ---------------- */
function banner(msg, bad) { const b = $('#banner'); b.textContent = msg || ''; b.hidden = !msg; b.className = bad ? 'bad' : ''; A.bannerAge = 0; }
const meta = () => { const m = (A.events && A.events.meta) || {}; return { ...m, boat: A.cfg.boat || m.boat || 'Boat' }; };
function recompute() {
  if (!A.raw) return;
  try { A.D = SL.analyse(A.raw, { events: A.events, polar: A.polar, cfg: A.cfg, calib: A.calib }); A.cur = Math.min(Math.max(A.cur, A.D.i0), A.D.i1 - 1); A.view = { z: 1, x: 0, y: 0 }; A.ml = {}; banner(A.D.warn.join(' ')); }
  catch (e) { A.D = null; banner(e.message, true); console.error(e); }
  const D = A.D;
  $('#status').textContent = (A.demo ? 'Example data · ' : '') + meta().boat + (D ? ' · ' + dstr(D.sum.t0).slice(0, 10) + ' · ' + D.phases.length + ' phases' + (D.calibrated ? ' · calibration applied' : '') : '');
  $('#status').className = A.demo ? 'chip demo' : 'chip';
}
function leaveDemo() { if (A.demo) { A.calib = null; A.demo = false; A.events = null; A.polar = null; A.raw = null; A.D = null; A.files = {}; A.cfg = { ...SL.DEF, dispOff: 0 }; A.evDirty = false; } }
async function loadFile(file, kind) {
  const text = await file.text(), head = text.slice(0, 3000), l0 = head.split('\n')[0];
  let json = null; if (/^\uFEFF?\s*\{/.test(head)) { try { json = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { banner(file.name + ': not valid JSON.', true); return; } }
  if (json) kind = json.type === 'sailchart' ? 'chart' : json.type === 'calibration' ? 'calib' : 'season';
  if (!kind) kind = (/StartDateTime/.test(l0) && /TWS/.test(l0)) || /DistanceLost_m/.test(l0) ? 'season' : /<daysail|<events[\s>]/.test(text.slice(0, 20000)) ? 'ev' : /\.xml$/i.test(file.name) || /^\uFEFF?\s*</.test(head) ? 'chart' : (/^\uFEFF?!boat/i.test(text) || /(^|[,;\t])\s*"?(utc|time|bsp|timestamp)"?\s*([,;\t]|$)/i.test(l0)) ? 'log' : 'polar';
  try {
    if (kind === 'season') { seasonImport(text, file.name); show('season'); return; }
    if (kind === 'chart') { A.chart = SL.parseSailChart(text, file.name.replace(/\.\w+$/, '')); A.files.chart = file.name; chartChanged(); show('sails'); banner(`${file.name}: sail chart loaded, ${A.chart.shapes.length} sail areas` + (Object.keys(A.chart.cells).length ? ` and ${Object.keys(A.chart.cells).length} painted cells.` : '.')); return; }
    if (kind === 'calib') { if (!json || json.type !== 'calibration') throw new Error('not a SailLens calibration file.'); A.calib = { ...SL.CAL0, ...json }; A.files.calib = file.name; recompute(); show('cal'); banner(`${file.name}: calibration ${SL.calibActive(A.calib) ? 'applied to the log' : 'loaded (all corrections are zero)'}.`); return; }
    leaveDemo();
    if (kind === 'log') { A.raw = SL.parseLog(text); A.files.log = file.name; A.cfg.tStart = A.cfg.tEnd = null; A.cur = 0; }
    else if (kind === 'ev') { A.events = SL.parseEvents(text); A.events.xml = text; A.events.sails = SL.parseSailList(text); A.files.ev = file.name; A.evDirty = false; A.cfg.evOff = A.events.evOff; A.cfg.logOff = A.events.logOff; A.cfg.dispOff = A.events.evOff - A.events.logOff; A.cfg.tStart = A.cfg.tEnd = null; if (!A.events.events.length) banner('No events found in ' + file.name, true); }
    else { A.polar = SL.makePolar(SL.parsePolar(text), 'file'); A.files.polar = file.name; }
    recompute();
  } catch (e) { banner(file.name + ': ' + e.message, true); console.error(e); }
  show(A.tab);
}
function loadDemo() { const d = SL.demo(); A.raw = d.raw; A.events = d.events; A.events.sails = [{ name: 'Main', type: 'Mainsail' }, { name: 'J2', type: 'Jib' }, { name: 'A2', type: 'Masthead Gennaker' }]; A.polar = d.polar; A.demo = true; A.files = {}; A.cfg = { ...SL.DEF, evOff: 2, logOff: 0, dispOff: 2 }; A.cur = 0; A.evDirty = false; recompute(); }

/* ---------------- Setup ---------------- */
R.setup = () => {
  const c = pane('setup'), cf = A.cfg, D = A.D;
  const fileRow = (lab, kind, hint, acc) => h('div', { class: 'filerow' }, h('div', {}, h('b', {}, lab), h('div', { class: 'muted' }, A.files[kind] ? A.files[kind] : (A.demo ? 'example data loaded' : hint))), h('input', { type: 'file', id: 'file-' + kind, accept: acc, onchange: e => e.target.files[0] && loadFile(e.target.files[0], kind) }));
  const num = (k, lab, step, ph) => field(lab, h('input', { type: 'number', id: 'cfg-' + k, step: step || 1, value: cf[k] ?? '', placeholder: ph || '', onchange: e => { cf[k] = e.target.value === '' ? null : +e.target.value; } }));
  const loc = ms => ms == null ? '' : new Date(ms + cf.dispOff * 36e5).toISOString().slice(0, 19), unl = s => s ? Date.parse(s + 'Z') - cf.dispOff * 36e5 : null;
  const dt = (k, lab, def) => field(lab, h('input', { type: 'datetime-local', id: 'cfg-' + k, step: 1, value: loc(cf[k] ?? def), onchange: e => { cf[k] = unl(e.target.value); } }));
  c.append(h('div', { class: 'cols' },
    card('Files',
      h('p', { class: 'muted' }, 'Choose files or drop them anywhere on this page. Everything is processed in your browser; nothing is uploaded.'),
      fileRow('Log file', 'log', 'Expedition log (.csv) or a CSV table with a time column', '.csv,.txt,.log'),
      fileRow('Event file', 'ev', 'RaceReplay / OnboardAssistant event file (.ev.xml), or build one on the Events tab', '.xml,.csv'),
      fileRow('Polar file', 'polar', 'Expedition polar (.txt). Without one, the targets logged by Expedition are used', '.txt,.pol,.csv'),
      fileRow('Crossover chart', 'chart', 'Sail chart (.xml or SailLens .sailchart.json); or build one on the Sail chart tab', '.xml,.json'),
      fileRow('Calibration file', 'calib', 'SailLens calibration (.calibration.json); or fill it in on the Calibration tab', '.json'),
      A.raw ? h('p', { class: 'muted' }, `${A.raw.format}: ${A.raw.n.toLocaleString()} s of data, ${Object.keys(A.raw.ch).length} channels, starts ${dstr(A.raw.t0)}.`) : null,
      bar(h('button', { onclick: () => { loadDemo(); show('setup'); } }, 'Load example data'))),
    card('Settings',
      h('div', { class: 'form' },
        field('Boat name', h('input', { type: 'text', id: 'cfg-boat', value: cf.boat || (A.events && A.events.meta.boat) || '', onchange: e => { cf.boat = e.target.value; } })),
        num('magVar', 'Mag variation (° E)', 0.1, '0'), num('evOff', 'Event file UTC offset (h)', 0.5), num('logOff', 'Log file UTC offset (h)', 0.5), num('dispOff', 'Show times at UTC + (h)', 0.5),
        dt('tStart', 'Only process from', D ? D.sum.t0 : null), dt('tEnd', 'until', D ? D.sum.t1 : null),
        num('phaseLen', 'Phase length (s)'), num('phaseGap', 'Gap between phases (s)'), num('sdTwa', 'Max TWA std dev in phase (°)', 0.5), num('sdBsp', 'Max BSP std dev (kn)', 0.1), num('polMin', 'Phase BSPpol% min'), num('polMax', 'Phase BSPpol% max'), num('minBsp', 'Min BSP (kn)', 0.5),
        field('Racing only (start to finish)', h('input', { type: 'checkbox', id: 'cfg-racing', checked: cf.racingOnly ? '' : null, onchange: e => { cf.racingOnly = e.target.checked; } }))),
      D && D.logMagVar != null ? h('p', { class: 'muted' }, `Expedition logged a magnetic variation of ${f1(D.logMagVar)}°. Leave Mag variation at 0 if your HDG is already true; the Calibration tab checks heading against GPS either way.`) : null,
      bar(h('button', { class: 'primary', onclick: () => { recompute(); show('setup'); } }, 'Process'), h('button', { onclick: () => { cf.tStart = cf.tEnd = null; recompute(); show('setup'); } }, 'Window from event file')))));
};

/* ---------------- Events ---------------- */
const SAILTYPES = ['Mainsail', 'Jib', 'Staysail', 'Masthead Gennaker', 'Fractional Gennaker', 'Spinnaker', 'Code 0'];
const EVTYPES = ['SailsUp', 'RaceStartGun', 'RaceMark', 'RaceFinish', 'DayStart', 'DayStop', 'ManualEntry', 'StartTesting', 'StopTesting', 'MiscEvent'];
function evEnsure() { if (!A.events) A.events = { meta: { boat: A.cfg.boat || '' }, evOff: A.cfg.evOff || 0, logOff: A.cfg.logOff || 0, events: [], sails: [] }; if (!A.events.sails) A.events.sails = []; A.events.evOff = A.cfg.evOff || 0; A.events.logOff = A.cfg.logOff || 0; return A.events; }
const idxTl = i => iT(i) - (A.cfg.logOff || 0) * 36e5 + (A.cfg.evOff || 0) * 36e5;
const tlClock = tl => new Date(tl).toISOString().slice(11, 19);
function evChanged() { A.events.events.sort((a, b) => a.tl - b.tl); A.evDirty = true; if (A.demo) A.demo = false; recompute(); }
function addEvent(type, attr, comments, tl) {
  const ev = evEnsure(), t = tl ?? idxTl(A.cur);
  if (type === 'RaceStartGun' && !attr) attr = String(ev.events.filter(e => e.type === 'RaceStartGun').length + 1);
  if (type === 'RaceMark' && !attr) { let n = 1; for (const e of ev.events) { if (e.tl > t) break; if (e.type === 'RaceStartGun') n = 1; else if (e.type === 'RaceMark') n++; } attr = String(n); }
  if (type === 'RaceFinish' && !attr) attr = String(Math.max(1, ev.events.filter(e => e.type === 'RaceStartGun' && e.tl <= t).length));
  ev.events.push({ tl: t, type, attr: attr || '', comments: comments || '' }); evChanged();
}
function renumberMarks() { let n = 0, r = 0; for (const e of A.events.events) { if (e.type === 'RaceStartGun') { r++; n = 0; e.attr = String(r); } else if (e.type === 'RaceMark') e.attr = String(++n); else if (e.type === 'RaceFinish') e.attr = String(Math.max(1, r)); } }
R.events = () => {
  const c = pane('events'), D = A.D, ev = evEnsure(), st = A.est = A.est || { type: 'SailsUp', sails: ['', '', '', ''] }, m = ev.meta;
  const known = [[], [], [], []]; ev.sails.forEach(s => known[s.type === 'Mainsail' ? 0 : s.type === 'Jib' ? 1 : s.type === 'Staysail' ? 2 : 3].push(s.name));
  ev.events.filter(e => e.type === 'SailsUp').forEach(e => e.attr.split(';').forEach((s, k) => { if (s && k < 4 && !known[k].includes(s)) known[k].push(s); }));
  if (!st.sails[0] && known[0][0]) st.sails[0] = known[0][0];
  const tIn = h('input', { type: 'text', id: 'ev-time', value: tlClock(idxTl(A.cur)), style: 'width:96px' });
  const attrBox = h('span', { class: 'bar' });
  const drawAttr = () => { attrBox.textContent = ''; if (st.type === 'SailsUp') ['Mainsail', 'Headsail', 'Staysail', 'Spinnaker'].forEach((lab, k) => attrBox.append(field(lab, sel('ev-sail-' + k, [''].concat(known[k]), st.sails[k], v => { st.sails[k] = v; })))); else attrBox.append(field(st.type === 'ManualEntry' ? 'Values, e.g. Mast_Base=52;Rake=3' : /Race/.test(st.type) ? 'Number (blank = automatic)' : 'Attribute', h('input', { type: 'text', id: 'ev-attr', style: 'width:230px' }))); };
  const cmt = h('input', { type: 'text', id: 'ev-cmt', style: 'width:200px' });
  const parseClock = (s, ref) => { const mm = s.trim().match(/^(\d\d?):(\d\d)(?::(\d\d))?$/); if (!mm) return null; const d = new Date(ref); d.setUTCHours(+mm[1], +mm[2], +(mm[3] || 0), 0); return d.getTime(); };
  const add = () => { const tl = parseClock(tIn.value, idxTl(A.cur)); if (tl == null) { banner('Time must look like 13:45:00.', true); return; } const attr = st.type === 'SailsUp' ? st.sails.join(';') : ($('#ev-attr') ? $('#ev-attr').value : ''); addEvent(st.type, attr, cmt.value, tl); show('events'); };
  drawAttr();
  const rows = ev.events.map((e, k) => { const i = D ? Math.round((e.tl - (A.cfg.evOff || 0) * 36e5 + (A.cfg.logOff || 0) * 36e5 - A.raw.t0) / 1000) : -1, inLog = D && i >= D.i0 && i < D.i1;
    return [h('input', { type: 'text', value: tlClock(e.tl), style: 'width:84px', 'aria-label': 'Time', onchange: x => { const t = parseClock(x.target.value, e.tl); if (t != null) { e.tl = t; evChanged(); show('events'); } } }),
      sel('ev-type-' + k, EVTYPES.includes(e.type) ? EVTYPES : EVTYPES.concat([e.type]), e.type, v => { e.type = v; evChanged(); show('events'); }),
      h('input', { type: 'text', value: e.attr, style: 'width:210px', 'aria-label': 'Attribute', onchange: x => { e.attr = x.target.value; evChanged(); show('events'); } }),
      h('input', { type: 'text', value: e.comments, style: 'width:230px', 'aria-label': 'Comments', onchange: x => { e.comments = x.target.value; A.evDirty = true; $('#dirty').hidden = false; } }),
      inLog ? '' : { t: D ? 'outside log window' : '', c: 'muted' },
      h('span', {}, inLog ? h('button', { class: 'mini', title: 'Show on chart', onclick: () => { A.cur = i; show('chart'); } }, 'Show') : null, ' ', h('button', { class: 'mini danger', title: 'Delete event', onclick: () => { ev.events.splice(k, 1); evChanged(); show('events'); } }, 'Delete'))]; });
  const sName = h('input', { type: 'text', id: 'sail-name', placeholder: 'e.g. J3-26', style: 'width:130px' }), sType = sel('sail-type', SAILTYPES, 'Jib', () => {});
  const info = (k, lab, w) => field(lab, h('input', { type: 'text', id: 'day-' + k, value: m[k] || '', style: 'width:' + (w || 200) + 'px', onchange: x => { m[k] = x.target.value; if (k === 'boat') A.cfg.boat = x.target.value; A.evDirty = true; $('#dirty').hidden = false; } }));
  const save = () => { const d = (ev.events[0] ? new Date(ev.events[0].tl) : new Date(D ? D.sum.t0 : Date.now())).toISOString().slice(0, 10); if (!m.date) m.date = d; dl(`${(m.boat || 'Boat').replace(/\W+/g, '_')}_${m.date.replace(/-/g, '').slice(2)}_0.ev.xml`, SL.eventsXml(ev)); A.evDirty = false; $('#dirty').hidden = true; };
  const suggest = () => { if (!ev.events.some(e => e.type === 'RaceStartGun')) { banner('Add a start gun first: marks are numbered per race.', true); return; } const sug = SL.suggestMarks(D), have = ev.events.filter(e => /Race(Mark|StartGun|Finish)/.test(e.type)).map(e => e.tl); let n = 0; for (const s of sug) { if (!D.L.race[s.i]) continue; const tl = idxTl(s.i); if (have.some(t => Math.abs(t - tl) < 9e4)) continue; ev.events.push({ tl, type: 'RaceMark', attr: '', comments: 'suggested: ' + (s.top ? 'top mark' : 'bottom mark') }); n++; } ev.events.sort((a, b) => a.tl - b.tl); renumberMarks(); evChanged(); show('events'); banner(n ? n + ' mark(s) added where the boat turned between upwind and downwind during a race. Check them on the chart.' : 'No new mark roundings found inside the races.'); };
  c.append(card('Day', h('div', { class: 'bar' }, info('boat', 'Boat', 130), info('desc', 'Description', 240), info('location', 'Location', 150), info('daytype', 'Day type', 150), info('goals', 'Goals', 240), info('comments', 'Comments', 280)),
      bar(h('button', { class: 'primary', onclick: save }, 'Save event file (.ev.xml)'), h('span', { class: 'muted' }, ev.xml ? 'Saves in RaceReplay format; the phases and mark roundings RaceReplay stored in the file are kept as they were.' : 'Saves a new file in RaceReplay / OnboardAssistant format.'))),
    card('Add an event',
      h('div', { class: 'bar' }, field('Time (UTC' + ((A.cfg.evOff || 0) >= 0 ? '+' : '') + (A.cfg.evOff || 0) + ')', tIn), D ? h('button', { onclick: () => { tIn.value = tlClock(idxTl(A.cur)); } }, 'Use chart cursor') : null, field('Type', sel('ev-type', EVTYPES, st.type, v => { st.type = v; drawAttr(); })), attrBox, field('Comments', cmt), h('button', { class: 'primary', onclick: add }, 'Add event')),
      h('p', { class: 'muted' }, 'The time starts at the chart cursor: move the boat on Chart & replay to the moment, then come back here, or type a time. Start gun, mark and finish can also be added straight from the chart.'),
      D ? bar(h('button', { onclick: suggest }, 'Suggest marks from the track'), h('button', { onclick: () => { renumberMarks(); evChanged(); show('events'); } }, 'Renumber races and marks')) : null),
    card(`Events (${ev.events.length})`, ev.events.length ? table(['Time', 'Type', 'Attribute', 'Comments', '', ''], rows) : h('p', { class: 'muted' }, 'No events yet. Sail changes, starts, marks and finishes drive the sails-up, race and leg columns everywhere else.'),
      h('p', { class: 'muted' }, 'SailsUp attribute is Mainsail;Headsail;Staysail;Spinnaker. ManualEntry values (for example Mast_Base=52) become channels you can plot and feed to the model.')),
    card('Sail list', h('div', { class: 'sailchips' }, ev.sails.length ? ev.sails.map((s, k) => h('span', {}, s.name, h('em', {}, s.type), h('button', { title: 'Remove ' + s.name, onclick: () => { ev.sails.splice(k, 1); A.evDirty = true; show('events'); } }, '×'))) : h('p', { class: 'muted' }, 'No sails yet.')),
      h('div', { class: 'bar' }, field('Sail name', sName), field('Type', sType), h('button', { onclick: () => { if (!sName.value.trim()) return; ev.sails.push({ name: sName.value.trim(), type: sType.value }); A.evDirty = true; show('events'); } }, 'Add sail'))));
};

/* ---------------- Summary ---------------- */
R.summary = () => {
  const c = pane('summary'), D = A.D, s = D.sum, st = A.st = A.st || { binVar: 'BSPpol%', dist: 'Upwind' }, sv = A.scope; A.scope = 'day';
  const av = (md, k) => SL.mean(D.phases.filter(p => p.mode === md).map(p => p.v[k])), cls = v => !fin(v) ? '' : v >= 98 ? 'good' : v >= 94 ? '' : 'warn', np = md => D.phases.filter(p => p.mode === md).length + ' phases';
  c.append(h('div', { class: 'kpis' }, kpi('True wind', f1(s.TWS.avg), 'kn', `${f1(s.TWS.min)}–${f1(s.TWS.max)} kn` + (s.TWD ? ` · ${f1(s.TWD.avg, 0)}°` : '')), kpi('Boat speed', f1(s.BSP.avg), 'kn', 'max ' + f1(s.BSP.max)), kpi('Distance', f1(s.dist), 'nm', dur(s.sailing) + ' sailing'), kpi('Tacks / gybes', s.tacks + ' / ' + s.gybes), kpi('Upwind VMG%', f1(av('Upwind', 'VMG%')), '%', np('Upwind'), cls(av('Upwind', 'VMG%'))), kpi('Downwind VMG%', f1(av('Downwind', 'VMG%')), '%', np('Downwind'), cls(av('Downwind', 'VMG%')))));
  const s1 = card('Day summary'); blkSummary(s1);
  const s2 = card('Bin report'); const b2 = h('div'); const rb = () => { const v = A.scope; A.scope = 'day'; b2.textContent = ''; blkBins(b2, st.binVar); A.scope = v; };
  s2.append(bar(filterBar(() => R.summary()), field('Average of', sel('bin-var', varList(), st.binVar, v => { st.binVar = v; rb(); }))), b2);
  const s3 = card('Leg averages'); blkLegs(s3); s3.append(bar(h('button', { onclick: () => dl('legs.csv', legsCsv()) }, 'Export legs CSV')));
  const s4 = card('Data distribution'), b4 = h('div'); s4.append(bar(field('Mode', sel('dist-mode', SL.MODES, st.dist, v => { st.dist = v; b4.textContent = ''; blkDist(b4, v); }))), b4);
  const sts = SL.starts(D), s5 = sts.length ? card('Starts', table(['Race', 'Time', 'TWS', 'BSP at gun', '% of target', 'Last 20 s before', 'First 30 s after', 'Up to speed', 'First minute', 'Line (from Expedition)'], sts.map(x => { const row = [{ t: 'R' + x.race, c: 'b' }, tstr(iT(x.i)), f1(x.tws), f1(x.bsp, 2), { t: f1(x.pct, 0) + '%', c: 'b verdict ' + (x.pct >= 90 ? 'good' : 'warn') }, f1(x.pre, 0) + '%', f1(x.post, 0) + '%', fin(x.t95) ? x.t95 + ' s' : 'over 3 min', f1(x.d60, 0) + ' m', x.note]; row._attrs = { class: 'click', onclick: () => { A.cur = x.i; show('chart'); } }; return row; }), 'num'), h('p', { class: 'muted' }, '% of target is boat speed against target speed when close-hauled, against the polar otherwise. Up to speed: seconds after the gun until the boat holds 95% for five seconds.')) : null;
  c.append(s1, s5, s2, s3, s4); rb(); blkDist(b4, st.dist); A.scope = sv;
};
const csvRow = a => a.map(x => /[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : x).join(',');
function legsCsv() { const sv = A.scope; A.scope = 'day'; const ks = varList(); A.scope = sv; return [csvRow(['Leg', 'Mode', 'Duration_s', 'Sails', 'Phases'].concat(ks))].concat(A.D.legs.map(l => csvRow([l.name, l.mode, l.dur, l.sails, l.n].concat(ks.map(k => fin(l.v[k]) ? +l.v[k].toFixed(3) : ''))))).join('\r\n'); }
function phasesCsv(ps) { const ks = varList(); return [csvRow(['Start', 'Duration_s', 'Mode', 'Tack', 'Sails', 'RaceLeg'].concat(ks))].concat(ps.map(p => csvRow([p.i == null ? ptime(p) : dstr(p.t), p.i == null ? p.dur : p.i1 - p.i, p.mode, p.tack, p.sails, p.raceLeg].concat(ks.map(k => fin(p.v[k]) ? +p.v[k].toFixed(3) : ''))))).join('\r\n'); }

/* ---------------- Chart (map + replay + time series) ---------------- */
R.chart = () => {
  const c = pane('chart'), D = A.D, st = A.cst = A.cst || { v: 'BSPpol%', strips: ['BSP', 'TWS', 'TWD'], barbs: true }, sv = A.scope; A.scope = 'day'; const vars = varList(); A.scope = sv;
  const ro = h('div', { class: 'readouts' }), cv = h('canvas', { class: 'map' }), off = document.createElement('canvas'), slider = h('input', { type: 'range', id: 'replay-pos', 'aria-label': 'Replay position', min: D.i0, max: D.i1 - 1, value: A.cur, oninput: e => { A.cur = +e.target.value; upd(); } });
  let geo = null;
  const base = () => { geo = drawMap(off, { v: st.v, view: A.view, barbs: st.barbs, w: cv.parentElement.clientWidth || 700, h: 540 }); cv.width = off.width; cv.height = off.height; cv.style.height = '540px'; };
  const boat = () => { const x = cv.getContext('2d'), dp = window.devicePixelRatio || 1; x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(off, 0, 0); if (!geo) return; x.setTransform(dp, 0, 0, dp, 0, 0); const i = A.cur, G = mapGeom(D); if (!fin(G.x[i])) return; const hd = ((D.ch.HDG ? D.ch.HDG[i] + D.magVar : D.ch.COG ? D.ch.COG[i] : 0) || 0) * SL.D2R; x.save(); x.translate(geo.X(i), geo.Y(i)); x.rotate(hd); x.fillStyle = css('--accent'); x.strokeStyle = css('--surface'); x.lineWidth = 2; x.beginPath(); x.moveTo(0, -15); x.quadraticCurveTo(8, -2, 6, 11); x.lineTo(-6, 11); x.quadraticCurveTo(-8, -2, 0, -15); x.closePath(); x.fill(); x.stroke(); x.restore(); };
  const strips = st.strips.map((k, n) => ({ n, cv: h('canvas', { class: 'strip' }) }));
  const drawStrip = s => { const k = st.strips[s.n], a = D.ch[k]; if (!a) return; const W = s.cv.parentElement.clientWidth || 700, vals = []; for (let i = D.i0; i < D.i1; i += 5) if (fin(a[i])) vals.push(a[i]); const lo = SL.quant(vals, 0.005), hi = SL.quant(vals, 0.995), pd = (hi - lo) * 0.06 || 1;
    const p = plot(s.cv, { xr: [D.i0, D.i1], yr: [lo - pd, hi + pd], h: 120, yl: k, xfmt: v => tstr(iT(v)).slice(0, 5), pb: 20 }), x = p.c; s.p = p;
    x.fillStyle = alpha(css('--accent'), 0.1); let rs = -1; for (let i = D.i0; i <= D.i1; i++) { const r = i < D.i1 && D.L.race[i]; if (r && rs < 0) rs = i; if (!r && rs >= 0) { x.fillRect(p.X(rs), p.pt, p.X(i) - p.X(rs), p.H - p.pt - p.pb); rs = -1; } }
    const n = D.i1 - D.i0, cols = W - p.pl - p.pr, step = Math.max(1, n / cols); x.strokeStyle = SER(s.n); x.lineWidth = 1.2; x.beginPath(); let on = false;
    for (let q = 0; q < cols; q++) { const a0 = D.i0 + Math.floor(q * step), a1 = Math.min(D.i1, a0 + Math.ceil(step)); let mn = Infinity, mx = -Infinity; for (let i = a0; i < a1; i++) if (fin(a[i])) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; } if (mn === Infinity) { on = false; continue; } const X = p.pl + q, y1 = Math.max(p.pt, Math.min(p.H - p.pb, p.Y(mx))), y2 = Math.max(p.pt, Math.min(p.H - p.pb, p.Y(mn))); on ? x.lineTo(X, y1) : x.moveTo(X, y1); x.lineTo(X, y2); on = true; } x.stroke();
    x.strokeStyle = css('--ink'); x.lineWidth = 1; x.beginPath(); x.moveTo(p.X(A.cur), p.pt); x.lineTo(p.X(A.cur), p.H - p.pb); x.stroke(); x.fillStyle = css('--ink'); x.font = '600 11px ' + css('--font'); x.textAlign = p.X(A.cur) > W - 90 ? 'right' : 'left'; x.textBaseline = 'top'; x.fillText(' ' + f1(a[A.cur], 2) + ' ', p.X(A.cur), p.pt + 2); };
  const RO = [['Time', i => tstr(iT(i))], ['Sails', i => D.L.sail[i] >= 0 ? D.L.sailNames[D.L.sail[i]] : '–'], ['Race', i => D.L.race[i] ? 'R' + D.L.race[i] + 'L' + D.L.leg[i] : '–'], ['BSP', i => f1(D.ch.BSP[i], 2)], ['SOG', i => D.ch.SOG ? f1(D.ch.SOG[i], 2) : '–'], ['TWS', i => f1(D.ch.TWS[i])], ['TWA', i => f1(D.ch.TWA[i], 0) + '°'], ['TWD', i => D.ch.TWD ? f1(D.ch.TWD[i], 0) + '°' : '–'], ['Heel', i => D.ch.Heel ? f1(D.ch.Heel[i]) : '–'], ['Rudder', i => D.ch.Rudder ? f1(D.ch.Rudder[i]) : '–'], ['BSPpol%', i => f1(D.ch['BSPpol%'][i], 0)], ['VMG%', i => f1(D.ch['VMG%'][i], 0)]].concat(!SL.chartEmpty(A.chart) ? [['Chart sail', i => SL.chartSail(A.chart, D.ch.TWS[i], D.ch.TWA[i]) || '–']] : []);
  const upd = () => { ro.textContent = ''; RO.forEach(([k, f]) => ro.append(h('div', { class: k === 'Time' || k === 'Sails' || k === 'Chart sail' ? 'wide' : '' }, h('span', {}, k), h('b', {}, f(A.cur))))); slider.value = A.cur; boat(); strips.forEach(drawStrip); };
  const playBtn = h('button', { class: 'primary', onclick: () => { A.playing = !A.playing; playBtn.textContent = A.playing ? 'Pause' : 'Play'; if (A.playing) { let last = performance.now(), acc = 0; const tick = now => { if (!A.playing || A.tab !== 'chart') { playBtn.textContent = 'Play'; return; } acc += (now - last) / 1000 * A.speed; last = now; if (acc >= 1) { A.cur = Math.min(D.i1 - 1, A.cur + Math.floor(acc)); acc %= 1; upd(); if (A.cur >= D.i1 - 1) A.playing = false; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); } } }, 'Play');
  let drag = null;
  cv.addEventListener('wheel', e => { e.preventDefault(); A.view.z = Math.max(0.5, Math.min(80, A.view.z * (e.deltaY < 0 ? 1.25 : 0.8))); base(); boat(); }, { passive: false });
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: A.view.x, vy: A.view.y, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { A.view.x = drag.vx - dx / A.view.z; A.view.y = drag.vy - dy / A.view.z; base(); boat(); } });
  cv.addEventListener('pointerup', e => { if (drag && !drag.moved && geo) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let b = -1, bd = 900; for (let i = D.i0; i < D.i1; i++) { const d = (geo.X(i) - x) ** 2 + (geo.Y(i) - y) ** 2; if (d < bd) { bd = d; b = i; } } if (b >= 0) { A.cur = b; upd(); } } drag = null; });
  strips.forEach(s => { const pick = e => { if (!s.p) return; const r = s.cv.getBoundingClientRect(), i = Math.round(D.i0 + (e.clientX - r.left - s.p.pl) / (s.p.W - s.p.pl - s.p.pr) * (D.i1 - D.i0)); A.cur = Math.max(D.i0, Math.min(D.i1 - 1, i)); upd(); }; s.cv.addEventListener('pointerdown', e => { s.down = true; pick(e); }); s.cv.addEventListener('pointermove', e => s.down && pick(e)); window.addEventListener('pointerup', () => s.down = false); });
  const quick = (lab, type) => h('button', { onclick: () => { addEvent(type); show('chart'); } }, lab);
  c.append(h('div', { class: 'chartgrid' }, h('div', { class: 'tabpane' }, card('Boat data', ro), card('Event at cursor', h('div', { class: 'bar' }, quick('Start gun', 'RaceStartGun'), quick('Mark', 'RaceMark'), quick('Finish', 'RaceFinish')), h('button', { onclick: () => { A.est = { type: 'SailsUp', sails: (A.est && A.est.sails) || ['', '', '', ''] }; show('events'); } }, 'Sail change or other…'))),
    card(null, bar(field('Colour track by', sel('map-var', vars, st.v, v => { st.v = v; base(); boat(); })), playBtn, field('Speed', sel('map-speed', ['5', '15', '30', '60', '120', '300'], String(A.speed), v => A.speed = +v)), h('button', { onclick: () => { A.view = { z: 1, x: 0, y: 0 }; base(); boat(); } }, 'Fit track'), field('Wind barbs', h('input', { type: 'checkbox', id: 'map-barbs', checked: st.barbs ? '' : null, onchange: e => { st.barbs = e.target.checked; base(); boat(); } }))), h('div', {}, cv), slider,
      h('p', { class: 'muted' }, 'Scroll to zoom, drag to pan, click the track to move the boat. Circles are tacks and gybes; squares are sail changes and race marks. Barbs point into the wind with TWS in knots.'))),
    card('Time series', h('p', { class: 'muted' }, 'Shaded spans are racing (start to finish). Click or drag to move the cursor.'), strips.map(s => h('div', { class: 'striprow' }, sel('strip-' + s.n, vars, st.strips[s.n], v => { st.strips[s.n] = v; drawStrip(s); }), h('div', {}, s.cv)))));
  base(); upd();
};

/* ---------------- Phases ---------------- */
R.phases = () => {
  const c = pane('phases'), st = A.pst = A.pst || { mode: 'All', sort: 't', dir: 1 }, ps = phases(st.mode);
  const ex = ['Forestay'].concat(manualKeys()).filter(hasVar);
  const cols = [[season() ? 'Day / time' : 'Time', 't', p => ptime(p)], ['Mode', 'mode', p => p.mode], ['Tack', 'tack', p => p.tack], ['Sails', 'sails', p => p.sails], ['Leg', 'raceLeg', p => p.raceLeg]].concat(['TWS', 'absTWA', 'BSP', 'BSPpol%', 'BSP_trg%', 'VMG', 'VMG%', 'ΔTWA', 'Heel', 'Rudder'].concat(ex).filter(hasVar).map(k => [k, k, p => f1(p.v[k], k === 'BSP' || k === 'VMG' ? 2 : 1)]));
  const val = (p, k) => p[k] !== undefined ? p[k] : p.v[k]; ps.sort((a, b) => { const x = val(a, st.sort), y = val(b, st.sort); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
  const sc = scale('BSPpol%', []);
  const t = table(cols.map(([lab, k]) => h('button', { class: 'sort', onclick: () => { st.dir = st.sort === k ? -st.dir : 1; st.sort = k; R.phases(); } }, lab + (st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''))), ps.slice(0, 600).map(p => { const r = cols.map(([lab, k, f]) => /pol%|trg%|VMG%/.test(k) ? { t: f(p), s: heat(p.v[k], sc) } : f(p)); if (p.i != null) r._attrs = { class: 'click', onclick: () => { A.cur = p.i; show('chart'); } }; return r; }), 'num');
  c.append(card(`Phases (${ps.length}${ps.length > 600 ? ', first 600 shown' : ''})`, bar(field('Mode', sel('ph-mode', ['All'].concat(SL.MODES), st.mode, v => { st.mode = v; R.phases(); })), filterBar(() => R.phases()), h('button', { onclick: () => dl('phases.csv', phasesCsv(ps)) }, 'Export phases CSV')),
    h('p', { class: 'muted' }, season() ? 'Every phase in the season database that matches the filters.' : `A phase is ${A.D.cfg.phaseLen} s of steady sailing on one tack: clear of manoeuvres and sail changes, TWA and BSP steady, BSPpol% between ${A.D.cfg.polMin} and ${A.D.cfg.polMax}. Click a row to see it on the chart.`), t));
};

/* ---------------- Performance ---------------- */
const byOpts = () => ['Tack', 'Sails', 'Race leg', 'TWS bin'].concat(season() ? ['Day'] : []);
R.perf = () => { const c = pane('perf'), st = A.fst = A.fst || { mode: 'Upwind', by: 'Tack' }, b = h('div'); if (!byOpts().includes(st.by)) st.by = 'Tack'; c.append(card('Performance against targets', bar(field('Mode', sel('pf-mode', ['Upwind', 'Downwind', 'Reaching'], st.mode, v => { st.mode = v; R.perf(); })), field('Colour by', sel('pf-by', byOpts(), st.by, v => { st.by = v; R.perf(); })), filterBar(() => R.perf())), bar(trendControls(() => R.perf())), h('p', { class: 'muted' }, 'Each point is one phase, plotted against true wind speed, with a trend per group. Zero is the target.'), b)); blkPerf(b, st.mode, st.by); };

/* ---------------- XY + correlation ---------------- */
R.xy = () => {
  const c = pane('xy'), vars = varList(), st = A.xst = A.xst || { x: 'abs_heel', y: 'VMG%', mode: 'Upwind', by: 'Tack' }; if (!vars.includes(st.x)) st.x = 'TWS'; if (!vars.includes(st.y)) st.y = 'BSP'; const b = h('div'), info = h('p', { class: 'muted' }), tt = h('div'), bys = ['Tack', 'Sails', 'Race leg', 'Mode', 'TWS bin'].concat(season() ? ['Day'] : []); if (!bys.includes(st.by)) st.by = 'Tack';
  c.append(card('XY graph', bar(field('X', sel('xy-x', vars, st.x, v => { st.x = v; R.xy(); })), field('Y', sel('xy-y', vars, st.y, v => { st.y = v; R.xy(); })), field('Mode', sel('xy-mode', ['All', 'Upwind', 'Reaching', 'Downwind'], st.mode, v => { st.mode = v; R.xy(); })), field('Colour by', sel('xy-by', bys, st.by, v => { st.by = v; R.xy(); })), filterBar(() => R.xy())), bar(trendControls(() => R.xy(), { resid: true }), field('Colour by value', sel('xy-cvar', [''].concat(vars), st.cvar || '', v => { st.cvar = v; R.xy(); }))), b, info, tt));
  const r = blkXY(b, { x: st.x, y: st.y, mode: st.mode, by: st.by, cvar: st.cvar, resid: true, h: 430, title: `${st.y} vs ${st.x} (${st.mode.toLowerCase()})` });
  if (r) { b.prepend(legend((r.cvS ? [] : r.ci.all.map(k => [r.ci.col(k), k])).concat([[css('--muted'), '● port'], [css('--muted'), 'stbd', 'tri']], r.filt && !trendCfg().hide ? [[alpha(css('--muted'), 0.4), 'faded = left out of the trend']] : [])));
    const all = phases(st.mode), pr = st.x !== 'TWS' && st.y !== 'TWS' ? SL.corr(SL.residual(all.map(p => p.v.TWS), all.map(p => p.v[st.x])), SL.residual(all.map(p => p.v.TWS), all.map(p => p.v[st.y]))) : NaN;
    info.textContent = `${r.n} phases` + (r.filt ? `, trend fitted on the ${r.nSel} where ${r.lab}` : '') + ` · correlation r = ${f1(r.r, 2)} (rank ${f1(r.rs, 2)})` + (fin(pr) ? ` · with wind speed taken out r = ${f1(pr, 2)}` : '') + (trendCfg().band ? ' · shaded: where the trend falls in 80% of resamples of the phases; a wide band means the line is not telling you much.' : '');
    if (r.trends.length) { const lo = Math.min(...r.trends.map(t => t.l[0][0])), hi = Math.max(...r.trends.map(t => t.l[t.l.length - 1][0])), stp = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find(s => (hi - lo) / s <= 14) || 50, xsT = []; for (let x = Math.ceil(lo / stp) * stp; x <= hi + 1e-9; x += stp) xsT.push(Math.round(x * 100) / 100);
      const rows = xsT.map(x => [{ t: f1(x, stp < 1 ? 1 : 0), c: 'b' }].concat(r.trends.map(t => x >= t.l[0][0] - 1e-9 && x <= t.l[t.l.length - 1][0] + 1e-9 ? f1(SL.lineAt(t.l, x), 2) : '')));
      tt.append(h('h4', {}, 'Trend values'), table([r.xl].concat(r.trends.map(t => r.yl + (r.trends.length > 1 ? ' · ' + t.k : '') + ' (' + t.n + ')')), rows, 'num'), bar(h('button', { onclick: () => dl('trend.csv', [[r.xl].concat(r.trends.map(t => r.yl + ' ' + t.k)).join(',')].concat(rows.map(rw => rw.map(x => typeof x === 'object' ? x.t : x).join(','))).join('\r\n')) }, 'Export trend CSV'))); } }
  const ps = phases(st.mode), key = ['TWS', 'absTWA', 'BSP', 'BSPpol%', 'VMG%', 'ΔTWA', 'abs_heel', 'Rudder_norm', 'Forestay', 'Trim', 'Leeway_norm', 'BSP-SOG'].concat(manualKeys()).filter(k => hasVar(k) && SL.sd(ps.map(p => p.v[k])) > 1e-6).slice(0, 14), sc = { col: v => v < 0 ? mix(css('--div-mid'), css('--div-lo'), -v) : mix(css('--div-mid'), css('--div-hi'), v) };
  const M = key.map(a => key.map(b2 => SL.corr(ps.map(p => p.v[a]), ps.map(p => p.v[b2]))));
  const rank = vars.filter(k => k !== st.y && !/^(Δ|BSPpol%|BSP_trg%|VMG%?$|Target_|Polar_|PolBsp|Targ|GunBsp|Cal)/.test(k)).map(k => [k, SL.corr(ps.map(p => p.v[k]), ps.map(p => p.v[st.y]))]).filter(x => fin(x[1])).sort((a, b2) => Math.abs(b2[1]) - Math.abs(a[1])).slice(0, 12);
  c.append(h('div', { class: 'cols' }, card('Correlation matrix (' + st.mode.toLowerCase() + ' phases)', table([''].concat(key), key.map((a, i) => [{ t: a, c: 'b' }].concat(key.map((b2, j) => ({ t: i === j ? '' : f1(M[i][j], 2), s: i === j ? '' : 'cursor:pointer;background:' + alpha(sc.col(M[i][j] || 0), 0.6) })))), 'num corr'), h('p', { class: 'muted' }, 'Blue: move together. Orange: move opposite. Click a cell to plot that pair. Correlation is not cause: TWS drives most channels at once, so compare within a narrow wind band.')),
    card('Strongest links with ' + st.y, table(['Channel', 'r', ''], rank.map(([k, r2]) => { const row = [k, f1(r2, 2), h('div', { class: 'rbar' }, h('i', { style: `width:${Math.abs(r2) * 100}%;background:${r2 < 0 ? css('--div-lo') : css('--div-hi')}` }))]; row._attrs = { class: 'click', onclick: () => { st.x = k; R.xy(); window.scrollTo(0, 0); } }; return row; }), 'num'))));
  $('#t-xy .corr')?.addEventListener('click', e => { const td = e.target.closest('td'); if (!td || !td.parentElement.rowIndex || !td.cellIndex) return; st.y = key[td.parentElement.rowIndex - 1]; st.x = key[td.cellIndex - 1]; if (st.x !== st.y) { R.xy(); window.scrollTo(0, 0); } });
};

/* ---------------- Polar ---------------- */
function polarRows() { const P = (!season() && A.D && A.D.P) || A.polar; if (P) return { rows: P.rows, P, src: P.src === 'file' ? 'Polar file' + (A.files.polar ? ' ' + A.files.polar : '') : 'Polar learned from this data' }; return { rows: SL.learnPolar(pool(), 0.7), src: 'Curves learned from the phases (no polar file loaded)' }; }
function drawPolar(cv, o) {
  const { rows } = polarRows(), ps = phases(), W = o.w || cv.parentElement.clientWidth || 700, H = o.h || 640, dp = window.devicePixelRatio || 1;
  cv.width = W * dp; cv.height = H * dp; cv.style.height = H + 'px'; const c = cv.getContext('2d'); c.setTransform(dp, 0, 0, dp, 0, 0); c.clearRect(0, 0, W, H); cv._hits = [];
  const tw = rows.map(r => r.tws), hide = o.hide || {}, vis = rows.filter(r => !hide[r.tws]);
  const mx = Math.max(4, ...ps.map(p => p.v.BSP).filter(fin), ...vis.flatMap(r => r.pts.map(p => p[1]))) * 1.05, R0 = Math.min(H / 2 - 26, W - 80), ox = 36, oy = H / 2, sc = R0 / mx;
  const XY = (a, b) => [ox + b * sc * Math.sin(a * SL.D2R), oy - b * sc * Math.cos(a * SL.D2R)];
  c.strokeStyle = css('--grid'); c.fillStyle = css('--muted'); c.font = '10px ' + css('--font'); c.lineWidth = 1;
  for (let r = 2; r <= mx; r += 2) { c.beginPath(); c.arc(ox, oy, r * sc, -Math.PI / 2, Math.PI / 2); c.stroke(); c.fillText(r + ' kn', ox + 3, oy - r * sc - 3); }
  for (let a = 0; a <= 180; a += 30) { const [x, y] = XY(a, mx); c.beginPath(); c.moveTo(ox, oy); c.lineTo(x, y); c.stroke(); const [lx, ly] = XY(a, mx * 1.03); c.fillText(a + '°', lx + 2, ly + 3); }
  const col = w => mix(css('--seq0'), css('--seq1'), tw.length > 1 ? 0.2 + 0.8 * (tw.indexOf(w)) / (tw.length - 1) : 1);
  for (const p of ps) { const w = nearest(tw.length ? tw : [0], p.v.TWS); if (hide[w]) continue; const [x, y] = XY(Math.abs(p.v.TWA), p.v.BSP); c.fillStyle = alpha(col(w), 0.8); c.strokeStyle = css('--surface'); c.lineWidth = 0.6; c.beginPath(); if (p.tack === 'Stbd') { c.moveTo(x, y - 4); c.lineTo(x + 3.5, y + 3); c.lineTo(x - 3.5, y + 3); c.closePath(); } else c.arc(x, y, 3, 0, 7); c.fill(); c.stroke(); cv._hits.push([x, y, ptip(p), p]); }
  for (const r of vis) { c.strokeStyle = col(r.tws); c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath(); r.pts.forEach((p, i) => { const [x, y] = XY(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); const lp = r.pts.reduce((b, p) => Math.abs(p[0] - 100) < Math.abs(b[0] - 100) ? p : b), [x, y] = XY(lp[0], lp[1]); c.fillStyle = css('--surface'); c.beginPath(); c.roundRect(x + 3, y - 8, 20, 15, 4); c.fill(); c.fillStyle = css('--ink'); c.font = '600 10px ' + css('--font'); c.fillText(r.tws, x + 6, y + 3); for (const t of [r.up, r.dn]) if (t && t.twa) { const [tx, ty] = XY(t.twa, t.bsp); c.fillStyle = col(r.tws); c.strokeStyle = css('--ink'); c.lineWidth = 1; c.beginPath(); c.rect(tx - 4, ty - 4, 8, 8); c.fill(); c.stroke(); } }
  return { tw, col };
}
R.polar = () => {
  const c = pane('polar'), st = A.pol = A.pol || { hide: {} }, cv = h('canvas'), { rows, src, P } = polarRows();
  const leg = h('div', { class: 'legend noprint' }), wrap = h('div', {}, cv);
  const tg = rows.filter(r => r.up).map(r => [{ t: r.tws, c: 'b' }, f1(r.up.twa), f1(r.up.bsp, 2), f1(r.up.vmg, 2), f1(r.dn.twa), f1(r.dn.bsp, 2), f1(r.dn.vmg, 2)]);
  c.append(h('div', { class: 'polgrid' }, card('Polar and phases', bar(filterBar(() => R.polar()), h('button', { onclick: () => { rows.forEach(r => st.hide[r.tws] = false); R.polar(); } }, 'Show all'), h('button', { onclick: () => { rows.forEach(r => st.hide[r.tws] = true); R.polar(); } }, 'Hide all')), h('p', { class: 'muted' }, src + '. Points are phases, coloured by the nearest TWS curve (circle port, triangle starboard); squares are targets. Click a TWS to show or hide it.'), leg, wrap),
    card('Targets', tg.length ? table(['TWS', 'Up TWA', 'Up BSP', 'Up VMG', 'Dn TWA', 'Dn BSP', 'Dn VMG'], tg, 'num') : h('p', { class: 'muted' }, 'Load a polar file to see its targets.'), P ? bar(h('button', { onclick: () => dl('polar_export.txt', SL.polarText(P.rows)) }, 'Export polar (Expedition format)')) : null)));
  const draw = () => { const r = drawPolar(cv, { hide: st.hide }); leg.textContent = ''; r.tw.forEach(w => leg.append(h('button', { class: 'lg' + (st.hide[w] ? ' off' : ''), onclick: () => { st.hide[w] = !st.hide[w]; draw(); } }, h('i', { style: 'background:' + r.col(w) }), 'TWS ' + w))); }; draw();
};
