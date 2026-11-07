const api = require('./api')

function native(name, options) {
  return new Promise((resolve, reject) => wx[name](Object.assign({}, options || {}, { success: resolve, fail: reject })))
}

// A separate, short-lived voice session; never replaces the player's real game.
class PracticeVoice {
  constructor({ update, transcript }) {
    this.update = update; this.transcript = transcript
    this.alive = true; this.visible = true; this.pressed = false
    this.supported = Boolean(wx.getRecorderManager)
    if (!this.supported) return
    this.recorder = wx.getRecorderManager()
    this.onStart = () => {
      if (!this.alive || !this.visible || !this.pressed) { this.cancelled = true; this.recorder.stop(); return }
      this.recording = true; this.seconds = 0
      this.patch({ recording: true, voiceBusy: false, recordSeconds: 0, voiceStatus: '', voiceError: '' })
      this.timer = setInterval(() => this.patch({ recordSeconds: ++this.seconds }), 1000)
    }
    this.onStop = result => {
      clearInterval(this.timer); this.recording = false; this.starting = false
      this.patch({ recording: false, cancelling: false })
      if (!this.alive || !this.visible || this.cancelled) {
        this.removeLocal(result.tempFilePath)
        if (!this.alive || !this.visible) this.detach()
        return
      }
      if (result.duration < 500) { this.removeLocal(result.tempFilePath); this.patch({ voiceError: '太短啦，再说完整一点。' }); return }
      this.upload(result.tempFilePath, this.context)
    }
    this.onError = () => {
      clearInterval(this.timer); this.recording = false; this.starting = false
      this.patch({ recording: false, voiceBusy: false, cancelling: false, voiceError: '录音没有完成，可以重新录制或打字。' })
      if (!this.alive || !this.visible) this.detach()
    }
    this.attach()
  }
  attach() {
    if (!this.recorder || this.bound || !this.alive) return
    this.recorder.onStart(this.onStart); this.recorder.onStop(this.onStop); this.recorder.onError(this.onError); this.bound = true
  }
  detach() {
    if (!this.recorder || !this.bound) return
    if (this.recorder.offStart) this.recorder.offStart(this.onStart)
    if (this.recorder.offStop) this.recorder.offStop(this.onStop)
    if (this.recorder.offError) this.recorder.offError(this.onError)
    this.bound = false
  }
  patch(value) { if (this.alive) this.update(value) }
  async start(e, context) {
    if (!this.supported) { this.patch({ voiceError: '当前浏览器预览不支持语音转写。可以直接打字，语音请在微信体验版使用。' }); return }
    if (this.settingUp || this.starting || this.recording || this.working || this.pending || !this.alive) return
    this.pressed = true; this.cancelled = false; this.settingUp = true
    this.touchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    this.context = context
    this.patch({ voiceBusy: true, voiceError: '', voiceStatus: '正在准备语音输入…' })
    try {
      // Check the service before asking for microphone permission.
      if (!this.sessionId) {
        const result = await api.call('startVoicePractice')
        if (!this.alive) { api.call('clearSession', { sessionId: result.session.id }).catch(() => {}); return }
        this.sessionId = result.session.id
      }
      if (!this.visible || !this.alive) return
      await getApp().ensurePrivacy()
      await native('authorize', { scope: 'scope.record' })
      if (!this.pressed || !this.visible || !this.alive) { this.patch({ voiceStatus: '已准备好，请再次按住说话。' }); return }
      this.starting = true
      this.recorder.start({ duration: 19000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
    } catch (error) {
      this.starting = false
      const denied = /auth|deny|denied/i.test(error.errMsg || '')
      this.patch({ voiceError: denied ? '未获得麦克风权限。可在微信设置中开启，也可以直接打字。' : api.message(error), voiceStatus: '' })
    } finally { this.settingUp = false; this.patch({ voiceBusy: false }) }
  }
  move(e) {
    if (!this.recording || !e.touches || !e.touches[0]) return
    this.cancelled = e.touches[0].clientY < this.touchY - 60
    this.patch({ cancelling: this.cancelled })
  }
  end() { this.pressed = false; if (this.recording || this.starting) this.recorder.stop() }
  cancel() { this.cancelled = true; this.end() }
  hide() { this.visible = false; this.cancel(); clearTimeout(this.pollTimer); if (!this.recording && !this.starting) this.detach() }
  show() { this.visible = true; this.attach(); if (this.pending) this.check() }
  removeLocal(path) {
    if (path && wx.getFileSystemManager) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }) } catch (_) {} }
  }
  async upload(path, context) {
    this.working = true
    const sid = this.sessionId
    let upload, fileID, dispatched = false
    this.patch({ voiceBusy: true, voiceError: '', voiceStatus: '正在上传录音…' })
    try {
      upload = await api.call('registerUpload', { sessionId: sid })
      if (!this.alive || !this.visible) return
      fileID = (await wx.cloud.uploadFile({ cloudPath: upload.cloudPath, filePath: path })).fileID
      await api.call('confirmUpload', { sessionId: sid, uploadId: upload.uploadId, fileID })
      if (!this.alive || !this.visible) return
      const requestId = api.requestId()
      this.pending = { requestId, context, startedAt: Date.now() }
      this.patch({ voicePending: true, voiceStatus: '正在转成文字，完成后请核对再发送…' })
      dispatched = true
      const result = await api.call('transcribeAudio', { sessionId: sid, requestId, uploadId: upload.uploadId, fileID }, {
        onLate: (error, result) => error ? this.requestError(requestId, error) : this.apply(requestId, result)
      })
      this.apply(requestId, result)
    } catch (error) {
      if (dispatched && this.pending) this.requestError(this.pending.requestId, error)
      else this.patch({ voiceError: api.message(error), voiceStatus: '' })
    } finally {
      this.removeLocal(path)
      if (upload && !dispatched) await api.call('discardUpload', { sessionId: sid, uploadId: upload.uploadId, fileID }).catch(() => {})
      this.working = false; this.patch({ voiceBusy: false })
      if (!this.alive) this.clearSession()
    }
  }
  requestError(id, error) {
    if (!this.alive || !this.pending || this.pending.requestId !== id) return
    this.patch({ voiceBusy: false, voiceError: api.message(error), voiceStatus: '先检查这次转写结果，不会自动重新调用。' })
  }
  apply(id, result) {
    if (!this.alive || !this.pending || this.pending.requestId !== id) return
    const pending = this.pending
    if (result.status === 'succeeded') {
      this.pending = null; clearTimeout(this.pollTimer)
      this.patch({ voiceBusy: false, voicePending: false, voiceError: '', voiceStatus: '文字已转写，请核对后再发送。' })
      if (result.transcript) this.transcript(result.transcript, pending.context)
      return
    }
    if (['failed', 'superseded'].includes(result.status)) {
      this.pending = null; clearTimeout(this.pollTimer)
      this.patch({ voiceBusy: false, voicePending: false, voiceStatus: '', voiceError: result.error ? api.message(result.error) : '这次转写未完成，请重新录制或打字。' })
      return
    }
    this.patch({ voiceBusy: false, voicePending: true, voiceStatus: '转写结果尚未确认，可以检查结果或继续打字。' })
    if (result.status === 'processing' && this.visible && Date.now() - pending.startedAt < 30000) {
      clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => this.check(), 1500)
    }
  }
  async check() {
    if (!this.pending || !this.alive || this.checking) return
    this.checking = true
    const id = this.pending.requestId
    try { this.apply(id, await api.call('getRequest', { sessionId: this.sessionId, requestId: id })) }
    catch (error) { this.requestError(id, error) }
    finally { this.checking = false }
  }
  dispose() {
    this.alive = false; this.hide(); clearInterval(this.timer); clearTimeout(this.pollTimer)
    if (!this.recording && !this.starting) this.detach()
    // An upload already in flight must finish/discard before deleting its registration.
    if (!this.working) this.clearSession()
  }
  clearSession() {
    const id = this.sessionId; this.sessionId = null
    if (id) api.call('clearSession', { sessionId: id }).catch(() => {})
  }
}
module.exports = PracticeVoice
