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
