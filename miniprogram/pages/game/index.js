const api = require('../../utils/api')
const storage = require('../../utils/storage')
const presentation = require('../../utils/presentation')

function modal(options) { return new Promise(resolve => wx.showModal(Object.assign({}, options, { success: resolve, fail: () => resolve({ confirm: false }) }))) }
function native(name, options) { return new Promise((resolve, reject) => wx[name](Object.assign({}, options || {}, { success: resolve, fail: reject }))) }

Page({
  data: {
    session: null, loading: true, error: '', draft: '', mode: 'question', busy: false,
    statusText: '', pending: null, recording: false, cancelling: false, recordSeconds: 0,
    surfaceExpanded: false, privacyNeeded: false, scrollTarget: '',
    voiceReady: false, draftSource: '', configured: false, recoveredTranscript: ''
  },
  onLoad(options) {
    this._alive = true; this._visible = true; this._draftVersion = 0
    this._sessionId = options.id || ''
    this._bindRecorder()
    this._initializing = this.initialize()
  },
  onShow() {
    this._visible = true
    if (this._initialized) this.reload().then(() => this._pending && this.checkResult())
  },
  onHide() {
    this._visible = false; this.saveDraft(); this._pressed = false; this._cancelRecord = true
    if (this._recorder && this.data.recording) this._recorder.stop()
    clearTimeout(this._pollTimer)
  },
  onUnload() {
    this.onHide(); this._alive = false
    clearInterval(this._recordTimer)
    if (this._recorder) {
      if (this._recorder.offStart) this._recorder.offStart(this._onRecordStart)
      if (this._recorder.offStop) this._recorder.offStop(this._onRecordStop)
      if (this._recorder.offError) this._recorder.offError(this._onRecordError)
    }
  },
  async initialize() {
    try {
      const health = await api.call('status')
      getApp().globalData.health = health
      getApp().globalData.ownerKey = health.ownerKey || ''
      if (!this._alive) return
      this.setData({ voiceReady: Boolean(health.voiceReady), configured: Boolean(health.textReady) })
      const saved = storage.draft(this._sessionId)
      if (saved) { this._draftVersion = saved.version || 0; this.setData({ draft: saved.text || '', mode: saved.mode || 'question', draftSource: saved.source || '' }) }
      this._pending = storage.pending(this._sessionId)
      await this.reload()
      this._initialized = true
      if (this._pending && this.data.session && !this.data.session.ended) {
        this.setData({ pending: this._pending, statusText: '发现上次未确认的操作，正在检查结果。' })
        await this.checkResult()
      }
    } catch (e) { if (this._alive) this.setData({ loading: false, error: api.message(e) }) }
  },
  async reload() {
    try {
      const result = await api.call('getSession', { sessionId: this._sessionId })
      if (!this._alive) return
      if (result.session && result.session.state === 'playing' && result.session.activeRequestId && (!this._pending || this._pending.requestId !== result.session.activeRequestId)) {
        const previous = this._previousPending && this._previousPending.requestId === result.session.activeRequestId ? this._previousPending : null
        this._setPending(previous ? Object.assign({}, previous, { status: 'unknown' }) : { requestId: result.session.activeRequestId, kind: 'recovered', status: 'unknown', draftVersion: -1, retryable: false, createdAt: Date.now() })
      }
      this.applySession(result.session)
      this.setData({ loading: false, error: '' })
    } catch (e) {
      if (this._alive) {
        if (e.code === 'NOT_FOUND' || e.code === 'SESSION_ENDED') {
          this._cleared = true
          storage.clearLast(this._sessionId); storage.clearDraft(this._sessionId); this._clearPending()
          this.setData({ session: null, draft: '', recoveredTranscript: '' })
        }
        this.setData({ loading: false, error: api.message(e) })
      }
    }
  },
  applySession(session) {
    if (!session || session.id !== this._sessionId || !this._alive) return
    const decorated = presentation.session(session)
    this.setData({ session: decorated, scrollTarget: 'message-end' })
    if (decorated.ended) {
      storage.clearLast(session.id); storage.clearDraft(session.id)
      this._clearPending()
    } else storage.saveLast(session.id)
  },
  saveDraft() {
    if (!this._cleared && this._sessionId && (!this.data.session || !this.data.session.ended)) {
      storage.saveDraft(this._sessionId, { text: this.data.draft, mode: this.data.mode, source: this.data.draftSource, version: this._draftVersion })
    }
  },
  onInput(e) {
    this._draftVersion += 1
    const fromVoice = this.data.draftSource === 'voice' || this.data.draftSource === 'edited'
    this.setData({ draft: e.detail.value, draftSource: fromVoice ? 'edited' : 'typed' })
    this.saveDraft()
  },
  switchMode(e) {
    if (this.data.busy || this.data.recording) return
    const mode = e.currentTarget.dataset.mode
    this.setData({ mode, error: '' }); this.saveDraft()
  },
  toggleSurface() { this.setData({ surfaceExpanded: !this.data.surfaceExpanded }) },
  _setPending(value) {
    if (value && this._pending && this._pending.requestId !== value.requestId) this._previousPending = this._pending
    this._pending = value
    storage.savePending(this._sessionId, value)
    if (this._alive) this.setData({ pending: value })
  },
  _clearPending() {
    clearTimeout(this._pollTimer)
    this._setPending(null)
    if (this._alive) this.setData({ busy: false, statusText: '' })
  },
  async submit() {
    if (this.data.busy || this.data.recording || !this.data.session || this.data.session.ended) return
    if (!this.data.configured) { this.setData({ error: '裁判尚未配置，请先完成部署。' }); return }
    const text = this.data.draft.trim()
    if (!text) { wx.showToast({ title: '先说一句，或写下你的问题', icon: 'none' }); return }
    const max = this.data.mode === 'guess' ? 500 : 200
    if (text.length > max) { this.setData({ error: '请将这次内容缩短到' + max + '字以内。' }); return }
    let replaceRequestId
    if (this._pending) {
      const result = await modal({ title: '替代上一次操作？', content: '上次操作可能仍在处理。提交新内容会使旧结果失效，并可能产生新的调用费用。', confirmText: '确认新提交', confirmColor: '#214c3e' })
      if (!result.confirm) return
      replaceRequestId = this._pending.requestId
    }
    await this._judge({ kind: this.data.mode === 'guess' ? 'guessAnswer' : 'askQuestion', text, replaceRequestId })
  },
  async _judge(options) {
    const requestId = api.requestId()
    const pending = { requestId, kind: options.kind, text: options.text, draftVersion: this._draftVersion, status: 'processing', createdAt: Date.now() }
    this._setPending(pending)
    this.setData({ busy: true, error: '', statusText: options.kind === 'guessAnswer' ? '裁判正在核对你的完整解释…' : '裁判正在读你的问题…' })
    const payload = { sessionId: this._sessionId, requestId, text: options.text }
    if (options.replaceRequestId) payload.replaceRequestId = options.replaceRequestId
    try {
      const result = await api.call(options.kind, payload, { onLate: (e, r) => this._late(requestId, e, r) })
      await this._applyRequest(requestId, result)
    } catch (e) { this._requestError(requestId, e) }
  },
  _late(requestId, e, result) {
    if (!this._alive || !this._pending || this._pending.requestId !== requestId) return
    if (e) this._requestError(requestId, e)
    else this._applyRequest(requestId, result)
  },
  _requestError(requestId, e) {
    if (!this._alive || !this._pending || this._pending.requestId !== requestId) return
    this._setPending(Object.assign({}, this._pending, { status: e.code === 'CLIENT_TIMEOUT' ? 'unknown' : 'failed' }))
    this.setData({ busy: false, error: api.message(e), statusText: '先检查结果，重试不会自动发生。' })
    if (e.code === 'BUSY' || e.code === 'RESULT_UNKNOWN') {
      this.reload().then(() => { if (this._alive && this._pending) this.checkResult() })
    }
  },
  async _applyRequest(requestId, result) {
    if (!this._alive || !this._pending || this._pending.requestId !== requestId) return
    const pending = this._pending
    if (result.status === 'succeeded') {
      if (pending.kind === 'transcribeAudio' || (pending.kind === 'recovered' && typeof result.transcript === 'string')) {
        if (this._draftVersion === pending.draftVersion && (!this.data.session || !this.data.session.ended)) {
          this._draftVersion += 1
          this.setData({ draft: result.transcript || '', draftSource: 'voice', recoveredTranscript: '' })
          this.saveDraft()
        } else if (!this.data.session || !this.data.session.ended) {
          this.setData({ recoveredTranscript: result.transcript || '' })
        }
        this._clearPending()
        if (this._visible) wx.showToast({ title: '请确认识别文字后再提交', icon: 'none' })
      } else {
        if (result.session) this.applySession(result.session)
        else await this.reload()
        if (this._draftVersion === pending.draftVersion) {
          this.setData({ draft: '', draftSource: '' }); storage.clearDraft(this._sessionId)
        }
        this._clearPending()
        this.setData({ error: '' })
      }
      return
    }
    if (result.status === 'superseded') {
      this._clearPending(); await this.reload(); return
    }
    if (result.status === 'failed' && result.error &&
      ['EMPTY_TRANSCRIPT', 'TRANSCRIPT_TOO_LONG'].includes(result.error.code)) {
      this._clearPending()
      this.setData({ error: api.message(result.error) })
      return
    }
    const state = result.status || 'unknown'
    this._setPending(Object.assign({}, pending, { status: state }))
    this.setData({ busy: state === 'processing', error: result.error ? api.message(result.error) : '', statusText: state === 'processing' ? '操作仍在处理中，正在查询已有结果…' : '这次结果尚未确认，可以检查结果，或确认后提交新内容。' })
    if (state === 'processing' && Date.now() - pending.createdAt < 30000 && this._visible) {
      clearTimeout(this._pollTimer)
      this._pollTimer = setTimeout(() => this.checkResult(), 1500)
    } else this.setData({ busy: false })
  },
  async checkResult() {
    if (!this._pending || !this._alive) return
    const requestId = this._pending.requestId
    this.setData({ statusText: '只查询已有结果，不会重新调用裁判。' })
    try {
      const result = await api.call('getRequest', { sessionId: this._sessionId, requestId })
      await this._applyRequest(requestId, result)
    } catch (e) {
      if (this._alive && this._pending && this._pending.requestId === requestId) this.setData({ busy: false, error: api.message(e) })
    }
  },
  async retry() {
    const pending = this._pending
    if (!pending || pending.retryable === false || this.data.busy) return
    const confirm = await modal({ title: '确认再尝试一次？', content: '旧操作可能已产生费用。新尝试会替代旧结果，并可能再次计费。', confirmText: '确认重试', confirmColor: '#214c3e' })
    if (!confirm.confirm) return
    if (pending.kind === 'transcribeAudio') {
      await this._transcribe({ uploadId: pending.uploadId, fileID: pending.fileID, replaceRequestId: pending.requestId })
    } else await this._judge({ kind: pending.kind, text: pending.text, replaceRequestId: pending.requestId })
  },
  async hint() {
    if (!this.data.session || this.data.session.ended || this.data.session.hintCount >= 3 || this._hintBusy) return
    const confirm = await modal({ title: '揭开一条线索？', content: '提示会逐步接近真相，已解锁的提示可以随时回看。', confirmText: '查看提示', confirmColor: '#214c3e' })
    if (!confirm.confirm) return
    this._hintBusy = true
    try { const result = await api.call('getHint', { sessionId: this._sessionId }); this.applySession(result.session) }
    catch (e) { this.setData({ error: api.message(e) }) }
    finally { this._hintBusy = false }
  },
  async reveal() {
    if (!this.data.session || this.data.session.ended) return
    const confirm = await modal({ title: '现在揭晓答案？', content: '揭底后本局结束，这道题会标记为已看答案。', confirmText: '确认揭底', confirmColor: '#9d4b38' })
    if (!confirm.confirm) return
    try { const result = await api.call('revealSoup', { sessionId: this._sessionId }); this.applySession(result.session) }
    catch (e) { this.setData({ error: api.message(e) }) }
  },
  async clear() {
    const confirm = await modal({ title: '清空这本手账？', content: '将结束本局并删除问答、草稿和录音。已产生的服务费用不会退回。', confirmText: '确认清空', confirmColor: '#9d4b38' })
    if (!confirm.confirm) return
    try {
      await api.call('clearSession', { sessionId: this._sessionId })
      this._cleared = true
      storage.clearDraft(this._sessionId); storage.clearLast(this._sessionId); this._clearPending()
      this.home()
    } catch (e) { this.setData({ error: api.message(e) }) }
  },
  async feedback(e) {
    try {
      await api.call('feedback', { sessionId: this._sessionId, messageId: e.currentTarget.dataset.id, kind: e.currentTarget.dataset.id ? 'wrong_answer' : 'puzzle_issue' })
      wx.showToast({ title: '问题已记下，谢谢你', icon: 'none' })
    } catch (e) { this.setData({ error: api.message(e) }) }
  },
  home() {
    const pages = getCurrentPages()
    for (let index = pages.length - 2; index >= 0; index--) {
      if (pages[index].route === 'pages/home/index') { wx.navigateBack({ delta: pages.length - 1 - index }); return }
    }
    wx.redirectTo({ url: '/pages/home/index' })
  },
  async useRecoveredTranscript() {
    if (this.data.draft) {
      const confirm = await modal({ title: '使用上次识别文字？', content: '这会替换当前输入框里的草稿。', confirmText: '替换草稿', confirmColor: '#214c3e' })
      if (!confirm.confirm) return
    }
    this._draftVersion += 1
    this.setData({ draft: this.data.recoveredTranscript, draftSource: 'voice', recoveredTranscript: '' })
    this.saveDraft()
  },
  more() {
    wx.showActionSheet({ itemList: ['录音与隐私说明', '清空本局记录'], success: e => { if (e.tapIndex === 0) this.privacy(); else if (e.tapIndex === 1) this.clear() } })
  },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  agreePrivacy() { getApp().resolvePrivacy(true); this.setData({ privacyNeeded: false }) },
  declinePrivacy() { getApp().resolvePrivacy(false); this.setData({ privacyNeeded: false }) },
  _bindRecorder() {
    if (!wx.getRecorderManager) return
    this._recorder = wx.getRecorderManager()
    this._onRecordStart = () => {
      if (!this._alive || !this._pressed) { this._cancelRecord = true; this._recorder.stop(); return }
      this.setData({ recording: true, recordSeconds: 0, cancelling: false, error: '', statusText: '' })
      this._recordTimer = setInterval(() => { if (this._alive) this.setData({ recordSeconds: Math.min(20, this.data.recordSeconds + 1) }) }, 1000)
    }
    this._onRecordStop = result => {
      clearInterval(this._recordTimer)
      const cancelled = this._cancelRecord || !this._visible || !this._alive
      if (this._alive) this.setData({ recording: false, cancelling: false })
      if (cancelled) { this._deleteLocal(result.tempFilePath); return }
      if (result.duration < 500) { this._deleteLocal(result.tempFilePath); wx.showToast({ title: '太短啦，再说完整一点', icon: 'none' }); return }
      this._uploadRecording(result.tempFilePath)
    }
    this._onRecordError = () => {
      clearInterval(this._recordTimer)
      if (this._alive) this.setData({ recording: false, cancelling: false, error: '录音没有完成。可以重新按住，或直接打字提问。' })
    }
    this._recorder.onStart(this._onRecordStart); this._recorder.onStop(this._onRecordStop); this._recorder.onError(this._onRecordError)
  },
  async recordStart(e) {
    if (this.data.busy || !this.data.session || this.data.session.ended) return
    if (!this.data.voiceReady || !this._recorder) { this.setData({ error: '语音服务尚未配置，可以先打字提问。' }); return }
    this._pressed = true; this._cancelRecord = false
    this._touchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    const pressId = (this._pressId || 0) + 1; this._pressId = pressId
    try {
      await getApp().ensurePrivacy()
      const settings = await native('getSetting')
      if (settings.authSetting && settings.authSetting['scope.record'] === false) {
        const result = await modal({ title: '需要麦克风权限', content: '只在你主动按住时录音。也可以继续使用文字输入。', confirmText: '打开设置', confirmColor: '#214c3e' })
        if (result.confirm) await native('openSetting')
        return
      }
      await native('authorize', { scope: 'scope.record' })
      if (!this._alive || !this._pressed || pressId !== this._pressId) {
        if (this._alive && pressId === this._pressId) this.setData({ statusText: '麦克风已授权，请再次按住说话。' })
        return
      }
      if (this._pending && this._replaceForRecording !== this._pending.requestId) {
        const result = await modal({ title: '替代上一次操作？', content: '重新录音会产生新的识别尝试，旧操作可能已经计费。', confirmText: '继续录音', confirmColor: '#214c3e' })
        if (!result.confirm) return
        this._replaceForRecording = this._pending.requestId
        if (!this._pressed) { wx.showToast({ title: '已确认，请再次按住录音', icon: 'none' }); return }
      }
      this._recorder.start({ duration: 19000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
    } catch (_) {
      if (this._alive) this.setData({ error: '没有获得录音授权。你仍可以用文字继续。' })
    }
  },
  recordMove(e) {
    if (!this.data.recording || !e.touches || !e.touches[0]) return
    const cancel = e.touches[0].clientY < this._touchY - 60
    this._cancelRecord = cancel; this.setData({ cancelling: cancel })
  },
  recordEnd() {
    this._pressed = false
    if (this.data.recording && this._recorder) this._recorder.stop()
  },
  recordCancel() {
    this._pressed = false; this._cancelRecord = true
    if (this.data.recording && this._recorder) this._recorder.stop()
  },
  _deleteLocal(filePath) {
    if (!filePath || !wx.getFileSystemManager) return
    try { wx.getFileSystemManager().unlink({ filePath, fail() {} }) } catch (_) {}
  },
  async _uploadRecording(filePath) {
    const sessionId = this._sessionId
    const replaceRequestId = this._pending && this._pending.requestId
    this.setData({ busy: true, error: '', statusText: '正在上传这段录音…' })
    let upload, fileID
    try {
      upload = await api.call('registerUpload', { sessionId })
      if (!this._alive || !this._visible) return
      const uploaded = await wx.cloud.uploadFile({ cloudPath: upload.cloudPath, filePath })
      fileID = uploaded.fileID
      await api.call('confirmUpload', { sessionId, uploadId: upload.uploadId, fileID })
      if (!this._alive || !this._visible) {
        await api.call('discardUpload', { sessionId, uploadId: upload.uploadId, fileID }).catch(() => {})
        return
      }
      await this._transcribe({ uploadId: upload.uploadId, fileID, replaceRequestId })
    } catch (e) {
      if (this._alive) this.setData({ busy: false, error: api.message(e), statusText: '' })
      if (upload) api.call('discardUpload', { sessionId, uploadId: upload.uploadId, fileID }).catch(() => {})
    } finally {
      this._deleteLocal(filePath)
      if (this._alive && !this._pending) this.setData({ busy: false })
    }
  },
  async _transcribe(options) {
    const requestId = api.requestId()
    const pending = { requestId, kind: 'transcribeAudio', uploadId: options.uploadId, fileID: options.fileID, status: 'processing', draftVersion: this._draftVersion, createdAt: Date.now() }
    this._setPending(pending)
    this.setData({ busy: true, statusText: '正在把声音写成文字…', error: '' })
    const payload = { sessionId: this._sessionId, requestId, uploadId: options.uploadId, fileID: options.fileID }
    if (options.replaceRequestId) payload.replaceRequestId = options.replaceRequestId
    try {
      const result = await api.call('transcribeAudio', payload, { onLate: (e, r) => this._late(requestId, e, r) })
      await this._applyRequest(requestId, result)
    } catch (e) { this._requestError(requestId, e) }
  }
})
