'use strict';
(() => {
  const channels = ['TWA','AWA','MWA'];
  const metrics = [...channels,'TWD'];
  const {fin,D2R,R2D,w180,w360} = SL;

  function windowMeans(D, w) {
    // Wind angle and wind speed must represent the same seconds. Wrap vane
    // angles as well as TWD (some loggers encode port as 0..360 degrees).
    const out = {}, speed = D.ch.TWS, count = w.i1-w.i;
    let sum=0, n=0;
    for(let i=w.i;i<w.i1;i++)if(!D.invalid?.[i] && fin(speed?.[i]) && speed[i]>=0){sum+=speed[i];n++;}
    out.TWS=n>=.95*count ? sum/n : NaN;
    for(const key of metrics){
      let sin=0,cos=0,joint=0,onSide=0;
      const a=D.ch[key];
      if(a)for(let i=w.i;i<w.i1;i++){
        const v=a[i];
        if(D.invalid?.[i]||!fin(speed?.[i])||speed[i]<0||!fin(v)||Math.abs(v)>360)continue;
        sin+=Math.sin(v*D2R);cos+=Math.cos(v*D2R);joint++;
        if((key==='AWA' || key==='TWA') && (w.tack==='Port'?w180(v)<0:w180(v)>0) && Math.abs(w180(v))<180)onSide++;
      }
      const angle=joint>=.95*count && Math.hypot(sin,cos)>1e-8*joint ? Math.atan2(sin,cos)*R2D : NaN;
      out[key]=key==='TWD' ? w360(angle) : Math.abs(w180(angle));
      if(key==='AWA')out.awaOnSide=fin(angle) && onSide===joint;
      if(key==='TWA')out.twaOnSide=fin(angle) && onSide===joint;
    }
    return out;
  }

  function difference(port,stbd,alignment){
    const out={portTWD:port.TWD,stbdTWD:stbd.TWD,portTWA:port.TWA,stbdTWA:stbd.TWA};
    for(const key of channels)out[key]=port[key]-stbd[key];
    out.TWD=w180(port.TWD-stbd.TWD);
    out.TWS=port.TWS-stbd.TWS;
    out.mhuResidual=alignment&&port.awaOnSide&&stbd.awaOnSide ? out.AWA/2 : NaN;
    return out;
  }

  function windPlotData(D, refs, proposal=D) {
    proposal ||= D;
    const phases=[], pairs=[], cache=new Map(), seenPairs=new Set();
    const labels=(D.L.sailConfigs||[]).map(s=>s.split(';').map(t=>t.trim()).filter(Boolean).join(' / ')||'Geen zeilen');
    const eligible=(refs.pairs||[]).concat(refs.validationPairs||[]).filter(x=>
      x?.before && x.after && x.pair && x.valid!==false && x.pair.approved!==false && !x.pair.rejected);
    const control=new Uint8Array(D.n), occupied=new Uint8Array(D.n), tactical=new Uint8Array(D.n);
    for(const x of eligible)if(x.pair.vmgToVmg===false)for(const w of [x.before,x.after])tactical.fill(1,w.i,w.i1);
    for(const x of eligible)if(x.pair.validation)for(const w of [x.before,x.after])control.fill(1,w.i,w.i1);

    function observation(w){
      const {i,i1}=w,key=i+':'+i1;
      if(cache.has(key))return cache.get(key);
      cache.set(key,null);
      if(!Number.isInteger(i)||!Number.isInteger(i1)||i<D.i0||i1>D.i1||i1<=i)return null;
      const state=D.L.sailState||D.L.sail, side=w.tack;
      if(!['Port','Stbd'].includes(side))return null;
      for(let j=i;j<i1;j++){
        if(D.invalid?.[j]||D.L.motor?.[j]||state?.[j]!==state?.[i])return null;
        const twa=D.ch.TWA?.[j];
        if(fin(twa) && Math.abs(twa)<=360 && (w180(twa)<0?'Port':'Stbd')!==side && Math.abs(w180(twa))!==180)return null;
      }
      const active=windowMeans(D,w);
      if(!fin(active.TWA)||!fin(active.TWS))return null;
      const sailId=state?.[i], rawConfig=D.L.sailConfigs?.[sailId];
      let sail=rawConfig!==undefined ? labels[sailId] : w.sails;
      if(rawConfig!==undefined && labels.indexOf(sail)!==labels.lastIndexOf(sail))sail=rawConfig;
      if(!sail||sail==='-')sail='Onbekend';
      const mode=w.mode==='Upwind'?'up':w.mode==='Downwind'?'dn':null;
      const point={i,i1,t:D.raw.t0+i*1000,side,sail,sailId,mode,tws:active.TWS,active,
        proposed:proposal===D?active:windowMeans(proposal,w)};
      cache.set(key,point);return point;
    }

    // Prioritise explicit phase approvals. A short approved manoeuvre window
    // can supply a phase point if its seconds have not been used already.
    function addPhase(w,source){
      const p=observation(w);
      if(!p?.mode || control.subarray(p.i,p.i1).some(Boolean) || occupied.subarray(p.i,p.i1).some(Boolean))return;
      phases.push({...p,source,vmgToVmg:!tactical.subarray(p.i,p.i1).some(Boolean)});occupied.fill(1,p.i,p.i1);
    }
    for(const w of refs.stablePhases||refs.phases||[])addPhase(w,'phase');
    for(const {pair,before,after} of eligible){
      if(seenPairs.has(pair.key))continue;
      const a=observation(before),b=observation(after);
      if(!a||!b||a.side===b.side||a.sailId!==b.sailId||a.sail!==b.sail)continue;
      if(!pair.validation && [a,b].some(w=>control.subarray(w.i,w.i1).some(Boolean)))continue;
      const up=pair.type==='Tack' && a.active.TWA<90 && b.active.TWA<90;
      const down=pair.type==='Gybe' && a.active.TWA>90 && b.active.TWA>90;
      if(!up && !down)continue;
      const [port,stbd]=a.side==='Port'?[a,b]:[b,a];
      const winds=[a.active,b.active,a.proposed,b.proposed];
      const pure=winds.every(w=>w.twaOnSide && (up ? w.TWA<=60 : w.TWA>=120));
      const tableEligible=pure && !pair.validation;
      const alignment=up && tableEligible && pair.vmgToVmg!==false;
      pairs.push({key:pair.key,t:pair.anchor,type:pair.type,mode:up?'up':'dn',sail:a.sail,
        tws:(a.tws+b.tws)/2,tableEligible,vmgToVmg:pair.vmgToVmg!==false,validation:!!pair.validation,active:difference(port.active,stbd.active,alignment),
        proposed:difference(port.proposed,stbd.proposed,alignment)});
      seenPairs.add(pair.key);
      if(!pair.validation){addPhase(before,'pair');addPhase(after,'pair');}
    }
    phases.sort((a,b)=>a.t-b.t);pairs.sort((a,b)=>a.t-b.t);
    return {channels:channels.filter(k=>D.ch[k]),phases,pairs,hasProposal:proposal!==D};
  }
  SL.windPlotData=windPlotData;
})();
