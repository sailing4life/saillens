'use strict';
const EventDesk=(()=>{
  const labels={RaceStartGun:'Startschot',RaceMark:'Boeironding',RaceFinish:'Finish',SailsUp:'Zeilwissel',MiscEvent:'Notitie',ManualEntry:'Handmatige waarden',StartTesting:'Training begint',StopTesting:'Training eindigt',MotorStart:'Motor aan',MotorStop:'Motor uit',DayStart:'Dag begint',DayStop:'Dag eindigt'};
  const button=PrepDesk.button;
  const logTime=e=>e.tl-A.cfg.evOff*36e5+SL.logOffset(A.raw,A.cfg)*36e5+(A.cfg.evShiftSec||0)*1000;
  const local=t=>new Date(t+(A.cfg.dispOff||0)*36e5).toISOString().slice(0,19);
  const clock=value=>Date.parse(value+'Z')-(A.cfg.dispOff||0)*36e5;
  function context(events,time,exclude){
    let race=null,mark=0,sails=';;;',maxRace=0;
    for(const e of events){if(e.id===exclude&&exclude)continue;
      if(e.type==='RaceStartGun')maxRace=Math.max(maxRace,Number(e.attr)||0);
      if(e.tl>time)continue;
      if(e.type==='RaceStartGun'){race=e.attr;mark=0;}
      if(e.type==='RaceMark')mark=Math.max(mark+1,+e.attr||0);
      if(e.type==='RaceFinish'||e.type==='DayStop')race=null;
      if(e.type==='SailsUp')sails=e.attr;
    }
    return {race,mark,sails,maxRace};
  }
  function issues(events){
    const bad=new Map(),open={},seen=new Set();let marked=new Set();
    for(const e of events){
      const key=e.id,group=e.type.startsWith('Race')?'race':e.type.includes('Testing')?'test':e.type.startsWith('Motor')?'motor':null;
      if(e.type==='DayStop'){delete open.race;continue;}
      if(!group)continue;
      if(['RaceStartGun','StartTesting','MotorStart'].includes(e.type)){
        if(open[group])bad.set(key,'Er staat al een '+({race:'race',test:'training',motor:'motorperiode'})[group]+' open op dit tijdstip.');
        if(group==='race'&&seen.has(e.attr))bad.set(key,'Dit racenummer is al gebruikt.');
        if(group==='race'){seen.add(e.attr);marked=new Set();}
        open[group]=e;continue;
      }
      if(!open[group])bad.set(key,'Dit event heeft geen bijbehorende start op dit tijdstip.');
      else if(e.tl<=open[group].tl)bad.set(key,'Kies een tijdstip na de start.');
      else if(e.type==='RaceFinish'&&e.attr&&e.attr!==open[group].attr)bad.set(key,'Het finishnummer moet overeenkomen met het startschot.');
      if(e.type==='RaceMark'){
        if(marked.has(e.attr))bad.set(key,'Dit boeinummer komt al voor in deze race. Kies een ander nummer.');
        marked.add(e.attr);
      }else delete open[group];
    }
    return bad;
  }
  function commit(next,remember=true){
    const ev=evEnsure(),previous=ev.events,old=issues(previous),ordered=next.slice().sort((a,b)=>a.tl-b.tl);
    if(remember)for(const [id,msg] of issues(ordered))if(old.get(id)!==msg)throw Error(msg);
    ev.events=ordered;if(!WF.recompute()){ev.events=previous;throw Error('Wijziging kon niet worden doorgerekend.');}
    if(remember){const undo=WF.session.eventUndo||=[];undo.push(previous);if(undo.length>12)undo.shift();}
    A.evDirty=true;WF.touch();show('events');
  }
  function editor(ev,initial='MiscEvent',existing){
    const time=h('input',{id:'event-time',type:'datetime-local',step:1,value:local(existing?logTime(existing):iT(A.cur))});
    const type=sel('event-kind',[...new Set([...Object.keys(labels),initial])],initial,()=>fields());
    for(const opt of type.options)opt.textContent=labels[opt.value]||opt.value;
    const dynamic=h('div',{class:'event-fields'}),error=h('p',{role:'alert',class:'event-error'}),note=h('textarea',{id:'event-note',rows:2});note.value=existing?.comments||'';
    let attr,slots,reef,renumber,originalType;
    const tl=()=>idxTl((clock(time.value)-A.raw.t0)/1000);
    function fields(){
      const k=type.value,ctx=context(ev.events,tl(),existing?.id),original=existing?.type===k;
      dynamic.replaceChildren();error.textContent='';slots=null;renumber=null;originalType=k;
      const val=original?existing.attr:k==='RaceStartGun'?String(ctx.maxRace+1):k==='RaceMark'?String(ctx.mark+1):k==='RaceFinish'?(ctx.race||''):['DayStart','DayStop'].includes(k)?'0':'';
      attr=h('input',{id:'event-attribute',value:val});
      if(k==='SailsUp'){
        const parts=(original?existing.attr:ctx.sails).split(';'),m=(parts[0]||'').match(/^(.*?)\((\d+)\)$/);
        reef=h('input',{id:'event-reef',type:'number',min:0,step:1,value:m?.[2]||'0'});if(m)parts[0]=m[1];
        const names=['Grootzeil','Voorzeil','Stagzeil','Gennaker'];
        slots=names.map((name,i)=>{
          const id='event-slot-'+i,options=new Set(ev.events.filter(e=>e.type==='SailsUp').map(e=>e.attr.split(';')[i]?.replace(/\(\d+\)$/,'')).filter(Boolean));
          const types=[/main|groot/i,/jib|head|genoa|fok/i,/stay|stag/i,/spin|genn|asym|sym/i];
          for(const sail of [...(WF.session.profile.sails||[]),...(ev.sails||[])])if(types[i].test(sail.type))options.add(sail.name);
          const input=h('input',{id,list:id+'-list',value:parts[i]||'',placeholder:'Geen'});
          dynamic.append(field(name,input),h('datalist',{id:id+'-list'},[...options].map(v=>h('option',{value:v}))));return input;
        });
        dynamic.append(field('Rif',reef));
      }else if(['RaceStartGun','RaceFinish','RaceMark','ManualEntry'].includes(k)||!labels[k]||original&&val){
        dynamic.append(field(k==='RaceMark'?'Boeinummer':k.startsWith('Race')?'Racenummer':k==='ManualEntry'?'Waarden, bv. Mast_Base=53;Helm=Jelle':'Waarde',attr));
      }
      if(k==='RaceMark'&&!existing){
        const later=ev.events.filter(e=>e.tl>=tl());
        const nextBoundary=later.findIndex(e=>['RaceStartGun','RaceFinish','DayStop'].includes(e.type));
        const marks=(nextBoundary<0?later:later.slice(0,nextBoundary)).filter(e=>e.type==='RaceMark');
        if(marks.length){
          renumber=h('input',{type:'checkbox',checked:true});
          dynamic.append(field('Volgende '+marks.length+' boeironding(en) doornummeren',renumber));
        }
      }
    }
    fields(); time.onchange=()=>{if(!existing&&['RaceStartGun','RaceMark','RaceFinish','SailsUp'].includes(type.value))fields();};
    function save(){try{
      const t=clock(time.value),k=originalType;
      if(!fin(t)||((!existing||t!==logTime(existing))&&(t<iT(0)||t>iT(A.raw.n))))throw Error('Kies een tijdstip binnen het log.');
      let value=attr.value.trim();
      if(slots){const parts=slots.map(x=>x.value.trim());if(parts.some(x=>x.includes(';')))throw Error('Gebruik één zeilnaam per veld.');
        const n=reef.valueAsNumber;if(!Number.isInteger(n)||n<0||(n&&!parts[0]))throw Error('Kies een grootzeil en een geldig rifnummer.');
        if(n)parts[0]+='('+n+')';value=parts.join(';');}
      if(k.startsWith('Race')&&(!/^\d+$/.test(value)||+value<=0||+value>32767))throw Error('Kies een geldig positief nummer.');
      if(k==='ManualEntry'&&value.split(';').some(p=>!/^\s*[^=;]+\s*=\s*[^=;]+\s*$/.test(p)||!p.split('=')[1]?.trim()))throw Error('Gebruik naam=waarde, gescheiden door puntkomma’s.');
      if(k==='MiscEvent'&&!note.value.trim()&&!value)throw Error('Schrijf een korte notitie.');
      const item={...existing,id:existing?.id||SL.uid(),tl:tl(),type:k,attr:value,comments:note.value};
      let next=existing?ev.events.map(e=>e===existing?item:e):[...ev.events,item];
      if(renumber?.checked){
        next=next.sort((a,b)=>a.tl-b.tl);let active=false,n=+value;
        next=next.map(e=>{
          if(e===item)active=true;
          else if(['RaceStartGun','RaceFinish','DayStop'].includes(e.type))active=false;
          else if(active&&e.type==='RaceMark')return {...e,attr:String(++n)};
          return e;
        });
      }
      commit(next);
    }catch(e){error.textContent=e.message;}}
    const body=h('div',{class:'desk-form'},bar(field('Tijdstip',time),field('Eventtype',type)),dynamic,field('Toelichting',note),error,
      bar(button(existing?'Event bijwerken':'Event toevoegen',save,{class:'primary'}),existing?button('Verwijder event',()=>{try{commit(ev.events.filter(x=>x!==existing));}catch(e){error.textContent=e.message;}}):null));
    PrepDesk.dialog(existing?'Event bewerken':'Event bij de cursor',body);
  }
  function interval(ev){
    const r=WF.session.selections.analysis;
    if(!r)return banner('Sleep eerst een tijdvak in de tijdgrafiek, of gebruik Tijdvak.');
    const err=h('p',{role:'alert'}),body=h('div',{},h('p',{},dstr(r.start)+' – '+tstr(r.end)),err);
    for(const [label,a,b]of [['Race','RaceStartGun','RaceFinish'],['Training','StartTesting','StopTesting'],['Motor','MotorStart','MotorStop']])body.append(button('Markeer '+label,()=>{
      try{const n=String(context(ev.events,Infinity).maxRace+1),event=(t,type)=>({id:SL.uid(),type,tl:idxTl((t-A.raw.t0)/1000),attr:label==='Race'?n:'',comments:''});commit([event(r.end,b),...ev.events,event(r.start,a)]);}catch(e){err.textContent=e.message;}
    }));PrepDesk.dialog('Events voor tijdvak',body);
  }
  function render(){
    const c=pane('events');if(!A.D)return;
    const ev=evEnsure();for(const e of ev.events)e.id||=SL.uid();
    const {side,toolbar}=PrepDesk.mount(c,'Events · '+ev.events.length,{addEvent:()=>editor(ev)});
    toolbar.append(button('+ Event',()=>editor(ev),{class:'primary',title:'Event bij de cursor (E)'}));
    side.append(bar(...['RaceStartGun','RaceMark','RaceFinish','SailsUp'].map(k=>button(labels[k],()=>editor(ev,k))),button('Tijdvak markeren',()=>interval(ev))));
    const rows=ev.events.map(e=>{const t=logTime(e),pick=()=>{A.cur=Math.max(A.D.i0,Math.min(A.D.i1-1,Math.round((t-A.raw.t0)/1000)));if(WF.session.viewport&&(A.cur<WF.session.viewport[0]||A.cur>=WF.session.viewport[1]))WF.session.viewport=null;WF.session.deskEvent=e.id;show('events');};
      const row=[button(tstr(t),pick,{title:dstr(t)}),labels[e.type]||e.type,e.type==='SailsUp'?e.attr.split(';').filter(Boolean).join(' / ')||'Geen':e.attr&&e.attr!=='0'?e.attr:e.comments,button('Bewerk',()=>editor(ev,e.type,e))];
      row._attrs={'aria-selected':WF.session.deskEvent===e.id,title:e.comments||'',onclick:x=>{if(!x.target.closest('button'))pick();}};return row;});
    side.append(table(['Tijd','Event','Waarde',''],rows));
    if(!rows.length)side.append(h('p',{class:'muted'},'Klik op de track of tijdgrafiek en voeg het eerste event toe.'));
    const extra=h('details',{},h('summary',{},'Manoeuvre handmatig plaatsen'));side.append(extra);RaceTools.turnControls(extra);
    side.append(bar(button('Events exporteren',()=>dl('SailLens-events.ev.xml',SL.eventsXml(ev))),button('Ongedaan maken',()=>{const undo=WF.session.eventUndo,previous=undo.pop();try{commit(previous,false);}catch(e){undo.push(previous);banner(e.message,true);}},{disabled:!WF.session.eventUndo?.length})),button('Verder naar fases',()=>show('review'),{class:'primary'}));
  }
  return {render,context};
})();
