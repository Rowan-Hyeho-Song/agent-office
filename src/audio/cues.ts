// Every office sound effect, one name each (docs/design/sound.md 4). Call sites add one line: `cue('omok.place', { pos })`.
// Nothing happens before the context exists or while muted. Levels use the desk room's `beep(level)` scale
// (its click is 0.04, its success 0.05). Pitched cues stay in A minor pentatonic so they sit on the music.

import { MAX_SFX, audioGraph, duck, panner, type Bus, type Vec } from './engine'
import { getSetting } from './settings'
import { knock, midi, noise, tone, type Out } from './synth'

/** repeat = background busywork (dropped when fast or off-camera), event = something happened, ui = the visitor did it */
type Kind = 'repeat' | 'event' | 'ui'

type CueVars = { agent?: string; dur?: number; pitch: number }

type CueDef = {
  label: string
  kind: Kind
  bus: Bus
  /** has a place in the room (panned, quieter far away) */
  spatial: boolean
  /** minimum gap between two of the same cue, ms */
  gap: number
  /** seconds it sounds (for the voice cap) */
  length: number
  play: (o: Out, v: CueVars) => void
}

/** robot voices by seat (sound.md 4.3): 메모 · 메시 · 휴 · 루프 · 에코 */
export const AGENT_PITCH: Record<string, number> = { agent_0: 1, agent_1: 0.85, agent_2: 1.15, agent_3: 0.95, agent_4: 0.9 }
const seatPitch = (agent?: string) => (agent ? (AGENT_PITCH[agent] ?? 1) : 1)

/** a lowpassed destination for the softer square tones */
function dark(o: Out, cutoff: number): Out {
  const f = o.c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = cutoff
  f.connect(o.dest)
  return { ...o, dest: f }
}

export const CUES = {
  // ── 1차 묶음 (sound.md 4.1) ──
  type: {
    label: '타자 딸깍',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 38,
    length: 0.03,
    play: (o, v) => {
      noise(o, 0.025, { freq: 3200 * v.pitch, q: 1.4, level: 0.03 })
      tone(o, 1500 * v.pitch, 0.02, { type: 'triangle', level: 0.006 })
    },
  },
  'plane.throw': {
    label: '종이비행기 슉',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.3,
    play: (o) => noise(o, 0.28, { kind: 'pink', freq: 800, to: 2400, q: 1.2, level: 0.09, shape: 'swell' }),
  },
  'plane.land': {
    label: '종이비행기 톡',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.06,
    play: (o) => {
      noise(o, 0.05, { freq: 2600, q: 0.8, level: 0.07 })
      noise(o, 0.03, { kind: 'pink', filter: 'lowpass', freq: 900, level: 0.04 })
    },
  },
  stamp: {
    label: '도장 쿵',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 250,
    length: 0.15,
    play: (o) => {
      tone(o, 90, 0.12, { type: 'sine', level: 0.06, slide: 0.66, attack: 0.002 })
      noise(o, 0.04, { kind: 'pink', filter: 'lowpass', freq: 500, level: 0.09 })
    },
  },
  'omok.place': {
    label: '오목 돌 딱',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.05,
    play: (o, v) => knock(o, 1800 * v.pitch, 0.04, 0.045, 12, 0.5),
  },
  'pingpong.hit': {
    label: '탁구 라켓 톡',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.04,
    play: (o, v) => {
      tone(o, 1100 * v.pitch, 0.03, { type: 'triangle', level: 0.04, slide: 0.82, attack: 0.001 })
      noise(o, 0.012, { freq: 2500, q: 2, level: 0.05 })
    },
  },
  'pingpong.bounce': {
    label: '탁구 탁자 튐',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 80,
    length: 0.03,
    play: (o, v) => knock(o, 1500 * v.pitch, 0.02, 0.03, 10, 0.6),
  },
  'pingpong.dull': {
    label: '탁구 네트 · 실수 툭',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.05,
    play: (o) => knock(o, 600, 0.04, 0.035, 6, 0.7),
  },
  water: {
    label: '물 주기 졸졸',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 2,
    play: (o, v) => {
      // a steady wash plus short droplets whose band jumps around 1.2–3 kHz every ~60 ms, like a trickle
      const dur = Math.min(3, v.dur ?? 2)
      noise(o, dur, { freq: 2000, q: 3, level: 0.02, shape: 'flat', attack: 0.15 })
      for (let k = 0; k < dur / 0.06; k++) {
        noise({ ...o, t: o.t + k * 0.06 + Math.random() * 0.03 }, 0.05, { freq: 1200 + Math.random() * 1800, q: 6, level: 0.03 })
      }
    },
  },
  'door.enter': {
    label: '출입문 (따로 열었을 때)',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.2,
    play: (o) => {
      tone(o, 520, 0.08, { type: 'triangle', level: 0.035, slide: 2 })
      tone(o, 1040, 0.1, { type: 'triangle', level: 0.025, at: 0.06 })
    },
  },
  approve: {
    label: '결재 승인',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.6,
    play: (o) => [0, 4, 7, 12].forEach((s, i) => tone(o, midi(60 + s), 0.18, { level: 0.045, at: i * 0.08, echo: true })),
  },
  reject: {
    label: '결재 반려',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.35,
    play: (o) => {
      tone(o, midi(64), 0.14, { level: 0.04 })
      tone(o, midi(60), 0.2, { level: 0.04, at: 0.12 })
    },
  },
  'stamp.ui': {
    label: '결재함 도장 쾅',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 250,
    length: 0.15,
    play: (o) => {
      tone(o, 90, 0.12, { type: 'sine', level: 0.07, slide: 0.66, attack: 0.002 })
      noise(o, 0.045, { kind: 'pink', filter: 'lowpass', freq: 600, level: 0.11 })
    },
  },
  'test.pass': {
    label: '테스트 통과',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.3,
    play: (o) => {
      tone(o, midi(88), 0.12, { level: 0.03 })
      tone(o, midi(95), 0.16, { level: 0.03, at: 0.09 })
    },
  },
  'test.fail': {
    label: '테스트 실패',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.35,
    play: (o) => {
      const d = dark(o, 1400)
      tone(d, midi(57), 0.14, { type: 'square', level: 0.025 })
      tone(d, midi(56), 0.2, { type: 'square', level: 0.025, at: 0.12 })
    },
  },
  // ── 화면 UI (책상 방과 같은 소리) ──
  'ui.hover': {
    label: 'UI 호버',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 60,
    length: 0.03,
    play: (o) => tone(o, 1800, 0.03, { type: 'sine', level: 0.025 }),
  },
  'ui.click': {
    label: 'UI 누름',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 60,
    length: 0.05,
    play: (o) => tone(o, 900, 0.05, { type: 'square', level: 0.04, slide: 1.6 }),
  },
  // ── 2차 후보 중 미리 (sound.md 4.2) ──
  snap: {
    label: '에코 손가락 딱',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.05,
    play: (o) => {
      noise(o, 0.02, { freq: 2100, q: 8, level: 0.12, attack: 0.0005 })
      noise(o, 0.04, { freq: 5000, q: 0.7, level: 0.02, attack: 0.0005 })
    },
  },
  voice: {
    label: '로봇 말소리 한 음절',
    kind: 'event',
    bus: 'voice',
    spatial: true,
    gap: 68,
    length: 0.12,
    play: (o, v) => {
      // the desk room's babble: a buzzy glottal saw (+ a sub) through one vowel formant
      const { c, t } = o
      const f0 = (300 + Math.random() * 180) * v.pitch
      const dur = 0.07 + Math.random() * 0.04
      const saw = c.createOscillator()
      saw.type = 'sawtooth'
      saw.frequency.setValueAtTime(f0, t)
      saw.frequency.exponentialRampToValueAtTime(f0 * (0.85 + Math.random() * 0.35), t + dur)
      const sub = c.createOscillator()
      sub.type = 'square'
      sub.frequency.setValueAtTime(f0 / 2, t)
      const formant = c.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = [650, 1050, 1500, 2300][Math.floor(Math.random() * 4)]
      formant.Q.value = 5
      const gain = c.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.32, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      const sg = c.createGain()
      sg.gain.value = 0.25
      saw.connect(formant)
      sub.connect(sg).connect(formant)
      formant.connect(gain).connect(o.dest)
      // 에코 keeps a short slap-back tail (0.12 s, feedback 0.2)
      if (v.agent === 'agent_4') {
        const d = c.createDelay(0.5)
        d.delayTime.value = 0.12
        const fb = c.createGain()
        fb.gain.value = 0.2
        const wet = c.createGain()
        wet.gain.value = 0.5
        gain.connect(d).connect(fb).connect(d)
        d.connect(wet).connect(o.dest)
      }
      saw.start(t)
      sub.start(t)
      saw.stop(t + dur + 0.02)
      sub.stop(t + dur + 0.02)
    },
  },
} satisfies Record<string, CueDef>

export type CueName = keyof typeof CUES
export const CUE_NAMES = Object.keys(CUES) as CueName[]

export type CueOpts = {
  /** where in the room (world metres); ignored by non-spatial cues */
  pos?: Vec
  /** which agent (voice pitch, small timbre offsets) */
  agent?: string
  /** how long, for sustained cues (water) */
  dur?: number
  /** seconds from now */
  at?: number
  /** a stable id of the event (e.g. `pingpong:<session>:<shot>`): the replay keeps or drops the same ones every time */
  key?: string
}

// ── replay speed (sound.md 6): ×1 as is, ×4 half the busywork and events −3 dB, ×16 events only at −6 dB ──
let speed = 1
export const setCueSpeed = (s: number) => void (speed = s)

/** whether a cue of this kind plays at this replay speed, and its gain factor (pure, tested) */
export function speedRule(kind: Kind, s: number, roll: number): number {
  if (kind === 'ui' || s <= 1) return 1
  if (kind === 'repeat') return s >= 16 ? 0 : roll < 0.5 ? 1 : 0
  return s >= 16 ? 0.5 : 0.71
}

/** a stable 0..1 from an event key (FNV-1a), for the replay's "half of them" (pure, tested) */
export function keyRoll(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

// ── the voice cap and repeats ──
const lastAt = new Map<CueName, number>()
const lastPitch = new Map<CueName, number>()
let active: number[] = [] // end times (ctx seconds) of sounding sfx

/** play a cue now. Returns whether it sounded (for tests and the debug panel). */
export function cue(name: CueName, opts: CueOpts = {}): boolean {
  const g = audioGraph()
  if (!g || g.ctx.state !== 'running' || getSetting().muted) return false
  const def = CUES[name] as CueDef
  const now = performance.now()
  if (now - (lastAt.get(name) ?? -1e9) < def.gap) return false
  // the "every other one" at ×4 is decided by the event's key when there is one, so a replayed scene sounds the same
  const k = speedRule(def.kind, speed, opts.key !== undefined ? keyRoll(opts.key) : Math.random())
  if (k === 0) return false

  const t = g.ctx.currentTime + (opts.at ?? 0)
  active = active.filter((e) => e > g.ctx.currentTime)
  if (def.bus === 'sfx' && def.kind !== 'ui' && active.length >= MAX_SFX) return false
  lastAt.set(name, now)

  // a repeat within a second wobbles ±3% so it doesn't sound like a machine gun
  const base = seatPitch(opts.agent)
  const wobble = now - (lastPitch.get(name) ?? -1e9) < 1000 ? 1 + (Math.random() * 2 - 1) * 0.03 : 1
  lastPitch.set(name, now)

  let dest: AudioNode = g.bus[def.bus]
  const trim = g.ctx.createGain()
  trim.gain.value = k
  trim.connect(dest)
  dest = trim
  if (def.spatial && opts.pos) dest = panner(g.ctx, opts.pos, trim)
  def.play({ c: g.ctx, dest, echo: g.echo, t }, { agent: opts.agent, dur: opts.dur, pitch: base * wobble })
  active.push(t + def.length)
  if (def.bus === 'voice') duck('music', -6)
  // let go of the per-cue nodes once it's over
  const free = dest
  setTimeout(() => {
    free.disconnect()
    trim.disconnect()
  }, (def.length + (opts.at ?? 0) + 1.5) * 1000)
  return true
}

/** play a cue into any context (the debug level check renders into an OfflineAudioContext) */
export function playInto(c: BaseAudioContext, dest: AudioNode, name: CueName, t = 0, agent?: string) {
  const def = CUES[name] as CueDef
  def.play({ c, dest, t }, { agent, pitch: seatPitch(agent) })
  return def.length
}
