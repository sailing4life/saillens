'use strict';
/* Stable preparation boundaries and independently reviewed calibration windows. */
(() => {
  const finite = Number.isFinite, copy = SL.copy;
  const phaseKeys = ['phaseLen','phaseGap','minBsp','sdTwa','sdBsp','sdTws','sdHdg','manBefore','manAfter','polMin','polMax'];
  function phaseDefaults(cfg) { return { ...Object.fromEntries(phaseKeys.map(k => [k, cfg[k] ?? (k === 'sdHdg' ? 10 : SL.DEF[k])])), scope:'all', race:'', sail:'', mode:'', tack:'', range:null }; }
  const eventKey = s => JSON.stringify({sources:s.sources.map(x=>x.hash), raw:s.raw && [s.raw.t0,s.raw.n], events:(s.events?.events||[]).filter(e=>e.type!=='MiscEvent').map(({type,tl,attr})=>[type,tl,attr]), turns:s.turnEdits?.length?s.turnEdits:undefined, clocks:[s.cfg.logOff,s.cfg.evOff,s.cfg.evShiftSec,s.cfg.tStart,s.cfg.tEnd,s.cfg.maxHold,s.cfg.useEvents], channels:s.profile.channels});
  const preparationKey = s => JSON.stringify({source:eventKey(s), annotations:(s.events?.events||[]).map(e=>[e.type,e.tl,e.comments]),cfg:s.cfg, profile:s.profile, polar:s.polar, chart:s.chart, calib:s.calib, baseline:s.baseline, changed:s.calibrationChanged, reviews:s.reviews, phases:s.phaseBuild, pairs:s.manoeuvrePairs});
  function sampleMatches(D,i,f={}) { const t=D.raw.t0+i*1000; return i>=D.i0&&i<D.i1 && (!f.range || (t>=f.range.start&&t<f.range.end)) && (!f.race || String(D.L.race[i])===String(f.race)) && (!f.sail || D.L.sailNames[D.L.sail[i]]===f.sail) && (!f.mode || SL.MODES[D.mode[i]]===f.mode) && (!f.tack || (D.tack[i]>0?'Stbd':'Port')===f.tack) && (f.scope!=='racing'||D.L.race[i]>0) && (f.scope!=='training'||D.L.testing[i]>0) && !D.L.motor?.[i]; }
  const angle = (D,k) => SL.ANG.test(k) || ['TWA','AWA'].includes(k) || D.formulaAngles?.includes(k);
  function windowPhase(D,r) {
    if (!r || !finite(r.start)||!finite(r.end)||r.end<=r.start) return null;
    const i=Math.round((r.start-D.raw.t0)/1000), i1=Math.round((r.end-D.raw.t0)/1000);
    if(i<D.i0||i1>D.i1||i1-i<5)return null;
    const v={},spread={},coverage={};
    for(const [k,a] of Object.entries(D.ch)) { const vals=Array.from(a.subarray(i,i1)).filter(finite); coverage[k]=vals.length/(i1-i); v[k]=(angle(D,k)?SL.cmean:SL.mean)(vals); if(['TWA','AWA'].includes(k))v[k]=SL.w180(v[k]); spread[k]=angle(D,k)?SL.sd(vals.map(x=>SL.w180(x-v[k]))):SL.sd(vals); }
    const rc=D.L.race[i],lg=D.L.leg[i];
    return {i,i1,t:r.start,mode:SL.MODES[D.mode[i]],tack:v.TWA>=0?'Stbd':'Port',sails:D.L.sailNames[D.L.sail[i]]||'-',race:rc,leg:lg,raceLeg:rc?'R'+rc+'L'+lg:'-',testing:D.L.testing[i],v,spread,coverage};
  }
  function phaseBuild(D,build) {
    if(!build)return D; // Existing sessions retain their phases until explicitly regenerated.
    if(!build.generated) D.phases=[];
    else if(Array.isArray(build.ranges)) D.phases=build.ranges.map(r=>windowPhase(D,r)).filter(p=>p && ['BSP','TWA','TWS'].every(k=>p.coverage[k]>=.95) && !Array.from(D.invalid.subarray(p.i,p.i1)).some(Boolean));
    return D;
  }
  const pairKey = (D,m) => m.type+':'+(D.raw.t0+m.i*1000);
  function defaultPair(D,m) { const t=D.raw.t0+m.i*1000; return {key:pairKey(D,m),anchor:t,type:m.type,before:{start:t-80000,end:t-30000},after:{start:t+40000,end:t+90000},approved:false,reason:''}; }
  function inspectPair(D,p,cfg=D.cfg) {
    const before=windowPhase(D,p.before),after=windowPhase(D,p.after),errors=[];
    if(!before||!after)errors.push('Beide vensters moeten minstens 5 seconden lang zijn en binnen het log liggen.');
    if(p.before?.end>p.anchor-5000||p.after?.start<p.anchor+5000)errors.push('Houd de vensters minimaal 5 seconden van de manoeuvre af.');
    if(!D.mans.some(m=>pairKey(D,m)===p.key))errors.push('Deze manoeuvre wordt niet meer herkend; beoordeel opnieuw.');
    for(const [label,w] of [['Vóór',before],['Na',after]])if(w){
      for(const k of ['BSP','TWA','TWS'])if(w.coverage[k]<.95)errors.push(label+': onvoldoende geldige '+k+'-metingen.');
      if(Array.from(D.invalid.subarray(w.i,w.i1)).some(Boolean))errors.push(label+': bevat ongeldig verklaarde data.');
      if(w.v.BSP<(cfg.minBsp||2))errors.push(label+': te weinig bootsnelheid.');
      for(const [k,limit]of [['BSP',cfg.sdBsp],['TWA',cfg.sdTwa],['TWS',cfg.sdTws],['HDG',cfg.sdHdg??10]])if(finite(w.spread[k])&&w.spread[k]>limit)errors.push(label+': '+k+' is niet stabiel genoeg.');
      for(let i=w.i;i<w.i1;i++)if(D.tack[i]!==D.tack[w.i]||D.L.sail[i]!==D.L.sail[w.i]||D.L.race[i]!==D.L.race[w.i]||D.L.motor?.[i]){errors.push(label+': bevat een boeg-, zeil- of racewissel, of motorgebruik.');break;}
      if(D.mans.some(m=>m.i>=w.i&&m.i<w.i1))errors.push(label+': bevat nog een manoeuvre.');
    }
    if(before&&after){if(before.tack===after.tack)errors.push('De vensters moeten op tegengestelde boegen liggen.');if(before.sails!==after.sails)errors.push('Een zeilwissel tussen de vensters maakt dit paar ongeschikt.');}
    return {before,after,errors,valid:!errors.length};
  }
  function approvedPairs(D,s){return Object.values(s.manoeuvrePairs||{}).filter(p=>p.approved).map(p=>({...inspectPair(D,p,s.phaseBuild?.rules||D.cfg),pair:p})).filter(x=>x.valid && !Object.values(s.reviews||{}).some(r=>(r.invalid||(r.kind==='interval'&&r.calibration===false))&&[x.pair.before,x.pair.after].some(w=>w.start<r.end&&w.end>r.start)));}
  function calibrationReferences(D,s){const reserved=Object.values(s.manoeuvrePairs||{}).filter(p=>p.validation).flatMap(p=>[p.before,p.after]);const independent=w=>!reserved.some(r=>r.start<D.raw.t0+w.i1*1000&&r.end>w.t);const pairs=approvedPairs(D,s).filter(x=>!x.pair.validation&&independent(x.before)&&independent(x.after)),ps=SL.calibrationPhases(D,s.reviews).filter(independent);const all=[...ps,...pairs.flatMap(x=>[x.before,x.after])];return {phases:[...new Map(all.map(p=>[p.i+':'+p.i1,p])).values()],pairs};}
  function versionInput(s) { const {analysisVersions,reportItems,reportTrash,...input}=copy(s); return input; }
  function pendingCalibration(s) { return !!s.draft && JSON.stringify(s.draft)!==JSON.stringify(s.calib); }
  function validatePreparation(s,D) { if(!D)throw new Error('Importeer eerst een log.');if(!s.phaseBuild?.generated)throw new Error('Maak eerst fases met je gekozen criteria.');if(s.phaseBuild.sourceKey!==eventKey(s))throw new Error('De events of broninstellingen zijn gewijzigd. Maak de fases opnieuw.');if(pendingCalibration(s))throw new Error('Er staat een niet-toegepast kalibratievoorstel. Pas het toe of neem de actieve kalibratie over voordat je opslaat.');if(s.calibrationChanged)throw new Error('Splits de sessie eerst op een constante instrumentkalibratie.'); }
  Object.assign(SL,{phaseDefaults,phaseKeys,eventKey,preparationKey,sampleMatches,windowPhase,phaseBuild,pairKey,defaultPair,inspectPair,approvedPairs,calibrationReferences,versionInput,pendingCalibration,validatePreparation});
})();
