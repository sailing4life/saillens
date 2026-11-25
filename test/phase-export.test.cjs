const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function application() {
  const context = vm.createContext({
    structuredClone, indexedDB: {}, document: {addEventListener() {}},
    $: () => ({}), fin: Number.isFinite, dstr: ms => new Date(ms).toISOString(),
    varList: () => ['BSP', 'BSPpol%', 'VMG%'], A: {cfg: {}, files: {}, scope: 'day'}
  });
  const run = script => vm.runInContext(script, context);
  for (const file of ['core', 'core2', 'core3', 'storage', 'workspace', 'sessionflow', 'app1', 'app2']) {
    run(fs.readFileSync(path.join(__dirname, '../src', file + '.js'), 'utf8'));
  }
  return {context, run};
}

test('phase CSV retains percentages, exports deviations with units and leaves unavailable metrics empty', () => {
  const {context, run} = application();
  const phase = {i:0, i1:30, t:0, tack:'Port', mode:'Reaching', sails:'J2', raceLeg:'-',
    v:{BSP:7,'BSPpol%':102.5,'VMG%':NaN}, spread:{HDG:1.23456, BSP:0, TWA:1.25, TWS:NaN}};
  context.exportPhases = [phase];
  const [header, row] = run('phasesCsv(exportPhases)').split('\r\n').map(line => line.split(','));
  assert.deepEqual(Object.fromEntries(header.map((key,i) => [key,row[i]])), {
    Start:'1970-01-01T00:00:00.000Z', Duration_s:'30', Mode:'Reaching', Tack:'Port', Sails:'J2', RaceLeg:'-',
    BSP:'7', 'BSPpol%':'102.5', 'VMG%':'', 'SD HDG (°)':'1.235', 'SD BSP (kn)':'0', 'SD TWA (°)':'1.25', 'SD TWS (kn)':''
  });
  delete phase.spread;
  assert.ok(!run('phasesCsv(exportPhases)').includes('SD HDG'));
});

test('adding a normalized day to the season stores matching phases and retains a missing tack', () => {
  const {context, run} = application();
  const start = Date.UTC(2026, 10, 8);
  context.csv = ['time,BSP,HDG', ...Array.from({length:80}, (_,i) =>
    [new Date(start+i*1000).toISOString(),i < 40 ? 7 : 3,''].join(','))].join('\n');
  run(`A.S = SL.newSeason();
    const WF = {session:{phaseBuild:{rules:{method:'normalized'}, quality:{minBsp:5}}}};
    WF.phaseMatches = p => SL.phaseMatchesQuality(p, WF.session.phaseBuild.quality);
    A.D = SL.analyse(SL.parseLog(csv), {cfg:{phaseLen:20,phaseGap:0},phaseRules:{method:'normalized'}});
    saveSeasonSnapshot = () => {};
    addDay();`);
  assert.equal(run('A.D.phases.length'), 4);
  assert.equal(run('A.S.days[0].phases.length'), 2);
  assert.equal(run('A.S.days[0].recipe.phaseQuality.minBsp'), 5);
  assert.equal(run('A.S.days[0].sum.sailing'), 80);
  assert.deepEqual(Array.from(run('A.SP'), p => [p.tack,p.v.BSP]), [['Onbekend',7],['Onbekend',7]]);
});
