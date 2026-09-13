// functions/api/local-mp.js
// GET /api/local-mp
// Best-effort: turn the visitor's approximate, IP-based location (provided by
// Cloudflare on request.cf) into a UK parliamentary constituency, so the
// homepage can slot that visitor's likely MP into the showcase card. Uses the
// free postcodes.io service for the geocoding; nothing is stored, and every
// failure path returns { constituency: null } so the homepage simply skips it.
//
// IP geolocation is only ever city-level and is often wrong (VPNs, mobile
// carriers, shared connections), so the constituency here is a soft guess, not
// a definitive "your MP".

import { json } from '../../lib/admin-auth.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

function constituencyOf(result) {
  if (!result) return null;
  // Prefer the current (2024) boundaries, falling back to the pre-2024 name.
  return result.parliamentary_constituency_2024 || result.parliamentary_constituency || null;
}

async function reverseGeocode(lat, lon) {
  const url = `https://api.postcodes.io/postcodes?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&limit=1`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  return constituencyOf(j && j.result && j.result[0]);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, NO_STORE);

  const cf = context.request.cf || {};
  const lat = cf.latitude, lon = cf.longitude, postcode = cf.postalCode;

  try {
    let constituency = null;

    // 1) Lat/long is the most reliable signal Cloudflare gives us.
    if (lat && lon) constituency = await reverseGeocode(lat, lon);

    // 2) Otherwise try the postal code — a full postcode directly, or an
    //    outcode (e.g. "SW1A") via its centroid.
    if (!constituency && postcode) {
      const pc = String(postcode).trim();
      const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      if (r.ok) {
        const j = await r.json();
        constituency = constituencyOf(j && j.result);
      } else {
        const outcode = pc.split(' ')[0];
        const oc = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
        if (oc.ok) {
          const j = await oc.json();
          const res = j && j.result;
          if (res && res.latitude && res.longitude) constituency = await reverseGeocode(res.latitude, res.longitude);
        }
      }
    }

    return json({ constituency: constituency || null }, 200, NO_STORE);
  } catch (e) {
    // Fail soft — the homepage treats a null constituency as "nothing to add".
    return json({ constituency: null }, 200, NO_STORE);
  }
}
