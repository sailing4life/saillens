'use strict';
const WindPlots = (() => {
  const fmt=(v,d=1)=>fin(v)?v.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const deg=v=>fin(v)?fmt(v)+'°':'—';
  const signed=v=>fin(v)?(v>=.05?'+':'')+deg(v):'—';
  const sailLabel=s=>s&&s!=='-'?s:'Onbekend zeil';
  const pageSize=7;

  function barChart(grid,type,pairs,key,series,limit,onOpenPair) {
    const rows=pairs.filter(p=>p.type===type&&fin(p[series][key]));
    const fit=rows.filter(p=>!p.validation).map(p=>p[series][key]);
    const median=SL.median(fit), title=type==='Tack'?'Tacks':'Gijpen';
    const frame=h('section',{class:'windplot-frame'},h('h4',{},title+' · '+(key==='TWD'?'ΔTWD':'Δ|'+key+'|')));
    grid.append(frame);
    if(!rows.length){frame.append(h('p',{class:'muted'},'Geen '+title.toLowerCase()+' met bruikbare '+key+' in deze selectie.'));return;}
    frame.append(h('div',{class:'windplot-meta'},'Mediaan '+signed(median)+' · '+fit.length+' paren (excl. controle)'));
    const bars=h('div',{class:'windplot-bars'}),pager=h('div',{class:'windplot-pager'});
    frame.append(h('div',{class:'windplot-axis','aria-hidden':'true'},h('span',{class:'windplot-scale'},['−'+fmt(limit,0)+'°','0°','+'+fmt(limit,0)+'°'].map(v=>h('span',{},v)))),bars,pager);
    let page=0;
    function display(){
      const start=page*pageSize;
      bars.replaceChildren();
      for(const row of rows.slice(start,start+pageSize)){
        const value=row[series][key],fraction=50*value/limit;
        const description=title+' · '+dstr(row.t)+' · '+sailLabel(row.sail)+' · '+signed(value)+(row.validation?' · Controlepaar':'');
        const attrs={class:'windplot-row',title:description,'aria-label':description+(onOpenPair?' · Open paar':'')};
        const track=h('span',{class:'windplot-track','aria-hidden':'true'},
          h('span',{class:'windplot-bar',style:'left:'+Math.min(50,50+fraction)+'%;width:'+Math.abs(fraction)+'%;background:var('+(value<0?'--stbd':'--port')+')'}),
          fin(median)?h('i',{class:'windplot-median',style:'left:'+(50+50*median/limit)+'%'}):null);
        bars.append(h(onOpenPair?'button':'div',onOpenPair?{...attrs,type:'button',onclick:()=>onOpenPair(row.key)}:attrs,
          h('span',{},tstr(row.t)+(row.validation?' *':'')),track,h('span',{},signed(value))));
      }
      pager.replaceChildren();
      if(rows.length>pageSize){
        const move=(label,offset,disabled)=>h('button',{type:'button',disabled,'aria-label':label+' '+title.toLowerCase(),
          onclick:()=>{page+=offset;display();}},label);
        pager.append(move('Vorige',-1,page===0),h('span',{'aria-live':'polite'},(start+1)+'–'+Math.min(rows.length,start+pageSize)+' van '+rows.length),move('Volgende',1,start+pageSize>=rows.length));
      }
    }
    display();
  }

  function scatter(grid,mode,phases,channel,series,xr,colorBySail,colorForSail){
    const points=phases.filter(p=>p.mode===mode&&fin(p[series].TWS)&&fin(p[series][channel]));
    const heading=(mode==='up'?'Aandewindse':'Voor-de-windse')+' fases · |'+channel+'|';
    const frame=h('section',{class:'windplot-frame'},h('h4',{},heading));
    grid.append(frame);
    if(!points.length){frame.append(h('p',{class:'muted'},'Geen fases met bruikbare '+channel+' en TWS in deze selectie.'));return;}
    const canvas=h('canvas',{role:'img','aria-label':heading+' tegen TWS. Waarden staan in de fasetabel hieronder.'});
    frame.append(canvas);
    const angle=p=>p[series][channel];
    const yr=[Math.max(0,Math.floor(SL.quant(points.map(angle),0))-2),Math.min(180,Math.ceil(SL.quant(points.map(angle),1))+2)];
    const groups=new Map();
    for(const p of points){
      const k=JSON.stringify([p.sail,p.side]);
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(p);
    }
    const tint=p=>colorBySail?colorForSail(p.sail):css(p.side==='Port'?'--port':'--stbd');
    const fits=[];
    for(const group of groups.values()){
      if(group.length<4)continue;
      const xs=group.map(p=>p[series].TWS);
      if(SL.quant(xs,1)-SL.quant(xs,0)<1||new Set(xs).size<3)continue;
      fits.push([SL.fitTrend(xs,group.map(angle),'Straight line',2),tint(group[0]),group[0].side]);
    }
    function paint(){
      const g=plot(canvas,{w:canvas.clientWidth||undefined,h:183,xr,yr,xl:'TWS (kn)',yl:'|'+channel+'| (°)',pl:47,xTickGap:55});
      for(const [line,color,tack] of fits){
        g.c.setLineDash(colorBySail&&tack==='Stbd'?[4,3]:[]);
        g.line(line,color,1.4);
      }
      g.c.setLineDash([]);
      for(const p of points)g.dot(p[series].TWS,angle(p),tint(p),
        [dstr(p.t),sailLabel(p.sail),p.side==='Port'?'BB':'SB',fmt(p[series].TWS)+' kn',deg(angle(p))].join(' · '),null,p.side==='Stbd',3);
    }
    paint();
    if(typeof ResizeObserver==='function'){
      let width=frame.clientWidth;
      const observer=new ResizeObserver(()=>{
        if(!frame.isConnected){observer.disconnect();return;}
        if(frame.clientWidth>0&&frame.clientWidth!==width){width=frame.clientWidth;paint();}
      });
      observer.observe(frame);
    }
  }

  function expandable(parent,label,head,rows,toCells){
    const summary=h('summary',{},label+' ('+rows.length+')'),details=h('details',{},summary);
    parent.append(details);
    details.addEventListener('toggle',()=>{
      if(!details.open||details.childElementCount>1)return;
      details.append(table(head,rows.map(toCells)));
    });
  }

  function render(container,data,view={},onOpenPair=null,onSelectionChange=null){
    const mhu=data.kind==='mhu',id='windplot-'+(mhu?'mhu':'twa');
    const panel=card(mhu?'MHU-symmetrie':'TWA en TWD per boeg');
    panel.classList.add('windplot-panel');panel.id=id;container.append(panel);
    const controls=h('div',{class:'form'}),note=h('p',{class:'muted'}),plots=h('div');
    panel.append(controls,note,plots);
    const changed=(k,value)=>{view[k]=value;draw();};
    const select=(k,label,values,chosen)=>{
      const s=h('select',{id:id+'-'+k,onchange:e=>changed(k,e.target.value)},values.map(([value,text])=>h('option',{value,selected:value===chosen},text)));
      controls.append(field(label,s));return s;
    };
    if(!data.pairs.length&&!data.phases.length)panel.append(h('p',{class:'muted'},'Keur stabiele fases en vensters vóór en na een tack of gijp goed voor kalibratie.'));
    const channels=['AWA','TWA','MWA'].filter(k=>data.channels.includes(k));
    const method=data.hasTackAngles?select('method','Methode',[['wind','TWD-sprong per boeg'],['angles','Overstaghoek en windas']],view.method||'wind'):null;
    const angle=mhu?select('channel','Windhoek',(channels.length?channels:['AWA']).map(k=>[k,k]),view.channel||channels[0]):null;
    const series=select('series','Kalibratie',data.hasProposal?[['active','Actief'],['proposed','Voorstel']]:[['active','Actief']],view.series||(data.hasProposal?'proposed':'active'));
    const sails=[...new Set([...data.phases,...data.pairs].map(p=>p.sail))].sort((a,b)=>sailLabel(a).localeCompare(sailLabel(b),'nl'));
    const sail=select('sail','Zeilset',[['','Alle zeilsets'],...sails.map(s=>[s,sailLabel(s)])],view.sail||'');
    function bound(k,label){
      const input=h('input',{type:'number',id:id+'-'+k,min:0,step:'any',placeholder:'Vrij',value:view[k]??'',
        oninput:e=>changed(k,e.target.value===''?null:e.target.valueAsNumber)});
      controls.append(field(label,input));return input;
    }
    const lo=bound('min','Actieve TWS vanaf (kn)'),hi=bound('max','Actieve TWS t/m (kn)');
    const color=select('color','Puntkleur',[['side','Boeg'],['sail','Zeilset']],view.color||'side');
    const checks=h('input',{type:'checkbox',id:id+'-validation',checked:view.validation,onchange:e=>changed('validation',e.target.checked)});
    if(data.pairs.some(p=>p.validation))controls.append(field('Toon controleparen (*)',checks));
    function draw(){
      const channel=mhu?angle.value:'TWA',metric=mhu?channel:'TWD',version=series.value;
      const tackMode=method?.value==='angles';
      plots.hidden=tackMode;
      color.closest('label').hidden=tackMode;
      const minTws=lo.value===''?null:lo.valueAsNumber,maxTws=hi.value===''?null:hi.valueAsNumber;
      const invalid=!lo.validity.valid||!hi.validity.valid||(minTws!==null&&maxTws!==null&&minTws>maxTws);
      function selected(p){
        return !invalid&&(!mhu||p.vmgToVmg!==false)&&(!sail.value||p.sail===sail.value)&&(minTws===null||(fin(p.tws)&&p.tws>=minTws))&&(maxTws===null||(fin(p.tws)&&p.tws<=maxTws));
      }
      const phases=data.phases.filter(selected),pairs=data.pairs.filter(selected);
      note.textContent=invalid?'Vul een geldige TWS-onder- en bovengrens in.':tackMode?
        'Vergelijk de hoogte van beide boegen met de gemeten TWA en het polartarget.':mhu?
        'Per paar: |'+channel+'| bakboord min stuurboord. Positief betekent een ruimere hoek op bakboord. Het MHU-voorstel gebruikt AWA uit aandewindse tacks.':
        'Per paar: TWD bakboord min stuurboord, via de kortste hoek. Positief betekent dat TWD op bakboord verder rechtsom ligt.';
      const display=pairs.filter(p=>!p.validation||checks.checked);
      onSelectionChange?.({pairs:pairs.filter(p=>!p.validation),visiblePairs:display,tackMode,phases,channel,sail:sail.value,minTws,maxTws,series:version});
      if(tackMode){plots.replaceChildren();return;}
      const bars=display.map(p=>Math.abs(p[version][metric])).filter(fin);
      const limit=Math.max(1,Math.ceil(bars.reduce((a,b)=>Math.max(a,b),0)));
      const grid=h('div',{class:'windplot-grid'}),legend=h('div',{class:'legend'});
      plots.replaceChildren(legend,grid);
      barChart(grid,'Tack',display,metric,version,limit,onOpenPair);
      barChart(grid,'Gybe',display,metric,version,limit,onOpenPair);
      const colorBySail=color.value==='sail';
      const sailColor=s=>css('--s'+(Math.max(0,sails.indexOf(s))%8+1));
      legend.append(h('span',{},'● Bakboord'),h('span',{},'▲ Stuurboord'));
      if(colorBySail){
        const used=new Set(phases.map(p=>p.sail));
        for(const s of sails.filter(s=>used.has(s)))legend.append(h('span',{},h('i',{style:'background:'+sailColor(s)}),sailLabel(s)));
      }else{
        legend.firstChild.style.color='var(--port)';legend.lastChild.style.color='var(--stbd)';
      }
      const xs=phases.flatMap(p=>[p.active.TWS,p.proposed.TWS]).filter(fin);
      const xr=xs.length?[Math.max(0,Math.floor(SL.quant(xs,0))-.25),Math.ceil(SL.quant(xs,1))+.25]:[0,1];
      scatter(grid,'up',phases,channel,version,xr,colorBySail,sailColor);
      scatter(grid,'dn',phases,channel,version,xr,colorBySail,sailColor);
      if(display.length||xs.length)plots.append(h('p',{class:'muted'},'Streeplijn = mediaan zonder controleparen. Fasetrends per zeilset en boeg vanaf vier vensters en 1 kn TWS-spreiding.'));
      if(display.length){
        const cols=['Tijd','Manoeuvre','Gebruik','Zeilset','TWS (kn)',...(mhu?[]:['TWD BB','TWD SB']),'Δ actief',...(data.hasProposal?['Δ voorstel']:[]),''];
        expandable(plots,'Meetwaarden per manoeuvrepaar',cols,display,p=>[tstr(p.t),p.type,p.validation?'Controle':p.tableEligible===false?'Diagnostisch':'Kalibratie',sailLabel(p.sail),fmt(p.tws),
          ...(mhu?[]:[deg(p[version].portTWD),deg(p[version].stbdTWD)]),signed(p.active[metric]),...(data.hasProposal?[signed(p.proposed[metric])]:[]),
          onOpenPair?h('button',{type:'button',onclick:()=>onOpenPair(p.key),'aria-label':'Open paar '+tstr(p.t)},'Open paar'):'']);
      }
      if(phases.length)expandable(plots,'Meetwaarden per fase',['Tijd','Koers','Boeg','Zeilset','TWS actief (kn)',...(data.hasProposal?['TWS voorstel (kn)']:[]),'|'+channel+'| actief',...(data.hasProposal?['|'+channel+'| voorstel']:[])],
        phases,p=>[tstr(p.t),p.mode==='up'?'Aandewinds':'Voor de wind',p.side==='Port'?'BB':'SB',sailLabel(p.sail),fmt(p.active.TWS),...(data.hasProposal?[fmt(p.proposed.TWS)]:[]),deg(p.active[channel]),...(data.hasProposal?[deg(p.proposed[channel])]:[])]);
    }
    draw();
    return panel;
  }
  return {render};
})();
