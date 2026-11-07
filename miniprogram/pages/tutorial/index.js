// Public, project-original practice story. No session, recording or model requests.
const questions = {
  open: '小周为什么没淋湿？',
  yesno: '小周出门时还在下雨吗？'
}
const guesses = {
  partial: '小周没有带伞。',
  complete: '小周等雨停了再出门，回家前也没再下雨，所以没有淋湿。'
}

Page({
  data: {
    step: 0, steps: ['读汤面', '提问题', '看提示', '猜汤底'],
    question: '', questionKind: '', questionResult: '',
    hintShown: false, guess: '', guessKind: '', guessResult: '',
    returnToGame: false, scrollTarget: 'practice-top-0'
  },
  onLoad() {
    const pages = getCurrentPages()
    this.setData({ returnToGame: pages.length > 1 && pages[pages.length - 2].route === 'pages/game/index' })
  },
  next() {
    const step = this.data.step
    if (step === 0 || (step === 1 && this.data.questionResult === 'answered') || (step === 2 && this.data.hintShown)) {
      this.setData({ step: step + 1, scrollTarget: 'practice-top-' + (step + 1) })
    }
  },
  previous() { if (this.data.step > 0) this.setData({ step: this.data.step - 1, scrollTarget: 'practice-top-' + (this.data.step - 1) }) },
  chooseQuestion(e) {
    if (this.data.step !== 1) return
    const kind = e.currentTarget.dataset.kind
    if (questions[kind]) this.setData({ question: questions[kind], questionKind: kind, questionResult: '', scrollTarget: '' })
  },
  confirmQuestion() {
    if (this.data.step !== 1 || !this.data.question) return
    this.setData({ questionResult: this.data.questionKind === 'yesno' ? 'answered' : 'clarify', scrollTarget: 'practice-question-feedback' })
  },
  showHint() { if (this.data.step === 2) this.setData({ hintShown: true, scrollTarget: 'practice-hint-feedback' }) },
  chooseGuess(e) {
    if (this.data.step !== 3 || this.data.guessResult === 'solved') return
    const kind = e.currentTarget.dataset.kind
    if (guesses[kind]) this.setData({ guess: guesses[kind], guessKind: kind, guessResult: '', scrollTarget: '' })
  },
  confirmGuess() {
    if (this.data.step !== 3 || !this.data.guess || this.data.guessResult === 'solved') return
    this.setData({ guessResult: this.data.guessKind === 'complete' ? 'solved' : 'incomplete', scrollTarget: 'practice-guess-feedback' })
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
    this.setData({ step: 0, question: '', questionKind: '', questionResult: '', hintShown: false, guess: '', guessKind: '', guessResult: '', scrollTarget: 'practice-top-0' })
  }
})
