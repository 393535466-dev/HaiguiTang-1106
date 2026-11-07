const labels = { yes: '是', no: '不是', irrelevant: '无关', unspecified: '题目未设定', clarify: '请澄清', solved: '猜中了', incomplete: '还差一点', incorrect: '方向不对', uncertain: '暂无法判定' }
const notes = {
  yes: '这个方向成立。', no: '这个方向不成立。', irrelevant: '这不影响故事的核心解释。',
  unspecified: '故事没有交代这个细节。', clarify: '试着明确人物，一次只问一件事。',
  incomplete: '你的方向成立，请补充完整因果。', incorrect: '请重新整理故事里的关键关系。',
  uncertain: '这次无法可靠判断，可以换一种表述。', solved: '故事的另一面，被你发现了。'
}
const clarificationNotes = {
  reference: '你说的「他 / 她 / 这件事」具体指什么？补充清楚再问。',
  person: '你说的是哪一位人物？把名字补上再问。',
  time: '你指的是哪个时间点？补充一下先后顺序。',
  multiple: '这句里有几个判断，先选其中一件事问吧。',
  open_ended: '先说出一个猜测，再问它是否成立。想讲完整解释，可以切到猜底。',
  guess: '这听起来是完整猜底。切到「我猜到了」提交，就能判断是否通关。',
  instruction: '请围绕故事提问；想知道真相，可以使用揭底功能。'
}
function session(value) {
  if (!value) return null
  return Object.assign({}, value, {
    hints: Array.isArray(value.hints) ? value.hints : [],
    messages: (value.messages || []).map((m, index) => Object.assign({}, m, {
      displayOrder: String(index + 1).padStart(2, '0'),
      answerLabel: labels[m.answer] || '待判定',
      answerNote: m.answer === 'clarify' && clarificationNotes[m.clarifyReason] ? clarificationNotes[m.clarifyReason] : notes[m.answer] || '',
      isPositive: m.answer === 'yes' || m.answer === 'solved',
      isQuestionPrompt: m.answer === 'unspecified' || m.answer === 'clarify'
    })),
    ended: value.state !== 'playing',
    isSolved: value.state === 'solved',
    reachedQuestionLimit: value.state === 'revealed' && Boolean(value.maxQuestions) && value.questionCount >= value.maxQuestions,
    remainingQuestions: Math.max(0, (value.maxQuestions || 0) - (value.questionCount || 0)),
    canReveal: value.state === 'playing',
    remainingGuesses: Math.max(0, (value.maxGuessFailures || 5) - (value.guessFailures || 0))
  })
}
module.exports = { labels, notes, session }
