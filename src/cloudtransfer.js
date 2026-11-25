'use strict';
/* A session revision points to immutable chunks. Large logs and unchanged analysis
   versions can therefore be shared between saves without uploading their bytes again. */
(() => {
  const CHUNK = 2 * 1024 * 1024, TEXT_PART = 1024 * 1024;
  const MAX_TOTAL = 2 * 1024 * 1024 * 1024, MAX_META = 32 * 1024 * 1024;
  const MAX_ARRAY_BYTES = 128 * 1024 * 1024, MAX_NODES = 1000000;
  const types = {Float64Array, Float32Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Uint8ClampedArray, Int8Array};
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const invalid = () => new Error('Ongeldige online sessie.');
  const compressedHashes = new Map();
  const hashPattern = /^[0-9a-f]{64}$/;
  const asText = () => new TextDecoder('utf-8', {fatal:true});
  const hex = Array.from({length:256}, (_, i) => i.toString(16).padStart(2, '0'));
  async function digest(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => hex[n]).join('');
  }
  function newCloudRemote() {
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return {id:crypto.randomUUID(), token};
  }
  function checkRemote(remote) {
    if (!remote || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(remote.id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(remote.token)) throw new Error('Ongeldige sessielink.');
  }
  async function request(remote, suffix, method = 'GET', content, blob = false) {
    checkRemote(remote);
    const url = '/api/sessions' + (suffix === null ? '' : '/' + remote.id + suffix);
    const headers = {Authorization:'Bearer ' + remote.token};
    let body;
    if (content !== undefined) {
      headers['Content-Type'] = blob ? 'application/octet-stream' : 'application/json';
      body = blob ? content : JSON.stringify(content);
    }
    const response = await fetch(url, {method, headers, body, cache:'no-store', credentials:'omit', redirect:'error'});
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const error = new Error(typeof detail?.error === 'string' ? detail.error : 'Online opslag gaf fout ' + response.status + '.');
      error.status = response.status;
      throw error;
    }
    return response;
  }
  function revision(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw invalid();
    return value;
  }
  async function cloudCreate(remote) {
    const r = await (await request(remote, null, 'POST', {id:remote.id})).json();
    return {revision:revision(r.revision)};
  }
  async function cloudVersion(remote) {
    const r = await request(remote, '', 'HEAD');
    const value = r.headers.get('X-Session-Revision');
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw invalid();
    return {revision:revision(Number(value))};
  }
  const gzip = bytes => new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    .then(buf => new Uint8Array(buf));
  async function pool(values, fn) {
    let next = 0;
    await Promise.all(Array.from({length:Math.min(6, values.length)}, async () => {
      while (next < values.length) await fn(values[next++]);
    }));
  }
  // Never memoise a mutable array by identity across saves. Memoising the result
  // of compression by the uncompressed digest also works with IndexedDB clones.
  async function makeChunks(payload) {
    const encoder = new TextEncoder(), blobs = new Map(), texts = new Map(), arrays = new WeakMap();
    let total = 0, nodes = 0;
    function countBytes(size) {
      total += size;
      if (total > MAX_TOTAL) throw new Error('De sessie is te groot voor online opslag.');
    }
    async function chunk(getBytes, initial) {
      const bytes = initial || getBytes(), size = bytes.byteLength;
      if (size > CHUNK) throw invalid();
      countBytes(size);
      const hash = await digest(bytes);
      let spec = compressedHashes.get(hash), available;
      if (!spec) {
        spec = [hash, size];
        if (size >= 1024 && typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
          const compressed = await gzip(bytes);
          if (compressed.byteLength + 32 < size) { available = compressed; spec = [await digest(compressed), size, 'gzip']; }
        }
        if (compressedHashes.size >= 8192) compressedHashes.delete(compressedHashes.keys().next().value);
        compressedHashes.set(hash, spec);
      }
      if (!blobs.has(spec[0])) blobs.set(spec[0], async () => {
        if (available) return available;
        const raw = getBytes();
        return spec[2] ? gzip(raw) : raw;
      });
      return spec;
    }
    async function binary(bytes) {
      const parts = [];
      for (let start = 0; start < bytes.length; start += CHUNK) parts.push(await chunk(() => bytes.subarray(start, start + CHUNK)));
      return parts;
    }
    async function walk(value, depth) {
      if (depth > 128 || ++nodes > MAX_NODES) throw invalid();
      if (value === undefined) return {$sl:'undefined'};
      if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return {$sl:'number', v:Object.is(value,-0) ? '-0' : String(value)};
      if (typeof value === 'string' && value.length >= 4096) {
        if (texts.has(value)) return texts.get(value);
        // JSON strings preserve even a surrogate pair split across chunk boundaries.
        async function part(start, end) {
          const load = () => encoder.encode(JSON.stringify(value.slice(start, end)));
          const bytes = load();
          if (bytes.length <= CHUNK) return [await chunk(load, bytes)];
          const mid = start + Math.floor((end - start) / 2);
          return [...await part(start, mid), ...await part(mid, end)];
        }
        const starts = Array.from({length:Math.ceil(value.length / TEXT_PART)}, (_, i) => i * TEXT_PART);
        const parts = new Array(starts.length);
        await pool(starts, async start => { parts[start / TEXT_PART] = await part(start, Math.min(value.length, start + TEXT_PART)); });
        const node = {$sl:'text', refs:parts.flat()}; texts.set(value, node); return node;
      }
      if (value === null || ['string','boolean','number'].includes(typeof value)) return value;
      if (ArrayBuffer.isView(value)) {
        const name = value.constructor.name;
        if (!Object.hasOwn(types, name) || value.byteLength > MAX_ARRAY_BYTES) throw invalid();
        if (arrays.has(value)) {
          // Each restored typed array is independent and must fit the read budget.
          countBytes(value.byteLength);
          return arrays.get(value);
        }
        const refs = await binary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        const node = {$sl:'typed', name, refs}; arrays.set(value, node); return node;
      }
      if (Array.isArray(value)) {
        const out = [];
        for (const item of value) out.push(await walk(item, depth + 1));
        return out;
      }
      if (typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') throw invalid();
      const obj = {};
      for (const [key, item] of Object.entries(value)) {
        if (forbidden.has(key)) throw invalid();
        obj[key] = await walk(item, depth + 1);
      }
      return Object.hasOwn(obj, '$sl') ? {$sl:'object', entries:Object.entries(obj)} : obj;
    }
    const metadata = encoder.encode(JSON.stringify(await walk(payload, 0)));
    if (metadata.length > MAX_META) throw new Error('De sessie bevat te veel metadata.');
    return {manifest:{version:1, root:await binary(metadata)}, blobs};
  }
  async function cloudPush(remote, payload, baseRevision) {
    revision(baseRevision);
    const {manifest, blobs} = await makeChunks(payload);
    const hashes = [...blobs.keys()], missing = [];
    for (let start = 0; start < hashes.length; start += 200) {
      const batch = hashes.slice(start, start + 200);
      const reply = await (await request(remote, '/missing', 'POST', {hashes:batch})).json();
      if (!Array.isArray(reply.missing) || reply.missing.some(h => !batch.includes(h))) throw invalid();
      missing.push(...reply.missing);
    }
    await pool(missing, async hash => {
      const data = await blobs.get(hash)();
      await request(remote, '/blobs/' + hash, 'PUT', data, true);
    });
    const reply = await (await request(remote, '', 'PUT', {baseRevision, manifest, hashes})).json();
    if (revision(reply.revision) !== baseRevision + 1) throw invalid();
    return {revision:reply.revision};
  }
  function refsSize(refs, limit) {
    if (!Array.isArray(refs) || refs.length > 65536) throw invalid();
    let size = 0;
    for (const ref of refs) {
      if (!Array.isArray(ref) || (ref.length !== 2 && !(ref.length === 3 && ref[2] === 'gzip')) ||
          typeof ref[0] !== 'string' || ref[0].length !== 64 || !hashPattern.test(ref[0]) || !Number.isSafeInteger(ref[1]) || ref[1] < 1 || ref[1] > CHUNK || (size += ref[1]) > limit) throw invalid();
    }
    return size;
  }
  async function unpack(remote, manifest) {
    if (manifest?.version !== 1) throw invalid();
    const metaSize = refsSize(manifest.root, MAX_META);
    const cache = new Map(), waiting = [];
    let active = 0;
    async function readSlot(fn) {
      if (active === 6) await new Promise(resolve => waiting.push(resolve));
      else active++;
      try { return await fn(); } finally {
        if (waiting.length) waiting.shift()();
        else active--;
      }
    }
    async function read([hash, size, encoding]) {
      const key = hash + '/' + size + '/' + (encoding || 'raw');
      if (cache.has(key)) return cache.get(key);
      const task = readSlot(async () => {
        const r = await request(remote, '/blobs/' + hash);
        if (Number(r.headers.get('Content-Length')) > CHUNK) throw invalid();
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > CHUNK || await digest(bytes) !== hash) throw new Error('Controle van de online sessiedata mislukt.');
        if (!encoding) { if (size !== bytes.length) throw invalid(); return bytes; }
        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
        const out = new Uint8Array(size); let pos = 0;
        while (true) {
          const result = await reader.read(); if (result.done) break;
          if (pos + result.value.length > size) { await reader.cancel(); throw invalid(); }
          out.set(result.value, pos); pos += result.value.length;
        }
        if (pos !== size) throw invalid();
        return out;
      });
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(key, task); return task;
    }
    async function join(refs, size) {
      const bytes = new Uint8Array(size); let pos = 0;
      for (const ref of refs) { bytes.set(await read(ref), pos); pos += ref[1]; }
      return bytes;
    }
    const tree = JSON.parse(asText().decode(await join(manifest.root, metaSize)));
    let total = metaSize, nodes = 0;
    const tasks = [], textFields = new Map();
    function walk(node, assign, depth) {
      if (depth > 128 || ++nodes > MAX_NODES) throw invalid();
      if (node === null || typeof node !== 'object') { assign(node); return; }
      if (node.$sl === 'undefined') { assign(undefined); return; }
      if (node.$sl === 'number') {
        if (!['NaN','Infinity','-Infinity','-0'].includes(node.v)) throw invalid();
        assign(Number(node.v)); return;
      }
      if (node.$sl === 'typed' || node.$sl === 'text') {
        const typed = node.$sl === 'typed';
        const size = refsSize(node.refs, typed ? MAX_ARRAY_BYTES : MAX_TOTAL);
        if (typed) {
          if ((total += size) > MAX_TOTAL) throw invalid();
          if (typeof node.name !== 'string' || !Object.hasOwn(types, node.name) || size % types[node.name].BYTES_PER_ELEMENT) throw invalid();
          tasks.push(async () => assign(new types[node.name]((await join(node.refs, size)).buffer)));
        } else {
          const key = JSON.stringify(node.refs);
          if (textFields.has(key)) { textFields.get(key).push(assign); return; }
          if ((total += size) > MAX_TOTAL) throw invalid();
          const setters = [assign]; textFields.set(key, setters);
          tasks.push(async () => {
            const parts = new Array(node.refs.length);
            await pool(node.refs.map((_, i) => i), async i => {
              const part = JSON.parse(asText().decode(await read(node.refs[i])));
              if (typeof part !== 'string') throw invalid();
              parts[i] = part;
            });
            const value = parts.join('');
            for (const set of setters) set(value);
          });
        }
        return;
      }
      if (Array.isArray(node)) {
        if (node.length > MAX_NODES - nodes) throw invalid();
        const array = new Array(node.length); assign(array);
        for (let i = 0; i < node.length; i++) walk(node[i], v => { array[i] = v; }, depth + 1);
        return;
      }
      const object = {}, escaped = node.$sl === 'object';
      assign(object);
      function property(key, value) {
        if (typeof key !== 'string' || forbidden.has(key) || Object.hasOwn(object, key)) throw invalid();
        // Stable object order matters to saved analysis signatures even when a
        // large property is populated asynchronously after its neighbours.
        object[key] = undefined;
        walk(value, v => { object[key] = v; }, depth + 1);
      }
      if (escaped) {
        if (!Array.isArray(node.entries) || node.entries.length > MAX_NODES - nodes) throw invalid();
        for (const pair of node.entries) {
          if (!Array.isArray(pair) || pair.length !== 2) throw invalid();
          property(pair[0], pair[1]);
        }
      } else {
        if (Object.hasOwn(node, '$sl')) throw invalid();
        for (const key of Object.keys(node)) property(key, node[key]);
      }
    }
    let payload;
    walk(tree, v => { payload = v; }, 0);
    await pool(tasks, fn => fn());
    return payload;
  }
  async function cloudPull(remote) {
    const r = await (await request(remote, '')).json(), rev = revision(r.revision);
    if (rev === 0 && r.manifest === null) return {revision:0, payload:null};
    return {revision:rev, payload:await unpack(remote, r.manifest)};
  }
  Object.assign(SL, {newCloudRemote, cloudCreate, cloudVersion, cloudPush, cloudPull});
})();
