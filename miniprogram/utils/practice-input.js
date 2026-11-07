// Exact examples only. Unknown text must never be presented as a model verdict.
const normalize = text => String(text).trim().replace(/[\s，。！？、,.!?；;：:「」“”"']/g, '')
const questionExamples = [
  ['小周出门时还在下雨吗？', 'no'], ['他出门时还在下雨吗？', 'no'],
  ['小周出门的时候还在下雨吗？', 'no'], ['出门时还在下雨吗？', 'no'],
  ['小周带伞了吗？', 'no'], ['他带伞了吗？', 'no'],
  ['雨停了他才出门吗？', 'yes'], ['小周是等雨停了才出门的吗？', 'yes'],
  ['他出门时没有下雨吗？', 'yes'], ['小周为什么没淋湿？', 'clarify'],
  ['他为什么没淋湿？', 'clarify'], ['为什么没淋湿？', 'clarify']
]
const guessExamples = [
  ['小周没有带伞。', 'incomplete'], ['他没带伞。', 'incomplete'],
  ['小周等雨停了再出门，回家前也没再下雨，所以没有淋湿。', 'solved'],
  ['雨停了他才出门，回来前也没下雨。', 'solved'],
  ['他等雨停了才出门，回家前没有再下雨。', 'solved']
]
function match(text, examples) { const entry = examples.find(item => normalize(item[0]) === normalize(text)); return entry ? entry[1] : 'unsupported' }
module.exports = { question: text => match(text, questionExamples), guess: text => match(text, guessExamples) }
