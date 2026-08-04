/* =============================================================================
   /api/surveys — shared survey storage on Netlify Blobs.

   GET    /api/surveys              -> { index: [...] }      list all surveys
   GET    /api/surveys?key=slug     -> { payload: {...} }    one survey
   POST   /api/surveys              -> { ok, key, count }    create or replace
   DELETE /api/surveys?key=slug     -> { ok, count }

   There is deliberately no index blob. The listing is rebuilt from the store's
   own metadata on each call, which costs a handful of metadata reads but makes
   concurrent writes safe: two people saving different properties at the same
   moment cannot clobber a shared index that does not exist.
   ========================================================================== */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'market-surveys';
const MAX_BYTES = 8 * 1024 * 1024;   // a parsed survey is ~290 KB; this is generous
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

function openStore() {
  // Throws when the Blobs context is missing (e.g. `netlify dev` without login).
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

async function buildIndex(store) {
  const { blobs } = await store.list();
  const entries = await Promise.all(blobs.map(async b => {
    try {
      const meta = await store.getMetadata(b.key);
      const m = (meta && meta.metadata) || {};
      return {
        key: b.key,
        subject: m.subject || b.key,
        market: m.market || '',
        asof: m.asof || '',
        units: Number(m.units) || 0,
        props: Number(m.props) || 0,
        savedAt: m.savedAt || '',
        savedBy: m.savedBy || ''
      };
    } catch (e) {
      return null;                                   // deleted between list and read
    }
  }));
  return entries.filter(Boolean).sort((a, b) => a.subject.localeCompare(b.subject));
}

/* Logic is separated from store construction so it can be exercised against a
   stub in tests without reaching for module mocking. */
export async function handleWithStore(req, store) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');

  try {
    /* ---------------- read ---------------- */
    if (req.method === 'GET') {
      if (!key) return json({ index: await buildIndex(store) });
      if (!KEY_RE.test(key)) return json({ error: 'Invalid key' }, 400);
      const payload = await store.get(key, { type: 'json' });
      if (!payload) return json({ error: 'Survey not found' }, 404);
      return json({ payload });
    }

    /* ---------------- write ---------------- */
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); }
      catch (e) { return json({ error: 'Malformed JSON body' }, 400); }

      const { key: k, payload, savedBy } = body || {};
      if (!k || !KEY_RE.test(k)) return json({ error: 'Invalid or missing key' }, 400);
      if (!payload || typeof payload !== 'object') return json({ error: 'Missing payload' }, 400);
      if (!Array.isArray(payload.rows) || !Array.isArray(payload.props) || !payload.subject) {
        return json({ error: 'Payload is not a parsed survey' }, 400);
      }
      const size = JSON.stringify(payload).length;
      if (size > MAX_BYTES) return json({ error: 'Survey too large (' + Math.round(size / 1024) + ' KB)' }, 413);

      await store.setJSON(k, payload, {
        metadata: {
          subject: String(payload.subject).slice(0, 200),
          market: String(payload.market || '').slice(0, 120),
          asof: String(payload.asof || '').slice(0, 20),
          units: payload.rows.length,
          props: payload.props.length,
          savedAt: new Date().toISOString(),
          savedBy: String(savedBy || '').slice(0, 60)
        }
      });

      const index = await buildIndex(store);
      return json({ ok: true, key: k, count: index.length, index });
    }

    /* ---------------- delete ---------------- */
    if (req.method === 'DELETE') {
      if (!key || !KEY_RE.test(key)) return json({ error: 'Invalid or missing key' }, 400);
      await store.delete(key);
      const index = await buildIndex(store);
      return json({ ok: true, count: index.length, index });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('surveys failed:', e);
    return json({ error: e.message || 'Storage error' }, 500);
  }
}

export default async function handler(req) {
  let store;
  try {
    store = openStore();
  } catch (e) {
    return json({ error: 'Blob store unavailable: ' + e.message }, 503);
  }
  return handleWithStore(req, store);
}
