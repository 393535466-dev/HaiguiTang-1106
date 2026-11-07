const api = require('./api')

class HostVoice {
  constructor(update) {
    this.update = update; this.alive = true; this.visible = true; this.generation = 0; this.cache = new Map()
    this.enabled = wx.getStorageSync('host_voice_enabled') === true
    this.audio = wx.createInnerAudioContext ? wx.createInnerAudioContext() : null
    if (this.audio) {
      this.audio.onEnded(() => this.patch({ hostVoiceBusy: false, hostVoiceStatus: '' }))
      this.audio.onError(() => this.patch({ hostVoiceBusy: false, hostVoiceStatus: '声音暂时无法播放，可以点重播；文字游戏不受影响。' }))
    }
    this.patch({ hostVoiceEnabled: this.enabled, hostVoiceBusy: false, hostVoiceStatus: '' })
  }
  patch(value) { if (this.alive) this.update(value) }
  sync(session) {
    if (!session) return
    const old = this.session, last = (session.messages || []).slice(-1)[0]
    this.session = session
    this.current = session.solution ? { target: 'solution' } : last ? { target: 'message', messageId: last.id } : { target: 'surface' }
    const changed = !old || old.id !== session.id || (session.solution && !old.solution) || (last && last.id !== (old.messages || []).slice(-1)[0]?.id)
    if (changed && this.enabled && this.visible) this.play(this.current)
  }
  toggle() {
    this.enabled = !this.enabled; wx.setStorageSync('host_voice_enabled', this.enabled)
    this.patch({ hostVoiceEnabled: this.enabled }); this.stop()
    if (this.enabled && this.session) this.play(this.current)
  }
  replay() { if (this.session) { if (!this.enabled) this.toggle(); else this.play(this.current) } }
  readSurface() {
    if (!this.session) return
    this.enabled = true; wx.setStorageSync('host_voice_enabled', true); this.patch({ hostVoiceEnabled: true })
    this.play({ target: 'surface' })
  }
  async play(target) {
    this.stop()
    if (!this.audio || !this.alive || !this.visible || !this.enabled || !this.session) return
    const generation = this.generation, sessionId = this.session.id
    const key = sessionId + ':' + target.target + ':' + (target.messageId || '')
    this.patch({ hostVoiceBusy: true, hostVoiceStatus: '正在准备主持人声音…' })
    try {
      let sound = this.cache.get(key)
      if (!sound || sound.expiresAt <= Date.now() + 60000) {
        sound = await api.call('getSpeech', Object.assign({ sessionId }, target), { timeout: 30000 })
        this.cache.set(key, sound)
      }
      if (!this.alive || !this.visible || generation !== this.generation || !this.enabled) return
      this.audio.src = sound.url; this.audio.play()
      this.patch({ hostVoiceBusy: true, hostVoiceStatus: '主持人正在说话…' })
    } catch (_) { if (this.alive && generation === this.generation) this.patch({ hostVoiceBusy: false, hostVoiceStatus: '这次播报没有准备好，可稍后点重播；文字游戏可以继续。' }) }
  }
  stop() { this.generation++; if (this.audio) this.audio.stop(); this.patch({ hostVoiceBusy: false, hostVoiceStatus: '' }) }
  hide() { this.visible = false; this.stop() }
  show() { this.visible = true }
  dispose() { this.alive = false; this.hide(); if (this.audio) this.audio.destroy(); this.cache.clear() }
}
module.exports = HostVoice
