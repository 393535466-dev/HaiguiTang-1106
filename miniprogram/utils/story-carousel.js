// Public selection metadata only. A gesture chooses a story; it never starts a game.
function cards(puzzles, current) {
  return puzzles.map((p, index) => ({ id: p.id, title: p.title, teaser: p.teaser,
    difficulty: p.difficulty, genre: p.genre || '轻推理', index,
    art: '/assets/stories/' + p.id + '-v1.jpg',
    position: index === current ? 'active' : (index < current ? 'left-' : 'right-') + Math.abs(index - current)
  })).filter(p => Math.abs(p.index - current) <= 2)
}
function select(page, key, index) {
  if (page.data.busy || !Number.isInteger(index) || index < 0 || index >= page.data.puzzles.length) return false
  const puzzle = page.data.puzzles[index]
  page.setData({ [key]: index, puzzle, carouselCards: cards(page.data.puzzles, index), carouselShift: 0, carouselDragging: false,
    ...(key === 'puzzleIndex' ? { selectedPuzzle: puzzle.id } : {}) })
  return true
}
function point(event) { return event.touches?.[0] || event.changedTouches?.[0] }
function handlers(key) {
  return {
    selectStoryCard(e) {
      if (Date.now() < (this._ignoreCarouselTapUntil || 0)) return
      select(this, key, Number(e.currentTarget.dataset.index))
    },
    storyTouchStart(e) {
      const p = point(e)
      if (!p || this.data.busy) return
      this._storyGesture = { x: p.clientX, y: p.clientY, lastX: p.clientX, lastY: p.clientY, index: Number(e.currentTarget.dataset.index) }
    },
    storyTouchMove(e) {
      const g = this._storyGesture, p = point(e)
      if (!g || !p) return
      g.lastX = p.clientX; g.lastY = p.clientY
      const dx = g.lastX - g.x, dy = g.lastY - g.y
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) this.setData({ carouselDragging: true, carouselShift: Math.max(-48, Math.min(48, dx * .35)) })
    },
    storyTouchEnd(e) {
      const g = this._storyGesture
      this._storyGesture = null
      if (!g) return
      const p = point(e), dx = (p ? p.clientX : g.lastX) - g.x, dy = (p ? p.clientY : g.lastY) - g.y
      this._ignoreCarouselTapUntil = Date.now() + 350
      let index = this.data[key]
      if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy) * 1.2) index += dx < 0 ? 1 : -1
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) index = g.index
      if (!select(this, key, index)) this.setData({ carouselShift: 0, carouselDragging: false })
    },
    storyTouchCancel() { this._storyGesture = null; this._ignoreCarouselTapUntil = Date.now() + 350; this.setData({ carouselShift: 0, carouselDragging: false }) }
  }
}
module.exports = { cards, select, handlers }
