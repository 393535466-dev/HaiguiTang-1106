'use strict';

// Test/local adapter. Transactions serialize and commit a cloned working set.
// Production must use the CloudBase transactional adapter, never this instance.
function createMemoryStore() {
  let records = new Map();
  let tail = Promise.resolve();
  const key = (collection, id) => `${collection}\u0000${id}`;
  const copy = value => value == null ? null : structuredClone(value);
  return {
    async transaction(work) {
      let unlock;
      const previous = tail;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      const draft = new Map([...records].map(([k, v]) => [k, copy(v)]));
      const tx = {
        async get(collection, id) { return copy(draft.get(key(collection, id))); },
        async set(collection, id, value) { draft.set(key(collection, id), copy(value)); },
        async delete(collection, id) { draft.delete(key(collection, id)); }
      };
      try { const result = await work(tx); records = draft; return copy(result); }
      finally { unlock(); }
    },
    async scan(collection) {
      await tail;
      const prefix = `${collection}\u0000`;
      return [...records].filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ ...copy(v), id: k.slice(prefix.length) }));
    }
  };
}

module.exports = { createMemoryStore };
