export function createCache({ ttlMs, now = () => Date.now() }) {
  const store = new Map();
  return {
    get(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (now() - e.t > ttlMs) { store.delete(key); return undefined; }
      return e.v;
    },
    set(key, value) { store.set(key, { v: value, t: now() }); },
  };
}
