const PracticeVoice = require('../../utils/practice-voice')
const TutorialJudge = require('../../utils/tutorial-judge')
const presentation = require('../../utils/presentation')
const HostVoice = require('../../utils/host-voice')

Page({
  data: {
    step: 0, steps: ['读汤面', '提问题', '看提示', '猜汤底'],
    question: '', questionResult: '', questionLabel: '', questionNote: '', submittedQuestion: '',
    hintShown: false, hintText: '', guess: '', guessResult: '', guessLabel: '', guessNote: '', submittedGuess: '',
    returnToGame: false, scrollTarget: 'practice-top-0', inputError: '',
    voiceSupported: false, recording: false, cancelling: false, recordSeconds: 0,
    voiceBusy: false, voicePending: false, voiceStatus: '', voiceError: '',
    recoveredTranscript: '', recoveredStep: 0, privacyNeeded: false,
    judgeReady: false, judgeMode: 'real', judgeChecking: true, judgeBusy: false,
    judgePending: false, judgeCanRetry: false, judgeStatus: '', judgeError: '', solution: '', sessionEnded: false
  },
  onLoad() {
    this._alive = true; this._draftRevision = 0
    this._host = new HostVoice(value => { if (this._alive) this.setData(value) })
    const pages = getCurrentPages()
    this.setData({ returnToGame: pages.length > 1 && pages[pages.length - 2].route === 'pages/game/index' })
    this._voice = new PracticeVoice({
      update: value => { if (this._alive) this.setData(value.voiceError ? Object.assign({}, value, { scrollTarget: 'practice-input-status' }) : value) },
      transcript: (text, context) => this.receiveTranscript(text, context)
    })
    this.setData({ voiceSupported: this._voice.supported })
    this.createJudge()
  },
  createJudge() {
    this._judge = new TutorialJudge({
      update: value => { if (this._alive) this.setData(value) },
      session: value => this.applySession(value)
    })
    this._judge.connect()
  },
  connect() { this._judge.connect() },
  checkJudge() { this._judge.check() },
  retryJudge() {
    if (!this.data.judgeCanRetry || this.data.judgeBusy) return
    wx.showModal({ title: '重新提交这句话？', content: '原请求可能已计费。重新提交可能再产生一次费用；会先检查原结果。', success: result => {
      if (result.confirm && this._alive) this._judge.retry()
    } })
  },
  onShow() { if (this._voice) this._voice.show(); if (this._judge) this._judge.show(); if (this._host) this._host.show() },
  onHide() { if (this._host) this._host.hide(); if (this._voice) this._voice.hide(); if (this._judge) this._judge.hide() },
  onUnload() { this._alive = false; if (this._host) this._host.dispose(); if (this._voice) this._voice.dispose(); if (this._judge) this._judge.dispose() },
  toggleHostVoice() { this._host.toggle() },
  replayHostVoice() { this._host.replay() },
  readSurface() { this._host.readSurface() },
  applySession(value) {
    if (!this._alive) return
    if (value.id !== this._sessionId) {
      this._sessionId = value.id; this._draftRevision++
      this.setData({ step: 0, question: '', submittedQuestion: '', questionResult: '', guess: '', submittedGuess: '', guessResult: '', inputError: '', recoveredTranscript: '', scrollTarget: 'practice-top-0' })
    }
    const session = presentation.session(value)
    if (this._host) this._host.sync(value)
    const question = session.messages.filter(m => m.type === 'question').slice(-1)[0]
    const guess = session.messages.filter(m => m.type === 'guess').slice(-1)[0]
    const patch = { sessionEnded: session.ended, solution: session.solution || '', hintShown: session.hints.length > 0, hintText: session.hints[0] || '' }
    if (question) Object.assign(patch, { questionResult: question.answer, questionLabel: question.answerLabel, questionNote: question.answerNote, submittedQuestion: question.text })
    if (guess) Object.assign(patch, { guessResult: guess.answer, guessLabel: guess.answerLabel, guessNote: guess.answerNote, submittedGuess: guess.text })
    if (this.data.step === 1 && question) patch.scrollTarget = 'practice-question-feedback'
    if (this.data.step === 2 && session.hints.length) patch.scrollTarget = 'practice-hint-feedback'
    if (this.data.step === 3 && guess) patch.scrollTarget = 'practice-guess-feedback'
    if (session.ended) patch.scrollTarget = 'practice-ending'
    this.setData(patch)
  },
  locked() { return this.data.recording || this.data.voiceBusy || this.data.judgeBusy || this.data.judgePending },
  next() {
    if (this.locked() || !this.data.judgeReady || this.data.sessionEnded) return
    const step = this.data.step
    if (step === 0 || (step === 1 && this.data.questionResult && this.data.questionResult !== 'clarify') || (step === 2 && this.data.hintShown)) {
      this._draftRevision++
      this.setData({ step: step + 1, inputError: '', scrollTarget: 'practice-top-' + (step + 1) })
    }
  },
  previous() {
    if (this.data.step > 0 && !this.locked() && !this.data.sessionEnded) {
      this._draftRevision++
      this.setData({ step: this.data.step - 1, inputError: '', scrollTarget: 'practice-top-' + (this.data.step - 1) })
    }
  },
  editDraft(text, step) {
    this._draftRevision++
    this.setData(step === 1 ? { question: text, inputError: '', scrollTarget: '' } : { guess: text, inputError: '', scrollTarget: '' })
  },
  onQuestionInput(e) { this.editDraft(e.detail.value, 1) },
  onGuessInput(e) { this.editDraft(e.detail.value, 3) },
  fillExample() {
    if (this.locked()) return
    if (this.data.step === 1) this.editDraft('小周出门时还在下雨吗？', 1)
    else if (this.data.step === 3) this.editDraft('我猜小周先……，然后……，所以没有淋湿。', 3)
  },
  async confirmQuestion() {
    if (this.data.step !== 1 || this.locked() || !this.data.judgeReady || this.data.sessionEnded) return
    const text = this.data.question.trim()
    if (!text || text.length > 200) { this.setData({ inputError: '请先输入 1 至 200 字的问题，再确认发送。' }); return }
    this._draftRevision++
    this.setData({ submittedQuestion: text, questionResult: '', questionLabel: '', questionNote: '', inputError: '' })
    await this._judge.submit('askQuestion', text)
  },
  showHint() { if (this.data.step === 2 && !this.data.hintShown && !this.locked()) this._judge.hint() },
  async confirmGuess() {
    if (this.data.step !== 3 || this.locked() || !this.data.judgeReady || this.data.sessionEnded) return
    const text = this.data.guess.trim()
    if (!text || text.length > 500) { this.setData({ inputError: '请先写下你的完整猜底，最多 500 字。' }); return }
    this._draftRevision++
    this.setData({ submittedGuess: text, guessResult: '', guessLabel: '', guessNote: '', inputError: '' })
    await this._judge.submit('guessAnswer', text)
  },
  recordStart(e) {
    if (![1, 3].includes(this.data.step) || this.locked() || !this.data.judgeReady || this.data.sessionEnded) return
    if (this._host) this._host.stop()
    this._voice.start(e, { step: this.data.step, revision: this._draftRevision })
  },
  recordMove(e) { this._voice.move(e) },
  recordEnd() { this._voice.end() },
  recordCancel() { this._voice.cancel() },
  checkVoice() { this._voice.check() },
  receiveTranscript(text, context) {
    if (!this._alive) return
    const limit = context.step === 1 ? 200 : 500
    if (text.length > limit) { this.setData({ voiceError: '转写超过本次字数上限，请缩短后重录，也可以直接打字。', voiceStatus: '' }); return }
    if (!this.data.sessionEnded && this.data.step === context.step && this._draftRevision === context.revision) this.editDraft(text, context.step)
    else if (!this.data.sessionEnded) this.setData({ recoveredTranscript: text, recoveredStep: context.step, voiceStatus: '识别结果已保留，你刚才编辑或提交的文字没有被覆盖。' })
  },
  useTranscript() {
    if (!this.data.recoveredTranscript || this.locked() || this.data.sessionEnded) return
    wx.showModal({ title: '使用这段识别文字？', content: '会替换对应输入框中的草稿，仍需要你确认后发送。', success: result => {
      if (!result.confirm || !this._alive) return
      const step = this.data.recoveredStep
      this.editDraft(this.data.recoveredTranscript, step)
      this.setData({ step, recoveredTranscript: '', scrollTarget: 'practice-top-' + step })
    } })
  },
  exit() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.redirectTo({ url: '/pages/home/index' })
  },
  finish() {
    const pages = getCurrentPages(), previous = pages[pages.length - 2]
    if (previous) wx.navigateBack({ success: () => { if (previous.route === 'pages/home/index') previous.chooseStory() } })
    else wx.redirectTo({ url: '/pages/home/index' })
  },
  restart() {
    if (this.locked()) return
    this._draftRevision++; this._judge.dispose()
    this.setData({ step: 0, question: '', questionResult: '', submittedQuestion: '', hintShown: false, hintText: '',
      guess: '', guessResult: '', submittedGuess: '', inputError: '', recoveredTranscript: '', solution: '', sessionEnded: false,
      judgeReady: false, judgePending: false, judgeBusy: false, judgeError: '', scrollTarget: 'practice-top-0' })
    this.createJudge()
  },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  agreePrivacy() { getApp().resolvePrivacy(true); this.setData({ privacyNeeded: false }) },
  declinePrivacy() { getApp().resolvePrivacy(false); this.setData({ privacyNeeded: false }) }
})
