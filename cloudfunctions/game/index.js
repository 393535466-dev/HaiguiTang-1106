'use strict';

const { createService } = require('./lib/service');
const { createCloudStore } = require('./lib/store-cloud');
const { createCloudAudio } = require('./lib/audio');
const { createProvider, failure } = require('./lib/provider');
const puzzles = require('./data/puzzles');

const CLEANUP_TRIGGER = 'cleanup-hourly';
const positiveLimit = (value, fallback) => /^\d+$/.test(String(value)) && +value > 0 ? Math.min(+value, fallback) : fallback;

// Accept identity only from the trusted SDK context, never event.openid/userId.
function createHandler({ cloud, cloudbase, env = process.env, fetchFn = globalThis.fetch }) {
  const store = createCloudStore(cloud.database());
  const speechCache = new Map();
  const storage = cloudbase && cloudbase.init({ env: env.TCB_ENV || env.SCF_NAMESPACE });
  return async (event = {}) => {
    const context = cloud.getWXContext();
    const uid = context.OPENID;
    const moderate = async content => {
      let result;
      try {
        result = await cloud.openapi.security.msgSecCheck({ openid: uid, scene: 2, version: 2, content });
      } catch (_) { throw failure('CONTENT_CHECK_UNAVAILABLE'); }
      if (result?.result?.suggest !== 'pass') throw failure('CONTENT_BLOCKED');
    };
    const audio = createCloudAudio(cloud, {
      envId: context.ENV || env.TCB_ENV || env.SCF_NAMESPACE, fetchFn,
      resolveFileID: storage ? async cloudPath => {
        const result = await storage.getUploadMetadata({ cloudPath });
        if (!result.data?.fileId) throw failure('FILE_LOOKUP_FAILED');
        return result.data.fileId;
      } : undefined
    });
    const service = createService({ store, audio, puzzles,
      provider: createProvider({ env, fetchFn, moderate, speechCache }),
      limits: { userDaily: positiveLimit(env.DAILY_USER_LIMIT, 100), globalDaily: positiveLimit(env.DAILY_GLOBAL_LIMIT, 500) }
    });
    if (!uid && event.Type === 'Timer' && event.TriggerName === CLEANUP_TRIGGER) {
      // Only timer invocations without a client OPENID can run privileged cleanup.
      try { return { ok: true, data: await service.cleanup() }; }
      catch (_) { return { ok: false, error: { code: 'CLEANUP_FAILED', message: '清理未完成，请检查集合和存储权限' } }; }
    }
    return service.handle(event.action, event, uid);
  };
}

let handler;
exports.main = async event => {
  try {
    if (!handler) {
      const cloud = require('wx-server-sdk');
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      handler = createHandler({ cloud, cloudbase: require('@cloudbase/node-sdk') });
    }
    return await handler(event);
  } catch (_) {
    return { ok: false, error: { code: 'SERVICE_ERROR', message: '服务暂时不可用，请检查云端配置', retryable: false } };
  }
};
exports.createHandler = createHandler;
exports.positiveLimit = positiveLimit;
