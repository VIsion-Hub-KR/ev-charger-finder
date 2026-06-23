/**
 * lib/store.js — Storage abstraction for charger snapshots.
 *
 * Exports two factories with an identical async interface:
 *   createMemoryStore() — in-memory Map (tests / dev)
 *   createKvStore()     — Vercel KV (production)
 *
 * Interface:
 *   async getSnapshot(zscode)         → { stations, updatedAt } | null
 *   async setSnapshot(zscode, snap)   → void
 *   async listZscodes()               → string[]   (bare zscode values)
 */

const PREFIX = 'sigungu:';

/** In-memory store backed by a Map. */
export function createMemoryStore() {
  const map = new Map();

  return {
    async getSnapshot(zscode) {
      const value = map.get(PREFIX + zscode);
      return value ?? null;
    },

    async setSnapshot(zscode, snapshot) {
      map.set(PREFIX + zscode, snapshot);
    },

    async listZscodes() {
      const codes = [];
      for (const key of map.keys()) {
        codes.push(key.slice(PREFIX.length));
      }
      return codes;
    },
  };
}

/** Vercel KV store. @vercel/kv is imported lazily so tests work without it. */
export function createKvStore() {
  async function kv() {
    const mod = await import('@vercel/kv');
    return mod.kv;
  }

  return {
    async getSnapshot(zscode) {
      const client = await kv();
      return client.get(PREFIX + zscode);
    },

    async setSnapshot(zscode, snapshot) {
      const client = await kv();
      await client.set(PREFIX + zscode, snapshot);
    },

    async listZscodes() {
      const client = await kv();
      const keys = await client.keys(PREFIX + '*');
      return keys.map((k) => k.slice(PREFIX.length));
    },
  };
}
