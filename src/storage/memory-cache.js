// Disposable per-process caches. Session definitions remain in PostgreSQL.
export function createMemoryCache(limit = 256) {
  const entries = new Map();
  return {
    get(parts) {
      const key = JSON.stringify(parts);
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return structuredClone(value);
    },
    set(parts, value) {
      const key = JSON.stringify(parts);
      entries.delete(key);
      entries.set(key, structuredClone(value));
      if (entries.size > limit) entries.delete(entries.keys().next().value);
    },
  };
}
