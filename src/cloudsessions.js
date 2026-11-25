'use strict';
(() => {
  const keyFor = id => 'cloud:session:' + id;
  const sameRemote = (record, remote) => record?.remote.id === remote.id && record.remote.token === remote.token;
  const linkPattern = /^#session=([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/;
  function parseLink(value) {
    const url = new URL(value.trim(), location.href);
    const match = url.origin === location.origin && linkPattern.exec(url.hash);
    if (!match) throw new Error('Gebruik een volledige privélink van deze SailLens-site.');
    return {id: match[1], token: match[2]};
  }
  function shareLink(remote) {
    const url = new URL(location.href);
    url.search = ''; url.hash = 'session=' + remote.id + '.' + remote.token;
    return url.href;
  }
  function createCloudSessions({db, currentId, editStamp, isDirty, flushLocal, readPayload, applyRemote, openLocal, localTime, notify}) {
    const records = new Map(), reading = new Map(), jobs = new Map(), timers = new Map();
    const lastEdit = new Map(), messages = new Map(), conflicts = new Set(), active = new Set(), retryDelays = new Map();
    let previousId, initialized = false, dialog, joinField, retryInvite, openingLink = false;
    const hosted = () => location.protocol === 'https:' || location.protocol === 'http:';
    function binding(id) {
      if (!id || records.has(id)) return Promise.resolve(records.get(id));
      if (!reading.has(id)) reading.set(id, db.get(keyFor(id)).then(value => {
        if (!records.has(id)) records.set(id,value || null);
        return records.get(id);
      }).finally(() => reading.delete(id)));
      return reading.get(id);
    }
    function needsUpload(id, record) {
      const stored = localTime?.(id);
      // The laptop and the boat computer can have different clocks.
      return !record.revision || (lastEdit.has(id) && lastEdit.get(id) !== record.syncedEdit) ||
        (stored != null && stored !== record.syncedEdit);
    }
    function statusText(id) {
      if (messages.has(id)) return messages.get(id);
      const record = records.get(id);
      if (!record) return id ? 'Opgeslagen op deze computer' : 'Open een bestaande online sessie via de privélink.';
      return needsUpload(id,record) ? 'Wijzigingen wachten op synchronisatie' : 'Online bijgewerkt';
    }
    function status(id, message) {
      if (message) messages.set(id, message); else messages.delete(id);
      if (currentId() === id) render();
    }
    function enqueue(id, fn) {
      const prev = jobs.get(id) || Promise.resolve();
      const next = prev.catch(() => {}).then(() => globalThis.navigator?.locks ?
        navigator.locks.request('saillens:cloud:' + id,fn) : fn());
      jobs.set(id, next);
      return next.finally(() => { if (jobs.get(id) === next) jobs.delete(id); });
    }
    async function saveRecord(id, record) {
      await db.set(keyFor(id), record);
      records.set(id, record);
    }
    function errorState(id, err) {
      if (err.status === 409) {
        conflicts.add(id);
        status(id, 'De online sessie is elders gewijzigd. Je eigen versie staat op deze computer.');
      } else if (err.status === 401 || err.status === 403 || err.status === 404) {
        status(id, 'Geen toegang tot de online sessie. Controleer de privélink.');
      } else {
        status(id, 'Synchronisatie uitgesteld. ' + (err.message || 'Controleer je verbinding.'));
        const record = records.get(id);
        if (record && needsUpload(id,record) && (!err.status || err.status === 429 || err.status >= 500)) {
          const delay = Math.min(60000, (retryDelays.get(id) || 2500) * 2);
          retryDelays.set(id,delay); schedule(id,delay);
        }
      }
    }
    function schedule(id, delay = 1800) {
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        runSync(id).catch(() => {});
      }, delay));
    }
    function committed(id, updated) {
      if (!id || !updated) return;
      lastEdit.set(id, updated);
      binding(id).then(record => {
        if (!record || conflicts.has(id) || !needsUpload(id,record)) return;
        if (!active.has(id)) status(id, 'Wijzigingen wachten op synchronisatie');
        schedule(id);
      }).catch(() => {});
    }
    async function upload(id, record) {
      status(id, 'Sessie online opslaan…');
      const payload = await readPayload(id);
      if (payload?.session?.id !== id) throw new Error('De lokale sessie kan niet worden gelezen.');
      // Retry creation with the same credential after a lost connection.
      if (!record.revision) await SL.cloudCreate(record.remote);
      const result = await SL.cloudPush(record.remote, payload, record.revision);
      const next = {...record, revision:result.revision, syncedEdit:payload.session.updated};
      await saveRecord(id,next);
      retryDelays.delete(id);
      if (lastEdit.get(id) === next.syncedEdit) lastEdit.delete(id);
      conflicts.delete(id);
      if (needsUpload(id,next)) schedule(id);
      status(id);
    }
    function runSync(id) {
      return enqueue(id, async () => {
        const record = await binding(id);
        if (!record || conflicts.has(id) || !needsUpload(id,record)) return;
        active.add(id);
        try { await upload(id,record); }
        catch(err) { errorState(id,err); throw err; }
        finally { active.delete(id); if (currentId() === id) render(); }
      });
    }
    function guard() {
      const id = currentId(), stamp = editStamp();
      return () => currentId() === id && editStamp() === stamp && !isDirty();
    }
    async function receive(remote, result, preserveCopy, stillCurrent, expectedLocalId, openFromLink = false) {
      const payload = result.payload, id = payload?.session?.id;
      if (!id || (expectedLocalId && id !== expectedLocalId)) throw new Error('De link bevat geen geldige sessie.');
      const known = [records.get(id), await db.get(keyFor(id))];
      if (known.some(record => sameRemote(record,remote) && record.revision > result.revision))
        throw new Error('Er is inmiddels een nieuwere versie van deze sessie. Haal de sessie opnieuw op.');
      if (!stillCurrent()) throw new Error('De lokale sessie veranderde tijdens het ophalen. Probeer het opnieuw.');
      const record = {remote, revision:result.revision, syncedEdit:payload.session.updated};
      const ok = await applyRemote(payload, {preserveCopy, expectedLocalId, stillCurrent, openFromLink, metaEntry:[keyFor(id),record]});
      if (ok === false) throw new Error('De lokale sessie veranderde tijdens het ophalen. Probeer het opnieuw.');
      records.set(id,record); conflicts.delete(id); lastEdit.delete(id); status(id);
    }
    async function refresh(id = currentId(), explicit = false) {
      if (!id || !hosted() || openingLink || (!explicit && document.hidden)) return;
      if (explicit) await flushLocal();
      if (currentId() !== id) return;
      return enqueue(id, async () => {
        const record = await binding(id);
        if (!record || conflicts.has(id) || currentId() !== id || isDirty()) return;
        const unchanged = guard();
        // Draft forms live in the DOM until the user presses their save button.
        const stillCurrent = () => unchanged() && (explicit || !(
          document.activeElement?.matches('input, select, textarea, [contenteditable="true"]') ||
          document.querySelector?.('dialog[open]:not([data-cloud-dialog])')));
        active.add(id);
        try {
          if (needsUpload(id,record)) { await upload(id,record); return; }
          const online = await SL.cloudVersion(record.remote);
          if (!stillCurrent()) return;
          if (online.revision > record.revision) {
            status(id,'Wijzigingen ophalen…');
            const result = await SL.cloudPull(record.remote);
            if (!stillCurrent()) return;
            await receive(record.remote,result,false,stillCurrent,id);
          }
          status(id);
        } catch(err) { errorState(id,err); if (explicit) throw err; }
        finally { active.delete(id); if (currentId() === id) render(); }
      });
    }
    async function publish() {
      const id = currentId();
      if (!id) throw new Error('Open eerst een sessie op deze computer.');
      await flushLocal();
      await enqueue(id, async () => {
        let record = await binding(id);
        if (!record) {
          // Two tabs can start sharing the same local session at the same time.
          record = await db.getOrSet(keyFor(id), {remote:SL.newCloudRemote(), revision:0, syncedEdit:0});
          records.set(id,record);
          if (record.revision && needsUpload(id,record)) {
            errorState(id,{status:409});
            return;
          }
        }
        active.add(id);
        try { if (needsUpload(id,record)) await upload(id,record); }
        catch(err) { errorState(id,err); throw err; }
        finally { active.delete(id); render(); }
      });
    }
    async function join(remote) {
      if (openingLink) return;
      openingLink = true; retryInvite = remote; render();
      try {
        await flushLocal();
        const stillCurrent = guard();
        let result = await SL.cloudPull(remote);
        const id = result.payload?.session?.id;
        if (!id) throw new Error('De eerste upload van deze sessie is nog niet klaar.');
        await enqueue(id, async () => {
          const old = await binding(id), same = sameRemote(old,remote);
          const stored = await db.get(keyFor(id));
          if ([old,stored].some(record => sameRemote(record,remote) && record.revision > result.revision)) {
            // The session ID is known only after reading the invite. A queued
            // local upload may have advanced the revision during that read.
            result = await SL.cloudPull(remote);
            if (result.payload?.session?.id !== id) throw new Error('De online sessie is gewijzigd. Open de privélink opnieuw.');
          }
          if (same && needsUpload(id,old)) {
            if (!stillCurrent()) throw new Error('De lokale sessie veranderde tijdens het ophalen. Probeer het opnieuw.');
            // Reopen the existing local copy even when another session was active.
            if (openLocal) await openLocal(id);
            if (old.revision !== result.revision) errorState(id,{status:409}); else schedule(id);
            retryInvite = null; return;
          }
          await receive(remote,result,!!old && !same,stillCurrent,same ? id : null,true);
          retryInvite = null;
        });
      } finally { openingLink = false; render(); }
    }
    async function resolveConflict() {
      const id = currentId();
      await flushLocal();
      await enqueue(id, async () => {
        const record = await binding(id);
        if (!record || !conflicts.has(id) || currentId() !== id) return;
        const stillCurrent = guard();
        status(id,'Online versie ophalen…');
        try {
          const result = await SL.cloudPull(record.remote);
          await receive(record.remote,result,true,stillCurrent,id);
          notify?.('Online versie geopend. Je eigen versie staat als aparte lokale sessie bij Boten & sessies.');
        } catch(err) { errorState(id,err); throw err; }
      });
    }
    function el(tag, text, attrs = {}) {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
      return node;
    }
    function button(label, action) {
      const node = el('button',label,{type:'button'});
      node.addEventListener('click', async () => {
        if (node.disabled) return;
        node.disabled = true;
        if (dialog) {
          dialog.querySelector('[data-cloud-error]').textContent = '';
          dialog.querySelector('[data-cloud-feedback]').textContent = '';
        }
        try { await action(); }
        catch(err) { if (dialog) dialog.querySelector('[data-cloud-error]').textContent = err.message; else notify?.(err.message,true); }
        finally { node.disabled = false; render(); }
      });
      return node;
    }
    function mount(container) {
      if (!container || container.querySelector(':scope > .sl-cloud-open')) return;
      const openButton = el('button','Online sessie',{type:'button',class:'sl-cloud-open noprint'});
      openButton.addEventListener('click', showDialog);
      container.append(openButton);
      render();
    }
    function showDialog() {
      if (dialog?.isConnected) return;
      const d = el('dialog', null, {class:'desk-dialog','data-cloud-dialog':'','aria-label':'Online sessie'});
      dialog = d;
      const head = el('div',null,{class:'bar'});
      head.append(el('h3','Online sessie'),button('Sluiten',() => { d.remove(); dialog = null; }));
      const message = el('p',null,{'data-cloud-status':'',role:'status','aria-live':'polite'});
      const explain = el('p',null,{'data-cloud-help':'',class:'muted'});
      const share = el('div',null,{'data-cloud-share':''});
      const address = el('input',null,{type:'text',readonly:'','data-cloud-link':'','aria-label':'Privélink naar deze sessie',style:'width:100%'});
      const shareLabel = el('label','Privélink naar deze sessie'); shareLabel.append(address);
      const actions = el('div',null,{class:'bar'});
      const copy = button('Privélink kopiëren', async () => {
        try { await navigator.clipboard.writeText(address.value); d.querySelector('[data-cloud-feedback]').textContent = 'Privélink gekopieerd.'; }
        catch { address.focus(); address.select(); d.querySelector('[data-cloud-feedback]').textContent = 'Kopieer de geselecteerde privélink.'; }
      });
      const sync = button('Nu synchroniseren',()=>refresh(currentId(),true)); sync.setAttribute('data-cloud-sync','');
      const retry = button('Online versie ophalen en lokale kopie bewaren',resolveConflict); retry.setAttribute('data-cloud-resolve','');
      actions.append(copy,sync); share.append(shareLabel,actions);
      const start = button('Sessie online zetten',publish); start.setAttribute('data-cloud-publish','');
      const repeat = button('Synchronisatie opnieuw proberen',()=>refresh(currentId(),true)); repeat.setAttribute('data-cloud-repeat','');
      const open = el('section'), joinLabel = el('label','Privélink van een andere computer');
      joinField = el('input',null,{type:'url',placeholder:'Plak hier de sessielink',autocomplete:'off',spellcheck:'false','data-cloud-join':'',style:'width:100%'});
      joinLabel.append(joinField);
      open.append(el('hr'),joinLabel,button('Open sessielink',async () => {
        const remote = joinField.value.trim() ? parseLink(joinField.value) : retryInvite;
        if (!remote) throw new Error('Plak eerst een sessielink.');
        await join(remote);
        joinField.value = '';
      }));
      d.append(head,message,explain,start,repeat,share,retry,el('span',null,{'data-cloud-feedback':'',role:'status'}),open,el('p',null,{'data-cloud-error':'',role:'alert'}));
      // Typing a private link is not a change to the sailing session.
      for (const event of ['input','change']) d.addEventListener(event,e=>e.stopPropagation());
      d.addEventListener('close',()=>{ d.remove(); if (dialog === d) dialog = null; });
      document.body.append(d);
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open','');
      render();
      binding(currentId()).then(render).catch(()=>{});
    }
    function render() {
      const id = currentId(), record = records.get(id), online = record?.revision > 0;
      const text = openingLink ? 'Online sessie ophalen…' : statusText(id);
      document.querySelectorAll('.sl-cloud-open').forEach(node => {
        node.textContent = record ? 'Online sessie · ' + (conflicts.has(id) ? 'conflict' : active.has(id) ? 'synchroniseren' : messages.has(id) || needsUpload(id,record) ? 'wacht' : 'bijgewerkt') : 'Online sessie';
        node.title = text;
      });
      if (!dialog?.isConnected) return;
      const q = name => dialog.querySelector('[data-cloud-' + name + ']');
      q('status').textContent = text;
      q('help').textContent = !hosted() ? 'Open de gehoste SailLens-app om een online sessie te gebruiken.' : record || id ? 'Je log, events, fases en kalibratie worden samen bewaard. Met de privélink kun je deze sessie op een andere computer openen en bewerken. Iedereen met deze link kan dit ook.' : 'Open de privélink op deze computer, of kies eerst een lokale sessie om die online te zetten.';
      q('publish').hidden = !!record || !id || !hosted();
      q('repeat').hidden = !record || online || conflicts.has(id);
      q('share').hidden = !online;
      q('link').value = online ? shareLink(record.remote) : '';
      q('sync').hidden = conflicts.has(id);
      q('resolve').hidden = !conflicts.has(id);
    }
    function sessionChanged() {
      const id = currentId();
      render();
      if (!initialized || previousId === id) return;
      previousId = id;
      binding(id).then(record => { if (currentId() === id) { render(); if (record) refresh(id).catch(()=>{}); } }).catch(()=>{});
    }
    async function handleLink() {
      if (!location.hash.startsWith('#session=')) return false;
      const hash = location.hash;
      history.replaceState(history.state,'',location.pathname + location.search);
      try { await join(parseLink(hash)); }
      catch(err) {
        showDialog();
        dialog.querySelector('[data-cloud-error]').textContent = err.message + (retryInvite ? ' Gebruik Open sessielink om opnieuw te proberen.' : '');
      }
      return true;
    }
    async function init() {
      if (initialized) return;
      initialized = true;
      window.addEventListener('hashchange',()=>handleLink().catch(()=>{}));
      const revisit = () => { refresh().catch(()=>{}); };
      window.addEventListener('online',revisit);
      window.addEventListener('focus',revisit);
      document.addEventListener('visibilitychange',()=>{ if (!document.hidden) revisit(); });
      window.setInterval(() => {
        const id = currentId();
        if (records.get(id) && !jobs.has(id) && !document.hidden && navigator.onLine !== false) revisit();
      }, 30000);
      if (!await handleLink()) sessionChanged();
      else { previousId=currentId(); render(); }
    }
    return {mount, init, sessionChanged, committed, refresh, publish, join, resolveConflict};
  }
  SL.createCloudSessions = createCloudSessions;
})();
