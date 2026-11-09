const carousel = require('../../utils/story-carousel')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const catalog = require('../../data/catalog')

Page(Object.assign({
  data: { carouselCards: carousel.cards(catalog, 0), carouselShift: 0, carouselDragging: false, screen: 'cover', coverActive: true, eyeReady: false, artError: false, artRetry: '', storyIndex: 0, puzzle: catalog[0], puzzles: catalog, loading: true, canStart: false, continuing: '', statusText: '正在检查连接', statusKind: 'waiting', error: '', privacyNeeded: false },
  onLoad(options = {}) { this._alive = true; this._eyeFrames = {}; this.setData({ screen: ['mode', 'stories'].includes(options.screen) ? options.screen : 'cover' }) },
  onShow() { this._alive = true; this.setData({ coverActive: true }); this.load() },
  onHide() { this.setData({ coverActive: false }) },
  onUnload() { this._alive = false },
  eyeFrameLoaded(e) {
    if (!this._alive) return
    this._eyeFrames[e.currentTarget.dataset.frame] = true
    if (this._eyeFrames.open && this._eyeFrames.closed && !this.data.eyeReady) this.setData({ eyeReady: true })
  },
  coverAssetFailed() { if (this._alive && !this.data.artError) this.setData({ artError: true, eyeReady: false }) },
  retryCoverArt() { this._eyeFrames = {}; this.setData({ artError: false, eyeReady: false, artRetry: '?retry=' + Date.now() }) },
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
      const storyIndex = Math.min(this.data.storyIndex, Math.max(0, (puzzles || []).length - 1))
      this.setData({ puzzles: puzzles || [], carouselCards: carousel.cards(puzzles || [], storyIndex), storyIndex, puzzle: (puzzles || [])[storyIndex] || null, canStart: ready, continuing: storage.lastSession(), loading: false, statusKind: ready ? 'ready' : 'waiting', statusText: ready ? localStatus || (health.voiceReady ? 'AI 主持已就位 · 可以开麦' : 'AI 主持已就位 · 文字提问') : 'AI 主持尚未接入', error: ready ? '' : '请先完成服务端 AI 配置，再开始第一局。' })
    } catch (e) {
      if (!this._alive) return
      this.setData({ loading: false, canStart: false, continuing: '', statusKind: 'waiting', statusText: '连接暂未完成', error: api.message(e) })
    }
  },
  enter() { wx.navigateTo({ url: '/pages/home/index?screen=mode' }) },
  chooseStory() { wx.navigateTo({ url: '/pages/home/index?screen=stories' }) },
  moveStory(e) {
    const storyIndex = this.data.storyIndex + Number(e.currentTarget.dataset.direction)
    carousel.select(this, 'storyIndex', storyIndex)
  },
  back() {
    const target = this.data.screen === 'stories' ? 'mode' : 'cover', pages = getCurrentPages()
    for (let i = pages.length - 2; i >= 0; i--) {
      if (pages[i].route === 'pages/home/index' && pages[i].data.screen === target) { wx.navigateBack({ delta: pages.length - 1 - i }); return }
    }
    wx.redirectTo({ url: '/pages/home/index' + (target === 'mode' ? '?screen=mode' : '') })
  },
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
}, carousel.handlers('storyIndex')))
