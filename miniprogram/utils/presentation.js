const labels = { yes: '是', no: '否', irrelevant: '无关', unspecified: '题目未设定', clarify: '请澄清', solved: '猜中了', incomplete: '还差一点', incorrect: '方向不对', uncertain: '暂无法判定' }
const notes = {
  yes: '这个方向成立。', no: '这个方向不成立。', irrelevant: '这不影响故事的核心解释。',
  unspecified: '故事没有交代这个细节。', clarify: '试着明确人物，一次只问一件事。',
  incomplete: '你的方向成立，请补充完整因果。', incorrect: '请重新整理故事里的关键关系。',
  uncertain: '这次无法可靠判断，可以换一种表述。', solved: '故事的另一面，被你发现了。'
}
function session(value) {
  if (!value) return null
  return Object.assign({}, value, {
    hints: Array.isArray(value.hints) ? value.hints : [],
    messages: (value.messages || []).map((m, index) => Object.assign({}, m, { displayOrder: String(index + 1).padStart(2, '0'), answerLabel: labels[m.answer] || '待判定', answerNote: notes[m.answer] || '', isPositive: m.answer === 'yes' || m.answer === 'solved' })),
    ended: value.state !== 'playing',
    isSolved: value.state === 'solved',
    canReveal: value.state === 'playing',
    remainingGuesses: Math.max(0, (value.maxGuessFailures || 5) - (value.guessFailures || 0))
  })
}
module.exports = { labels, notes, session }
