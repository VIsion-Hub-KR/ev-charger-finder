// api/route.js — Driving route via OSRM public demo server.
// OSRM public demo server (router.project-osrm.org) is free for personal/light use.
// No API key required.

export const config = { maxDuration: 30 };

/**
 * GET /api/route?slat=&slng=&glat=&glng=
 *
 * Returns { path: [{lat,lng},…], distanceKm: number, durationMin: number }
 *
 * Calls the OSRM public demo instance. OSRM uses lng,lat order (not lat,lng).
 */
export default async function handler(req, res) {
  const { slat, slng, glat, glng } = req.query ?? {};

  if (!slat || !slng || !glat || !glng) {
    return res.status(400).json({ error: 'Missing required query params: slat, slng, glat, glng' });
  }

  const sLat = parseFloat(slat);
  const sLng = parseFloat(slng);
  const gLat = parseFloat(glat);
  const gLng = parseFloat(glng);

  if ([sLat, sLng, gLat, gLng].some((v) => !Number.isFinite(v))) {
    return res.status(400).json({ error: 'Query params must be finite numbers' });
  }

  // OSRM coordinate order: lng,lat (not lat,lng)
  const osrmUrl =
    `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${gLng},${gLat}` +
    `?overview=full&geometries=geojson`;

  let osrmData;
  try {
    const osrmRes = await fetch(osrmUrl, {
      headers: { 'User-Agent': 'ev-charger-finder/1.0 (personal project)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!osrmRes.ok) {
      throw new Error(`OSRM HTTP ${osrmRes.status}`);
    }
    osrmData = await osrmRes.json();
  } catch (err) {
    return res.status(502).json({ error: `OSRM request failed: ${err.message}` });
  }

  if (!osrmData.routes || osrmData.routes.length === 0) {
    return res.status(502).json({ error: 'OSRM returned no routes' });
  }

  const route = osrmData.routes[0];
  const coordinates = route.geometry?.coordinates ?? [];

  // Convert OSRM [lng,lat] pairs → {lat,lng}
  const path = coordinates.map(([lng, lat]) => ({ lat, lng }));

  const distanceKm = parseFloat((route.distance / 1000).toFixed(1));
  const durationMin = Math.round(route.duration / 60);

  res.setHeader('Cache-Control', 's-maxage=3600');
  return res.status(200).json({ path, distanceKm, durationMin });
}
