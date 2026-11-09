import { describe, expect, it } from 'vitest'
import { BLEND_MIN, PERIODS } from '../office/outside'
import { PERIOD_LEVELS, ambienceAt } from './ambience'
import { AGENT_PITCH, CUES, CUE_NAMES, speedRule } from './cues'
import { momentaryMax } from './levels'
import { CHORDS, HOOK, LAYERS, WORK_LAYERS, stepEvents } from './music'
import { clampVolume, parseSetting } from './settings'

describe('parseSetting', () => {
  it('keeps the two known fields, clamps volume, drops the rest', () => {
    expect(parseSetting({ muted: false, volume: 0.5, extra: 'x' })).toEqual({ muted: false, volume: 0.5 })
    expect(parseSetting({ muted: true, volume: 7 })).toEqual({ muted: true, volume: 1 })
    expect(parseSetting({ muted: true, volume: -1 })).toEqual({ muted: true, volume: 0 })
  })
  it('rejects anything else', () => {
    for (const bad of [null, 'x', 1, {}, { muted: 'no', volume: 1 }, { muted: true }, { muted: true, volume: NaN }]) expect(parseSetting(bad)).toBeNull()
  })
  it('clamps', () => {
    expect(clampVolume(0.3)).toBe(0.3)
    expect(clampVolume(Infinity)).toBe(1)
  })
})

describe('ambienceAt', () => {
  it('holds each period after the blend and is quieter at night', () => {
    PERIODS.forEach((p, i) => expect(ambienceAt(p.from + BLEND_MIN + 1)).toEqual(PERIOD_LEVELS[i]))
    const day = ambienceAt(12 * 60)
    const night = ambienceAt(2 * 60)
    expect(night.hvac).toBeLessThan(day.hvac)
    expect(night.city).toBeLessThan(day.city)
    expect(night.cars[0]).toBeGreaterThan(day.cars[0])
  })
  it('blends from the previous period at its start and wraps the day', () => {
    const night = PERIODS[3].from
    const mid = ambienceAt(night + BLEND_MIN / 2)
    expect(mid.hvac).toBeCloseTo((PERIOD_LEVELS[2].hvac + PERIOD_LEVELS[3].hvac) / 2)
    expect(ambienceAt(-60)).toEqual(ambienceAt(23 * 60))
  })
})

describe('music', () => {
  it('opens the hook with the mushroom notes A C E G', () => {
    const notes = [0, 2, 3, 5].map((s) => stepEvents(s, ['hook'])[0].note)
    expect(notes).toEqual([69, 72, 76, 79])
  })
  it('keeps the desk room harmony, two bars per chord', () => {
    expect(CHORDS.map((c) => c[0])).toEqual([57, 53, 48, 55])
    expect(stepEvents(16, ['bass'])[0].note).toBe(53 - 24)
    expect(stepEvents(64, ['bass'])[0].note).toBe(57 - 24) // loops after four chords
  })
  it('kick on 1 and 3, rim on 2 and 4, keys on the off-beats', () => {
    const at = (layer: string) => [...Array(8).keys()].filter((s) => stepEvents(s, LAYERS).some((e) => e.layer === layer))
    expect(at('kick')).toEqual([0, 4])
    expect(at('rim')).toEqual([2, 6])
    expect(at('keys')).toEqual([1, 3, 5, 7])
  })
  it('work drops the hook, rim and kick', () => {
    const layers = new Set([...Array(64).keys()].flatMap((s) => stepEvents(s, WORK_LAYERS).map((e) => e.layer)))
    expect(layers.has('hook')).toBe(false)
    expect(layers.has('kick')).toBe(false)
    expect(layers.has('rim')).toBe(false)
    expect(layers.has('bass')).toBe(true)
  })
  it('hook notes stay in A minor pentatonic or the chord', () => {
    const pent = new Set([9, 0, 2, 4, 7])
    HOOK.forEach((h, i) => h.forEach((n) => expect(pent.has(n % 12) || CHORDS[i].some((c) => c % 12 === n % 12)).toBe(true)))
  })
})

describe('cues', () => {
  it('has the first batch of ten (sound.md 4.1)', () => {
    for (const n of ['type', 'plane.throw', 'plane.land', 'stamp', 'omok.place', 'pingpong.hit', 'pingpong.bounce', 'water', 'approve', 'reject', 'test.pass', 'test.fail'])
      expect(CUE_NAMES).toContain(n)
  })
  it('gives every seat a voice, 에코 lower than 메모', () => {
    expect(Object.keys(AGENT_PITCH)).toHaveLength(5)
    expect(AGENT_PITCH.agent_4).toBeLessThan(AGENT_PITCH.agent_0)
  })
  it('thins busywork when the timelapse runs fast', () => {
    expect(speedRule('repeat', 1, 0.9)).toBe(1)
    expect(speedRule('repeat', 4, 0.2)).toBe(1)
    expect(speedRule('repeat', 4, 0.8)).toBe(0)
    expect(speedRule('repeat', 16, 0)).toBe(0)
    expect(speedRule('event', 4, 0)).toBeCloseTo(0.71)
    expect(speedRule('event', 16, 0)).toBe(0.5)
    expect(speedRule('ui', 16, 0)).toBe(1)
  })
  it('has the paper hand-off cues (#262), all in the room and shorter than the plane', () => {
    for (const n of ['handoff.give', 'handoff.slide', 'handoff.toss', 'handoff.catch'] as const) {
      expect(CUES[n].spatial).toBe(true)
      expect(CUES[n].kind).toBe('event')
    }
    expect(CUES['handoff.toss'].length).toBeLessThan(CUES['plane.throw'].length)
  })
  it('only room sounds are spatial', () => {
    expect(CUES.approve.spatial).toBe(false)
    expect(CUES['omok.place'].spatial).toBe(true)
  })
})

describe('momentaryMax', () => {
  it('reads a full-scale sine near −3.7 LUFS and silence very low', () => {
    const rate = 8000
    const sine = new Float32Array(rate).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate))
    expect(momentaryMax(sine, rate)).toBeCloseTo(-3.7, 0)
    expect(momentaryMax(new Float32Array(rate), rate)).toBeLessThan(-100)
  })
})

describe('keyRoll', () => {
  it('is stable per key, spread over 0..1', async () => {
    const { keyRoll } = await import('./cues')
    expect(keyRoll('pingpong:a:3')).toBe(keyRoll('pingpong:a:3'))
    const rolls = [...Array(400).keys()].map((i) => keyRoll(`ev:${i}`))
    expect(rolls.every((r) => r >= 0 && r < 1)).toBe(true)
    const kept = rolls.filter((r) => r < 0.5).length
    expect(kept).toBeGreaterThan(160)
    expect(kept).toBeLessThan(240)
  })
})

describe('② play sounds', async () => {
  const { pingpongEvents, stampPressed, JUMP_MS } = await import('./playSounds')
  const { keysBetween } = await import('./typing')
  const rally = (y: number | null, swing: { side: 0 | 1; t01: number } | null) =>
    ({ ballPos: y === null ? null : [0, y, 0], phase: 'flight', hitter: 0, swing: swing ? { ...swing, at: [0, 0, 0] } : null, score: [0, 0], server: 0, game: 0 }) as never

  it('ping-pong: a hit when the swing passes contact, a bounce at the table, a thud below it', () => {
    let p = pingpongEvents(null, 7, 1000, rally(0.3, { side: 0, t01: 0.4 }), 0.02)
    expect(p.events).toEqual([])
    p = pingpongEvents(p.next, 7, 1016, rally(0.2, { side: 0, t01: 0.55 }), 0.02)
    expect(p.events).toEqual(['hit'])
    p = pingpongEvents(p.next, 7, 1032, rally(0.021, null), 0.02)
    p = pingpongEvents(p.next, 7, 1048, rally(0.05, null), 0.02)
    expect(p.events).toEqual(['bounce'])
    let q = pingpongEvents(null, 7, 0, rally(-0.6, null), 0.02)
    q = pingpongEvents(q.next, 7, 16, rally(-0.7, null), 0.02)
    q = pingpongEvents(q.next, 7, 32, rally(-0.65, null), 0.02)
    expect(q.events).toEqual(['floor'])
  })
  it('ping-pong: a jump or another session plays nothing', () => {
    const a = pingpongEvents(null, 7, 1000, rally(0.3, { side: 0, t01: 0.4 }), 0.02)
    expect(pingpongEvents(a.next, 7, 1000 + JUMP_MS + 1, rally(0.2, { side: 0, t01: 0.6 }), 0.02).events).toEqual([])
    expect(pingpongEvents(a.next, 8, 1016, rally(0.2, { side: 0, t01: 0.6 }), 0.02).events).toEqual([])
  })
  it('stamp: one press per 1.2 s cycle, none across a jump', () => {
    expect(stampPressed(0.5, 0.56)).toBe(true) // 550 ms
    expect(stampPressed(0.56, 0.6)).toBe(false)
    expect(stampPressed(1.74, 1.76)).toBe(true) // 1750 ms
    expect(stampPressed(0.1, 2)).toBe(false)
    expect(stampPressed(null, 0.56)).toBe(false)
  })
  it('typing: 6–9 keys a second in bursts, no catch-up after a jump', () => {
    let s = keysBetween(null, 0, () => 0.5).next
    let n = 0
    for (let t = 0.05; t <= 20; t += 0.05) {
      const r = keysBetween(s, t, () => 0.5)
      n += r.keys.length
      s = r.next
    }
    expect(n / 20).toBeGreaterThan(3)
    expect(n / 20).toBeLessThan(9)
    expect(keysBetween(s, 100).keys).toEqual([])
  })
})

describe('ping-pong point end', async () => {
  const { pingpongEvents } = await import('./playSounds')
  it('a point ending (phase → dead) is the dull thud', () => {
    const r = (phase: string) => ({ ballPos: [0, 0.4, 0], phase, hitter: 0, swing: null, score: [0, 0], server: 0, game: 0 }) as never
    const a = pingpongEvents(null, 1, 0, r('flight'), 0.02)
    expect(pingpongEvents(a.next, 1, 16, r('dead'), 0.02).events).toEqual(['floor'])
    const b = pingpongEvents(a.next, 1, 16, r('flight'), 0.02)
    expect(pingpongEvents(b.next, 1, 32, r('flight'), 0.02).events).toEqual([])
  })
})

describe('silenceReasons', async () => {
  const { silenceReasons } = await import('./audible')
  type AudibleState = import('./audible').AudibleState
  const ok: AudibleState = { muted: false, volume: 1, ctx: 'running', hidden: false, room: 1 }
  it('is empty when the page is sounding', () => expect(silenceReasons(ok)).toEqual([]))
  it('names each reason', () => {
    const codes = (s: Partial<AudibleState>) => silenceReasons({ ...ok, ...s }).map((r) => r.code)
    expect(codes({ muted: true })).toEqual(['muted'])
    expect(codes({ volume: 0 })).toEqual(['volume0'])
    expect(codes({ ctx: null })).toEqual(['noContext'])
    expect(codes({ ctx: 'suspended' })).toEqual(['suspended'])
    expect(codes({ hidden: true })).toEqual(['hidden'])
    expect(codes({ room: 0 })).toEqual(['room0'])
    expect(codes({ muted: true, volume: 0, ctx: null })).toEqual(['muted', 'volume0', 'noContext'])
  })
})

describe('#194 thock keyboard', async () => {
  const { spread, KEY_VOICES } = await import('./keys')
  const { overlapping, CUES, MAX_KEYS } = await import('./cues')
  const { keysBetween } = await import('./typing')
  const { BUS_LEVEL } = await import('./engine')
  it('every key a little different: ±1 semitone, ±20% length', () => {
    expect(spread(0, 0).pitch).toBeCloseTo(Math.pow(2, -1 / 12))
    expect(spread(1, 1).pitch).toBeCloseTo(Math.pow(2, 1 / 12))
    expect(spread(0.5, 0.5)).toEqual({ pitch: 1, len: 1 })
  })
  it('thock first (the default), then the two A/B candidates (#194 thock2)', () => expect(KEY_VOICES.slice(0, 3)).toEqual(['thock', 'thock2', 'sample']))
  it('the recorded strokes: 24 kHz 16-bit mono WAV, 8 × 160 ms, under 64 KB', async () => {
    const fs = await import('node:fs')
    const { SAMPLE_STROKES, SAMPLE_LEN_S, SAMPLE_URL } = await import('./keys')
    const b = fs.readFileSync(new URL(`../../public/${SAMPLE_URL}`, import.meta.url))
    expect(b.toString('ascii', 0, 4)).toBe('RIFF')
    expect(b.readUInt16LE(22)).toBe(1) // mono
    expect(b.readUInt32LE(24)).toBe(24000)
    expect(b.readUInt16LE(34)).toBe(16)
    expect(b.readUInt32LE(40) / 2 / 24000).toBeCloseTo(SAMPLE_STROKES * SAMPLE_LEN_S, 2)
    expect(b.length).toBeLessThan(64 * 1024)
  })
  it('typing has its own bus, 5 dB under the effects', () => {
    expect(CUES.type.bus).toBe('keys')
    expect(20 * Math.log10(BUS_LEVEL.keys / BUS_LEVEL.sfx)).toBeCloseTo(-5, 0)
    expect(MAX_KEYS).toBe(4)
  })
  it('overlap counts spans that meet [t, t + len)', () => {
    const spans: [number, number][] = [[0, 0.1], [0.05, 0.15], [0.5, 0.6]]
    expect(overlapping(spans, 0.08, 0.01)).toBe(2)
    expect(overlapping(spans, 0.2, 0.1)).toBe(0)
    expect(overlapping(spans, 0.55, 0.1)).toBe(1)
  })
  it('words end in a space, bursts sometimes in enter, typos in backspaces', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let s = keysBetween(null, 0, rand).next
    const kinds: string[] = []
    for (let t = 0.05; t <= 120; t += 0.05) {
      const r = keysBetween(s, t, rand)
      kinds.push(...r.kinds)
      s = r.next
    }
    const count = (k: string) => kinds.filter((x) => x === k).length
    expect(count('char')).toBeGreaterThan(count('space'))
    expect(count('space')).toBeGreaterThan(0)
    expect(count('enter')).toBeGreaterThan(0)
    expect(count('backspace') % 2).toBe(0)
  })
})

describe('#240 approval chime', async () => {
  const { shouldChime } = await import('./notify')
  const { CUES } = await import('./cues')
  const n = (count: number, newestAt?: string) => ({ count, newestAt })
  it('chimes once when the count goes up, never on first load or a drop', () => {
    expect(shouldChime(null, n(3), true)).toBe(false)
    expect(shouldChime(n(2), n(3), true)).toBe(true)
    expect(shouldChime(n(2), n(5), true)).toBe(true) // several at once = one chime (one call)
    expect(shouldChime(n(3), n(3), true)).toBe(false)
    expect(shouldChime(n(3), n(2), true)).toBe(false)
  })
  it('one decided + one new in the same refresh: the newest request moved on (coder, #245)', () => {
    expect(shouldChime(n(3, '2026-11-10T01:00:00Z'), n(3, '2026-11-10T01:05:00Z'), true)).toBe(true)
    expect(shouldChime(n(3, '2026-11-10T01:05:00Z'), n(2, '2026-11-10T01:05:00Z'), true)).toBe(false)
    expect(shouldChime(n(3, '2026-11-10T01:05:00Z'), n(3, undefined), true)).toBe(false)
    expect(shouldChime(n(3, 'nonsense'), n(3, '2026-11-10T01:05:00Z'), true)).toBe(false)
  })
  it('only the owner by default', () => {
    expect(shouldChime(n(1), n(2), false)).toBe(false)
    expect(shouldChime(n(1), n(2), false, false, 'everyone')).toBe(true)
  })
  it('stays quiet in a hidden tab, and does not save it up', () => {
    expect(shouldChime(n(1), n(2), true, true)).toBe(false)
  })
  it('is a screen sound, not in the room', () => {
    expect(CUES['approval.new'].spatial).toBe(false)
    expect(CUES['approval.new'].kind).toBe('ui')
  })
})
