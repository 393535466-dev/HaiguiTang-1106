'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const carousel = require('../miniprogram/utils/story-carousel');
const puzzles = require('../miniprogram/data/catalog');
function page(key) { return Object.assign({ data: { puzzles, [key]: 0, busy: false }, setData(p) { Object.assign(this.data, p); } }, carousel.handlers(key)); }
const event = (x, y, index = 0, end = false) => ({ currentTarget: { dataset: { index } }, touches: end ? [] : [{ clientX:x, clientY:y }], changedTouches: [{ clientX:x, clientY:y }] });
test('swipe selects the displayed story and matching room ID, bounded at each end', () => {
  for (const key of ['storyIndex','puzzleIndex']) {
    const p=page(key);
    p.storyTouchStart(event(180,100));p.storyTouchMove(event(80,103));p.storyTouchEnd(event(80,103,0,true));
    assert.equal(p.data[key],1);assert.equal(p.data.puzzle.id,puzzles[1].id);
    if(key==='puzzleIndex')assert.equal(p.data.selectedPuzzle,puzzles[1].id);
    assert.equal(p.data.carouselCards.find(c=>c.position==='active').id,puzzles[1].id);
    assert.ok(p.data.carouselCards.length<=5);
    carousel.select(p,key,puzzles.length-1);p.storyTouchStart(event(180,100));p.storyTouchEnd(event(50,100,0,true));
    assert.equal(p.data[key],puzzles.length-1);assert.equal(p.data.carouselShift,0);
    carousel.select(p,key,0);p.storyTouchStart(event(80,100));p.storyTouchEnd(event(180,100,0,true));assert.equal(p.data[key],0);
  }
});
test('vertical gestures, cancellation and busy rooms cannot accidentally choose another story', () => {
  const p=page('puzzleIndex');
  p.storyTouchStart(event(100,50,1));p.storyTouchMove(event(110,140,1));p.storyTouchEnd(event(110,140,1,true));assert.equal(p.data.puzzleIndex,0);
  p.storyTouchStart(event(180,100));p.storyTouchMove(event(70,100));p.storyTouchCancel();p.storyTouchEnd(event(70,100,0,true));assert.equal(p.data.puzzleIndex,0);assert.equal(p.data.carouselShift,0);
  p.data.busy=true;p.storyTouchStart(event(180,100));p.storyTouchEnd(event(60,100,0,true));assert.equal(p.data.puzzleIndex,0);assert.equal(carousel.select(p,'puzzleIndex',2),false);
});
test('a neighbor tap selects once and suppresses the synthetic click after a swipe', () => {
  const p=page('storyIndex');p.storyTouchStart(event(180,100,1));p.storyTouchEnd(event(180,100,1,true));assert.equal(p.data.storyIndex,1);
  p.selectStoryCard(event(180,100,2));assert.equal(p.data.storyIndex,1);
  p._ignoreCarouselTapUntil=0;p.selectStoryCard(event(180,100,2));assert.equal(p.data.storyIndex,2);
});
test('only a deliberate active-card tap starts; swipes, neighbors and synthetic clicks never double-start', () => {
  const p=page('storyIndex'); let starts=0;p.activateStory=()=>starts++;
  p.storyTouchStart(event(180,100));p.storyTouchEnd(event(80,100,0,true));assert.equal(starts,0);
  p.selectStoryCard(event(80,100,1));assert.equal(starts,0);
  p.storyTouchStart(event(180,100,1));p.storyTouchEnd(event(181,100,1,true));assert.equal(starts,1);
  p.selectStoryCard(event(181,100,1));assert.equal(starts,1);
  p._ignoreCarouselTapUntil=0;p.selectStoryCard(event(181,100,2));assert.equal(p.data.storyIndex,2);assert.equal(starts,1);
  p.data.busy=true;p.selectStoryCard(event(181,100,2));assert.equal(starts,1);
});
