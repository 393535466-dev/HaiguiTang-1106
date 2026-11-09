const carousel = require('../../utils/story-carousel')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const presentation = require('../../utils/presentation')
const PracticeVoice = require('../../utils/practice-voice')
const HostVoice = require('../../utils/host-voice')
const modal = options => new Promise(resolve => wx.showModal(Object.assign({}, options, { success: resolve })))
Page(Object.assign({
  data: { carouselCards: [], carouselShift: 0, carouselDragging: false, room: null, nickname: '', roomCode: '', lobbyMode: 'create', puzzles: [], puzzleIndex: 0, puzzle: null, selectedPuzzle: '', loading: true, busy: false, error: '', connection: '',
    mode: 'discussion', draft: '', pending: false, seconds: 45, recording: false, cancelling: false, recordSeconds: 0,
    voiceBusy: false, voicePending: false, voiceError: '', voiceStatus: '', recoveredTranscript: '', privacyNeeded: false, scrollTarget: '', surfaceExpanded: false },
  onLoad(options) {
    this._alive = true; this._visible = true; this._revision = 0; this._roomId = options.id || ''
    if (options.code) this.setData({ roomCode: options.code, lobbyMode: 'join' })
    this._host = new HostVoice(patch => { if (this._alive) this.setData(patch) }, { room: true })
    this._voice = new PracticeVoice({ update: patch => { if (this._alive) { this.setData(patch); this._host.setRecording(this.data.recording || this.data.voiceBusy) } }, transcript: (text, context) => {
      if (context.roomId !== this._roomId || !this.data.room || !['waiting', 'playing'].includes(this.data.room.state)) return
      if (context.revision === this._revision && context.mode === this.data.mode) this.edit(text)
      else this.setData({ recoveredTranscript: text })
    } })
    this.initialize()
  },
  onShow() { this._visible = true; clearInterval(this._clock); this._clock = setInterval(() => this.tickClock(), 1000); if (this._voice) this._voice.show(); if (this._host) this._host.show(); if (this._ready && this._roomId) this.poll() },
  onHide() { this._visible = false; clearTimeout(this._timer); clearInterval(this._clock); if (this._voice) this._voice.hide(); if (this._host) this._host.hide(); this.saveDraft() },
  onUnload() { this.onHide(); this._alive = false; if (this._voice) this._voice.dispose(); if (this._host) this._host.dispose() },
  async initialize() {
    try {
      const status = await api.call('status'); getApp().globalData.ownerKey = status.ownerKey; getApp().globalData.health = status
      if (!this._roomId && !this.data.roomCode) this._roomId = storage.read('hgt:' + storage.owner() + ':room') || ''
      const result = await api.call('getProfile'), list = await api.call('listPuzzles')
      if (!this._alive) return
      this.setData({ nickname: result.profile.nickname, puzzles: list.puzzles, carouselCards: carousel.cards(list.puzzles, 0), puzzleIndex: 0, puzzle: list.puzzles[0] || null, selectedPuzzle: list.puzzles[0]?.id || '', loading: false })
      this._ready = true
      if (this._roomId) {
        const draft = storage.draft('room-' + this._roomId)
        if (draft) { this._revision = draft.version || 0; this.setData({ draft: draft.text || '', mode: draft.mode || 'discussion' }) }
        this._pending = storage.pending('room-' + this._roomId); this.setData({ pending: Boolean(this._pending) }); this.poll()
      }
    } catch (e) { if (this._alive) this.setData({ loading: false, error: api.message(e) }) }
  },
  nicknameInput(e) { this.setData({ nickname: e.detail.value }) },
  switchLobby(e) { if (!this.data.busy) this.setData({ lobbyMode: e.currentTarget.dataset.mode, error: '' }) },
  tickClock() {
    if (!this._alive || !this._visible || this.data.room?.state !== 'playing') return
    const seconds = Math.max(0, Math.ceil((this.data.room.turnDeadlineAt - Date.now()) / 1000))
    if (seconds !== this.data.seconds) this.setData({ seconds })
  },
  codeInput(e) { this.setData({ roomCode: e.detail.value.replace(/\D/g, '').slice(0, 6) }) },
  choosePuzzle(e) { this.setData({ selectedPuzzle: e.currentTarget.dataset.id }) },
  movePuzzle(e) {
    const puzzleIndex = this.data.puzzleIndex + Number(e.currentTarget.dataset.direction)
    carousel.select(this, 'puzzleIndex', puzzleIndex)
  },
  async enter(action) {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try {
      await api.call('saveProfile', { nickname: this.data.nickname })
      const r = await api.call(action, { puzzleId: this.data.selectedPuzzle, roomId: this.data.roomCode })
      if (!this._alive) return
      this._roomId = r.room.id; this.apply(r.room); this.poll()
    } catch (e) { if (this._alive) this.setData({ error: api.message(e) }) }
    finally { if (this._alive) this.setData({ busy: false }) }
  },
  create() { this.enter('createRoom') }, join() { this.enter('joinRoom') },
  apply(room) {
    if (!this._alive || !room || room.id !== this._roomId) return
    const old = this.data.room, latest = room.messages[room.messages.length - 1]
    if (old && old.id === room.id && room.revision < old.revision) return
    const oldLast = old && old.messages[old.messages.length - 1]
    const messages = presentation.session({ ...room, maxGuessFailures: 5 }).messages.map(m => ({ ...m, isMe: m.playerId === room.meId }))
    const members = room.members.map(m => ({ ...m, initial: Array.from(m.nickname || '友')[0] }))
    this._host.sync(room)
    this.setData({ room: Object.assign({}, room, { messages, members }), loading: false, connection: '', seconds: Math.max(0, Math.ceil((room.turnDeadlineAt - Date.now()) / 1000)),
      scrollTarget: (latest && latest.id !== oldLast?.id) || (room.solution && !old?.solution) ? 'room-message-end' : '' })
    storage.write('hgt:' + storage.owner() + ':room', room.id)
    if (room.state === 'playing' && room.active?.mine && !this._pending) {
      this._pending = { requestId: room.active.requestId, revision: -1 }; this.setData({ pending: true })
    }
  },
  async poll() {
    clearTimeout(this._timer)
    if (!this._alive || !this._visible || !this._roomId || this._polling) return
    this._polling = true
    try {
      const r = await api.call('getRoom', { roomId: this._roomId }); this.apply(r.room)
      if (this._pending) await this.checkResult()
    } catch (e) {
      if (!this._alive) return
      this.setData({ connection: '连接暂时中断，保留草稿并尝试恢复。', error: api.message(e) })
      if (['ROOM_ENDED', 'ROOM_FORBIDDEN'].includes(e.code)) {
        storage.remove('hgt:' + storage.owner() + ':room'); this.clearPending(); this._roomId = ''; this.setData({ room: null, connection: '' })
      }
    } finally {
      this._polling = false
      if (this._alive && this._visible && this._roomId) this._timer = setTimeout(() => this.poll(), 2000)
    }
  },
  edit(text) { this._revision++; this.setData({ draft: text }); this.saveDraft() },
  input(e) { this.edit(e.detail.value) },
  saveDraft() { if (this._roomId) storage.saveDraft('room-' + this._roomId, { text: this.data.draft, mode: this.data.mode, version: this._revision }) },
  switchMode(e) { if (this.data.recording || this.data.busy) return; this._revision++; this.setData({ mode: e.currentTarget.dataset.mode, error: '' }); this.saveDraft() },
  clearPending() { this._pending = null; if (this._roomId) storage.savePending('room-' + this._roomId, null); if (this._alive) this.setData({ pending: false }) },
  applyResult(id, result) {
    if (!this._alive || this._pending?.requestId !== id) return
    if (result.room) this.apply(result.room)
    if (['succeeded','failed','superseded'].includes(result.status)) {
      const pending = this._pending
      if (result.status === 'succeeded' && pending.revision === this._revision) this.edit('')
      this.clearPending(); this.setData({ error: result.error?.message || '' })
    } else this.setData({ error: result.error?.message || '', pending: true })
  },
  async checkResult() {
    if (!this._pending || this._checking) return
    this._checking = true; const id = this._pending.requestId
    try { this.applyResult(id, await api.call('getRoomRequest', { roomId: this._roomId, requestId: id })) }
    catch (e) { if (this._alive) this.setData({ error: api.message(e) }) }
    finally { this._checking = false }
  },
  async submit() {
    const room = this.data.room, mode = this.data.mode, text = this.data.draft.trim()
    if (!room || !text || this.data.busy || this.data.recording) return
    if (mode !== 'discussion' && (!room.myTurn || this._pending || room.active)) return
    const revision = this._revision
    this.setData({ busy: true, error: '' })
    try {
      if (mode === 'discussion') {
        if (!this._chat || this._chat.text !== text) this._chat = { text, requestId: api.requestId() }
        const r = await api.call('roomChat', { roomId: room.id, ...this._chat }); this.apply(r.room)
        if (this._alive && revision === this._revision) this.edit(''); this._chat = null
      } else {
        const requestId = api.requestId(); this._pending = { requestId, revision }
        storage.savePending('room-' + room.id, this._pending); this.setData({ pending: true })
        const result = await api.call(mode === 'guess' ? 'roomGuess' : 'roomQuestion', { roomId: room.id, requestId, turnSerial: room.turnSerial, text }, {
          onLate: (error, result) => { if (!error) this.applyResult(requestId, result) }
        })
        this.applyResult(requestId, result)
      }
    } catch (e) {
      if (this._alive) this.setData({ error: api.message(e) })
      if (mode !== 'discussion' && e.code && !['CLIENT_TIMEOUT','NETWORK_ERROR','RESULT_UNKNOWN','BAD_RESPONSE'].includes(e.code)) this.clearPending()
    } finally { if (this._alive) this.setData({ busy: false }) }
  },
  async action(name) {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try { const r = await api.call(name, { roomId: this._roomId, turnSerial: this.data.room?.turnSerial }); if (r.room) this.apply(r.room) }
    catch (e) { if (this._alive) this.setData({ error: api.message(e) }) }
    finally { if (this._alive) this.setData({ busy: false }) }
  },
  start() { this.action('startRoom') },
  async skip() { const c = await modal({ title: '把这一轮交给下一位？', content: '进行中的判题可能已经计费。跳过后，旧结果不会再写入房间。' }); if (c.confirm) { await this.action('skipRoomTurn'); if (this._pending) await this.checkResult() } },
  async hint() { const c = await modal({ title: '为大家解锁一条提示？', content: '所有人都能看到，猜中后的共同得分减少 10 分。' }); if (c.confirm) this.action('roomHint') },
  async reveal() { const c = await modal({ title: '结束整个房间并揭底？', content: '所有玩家都会看到答案，本局不获得积分。' }); if (c.confirm) this.action('revealRoom') },
  async leave() {
    const c = await modal({ title: '退出这个房间？', content: '开局后主动退出将不参与本局计分。只是暂时离开页面，可以点返回，之后继续。' })
    if (!c.confirm) return
    this._voice.cancel(); this._host.stop(); this._revision++
    try { await api.call('leaveRoom', { roomId: this._roomId }); storage.remove('hgt:' + storage.owner() + ':room'); this.clearPending(); this._roomId = ''; this.setData({ room: null, error: '', draft: '', busy: false }) }
    catch (e) { this.setData({ error: api.message(e) }) }
  },
  copyCode() { wx.setClipboardData({ data: this._roomId, success: () => wx.showToast({ title: '房间号已复制', icon: 'none' }) }) },
  onShareAppMessage() { return { title: '来一碗海龟汤，一起找真相', path: '/pages/room/index?code=' + this._roomId } },
  home() { wx.redirectTo({ url: '/pages/home/index' }) },
  leaderboard() { wx.navigateTo({ url: '/pages/leaderboard/index?mode=friends' }) },
  toggleSurface() { this.setData({ surfaceExpanded: !this.data.surfaceExpanded }) },
  toggleHostVoice() { this._host.toggle() }, replayHostVoice() { this._host.replay() }, readSurface() { this._host.readSurface() },
  recordStart(e) { if (!this.data.room || this.data.busy || this.data.recording) return; this._host.stop(); this._voice.start(e, { revision: this._revision, mode: this.data.mode, roomId: this._roomId }) },
  recordMove(e) { this._voice.move(e) }, recordEnd() { this._voice.end() }, recordCancel() { this._voice.cancel() }, checkVoice() { this._voice.check() },
  async useTranscript() { const c = await modal({ title: '使用识别文字？', content: '将替换当前草稿，仍需你确认发送。' }); if (c.confirm) { this.edit(this.data.recoveredTranscript); this.setData({ recoveredTranscript: '' }) } },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  agreePrivacy() { getApp().resolvePrivacy(true); this.setData({ privacyNeeded: false }) }, declinePrivacy() { getApp().resolvePrivacy(false); this.setData({ privacyNeeded: false }) }
}, carousel.handlers('puzzleIndex')))
