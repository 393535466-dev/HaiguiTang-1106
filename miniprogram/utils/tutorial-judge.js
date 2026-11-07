const api = require('./api')

// Tutorial and normal games use the same server-side judge and request protocol.
class TutorialJudge {
  constructor({ update, session }) {
    this.update = update; this.session = session; this.alive = true; this.visible = true
  }
  patch(value) { if (this.alive) this.update(value) }
  async connect() {
    if (!this.alive || this.connecting || this.sessionId) return
    this.connecting = true
    this.patch({ judgeChecking: true, judgeError: '', judgeStatus: '正在准备 AI 主持…' })
    try {
      const health = await api.call('status')
      if (!this.alive) return
      this.patch({ judgeMode: health.judgeMode || 'real' })
      if (!health.textReady) {
        this.patch({ judgeReady: false, judgeStatus: '', judgeError: 'AI 主持尚未接入，请先完成服务端配置，再开始练习。' })
        return
      }
      const result = await api.call('startTutorial')
      if (!this.alive) { api.call('clearSession', { sessionId: result.session.id }).catch(() => {}); return }
      this.sessionId = result.session.id
      this.session(result.session)
      this.patch({ judgeReady: true, judgeStatus: '' })
    } catch (error) { this.patch({ judgeReady: false, judgeStatus: '', judgeError: api.message(error) }) }
    finally { this.connecting = false; this.patch({ judgeChecking: false }) }
  }
  async submit(kind, text, replaceRequestId) {
    if (!this.alive || !this.sessionId || this.pending || this.sending) return
    const requestId = api.requestId()
    this.pending = { requestId, kind, text, startedAt: Date.now() }
    this.sending = true
    this.canRetry = false
    this.patch({ judgeBusy: true, judgePending: true, judgeCanRetry: false, judgeError: '', judgeStatus: kind === 'guessAnswer' ? 'AI 正在核对你的完整解释…' : 'AI 正在理解你的问题…' })
    try {
      this.apply(requestId, await api.call(kind, { sessionId: this.sessionId, requestId, text, ...(replaceRequestId ? { replaceRequestId } : {}) }, {
        onLate: (error, result) => error ? this.requestError(requestId, error) : this.apply(requestId, result)
      }))
    } catch (error) { this.requestError(requestId, error) }
    finally { this.sending = false }
  }
  requestError(id, error) {
    if (!this.alive || this.pending?.requestId !== id) return
    if (['NOT_FOUND', 'SESSION_ENDED'].includes(error.code)) {
      this.pending = null; this.sessionId = null; this.canRetry = false; clearTimeout(this.timer)
      this.patch({ judgeReady: false, judgeBusy: false, judgePending: false, judgeCanRetry: false, judgeStatus: '', judgeError: '这次练习已失效，重新检查连接即可开始新练习。' })
      return
    }
    const unknown = ['CLIENT_TIMEOUT', 'NETWORK_ERROR', 'BAD_RESPONSE', 'RESULT_UNKNOWN', 'BUSY'].includes(error.code) || !error.code
    if (!unknown) { this.pending = null; this.canRetry = false }
    this.patch({ judgeBusy: false, judgePending: Boolean(this.pending), judgeCanRetry: Boolean(this.canRetry), judgeError: api.message(error),
      judgeStatus: unknown ? '先检查已有结果，不会自动重复判题。' : '' })
  }
  apply(id, result) {
    if (!this.alive || this.pending?.requestId !== id) return
    // Pending/failed responses can contain the previous message; do not show its
    // verdict underneath the player's newly submitted question.
    if (result.status === 'succeeded' && result.session) this.session(result.session)
    if (['succeeded', 'failed', 'superseded'].includes(result.status)) {
      this.pending = null; this.canRetry = false; clearTimeout(this.timer)
      this.patch({ judgeBusy: false, judgePending: false, judgeCanRetry: false, judgeStatus: '', judgeError: result.error ? api.message(result.error) : '' })
      return
    }
    this.canRetry = result.status === 'unknown'
    this.patch({ judgeBusy: result.status === 'processing', judgePending: true, judgeCanRetry: this.canRetry, judgeStatus: this.canRetry ? '原请求结果未知。先检查结果，也可以主动再试一次。' : 'AI 仍在处理，可以检查原来的请求。' })
    if (result.status === 'processing' && this.visible && Date.now() - this.pending.startedAt < 30000) {
      clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), 1500)
    } else this.patch({ judgeBusy: false })
  }
  async check() {
    if (!this.pending || !this.alive || this.checking) return
    this.checking = true
    const id = this.pending.requestId
    try { this.apply(id, await api.call('getRequest', { sessionId: this.sessionId, requestId: id })) }
    catch (error) { this.requestError(id, error) }
    finally { this.checking = false }
  }
  // Called only after the player explicitly confirms a new paid attempt.
  async retry() {
    if (!this.alive || !this.pending || !this.canRetry || this.sending || this.checking) return
    await this.check()
    if (!this.alive || !this.pending || !this.canRetry) return
    const previous = this.pending
    this.pending = null
    await this.submit(previous.kind, previous.text, previous.requestId)
  }
  async hint() {
    if (!this.alive || !this.sessionId || this.hintBusy || this.pending) return
    this.hintBusy = true
    this.patch({ judgeBusy: true, judgeError: '' })
    try { const result = await api.call('getHint', { sessionId: this.sessionId }); if (this.alive) this.session(result.session) }
    catch (error) { this.patch({ judgeError: api.message(error) }) }
    finally { this.hintBusy = false; this.patch({ judgeBusy: false }) }
  }
  show() { this.visible = true; if (this.pending) this.check() }
  hide() { this.visible = false; clearTimeout(this.timer) }
  dispose() {
    this.alive = false; this.hide()
    if (this.sessionId) api.call('clearSession', { sessionId: this.sessionId }).catch(() => {})
  }
}
module.exports = TutorialJudge
