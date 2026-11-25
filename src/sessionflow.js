'use strict';
/* Stable preparation boundaries and independently reviewed calibration windows. */
(() => {
  const finite = Number.isFinite, copy = SL.copy;
  const phaseBaseKeys = ['phaseLen','phaseGap','manBefore','manAfter'];
  const phaseKeys = ['phaseLen','phaseGap','minBsp','sdTwa','sdBsp','sdTws','sdHdg','upMargin','manBefore','manAfter','polMin','polMax'];
  function phaseDefaults(cfg) { return { ...Object.fromEntries(phaseKeys.map(k => [k, cfg[k] ?? (k === 'sdHdg' ? 10 : SL.DEF[k])])), scope:'all', race:'', sail:'', mode:'', tack:'', range:null }; }
  const eventKey = s => JSON.stringify({sources:s.sources.map(x=>x.hash), raw:s.raw && [s.raw.t0,s.raw.n], events:(s.events?.events||[]).filter(e=>e.type!=='MiscEvent').map(({type,tl,attr})=>[type,tl,attr]), turns:s.turnEdits?.length?s.turnEdits:undefined, clocks:[s.cfg.logOff,s.cfg.evOff,s.cfg.evShiftSec,s.cfg.tStart,s.cfg.tEnd,s.cfg.maxHold,s.cfg.useEvents], channels:s.profile.channels});
  const preparationKey = s => JSON.stringify({source:eventKey(s), annotations:(s.events?.events||[]).map(e=>[e.type,e.tl,e.comments]),cfg:s.cfg, profile:s.profile, polar:s.polar, chart:s.chart, calib:s.calib, baseline:s.baseline, changed:s.calibrationChanged, reviews:s.reviews, phases:s.phaseBuild, pairs:s.manoeuvrePairs});
  function sampleMatches(D,i,f={}) { const t=D.raw.t0+i*1000; return i>=D.i0&&i<D.i1 && (!f.range || (t>=f.range.start&&t<f.range.end)) && (!f.race || String(D.L.race[i])===String(f.race)) && (!f.sail || D.L.sailNames[D.L.sail[i]]===f.sail||D.L.sailSlots?.[D.L.sailState?.[i]]?.includes(f.sail)) && (!f.mode || SL.MODES[D.mode[i]]===f.mode) && (!f.tack || (D.tack[i]>0?'Stbd':'Port')===f.tack) && (f.scope!=='racing'||D.L.race[i]>0) && (f.scope!=='training'||D.L.testing[i]>0) && !D.L.motor?.[i]; }
  const signedAngles = new Set(['TWA','AWA','MWA']);
  const angle = (D,k) => SL.ANG.test(k) || signedAngles.has(k) || D.formulaAngles?.includes(k);
  const qualityLimits = [
    ['sdHdg','spread','HDG','max'], ['sdBsp','spread','BSP','max'],
    ['sdTwa','spread','TWA','max'], ['sdTws','spread','TWS','max'],
    ['minBsp','v','BSP','min'], ['polMin','v','BSPpol%','min'], ['polMax','v','BSPpol%','max'],
    ['vmgMin','v','VMG%','min'], ['vmgMax','v','VMG%','max']
  ];
  function phaseMatchesQuality(p, filter) {
    if (!filter) return true;
    if ((filter.mode && p.mode !== filter.mode) || (filter.tack && p.tack !== filter.tack) ||
        (filter.race && String(p.race) !== String(filter.race)) ||
        (filter.sail && p.sails !== filter.sail && !p.sailSlots?.includes(filter.sail))) return false;
    for (const [key,field,channel,bound] of qualityLimits) {
      const limit = filter[key];
      if (limit == null || limit === '') continue;
      const value = p[field]?.[channel];
      if (!finite(limit) || !finite(value) || !(p.coverage?.[channel] >= .95) ||
          (bound === 'min' ? value < limit : value > limit)) return false;
    }
    return true;
  }
  function windowPhase(D,r,minSeconds=5) {
    if (!r || !finite(r.start)||!finite(r.end)||r.end<=r.start) return null;
    const i=Math.round((r.start-D.raw.t0)/1000), i1=Math.round((r.end-D.raw.t0)/1000);
    if(i<D.i0||i1>D.i1||i1-i<minSeconds)return null;
    const v={},spread={},coverage={};
    for (const [key,channel] of Object.entries(D.ch)) {
      const values = channel.subarray(i,i1), angular = angle(D,key);
      const center = angular ? SL.cmean(values) : SL.mean(values);
      v[key] = signedAngles.has(key) ? SL.w180(center) : center;
      let count = 0, sumSquares = 0, sumOffset = 0;
      for (const value of values) if (finite(value)) {
        const offset = angular ? SL.w180(value-center) : value-center;
        count++; sumSquares += offset*offset; sumOffset += offset;
      }
      coverage[key] = count / values.length;
      const centeredSquares = angular && count ? sumSquares - sumOffset*sumOffset/count : sumSquares;
      spread[key] = count>1 ? Math.sqrt(Math.max(0,centeredSquares)/(count-1)) : NaN;
    }
    if (finite(v.Cur_E) && finite(v.Cur_N)) {
      v.CUR_RATE = Math.hypot(v.Cur_E,v.Cur_N);
      v.CUR_DIR = SL.w360(Math.atan2(v.Cur_E,v.Cur_N)*180/Math.PI);
    }
    const rc=D.L.race[i],lg=D.L.leg[i];
    return {i,i1,t:r.start,mode:SL.phaseMode(D.mode,i,i1) || 'Onbekend',tack:!finite(v.TWA)?'Onbekend':v.TWA>=0?'Stbd':'Port',
      sails:D.L.sailNames[D.L.sail[i]]||'-',sailSlots:D.L.sailSlots?.[D.L.sailState?.[i]] || [],
      race:rc,leg:lg,raceLeg:rc?'R'+rc+'L'+lg:'-',testing:D.L.testing[i],v,spread,coverage};
  }
  function phaseBuild(D,build) {
    if(!build)return D; // Existing sessions retain their phases until explicitly regenerated.
    if(!build.generated) D.phases=[];
    else if (Array.isArray(build.ranges)) {
      const normalized = build.rules?.method === 'normalized';
      D.phases = build.ranges.map(r=>windowPhase(D,r,2)).filter(p=>{
        if (!p || D.invalid.subarray(p.i,p.i1).some(Boolean)) return false;
        if (!normalized) return ['BSP','TWA','TWS'].every(k=>p.coverage[k]>=.95);
        for (let i=p.i; i<p.i1; i++) if (!finite(D.ch.BSP[i]) && !finite(D.ch.SOG?.[i])) return false;
        return true;
      });
    }
    return D;
  }
  const pairKey = (D,m) => m.type+':'+(D.raw.t0+m.i*1000);
  function defaultPair(D,m) { const t=D.raw.t0+m.i*1000; return {key:pairKey(D,m),anchor:t,type:m.type,before:{start:t-80000,end:t-30000},after:{start:t+40000,end:t+90000},approved:false,reason:''}; }
  function inspectPair(D,p,cfg=D.cfg) {
    cfg = {...D.cfg,...cfg};
    const before=windowPhase(D,p.before),after=windowPhase(D,p.after),errors=[];
    if(!before||!after)errors.push('Beide vensters moeten minstens 5 seconden lang zijn en binnen het log liggen.');
    if(p.before?.end>p.anchor-5000||p.after?.start<p.anchor+5000)errors.push('Houd de vensters minimaal 5 seconden van de manoeuvre af.');
    if(!D.mans.some(m=>pairKey(D,m)===p.key))errors.push('Deze manoeuvre wordt niet meer herkend; beoordeel opnieuw.');
    for(const [label,w] of [['Vóór',before],['Na',after]])if(w){
      for(const k of ['BSP','TWA','TWS'])if(w.coverage[k]<.95)errors.push(label+': onvoldoende geldige '+k+'-metingen.');
      if(Array.from(D.invalid.subarray(w.i,w.i1)).some(Boolean))errors.push(label+': bevat ongeldig verklaarde data.');
      if(w.v.BSP<(cfg.minBsp||2))errors.push(label+': te weinig bootsnelheid.');
      for(const [k,limit]of [['BSP',cfg.sdBsp],['TWA',cfg.sdTwa],['TWS',cfg.sdTws],['HDG',cfg.sdHdg??10]])if(finite(w.spread[k])&&w.spread[k]>limit)errors.push(label+': '+k+' is niet stabiel genoeg.');
      for(let i=w.i;i<w.i1;i++)if(D.tack[i]!==D.tack[w.i]||D.L.sailState?.[i]!==D.L.sailState?.[w.i]||D.L.race[i]!==D.L.race[w.i]||D.L.motor?.[i]){errors.push(label+': bevat een boeg-, zeil- of racewissel, of motorgebruik.');break;}
      if(D.mans.some(m=>m.i>=w.i&&m.i<w.i1))errors.push(label+': bevat nog een manoeuvre.');
    }
    if(before&&after){const anchorRace=D.L.race[Math.round((p.anchor-D.raw.t0)/1000)];
      if(before.race!==anchorRace||after.race!==anchorRace)errors.push('De vensters en het draaipunt moeten bij hetzelfde racetijdvak horen.');
      if(before.tack===after.tack)errors.push('De vensters moeten op tegengestelde boegen liggen.');if(before.sails!==after.sails||D.L.sailState?.[before.i]!==D.L.sailState?.[after.i])errors.push('Een zeilwissel tussen de vensters maakt dit paar ongeschikt.');}
    return {before,after,errors,valid:!errors.length};
  }
  function approvedPairs(D,s){return Object.values(s.manoeuvrePairs||{}).filter(p=>p.approved).map(p=>({...inspectPair(D,p,s.phaseBuild?.rules||D.cfg),pair:p})).filter(x=>x.valid && !Object.values(s.reviews||{}).some(r=>(r.invalid||(r.kind==='interval'&&r.calibration===false))&&[x.pair.before,x.pair.after].some(w=>w.start<r.end&&w.end>r.start)));}
  function calibrationReferences(D,s){
    const reserved=Object.values(s.manoeuvrePairs||{}).filter(p=>p.validation).flatMap(p=>[p.before,p.after]);
    const independent=w=>!reserved.some(r=>r.start<D.raw.t0+w.i1*1000&&r.end>w.t);
    const reviewed=approvedPairs(D,s);
    const validationPairs=reviewed.filter(x=>x.pair.validation);
    const pairs=reviewed.filter(x=>!x.pair.validation&&independent(x.before)&&independent(x.after));
    const stablePhases=SL.calibrationPhases(D,s.reviews,s.phaseBuild?.quality).filter(independent);
    const windows=[...stablePhases,...pairs.flatMap(x=>[x.before,x.after])];
    return {phases:[...new Map(windows.map(w=>[w.i+':'+w.i1,w])).values()],stablePhases,pairs,validationPairs};
  }
  // Port and starboard always use the same sign convention, in either turn direction.
  function windPairEvidence(pairs){
    const alignment=[],bands=new Map();
    for(const {pair,before,after,reference} of pairs){
      if(!before||!after||pair.validation||before.tack===after.tack)continue;
      const basis=reference||{before,after};
      const [port,stbd]=basis.before.tack==='Port'?[before,after]:[after,before];
      const angles=[basis.before,basis.after].map(w=>Math.abs(w.v.TWA));
      const up=pair.type==='Tack'&&angles.every(a=>a<=60),down=pair.type==='Gybe'&&angles.every(a=>a>=120);
      if(!up&&!down)continue;
      const covered=k=>[port,stbd].every(w=>w.coverage[k]>=.95&&finite(w.v[k]));
      if(up&&pair.vmgToVmg!==false&&covered('AWA')&&port.v.AWA<0&&stbd.v.AWA>0)
        alignment.push((Math.abs(port.v.AWA)-Math.abs(stbd.v.AWA))/2);
      if(!covered('TWD')||!covered('TWS'))continue;
      const tws=(basis.before.v.TWS+basis.after.v.TWS)/2,band=SL.BANDS.findIndex(([lo,hi])=>tws>=lo&&tws<hi);
      if(band<0)continue;
      const mode=up?'up':'dn',key=mode+':'+band;
      if(!bands.has(key))bands.set(key,{mode,band,errors:[],speeds:[]});
      const group=bands.get(key);
      group.errors.push(SL.w180(port.v.TWD-stbd.v.TWD));
      group.speeds.push(port.v.TWS-stbd.v.TWS);
    }
    return {alignment,bands:[...bands.values()].sort((a,b)=>a.band-b.band||a.mode.localeCompare(b.mode))};
  }
  // Insert a knot on the existing curve without changing the opposite sailing mode.
  function addTableResidual(rows,tws,mode,residual){
    const sorted=rows.map(row=>({...row})).sort((a,b)=>a.tws-b.tws);
    let row=sorted.find(r=>r.tws===tws);
    if(!row){
      const lo=sorted.filter(r=>r.tws<tws).at(-1)||sorted[0],hi=sorted.find(r=>r.tws>tws)||lo;
      const f=lo&&hi.tws!==lo.tws?(tws-lo.tws)/(hi.tws-lo.tws):0;
      row={tws};for(const k of ['up','dn'])row[k]=lo?lo[k]+(hi[k]-lo[k])*f:0;
      sorted.push(row);sorted.sort((a,b)=>a.tws-b.tws);
    }
    row[mode]=Math.round((row[mode]+residual)*10)/10;return sorted;
  }
  function versionInput(s) { const {analysisVersions,reportItems,reportTrash,...input}=copy(s); return input; }
  function pendingCalibration(s) { return !!s.draft && JSON.stringify(s.draft)!==JSON.stringify(s.calib); }
  function validatePreparation(s,D) { if(!D)throw new Error('Importeer eerst een log.');if(!s.phaseBuild?.generated)throw new Error('Maak eerst fases met je gekozen criteria.');if(s.phaseBuild.sourceKey!==eventKey(s))throw new Error('De events of broninstellingen zijn gewijzigd. Maak de fases opnieuw.');if(pendingCalibration(s))throw new Error('Er staat een niet-toegepast kalibratievoorstel. Pas het toe of neem de actieve kalibratie over voordat je opslaat.');if(s.calibrationChanged)throw new Error('Splits de sessie eerst op een constante instrumentkalibratie.'); }
  Object.assign(SL,{windPairEvidence,addTableResidual,phaseDefaults,phaseKeys,phaseBaseKeys,phaseMatchesQuality,eventKey,preparationKey,sampleMatches,windowPhase,phaseBuild,pairKey,defaultPair,inspectPair,approvedPairs,calibrationReferences,versionInput,pendingCalibration,validatePreparation});
})();
