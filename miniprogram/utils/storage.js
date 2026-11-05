function read(key) { try { return wx.getStorageSync(key) } catch (_) { return null } }
function write(key, value) { try { wx.setStorageSync(key, value) } catch (_) {} }
function remove(key) { try { wx.removeStorageSync(key) } catch (_) {} }
function owner() { return getApp().globalData.ownerKey || 'unconfigured' }
function key(kind, id) { return 'hgt:' + owner() + ':' + kind + (id ? ':' + id : '') }
function lastSession() { return read(key('last')) || '' }
function saveLast(id) { write(key('last'), id) }
function clearLast(id) { if (lastSession() === id) remove(key('last')) }
const RETENTION = 7 * 86400000
function unexpired(value, field) {
  const timestamp = value && value[field]
  const age = Date.now() - timestamp
  return Number.isFinite(timestamp) && age >= 0 && age < RETENTION
}
function draft(id) {
  const value = read(key('draft', id))
  if (unexpired(value, 'savedAt')) return value
  remove(key('draft', id)); return null
}
function saveDraft(id, value) { write(key('draft', id), Object.assign({}, value, { savedAt: Date.now() })) }
function clearDraft(id) { remove(key('draft', id)) }
function pending(id) {
  const value = read(key('pending', id))
  if (unexpired(value, 'createdAt')) return value
  remove(key('pending', id)); return null
}
function savePending(id, value) {
  if (value) write(key('pending', id), Object.assign({}, value, { createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now() }))
  else remove(key('pending', id))
}
function purgeExpired() {
  if (!wx.getStorageInfoSync) return
  let keys
  try { keys = wx.getStorageInfoSync().keys || [] } catch (_) { return }
  keys.forEach(item => {
    const match = /^hgt:[^:]+:(draft|pending):[^:]+$/.exec(item)
    if (match && !unexpired(read(item), match[1] === 'draft' ? 'savedAt' : 'createdAt')) remove(item)
  })
}
module.exports = { read, write, remove, owner, lastSession, saveLast, clearLast, draft, saveDraft, clearDraft, pending, savePending, purgeExpired }
