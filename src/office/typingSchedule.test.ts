// The typing schedule (#225): deterministic, the rhythm of typing.md 3, the fingering of typing.md 2, the activity mix of typing.md 4.
import { describe, expect, it } from 'vitest'
import { CHUNK_S, ChunkCache, FINGERING, HOME, makeChunk, modeOf, pressAt, type Chunk } from './typingSchedule'

const chunks = (agent: string, activity: string, n = 60, o = {}) => Array.from({ length: n }, (_, i) => makeChunk(agent, i, activity, o))
const flat = <T>(a: T[][]) => a.flat()

describe('fingering (typing.md 2)', () => {
  it('the home row is where the table says, one finger each', () => {
    expect(FINGERING.KeyA).toEqual({ hand: 'l', finger: 3 })
    expect(FINGERING.KeyS).toEqual({ hand: 'l', finger: 2 })
    expect(FINGERING.KeyD).toEqual({ hand: 'l', finger: 1 })
    expect(FINGERING.KeyF).toEqual({ hand: 'l', finger: 0 })
    expect(FINGERING.KeyJ).toEqual({ hand: 'r', finger: 0 })
    expect(FINGERING.KeyK).toEqual({ hand: 'r', finger: 1 })
    expect(FINGERING.KeyL).toEqual({ hand: 'r', finger: 2 })
    expect(FINGERING.Semicolon).toEqual({ hand: 'r', finger: 3 })
    expect(HOME.l[0]).toBe('KeyF')
  })
  it('rows above and below belong to the same finger (g/t/b: left index; y/n: right index), thumbs to the space bar', () => {
    for (const c of ['KeyR', 'KeyT', 'KeyG', 'KeyV', 'KeyB']) expect(FINGERING[c]).toMatchObject({ hand: 'l', finger: 0 })
    for (const c of ['KeyY', 'KeyU', 'KeyH', 'KeyN', 'KeyM']) expect(FINGERING[c]).toMatchObject({ hand: 'r', finger: 0 })
    expect(FINGERING.KeyQ).toMatchObject({ hand: 'l', finger: 3 })
    expect(FINGERING.KeyP).toMatchObject({ hand: 'r', finger: 3 })
    expect(FINGERING.Space).toEqual({ hand: 'r', finger: 4 })
    expect(FINGERING.Backspace).toMatchObject({ hand: 'r', finger: 3 })
    expect(FINGERING.Enter).toMatchObject({ hand: 'r', finger: 3 })
    expect(FINGERING.ControlLeft).toMatchObject({ hand: 'l', finger: 3 })
  })
  it('every key the schedule presses has a fingering that matches its hand and finger', () => {
    for (const a of ['agent_0', 'agent_3'])
      for (const act of ['edit', 'read', 'test', 'think', 'delegate'])
        for (const c of chunks(a, act, 12))
          for (const k of c.keys) {
            expect(FINGERING[k.code], k.code).toBeTruthy()
            if (!k.shortcut) expect({ hand: k.hand, finger: k.finger }).toEqual(FINGERING[k.code])
          }
  })
})

describe('determinism', () => {
  it('the same agent, chunk and activity give the same keys, whenever and however often it is asked', () => {
    const a = makeChunk('agent_3', 17, 'edit')
    const b = makeChunk('agent_3', 17, 'edit')
    expect(b).toEqual(a)
    const c = new ChunkCache()
    expect(c.get('agent_3', 'edit', 17)).toEqual(a)
    expect(makeChunk('agent_3', 18, 'edit')).not.toEqual(a)
    expect(makeChunk('agent_1', 17, 'edit')).not.toEqual(a)
  })
  it('a slower timelapse stretches the same keys: the order is the same, the times are scaled', () => {
    const a = makeChunk('agent_0', 5, 'edit', { dilation: 1 })
    const b = makeChunk('agent_0', 5, 'edit', { dilation: 4 })
    expect(b.keys.map((k) => k.code)).toEqual(a.keys.map((k) => k.code))
    a.keys.forEach((k, i) => {
      expect(b.keys[i].t - b.t0).toBeCloseTo((k.t - a.t0) * 4, 6)
      expect(b.keys[i].hold).toBeCloseTo(k.hold * 4, 6)
    })
  })
  it('a chunk is its 12 s window and nothing leaks out of it', () => {
    for (const act of ['edit', 'read', 'test', 'think', 'delegate'])
      for (const c of chunks('agent_1', act, 30)) {
        for (const e of c.events) {
          expect(e.t).toBeGreaterThanOrEqual(c.t0)
          expect(e.t).toBeLessThanOrEqual(c.t1 - 0.2)
        }
        for (const ep of c.episodes) expect(ep.t1).toBeLessThan(c.t1)
        expect(c.t1 - c.t0).toBeCloseTo(CHUNK_S)
      }
  })
  it('events are in time order, and every key has its keyUp after it', () => {
    const c = makeChunk('agent_2', 3, 'edit')
    for (let i = 1; i < c.events.length; i++) expect(c.events[i].t).toBeGreaterThanOrEqual(c.events[i - 1].t)
    const downs = c.events.filter((e) => e.type === 'key').length
    expect(c.events.filter((e) => e.type === 'keyUp').length).toBe(downs)
    expect(downs).toBe(c.keys.length)
  })
})

describe('rhythm (typing.md 3)', () => {
  const inWord = (cs: Chunk[]) => {
    const gaps: number[] = []
    let pairs = 0
    let overlapped = 0
    for (const c of cs)
      for (let i = 1; i < c.keys.length; i++) {
        const a = c.keys[i - 1]
        const b = c.keys[i]
        if (a.shortcut || b.shortcut || a.code === 'Space' || b.code === 'Space' || a.code === 'Backspace' || b.code === 'Backspace' || a.code === 'Enter' || b.code === 'Enter') continue
        const g = b.t - a.t
        if (g > 0.5) continue // a pause
        gaps.push(g)
        pairs++
        if (a.finger !== b.finger && a.t + a.hold > b.t) overlapped++
      }
    return { gaps, share: overlapped / pairs }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

  it('keys inside a word come about 230 ms apart, 120-380 ms, for a normal typist', () => {
    const { gaps } = inWord(chunks('agent_0', 'edit', 80))
    expect(gaps.length).toBeGreaterThan(300)
    expect(mean(gaps)).toBeGreaterThan(0.2)
    expect(mean(gaps)).toBeLessThan(0.27)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.119)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.5)
  })
  it('about 30% of a normal typist\'s keys overlap the one before; the coder is faster with 45%', () => {
    const n = inWord(chunks('agent_0', 'edit', 120))
    expect(n.share).toBeGreaterThan(0.2)
    expect(n.share).toBeLessThan(0.4)
    const f = inWord(chunks('agent_3', 'edit', 120))
    expect(f.share).toBeGreaterThan(n.share + 0.03)
    expect(f.share).toBeLessThan(0.58)
    expect(mean(f.gaps)).toBeLessThan(mean(n.gaps) - 0.02)
    expect(mean(f.gaps)).toBeLessThan(0.2)
  })
  it('a finger is never pressed twice at once, and an overlap is only ever of two different fingers', () => {
    for (const a of ['agent_0', 'agent_3', 'agent_2'])
      for (const c of chunks(a, 'edit', 40))
        for (const hand of ['l', 'r'] as const)
          for (const list of c.byFinger[hand])
            for (let i = 1; i < list.length; i++) {
              expect(list[i].t).toBeGreaterThanOrEqual(list[i - 1].t + 0.19)
              expect(list[i - 1].t + list[i - 1].hold).toBeLessThanOrEqual(list[i].t)
            }
  })
  it('keys are held 70-120 ms unless another key rolls over them', () => {
    const holds = flat(chunks('agent_0', 'edit', 40).map((c) => c.keys.filter((k) => !k.shortcut).map((k) => k.hold)))
    const sorted = [...holds].sort((a, b) => a - b)
    expect(sorted[Math.floor(sorted.length * 0.5)]).toBeGreaterThan(0.06)
    expect(sorted[Math.floor(sorted.length * 0.5)]).toBeLessThan(0.13)
    expect(Math.min(...holds)).toBeGreaterThanOrEqual(0.04)
  })
  it('words are 3-9 keys and end with the space bar; thinking pauses of 0.8-2.5 s come every 4-8 words', () => {
    const cs = chunks('agent_0', 'edit', 120)
    const lens: number[] = []
    let len = 0
    const pauses: number[] = []
    for (const c of cs)
      for (let i = 0; i < c.keys.length; i++) {
        const k = c.keys[i]
        if (k.code === 'Space') {
          if (len) lens.push(len)
          len = 0
        } else if (k.kind === 'char' && !k.shortcut) len++
        if (i && k.t - c.keys[i - 1].t > 0.8 && c.keys[i - 1].code === 'Space' && !c.episodes.some((e) => e.t0 > c.keys[i - 1].t && e.t0 < k.t)) pauses.push(k.t - c.keys[i - 1].t)
      }
    expect(lens.length).toBeGreaterThan(200)
    expect(Math.min(...lens)).toBeGreaterThanOrEqual(2) // a typo's wrong letters and backspaces count in the word
    expect(mean(lens)).toBeGreaterThan(3.5)
    expect(mean(lens)).toBeLessThan(7.5)
    expect(pauses.length).toBeGreaterThan(8)
    expect(Math.min(...pauses)).toBeGreaterThan(0.9)
    expect(Math.max(...pauses)).toBeLessThan(3.1)
  })
  it('backspaces come in runs of 1-3 for about one word in ten, and enter ends a line every 10-20 words', () => {
    const keys = flat(chunks('agent_0', 'edit', 150).map((c) => c.keys))
    const words = keys.filter((k) => k.code === 'Space').length
    const bs = keys.filter((k) => k.code === 'Backspace').length
    const runs: number[] = []
    let r = 0
    for (const k of keys) {
      if (k.code === 'Backspace') r++
      else if (r) (runs.push(r), (r = 0))
    }
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...runs)).toBeLessThanOrEqual(3)
    expect(runs.length / words).toBeGreaterThan(0.04)
    expect(runs.length / words).toBeLessThan(0.16)
    expect(bs).toBeGreaterThan(0)
    const enters = keys.filter((k) => k.code === 'Enter').length
    expect(words / enters).toBeGreaterThan(8)
    expect(words / enters).toBeLessThan(24)
    // the designer's rewriter fixes more
    const hue = flat(chunks('agent_2', 'edit', 150).map((c) => c.keys))
    expect(hue.filter((k) => k.code === 'Backspace').length / hue.filter((k) => k.code === 'Space').length).toBeGreaterThan(bs / words)
  })
  it('the space bar is the right thumb; shortcuts are a modifier then a letter, two events', () => {
    const keys = flat(chunks('agent_0', 'edit', 80).map((c) => c.keys))
    for (const k of keys.filter((k) => k.code === 'Space')) expect(k).toMatchObject({ hand: 'r', finger: 4, kind: 'space' })
    const c = chunks('agent_0', 'read', 30).find((c) => c.keys.some((k) => k.shortcut))!
    const i = c.keys.findIndex((k) => k.shortcut)
    expect(c.keys[i]).toMatchObject({ code: 'ControlLeft', kind: 'mod' })
    expect(c.keys[i + 1]).toMatchObject({ code: 'KeyF', kind: 'char', shortcut: true })
    expect(c.keys[i].t + c.keys[i].hold).toBeGreaterThan(c.keys[i + 1].t) // the modifier is held until the letter is down
  })
})

describe('activities (typing.md 4)', () => {
  const share = (activity: string, agent = 'agent_0') => {
    let keys = 0
    let mouse = 0
    let total = 0
    for (const c of chunks(agent, activity, 80)) {
      total += CHUNK_S
      for (const e of c.episodes) mouse += e.t1 - e.t0
      if (c.keys.length) keys += c.keys[c.keys.length - 1].t - c.keys[0].t - c.episodes.filter((e) => e.t0 > c.keys[0].t && e.t1 < c.keys[c.keys.length - 1].t).reduce((a, e) => a + e.t1 - e.t0, 0)
    }
    return { keys: keys / total, mouse: mouse / total }
  }
  it('maps the hook\'s activities to modes', () => {
    expect(modeOf('edit')).toBe('edit')
    expect(modeOf(undefined)).toBe('edit')
    expect(['run', 'test', 'build', 'install', 'git'].map(modeOf)).toEqual(['cmd', 'cmd', 'cmd', 'cmd', 'cmd'])
    expect(modeOf('read')).toBe('read')
    expect(modeOf('think')).toBe('think')
  })
  it('edit is mostly keyboard (about 80 : 20), read is mostly the wheel (15 : 85), a command is about 40 : 60', () => {
    const ratio = (act: string) => {
      const x = share(act)
      return { keys: x.keys / (x.keys + x.mouse), mouse: x.mouse / (x.keys + x.mouse) }
    }
    const e = ratio('edit')
    expect(e.keys).toBeGreaterThan(0.68)
    expect(e.keys).toBeLessThan(0.92)
    const r = ratio('read')
    expect(r.mouse).toBeGreaterThan(0.72)
    expect(r.mouse).toBeLessThan(0.97)
    const t = ratio('test')
    expect(t.mouse).toBeGreaterThan(0.45)
    expect(t.mouse).toBeLessThan(0.78)
    expect(share('edit').keys).toBeGreaterThan(0.5)
  })
  it('thinking has no keys at all and a little mouse', () => {
    const k = flat(chunks('agent_0', 'think', 60).map((c) => c.keys))
    expect(k.length).toBe(0)
    const s = share('think')
    expect(s.mouse).toBeLessThan(0.25)
  })
  it('a command ends with enter, and the right hand then goes to the mouse to scroll while the left fingers tap', () => {
    const c = chunks('agent_3', 'test', 30).find((c) => c.episodes.length && c.keys.length)!
    expect(c.keys.some((k) => k.code === 'Enter')).toBe(true)
    expect(c.mouse.some((m) => m.kind === 'wheel')).toBe(true)
    expect(c.episodes[0].tap).toBe(true)
    const enter = c.keys.find((k) => k.code === 'Enter')!
    expect(c.episodes[0].t0).toBeGreaterThan(enter.t)
  })
  it('the mouse episodes: down then up, wheel one notch an event, nothing before the hand is there, no keys under the hand', () => {
    for (const act of ['edit', 'read', 'test'])
      for (const c of chunks('agent_1', act, 20)) {
        for (const ep of c.episodes) {
          const inside = c.mouse.filter((m) => m.t >= ep.t0 && m.t <= ep.t1)
          for (const m of inside) expect(m.t).toBeGreaterThanOrEqual(ep.t0 + 0.54)
          for (const k of c.keys) expect(k.hand === 'r' && k.t > ep.t0 - 0.05 && k.t < ep.t1 + 0.05).toBe(false)
        }
        const downs = c.mouse.filter((m) => m.kind === 'down').length
        expect(c.mouse.filter((m) => m.kind === 'up').length).toBe(downs)
        for (const m of c.mouse.filter((m) => m.kind === 'wheel')) expect(m.ticks).toBe(1)
        for (const m of c.mouse) expect(c.episodes.some((ep) => m.t >= ep.t0 && m.t <= ep.t1)).toBe(true)
      }
  })
  it('desk 2 has no mouse: no mouse events and no episodes, ever', () => {
    for (const act of ['edit', 'read', 'test', 'think'])
      for (const c of chunks('agent_2', act, 30, { mouse: false })) {
        expect(c.mouse).toEqual([])
        expect(c.episodes).toEqual([])
      }
  })
  it('the 3D artist (agent_1) works the mouse longer than the planner (agent_0)', () => {
    expect(share('edit', 'agent_1').mouse).toBeGreaterThan(share('edit', 'agent_0').mouse)
  })
})

describe('the keycap press (typing.md 5)', () => {
  it('goes down in 40 ms ending 20 ms after the actuation, stays while held, comes up in 60 ms', () => {
    const k = { t: 10, hold: 0.1 }
    expect(pressAt(k, 9.97)).toBe(0)
    expect(pressAt(k, 9.99)).toBeCloseTo(0.25, 2)
    expect(pressAt(k, 10)).toBeCloseTo(0.5, 2) // at the actuation the key is half way (2 mm of 4)
    expect(pressAt(k, 10.02)).toBeCloseTo(1, 2)
    expect(pressAt(k, 10.06)).toBe(1)
    expect(pressAt(k, 10.09)).toBe(1)
    expect(pressAt(k, 10.12)).toBeGreaterThan(0.3)
    expect(pressAt(k, 10.12)).toBeLessThan(0.9)
    expect(pressAt(k, 10.2)).toBe(0)
  })
  it('a timelapse stretches the press by the same factor', () => {
    const k = { t: 10, hold: 0.4 }
    expect(pressAt(k, 10, 4)).toBeCloseTo(0.5, 2)
    expect(pressAt(k, 10.08, 4)).toBeCloseTo(1, 2)
  })
})
