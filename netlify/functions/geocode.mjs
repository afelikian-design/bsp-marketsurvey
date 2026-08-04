/* =============================================================================
   /api/geocode — resolve property street addresses to coordinates.

   ApartmentIQ exports carry a street line ("1350 Cascade Creek Vw") but no city,
   state, or coordinates, so the city is supplied by the user once per survey and
   appended here. Results are cached in Blobs by normalized query, which means a
   comp shared between two surveys is geocoded once, ever.

   Census first (free, keyless, authoritative for US addresses), Nominatim as a
   fallback, serialized at 1 req/sec per their usage policy.
   ========================================================================== */

import { getStore } from '@netlify/blobs';

const CACHE_STORE = 'geocache';
const MAX_ITEMS = 40;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function census(query) {
  const url = 'https://geocoding.geo.census.gov/geocoders/locations/onelineaddress'
    + '?address=' + encodeURIComponent(query)
    + '&benchmark=Public_AR_Current&format=json';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const m = data?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return { lat: +m.coordinates.y, lng: +m.coordinates.x, matched: m.matchedAddress || '', via: 'census' };
}

async function nominatim(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'bsp-market-tearsheet/1.0 (internal asset management tool)' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const arr = await res.json();
  const m = Array.isArray(arr) ? arr[0] : null;
  if (!m) return null;
  return { lat: +m.lat, lng: +m.lon, matched: m.display_name || '', via: 'nominatim' };
}

export async function handleWithStore(req, cache) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); }
  catch (e) { return json({ error: 'Malformed JSON body' }, 400); }

  const city = String(body?.city || '').trim();
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!city) return json({ error: 'A city and state are required' }, 400);
  if (!items || !items.length) return json({ error: 'No addresses supplied' }, 400);
  if (items.length > MAX_ITEMS) return json({ error: 'Too many addresses' }, 413);

  const out = {};
  let needFallback = false;

  for (const it of items) {
    const prop = String(it?.prop || '').slice(0, 200);
    const addr = String(it?.address || '').trim().slice(0, 200);
    if (!prop || !addr) continue;

    const query = `${addr}, ${city}`;
    const ck = norm(query);

    let hit = null;
    if (cache) { try { hit = await cache.get(ck, { type: 'json' }); } catch (e) {} }
    if (hit) { out[prop] = hit; continue; }

    let res = null;
    try { res = await census(query); } catch (e) {}
    if (!res) {
      if (needFallback) await sleep(1100);      // Nominatim: 1 req/sec
      needFallback = true;
      try { res = await nominatim(query); } catch (e) {}
    }

    if (res && isFinite(res.lat) && isFinite(res.lng)) {
      out[prop] = res;
      if (cache) { try { await cache.setJSON(ck, res); } catch (e) {} }
    } else {
      out[prop] = null;                          // explicit miss, not silently dropped
    }
  }

  const found = Object.values(out).filter(Boolean).length;
  return json({ coords: out, found, total: Object.keys(out).length });
}

export default async function handler(req) {
  let cache = null;
  try { cache = getStore({ name: CACHE_STORE, consistency: 'eventual' }); }
  catch (e) { /* cache is optional; geocode still works without it */ }
  return handleWithStore(req, cache);
}
