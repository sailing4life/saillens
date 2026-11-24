'use strict';
(() => {
  const {fin, D2R, R2D, w180, w360} = SL;
  const minimumTrackSpeed = .5; // kn, below this a direction is poorly determined
  const interval = 15 * 60 * 1000;
  const scope = phase => phase.sessionId || phase.day || '';
  const phaseKey = p => JSON.stringify([scope(p), p.t, p.i ?? null, p.i1 ?? null]);
  const windowKey = p => JSON.stringify([scope(p), Math.floor(p.t / interval)]);

  function vector(set, drift) {
    if (!fin(drift) || drift < 0) return null;
    if (drift === 0) return {east:0, north:0};
    if (!fin(set) || set < 0 || set > 360) return null;
    return {east:drift * Math.sin(set * D2R), north:drift * Math.cos(set * D2R)};
  }

  // calBsp timestamps each estimated current with its first contributing phase.
  // Only the exact windows that went into that fit get a corrected observation.
  function fittedCurrents(model) {
    const phases = model?.ratio || [], anchor = new Map(), byWindow = new Map();
    for (const {p} of phases) {
      const key = windowKey(p);
      if (!anchor.has(p.t)) anchor.set(p.t, key);
      else if (anchor.get(p.t) !== key) anchor.set(p.t, null);
    }
    for (const current of model?.cur || []) {
      const key = anchor.get(current.t), value = vector(current.dir, current.rate);
      if (key && value) byWindow.set(key, value);
    }
    const byPhase = new Map();
    for (const {p} of phases) {
      const value = byWindow.get(windowKey(p));
      if (value) byPhase.set(phaseKey(p), value);
    }
    return byPhase;
  }

  function loggedVector(D, i) {
    const channels = D.raw?.ch, age = D.raw?.age, limit = D.cfg?.maxHold ?? SL.DEF.maxHold;
    if (!channels?.Set || !channels.Drift || age?.Drift?.[i] > limit) return null;
    const drift = channels.Drift[i];
    if (drift !== 0 && age?.Set?.[i] > limit) return null;
    return vector(channels.Set[i], drift);
  }

  // Evaluate the same signed residual twice, over ground and through water.
  // A zero current leaves SOG usable even if no course was logged.
  function residual(sog, cog, instrument, flow, headingPlot) {
    if (!flow || !fin(instrument) || !fin(sog) || sog < 0 || (!headingPlot && instrument < 0)) return NaN;
    if (!headingPlot && flow.east === 0 && flow.north === 0) return sog - instrument;
    const ground = vector(cog, sog);
    if (!ground) return NaN;
    const east = ground.east - flow.east, north = ground.north - flow.north, speed = Math.hypot(east, north);
    if (!headingPlot) return speed - instrument;
    if (sog < minimumTrackSpeed || speed < minimumTrackSpeed) return NaN;
    return w180(instrument - Math.atan2(east, north) * R2D);
  }

  const still = {east:0, north:0};
  function meanResidual(values, expectedCount, headingPlot) {
    if (!values.length || values.length < .95 * expectedCount) return NaN;
    if (!headingPlot) return SL.mean(values);
    let sin = 0, cos = 0;
    for (const angle of values) {sin += Math.sin(angle * D2R); cos += Math.cos(angle * D2R);}
    return Math.hypot(sin, cos) > 1e-9 * values.length ? w180(Math.atan2(sin, cos) * R2D) : NaN;
  }

  function phaseResidual(D, p, mode, current, variation, headingPlot) {
    const key = headingPlot ? 'HDG' : 'BSP', offset = headingPlot ? variation : 0;
    if (!D.ch || !Number.isInteger(p.i) || !Number.isInteger(p.i1)) {
      // Imported summaries have no synchronized samples for a logged-current estimate.
      const instrument = fin(p.v[key]) ? p.v[key] + offset : NaN;
      const raw = residual(p.v.SOG, p.v.COG, instrument, still, headingPlot);
      const corrected = residual(p.v.SOG, p.v.COG, instrument, current, headingPlot);
      return {raw, corrected, flow:fin(corrected) ? current : null};
    }
    const rawValues = [], correctedValues = [];
    let east = 0, north = 0;
    for (let i = p.i; i < p.i1; i++) {
      if (D.invalid?.[i]) continue;
      const sog = D.ch.SOG?.[i], cog = D.ch.COG?.[i], input = D.ch[key]?.[i];
      if (!fin(input)) continue;
      const instrument = input + offset;
      const raw = residual(sog, cog, instrument, still, headingPlot);
      if (fin(raw)) rawValues.push(raw);
      const time = p.t + (i - p.i) * 1000;
      if (mode === 'model' && Math.floor(time / interval) !== Math.floor(p.t / interval)) continue;
      const flow = mode === 'logged' ? loggedVector(D, i) : current;
      const corrected = residual(sog, cog, instrument, flow, headingPlot);
      if (fin(corrected)) {
        correctedValues.push(corrected);
        east += flow.east;
        north += flow.north;
      }
    }
    const count = p.i1 - p.i;
    const corrected = meanResidual(correctedValues,count,headingPlot);
    const flow = fin(corrected) ? {east:east / correctedValues.length, north:north / correctedValues.length} : null;
    return {raw:meanResidual(rawValues,count,headingPlot), corrected, flow};
  }

  function calibrationResiduals(D, phases, bspModel, kind, options = {}) {
    const mode = options.mode ?? 'model', headingPlot = kind === 'heading';
    const fit = mode === 'model' ? fittedCurrents(bspModel) : null;
    const manual = mode === 'manual' ? vector(options.set, options.drift) : null;
    const configured = D.cfg?.magVar;
    const variation = fin(configured) ? configured : 0, rows = [];
    for (const p of phases) {
      if (!fin(p.t)) continue;
      const {BSP:bsp, Heel:heel, HDG:hdg} = p.v;
      const heading = fin(hdg) ? w360(hdg + variation) : NaN;
      const current = mode === 'model' ? fit.get(phaseKey(p)) : manual;
      const {raw, corrected, flow} = phaseResidual(D,p,mode,current,variation,headingPlot);
      const currentDrift = flow ? Math.hypot(flow.east, flow.north) : NaN;
      const currentSet = currentDrift > 1e-9 ? w360(Math.atan2(flow.east, flow.north) * R2D) : NaN;
      if (fin(raw) || fin(corrected)) rows.push({
        t:p.t, i:p.i, i1:p.i1, raw, corrected, side:p.tack, source:fin(corrected) ? mode : null,
        heading, bsp, heel, currentDrift, currentSet
      });
    }
    rows.sort((a, b) => a.t - b.t);

    const notes = [];
    if (mode === 'model') notes.push('Stroom uit de BSP-fit per kwartier, uitsluitend voor de gebruikte referenties. De fit gebruikt dezelfde GPS- en instrumentmetingen.');
    if (mode === 'manual' && manual) notes.push('Vaste stroom voor alle getoonde referenties: ' + options.drift + ' kn' + (options.drift ? ' naar ' + options.set + '° waar.' : '.'));
    if (mode === 'logged') notes.push('Set en Drift uit het log, als stroomrichting waarheen in °T en snelheid in kn. Een fase vereist 95% gepaarde dekking. De logger kan deze stroom zelf uit BSP en GPS afleiden.');
    if (fin(configured)) notes.push('HDG gebruikt de ingestelde variatie van ' + configured + '° (oost positief).');
    else notes.push('HDG volgt de noordreferentie van het log. Stel bij magnetische HDG de variatie in bij Setup voor vergelijking met ware GPS-koersen.');
    if (headingPlot) notes.push('Positief = HDG rechtsom van de referentiekoers. Ook na stroomcorrectie telt leeway mee. Koersen bij minder dan 0,5 kn zijn onzeker.');
    let issue = '';
    if (!phases.length) issue = 'Keur stabiele fases of manoeuvrevensters goed om restfouten te vergelijken.';
    else if (mode === 'manual' && !manual) issue = 'Vul een geldige stroomrichting (0–360° waar) en een niet-negatieve stroomsnelheid in.';
    else if (!rows.length) issue = headingPlot ? 'Geen bruikbare HDG- en GPS-koers in de gekozen referenties.' : 'Geen bruikbare BSP en SOG in de gekozen referenties.';
    else if (!rows.some(row => fin(row.corrected))) {
      if (mode === 'model' && !fit.size) issue = 'De lokale stroomfit heeft onvoldoende referenties met verschillende vaarrichtingen.';
      else if (mode === 'logged') issue = 'Onvoldoende gelijktijdige geldige GPS- en Set/Drift-metingen voor stroomcorrectie.';
      else issue = 'Onvoldoende geldige koers- of snelheidsmetingen voor stroomcorrectie.';
    }
    return {kind, rows, issue, reference:notes.join(' ')};
  }
  SL.calibrationResiduals = calibrationResiduals;
})();
