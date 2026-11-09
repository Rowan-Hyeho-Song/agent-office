// Keyboard voices (#194 thock, user: "로우피치 보글보글거리는 소리가 내 취향"). A lubed linear switch, thick PBT caps and
// a foamed case: the sound is a short round body around 150–450 Hz with almost no high tick, every key a little
// different in pitch (±1 semitone) and length so a run of keys "bubbles" instead of ticking like a metronome.
// Space / enter / backspace are lower and heavier (no stabiliser rattle). The old tick stays as a choice.
//
// Kinds match #225's input events (inputEvents.ts `key` kind), so the same voices serve the real key presses later.
//
// #194 thock2 (user: "키보드 누르는 소리는 전혀 쏘키하지 않은데"): measured against CC0 recordings of thocky boards
// (sound.md 4.1 키보드 표). A real thock is NOT a low tone: the keystroke is a ~10 ms burst whose energy sits at
// 1.2–5 kHz with nothing above 5 kHz (that missing top is what makes it "deep"), plus a low desk/case thump under 300 Hz.
// The first thock was 89% at 150–300 Hz and rang 53 ms: a "bloop", and laptop speakers barely play 150–300 Hz.
// Two candidates for the A/B: 'thock2' (synth rebuilt to those numbers) and 'sample' (eight strokes of a CC0 recording).

import { noise, tone, type Out } from './synth'

export type KeyKind = 'char' | 'space' | 'enter' | 'backspace' | 'mod'
export type KeyVoice = 'thock' | 'thock2' | 'sample' | 'creamy' | 'marbly' | 'tick'
export const KEY_VOICES: KeyVoice[] = ['thock', 'thock2', 'sample', 'creamy', 'marbly', 'tick']
export const KEY_VOICE_LABEL: Record<KeyVoice, string> = {
  thock: '깊은 thock (기본)',
  thock2: '도각 thock (다듬음, 합성)',
  sample: '녹음 Rainy 75 (CC0 파일, 결정 필요)',
  creamy: '크리미',
  marbly: '마블 팝',
  tick: '지금 틱',
}

// ─── the recorded voice ('sample'): eight downstrokes of a Rainy 75 (Freesound 815614 by Techrul, CC0 1.0), cut to
// 160 ms each, peak −6 dBFS, 24 kHz 16-bit mono WAV, 61 KB (public/audio/keys-rainy75.wav). Loaded only when chosen. ───
export const SAMPLE_URL = 'audio/keys-rainy75.wav'
export const SAMPLE_STROKES = 8
export const SAMPLE_LEN_S = 0.16
let sample: AudioBuffer | null = null
let loading: Promise<void> | null = null
/** fetch and decode the strokes once (any context: an AudioBuffer plays in every context) */
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
/** the recording's level to sit with the synth thock (both measured as one typist on the master, sound.md 4.1) */
const SAMPLE_GAIN = 0.0274

const STORE = 'agent-office.key-voice'
let voice: KeyVoice = (() => {
  try {
    const v = localStorage.getItem(STORE)
    return v && (KEY_VOICES as string[]).includes(v) ? (v as KeyVoice) : 'thock'
  } catch {
    return 'thock'
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

/**
 * the low voices' overall gain: −17 dB puts one typist's thock (measured on the master, keys bus + glue) at about the
 * energy the old tick had on the sfx bus (RMS −54.5 vs −56.6 dBFS) with peaks 6.6 dB under it (−38.3 vs −31.7); a low
 * body stands out less than a high tick at the same energy: "타이핑 소리는 살짝 작아져도" (#194 thock)
 */
const LOW_GAIN = Math.pow(10, -17 / 20)

/** thock2 against thock: set so one typist measures the same on the master (sound.md 4.1 키보드 표) */
const THOCK2_GAIN = 1.3

/** the body of each kind: [base Hz, decay s, level] for the deep thock; the others scale from it */
const KIND: Record<KeyKind, [number, number, number]> = {
  char: [230, 0.075, 0.07 * LOW_GAIN],
  mod: [250, 0.06, 0.045 * LOW_GAIN],
  backspace: [175, 0.09, 0.08 * LOW_GAIN],
  enter: [150, 0.11, 0.09 * LOW_GAIN],
  space: [120, 0.13, 0.095 * LOW_GAIN],
}

/** one key, on any context (live or offline) */
export function keyVoice(o: Out, kind: KeyKind, pitch: number, v: KeyVoice = voice) {
  const s = spread(Math.random(), Math.random())
  const [f0, d0, l0] = KIND[kind]
  const big = kind === 'space' || kind === 'enter' || kind === 'backspace'
  if (v === 'tick') {
    // the first version: a bright tick (kept to compare)
    noise(o, 0.025, { freq: 3200 * pitch * (big ? 0.7 : 1), q: 1.4, level: big ? 0.035 : 0.03 })
    tone(o, 1500 * pitch * (big ? 0.7 : 1), 0.02, { type: 'triangle', level: 0.006 })
    return
  }
  const p = pitch * s.pitch
  if (v === 'sample') {
    if (!sample) {
      void loadKeySample(o.c)
      keyVoice(o, kind, pitch, 'thock2') // until the file is in
      return
    }
    // a random stroke; the big keys an octave-third lower and longer-sounding, the spread as pitch (±1 semitone)
    const src = o.c.createBufferSource()
    src.buffer = sample
    src.playbackRate.value = p * (big ? 0.8 : kind === 'mod' ? 1.06 : 1)
    const g = o.c.createGain()
    g.gain.value = SAMPLE_GAIN * (l0 / KIND.char[2])
    src.connect(g).connect(o.dest)
    const k = Math.floor(Math.random() * SAMPLE_STROKES)
    src.start(o.t, k * SAMPLE_LEN_S, SAMPLE_LEN_S)
    return
  }
  if (v === 'thock2') {
    // the bottom-out "도각": a 10 ms band of noise round 1.7 kHz + two quick plastic modes (1.25 / 2.3 kHz), a low
    // thump that drops (160 → 110 Hz, 20 ms) and a little case box at 500 Hz; nothing above ~5 kHz. Big keys sit lower.
    // Letters and modifiers also get the quiet up-stroke 70–110 ms later (the recordings all have it).
    const kk = f0 / KIND.char[0]
    const a = l0 * THOCK2_GAIN
    noise(o, 0.012 * s.len, { freq: 1700 * p * kk, q: 1.1, level: a * 1.6, attack: 0.0005 })
    noise(o, 0.008 * s.len, { freq: 3200 * p * kk, q: 1.3, level: a * 0.9, attack: 0.0004 })
    tone(o, 1250 * p * kk, 0.014 * s.len, { type: 'sine', level: a * 0.3, attack: 0.0005 })
    tone(o, 2300 * p * kk, 0.007, { type: 'sine', level: a * 0.12, attack: 0.0005 })
    tone(o, 160 * p * kk, (big ? 0.035 : 0.02) * s.len, { type: 'sine', level: a * 0.22, slide: 0.7, attack: 0.001 })
    noise(o, 0.015, { freq: 500 * kk, q: 4, level: a * 0.15, attack: 0.001 })
    if (!big) noise(o, 0.008, { freq: 1300 * p, q: 1.2, level: a * 0.22, attack: 0.0005, at: 0.07 + s.len * 0.05 })
    return
  }
  if (v === 'thock') {
    // deep thock: a dropping sine body, a dark bottom-out puff, a low case resonance
    const f = f0 * p
    tone(o, f, d0 * s.len, { type: 'sine', level: l0, slide: 0.82, attack: 0.0015 })
    tone(o, f * 1.5, d0 * 0.5 * s.len, { type: 'sine', level: l0 * 0.25, slide: 0.85, attack: 0.001 })
    noise(o, 0.014, { kind: 'pink', filter: 'lowpass', freq: 900, level: l0 * 0.9, attack: 0.0008 })
    noise(o, 0.035 * s.len, { freq: 380 * p, q: 4, level: l0 * 0.6, attack: 0.001 })
  } else if (v === 'creamy') {
    // creamy: softer edge, a little higher and shorter, a smooth puff
    const f = f0 * 1.35 * p
    tone(o, f, d0 * 0.7 * s.len, { type: 'sine', level: l0 * 0.85, slide: 0.88, attack: 0.003 })
    noise(o, 0.022, { kind: 'pink', filter: 'lowpass', freq: 1200, level: l0 * 0.8, attack: 0.002 })
    noise(o, 0.03 * s.len, { freq: 450 * p, q: 3, level: l0 * 0.4, attack: 0.002 })
  } else {
    // marbly pop: a quick round "pop" with a ringing marble-on-glass partial, still under 2 kHz
    const f = f0 * 1.7 * p
    tone(o, f, d0 * 0.55 * s.len, { type: 'sine', level: l0 * 0.8, slide: 0.7, attack: 0.001 })
    tone(o, f * 2.4, 0.03 * s.len, { type: 'sine', level: l0 * 0.22, attack: 0.001 })
    noise(o, 0.012, { freq: 1500, q: 2, level: l0 * 0.5, attack: 0.0005 })
  }
}
