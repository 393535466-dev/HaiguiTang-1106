const config = require('../config')

function error(code, message) { const e = new Error(message); e.code = code; return e }
function unwrap(response) {
  const result = response && response.result
  if (!result || typeof result.ok !== 'boolean') throw error('BAD_RESPONSE', '服务返回格式异常，请稍后检查结果。')
  if (!result.ok) {
    const detail = result.error || {}
    throw error(detail.code || 'SERVICE_ERROR', detail.message || '服务暂时不可用。')
  }
  return result.data
}
function call(action, payload, options) {
  options = options || {}
  if (!config.cloudEnv || !wx.cloud) return Promise.reject(error('CONFIG_REQUIRED', '云环境尚未配置，请按部署说明填入环境 ID。'))
  let timedOut = false
  let timer
  const request = wx.cloud.callFunction({ name: config.functionName, data: Object.assign({ action }, payload || {}) }).then(unwrap)
  const wait = new Promise((resolve, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(error('CLIENT_TIMEOUT', '等待时间较长，操作可能仍在处理。请先检查结果，避免重复调用。')) }, options.timeout || 15000)
    request.then(data => {
      clearTimeout(timer)
      if (timedOut) { if (options.onLate) options.onLate(null, data) } else resolve(data)
    }, e => {
      clearTimeout(timer)
      if (timedOut) { if (options.onLate) options.onLate(e) } else reject(e)
    })
  })
  return wait
}
function requestId() { return 'wx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 13) }
function message(e) {
  if (e.code === 'CONFIG_REQUIRED') return e.message
  if (/cloud\.callFunction:fail|FUNCTION_NOT_FOUND|FUNCTIONS_EXECUTE_FAIL|环境/.test(e.message || '')) return '云服务尚未部署或环境不可用，请查看接入说明。'
  return e.message || '网络没有接通。你的草稿会保留，可以稍后再试。'
}
module.exports = { call, requestId, message }
