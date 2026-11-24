'use strict';
const CalibrationPlots = (() => {
  function render(container, diagnostic, view = {}) {
    const speed = diagnostic.kind === 'speed';
    const variable = speed ? 'SOG − BSP' : 'HDG − COG';
    const unit = speed ? 'kn' : '°';
    const signed = value => {
      if (!fin(value)) return '—';
      const rounded = Number(value.toFixed(speed ? 2 : 1));
      return (rounded > 0 ? '+' : '') + rounded.toLocaleString('nl-NL', {
        minimumFractionDigits: speed ? 2 : 1, maximumFractionDigits: speed ? 2 : 1
      });
    };
    const side = value => ({Port:'BB', Stbd:'SB', Starboard:'SB'})[value] || value || '—';
    const rows = diagnostic.rows.filter(r => fin(r.t) && (fin(r.raw) || fin(r.corrected)));
    const source = value => ({model:'Stroommodel', manual:'Handmatig', logged:'Gelogde stroom'})[value] || value || '';
    const axes = speed
      ? [{key:'bsp', label:'BSP (kn)'}, {key:'t', label:'Sessietijd'}]
      : [{key:'heading', label:'Heading (°)'}, {key:'t', label:'Sessietijd'}];
    const heelAxis = {key:'heel', label:'Helling (°)'};
    if (!speed && rows.some(r => fin(r.heel))) axes.push(heelAxis);
    const correctedCount = rows.filter(r => fin(r.corrected)).length;
    const rawCount = rows.filter(r => fin(r.raw)).length;
    const panel = card(variable + ' per referentievenster');
    panel.id = 'cal-delta-' + diagnostic.kind;
    container.append(panel);
    if (diagnostic.reference) panel.append(h('p', {class:'muted'}, diagnostic.reference));
    if (diagnostic.issue) panel.append(h('p', {role:'status'}, diagnostic.issue));
    if (!rows.length) {
      if (!diagnostic.issue) panel.append(h('p', {}, 'Keur een stabiele fase of een manoeuvrepaar met ' + variable.replace(' − ', ' en ') + ' goed voor kalibratie.'));
      return panel;
    }
    const charts = h('div', speed ? {
      style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px'
    } : {});
    function makeChart() {
      const title = h('h4', {hidden:!speed});
      const canvas = h('canvas', {role:'img'});
      const empty = h('p', {class:'muted', hidden:true});
      charts.append(h('div', {style:'min-width:0'}, title, canvas, empty));
      return {title, canvas, empty};
    }
    const mainChart = makeChart();
    const heelChart = speed ? makeChart() : null;
    const controls = h('div', {class:'legend', role:'group', 'aria-label':'Zichtbare reeksen'});
    const sets = [
      {key:'raw', label:'Zonder stroomcorrectie', color:css('--s1'), triangle:false, count:rawCount},
      {key:'corrected', label:'Met stroomcorrectie', color:css('--s2'), triangle:true, count:correctedCount}
    ];
    const availableAxes = axes.filter(axis => rows.some(r => fin(r[axis.key])));
    const choose = key => e => { view[key] = e.target.value; draw(); };
    const axis = h('select', {'aria-label':'Horizontale as', onchange:choose('axis')},
      availableAxes.map(a => h('option', {value:a.key, selected:a.key===view.axis}, a.label)));
    const sides = [...new Set(rows.map(r => side(r.side)))].filter(s => s !== '—');
    const tack = h('select', {'aria-label':'Boeg', onchange:choose('tack')},
      h('option', {value:''}, 'Beide boegen'), sides.map(s => h('option', {value:s, selected:s===view.tack}, s)));
    const sensors = speed ? [...new Set(rows.map(r => r.sensor).filter(Boolean))] : [];
    const showSensors = sensors.some(name => name === 'Bakboord' || name === 'Stuurboord');
    const sensor = h('select', {'aria-label':'BSP-sensor', onchange:choose('sensor')}, h('option', {value:''}, 'Alle sensoren'),
      sensors.map(name => h('option', {value:name, selected:showSensors && name===view.sensor}, name)));
    const axesBar = bar(field(speed ? 'Hoofdgrafiek' : 'Horizontale as', axis), sides.length > 1 ? field('Boeg', tack) : null,
      showSensors ? field('BSP-sensor', sensor) : null);
    const status = h('p', {class:'muted', role:'status'});
    for (const set of sets) {
      set.input = h('input', {type:'checkbox', 'data-series':set.key, checked:set.count > 0 && view[set.key] !== false,
        disabled:!set.count, onchange:e=>{view[set.key]=e.target.checked;draw();}});
      const marker = h('i', {'aria-hidden':'true', class:set.triangle ? 'tri' : '',
        style: set.triangle ? 'border-bottom-color:' + set.color : 'background:' + set.color + ';border-radius:50%'});
      set.caption = h('span', {}, set.label);
      controls.append(h('label', {style:'display:inline-flex;align-items:center;gap:5px;cursor:pointer'}, set.input, marker, set.caption));
    }
    panel.append(axesBar, controls, charts, status);

    // Keep the vertical range fixed across filters so the before/after comparison uses the same scale.
    let limit = speed ? .2 : 2;
    for (const r of rows) for (const set of sets) {
      if (fin(r[set.key])) limit = Math.max(limit, Math.abs(r[set.key]) * 1.08);
    }
    function selection() {
      return rows.filter(r => (!tack.value || side(r.side) === tack.value) && (!sensor.value || r.sensor === sensor.value));
    }
    function draw() {
      const selected = selection();
      for (const set of sets) set.caption.textContent = set.label + ' (' + selected.filter(r => fin(r[set.key])).length + ')';
      const visible = sets.filter(set => set.input.checked);
      const hasValue = selected.some(r => visible.some(set => fin(r[set.key])));
      drawChart(mainChart, axes.find(a => a.key === axis.value), selected, visible);
      if (heelChart) drawChart(heelChart, heelAxis, selected, visible);
      updateTable();
      if (!hasValue) {
        status.textContent = visible.length ? 'Geen meetwaarden voor deze selectie.' : 'Selecteer een reeks om de grafiek te tonen.';
        return;
      }
      status.textContent = speed
        ? 'Boven nul leest BSP lager dan de gekozen GPS-snelheidsreferentie.'
        : 'Boven nul ligt de heading met de klok mee ten opzichte van de gekozen koersreferentie. Leeway kan bijdragen aan dit verschil.';
    }
    function drawChart(chart, dimension, selected, visible) {
      const {key:x, label} = dimension;
      const cv = chart.canvas;
      cv.dataset.axis = x;
      cv.setAttribute('aria-label', variable+' ('+unit+') tegen '+label+'. Meetwaarden staan in de venstertabel.');
      chart.title.textContent = 'Restfout tegen '+({bsp:'bootsnelheid',t:'sessietijd',heel:'helling',heading:'heading'})[x];
      const points = selected.filter(r => fin(r[x]) && visible.some(set => fin(r[set.key])));
      cv.hidden = !points.length;
      chart.empty.hidden = points.length > 0 || !visible.length || !selected.length;
      if (!points.length) {
        chart.empty.textContent = x === 'heel' ? 'Geen hellingmeting met een zichtbare restfout in deze vensters.' : 'Geen meetpunten voor deze as en reeks.';
        return;
      }
      const values = points.map(r => r[x]);
      const min = values.reduce((a,b) => Math.min(a,b)), max = values.reduce((a,b) => Math.max(a,b));
      const padding = Math.max(x === 't' ? 1000 : .2, (max-min)*.025);
      const bounds = x === 'heading' ? [0,360] : [x === 'bsp' ? Math.max(0,min-padding) : min-padding, max+padding];
      if (x === 'heel') {
        const extent = Math.max(1,Math.abs(min),Math.abs(max))+padding;
        bounds[0] = -extent;
        bounds[1] = extent;
      }
      const g = plot(cv, {h:225, pl:56, pr:22, xr:bounds, yr:[-limit, limit], xl:label, yl:variable + ' (' + unit + ')',
        xTickGap:x === 't' ? 85 : 65, xfmt:x === 't' ? t => max-min < 60000 ? tstr(t) : tstr(t).slice(0,5) : undefined});
      g.zero(0);
      for (const r of points) {
        const tip = [dstr(r.t), side(r.side), x !== 't' ? label + ' ' + f1(r[x],1) : '', showSensors && r.sensor ? 'BSP-sensor '+r.sensor : '', source(r.source),
          ...visible.filter(set => fin(r[set.key])).map(set => set.label + ' ' + signed(r[set.key]) + ' ' + unit)].filter(Boolean).join(' · ');
        for (const set of visible) g.dot(r[x], r[set.key], set.color, tip, null, set.triangle, set.triangle ? 3.3 : 4.6);
      }
    }
    const summary = h('summary');
    const details = h('details', {}, summary);
    function updateTable() {
      if (!details.isConnected) return;
      const selected = selection();
      summary.textContent = 'Meetwaarden per venster (' + selected.length + ')';
      if (!details.open) return;
      const additionalAxis = axes.find(a => a.key === axis.value && a.key !== 't');
      const showHeel = speed && selected.some(r => fin(r.heel));
      const hasSource = selected.some(r => r.source);
      const hasCurrent = selected.some(r => fin(r.currentSet) || fin(r.currentDrift));
      details.replaceChildren(summary, table(['Sessietijd', 'Boeg', ...(showSensors ? ['BSP-sensor'] : []), ...(additionalAxis ? [additionalAxis.label] : []), ...(showHeel ? [heelAxis.label] : []), ...(hasSource ? ['Stroombron'] : []),
        ...(hasCurrent ? ['Set (°T)', 'Drift (kn)'] : []), 'Zonder stroomcorrectie (' + unit + ')', 'Met stroomcorrectie (' + unit + ')'],
        selected.map(r => [dstr(r.t), side(r.side), ...(showSensors ? [r.sensor || '—'] : []), ...(additionalAxis ? [f1(r[axis.value],1)] : []), ...(showHeel ? [f1(r.heel,1)] : []),
          ...(hasSource ? [source(r.source) || '—'] : []), ...(hasCurrent ? [f1(r.currentSet,0), f1(r.currentDrift,2)] : []), signed(r.raw), signed(r.corrected)])));
    }
    details.addEventListener('toggle', updateTable);
    panel.append(details);
    draw();
    return panel;
  }
  return {render};
})();
