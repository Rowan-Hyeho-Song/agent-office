// The board's shared state: one BoardState and a listener list, plus a counter of canvas paints (debug: shows the
// canvas only redraws on data change). A tiny external store like the approval panel's.

import { boardSignature } from './layout'
import { emptyBoard, type BoardDecision, type BoardState } from './state'

/** a decision a replayed meeting pinned (#97): kept on top of whatever data is set, for this page's life */
const MAX_PINNED = 3

export class BoardStore {
  private base: BoardState = emptyBoard()
  private pinned: BoardDecision[] = []
  /** the timelapse's board (#82): shown instead of the live data until released */
  private locked: BoardState | null = null
  private state: BoardState = this.base
  private sig = boardSignature(this.state)
  private listeners = new Set<() => void>()
  /** canvas paints so far (written by the painter) */
  draws = 0

  getSnapshot = () => this.state
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  /** replace the data; listeners fire only when what the board would draw differs */
  set(next: BoardState) {
    this.base = next
    this.apply()
  }
  /** show this board (the replay's) instead of the live one; null = back to the live data */
  lock(next: BoardState | null) {
    this.locked = next
    this.apply()
  }
  /** a meeting's decision: the planner pins a note (it fades in like any new one) */
  pin(d: BoardDecision) {
    this.pinned = [d, ...this.pinned.filter((p) => p.key !== d.key)].slice(0, MAX_PINNED)
    this.apply()
  }

  private apply() {
    if (this.locked) return this.show(this.locked)
    const next = this.pinned.length ? { ...this.base, decisions: [...this.pinned, ...this.base.decisions.filter((x) => !this.pinned.some((p) => p.key === x.key))].sort((a, b) => b.at.localeCompare(a.at)) } : this.base
    this.show(next)
  }

  private show(next: BoardState) {
    const sig = boardSignature(next)
    if (sig === this.sig) return
    this.state = next
    this.sig = sig
    this.listeners.forEach((l) => l())
  }
}
