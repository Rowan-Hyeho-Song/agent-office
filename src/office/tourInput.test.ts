import { describe, expect, it } from 'vitest'
import { DRAG_PX, NO_MOUSE, mouseStep, type MouseEv, type MouseState } from './tourInput'

// #405: the two production paths that ended the tour at once, and the drag that still does
type Ev = Partial<MouseEv> & Pick<MouseEv, 'kind' | 'x' | 'y'>
const run = (events: Ev[], active: () => boolean = () => true) => {
  let s: MouseState = NO_MOUSE
  const stops: boolean[] = []
  for (const e of events) {
    const r = mouseStep(s, { buttons: 0, onBar: false, active: active(), ...e } as MouseEv)
    s = r.state
    stops.push(r.stop)
  }
  return stops
}

describe('the mouse and the tour (#405)', () => {
  it('started by the view toggle, then the cursor moves 80 px away with no button held: still touring', () => {
    const stops = run([
      { kind: 'down', x: 600, y: 700, buttons: 1, onBar: true, active: false },
      { kind: 'up', x: 600, y: 700, onBar: true, active: false },
      // the tour is now active; the cursor leaves the button over the picture
      { kind: 'move', x: 620, y: 660 },
      { kind: 'move', x: 650, y: 630 },
      { kind: 'move', x: 680, y: 640 },
    ])
    expect(stops.some(Boolean)).toBe(false)
  })

  it('started automatically (idle), the cursor passes over the picture: still touring, however far it goes', () => {
    const stops = run(Array.from({ length: 40 }, (_, i) => ({ kind: 'move' as const, x: i * 30, y: 200 + i * 5 })))
    expect(stops.some(Boolean)).toBe(false)
  })

  it('a held-button drag of more than 30 px ends it, a shorter one does not', () => {
    // the button went down before the tour began (an automatic start), then dragged
    const long = run([
      { kind: 'down', x: 100, y: 100, buttons: 1, active: false },
      { kind: 'move', x: 100 + DRAG_PX - 1, y: 100, buttons: 1 },
      { kind: 'move', x: 100 + DRAG_PX + 5, y: 100, buttons: 1 },
    ])
    expect(long).toEqual([false, false, true])
  })

  it('a drag that began on the bar does not end it there, and moves after the button is up are plain moves', () => {
    const stops = run([
      { kind: 'down', x: 10, y: 10, buttons: 1, onBar: true },
      { kind: 'move', x: 90, y: 10, buttons: 1, onBar: true },
      { kind: 'up', x: 90, y: 10, onBar: true },
      { kind: 'move', x: 300, y: 300 },
    ])
    expect(stops).toEqual([false, false, false, false])
  })

  it('a press on the picture alone (a click) does not end it, its drag does; a held move without a seen press counts from its first move', () => {
    expect(run([{ kind: 'down', x: 5, y: 5, buttons: 1 }, { kind: 'up', x: 5, y: 5 }])).toEqual([false, false])
    expect(run([{ kind: 'down', x: 5, y: 5, buttons: 1 }, { kind: 'move', x: 5 + DRAG_PX + 1, y: 5, buttons: 1 }])).toEqual([false, true])
    expect(run([{ kind: 'move', x: 0, y: 0, buttons: 1 }, { kind: 'move', x: 20, y: 0, buttons: 1 }, { kind: 'move', x: 40, y: 0, buttons: 1 }])).toEqual([false, false, true])
  })

  it('nothing happens when the tour is not running', () => {
    expect(run([{ kind: 'down', x: 0, y: 0, buttons: 1 }, { kind: 'move', x: 200, y: 0, buttons: 1 }], () => false)).toEqual([false, false])
  })
})
