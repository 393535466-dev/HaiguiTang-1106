'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const puzzles = require('../cloudfunctions/game/data/puzzles');

const answerTypes = new Set(['yes', 'no', 'irrelevant', 'unspecified', 'clarify']);
const guessTypes = new Set(['solved', 'incomplete', 'incorrect', 'uncertain']);

test('ten graded workshop stories and three original stories provide private facts and authored fixtures', () => {
  assert.equal(puzzles.length, 13);
  assert.equal(new Set(puzzles.map(p => p.id)).size, 13);
  const workshop = puzzles.filter(p => p.collection === 'workshop-20261109');
  assert.deepEqual(workshop.map(p => p.level), [1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(['悬疑','温情','无厘头'].map(genre => workshop.filter(p => p.genre === genre).length), [6,2,2]);
  for (const puzzle of puzzles) {
    for (const field of ['id', 'version', 'title', 'difficulty', 'teaser', 'surface', 'solution', 'source', 'license']) {
      assert.equal(typeof puzzle[field], 'string', `${puzzle.id}: missing ${field}`);
      assert.ok(puzzle[field].trim(), `${puzzle.id}: blank ${field}`);
    }
    assert.ok(puzzle.facts.length >= (puzzle.collection ? 5 : 8), `${puzzle.id}: facts too sparse`);
    assert.ok(puzzle.requiredPoints.length >= 2, `${puzzle.id}: missing causal rubric`);
    assert.ok(puzzle.criticalContradictions.length >= 2);
    assert.ok(puzzle.unspecifiedDetails.length >= (puzzle.collection ? 1 : 2));
    assert.ok(puzzle.irrelevantDetails.length >= 1);
    assert.ok(puzzle.acceptableVariants.length >= 2);
    assert.equal(puzzle.hints.length, 3);
    assert.equal(new Set(puzzle.hints).size, 3);
    assert.equal(puzzle.license, 'Project-original');
    assert.ok(puzzle.source.includes('原创'));
    if (puzzle.collection) assert.ok(puzzle.testCases.length >= 7); else assert.equal(puzzle.testCases.length, 20);
    const expectedByQuestion = new Map();
    for (const fixture of puzzle.testCases) {
      assert.ok(fixture.text.trim());
      assert.ok(answerTypes.has(fixture.answer), `${puzzle.id}: invalid answer fixture`);
      assert.ok(!expectedByQuestion.has(fixture.text), `${puzzle.id}: duplicate or contradictory question fixture`);
      expectedByQuestion.set(fixture.text, fixture.answer);
    }
    for (const type of answerTypes) {
      assert.ok(puzzle.testCases.some(c => c.answer === type), `${puzzle.id}: no ${type} coverage`);
    }
    assert.equal(puzzle.guessCases.length, 4);
    assert.deepEqual(puzzle.guessCases.map(c => c.answer), ['solved', 'solved', 'incomplete', 'incorrect']);
    assert.equal(new Set(puzzle.guessCases.map(c => c.text)).size, 4);
    for (const fixture of puzzle.guessCases) {
      assert.ok(fixture.text.trim());
      assert.ok(guessTypes.has(fixture.answer));
    }
  }
});
test('public catalog matches the playable lineup without private story fields', () => {
  const catalog = require('../miniprogram/data/catalog');
  assert.deepEqual(catalog.map(p => p.id), puzzles.map(p => p.id));
  for (const item of catalog) {
    for (const key of Object.keys(item)) assert.ok(['id','title','difficulty','teaser','level','genre','contentTags'].includes(key));
    assert.ok(!['solution','facts','requiredPoints','testCases'].some(key => key in item));
  }
});

test('fixtures keep important negations and nonliteral goals explicit', () => {
  const find = (id, text) => puzzles.find(p => p.id === id).testCases.find(c => c.text === text).answer;
  assert.equal(find('parking-ticket', '拿到停车优惠必须进入影厅吗？'), 'no');
  assert.equal(find('parking-ticket', '电影票价格比省下的停车费更低吗？'), 'yes');
  assert.equal(find('library-shout', '大家在录制那一声大喊的同时鼓掌吗？'), 'no');
  assert.equal(find('library-shout', '当时图书馆正在对普通读者开放吗？'), 'no');
  assert.equal(find('shadow-photo', '成片里有人的脚吗？'), 'no');
  assert.equal(find('shadow-photo', '照片里每个人都有一个清楚的影子吗？'), 'yes');
});

test('content fixtures do not masquerade as real model evaluation', () => {
  for (const puzzle of puzzles) {
    assert.equal(puzzle.measuredAccuracy, undefined);
    assert.equal(puzzle.modelPassed, undefined);
    assert.ok(puzzle.solution.length > puzzle.surface.length);
    assert.ok(!puzzle.surface.includes(puzzle.solution));
  }
});
