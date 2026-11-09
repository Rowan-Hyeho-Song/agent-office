// The room tone (docs/design/sound.md 3): air handling, the far city, a car now and then. It follows the window's
// periods (outside.ts PERIODS: dawn 5 · day 7 · evening 17 · night 20, blended over BLEND_MIN) so the office sounds
// like the time the window shows. No position: the whole room.

import { BLEND_MIN, PERIODS } from '../office/outside'
import { audioGraph, whenReady } from './engine'
import { noiseBuffers } from './synth'

export type AmbienceLevels = {
  /** air handling, 0..1 of its base */
  hvac: number
  /** far city */
  city: number
  /** seconds between passing cars [min, max] */
  cars: [number, number]
}

/** dawn · day · evening · night (same order as PERIODS) */
export const PERIOD_LEVELS: AmbienceLevels[] = [
  { hvac: 0.7, city: 0.4, cars: [90, 180] }, // dawn: waking up
  { hvac: 1, city: 0.63, cars: [40, 90] }, // day: city −4 dB
  { hvac: 0.85, city: 0.5, cars: [60, 120] }, // evening
  { hvac: 0.5, city: 0.25, cars: [180, 360] }, // night: hvac −6, city −12
]

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** the levels at a KST minute of the day, blended over BLEND_MIN after each period starts (pure, tested) */
export function ambienceAt(minutes: number): AmbienceLevels {
  const m = ((minutes % 1440) + 1440) % 1440
  let i = PERIODS.length - 1
  for (let k = 0; k < PERIODS.length; k++) if (m >= PERIODS[k].from) i = k
  const cur = PERIOD_LEVELS[i]
  const prev = PERIOD_LEVELS[(i + PERIODS.length - 1) % PERIODS.length]
  const since = (m - PERIODS[i].from + 1440) % 1440
  const k = since >= BLEND_MIN ? 1 : since / BLEND_MIN
  return {
    hvac: lerp(prev.hvac, cur.hvac, k),
    city: lerp(prev.city, cur.city, k),
    cars: [lerp(prev.cars[0], cur.cars[0], k), lerp(prev.cars[1], cur.cars[1], k)],
  }
}

type Bed = { hvac: GainNode; city: GainNode; carTimer?: number }
let bed: Bed | null = null
let levels: AmbienceLevels = PERIOD_LEVELS[1]

function loop(c: AudioContext, kind: 'pink' | 'white') {
  const s = c.createBufferSource()
  s.buffer = noiseBuffers(c)[kind]
  s.loop = true
  // start each loop at a random point so the two layers don't share a seam
  s.start(c.currentTime, Math.random() * 1.9)
  return s
}

/** start the bed (idempotent). It sits under everything at the ambience bus level. */
export function startAmbience() {
  whenReady((g) => {
    if (bed) return
    const c = g.ctx
    // air handling: pink noise darkened twice to a soft rumble, breathing at 0.05 Hz
    const hvacLp = c.createBiquadFilter()
    hvacLp.type = 'lowpass'
    hvacLp.frequency.value = 180
    const hvacLp2 = c.createBiquadFilter()
    hvacLp2.type = 'lowpass'
    hvacLp2.frequency.value = 260
    const hvac = c.createGain()
    hvac.gain.value = 0.5 * levels.hvac
    const lfo = c.createOscillator()
    lfo.frequency.value = 0.05
    const depth = c.createGain()
    depth.gain.value = 0.08
    lfo.connect(depth).connect(hvac.gain)
    lfo.start()
    loop(c, 'pink').connect(hvacLp).connect(hvacLp2).connect(hvac).connect(g.bus.ambience)
    // far city: a wide band around 400 Hz
    const cityBp = c.createBiquadFilter()
    cityBp.type = 'bandpass'
    cityBp.frequency.value = 400
    cityBp.Q.value = 0.5
    const city = c.createGain()
    city.gain.value = 0.35 * levels.city
    loop(c, 'pink').connect(cityBp).connect(city).connect(g.bus.ambience)
    bed = { hvac, city }
    scheduleCar()
  })
}

function scheduleCar() {
  if (!bed) return
  const [lo, hi] = levels.cars
  bed.carTimer = window.setTimeout(() => {
    passCar()
    scheduleCar()
  }, (lo + Math.random() * (hi - lo)) * 1000)
}

/** a car going by outside: band-passed noise swelling over 3–5 s, panned across */
export function passCar() {
  const g = audioGraph()
  if (!g || g.ctx.state !== 'running') return
  const c = g.ctx
  const t = c.currentTime
  const dur = 3 + Math.random() * 2
  const dir = Math.random() < 0.5 ? -1 : 1
  const src = c.createBufferSource()
  src.buffer = noiseBuffers(c).pink
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(320, t)
  bp.frequency.linearRampToValueAtTime(520, t + dur * 0.5) // a little doppler rise, then fall
  bp.frequency.linearRampToValueAtTime(300, t + dur)
  bp.Q.value = 0.8
  const gain = c.createGain()
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.5, t + dur * 0.5)
  gain.gain.linearRampToValueAtTime(0, t + dur)
  const pan = c.createStereoPanner()
  pan.pan.setValueAtTime(-0.8 * dir, t)
  pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur)
  src.connect(bp).connect(gain).connect(pan).connect(g.bus.ambience)
  // the 2 s buffer is shorter than a pass: loop it
  src.loop = true
  src.start(t, Math.random() * 1.9)
  src.stop(t + dur)
}

let override: number | null = null
/** debug: hold the room tone at a minute of the day (null = follow the clock again) */
export function setAmbienceOverride(minutes: number | null) {
  override = minutes
  if (minutes !== null) apply(minutes)
}

/** follow the clock (called every couple of seconds with the office's KST minute) */
export function setAmbienceMinute(minutes: number) {
  if (override === null) apply(minutes)
}

function apply(minutes: number) {
  levels = ambienceAt(minutes)
  const g = audioGraph()
  if (!g || !bed) return
  const t = g.ctx.currentTime
  bed.hvac.gain.setTargetAtTime(0.5 * levels.hvac, t, 1.5)
  bed.city.gain.setTargetAtTime(0.35 * levels.city, t, 1.5)
}

export const ambienceLevels = () => levels
