const api = require('../../utils/api')
const storage = require('../../utils/storage')
const catalog = require('../../data/catalog')

Page({
  data: { puzzles: catalog, loading: true, canStart: false, continuing: '', statusText: '正在检查连接', statusKind: 'waiting', error: '', privacyNeeded: false, scrollTarget: '' },
  onLoad() { this._alive = true },
  onShow() { this._alive = true; this.load() },
  onUnload() { this._alive = false },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const health = await api.call('status')
      getApp().globalData.health = health
      getApp().globalData.ownerKey = health.ownerKey || ''
      const { puzzles } = await api.call('listPuzzles')
      if (!this._alive) return
      const ready = Boolean(health.textReady && health.gameEnabled !== false)
      const localStatus = health.environment === 'local-fixture' ? '固定测试裁判 · 非真实 AI' : ''
      this.setData({ puzzles: puzzles || [], canStart: ready, continuing: storage.lastSession(), loading: false, statusKind: ready ? 'ready' : 'waiting', statusText: ready ? localStatus || (health.voiceReady ? 'AI 主持已就位 · 可以开麦' : 'AI 主持已就位 · 文字提问') : 'AI 主持尚未接入', error: ready ? '' : '请先完成服务端 AI 配置，再开始第一局。' })
    } catch (e) {
      if (!this._alive) return
      this.setData({ loading: false, canStart: false, continuing: '', statusKind: 'waiting', statusText: '等待云端配置', error: api.message(e) })
    }
  },
  chooseStory() { this.setData({ scrollTarget: 'story-list' }) },
  friends() { const id = storage.read('hgt:' + storage.owner() + ':room'); wx.navigateTo({ url: '/pages/room/index' + (id ? '?id=' + id : '') }) },
  leaderboard() { wx.navigateTo({ url: '/pages/leaderboard/index' }) },
  tutorial() { wx.navigateTo({ url: '/pages/tutorial/index' }) },
  async start(e) {
    if (!this.data.canStart || this._starting) {
      if (!this.data.canStart) wx.showToast({ title: '请先完成云端配置', icon: 'none' })
      return
    }
    this._starting = true
    wx.showLoading({ title: '盛一碗汤…', mask: true })
    try {
      const result = await api.call('startSolo', { puzzleId: e.currentTarget.dataset.id })
      storage.saveLast(result.session.id)
      wx.navigateTo({ url: '/pages/game/index?id=' + encodeURIComponent(result.session.id) })
    } catch (e) { wx.showToast({ title: api.message(e), icon: 'none', duration: 3500 }) }
    finally { this._starting = false; wx.hideLoading() }
  },
  resume() { if (this.data.continuing) wx.navigateTo({ url: '/pages/game/index?id=' + encodeURIComponent(this.data.continuing) }) },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  agreePrivacy() { getApp().resolvePrivacy(true); this.setData({ privacyNeeded: false }) },
  declinePrivacy() { getApp().resolvePrivacy(false); this.setData({ privacyNeeded: false }) }
})
