/* =============================================================================
   storage.js — saved market surveys, backed by Netlify Blobs.

   Same STORE interface the rest of the app already uses, but surveys now live
   server-side so they are shared across your devices and anyone else with
   access to the site. Because they are shared, protect the site (Netlify
   password protection or Identity) before circulating the URL.

   Two things stay local, because they are personal rather than shared:
     - which survey you had open last
     - an in-memory cache of payloads already fetched this session
   ========================================================================== */
(function (global) {
  'use strict';

  const API = '/api/surveys';
  const LAST = 'bsp-last-survey';

  const cache = new Map();     // key -> payload, this tab only
  let ready = null;            // null = untested, true/false after probe
  let lastError = '';

  async function req(method, opts) {
    const { key, body } = opts || {};
    const url = key ? API + '?key=' + encodeURIComponent(key) : API;
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  /* localStorage holds only a ~40 byte preference, well clear of any quota. */
  function localGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function localSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }
  function localDel(k) { try { global.localStorage.removeItem(k); } catch (e) {} }

  const STORE = {
    async probe() {
      if (ready !== null) return ready;
      try { await req('GET'); ready = true; }
      catch (e) { ready = false; lastError = e.message; }
      return ready;
    },
    available() { return ready !== false; },
    reason() { return lastError; },

    key(subject) {
      return String(subject).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'survey';
    },

    async getIndex() {
      try { return (await req('GET')).index || []; }
      catch (e) { lastError = e.message; return []; }
    },

    async load(key) {
      if (cache.has(key)) return cache.get(key);
      try {
        const payload = (await req('GET', { key })).payload || null;
        if (payload) cache.set(key, payload);
        return payload;
      } catch (e) { lastError = e.message; return null; }
    },

    async save() {
      if (!(await this.probe())) {
        return { ok: false, reason: 'Shared storage is unreachable. ' + (lastError || '') };
      }
      const key = this.key(DB.subject);
      try {
        const payload = encodePayload();
        const out = await req('POST', { body: { key: key, payload: payload, savedBy: localGet('bsp-user') || '' } });
        cache.set(key, payload);
        localSet(LAST, key);
        return { ok: true, key: key, count: out.count, index: out.index };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },

    async remove(key) {
      try {
        await req('DELETE', { key });
        cache.delete(key);
        if (localGet(LAST) === key) localDel(LAST);
        return true;
      } catch (e) { lastError = e.message; return false; }
    },

    async remember(key) { localSet(LAST, key); },
    async lastKey() { return localGet(LAST); }
  };

  global.STORE = STORE;
  STORE.probe();
})(window);
