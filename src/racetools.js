'use strict';
const RaceTools = (() => {
  const action = (label, run) => h('button', {type:'button', onclick:run}, label);
  const time = (D,i) => D.raw.t0 + i * 1000;
  function suggest(D,m,s) {
    const base=SL.defaultPair(D,m), rules=s.phaseBuild?.rules||D.cfg;
    const length=Math.max(15,Math.min(60,rules.phaseLen||30))*1000;
    const sides=['before','after'].map(side=>{
      const candidates=[];
      for(let gap=side==='before'?Math.max(5,rules.manBefore||0):Math.max(5,rules.manAfter||0);gap<=150;gap+=5){
        const start=side==='before'?base.anchor-gap*1000-length:base.anchor+gap*1000;
        const range={start,end:start+length};
        const check=SL.inspectPair(D,{...base,[side]:range},rules);
        const w=check[side],prefix=side==='before'?'Vóór:':'Na:';
        if(!w||w.race!==D.L.race[m.i]||!['BSP','TWA','TWS'].every(k=>w.coverage[k]>=.95)||check.errors.some(e=>e.startsWith(prefix)))continue;
        if(D.mans.some(other=>other!==m && time(D,other.i)>Math.min(start,base.anchor)&&time(D,other.i)<Math.max(range.end,base.anchor)))continue;
        candidates.push({range,w});
      }
      return candidates;
    });
    for(const before of sides[0])for(const after of sides[1]){
      if(before.w.tack===after.w.tack||before.w.sails!==after.w.sails)continue;
      const pair={...base,before:before.range,after:after.range};
      if(SL.inspectPair(D,pair,rules).valid)return {...pair,suggested:true};
    }
    return base;
  }

  function turnControls(c) {
    const D=A.D,s=WF.session;
    const choose=sel('turn-source',['',...D.mans.map(m=>SL.pairKey(D,m))],'',()=>{});
    Array.from(choose.options).forEach((o,i)=>o.textContent=i?D.mans[i-1].type+' '+tstr(iT(D.mans[i-1].i)):'Nieuwe manoeuvre');
    const edit=type=>{
      const m=D.mans.find(x=>SL.pairKey(D,x)===choose.value);
      if(!type&&!m)return banner('Selecteer eerst de te verplaatsen manoeuvre.',true);
      if(D.mans.some(x=>x!==m&&Math.abs(x.i-A.cur)<5))return banner('Er ligt al een manoeuvre op deze plek.',true);
      const edits=SL.copy(s.turnEdits||[]),t=iT(A.cur);
      const existing=m&&edits.find(x=>x.time===iT(m.i)&&x.type===m.type);
      if(existing)existing.time=t;
      else edits.push({original:m?iT(m.i):null,time:t,type:m?.type||type});
      const old=s.turnEdits;s.turnEdits=edits;
      if(!WF.recompute()){s.turnEdits=old;return;}
      (s.turnUndo||=[]).push(old||[]);
      s.activePairKey=(m?.type||type)+':'+t;WF.touch();show('events');
    };
    c.append(card('Manoeuvre bij kaart- of tijdcursor',bar(action('Tack toevoegen',()=>{choose.value='';edit('Tack');}),action('Gybe toevoegen',()=>{choose.value='';edit('Gybe');}),field('Bestaande manoeuvre',choose),action('Draaipunt naar cursor',()=>edit(null))),action('Laatste draaipuntwijziging herstellen',()=>{
      if(!s.turnEdits?.length)return;
      s.turnEdits=s.turnUndo?.pop()||s.turnEdits.slice(0,-1);WF.recompute();show('events');
    })));
  }

  function pairMetrics(a,b,vmgToVmg=true){
    return [vmgToVmg ? Math.abs(b.v.AWA)-Math.abs(a.v.AWA) : NaN,vmgToVmg ? Math.abs(b.v.TWA)-Math.abs(a.v.TWA) : NaN,SL.w180(b.v.TWD-a.v.TWD)];
  }
  function review(c,pair,check,compact=false){
    const D=A.D,s=WF.session;
    const panel=card('Vensters rond het draaipunt',h('p',{},'Sleep een vensterrand in een grafiek om het begin of einde te verplaatsen. Blauw is vóór de manoeuvre, groen is erna.'));
    c.append(panel);
    const center=(pair.anchor-D.raw.t0)/1000;
    const lo=Math.max(D.i0,Math.min(center-120,(pair.before.start-D.raw.t0)/1000-5));
    const hi=Math.min(D.i1,Math.max(center+120,(pair.after.end-D.raw.t0)/1000+5));
    for(const k of (compact?[]:['BSP','AWA','TWD','Heel'])){
      const values=D.ch[k];if(!values)continue;
      const cv=h('canvas',{'aria-label':k+' rond manoeuvre',style:'touch-action:none'});
      panel.append(cv);
      const ref=SL.cmean(values.subarray(lo,hi)),wrap=k==='TWD'&&fin(ref);
      const pts=Array.from(values.subarray(lo,hi),(v,i)=>[lo+i,wrap?ref+SL.w180(v-ref):v]);
      const ys=pts.map(x=>x[1]).filter(fin);if(!ys.length)continue;
      const p=plot(cv,{xr:[lo,hi],yr:[SL.quant(ys,0)-.2,SL.quant(ys,1)+.2],h:125,pl:60,yl:k,xfmt:i=>String(Math.round(i-center)),xTickGap:120});
      const edges=[];
      for(const side of ['before','after']){
        const bounds=pair[side],x=edge=>p.X((bounds[edge]-D.raw.t0)/1000);
        p.c.fillStyle=alpha(css(side==='before'?'--s1':'--s3'),.18);
        p.c.fillRect(x('start'),p.pt,x('end')-x('start'),p.H-p.pt-p.pb);
        for(const edge of ['start','end'])edges.push({side,edge,x:x(edge)});
      }
      p.line(pts,css('--s1'));
      let active;
      cv.onpointerdown=e=>{active=edges.find(q=>Math.abs(q.x-e.offsetX)<=12);if(active)cv.setPointerCapture(e.pointerId);};
      cv.onpointerup=e=>{
        if(!active)return;
        const i=Math.round(lo+(e.offsetX-p.pl)*(hi-lo)/(p.W-p.pl-p.pr));
        const next={...pair[active.side],[active.edge]:time(D,i)};
        if(!SL.windowPhase(D,next)||(active.side==='before'?next.end>pair.anchor-5000:next.start<pair.anchor+5000))return banner('Houd minimaal 5 s vensterlengte en afstand tot het draaipunt.',true);
        pair[active.side]=next;pair.approved=false;pair.validation=false;WF.touch();show('pairreview');
      };
    }
    if(check.before&&check.after)panel.append(table(['Δ |AWA|','Δ |TWA|','TWD-sprong na − vóór'],[pairMetrics(check.before,check.after).map(x=>f1(x,2)+'°')]));
    panel.append(action(pair.validation?'Vrijgeven voor model':'Apart houden voor controle',()=>{
      if(!pair.validation&&!check.valid)return banner('Kies eerst twee bruikbare vensters.',true);
      pair.validation=!pair.validation;pair.approved=pair.validation;pair.rejected=false;WF.touch();show('pairreview');
    }));
    nativePanel(panel,D,center);
  }

  function calibration(c,model,s,section){
    const D=A.D,all=SL.approvedPairs(D,s),groups=new Map();
    if(section==='wind'){
      for(const {before,after,pair} of all){
        if(pair.validation)continue;
        const band=2*Math.floor((before.v.TWS+after.v.TWS)/4);
        const key=[pair.type,before.sails,band+'–'+(band+2)+' kn',before.tack+' → '+after.tack].join(' · ');
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(pairMetrics(before,after,pair.vmgToVmg));
      }
      const reserved=all.filter(x=>x.pair.validation);
      const panel=card('Wind over de manoeuvre',table(['Manoeuvre · zeil · TWS · richting','Paren','Mediaan Δ |AWA|','Mediaan Δ |TWA|','Mediaan Δ TWD'],Array.from(groups,([k,g])=>[k,g.length,...[0,1,2].map(i=>f1(SL.median(g.map(row=>row[i])),2)+'°')])));
      c.append(panel);
      if(reserved.length){
        const result=h('div');panel.append(action('Toets voorstel op aparte manoeuvres',()=>{
          try{
            const next=WF.process(WF.snapshot(),s.draft);
            result.replaceChildren(table(['Controlepaar','|Δ TWD| actief','|Δ TWD| voorstel','|Δ abs(AWA)| actief','|Δ abs(AWA)| voorstel'],reserved.map(({pair,before,after})=>{
              const a=SL.windowPhase(next,pair.before),b=SL.windowPhase(next,pair.after);
              const old=pairMetrics(before,after,pair.vmgToVmg),v=pairMetrics(a,b,pair.vmgToVmg);
              return [tstr(pair.anchor),...[old[2],v[2],old[0],v[0]].map(n=>f1(Math.abs(n),2)+'°')];
            })));
          }catch(e){banner(e.message,true);}
        }),result);
      }else panel.append(h('p',{},'Houd bij manoeuvreparen enkele tacks of gybes apart om het voorstel op andere meetvensters te toetsen.'));
      return;
    }
    const comparison=h('details',{open:!!s.speedoChannel},h('summary',{},'Extra snelheidskanaal vergelijken'));c.append(comparison);
    const channels=Object.keys(D.ch).filter(k=>!['BSP','SOG'].includes(k)).sort();
    const sensor=sel('comparison-speedo',['',...channels],s.speedoChannel||'',key=>{
      s.speedoChannel=key;WF.touch();show('cal');
    });
    comparison.append(card('BSP-sensor vergelijken',field('Extra snelheidskanaal (kn)',sensor),
      h('p',{},'Gebruik een kanaal in knopen. Beide fits gebruiken dezelfde tijdvakken en het gelogde koersreferentiekanaal.')));
    if(s.speedoChannel && D.ch[s.speedoChannel]){
      const refs=SL.calibrationReferences(D,s).phases.filter(p=>fin(p.v[s.speedoChannel])&&p.v[s.speedoChannel]>2&&p.v.BSP>2);
      const fit=key=>SL.calBsp(D,refs.map(p=>({...p,v:{...p.v,BSP:p.v[key]}})));
      const fits=['BSP',s.speedoChannel].map(key=>({key,model:fit(key)}));
      comparison.append(card('Afzonderlijke BSP-fits',table(['Sensor','Factor','90%-interval','Tijdvensters'],fits.map(({key,model:m})=>[key,m.err||f1(m.k,3),m.err?'—':f1(m.kLo,3)+' – '+f1(m.kHi,3),m.nWin||0]))));
    }
    if(model.bsp.err)return;
    const cells=new Map();
    for(const {r,p} of model.bsp.ratio){
      if(!fin(p.v.Heel))continue;
      const heel=5*Math.floor(Math.abs(p.v.Heel)/5),speed=Math.floor(p.v.BSP);
      const key=[p.tack,heel+'–'+(heel+5)+'°',speed+'–'+(speed+1)+' kn'].join(' / ');
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push((r-model.bsp.k)*p.v.BSP);
    }
    const rows=Array.from(cells,([k,vs])=>[k,vs.length,f1(SL.median(vs),2)]).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
    const speeds=[...new Set(model.bsp.ratio.filter(x=>fin(x.p.v.Heel)).map(x=>Math.floor(x.p.v.BSP)))].sort((a,b)=>a-b);
    const heelTable=[];
    for(const side of ['Port','Stbd'])for(let deg=0;deg<90;deg+=5){
      const counts=speeds.map(kn=>cells.get([side,deg+'–'+(deg+5)+'°',kn+'–'+(kn+1)+' kn'].join(' / '))||[]);
      if(counts.some(v=>v.length))heelTable.push([side,deg,...counts.map(v=>v.length>=3?f1(SL.median(v),2):'')]);
    }
    const heelHeader=['Boeg','Helling vanaf (°)',...speeds.map(v=>v+'–'+(v+1)+' kn')];
    c.append(card('Concept-hellingtabel (kn)',h('p',{},'Additieve BSP-restcorrectie na de globale factor, per boeg en absolute helling. Lege cellen hebben minder dan drie referenties. Controleer de asindeling van het instrument vóór overname.'),table(heelHeader,heelTable),action('Download hellingtabel CSV',()=>dl('SailLens-heel-table.csv',[heelHeader,...heelTable].map(r=>r.join(';')).join('\n')))));
    const cv=h('canvas');const head=['Boeg / helling / BSP','Fases','Restcorrectie kn'];
    c.append(card('BSP na globale factor en stroomcorrectie',h('p',{},'Positief betekent dat BSP na de globale correctie te laag ligt. Elke rij bevat gemeten fases. Pijlen tonen geschatte stroomrichting en sterkte (40 pixels per knoop).'),cv,table(head,rows),action('Exporteer bezette cellen (CSV)',()=>dl('BSP-restcorrecties.csv',[head,...rows].map(r=>r.join(';')).join('\n')))));
    const geo=drawMap(cv,{v:'BSP',h:300});if(!geo)return;
    const ctx=cv.getContext('2d');
    for(const w of model.bsp.cur){
      const i=Math.round((w.t-D.raw.t0)/1000),x=geo.X(i),y=geo.Y(i);
      if(!fin(x)||!fin(y))continue;
      const a=w.dir*Math.PI/180,l=40*w.rate;
      ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle=css('--ink');ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-l);ctx.lineTo(-3,-l+5);ctx.moveTo(0,-l);ctx.lineTo(3,-l+5);ctx.stroke();ctx.restore();
    }
  }

  function compareSlow(r){
    const D=A.D,s=WF.session,a=SL.windowPhase(D,r);
    if(!a)return;
    const matches=WF.filteredPhases(D.phases).filter(p=>p.sails===a.sails&&p.tack===a.tack&&p.mode===a.mode&&(time(D,p.i1)<=r.start||p.t>=r.end)&&Math.abs(p.v.TWS-a.v.TWS)<=2&&Math.abs(Math.abs(p.v.TWA)-Math.abs(a.v.TWA))<=8&&p.v.BSP>a.v.BSP&&p.v['BSPpol%']>a.v['BSPpol%']);
    matches.sort((p,q)=>score(p)-score(q));
    function score(p){return Math.abs(p.v.TWS-a.v.TWS)/2+Math.abs(Math.abs(p.v.TWA)-Math.abs(a.v.TWA))/8;}
    s.selections.A={start:r.start,end:r.end};
    const best=matches[0];
    s.selections.B=best?{start:best.t,end:time(D,best.i1)}:null;
    s.viewport=[Math.max(D.i0,a.i-20),Math.min(D.i1,a.i1+20)];
    A.cur=a.i;WF.touch();show('analysis');
    banner(best?'Vergelijk A / B toont het langzame stuk en de best passende snellere fase.':'Geen snellere fase binnen 2 kn TWS en 8° TWA op dezelfde boeg, met hetzelfde zeil en dezelfde vaarmodus.');
    document.querySelector('#t-analysis .compare-reference')?.scrollIntoView?.({block:'center'});
  }

  function nativePanel(panel,D,center){
    const sources=WF.session.sources.filter(src=>src.kind==='log');
    if(!sources.length)return;
    const channels=[...new Set(sources.flatMap(src=>src.channels||[]))];
    if(!channels.length)return;
    const picker=sel('native-channel',channels,channels.includes('BSP')?'BSP':channels[0],()=>{});
    const result=h('div');
    panel.append(field('Oorspronkelijk logkanaal',picker),action('Bekijk originele samples',()=>{
      const start=time(D,center-45),end=time(D,center+60);
      const points=sources.flatMap(src=>SL.parseLog(src.text,{start,end,channel:picker.value})).sort((a,b)=>a[0]-b[0]);
      result.replaceChildren();
      if(!points.length){result.append('Geen gelogde samples voor dit kanaal.');return;}
      const cv=h('canvas'),ys=points.map(x=>x[1]);
      result.append(h('p',{},points.length+' gelogde samples · '+picker.value+' · oorspronkelijke waarden'),cv);
      const p=plot(cv,{xr:[-45,60],yr:[SL.quant(ys,0)-.1,SL.quant(ys,1)+.1],h:180,xl:'Seconden rond manoeuvre',yl:picker.value});
      const speeds=points.map(pt=>pt[1]);
      const intervals=points.slice(1).map((pt,i)=>pt[0]-points[i][0]).filter(dt=>dt>0);
      result.append(table(['Mediaan sample-interval (ms)','Minimum','Maximum'],[[f1(SL.median(intervals),1),f1(SL.quant(speeds,0),2),f1(SL.quant(speeds,1),2)]]));
      for(const [t,v] of points)p.dot((t-time(D,center))/1000,v,css('--s1'),null,null,false,1.5);
    }),result);
  }

  function geometry(line,lat,lon,cog,sog){
    if(![lat,lon,...line].every(fin))return null;
    const [lat1,lon1,lat2,lon2]=line,k=111195,scale=k*Math.cos(lat1*Math.PI/180);
    const dx=SL.w180(lon2-lon1)*scale,dy=(lat2-lat1)*k,L=Math.hypot(dx,dy);
    if(L<1)return null;
    const x=SL.w180(lon-lon1)*scale,y=(lat-lat1)*k;
    const along=(x*dx+y*dy)/(L*L),u=Math.max(0,Math.min(1,along));
    const distance=Math.hypot(x-u*dx,y-u*dy),vx=sog*.514444*Math.sin(cog*Math.PI/180),vy=sog*.514444*Math.cos(cog*Math.PI/180);
    const det=vx*dy-vy*dx,eta=(y*dx-x*dy)/det,where=((x+eta*vx)*dx+(y+eta*vy)*dy)/(L*L);
    return {distance,eta:Math.abs(det)>1e-6&&eta>=0&&where>=0&&where<=1?eta:NaN};
  }
  function startLine(c,D,start){
    const s=WF.session,key=String(time(D,start.i)),line=s.startLines?.[key];
    const inputs=['Comitéboot lat','Comitéboot lon','Pin lat','Pin lon'].map((label,i)=>h('input',{type:'number',step:'any','aria-label':label,placeholder:label,value:line?.[i]??''}));
    const block=card('Startlijn race '+start.race,bar(...inputs,action('Bewaar startlijn',()=>{
      const coords=inputs.map(el=>el.value.trim()?Number(el.value):NaN);
      if(coords.some((x,i)=>!fin(x)||Math.abs(x)>(i%2?180:90))||!geometry(coords,coords[0],coords[1],0,0))return banner('Geef twee verschillende geldige eindpunten in decimale graden.',true);
      (s.startLines||={})[key]=coords;WF.touch();show('prestart');
    })));
    c.append(block);
    if(!line)return;
    const rows=[];
    for(const offset of [-120,-60,-30,-10,0]){
      const i=start.i+offset;
      if(i<D.i0)continue;
      const v=geometry(line,D.ch.Lat?.[i],D.ch.Lon?.[i],D.ch.COG?.[i],D.ch.SOG?.[i]);
      rows.push([offset+' s',v?f1(v.distance,1):'—',v&&fin(v.eta)?f1(v.eta,1):'—']);
    }
    block.append(table(['T.o.v. schot','Afstand tot lijnsegment (m)','Tijd tot lijn op huidige COG/SOG (s)'],rows));
  }
  return {suggest,review,turnControls,calibration,compareSlow,startLine,geometry};
})();
