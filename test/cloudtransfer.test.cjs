const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto, createHash} = require('node:crypto');

function client(api, withProjectReader = false) {
  const context = vm.createContext({SL:{}, crypto:webcrypto, fetch:api, TextEncoder, TextDecoder,
    Blob, Response, CompressionStream, DecompressionStream, btoa, structuredClone, Uint8Array, Float64Array, Uint32Array});
  const files = withProjectReader ? ['core', 'core2', 'core3', 'formulas', 'workspace', 'cloudtransfer'] : ['cloudtransfer'];
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), context);
  }
  return vm.runInContext('SL', context);
}
function server() {
  const blobs = new Map(), calls = [], sessions = new Map();
  const json = (value, status = 200) => Response.json(value, {status});
  return {blobs, calls, sessions, async fetch(url, opt) {
    const {method, body, headers} = opt;
    calls.push({url, method});
    const [,, , id, op, hash] = url.split('/');
    const token = headers.Authorization.slice(7);
    if (!id) {
      const key = JSON.parse(body).id;
      if (!sessions.has(key)) sessions.set(key, {token, revision:0, manifest:null});
      return sessions.get(key).token === token ? json({revision:sessions.get(key).revision}) : json({},403);
    }
    const entry = sessions.get(id);
    if (!entry || entry.token !== token) return json({},404);
    if (method === 'HEAD') return new Response(null, {headers:{'X-Session-Revision':String(entry.revision)}});
    if (op === 'missing') return json({missing:JSON.parse(body).hashes.filter(h => !blobs.has(h))});
    if (op === 'blobs' && method === 'PUT') {
      assert.equal(hash, createHash('sha256').update(body).digest('hex'));
      assert.ok(body.length > 0 && body.length <= 4 * 1024 * 1024); blobs.set(hash, body.slice()); return json({});
    }
    if (op === 'blobs') return new Response(blobs.get(hash));
    if (method === 'GET') return json({revision:entry.revision, manifest:entry.manifest});
    const data = JSON.parse(body);
    assert.ok(data.hashes.every(h => blobs.has(h)));
    if (data.baseRevision !== entry.revision) return json({error:'Oudere versie'}, 409);
    entry.manifest = data.manifest; return json({revision:++entry.revision});
  }};
}
test('two clients share typed arrays, immutable source files, settings and analysis versions across revisions', async () => {
  const api = server(), a = client(api.fetch), b = client(api.fetch), remote = a.newCloudRemote();
  assert.equal(remote.token.length, 43);
  assert.equal((await a.cloudCreate(remote)).revision, 0);
  assert.equal((await a.cloudPull(remote)).payload, null);
  const source = 'x'.repeat(1024 * 1024 - 1) + '🎣' + '\n22.255,0'.repeat(400000) + '\u0000\ud800';
  const wide = new Uint32Array(524294);
  wide.set([19, 31, 62, 22, 78], 524287);
  const raw = {twa:new Float64Array([-30,NaN,Infinity,-0,42]), empty:new Uint32Array(0), wide:wide.subarray(2)};
  const payload = {sources:[source], signature:source, raw, old:{sources:[source], raw}, prefs:{draft:undefined, zero:-0}, '$sl':'value'};
  assert.equal((await a.cloudPush(remote,payload,0)).revision, 1);
  const existing = await b.cloudPull(remote);
  assert.equal(existing.revision, 1);
  assert.equal(existing.payload.sources[0], source);
  assert.equal(existing.payload.old.sources[0], source);
  assert.deepEqual(existing.payload.raw.twa, raw.twa);
  assert.equal(existing.payload.raw.empty.length, 0);
  assert.deepEqual(existing.payload.raw.wide, raw.wide);
  assert.equal(existing.payload.$sl, 'value');
  assert.deepEqual(Object.keys(existing.payload), Object.keys(payload));
  assert.deepEqual(Object.keys(existing.payload.raw), Object.keys(raw));
  assert.ok(Object.hasOwn(existing.payload.prefs, 'draft'));
  assert.ok(Object.is(existing.payload.prefs.zero, -0));
  assert.notEqual(existing.payload.old.raw.twa, existing.payload.raw.twa);
  const firstUploads = api.calls.filter(c => c.method === 'PUT' && c.url.includes('/blobs/')).length;
  existing.payload.note = 'Tweede computer'; await b.cloudPush(remote, existing.payload, 1);
  const nextUploads = api.calls.filter(c => c.method === 'PUT' && c.url.includes('/blobs/')).length;
  assert.equal(nextUploads - firstUploads, 1); // only updated metadata
  assert.equal((await a.cloudVersion(remote)).revision, 2);
  assert.equal(api.calls.at(-1).method, 'HEAD');
  await assert.rejects(a.cloudPush(remote,payload,1), err => err.status === 409);
  assert.equal((await a.cloudPull(remote)).payload.note, 'Tweede computer');
  await assert.rejects(b.cloudVersion({...remote,token:b.newCloudRemote().token}), e => e.status === 404);
});
test('download verifies chunks and refuses damaged bytes before handing a session to the UI', async () => {
  const api = server(), a = client(api.fetch), r = a.newCloudRemote();
  await a.cloudCreate(r); await a.cloudPush(r, {source:'data'.repeat(1024)},0);
  const hash = api.sessions.get(r.id).manifest.root[0][0];
  api.blobs.set(hash,new Uint8Array([42]));
  await assert.rejects(a.cloudPull(r), /Controle/);
});

test('a project backup from before analysis versions can still be reopened and analysed on a second device', async () => {
  const api = server(), a = client(api.fetch, true), b = client(api.fetch, true);
  const boat = a.newBoat('J/109'), session = a.newSession(boat, 'Ochtendtraining');
  const source = ['Time,BSP,TWA,TWS,HDG', ...Array.from({length:90}, (_, i) =>
    [new Date(Date.UTC(2026,10,18,10,0,i)).toISOString(), i === 10 ? '' : 7, 45, 12, 270].join(','))].join('\n');
  session.raw = a.parseLog(source);
  session.sources = [{name:'training.csv', text:source}];
  session.calib.bspK = 1.025;
  for (const key of ['analysisVersions', 'phaseBuild', 'reportItems']) delete session[key];
  const backup = a.encodeProject({app:'SailLens',type:'project',version:1,boats:[boat],sessions:[session]});
  const imported = a.decodeProject(backup);
  const remote = a.newCloudRemote();
  await a.cloudCreate(remote);
  await a.cloudPush(remote, {app:'SailLens',type:'cloud-session',version:1,boat:imported.boats[0],session:imported.sessions[0]}, 0);
  const restored = b.validateSession((await b.cloudPull(remote)).payload.session);
  assert.equal(b.encodeProject(restored), a.encodeProject(imported.sessions[0]));
  assert.ok(!Object.hasOwn(restored, 'phaseBuild'));
  const run = (sl, s) => sl.analyse(s.raw, {cfg:s.cfg,calib:s.calib});
  const before = run(a, imported.sessions[0]), after = run(b, restored);
  assert.ok(before.phases.length > 0);
  assert.deepEqual(after.ch.BSP, before.ch.BSP);
  assert.deepEqual(JSON.stringify(after.phases), JSON.stringify(before.phases));
});

test('revision checks require a valid response header and share decoding limits with local writes', async () => {
  const api = server(), a = client(api.fetch), remote = a.newCloudRemote();
  await a.cloudCreate(remote);
  for (const header of [null, '-1', 'v1', '9007199254740992']) {
    const b = client(async () => new Response(null, {headers:header ? {'X-Session-Revision':header} : {}}));
    await assert.rejects(b.cloudVersion(remote), /Ongeldige/);
  }
  for (const field of ['__proto__', 'prototype', 'constructor']) {
    const obj = Object.fromEntries([[field, true]]);
    await assert.rejects(a.cloudPush(remote, obj, 0), /Ongeldige/);
  }
  // This stands in for a previous app producing malformed metadata. The reader
  // validates keys, depth, and total bytes before allocating any channel arrays.
  const wire = tree => {
    const bytes = new TextEncoder().encode(JSON.stringify(tree));
    const hash = createHash('sha256').update(bytes).digest('hex');
    api.blobs.set(hash, bytes);
    Object.assign(api.sessions.get(remote.id), {revision:1, manifest:{version:1,root:[[hash,bytes.length]]}});
  };
  wire({$sl:'object', entries:[['constructor', true]]});
  await assert.rejects(a.cloudPull(remote), /Ongeldige/);
  const deep = Array.from({length:130}).reduce(item => [item], 0);
  wire(deep);
  await assert.rejects(a.cloudPull(remote), /Ongeldige/);
  wire({$sl:'typed',name:'Float64Array',refs:Array(65).fill(['a'.repeat(64), 2 * 1024 * 1024])});
  await assert.rejects(a.cloudPull(remote), /Ongeldige/);
});
