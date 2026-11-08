const api = require('../../utils/api')
Page({
  data: { mode: 'solo', rows: [], me: null, loading: true, error: '' },
  onLoad(options) { this._alive = true; if (options.mode === 'friends') this.setData({ mode: 'friends' }) },
  onShow() { this.load() }, onUnload() { this._alive = false },
  async load() {
    const generation = this._generation = (this._generation || 0) + 1
    this.setData({ loading: true, error: '' })
    try { const r = await api.call('getLeaderboard', { mode: this.data.mode }); if (this._alive && generation === this._generation) this.setData({ rows: r.rows.map(row => ({ ...row, initial: Array.from(row.nickname || "友")[0] })), me: r.me, loading: false }) }
    catch (e) { if (this._alive && generation === this._generation) this.setData({ error: api.message(e), loading: false }) }
  },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode, rows: [], me: null }); this.load() },
  home() { wx.redirectTo({ url: '/pages/home/index' }) }
})
