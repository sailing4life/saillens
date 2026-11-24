'use strict';
(() => {
  // The calibration math is sample-local. Run the same engine on the union of
  // approved seconds, keeping logged gaps, event overrides and physical inputs.
  // Discard its synthetic timeline: reference IDs and any time-dependent
  // information (race, sail, tack, fit windows) always come from the session.
  function preview(D, phases, calib, outputs) {
    const dual = calib.speedos?.enabled ? calib.speedos : null;
    const keys = new Set(['BSP','Heel','HDG', ...outputs]);
    if (outputs.includes('TWA')) for (const k of ['AWA','AWS','TWD','TWA','TWS']) keys.add(k);
    if (dual) for (const k of [dual.port,dual.starboard,dual.selector]) keys.add(k);
    // A crew-defined graph channel may depend on other instruments and the full
    // formula graph. Its ordinary session pipeline is authoritative.
    if (D.formulaDiagnostics?.some(f=>keys.has(f.name))) return null;
    if (!D.raw?.ch || !Number.isInteger(D.n)) return null;

    const ordered=phases.slice().sort((a,b)=>a.i-b.i);
    const ranges=[];
    for (const {i,i1} of ordered) {
      if (!Number.isInteger(i)||!Number.isInteger(i1)||i<D.i0||i1>D.i1||i1<=i) return null;
      const last=ranges.at(-1);
      if (last && i<=last.end) last.end=Math.max(last.end,i1);
      else ranges.push({start:i,end:i1});
    }
    if (!ranges.length) return D;
    const n=ranges.reduce((sum,r)=>sum+r.end-r.start,0), ch=Object.create(null);
    for (const key of keys) {
      const manual=D.L?.manual?.[key], source=manual||D.raw.ch[key];
      if (!source) continue;
      const values=new Float64Array(n), age=!manual&&D.raw.age?.[key];
      let j=0;
      for (const {start,end} of ranges) {
        for (let i=start;i<end;i++,j++) {
          values[j]=D.invalid?.[i] || (age && age[i]>D.cfg.maxHold) ? NaN : source[i];
        }
      }
      ch[key]=values;
    }
    const compact=SL.analyse({n,t0:D.raw.t0,ch},{
      cfg:{...D.cfg,tStart:null,tEnd:null},calib,skipPhases:true
    });
    // Only the requested channels are recomputed. Arrays retain the original
    // sample numbering so a held-out pair can be plotted at its logged times.
    const projected={...D.ch};
    for (const key of outputs) {
      if (!compact.ch[key]) { delete projected[key]; continue; }
      const values=new Float64Array(D.n).fill(NaN);
      let j=0;
      for (const {start,end} of ranges) {
        values.set(compact.ch[key].subarray(j,j+end-start),start);
        j+=end-start;
      }
      projected[key]=values;
    }
    return {...D,ch:projected};
  }

  SL.windPlotPreview=(D,phases,calib)=>preview(D,phases,calib,['AWA','MWA','TWA','TWS','TWD']);
  SL.speedPlotPreview=(D,phases,calib)=>{
    const data=preview(D,phases,calib,['BSP','Heel','HDG','SOG','COG']);
    if (!data) return null;
    const windows=phases.map(p=>{
      const v={...p.v};
      for (const key of ['BSP','Heel','HDG']) {
        const values=data.ch[key]?.subarray(p.i,p.i1);
        v[key]=values ? (key==='HDG'?SL.cmean:SL.mean)(values) : NaN;
      }
      return {...p,v};
    });
    return {data,windows};
  };
})();
