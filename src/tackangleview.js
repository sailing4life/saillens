'use strict';
(() => {
  const sources=[['HDG','HDG · boegrichting'],['Course','Course · door het water'],['COG','COG · over de grond']];
  const windSources={log:'Logkanaal',manual:'Handmatige invoer',formula:'Sessieformule',derived:'HDG + TWA',mixed:'Gemengde herkomst',unknown:'Onbekend',missing:'—'};
  const degrees=new Intl.NumberFormat('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1});
  function deg(value,signed=false){
    if(!Number.isFinite(value))return '—';
    const rounded=Math.round(Math.abs(value)*10)/10;
    const sign=rounded===0?'':value<0?'−':signed?'+':'';
    return sign+degrees.format(rounded)+'°';
  }
  function medianCell(metrics,pick,signed=false){
    const values=metrics.map(pick).filter(Number.isFinite);
    if(!values.length)return '—';
    const coverage=values.length<metrics.length?' ('+values.length+'/'+metrics.length+')':'';
    return deg(SL.median(values),signed)+coverage;
  }
  function directionLabel(row){
    return row.direction==='Port → Stbd'?'BB → SB':row.direction==='Stbd → Port'?'SB → BB':row.direction||'';
  }
  function tackLink(row,openPair){
    const time=tstr(row.t),direction=directionLabel(row);
    const stamp=openPair?h('button',{type:'button',title:dstr(row.t)+' · '+direction,
      'aria-label':'Open tack '+time+' '+direction,onclick:()=>openPair(row.key)},time):time;
    return h('span',{},stamp,' ',h('span',{class:'muted'},direction));
  }
  function useLabel(row){
    if(row.validation)return 'Controle';
    return row.vmgToVmg===false?'Tactisch':'VMG';
  }

  function renderTackAngles(host,data,view={},openPair=null){
    const previous=host.querySelector('details'),previousSource=previous?.querySelector('[data-tack-source]')?.value;
    const series=view.series==='proposed'?'proposed':'active';
    const selected=view.visiblePairs?new Set(view.visiblePairs.map(p=>p.key)):null;
    const rows=data.rows.filter(row=>selected?selected.has(row.key):!row.validation);
    const fit=rows.filter(row=>!row.validation&&row.vmgToVmg!==false);
    const panel=card('Overstaghoek en windas');
    panel.classList.add('windplot-panel');
    host.replaceChildren(panel);
    if(!rows.length){
      panel.append(h('p',{class:'muted'},'Geen goedgekeurde aandewindse tackparen voor deze selectie. Beoordeel de stabiele vensters vóór en na een overstag in Manoeuvres of verruim de zeilset- en TWS-filters.'));
      return;
    }

    const showTargets=rows.some(r=>sources.some(([source])=>Number.isFinite(r[series][source]?.targetHalf)));
    const headers=['Koersbron','Paren','Overstaghoek','Halve hoek','Gem. |TWA|',...(showTargets?['Target |TWA|']:[]),'Δ per boeg','TWD-sluitfout'];
    const summary=sources.map(([source,label])=>{
      const metrics=fit.map(r=>r[series][source]).filter(m=>Number.isFinite(m?.angle));
      return [label,metrics.length,medianCell(metrics,m=>m.angle),medianCell(metrics,m=>m.angle/2),
        medianCell(metrics,m=>m.twaSum/2),...(showTargets?[medianCell(metrics,m=>m.targetHalf)]:[]),
        medianCell(metrics,m=>m.halfResidual,true),medianCell(metrics,m=>m.closure)];
    });
    const version=series==='proposed'?'voorstel':'actieve kalibratie';
    const targetSources={log:'het log',file:'de bootpolar',learned:'de polar uit sessiedata'};
    const targetSource=targetSources[rows[0].targetSource];
    const targetNote=showTargets&&targetSource?' · target uit '+targetSource:'';
    panel.append(h('p',{class:'muted'},'Mediaan over VMG-naar-VMG-tacks · '+version+targetNote+'.'),table(headers,summary),
      h('p',{},'Δ per boeg = halve overstaghoek min gemiddelde |TWA| op beide boegen. Een positieve Δ betekent dat de koersbron een ruimere hoek geeft dan de getoonde TWA.'),
      h('p',{class:'muted'},'Een kleine TWD-sluitfout betekent dat koers + getekende TWA de TWD in de data goed reproduceert. Course kan al leeway uit het instrument bevatten. In COG werkt ook de stroming door.'));
    const fallback=rows.some(r=>sources.some(([source])=>r[series][source]?.twdSource==='derived'));
    const mixed=rows.some(r=>sources.some(([source])=>r[series][source]?.twdSource==='mixed'));
    if(fallback||mixed){
      const origin=fallback?'SailLens berekende TWD voor een of meer paren uit HDG + TWA.':'Een of meer paren combineren verschillende TWD-bronnen.';
      panel.append(h('p',{class:'muted'},origin+' Controleer de TWD-bron bij Windas en leeway voordat je de sluitfout interpreteert.'));
    }
    if(showTargets)panel.append(h('p',{class:'muted'},'Vergelijk de target met de halve hoek van de koersbron waarop je polar is gebaseerd.'));
    if(fit.length===0)panel.append(h('p',{class:'muted'},'De selectie bevat alleen controle- of tactische paren. Hun meetwaarden staan hieronder.'));

    const details=h('details',{open:!!previous?.open},h('summary',{},'Meetwaarden per tack ('+rows.length+')'));
    panel.append(details);
    const available=sources.filter(([source])=>rows.some(r=>r[series][source]));
    if(!available.length){
      panel.insertBefore(h('p',{class:'muted'},'Onvoldoende geldige koersmetingen op beide boegen. Controleer de kanaalkoppeling en de vensters per tack.'),details);
      details.append(table(['Tack','Gebruik','Zeilset'],rows.map(row=>[tackLink(row,openPair),useLabel(row),row.sail])));
      return;
    }
    const selectedSource=available.some(([key])=>key===previousSource)?previousSource:available[0][0];
    const select=h('select',{'data-tack-source':''},available.map(([key,label])=>h('option',{value:key,selected:key===selectedSource},label)));
    const previousMode=previous?.querySelector('[data-tack-mode]')?.value||'angles';
    const mode=h('select',{'data-tack-mode':''},[['angles','Hoogte en TWA'],['wind','Windas en leeway']].map(([key,label])=>
      h('option',{value:key,selected:key===previousMode},label)));
    const body=h('div');
    details.append(h('div',{class:'form'},field('Koersbron per tack',select),field('Tabel per tack',mode)),body,
      h('p',{class:'muted'},'De windas ligt halverwege de twee richtingen. Dat benadert TWD bij gelijke vaarhoeken en constante wind. Een winddraaiing of ongelijk sturen verschuift de as. Absolute richtingen gebruiken de ingestelde magnetische variatie.'),
      h('p',{class:'muted'},'De TWD-sluitfout is het gemiddelde absolute hoekverschil tussen TWD en koers + getekende TWA op dezelfde seconden. Als die kanalen uit dezelfde instrumentberekening komen, kan de sluitfout ook bij een kalibratiefout klein zijn.'));
    function draw(){
      const key=select.value,measurements=rows.map(row=>{
        const m=row[series][key],tack=tackLink(row,openPair);
        if(mode.value==='wind')return [tack,useLabel(row),deg(m?.port)+' / '+deg(m?.stbd),deg(m?.leewayPort,true)+' / '+deg(m?.leewayStbd,true),
          deg(m?.axis)+' / '+deg(m?.twd),deg(m?.twdDelta,true),deg(m?.closure),windSources[m?.twdSource]||'—',m?m.nPort+' / '+m.nStbd:'—'];
        return [tack,useLabel(row),row.sail,Number.isFinite(row.tws)?degrees.format(row.tws):'—',
          deg(m?.angle),deg(m?.twaPort,true)+' / '+deg(m?.twaStbd,true),...(showTargets?[deg(m?.targetHalf)]:[]),deg(m?.halfResidual,true)];
      });
      const columns=mode.value==='wind'?
        ['Tack','Gebruik','Koers BB / SB (°T)','Leeway BB / SB','Windas / TWD (°T)','ΔTWD BB−SB','TWD-sluitfout','Bron TWD','Seconden BB / SB']:
        ['Tack','Gebruik','Zeilset','TWS (kn)','Overstaghoek','TWA BB / SB',...(showTargets?['Target |TWA|']:[]),'Δ per boeg'];
      body.replaceChildren(table(columns,measurements));
    }
    select.addEventListener('change',draw);
    mode.addEventListener('change',draw);
    draw();
  }
  SL.renderTackAngles=renderTackAngles;
})();
