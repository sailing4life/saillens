'use strict';
(() => {
  const {fin, w180, w360, D2R, R2D} = SL;
  const sources = ['HDG', 'Course', 'COG'];
  const bearing = value => fin(value) && value >= 0 && value <= 360;
  const windAngle = value => fin(value) && value >= -180 && value <= 360;
  const covered = (samples, window) => samples.length >= .95 * (window.i1 - window.i);

  function circularMean(values) {
    let sin = 0, cos = 0;
    for (const value of values) {
      sin += Math.sin(value * D2R);
      cos += Math.cos(value * D2R);
    }
    return Math.hypot(sin, cos) > 1e-8 * values.length ? w360(Math.atan2(sin, cos) * R2D) : NaN;
  }

  function samples(D, window, source) {
    const indices = [], sign = window.tack === 'Port' ? -1 : 1;
    for (let i = window.i; i < window.i1; i++) {
      const twa = D.ch.TWA?.[i], tws = D.ch.TWS?.[i];
      if (D.invalid?.[i] || !windAngle(twa) || !fin(tws) || tws < 0) continue;
      const signed = w180(twa) * sign;
      // A changed wind calibration can move the samples across the tack line.
      if (signed <= 0 || signed === 180) return [];
      if (!bearing(D.ch[source]?.[i])) continue;
      if (source === 'COG' && D.ch.SOG && (!fin(D.ch.SOG[i]) || D.ch.SOG[i] < .5)) continue;
      indices.push(i);
    }
    return indices;
  }

  // Mirrors the input precedence in analyse(). An instrument TWD may itself
  // have been calculated on board; 'log' describes its provenance only.
  function windSource(D, i) {
    if (D.formulaDiagnostics?.some(f => f.name === 'TWD')) return 'formula';
    if (D.L?.manual?.TWD) return fin(D.L.manual.TWD[i]) ? 'manual' : 'derived';
    if (!D.raw?.ch) return 'unknown';
    return fin(D.raw.ch.TWD?.[i]) && !(D.raw.age?.TWD?.[i] > (D.cfg?.maxHold ?? SL.DEF.maxHold)) ? 'log' : 'derived';
  }

  function legMeans(D, window, source, indices) {
    const ch = D.ch, variation = D.cfg?.magVar ?? D.magVar ?? 0;
    const getBearing = i => w360(ch[source][i] + (source === 'COG' ? 0 : variation));
    const getTwd = i => w360(ch.TWD[i] + variation);
    const meanBearing = circularMean(indices.map(getBearing));
    const twa = w180(circularMean(indices.map(i => ch.TWA[i])));
    if (!fin(meanBearing) || !fin(twa) || Math.abs(twa) >= 90) return null;

    const targets = indices.map(i => ch.Target_TWA?.[i]).filter(windAngle).map(x => Math.abs(w180(x))).filter(x => x > 0 && x < 90);
    const leeway = indices.map(i => ch.Leeway?.[i]).filter(x => fin(x) && Math.abs(x) < 90);
    const withWind = indices.filter(i => bearing(ch.TWD?.[i]));
    const hasWind = covered(withWind, window);
    const origins = hasWind ? new Set(withWind.map(i => windSource(D, i))) : new Set();
    return {
      n:indices.length, bearing:meanBearing, twa,
      target:covered(targets, window) ? SL.mean(targets) : NaN,
      leeway:covered(leeway, window) ? SL.mean(leeway) : NaN,
      twd:hasWind ? circularMean(withWind.map(getTwd)) : NaN,
      windSource:!hasWind ? 'missing' : origins.size === 1 ? origins.values().next().value : 'mixed',
      windBearing:hasWind ? circularMean(withWind.map(getBearing)) : NaN,
      windCount:hasWind ? withWind.length : 0,
      closureSum:hasWind ? withWind.reduce((sum, i) => sum + Math.abs(w180(getTwd(i) - getBearing(i) - ch.TWA[i])), 0) : NaN
    };
  }

  function geometry(D, port, stbd, source, portSeconds, stbdSeconds) {
    if (!covered(portSeconds, port) || !covered(stbdSeconds, stbd)) return null;
    const p = legMeans(D, port, source, portSeconds), s = legMeans(D, stbd, source, stbdSeconds);
    if (!p || !s) return null;
    const angle = w180(p.bearing - s.bearing);
    // Upwind on opposite tacks, the port bearing is clockwise from starboard.
    // Coincident, opposite or reversed bearings have no identifiable upwind bisector.
    if (angle <= 1e-8 || angle >= 180 - 1e-8) return null;
    const axis = w360(s.bearing + angle / 2), twaSum = s.twa - p.twa, residual = angle - twaSum;
    const twdDelta = w180(p.twd - s.twd);
    const twd = Math.abs(twdDelta) < 180 - 1e-8 ? w360(s.twd + twdDelta / 2) : NaN;
    const windTurn = w180(p.windBearing - s.windBearing);
    const windAxis = windTurn > 1e-8 && windTurn < 180 - 1e-8 ? w360(s.windBearing + windTurn / 2) : NaN;
    let twdSource = p.windSource === s.windSource ? p.windSource : 'mixed';
    if (!p.windCount || !s.windCount) twdSource = 'missing';
    return {
      port:p.bearing, stbd:s.bearing, angle, axis, twaPort:p.twa, twaStbd:s.twa, twaSum,
      residual, halfResidual:residual / 2, targetHalf:(p.target + s.target) / 2,
      leewayPort:p.leeway, leewayStbd:s.leeway,
      twd, twdDelta, twdAxisDelta:w180(windAxis - twd), twdSource,
      closure:(p.closureSum + s.closureSum) / (p.windCount + s.windCount), nPort:p.n, nStbd:s.n
    };
  }

  function tackAngleData(D, refs, proposal = D, windData) {
    proposal ||= D;
    // Reuse the wind review's decisions about approval, races, sail changes,
    // motor use, overlapping held-out windows and trustworthy opposite sides.
    const references = [...(refs.pairs || []), ...(refs.validationPairs || [])];
    const windows = new Map(references.filter(x => x?.before && x.after && x.pair && x.valid !== false && x.pair.approved !== false && !x.pair.rejected)
      .map(x => [x.pair.key, x]));
    const wind = windData || SL.windPlotData(D, {pairs:refs.pairs, validationPairs:refs.validationPairs}, proposal);
    const rows = [];
    for (const pair of wind.pairs) {
      const ref = windows.get(pair.key);
      if (!ref || pair.type !== 'Tack' || pair.mode !== 'up') continue;
      const {before, after} = ref;
      const [port, stbd] = before.tack === 'Port' ? [before, after] : [after, before];
      const active = {}, proposed = {};
      for (const source of sources) {
        let pi = samples(D, port, source), si = samples(D, stbd, source);
        if (proposal !== D) {
          const pp = new Set(samples(proposal, port, source)), ps = new Set(samples(proposal, stbd, source));
          const sharedPort = pi.filter(i => pp.has(i)), sharedStbd = si.filter(i => ps.has(i));
          proposed[source] = geometry(proposal, port, stbd, source, sharedPort, sharedStbd);
          if (proposed[source]) { pi = sharedPort; si = sharedStbd; }
        }
        active[source] = geometry(D, port, stbd, source, pi, si);
        if (proposal === D) proposed[source] = active[source];
      }
      rows.push({key:pair.key, t:pair.t, sail:pair.sail, tws:pair.tws, validation:pair.validation,
        vmgToVmg:pair.vmgToVmg, direction:before.tack + ' → ' + after.tack, targetSource:D.polarSrc, active, proposed});
    }
    return {rows};
  }
  SL.tackAngleData = tackAngleData;
})();
