'use strict';

function missing(error) {
  const message = String(error?.errMsg || error?.message || '');
  if (Number(error?.errCode) === -502005) return false;
  return /DOCUMENT_NOT_EXIST|document\s+(?:with\s+_id\s+.+?\s+)?(?:does\s+)?not\s+exist|文档.*不存在/i.test(message);
}

function createCloudStore(database) {
  function wrap(source) {
    return {
      async get(collection, id) {
        try {
          const result = await source.collection(collection).doc(id).get();
          const value = Array.isArray(result.data) ? result.data[0] : result.data;
          if (!value) return null;
          const { _id, ...rest } = value;
          return rest;
        } catch (error) { if (missing(error)) return null; throw error; }
      },
      async set(collection, id, value) {
        const { _id, ...data } = value;
        await source.collection(collection).doc(id).set({ data });
      },
      async delete(collection, id) {
        try { await source.collection(collection).doc(id).remove(); }
        catch (error) { if (!missing(error)) throw error; }
      }
    };
  }
  return {
    ...wrap(database),
    transaction(callback) { return database.runTransaction(transaction => callback(wrap(transaction))); },
    async leaderboard(mode) {
      const { data } = await database.collection('rankings').where({ mode }).orderBy('points', 'desc').orderBy('wins', 'desc').orderBy('updatedAt', 'asc').orderBy('playerId', 'asc').limit(20).get();
      return data || [];
    },
    async scan(collection) {
      const rows = []; let cursor = null;
      for (;;) {
        let query = database.collection(collection).orderBy('_id', 'asc').limit(100);
        if (cursor) query = query.where({ _id: database.command.gt(cursor) });
        const { data } = await query.get();
        if (!data?.length) break;
        for (const { _id, ...value } of data) rows.push({ id: _id, ...value });
        cursor = data[data.length - 1]._id;
        if (data.length < 100) break;
        if (rows.length > 20000) throw Object.assign(new Error('CLEANUP_BATCH_LIMIT'), { code: 'CLEANUP_BATCH_LIMIT' });
      }
      return rows;
    }
  };
}

module.exports = { createCloudStore, missing };
