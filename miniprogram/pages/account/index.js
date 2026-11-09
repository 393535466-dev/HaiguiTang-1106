const api = require('../../utils/api')
Page({
  data: { screen: 'profile', nickname: '', savedName: '', loading: true, busy: false, error: '', saved: false, voiceEnabled: false },
  onLoad(options = {}) { this._alive = true; const pages = getCurrentPages(); this.setData({ screen: options.screen === 'settings' ? 'settings' : 'profile', canClear: pages[pages.length - 2]?.route === 'pages/game/index' }) },
  onShow() { this.setData({ voiceEnabled: wx.getStorageSync('host_voice_enabled') === true }); if (this.data.screen === 'profile') this.load(); else this.setData({ loading: false }) },
  onUnload() { this._alive = false },
  async load() {
    this.setData({ loading: true, error: '' })
    try { const { profile } = await api.call('getProfile'); if (this._alive) this.setData({ nickname: profile.nickname, savedName: profile.nickname, loading: false }) }
    catch (e) { if (this._alive) this.setData({ loading: false, error: api.message(e) }) }
  },
  input(e) { this.setData({ nickname: e.detail.value, saved: false }) },
  async save() {
    if (this.data.busy || !this.data.nickname.trim()) return
    this.setData({ busy: true, error: '', saved: false })
    try { const { profile } = await api.call('saveProfile', { nickname: this.data.nickname.trim() }); if (this._alive) this.setData({ nickname: profile.nickname, savedName: profile.nickname, saved: true }) }
    catch (e) { if (this._alive) this.setData({ error: api.message(e) }) }
    finally { if (this._alive) this.setData({ busy: false }) }
  },
  toggleVoice() { const voiceEnabled = !this.data.voiceEnabled; wx.setStorageSync('host_voice_enabled', voiceEnabled); this.setData({ voiceEnabled }) },
  leaderboard() { wx.navigateTo({ url: '/pages/leaderboard/index' }) },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  tutorial() { wx.navigateTo({ url: '/pages/tutorial/index' }) },
  clearSession() {
    const pages = getCurrentPages(), previous = pages[pages.length - 2]
    if (previous && previous.route === 'pages/game/index' && previous.clear) { wx.navigateBack({ delta: 1, success: () => previous.clear() }) }
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 }); else wx.redirectTo({ url: '/pages/home/index?screen=mode' }) }
})
