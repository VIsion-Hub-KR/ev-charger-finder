/**
 * lib/govapi.js — Public EV-charger government API fetch helpers.
 *
 * Exports:
 *   fetchWithRetry(fetchImpl, url, opts)  — retry helper (unit-testable)
 *   fetchChargerItemsForSigungu(opts)     — paginated per-시군구 item fetch
 *
 * Security: the API key is NEVER logged or included in any thrown error message.
 */

import { parseItems } from './chargers.js';

const BASE = 'https://apis.data.go.kr/B552584/EvCharger';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP fetch with exponential-ish backoff retry.
 * Retries on HTTP 429 / 502 / 504 or non-NORMAL resultMsg.
 *
 * @param {Function} fetchImpl   - fetch-compatible function
 * @param {string}   url
 * @param {{ retries?: number, backoffMs?: number }} opts
 * @returns {Promise<object>}    - parsed JSON body
 */
export async function fetchWithRetry(fetchImpl, url, { retries = 3, backoffMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url);
      if ([429, 502, 504].includes(res.status)) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) await sleep(backoffMs);
        continue;
      }
      const text = await res.text();
      const json = JSON.parse(text);
      if (typeof json?.resultMsg === 'string' && !json.resultMsg.includes('NORMAL')) {
        lastErr = new Error(`API error: ${json.resultMsg}`);
        if (attempt < retries) await sleep(backoffMs);
        continue;
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(backoffMs);
    }
  }
  throw lastErr;
}

/**
 * Fetch all raw charger items for one 시군구 (zscode), paginating until a
 * short page is received or maxPages is reached.
 *
 * @param {{
 *   zscode:     string,
 *   key:        string,           — API key (never logged)
 *   fetchImpl?: Function,
 *   numOfRows?: number,
 *   maxPages?:  number,
 * }} opts
 * @returns {Promise<object[]>}    — flat array of raw item objects
 */
export async function fetchChargerItemsForSigungu({
  zscode,
  key,
  fetchImpl = globalThis.fetch,
  numOfRows = 9999,
  maxPages = 5,
}) {
  const encoded = encodeURIComponent(key);
  const zcode = String(zscode).slice(0, 2); // 시도코드: 앞 2자리
  const allItems = [];

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const url =
      `${BASE}/getChargerInfo` +
      `?serviceKey=${encoded}&zcode=${zcode}&zscode=${zscode}&pageNo=${pageNo}` +
      `&numOfRows=${numOfRows}&dataType=JSON`;

    // fetchWithRetry default backoffMs is kept; callers can pass a tiny value in tests.
    const json = await fetchWithRetry(fetchImpl, url);
    const items = parseItems(json);
    allItems.push(...items);

    if (items.length < numOfRows) {
      // Short page → this was the last page.
      break;
    }

    if (pageNo === maxPages) {
      // Reached cap — warn without exposing the key.
      console.warn(
        `[govapi] zscode=${zscode}: maxPages(${maxPages}) reached. There may be more data.`,
      );
    }
  }

  return allItems;
}
