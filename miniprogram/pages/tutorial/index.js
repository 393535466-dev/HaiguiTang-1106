const PracticeVoice = require('../../utils/practice-voice')
const examples = require('../../utils/practice-input')

Page({
  data: {
    step: 0, steps: ['读汤面', '提问题', '看提示', '猜汤底'],
    question: '', questionResult: '', submittedQuestion: '',
    hintShown: false, guess: '', guessResult: '', submittedGuess: '',
    returnToGame: false, scrollTarget: 'practice-top-0', inputError: '',
    voiceSupported: false, recording: false, cancelling: false, recordSeconds: 0,
    voiceBusy: false, voicePending: false, voiceStatus: '', voiceError: '',
    recoveredTranscript: '', recoveredStep: 0, privacyNeeded: false
  },
  onLoad() {
    this._alive = true; this._draftRevision = 0
    const pages = getCurrentPages()
    this.setData({ returnToGame: pages.length > 1 && pages[pages.length - 2].route === 'pages/game/index' })
    this._voice = new PracticeVoice({
      update: value => { if (this._alive) this.setData(value.voiceError ? Object.assign({}, value, { scrollTarget: 'practice-input-status' }) : value) },
      transcript: (text, context) => this.receiveTranscript(text, context)
    })
    this.setData({ voiceSupported: this._voice.supported })
  },
  onShow() { if (this._voice) this._voice.show() },
  onHide() { if (this._voice) this._voice.hide() },
  onUnload() { this._alive = false; if (this._voice) this._voice.dispose() },
  next() {
    if (this.data.recording || this.data.voiceBusy) return
    const step = this.data.step
    if (step === 0 || (step === 1 && this.data.questionResult && this.data.questionResult !== 'clarify') || (step === 2 && this.data.hintShown)) {
      this._draftRevision++
      this.setData({ step: step + 1, inputError: '', scrollTarget: 'practice-top-' + (step + 1) })
    }
  },
  previous() {
    if (this.data.step > 0 && !this.data.recording && !this.data.voiceBusy) {
      this._draftRevision++
      this.setData({ step: this.data.step - 1, inputError: '', scrollTarget: 'practice-top-' + (this.data.step - 1) })
    }
  },
  editDraft(text, step) {
    this._draftRevision++
    this.setData(step === 1 ? { question: text, questionResult: '', submittedQuestion: '', inputError: '', scrollTarget: '' }
      : { guess: text, guessResult: '', submittedGuess: '', inputError: '', scrollTarget: '' })
  },
  onQuestionInput(e) { this.editDraft(e.detail.value, 1) },
  onGuessInput(e) { this.editDraft(e.detail.value, 3) },
  fillExample() {
    if (this.data.recording || this.data.voiceBusy) return
    const step = this.data.step
    if (step === 1) this.editDraft('小周出门时还在下雨吗？', 1)
    else if (step === 3) this.editDraft('小周等雨停了再出门，回家前也没再下雨，所以没有淋湿。', 3)
  },
  confirmQuestion() {
    if (this.data.step !== 1 || this.data.recording || this.data.voiceBusy) return
    const text = this.data.question.trim()
    if (!text || text.length > 200) { this.setData({ inputError: '请先输入 1 至 200 字的问题，再确认发送。' }); return }
    this._draftRevision++
    this.setData({ submittedQuestion: text, questionResult: examples.question(text), inputError: '', scrollTarget: 'practice-question-feedback' })
  },
  showHint() { if (this.data.step === 2) this.setData({ hintShown: true, scrollTarget: 'practice-hint-feedback' }) },
  confirmGuess() {
    if (this.data.step !== 3 || this.data.recording || this.data.voiceBusy || this.data.guessResult === 'solved') return
    const text = this.data.guess.trim()
    if (!text || text.length > 500) { this.setData({ inputError: '请先写下你的完整猜底，最多 500 字。' }); return }
    this._draftRevision++
    this.setData({ submittedGuess: text, guessResult: examples.guess(text), inputError: '', scrollTarget: 'practice-guess-feedback' })
  },
  recordStart(e) {
    if (![1, 3].includes(this.data.step) || this.data.guessResult === 'solved') return
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
    if (this.data.step === context.step && this._draftRevision === context.revision) this.editDraft(text, context.step)
    else this.setData({ recoveredTranscript: text, recoveredStep: context.step, voiceStatus: '识别结果已保留，你刚才编辑或提交的文字没有被覆盖。' })
  },
  useTranscript() {
    if (!this.data.recoveredTranscript || this.data.recording || this.data.voiceBusy) return
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
    const pages = getCurrentPages()
    const previous = pages[pages.length - 2]
    if (previous) wx.navigateBack({ success: () => { if (previous.route === 'pages/home/index') previous.chooseStory() } })
    else wx.redirectTo({ url: '/pages/home/index' })
  },
  restart() {
    if (this.data.recording || this.data.voiceBusy) return
    this._draftRevision++
    this.setData({ step: 0, question: '', questionResult: '', submittedQuestion: '', hintShown: false,
      guess: '', guessResult: '', submittedGuess: '', inputError: '', recoveredTranscript: '', scrollTarget: 'practice-top-0' })
  },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  agreePrivacy() { getApp().resolvePrivacy(true); this.setData({ privacyNeeded: false }) },
  declinePrivacy() { getApp().resolvePrivacy(false); this.setData({ privacyNeeded: false }) }
})
