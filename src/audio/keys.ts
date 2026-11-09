// Keyboard voices (#194). The user chose the recording (2026-11-10: "녹음 파일 쓰자, 생각보다 합성으로 만들기 어려운
// 소리 같네"): eight downstrokes of a CC0 Rainy 75 are the office's key sound, the only recorded sound in the office
// (sound.md 1). A real thock is a ~10 ms burst at 1.2–5 kHz with nothing above 5 kHz plus a low thump (sound.md 4.1
// 키보드 표); the synth 'thock2' rebuilt to those numbers stays as the fallback while the file loads (or if it can't),
// and in the debug panel to compare. The first synth thock, creamy, marbly and the old tick are gone (#271 A/B).
//
// Kinds match #225's input events (inputEvents.ts `key` kind): STROKE_RULE says which stroke each kind plays, so the
// timed rhythm now and the real key presses later use the same file the same way.

import { noise, tone, type Out } from './synth'

export type KeyKind = 'char' | 'space' | 'enter' | 'backspace' | 'mod'
export type KeyVoice = 'sample' | 'thock2'
export const KEY_VOICES: KeyVoice[] = ['sample', 'thock2']
export const KEY_VOICE_LABEL: Record<KeyVoice, string> = {
  sample: '녹음 Rainy 75 (기본)',
  thock2: '합성 도각 (파일이 오기 전 대신 남)',
}

// ─── the recording: Freesound 815614 "Typing on a rainy 75" by Techrul, CC0 1.0 (public/audio/CREDITS.md). Eight
// downstrokes cut to 160 ms each, peak −6 dBFS, 24 kHz 16-bit mono WAV, 61 KB. Loaded when sound is turned on. ───
export const SAMPLE_URL = 'audio/keys-rainy75.wav'
export const SAMPLE_STROKES = 8
export const SAMPLE_LEN_S = 0.16

/**
 * which stroke each kind plays (#225 uses the same rule). The recording has no stroke you can tell is the space bar, so:
 * - letters and modifiers: the six lighter strokes (0, 1, 2, 4, 5, 6), modifiers a touch higher and 3 dB softer
 * - backspace: the same six, 2 semitones lower, +1 dB
 * - enter / space: the two darkest, heaviest strokes (7: the loudest of the take, 3: the lowest centroid), 3 / 4
 *   semitones lower (so also longer) and +1.5 / +2 dB: a bigger key sounding deeper, without a stabiliser rattle
 */
const LIGHT = [0, 1, 2, 4, 5, 6] as const
const HEAVY = [7, 3] as const
export const STROKE_RULE: Record<KeyKind, { pool: readonly number[]; rate: number; db: number }> = {
  char: { pool: LIGHT, rate: 1, db: 0 },
  mod: { pool: LIGHT, rate: Math.pow(2, 1 / 12), db: -3 },
  backspace: { pool: LIGHT, rate: Math.pow(2, -2 / 12), db: 1 },
  enter: { pool: HEAVY, rate: Math.pow(2, -3 / 12), db: 1.5 },
  space: { pool: HEAVY, rate: Math.pow(2, -4 / 12), db: 2 },
}
/** a stroke from the kind's pool for a random `r` in [0, 1), never the one just played when there's a choice (pure) */
export function pickStroke(kind: KeyKind, r: number, last: number): number {
  const pool = STROKE_RULE[kind].pool
  const free = pool.length > 1 ? pool.filter((k) => k !== last) : pool
  return free[Math.min(free.length - 1, Math.floor(r * free.length))]
}

let sample: AudioBuffer | null = null
let loading: Promise<void> | null = null
let lastStroke = -1
/** fetch and decode the strokes once (any context: an AudioBuffer plays in every context). Called when sound turns on. */
export function loadKeySample(c: BaseAudioContext): Promise<void> {
  if (sample) return Promise.resolve()
  if (!loading) {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
    loading = fetch(base + SAMPLE_URL)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .then((b) => void (sample = b))
      .catch(() => void (loading = null))
  }
  return loading
}
export const keySampleReady = () => sample !== null

/** one letter of the recording: a stroke's energy sits 2–3 dB under the old tick's (sound.md 4.1); the keys bus does the rest */
const SAMPLE_GAIN = 0.0274

const STORE = 'agent-office.key-voice'
let voice: KeyVoice = (() => {
  try {
    const v = localStorage.getItem(STORE)
    return v && (KEY_VOICES as string[]).includes(v) ? (v as KeyVoice) : 'sample'
  } catch {
    return 'sample'
  }
})()
export const getKeyVoice = () => voice
/** debug panel choice; remembered in this browser so the user hears the one they picked */
export function setKeyVoice(v: KeyVoice) {
  voice = v
  try {
    localStorage.setItem(STORE, v)
  } catch {
    /* ignore */
  }
}

/** per-key spread: ±1 semitone and ±20% length (pure given `r`, tested) */
export function spread(r1: number, r2: number) {
  return { pitch: Math.pow(2, (r1 * 2 - 1) / 12), len: 0.8 + r2 * 0.4 }
}

/** thock2 by kind: [pitch scale, level] (lower and heavier for the big keys, softer for modifiers) */
const T2_GAIN = 0.07 * Math.pow(10, -17 / 20) * 1.3
const T2: Record<KeyKind, [number, number]> = {
  char: [1, T2_GAIN],
  mod: [250 / 230, T2_GAIN * 0.64],
  backspace: [175 / 230, T2_GAIN * 1.14],
  enter: [150 / 230, T2_GAIN * 1.29],
  space: [120 / 230, T2_GAIN * 1.36],
}

/** one key, on any context (live or offline) */
export function keyVoice(o: Out, kind: KeyKind, pitch: number, v: KeyVoice = voice) {
  const s = spread(Math.random(), Math.random())
  const p = pitch * s.pitch
  if (v === 'sample') {
    if (!sample) {
      void loadKeySample(o.c)
      keyVoice(o, kind, pitch, 'thock2') // until the file is in
      return
    }
    const rule = STROKE_RULE[kind]
    lastStroke = pickStroke(kind, Math.random(), lastStroke)
    const src = o.c.createBufferSource()
    src.buffer = sample
    src.playbackRate.value = p * rule.rate
    const g = o.c.createGain()
    g.gain.value = SAMPLE_GAIN * Math.pow(10, rule.db / 20)
    src.connect(g).connect(o.dest)
    src.start(o.t, lastStroke * SAMPLE_LEN_S, SAMPLE_LEN_S)
    return
  }
  // thock2, the synth "도각": a 10 ms band of noise round 1.7 kHz (+ 3.2 kHz), two quick plastic modes (1.25 / 2.3 kHz),
  // a low thump that drops (160 → 110 Hz, 20 ms) and a little case box at 500 Hz; nothing above ~5 kHz. Letters and
  // modifiers also get the quiet up-stroke 70–110 ms later (the recordings all have it).
  const [kk, a] = T2[kind]
  const big = kind === 'space' || kind === 'enter' || kind === 'backspace'
  noise(o, 0.012 * s.len, { freq: 1700 * p * kk, q: 1.1, level: a * 1.6, attack: 0.0005 })
  noise(o, 0.008 * s.len, { freq: 3200 * p * kk, q: 1.3, level: a * 0.9, attack: 0.0004 })
  tone(o, 1250 * p * kk, 0.014 * s.len, { type: 'sine', level: a * 0.3, attack: 0.0005 })
  tone(o, 2300 * p * kk, 0.007, { type: 'sine', level: a * 0.12, attack: 0.0005 })
  tone(o, 160 * p * kk, (big ? 0.035 : 0.02) * s.len, { type: 'sine', level: a * 0.22, slide: 0.7, attack: 0.001 })
  noise(o, 0.015, { freq: 500 * kk, q: 4, level: a * 0.15, attack: 0.001 })
  if (!big) noise(o, 0.008, { freq: 1300 * p, q: 1.2, level: a * 0.22, attack: 0.0005, at: 0.07 + s.len * 0.05 })
}
