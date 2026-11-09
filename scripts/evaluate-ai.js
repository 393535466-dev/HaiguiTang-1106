'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createProvider } = require('../cloudfunctions/game/lib/provider');
const { readConfig } = require('./preview-config');
const puzzles = [require('../cloudfunctions/game/data/tutorial'), ...require('../cloudfunctions/game/data/puzzles')];
async function main() {
  const env = readConfig();
  const modelArg = process.argv.find(a => a.startsWith('--model='));
  if (modelArg) env.LLM_MODEL = modelArg.slice('--model='.length);
  const provider = createProvider({ env });
  if (!provider.ready().textReady) throw Object.assign(new Error(), { code: 'CONFIG_REQUIRED' });
  const full = process.argv.includes('--full');
  const collection = process.argv.find(a => a.startsWith('--collection='))?.slice('--collection='.length);
  const selected = collection ? puzzles.filter(p => p.collection === collection) : full ? puzzles : puzzles.slice(0, 1);
  if (!selected.length) throw Object.assign(new Error(), { code: 'EMPTY_COLLECTION' });
  const results = [];
  for (const puzzle of selected) {
    for (const kind of ['question', 'guess']) {
      const cases = kind === 'question' ? puzzle.testCases : puzzle.guessCases;
      for (const item of cases) {
        const started = Date.now();
        let result;
        try {
          const output = await provider.judge({ puzzle, kind, text: item.text });
          result = { puzzleId: puzzle.id, version: puzzle.version, kind, text: item.text, expected: item.answer,
            actual: output.answer, passed: output.answer === item.answer, usage: output.usage, elapsedMs: Date.now() - started };
        } catch (error) {
          result = { puzzleId: puzzle.id, kind, text: item.text, expected: item.answer, passed: false, error: error.code || 'ERROR', elapsedMs: Date.now() - started };
        }
        results.push(result);
        // Stop on auth/config failures; do not retry charged or unknown requests.
        if (['PROVIDER_AUTH', 'CONFIG_REQUIRED', 'RATE_LIMITED'].includes(result.error)) break;
      }
      if (results.at(-1)?.error) break;
    }
    process.stdout.write(puzzle.id + ': ' + results.filter(r => r.puzzleId === puzzle.id && r.passed).length + '/' + results.filter(r => r.puzzleId === puzzle.id).length + '\n');
    if (['PROVIDER_AUTH', 'CONFIG_REQUIRED', 'RATE_LIMITED'].includes(results.at(-1)?.error)) break;
  }
  const summary = { realModel: true, model: env.LLM_MODEL || 'qwen-plus', collection: collection || null, timestamp: new Date().toISOString(),
    passed: results.filter(r => r.passed).length, total: results.length,
    inputTokens: results.reduce((s, r) => s + (r.usage?.inputTokens || 0), 0),
    outputTokens: results.reduce((s, r) => s + (r.usage?.outputTokens || 0), 0),
    maxMs: Math.max(...results.map(r => r.elapsedMs)) };
  const dir = path.resolve(__dirname, '../.preview-data'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai-eval-latest.json'), JSON.stringify({ summary, results }, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'ai-eval-' + [summary.model, collection].filter(Boolean).join('-').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'), JSON.stringify({ summary, results }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary));
  console.log(JSON.stringify({ failures: results.filter(r => !r.passed).map(r => ({ puzzleId: r.puzzleId, kind: r.kind, text: r.text, expected: r.expected, actual: r.actual, error: r.error })) }));
  if (summary.passed !== summary.total) process.exitCode = 1;
}
main().catch(error => { console.error('真实模型评测未完成：' + (error.code || 'ERROR')); process.exitCode = 1; });
