'use strict';
const PrepDesk = (() => {
  const button=(label,on,attrs={})=>h('button',{type:'button',onclick:on,...attrs},label);
  let observer,frame,activeDialog,cleanup;
  function leave(){cleanup?.();cleanup=null;observer?.disconnect();cancelAnimationFrame(frame);activeDialog?.remove();activeDialog=null;}
  function dialog(title,body){
    activeDialog?.remove();
    const d=h('dialog',{class:'desk-dialog','aria-label':title},bar(h('h3',{},title),button('Sluiten',()=>d.remove())),body);
    document.body.append(d);activeDialog=d;
    if(d.showModal)d.showModal();else d.setAttribute('open','');
    d.addEventListener('close',()=>d.remove());
    d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.remove();}};
    return d;
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
    const mapBar=bar(orient,button('−',()=>zoom(1/1.4),{'aria-label':'Kaart uitzoomen'}),button('+',()=>zoom(1.4),{'aria-label':'Kaart inzoomen'}),button('Pas track in',fit));
    mapBar.classList.add('desk-maptools');mapBox.append(mapBar);
    const nudge=step=>{A.cur=clip(A.cur+step,lo,hi-1);draw();WF.touch();};
    const timeControls=bar(button('−1 s',()=>nudge(-1)),button('+1 s',()=>nudge(1)),field('Kanaal',sel('desk-channel',varList(),key,v=>{s.plotVariable=v;show(A.tab);})),rangeLabel,
      button('Tijdvak',()=>dialog('Tijdvak instellen',WF.selectionBar())),
      button('Zoom op selectie',()=>{if(!s.selections.analysis)return banner('Sleep eerst een tijdvak in de tijdgrafiek.');s.viewport=WF.rangeIndices();view.x=view.y=0;view.z=1;show(A.tab);}),
      button('Hele log',()=>{s.viewport=null;s.selections.analysis=null;view.x=view.y=0;view.z=1;show(A.tab);}));
    const desk=h('div',{class:'prep-desk'+(pair?' desk-pair':'')},h('section',{class:'desk-spatial'},status,mapBox),side,h('section',{class:'desk-time'},timeControls,stripBox));
    const mobileToggle=button('',()=>{s.deskList=!s.deskList;mobile();schedule();},{class:'desk-mobile-toggle'});
    function mobile(){desk.classList.toggle('desk-list-open',!!s.deskList);mobileToggle.textContent=s.deskList?'Kaart tonen':title+' tonen';}
    mobile();container.append(mobileToggle,desk);
    if(g&&s.viewport){const bx=[Infinity,-Infinity],by=[Infinity,-Infinity];for(let i=lo;i<hi;i++)if(fin(g.x[i])&&fin(g.y[i])){bx[0]=Math.min(bx[0],g.x[i]);bx[1]=Math.max(bx[1],g.x[i]);by[0]=Math.min(by[0],g.y[i]);by[1]=Math.max(by[1],g.y[i]);}if(fin(bx[0]))bounds={bx,by};}
    const channels=pair?[...new Set([key,'AWA','TWD','Heel'])].filter(k=>D.ch[k]):[key];
    const series=channels.map(k=>{
      const step=Math.max(1,Math.floor(dt/2200)),pts=[],ref=k==='TWD'?SL.cmean(D.ch[k].subarray(lo,hi)):NaN;
      let min=Infinity,max=-Infinity;
      for(let i=lo;i<hi;i+=step){const a=D.ch[k]?.[i],v=fin(ref)?ref+SL.w180(a-ref):a;pts.push([i,v]);if(fin(v)){min=Math.min(min,v);max=Math.max(max,v);}}
      return {k,pts,min,max};
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
    function ranges(){
      const ranges=[];
      for(const [r,k] of [[pair?.before,'--s1'],[pair?.after,'--s3'],[options.phase,'--s3'],[s.selections.analysis,'--accent']])if(r)ranges.push([idx(r.start),idx(r.end),css(k)]);
      return ranges;
    }
    const left=70,right=18;
    function draw(){
      if(!desk.isConnected)return;
      const marks=ranges();
      geo=drawMap(map,{v:key,view,bearing:view.bearing,bounds,range:[lo,hi],cur:A.cur,h:Math.max(95,mapBox.clientHeight||320),highlights:marks});
      const W=chartWidth=stripBox.clientWidth||700,H=stripBox.clientHeight||(pair?170:98),dp=window.devicePixelRatio||1,c=strip.getContext('2d');
      strip.width=W*dp;strip.height=H*dp;c.setTransform(dp,0,0,dp,0,0);c.fillStyle=css('--surface');c.fillRect(0,0,W,H);
      const X=i=>left+(i-lo)/dt*(W-left-right);
      c.font='11px system-ui';c.textBaseline='middle';
      for(const [a,b,color] of marks){c.fillStyle=alpha(color,.19);c.fillRect(Math.max(left,X(a)),3,Math.max(0,Math.min(W-right,X(b))-Math.max(left,X(a))),H-25);}
      const laneHeight=Math.min(13,(H-32)/Math.max(3,lanes.length+2)),row=(H-26-lanes.length*laneHeight)/Math.max(1,series.length);
      lanes.forEach(({label,color,runs},j)=>{
        const y=3+series.length*row+j*laneHeight;c.fillStyle=css('--ink2');c.textAlign='left';c.fillText(label,5,y+laneHeight/2);
        for(const [a,b,name]of runs){const width=X(b)-X(a);c.fillStyle=alpha(css(color),.4);c.fillRect(X(a),y+1,width,laneHeight-2);
          if(width>name.length*7+8){c.fillStyle=css('--ink');c.fillText(name,X(a)+4,y+laneHeight/2);}}
      });
      series.forEach(({k,pts,min,max},j)=>{
        const y=3+j*row;c.strokeStyle=css('--line');c.beginPath();c.moveTo(left,y+row);c.lineTo(W-right,y+row);c.stroke();
        c.fillStyle=css('--ink2');c.fillText(k,5,y+row*.3);if(fin(min))c.fillText(f1(min,1)+'–'+f1(max,1),5,y+row*.72);
        c.strokeStyle=SER(j);c.lineWidth=1.6;c.beginPath();let on=false;
        for(const [i,v]of pts){if(!fin(v)){on=false;continue;}const py=y+row-4-(max===min?.5:(v-min)/(max-min))*(row-8);if(on)c.lineTo(X(i),py);else c.moveTo(X(i),py);on=true;}c.stroke();
      });
      if(!pair){c.fillStyle=css('--s2');for(const e of D.L.list)if(e.i>=lo&&e.i<hi)c.fillRect(X(e.i)-1,1,3,8);}
      if(pair)for(const r of [pair.before,pair.after])for(const t of [r.start,r.end]){c.fillStyle=css('--ink2');c.fillRect(X(idx(t)),3,1,H-26);}
      const ticks=Math.max(2,Math.floor((W-left-right)/125));
      for(let j=0;j<=ticks;j++){const i=lo+dt*j/ticks;c.fillStyle=css('--ink2');c.textAlign=j===ticks?'right':j===0?'left':'center';c.fillText(tstr(iT(Math.round(i))),X(i),H-10);}c.textAlign='left';
      c.fillStyle=css('--ink');if(A.cur>=lo&&A.cur<hi)c.fillRect(X(A.cur),0,2,H-22);
      clock.textContent=tstr(iT(A.cur));telemetry.textContent=['BSP','TWS','AWA','TWA','TWD','Heel'].filter(k=>D.ch[k]).map(k=>k+' '+f1(D.ch[k][A.cur],1)+(['BSP','TWS'].includes(k)?' kn':'°')).join('   ·   ');
      rangeLabel.textContent=s.selections.analysis?tstr(s.selections.analysis.start)+' – '+tstr(s.selections.analysis.end):'Klik voor cursor · sleep voor tijdvak';
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
    function timeAt(e){return clip(Math.round(lo+(e.offsetX-left)*dt/(chartWidth-left-right)),lo,hi);}
    map.onpointerdown=e=>{pan={x:e.offsetX,y:e.offsetY,vx:view.x,vy:view.y};map.setPointerCapture?.(e.pointerId);};
    map.onpointermove=e=>{if(!pan)return;const dx=e.offsetX-pan.x,dy=e.offsetY-pan.y;if(Math.abs(dx)+Math.abs(dy)>4||pan.moved){pan.moved=true;view.x=pan.vx-dx/view.z;view.y=pan.vy-dy/view.z;schedule();}};
    map.onpointerup=e=>{if(pan&&!pan.moved&&geo){let dist=25**2,best=A.cur;for(let i=lo;i<hi;i++){const d=(geo.X(i)-e.offsetX)**2+(geo.Y(i)-e.offsetY)**2;if(d<dist){dist=d;best=i;}}A.cur=best;}pan=null;draw();WF.touch();};
    map.onpointercancel=()=>pan=null;
    strip.onpointerdown=e=>{const i=timeAt(e);drag={i,x:e.offsetX};strip.setPointerCapture?.(e.pointerId);
      if(pair)for(const side of ['before','after'])for(const edge of ['start','end'])if(Math.abs(i-idx(pair[side][edge]))*(chartWidth-left-right)/dt<7)Object.assign(drag,{side,edge});};
    strip.onpointermove=e=>{if(!drag)return;A.cur=Math.min(D.i1-1,timeAt(e));if(!drag.side&&Math.abs(e.offsetX-drag.x)>3)s.selections.analysis={start:iT(Math.min(A.cur,drag.i)),end:iT(Math.max(A.cur,drag.i))};schedule();};
    strip.onpointerup=e=>{if(!drag)return;const {i,x,side,edge}=drag,end=timeAt(e);drag=null;A.cur=Math.min(D.i1-1,end);
      if(side&&Math.abs(e.offsetX-x)>2){const r={...pair[side],[edge]:iT(end)};if(!SL.windowPhase(D,r)||(side==='before'?r.end>pair.anchor-5000:r.start<pair.anchor+5000))return banner('Houd het venster minstens 5 s lang en 5 s van het draaipunt.',true);pair[side]=r;pair.approved=pair.validation=false;WF.touch();show(A.tab);return;}
      if(!side)s.selections.analysis=Math.abs(e.offsetX-x)>3&&i!==end?{start:iT(Math.min(i,end)),end:iT(Math.max(i,end))}:null;
      draw();WF.touch();if(A.tab==='review')show('review');};
    strip.onpointercancel=()=>drag=null;
    const keyboard=e=>{
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||e.target.closest?.('input,select,textarea,[contenteditable]'))return;
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();nudge((e.shiftKey?10:1)*(e.key==='ArrowLeft'?-1:1));}
      if(e.key.toLowerCase()==='e'&&options.addEvent){e.preventDefault();options.addEvent();}
    };
    document.addEventListener('keydown',keyboard);cleanup=()=>document.removeEventListener('keydown',keyboard);
    if(options.addEvent){map.ondblclick=strip.ondblclick=options.addEvent;}
    draw();if(window.ResizeObserver){observer=new ResizeObserver(schedule);observer.observe(mapBox);observer.observe(stripBox);}
    return {side,toolbar,draw};
  }
  return {mount,dialog,leave,button};
})();
