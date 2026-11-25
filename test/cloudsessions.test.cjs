const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/cloudsessions.js'), 'utf8');
const remote = {id:'04cd28fe-273d-4ee7-a08b-ee997b449fad',token:'a'.repeat(43)};
const sessionId = 'my-local-session';
function device({server, disk = new Map(), initial = 100}) {
  let updated = disk.get('time') ?? initial, stamp = 0, dirty = false;
  const copies = [], events = [];
  const api = {
    newCloudRemote:() => remote,
    cloudCreate:async () => ({revision:server.revision}),
    cloudVersion:async () => ({revision:server.revision}),
    cloudPull:async () => { const result = {revision:server.revision,payload:structuredClone(server.payload)};
      await server.readGate?.(); return result; },
    cloudPush:async (_, payload, base) => {
      await server.writeGate?.();
      if (base !== server.revision) throw Object.assign(Error('Conflict'),{status:409});
      server.payload = structuredClone(payload); server.revision++;
      return {revision:server.revision};
    }
  };
  const context = {SL:api, document:{querySelectorAll:()=>[],hidden:false}, location:{protocol:'https:'}, setTimeout:()=>0,clearTimeout:()=>{},URL};
  vm.runInNewContext(source, context);
  const db = {get:async key => disk.get(key),set:async (key,value) => disk.set(key,value),
    getOrSet:async (key,value) => { if (!disk.has(key)) disk.set(key,value); return disk.get(key); }};
  const payload = () => ({app:'SailLens',type:'cloud-session',version:1,boat:{name:'Yacht'},session:{id:sessionId,updated}});
  const cloud = api.createCloudSessions({db,currentId:()=>sessionId,editStamp:()=>stamp,isDirty:()=>dirty,
    flushLocal:async()=>{},readPayload:async()=>payload(),localTime:()=>updated,
    applyRemote:async (data, options) => {
      if (!options.stillCurrent()) return false;
      if (options.preserveCopy) copies.push(payload());
      updated = data.session.updated; disk.set('time',updated);
      await db.set(...options.metaEntry); events.push('apply'); return true;
    }});
  return {cloud,disk,copies,events,edit(time,{commit=true}={}) { updated=time;stamp++;
    if(commit){disk.set('time',time);cloud.committed(sessionId,time);}else dirty=true;
  }};
}
function delayed() {
  let proceed, start;
  const started = new Promise(resolve=>{start=resolve;});
  const wait = new Promise(resolve=>{proceed=resolve;});
  return {started,proceed,gate:()=>{start();return wait;}};
}

test('a committed change survives restart and a local clock behind the first computer', async()=>{
  const server={revision:0}; const a=device({server}); await a.cloud.publish();
  const b=device({server,initial:100}); await b.cloud.join(remote);
  b.edit(75);
  const restarted=device({server,disk:b.disk});
  await restarted.cloud.refresh(sessionId,true);
  assert.equal(server.revision,2); assert.equal(server.payload.session.updated,75);
});
test('conflicting local data stays available and reconciliation preserves a separate copy', async()=>{
  const server={revision:0}; const a=device({server}), b=device({server});
  await a.cloud.publish(); await b.cloud.join(remote);
  b.edit(200); await b.cloud.refresh(sessionId,true);
  a.edit(300); await assert.rejects(a.cloud.refresh(sessionId,true),{status:409});
  assert.equal(a.disk.get('time'),300); assert.equal(server.payload.session.updated,200);
  await a.cloud.resolveConflict();
  assert.equal(a.copies[0].session.updated,300); assert.equal(a.disk.get('time'),200);
});
test('an input edited while a foreground refresh is downloading prevents replacing the working session',async()=>{
  const server={revision:0}; const a=device({server}), b=device({server});
  await a.cloud.publish(); await b.cloud.join(remote); b.edit(200); await b.cloud.refresh(sessionId,true);
  const delay=delayed();server.readGate=delay.gate;
  const task=a.cloud.refresh(sessionId,true); await delay.started; a.edit(300,{commit:false}); delay.proceed(); await task;
  assert.deepEqual(a.events,[]);
});
test('an edit committed during upload is included in the next revision',async()=>{
  const server={revision:0};const a=device({server});await a.cloud.publish();
  a.edit(200);const delay=delayed();server.writeGate=delay.gate;
  const task=a.cloud.refresh(sessionId,true);await delay.started;a.edit(300);delay.proceed();await task;
  assert.equal(server.payload.session.updated,200);await a.cloud.refresh(sessionId,true);
  assert.equal(server.payload.session.updated,300);assert.equal(server.revision,3);
});

test('opening an invite cannot roll back the newer revision of an in-flight local upload',async()=>{
  const server={revision:0}; const a=device({server}); await a.cloud.publish();
  a.edit(200); const writing=delayed(); server.writeGate=writing.gate;
  const push=a.cloud.refresh(sessionId,true); await writing.started;
  const reading=delayed(); server.readGate=reading.gate;
  const opening=a.cloud.join(remote); await reading.started;
  writing.proceed(); await push; reading.proceed(); await opening;
  assert.equal(server.revision,2); assert.equal(a.disk.get('time'),200);
  assert.equal(a.disk.get('cloud:session:'+sessionId).revision,2);
});

test('retrying a join keeps an outstanding local conflict until the local copy is explicitly saved',async()=>{
  const server={revision:0}; const a=device({server}), b=device({server});
  await a.cloud.publish(); await b.cloud.join(remote);
  b.edit(201); await b.cloud.refresh(sessionId,true); a.edit(301);
  await a.cloud.join(remote); await a.cloud.join(remote);
  assert.equal(a.disk.get('time'),301); assert.equal(a.events.length,0);
  await a.cloud.resolveConflict(); assert.equal(a.copies[0].session.updated,301); assert.equal(a.disk.get('time'),201);
});

test('independent tabs atomically claim the same private link for a local session',async()=>{
  const {IDBFactory} = require('fake-indexeddb');
  const factory = new IDBFactory(), context = {SL:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/storage.js'),'utf8'),context);
  const [a,b] = [context.SL.createStore(factory),context.SL.createStore(factory)];
  const key='cloud:session:'+sessionId;
  const [left,right] = await Promise.all([a.getOrSet(key,{token:'first'}),b.getOrSet(key,{token:'second'})]);
  assert.equal(left.token,right.token); assert.equal((await a.get(key)).token,left.token);
});
