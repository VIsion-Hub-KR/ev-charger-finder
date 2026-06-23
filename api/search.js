/**
 * api/search.js — Place (keyword) search proxy via Naver 지역검색 Open API.
 *
 * Exports:
 *   parseLocalResults(json)  — pure parse function (testable, no network)
 *   searchPlaces({ query, fetchImpl, id, secret })  — fetches Naver local API
 *   default handler(req, res)  — Vercel-style serverless handler
 *
 * Secrets (NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET) are used
 * server-side only and are NEVER forwarded to the frontend or logged.
 */

const NAVER_LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags from a Naver local search title (e.g. '강남역 <b>2호선</b>').
 * @param {string} str
 * @returns {string}
 */
function stripTags(str) {
  return String(str ?? '').replace(/<[^>]+>/g, '').trim();
}

/**
 * Parse a Naver local search JSON response into a flat result array.
 *
 * Coordinate format: mapx / mapy are WGS84 × 10^7 integers.
 *   lng = Number(mapx) / 1e7
 *   lat = Number(mapy) / 1e7
 *
 * Items with non-finite lat or lng are filtered out.
 *
 * @param {{ items?: object[] }} json
 * @returns {{ name: string, roadAddress: string, lat: number, lng: number }[]}
 */
export function parseLocalResults(json) {
  const items = json?.items ?? [];
  const results = [];

  for (const item of items) {
    const name = stripTags(item.title ?? '');
    const roadAddress = String(item.roadAddress ?? '');

    // Guard: mapx / mapy must be present and non-empty before conversion.
    // Number('') === 0 which is finite but invalid — treat falsy raw value as missing.
    const rawX = item.mapx;
    const rawY = item.mapy;
    if (!rawX || !rawY) continue;

    const lng = Number(rawX) / 1e7;
    const lat = Number(rawY) / 1e7;

    if (!isFinite(lat) || !isFinite(lng)) continue;

    results.push({ name, roadAddress, lat, lng });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Call the Naver local search API and return parsed results.
 *
 * @param {{
 *   query: string,
 *   fetchImpl?: typeof fetch,
 *   id: string,
 *   secret: string,
 * }} options
 * @returns {Promise<{ name: string, roadAddress: string, lat: number, lng: number }[]>}
 */
export async function searchPlaces({ query, fetchImpl = globalThis.fetch, id, secret }) {
  const url = `${NAVER_LOCAL_URL}?query=${encodeURIComponent(query)}&display=5`;

  const response = await fetchImpl(url, {
    headers: {
      'X-Naver-Client-Id':     id,
      'X-Naver-Client-Secret': secret,
    },
  });

  if (!response.ok) {
    throw new Error(`Naver local search HTTP ${response.status}`);
  }

  const json = await response.json();
  return parseLocalResults(json);
}

// ---------------------------------------------------------------------------
// Handler (Vercel serverless)
// ---------------------------------------------------------------------------

/**
 * Default export: Vercel-style serverless handler.
 *
 * GET /api/search?query=<q>
 *   200 { results: [...] }
 *   400 { error: 'query parameter required' }
 *   502 { error: 'place search failed' }
 *
 * Secrets are read from process.env and never included in responses or logs.
 *
 * @param {object} req
 * @param {object} res
 */
export default async function handler(req, res) {
  const query = req.query?.query;

  if (!query || !String(query).trim()) {
    res.status(400).json({ error: 'query parameter required' });
    return;
  }

  const id     = process.env.NAVER_SEARCH_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET;

  try {
    const results = await searchPlaces({ query: String(query).trim(), id, secret });
    res.setHeader('Cache-Control', 's-maxage=600');
    res.status(200).json({ results });
  } catch (_err) {
    // Never leak secret or upstream error details to the client
    res.status(502).json({ error: 'place search failed' });
  }
}
