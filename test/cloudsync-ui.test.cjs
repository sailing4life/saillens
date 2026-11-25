const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const {IDBFactory} = require('fake-indexeddb');

const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await pause(40);
  }
  throw new Error('Timed out waiting for ' + description);
}
async function server(t) {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saillens-cloud-test-'));
  const env = {...process.env, PORT: String(port), SAILLENS_DATA_DIR: dataDir};
  delete env.RAILWAY_PROJECT_ID;
  delete env.RAILWAY_ENVIRONMENT_ID;
  const app = spawn('python3', ['server.py'], {cwd: root, env, stdio: ['ignore', 'ignore', 'pipe']});
  let output = '';
  app.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-1500); });
  t.after(async () => {
    if (app.exitCode === null && app.signalCode === null) {
      const end = once(app, 'exit'); app.kill(); await end;
    }
    await fs.rm(dataDir, {recursive: true, force: true});
  });
  const origin = 'http://127.0.0.1:' + port;
  await until(async () => {
    if (app.exitCode !== null) throw new Error('Test server exited: ' + output);
    return fetch(origin + '/api/health').then(r => r.json()).then(info => info.ok, () => false);
  }, 'SQLite session server');
  return origin;
}
async function browser(t, url, store = new IDBFactory()) {
  const origin = new URL(url).origin;
  const html = await new Promise((resolve, reject) => {
    http.get(origin, response => {
      response.setEncoding('utf8');
      let text = '';
      response.on('data', part => { text += part; });
      response.on('end', () => resolve(text));
      response.on('error', reject);
    }).on('error', reject);
  });
  const env = {offline: false, requests: [], errors: [], clipboard: ''};
  const console = new VirtualConsole();
  console.on('jsdomError', error => env.errors.push(error.message));
  const dom = new JSDOM(html, {url, runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: console, beforeParse(w) {
      w.indexedDB = store;
      for (const key of ['structuredClone','TextEncoder','TextDecoder','Float64Array','Uint8Array',
        'Uint32Array','Int8Array','Int16Array','Int32Array','ArrayBuffer','Blob','CompressionStream',
        'DecompressionStream','Response','Headers','ReadableStream','Request','AbortController']) w[key] = globalThis[key];
      Object.defineProperty(w, 'crypto', {value: require('node:crypto').webcrypto});
      Object.defineProperty(w.navigator, 'clipboard', {value: {writeText: value => {env.clipboard = value; return Promise.resolve();}}});
      w.matchMedia = () => ({matches: false, addEventListener() {}});
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({measureText: t => ({width: String(t).length * 7})},
        {get: (target, key) => target[key] || (() => {}), set: (target, k, v) => (target[k] = v, true)});
      w.fetch = async (input, options = {}) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url || String(input), origin);
        const item = {url: requestUrl, method: options.method || 'GET'};
        env.requests.push(item);
        if (env.offline) throw new TypeError('offline');
        const response = await fetch(requestUrl, options);
        item.status = response.status;
        return response;
      };
    }});
  const w = dom.window, $ = selector => w.document.querySelector(selector);
  t.after(() => w.close());
  const run = expr => w.eval(expr);
  const button = label => [...w.document.querySelectorAll('button')].find(
    b => b.textContent.trim() === label && !b.disabled && !b.closest('[hidden]'));
  async function click(label) { (await until(() => button(label), 'button ' + label)).click(); }
  function fill(selector, text) {
    const input = $(selector); assert.ok(input, selector);
    input.value = text; input.dispatchEvent(new w.Event('input', {bubbles: true}));
  }
  async function onlineDialog() {
    if (!$('[data-cloud-dialog]')) {
      (await until(() => [...w.document.querySelectorAll('.sl-cloud-open')].find(b => !b.closest('[hidden]')), 'Online sessie')).click();
    }
    await until(() => $('[data-cloud-dialog]'), 'online dialog');
  }
  await until(() => run("typeof WF !== 'undefined'"), 'app initialization');
  return {$, w, run, click, button, fill, onlineDialog, env, store};
}

test('an existing log syncs between two independent browsers and both offline edits survive a conflict', async t => {
  const origin = await server(t);
  const a = await browser(t, origin);
  await until(() => a.$('#new-boat-name'), 'local boat list');
  a.fill('#new-boat-name', 'J/109');
  await a.click('Boot toevoegen');
  await until(() => a.run('Boolean(WF.session)'), 'local session');
  const csv = ['Time,BSP,TWA,TWS', ...Array.from({length: 30}, (_,i) =>
    [new Date(Date.UTC(2026,10,22,10,0,i)).toISOString(), 6.2, -44, 12].join(','))].join('\n');
  a.w.testLog = {name: 'regatta.csv', text: async () => csv};
  await a.run('WF.importFiles([testLog])');
  a.run("A.events=SL.parseEvents('2026-11-22T10:00:04Z,MiscEvent,,Windshift'); WF.applyCalibration({...A.calib,bspK:1.02}, 'BSP meting')");
  await a.run("WF.session.name='Ochtend'; WF.touch(); WF.persist()");
  await a.onlineDialog();
  await a.click('Sessie online zetten');
  await until(() => a.button('Privélink kopiëren'), 'first upload');
  await a.click('Privélink kopiëren');
  const link = new URL(await until(() => a.env.clipboard || a.$('[data-cloud-link]')?.value, 'hand-off link'));
  assert.equal(link.origin, origin);
  assert.equal(link.pathname, '/');
  assert.equal(link.search, '');
  const [, id, token] = /^#session=([\da-f-]{36})\.([\w-]{43})$/.exec(link.hash);
  const pathName = '/api/sessions/' + id;
  assert.ok([401, 403, 404].includes((await fetch(origin + pathName)).status));

  const b = await browser(t, link.href);
  await until(() => b.run("WF.session?.name === 'Ochtend'"), 'opening shared session');
  assert.equal(b.w.location.hash, '');
  assert.equal(b.run('WF.session.sources[0].text'), csv);
  assert.equal(b.run('A.raw.ch.BSP instanceof Float64Array && A.raw.ch.BSP[0]'), 6.2);
  assert.equal(b.run('WF.session.profile.name'), 'J/109');
  assert.equal(b.run('A.calib.bspK'), 1.02);
  assert.equal(b.run('A.events.events[0].comments'), 'Windshift');
  // Inspection is local to the viewer and must not create a competing revision.
  const revision = async () => (await (await fetch(origin + pathName, {
    headers: {Authorization: 'Bearer ' + token}
  })).json()).revision;
  const originalRevision = await revision();
  await b.run("show('events'); A.cur=10; show('review'); show('setup'); WF.persist()");
  await b.onlineDialog();
  const preceding = b.env.requests.length;
  await b.click('Nu synchroniseren');
  await until(() => b.env.requests.slice(preceding).some(r => r.url.pathname === pathName && r.status === 200),
    'navigation-only sync check');
  assert.equal(await revision(), originalRevision, 'changing tab and cursor does not write a cloud revision');

  await a.run("A.cur=3; WF.touch(); WF.persist()");
  await b.run("WF.session.name='Middag'; WF.touch(); WF.persist()");
  await until(() => b.env.requests.some(r => r.url.pathname === pathName && r.method === 'PUT' && r.status === 200),
    'automatic upload of edit from second computer');
  await a.onlineDialog();
  await a.click('Nu synchroniseren');
  await until(() => a.run("WF.session.name === 'Middag'"), 'first computer receiving second edit');
  assert.equal(a.run('A.cur'),3,'receiving another computer’s edit preserves the local cursor');

  b.env.offline = true;
  await b.run("WF.session.name='Mijn offline versie'; WF.touch(); WF.persist()");
  assert.equal(b.run('WF.session.name'), 'Mijn offline versie');
  const putCount = a.env.requests.filter(r => r.url.pathname === pathName && r.method === 'PUT' && r.status === 200).length;
  await a.run("WF.session.name='Mijn online versie'; WF.touch(); WF.persist()");
  await until(() => a.env.requests.filter(r => r.url.pathname === pathName && r.method === 'PUT' && r.status === 200).length > putCount,
    'online edit persisted while other computer offline');
  b.env.offline = false;
  await b.onlineDialog();
  await b.click('Nu synchroniseren');
  await until(() => b.env.requests.some(r => r.url.pathname === pathName && r.status === 409), 'stale upload refused');
  assert.equal(b.run('WF.session.name'), 'Mijn offline versie');
  await b.click('Online versie ophalen en lokale kopie bewaren');
  await until(() => b.run("WF.session?.name === 'Mijn online versie'"), 'newer online version restored');
  assert.ok(b.run("WF.library.sessions.some(s => s.id !== WF.session.id && s.name.includes('Mijn offline versie'))"),
    'offline session kept as a separate local copy');
  assert.equal(b.run('WF.session.sources[0].text'), csv);
  const reopened = await browser(t, origin, b.store);
  await until(() => reopened.run("WF.session?.name === 'Mijn online versie'"), 'reopening saved cloud session');
  await reopened.onlineDialog();
  await until(() => reopened.$('[data-cloud-link]')?.value === link.href, 'recovering link on paired computer');
  const repeatVisit = await browser(t, link.href, b.store);
  await until(() => repeatVisit.run("WF.session?.name === 'Mijn online versie' && A.tab !== 'home'"), 'opening a known link directly in the session');
  assert.ok([...a.env.requests, ...b.env.requests, ...reopened.env.requests].every(r => !r.url.href.includes(token)), 'token stays out of HTTP URLs');
  assert.deepEqual(a.env.errors.concat(b.env.errors, reopened.env.errors), []);
});
