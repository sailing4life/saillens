'use strict';
const PrepDesk = (() => {
  const button=(label,on,attrs={})=>h('button',{type:'button',onclick:on,...attrs},label);
  let observer,frame,activeDialog,cleanup;
  function leave(){TrackMap.release();cleanup?.();cleanup=null;observer?.disconnect();cancelAnimationFrame(frame);activeDialog?.remove();activeDialog=null;}
  function dialog(title,body){
    activeDialog?.remove();
    const d=h('dialog',{class:'desk-dialog','aria-label':title},bar(h('h3',{},title),button('Sluiten',()=>d.remove())),body);
    document.body.append(d);activeDialog=d;
    if(d.showModal)d.showModal();else d.setAttribute('open','');
    d.addEventListener('close',()=>d.remove());
    d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.remove();}};
    return d;
  }
  const sampleCache=new WeakMap();
  function lowerBound(times,t){
    let a=0,b=times.length;
    while(a<b){const mid=Math.floor((a+b)/2);if(times[mid]<t)a=mid+1;else b=mid;}
    return a;
  }
  function loggedTraces(session,keys,t0,lo,hi,columns=Infinity){
    const traces=new Map(),mappings=new Map((session.profile.channels||[]).map(m=>[m.target,m]));
    for(const src of session.sources){
      if(src.kind!=='log'||!src.text||src.end<=t0+lo*1000||src.start>=t0+hi*1000)continue;
      const selected=keys.map(k=>({k,m:mappings.get(k)})).filter(({k,m})=>(src.channels||[]).includes(m?.source||k));
      if(!selected.length)continue;
      let cache=sampleCache.get(src);if(!cache){cache=new Map();sampleCache.set(src,cache);}
      const missing=[...new Set(selected.map(({k,m})=>m?.source||k))].filter(k=>!cache.has(k));
      if(missing.length){
        if(cache.size+missing.length>12)cache.clear();
        const wanted=selected.map(({k,m})=>m?.source||k).filter(k=>!cache.has(k));
        for(const [k,data] of SL.parseLog(src.text,{channels:[...new Set(wanted)]}))cache.set(k,data);
      }
      for(const {k,m} of selected){
        if(!traces.has(k))traces.set(k,[]);
        const {times,values}=cache.get(m?.source||k),end=lowerBound(times,t0+hi*1000);
        const start=lowerBound(times,t0+lo*1000),points=traces.get(k);
        const add=i=>points.push([(times[i]-t0)/1000,values[i]*(m?.factor??1)+(m?.offset??0)]);
        if(end-start<=columns*3){for(let i=start;i<end;i++)add(i);continue;}
        // At wide zoom retain both extremes in every screen column, never an average.
        const span=(hi-lo)*1000/columns,origin=t0+lo*1000;
        for(let i=start;i<end;){
          const boundary=origin+(Math.floor((times[i]-origin)/span)+1)*span;
          let min=i,max=i,j=i+1;
          while(j<end&&times[j]<boundary){if(values[j]<values[min])min=j;if(values[j]>values[max])max=j;j++;}
          add(min);if(max!==min)add(max);i=j;
        }
      }
    }
    return traces;
  }
  function mount(container,title,options={}){
    const D=A.D,s=WF.session,g=mapGeom(D),pair=options.pair;
    const view=s.deskMap||=( {z:1,x:0,y:0} );
    const toolbar=bar(h('h3',{},title)),side=h('section',{class:'desk-side'},toolbar);
    const map=h('canvas',{'aria-label':'GPS-track. Klik voor tijdcursor, sleep om te pannen.',class:'desk-map'});
    const strip=h('canvas',{'aria-label':'Tijdgrafiek. Klik voor tijdcursor, sleep voor een tijdvak.',class:'desk-strip'});
    const mapBox=h('div',{class:'desk-mapbox'},map),stripBox=h('div',{class:'desk-stripbox'},strip);
    const clock=h('strong'),telemetry=h('span'),rangeLabel=h('span'),status=h('div',{class:'desk-read'},clock,telemetry);
    const idx=t=>Math.round((t-D.raw.t0)/1000),clip=(v,a,b)=>Math.max(a,Math.min(b,v));
    const [lo,hi]=(s.viewport||[D.i0,D.i1]).map(v=>clip(v,D.i0,D.i1));
    const dt=Math.max(1,hi-lo),key=D.ch[s.plotVariable]?s.plotVariable:'BSP';
    let geo,bounds,chartWidth,pan,drag;

    const orient=sel('desk-orientation',['North up','Wind up'],view.bearing==null?'North up':'Wind up',v=>{
      const wind=fin(D.ch.TWD?.[A.cur])?D.ch.TWD[A.cur]:D.sum.TWD?.avg;
      if(v==='Wind up'&&!fin(wind)){orient.value='North up';return banner('Geen geldige windrichting beschikbaar.',true);}
      view.bearing=v==='Wind up'?SL.w360(wind+(D.magVar||0)):null;view.x=view.y=0;draw();WF.touch();
    });
    orient.setAttribute('aria-label','Kaartoriëntatie');
    function fit(){view.z=1;view.x=view.y=0;draw();WF.touch();}
    function zoom(mult){view.z=clip(view.z*mult,.5,80);draw();WF.touch();}
    const mapCursor=h('canvas',{class:'desk-overlay','aria-hidden':'true'}),stripCursor=h('canvas',{class:'desk-overlay','aria-hidden':'true'});
    mapBox.append(mapCursor);stripBox.append(stripCursor);
    const phaseStyles={pending:['Te beoordelen','--s1'],approved:['Goedgekeurd','--s3'],excluded:['Uitgesloten','--s2']};
    const phases=D.phases.map((p,index)=>{
      const review=s.reviews[SL.reviewKey(SL.objectRange(D,p,'phase'))];
      const state=review?.invalid?'excluded':review?.calibration?'approved':review?.reason||review?.performance===false?'excluded':'pending';
      return {i:p.i,i1:p.i1,index:index+1,obj:p,state,color:css(phaseStyles[state][1])};
    }).filter(p=>p.i<hi&&p.i1>lo);
    function phaseAt(i){
      let l=0,r=phases.length;
      while(l<r){const m=(l+r)>>1;if(phases[m].i<=i)l=m+1;else r=m;}
      const phase=phases[l-1];return phase&&i<phase.i1?phase:null;
    }
    const showPhases=h('input',{id:'map-phases',type:'checkbox',checked:s.mapPhases!==false,disabled:!phases.length,onchange:e=>{s.mapPhases=e.target.checked;draw();WF.touch();}});
    const mapOnline=/^https?:$/.test(location.protocol);
    const showTiles=h('input',{id:'map-tiles',type:'checkbox',checked:mapOnline&&!!s.mapTiles,disabled:!mapOnline||!g,onchange:e=>{s.mapTiles=e.target.checked;draw();WF.touch();}});
    const credits=h('div',{class:'desk-credits'},h('span',{}),h('a',{href:'https://www.openstreetmap.org/copyright',target:'_blank',rel:'noopener'},'© OpenStreetMap contributors'));
    const legend=h('div',{class:'desk-phase-legend'},Object.values(phaseStyles).map(([name,color])=>h('span',{},h('i',{style:'background:'+css(color)}),name)));
    mapBox.append(legend,credits);
    const mapBar=bar(orient,button('−',()=>zoom(1/1.4),{'aria-label':'Kaart uitzoomen'}),button('+',()=>zoom(1.4),{'aria-label':'Kaart inzoomen'}),button('Pas track in',fit),
      h('label',{},showPhases,' Fases'),h('label',{title:mapOnline?'Laadt kaarttegels voor het zichtbare gebied bij OpenStreetMap.':'Open de online versie voor de achtergrondkaart.'},showTiles,' Achtergrondkaart'));
    mapBar.classList.add('desk-maptools');mapBox.append(mapBar);
    let timer=null;
    const slider=h('input',{type:'range',id:'desk-scrubber',min:lo,max:hi-1,step:1,value:clip(A.cur,lo,hi-1),'aria-label':'Tijdcursor'});
    const speed=sel('desk-play-speed',['1','5','20','60'],String(s.playSpeed||20),v=>{s.playSpeed=Number(v);stop();WF.touch();});
    speed.setAttribute('aria-label','Afspeelsnelheid');for(const option of speed.options)option.textContent=option.value+'×';
    const play=button('Afspelen',toggle,{'aria-pressed':'false'});
    function stop(){if(timer!==null){clearInterval(timer);timer=null;play.textContent='Afspelen';play.setAttribute('aria-pressed','false');WF.touch();}}
    function toggle(){
      if(timer!==null){stop();return;}
      if(A.cur<lo||A.cur>=hi-1)A.cur=lo;
      const from=A.cur,t=performance.now();play.textContent='Pauze';play.setAttribute('aria-pressed','true');draw();
      timer=setInterval(()=>{
        if(!desk.isConnected||document.hidden||document.querySelector('dialog[open]')){stop();return;}
        const next=Math.min(hi-1,from+Math.floor((performance.now()-t)*Number(speed.value)/1000));
        if(next!==A.cur){A.cur=next;draw();}if(next===hi-1)stop();
      },50);
    }
    slider.oninput=()=>{stop();A.cur=Number(slider.value);schedule();};slider.onchange=()=>{A.cur=Number(slider.value);draw();WF.touch();};
    const replay=h('div',{class:'desk-replay'},play,speed,slider);
    const nudge=step=>{stop();A.cur=clip(A.cur+step,lo,hi-1);draw();WF.touch();};
    const timeControls=bar(button('−1 s',()=>nudge(-1)),button('+1 s',()=>nudge(1)),field('Kanaal',sel('desk-channel',varList(),key,v=>{s.plotVariable=v;show(A.tab);})),rangeLabel,
      button('Tijdvak',()=>dialog('Tijdvak instellen',WF.selectionBar())),
      button('Zoom op selectie',()=>{if(!s.selections.analysis)return banner('Sleep eerst een tijdvak in de tijdgrafiek.');s.viewport=WF.rangeIndices();view.x=view.y=0;view.z=1;show(A.tab);}),
      button('Hele log',()=>{s.viewport=pair?[D.i0,D.i1]:null;s.selections.analysis=null;view.x=view.y=0;view.z=1;show(A.tab);}));
    const desk=h('div',{class:'prep-desk'+(pair?' desk-pair':'')},h('section',{class:'desk-spatial'},status,mapBox),side,h('section',{class:'desk-time'},timeControls,stripBox,replay));
    const mobileToggle=button('',()=>{s.deskList=!s.deskList;mobile();schedule();},{class:'desk-mobile-toggle'});
    function mobile(){desk.classList.toggle('desk-list-open',!!s.deskList);mobileToggle.textContent=s.deskList?'Kaart tonen':title+' tonen';}
    mobile();container.append(mobileToggle,desk);
    if(g&&s.viewport){const bx=[Infinity,-Infinity],by=[Infinity,-Infinity];for(let i=lo;i<hi;i++)if(fin(g.x[i])&&fin(g.y[i])){bx[0]=Math.min(bx[0],g.x[i]);bx[1]=Math.max(bx[1],g.x[i]);by[0]=Math.min(by[0],g.y[i]);by[1]=Math.max(by[1],g.y[i]);}if(fin(bx[0]))bounds={bx,by};}
    const channels=pair?[...new Set([key,'AWA','TWD','Heel'])].filter(k=>D.ch[k]):[key];
    const sourceMode=pair&&(s.sources||[]).some(f=>f.kind==='log'&&f.text);
    if(pair){
      const picker=sel('pair-trace-mode',sourceMode?['Logsamples','Analyse 1 Hz']:['Analyse 1 Hz'],sourceMode&&s.pairTraceMode!=='Analyse 1 Hz'?'Logsamples':'Analyse 1 Hz',v=>{s.pairTraceMode=v;WF.touch();show(A.tab);});
      timeControls.prepend(field('Weergave',picker));
    }
    const native=sourceMode&&s.pairTraceMode!=='Analyse 1 Hz'?loggedTraces(s,channels,D.raw.t0,lo,hi,Math.max(256,stripBox.clientWidth||1200)):new Map();
    const series=channels.map(k=>{
      const samples=native.get(k),pts=[],ref=k==='TWD'?SL.cmean(D.ch[k].subarray(lo,hi)):NaN;
      let min=Infinity,max=-Infinity;
      const add=(i,a)=>{const v=fin(ref)?ref+SL.w180(a-ref):a;pts.push([i,v]);if(fin(v)){min=Math.min(min,v);max=Math.max(max,v);}};
      if(samples){for(const [i,v] of samples)add(i,v);}
      else {const step=pair?1:Math.max(1,Math.floor(dt/2200));for(let i=lo;i<hi;i+=step)add(i,D.ch[k]?.[i]);}
      return {k,pts,min,max,logged:!!samples};
    });
    const lanes=[];
    if(!pair){
      for(const [values,label,color] of [[D.L.race,'Race','--s1'],[D.L.sail,'Zeil','--s3'],[D.L.testing,'Training','--s4'],[D.L.motor,'Motor','--s2']]){
        const runs=[];let start=lo;
        for(let i=lo+1;i<=hi;i++)if(i===hi||values[i]!==values[start]){
          const v=values[start];if(label==='Zeil'?v>=0:v>0)runs.push([start,i,label==='Race'?'R'+v:label==='Zeil'?D.L.sailNames[v]:'']);
          start=i;
        }
        if(runs.length)lanes.push({label,color,runs});
      }
    }
    const phaseReadout=h('span',{class:'desk-phase-readout'});status.append(phaseReadout);
    let baseKey=null;
    function invalidate(){baseKey=null;schedule();}
    function overlay(cv,w,h,dp){
      const width=Math.round(w*dp),height=Math.round(h*dp);
      if(cv.width!==width||cv.height!==height){cv.width=width;cv.height=height;}
      const c=cv.getContext('2d');c.setTransform(dp,0,0,dp,0,0);c.clearRect(0,0,w,h);return c;
    }
    function ranges(){
      const ranges=[];
      for(const [r,k] of [[pair?.before,'--s1'],[pair?.after,'--s3'],[showPhases.checked&&options.phase,'--s4'],[s.selections.analysis,'--accent']])if(r)ranges.push([idx(r.start),idx(r.end),css(k)]);
      return ranges;
    }
    const left=70,right=18;
    function draw(){
      if(!desk.isConnected)return;
      const marks=ranges();
      const W=chartWidth=stripBox.clientWidth||700,H=stripBox.clientHeight||(pair?170:98),dp=window.devicePixelRatio||1;
      const mw=mapBox.clientWidth||700,mh=Math.max(95,mapBox.clientHeight||320),tiles=showTiles.checked&&!!g&&fin(g.bx[0])&&!!mapBox.getClientRects().length,visiblePhases=showPhases.checked&&phases.length;
      const X=i=>left+(i-lo)/dt*(W-left-right);
      const signature=JSON.stringify([W,H,mw,mh,dp,tiles,visiblePhases,view.x,view.y,view.z,view.bearing,marks]);
      if(baseKey!==signature){
      baseKey=signature;
      geo=drawMap(map,{v:key,view,bearing:view.bearing,bounds,range:[lo,hi],w:mw,h:mh,highlights:marks,phases:visiblePhases?phases:[],tiles:tiles?invalidate:null});
      credits.hidden=!tiles;credits.firstChild.textContent=geo?.tileStatus||'';legend.hidden=!visiblePhases;
      const c=strip.getContext('2d');strip.width=W*dp;strip.height=H*dp;c.setTransform(dp,0,0,dp,0,0);c.fillStyle=css('--surface');c.fillRect(0,0,W,H);
      c.font='11px system-ui';c.textBaseline='middle';
      for(const [a,b,color] of marks){c.fillStyle=alpha(color,.19);c.fillRect(Math.max(left,X(a)),3,Math.max(0,Math.min(W-right,X(b))-Math.max(left,X(a))),H-25);}
      const laneHeight=Math.min(13,(H-32)/Math.max(3,lanes.length+2)),row=(H-26-lanes.length*laneHeight)/Math.max(1,series.length);
      lanes.forEach(({label,color,runs},j)=>{
        const y=3+series.length*row+j*laneHeight;c.fillStyle=css('--ink2');c.textAlign='left';c.fillText(label,5,y+laneHeight/2);
        for(const [a,b,name]of runs){const width=X(b)-X(a);c.fillStyle=alpha(css(color),.4);c.fillRect(X(a),y+1,width,laneHeight-2);
          if(width>name.length*7+8){c.fillStyle=css('--ink');c.fillText(name,X(a)+4,y+laneHeight/2);}}
      });
      series.forEach(({k,pts,min,max,logged},j)=>{
        const y=3+j*row;c.strokeStyle=css('--line');c.beginPath();c.moveTo(left,y+row);c.lineTo(W-right,y+row);c.stroke();
        c.fillStyle=css('--ink2');c.fillText(pair?k+' · '+(logged?'log':'1 Hz'):k,5,y+row*.3);if(fin(min))c.fillText(f1(min,1)+'–'+f1(max,1),5,y+row*.72);
        c.strokeStyle=SER(j);c.lineWidth=1.6;c.beginPath();let on=false;
        c.fillStyle=SER(j);
        for(const [i,v]of pts){if(!fin(v)){on=false;continue;}const py=y+row-4-(max===min?.5:(v-min)/(max-min))*(row-8);if(logged)c.fillRect(X(i)-.8,py-.8,1.6,1.6);else if(on)c.lineTo(X(i),py);else c.moveTo(X(i),py);on=true;}c.stroke();
      });
      if(!pair){c.fillStyle=css('--s2');for(const e of D.L.list)if(e.i>=lo&&e.i<hi)c.fillRect(X(e.i)-1,1,3,8);}
      if(pair)for(const r of [pair.before,pair.after])for(const t of [r.start,r.end]){c.fillStyle=css('--ink2');c.fillRect(X(idx(t)),3,1,H-26);}
      const ticks=Math.max(2,Math.floor((W-left-right)/125));
      for(let j=0;j<=ticks;j++){const i=lo+dt*j/ticks;c.fillStyle=css('--ink2');c.textAlign=j===ticks?'right':j===0?'left':'center';c.fillText(tstr(iT(Math.round(i))),X(i),H-10);}c.textAlign='left';
      }
      const mc=overlay(mapCursor,mw,mh,dp);geo?.boat(A.cur,mc);
      const cursor=overlay(stripCursor,W,H,dp);cursor.fillStyle=css('--ink');
      if(A.cur>=lo&&A.cur<hi)cursor.fillRect(X(A.cur),0,2,H-22);
      slider.value=clip(A.cur,lo,hi-1);slider.setAttribute('aria-valuetext',tstr(iT(A.cur)));
      const p=phaseAt(A.cur);phaseReadout.textContent=p&&showPhases.checked?'Fase '+p.index+' · '+phaseStyles[p.state][0]:'';
      clock.textContent=tstr(iT(A.cur));telemetry.textContent=['BSP','TWS','AWA','TWA','TWD','Heel'].filter(k=>D.ch[k]).map(k=>k+' '+f1(D.ch[k][A.cur],1)+(['BSP','TWS'].includes(k)?' kn':'°')).join('   ·   ');
      rangeLabel.textContent=s.selections.analysis?tstr(s.selections.analysis.start)+' – '+tstr(s.selections.analysis.end):'Klik voor cursor · sleep voor tijdvak';
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
    function timeAt(e){return clip(Math.round(lo+(e.offsetX-left)*dt/(chartWidth-left-right)),lo,hi);}
    map.onpointerdown=e=>{stop();pan={x:e.offsetX,y:e.offsetY,vx:view.x,vy:view.y};map.setPointerCapture?.(e.pointerId);};
    map.onpointermove=e=>{if(!pan)return;const dx=e.offsetX-pan.x,dy=e.offsetY-pan.y;if(Math.abs(dx)+Math.abs(dy)>4||pan.moved){pan.moved=true;view.x=pan.vx-dx/view.z;view.y=pan.vy-dy/view.z;schedule();}};
    map.onpointerup=e=>{if(pan&&!pan.moved&&geo){let dist=25**2,best=A.cur;for(let i=lo;i<hi;i++){const d=(geo.X(i)-e.offsetX)**2+(geo.Y(i)-e.offsetY)**2;if(d<dist){dist=d;best=i;}}A.cur=best;
      const phase=phaseAt(best);if(dist<25**2&&phase&&showPhases.checked&&options.selectPhase){pan=null;options.selectPhase(phase.obj);return;}
    }pan=null;draw();WF.touch();};
    map.onpointercancel=()=>pan=null;
    strip.onpointerdown=e=>{stop();const i=timeAt(e);drag={i,x:e.offsetX};strip.setPointerCapture?.(e.pointerId);
      if(pair)for(const side of ['before','after'])for(const edge of ['start','end'])if(Math.abs(i-idx(pair[side][edge]))*(chartWidth-left-right)/dt<7)Object.assign(drag,{side,edge});};
    strip.onpointermove=e=>{if(!drag)return;A.cur=Math.min(D.i1-1,timeAt(e));if(!drag.side&&Math.abs(e.offsetX-drag.x)>3)s.selections.analysis={start:iT(Math.min(A.cur,drag.i)),end:iT(Math.max(A.cur,drag.i))};schedule();};
    strip.onpointerup=e=>{if(!drag)return;const {i,x,side,edge}=drag,end=timeAt(e);drag=null;A.cur=Math.min(D.i1-1,end);
      if(side&&Math.abs(e.offsetX-x)>2){const r={...pair[side],[edge]:iT(end)};if(!SL.windowPhase(D,r)||(side==='before'?r.end>pair.anchor-5000:r.start<pair.anchor+5000))return banner('Houd het venster minstens 5 s lang en 5 s van het draaipunt.',true);pair[side]=r;pair.approved=pair.validation=false;WF.touch();show(A.tab);return;}
      if(!side)s.selections.analysis=Math.abs(e.offsetX-x)>3&&i!==end?{start:iT(Math.min(i,end)),end:iT(Math.max(i,end))}:null;
      draw();WF.touch();if(A.tab==='review')show('review');};
    strip.onpointercancel=()=>drag=null;
    const keyboard=e=>{
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||e.target.closest?.('input,select,textarea,[contenteditable]'))return;
      if(e.code==='Space'&&!e.target.closest?.('button,a,summary')){e.preventDefault();toggle();return;}
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();nudge((e.shiftKey?10:1)*(e.key==='ArrowLeft'?-1:1));}
      if(e.key.toLowerCase()==='e'&&options.addEvent){e.preventDefault();options.addEvent();}
    };
    document.addEventListener('keydown',keyboard);cleanup=()=>{stop();document.removeEventListener('keydown',keyboard);};
    if(options.addEvent){map.ondblclick=strip.ondblclick=options.addEvent;}
    draw();if(window.ResizeObserver){observer=new ResizeObserver(schedule);observer.observe(mapBox);observer.observe(stripBox);}
    return {side,toolbar,draw};
  }
  return {mount,dialog,leave,button,loggedTraces};
})();
