/**
 * scripts/warm.mjs — Warming runner for EV charger data.
 *
 * Fetches per-시군구 snapshots from the public API and writes them to the
 * KV store (or memory store when KV env vars are absent).
 *
 * Run locally:
 *   npm run warm
 *   (uses node --env-file=.env.local which is configured in package.json)
 *
 * macmini cron:
 *   Provide DATA_GO_KR_KEY (and optionally WARM_ZSCODES, KV_REST_API_URL,
 *   KV_REST_API_TOKEN) in the environment before executing this script.
 */

import { fetchChargerItemsForSigungu } from '../lib/govapi.js';
import { buildStations } from '../lib/chargers.js';
import { createKvStore, createMemoryStore } from '../lib/store.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const key = process.env.DATA_GO_KR_KEY;
if (!key) {
  console.error('[warm] ERROR: DATA_GO_KR_KEY environment variable is not set.');
  process.exit(1);
}

// Determine store: KV when env vars are present, memory as fallback.
let store;
if (process.env.KV_REST_API_URL) {
  store = createKvStore();
  console.log('[warm] Using Vercel KV store.');
} else {
  store = createMemoryStore();
  console.log('[warm] KV_REST_API_URL not set — using in-memory store (data will not persist).');
}

// ---------------------------------------------------------------------------
// Collect 시군구 codes to warm
// ---------------------------------------------------------------------------

// (a) Seed from env (default: 강남구 11680)
const envCodes = process.env.WARM_ZSCODES
  ? process.env.WARM_ZSCODES.split(',').map((s) => s.trim()).filter(Boolean)
  : ['11680'];

// (b) Previously stored codes (keep recently-used areas warm)
let storedCodes = [];
try {
  storedCodes = await store.listZscodes();
} catch (e) {
  console.warn('[warm] Could not list stored zscodes:', e.message);
}

// Union, deduplicated
const allCodes = [...new Set([...envCodes, ...storedCodes])];
console.log(`[warm] Warming ${allCodes.length} 시군구: ${allCodes.join(', ')}`);

// ---------------------------------------------------------------------------
// Warm each 시군구
// ---------------------------------------------------------------------------

let successCount = 0;
let failCount = 0;

for (const zscode of allCodes) {
  try {
    console.log(`[warm] → ${zscode}: fetching…`);
    const items = await fetchChargerItemsForSigungu({ zscode, key });
    // Pass items as both infoItems and statusItems so stat field is read from
    // the same getChargerInfo response (no separate getChargerStatus call needed).
    const stations = buildStations(items, items);
    await store.setSnapshot(zscode, { stations, updatedAt: Date.now() });
    console.log(`[warm] ✓ ${zscode}: ${stations.length} stations saved.`);
    successCount += 1;
  } catch (e) {
    // Mask any accidental key leak from error messages.
    const safeMsg = e.message ? e.message.replace(key, '***') : String(e);
    console.error(`[warm] ✗ ${zscode}: failed — ${safeMsg}`);
    failCount += 1;
    // Continue warming the remaining 시군구.
  }
}

console.log(`[warm] Done. success=${successCount} fail=${failCount}`);
