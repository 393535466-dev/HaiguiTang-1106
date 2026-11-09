const api = require('../../utils/api')
Page({
  data: { mode: 'solo', rows: [], viewRows: [], pageIndex: 0, pageCount: 1, rulesOpen: false, ruleIndex: 0,
    rules: ['猜中从 100 分起，每次有效提问减 2 分，每条提示或一次明确猜错减 10 分。猜中最低 10 分。主动揭底或次数用完为 0 分；澄清、未设定细节和讨论不扣提问分。', '好友局共同得分。开局时在场、结束前未主动退出且有首次计分资格的玩家，各得同样的分数。', '每个题目版本只有首次开局计分，单人和好友共用资格。练习与重玩不入榜，中途离开请回原局继续。成绩从本版本开始记录，旧局不追溯。'], me: null, loading: true, error: '' },
  onLoad(options) { this._alive = true; if (options.mode === 'friends') this.setData({ mode: 'friends' }) },
  onShow() { this.load() }, onUnload() { this._alive = false },
  async load() {
    const generation = this._generation = (this._generation || 0) + 1
    this.setData({ loading: true, error: '' })
    try { const r = await api.call('getLeaderboard', { mode: this.data.mode }); if (this._alive && generation === this._generation) { const rows = r.rows.map(row => ({ ...row, initial: Array.from(row.nickname || "友")[0] })); const pageCount = Math.max(1, Math.ceil(rows.length / 3)), pageIndex = Math.min(this.data.pageIndex, pageCount - 1); this.setData({ rows, viewRows: rows.slice(pageIndex * 3, pageIndex * 3 + 3), pageCount, pageIndex, me: r.me, loading: false }) } }
    catch (e) { if (this._alive && generation === this._generation) this.setData({ error: api.message(e), loading: false }) }
  },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode, rows: [], viewRows: [], pageIndex: 0, pageCount: 1, me: null }); this.load() },
  movePage(e) { const pageIndex = this.data.pageIndex + Number(e.currentTarget.dataset.direction); if (pageIndex >= 0 && pageIndex < this.data.pageCount) this.setData({ pageIndex, viewRows: this.data.rows.slice(pageIndex * 3, pageIndex * 3 + 3) }) },
  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen, ruleIndex: 0 }) },
  moveRule(e) { const ruleIndex = this.data.ruleIndex + Number(e.currentTarget.dataset.direction); if (ruleIndex >= 0 && ruleIndex < this.data.rules.length) this.setData({ ruleIndex }) },
  home() { if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 }); else wx.redirectTo({ url: '/pages/home/index?screen=mode' }) }
})
