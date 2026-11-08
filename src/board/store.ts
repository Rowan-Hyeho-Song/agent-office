// The board's shared state: one BoardState and a listener list, plus a counter of canvas paints (debug: shows the
// canvas only redraws on data change). A tiny external store like the approval panel's.

import { boardSignature } from './layout'
import { emptyBoard, type BoardState } from './state'

export class BoardStore {
  private state: BoardState = emptyBoard()
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
    const sig = boardSignature(next)
    if (sig === this.sig) return
    this.state = next
    this.sig = sig
    this.listeners.forEach((l) => l())
  }
}
