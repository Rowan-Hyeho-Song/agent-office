// The speaker music (docs/design/sound.md 5, 결재 3): the desk room's song re-arranged faster and brighter, a work song.
// Same harmony (Am9 – Fmaj9 – Cmaj7(add9) – G6, two bars each) and the same notes; the desk's random arpeggio becomes a
// fixed two-bar hook that opens with the mushroom game's four notes (A C E G). 108 BPM by default (72 × 1.5).
// While the agents work it plays −12 dB with the hook, rim and kick taken out: small and high hits are what nag.
//
// Pure pattern (`stepEvents`) + a lookahead scheduler. Output: one node (`musicOut`) that ③ will route to the
// speakers' panners; until then it feeds the music bus straight.

import { audioGraph, whenReady } from './engine'
import { midi, noise, noiseBuffers, tone, type Out } from './synth'

export const TEMPOS = [96, 108, 120] as const
export type Tempo = (typeof TEMPOS)[number]
export type Layer = 'hook' | 'keys' | 'pad' | 'bass' | 'kick' | 'shaker' | 'rim'
export const LAYERS: Layer[] = ['hook', 'keys', 'pad', 'bass', 'kick', 'shaker', 'rim']
export type MusicState = 'off' | 'work' | 'break'

/** the desk room's chords (rowansong.dev audio.ts CHORDS) */
export const CHORDS = [
  [57, 60, 64, 67, 71], // Am9
  [53, 57, 60, 64, 67], // Fmaj9
  [48, 55, 59, 62, 64], // Cmaj7(add9)
  [55, 59, 62, 64, 66], // G6
]

/** the hook: 8 notes over 16 eighths, one shape per chord, all in A minor pentatonic (+ chord tones) */
export const HOOK_SLOTS = [0, 2, 3, 5, 7, 8, 10, 12]
export const HOOK = [
  [69, 72, 76, 79, 76, 74, 72, 69], // Am9: A C E G — the mushroom notes
  [69, 72, 76, 79, 76, 72, 69, 72], // Fmaj9
  [67, 72, 76, 79, 76, 74, 72, 67], // Cmaj7
  [67, 69, 74, 79, 76, 74, 69, 67], // G6
]

/** what plays while the agents work (−12 dB): the hook, rim and kick are out */
export const WORK_LAYERS: Layer[] = ['keys', 'pad', 'bass', 'shaker']
export const WORK_DB = -12

export type Ev = { layer: Layer; note?: number; accent?: boolean; swing?: boolean }

/**
 * Everything that starts on eighth-note `step` (16 per chord, 8 per bar), for the given layers. Pure.
 * - hook: HOOK at HOOK_SLOTS
 * - keys: off-beat stabs (the "and"s) of the chord without its root
 * - pad: once per chord, very soft
 * - bass: root / octave on every eighth, accent on the beat
 * - kick: beats 1 and 3 · rim: beats 2 and 4 · shaker: every eighth, off-beats swung
 */
export function stepEvents(step: number, layers: readonly Layer[]): Ev[] {
  const on = new Set(layers)
  const inChord = ((step % 16) + 16) % 16
  const chordIdx = Math.floor((((step % 64) + 64) % 64) / 16)
  const chord = CHORDS[chordIdx]
  const inBar = inChord % 8
  const out: Ev[] = []
  const h = HOOK_SLOTS.indexOf(inChord)
  if (on.has('hook') && h >= 0) out.push({ layer: 'hook', note: HOOK[chordIdx][h] })
  if (on.has('keys') && inBar % 2 === 1) out.push({ layer: 'keys', swing: true })
  if (on.has('pad') && inChord === 0) out.push({ layer: 'pad' })
  if (on.has('bass')) out.push({ layer: 'bass', note: chord[0] - 24 + (inBar % 2 ? 12 : 0), accent: inBar % 2 === 0, swing: inBar % 2 === 1 })
  if (on.has('kick') && (inBar === 0 || inBar === 4)) out.push({ layer: 'kick' })
  if (on.has('rim') && (inBar === 2 || inBar === 6)) out.push({ layer: 'rim' })
  if (on.has('shaker')) out.push({ layer: 'shaker', accent: inBar % 2 === 1, swing: inBar % 2 === 1 })
  return out
}

export const chordAt = (step: number) => CHORDS[Math.floor((((step % 64) + 64) % 64) / 16)]

// ─── voices ───

function keys(o: Out, notes: number[], dur: number) {
  // electric piano: sine + a quiet 2nd harmonic, fast decay
  for (const n of notes) {
    tone(o, midi(n), dur, { type: 'sine', level: 0.05, attack: 0.004 })
    tone(o, midi(n) * 2, dur * 0.6, { type: 'sine', level: 0.012, attack: 0.002 })
  }
}

function pad(o: Out, notes: number[], dur: number) {
  const { c, t } = o
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.setValueAtTime(500, t)
  f.frequency.linearRampToValueAtTime(1100, t + dur * 0.5)
  f.frequency.linearRampToValueAtTime(600, t + dur)
  const env = c.createGain()
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(0.018, t + 0.8)
  env.gain.setValueAtTime(0.018, t + dur - 0.6)
  env.gain.linearRampToValueAtTime(0, t + dur + 0.6)
  f.connect(env).connect(o.dest)
  for (const n of notes.slice(0, 4)) {
    for (const d of [-7, 7]) {
      const osc = c.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = midi(n)
      osc.detune.value = d
      osc.connect(f)
      osc.start(t)
      osc.stop(t + dur + 0.7)
    }
  }
}

function bass(o: Out, note: number, dur: number, accent: boolean) {
  const { c, t } = o
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 600
  lp.connect(o.dest)
  const lvl = accent ? 0.13 : 0.09
  tone({ ...o, dest: lp }, midi(note), dur, { type: 'sine', level: lvl, attack: 0.006 })
  tone({ ...o, dest: lp }, midi(note), dur * 0.7, { type: 'sawtooth', level: lvl * 0.18, attack: 0.006 })
  void t
}

function kick(o: Out) {
  tone(o, 120, 0.22, { type: 'sine', level: 0.22, slide: 50 / 120, attack: 0.002 })
}

function rim(o: Out) {
  noise(o, 0.015, { freq: 1700, q: 10, level: 0.12, attack: 0.0005 })
  tone(o, 1700, 0.03, { type: 'triangle', level: 0.012, attack: 0.001 })
}

function shaker(o: Out, accent: boolean) {
  noise(o, 0.045, { freq: 6000, q: 1.2, level: accent ? 0.035 : 0.022, attack: 0.008 })
}

function hook(o: Out, note: number, eighth: number) {
  tone(o, midi(note), Math.min(0.5, eighth * 1.6), { type: 'triangle', level: 0.045, attack: 0.006, echo: true })
}

// ─── the player ───

type Player = {
  out: GainNode
  echo: DelayNode
  timer?: number
  step: number
  next: number
  hiss?: AudioBufferSourceNode
}

let p: Player | null = null
let tempo: Tempo = 108
let state: MusicState = 'off'
const muted = new Set<Layer>() // debug: layers switched off by hand
/** the layers chosen at the last two-bar boundary (layers change only there) */
let current: Layer[] = []

export const getTempo = () => tempo
export const getMusicState = () => state
export const isLayerMuted = (l: Layer) => muted.has(l)

export function setTempo(t: Tempo) {
  tempo = t
}
export function toggleLayer(l: Layer, on: boolean) {
  if (on) muted.delete(l)
  else muted.add(l)
}

const layersFor = (s: MusicState): Layer[] => (s === 'break' ? LAYERS : s === 'work' ? WORK_LAYERS : []).filter((l) => !muted.has(l))
const stateGain = (s: MusicState) => (s === 'break' ? 1 : s === 'work' ? Math.pow(10, WORK_DB / 20) : 0)

/** the node the music comes out of (③ routes it to the speakers) */
export const musicOut = () => p?.out ?? null

/** off / work (−12 dB, fewer layers) / break (everything). Fades over 2 s. */
export function setMusicState(s: MusicState) {
  state = s
  whenReady((g) => {
    if (!p && s !== 'off') start(g.ctx, g.bus.music)
    if (!p) return
    const t = g.ctx.currentTime
    p.out.gain.cancelScheduledValues(t)
    p.out.gain.setTargetAtTime(stateGain(s), t, 0.6)
  })
}

function start(c: AudioContext, into: AudioNode) {
  const out = c.createGain()
  out.gain.value = 0
  out.connect(into)
  // its own short echo for the hook (a dotted eighth at 108)
  const d = c.createDelay(1)
  d.delayTime.value = (60 / tempo) * 0.75
  const fb = c.createGain()
  fb.gain.value = 0.3
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2200
  d.connect(lp).connect(fb).connect(d)
  lp.connect(out)
  // tape hiss, a touch more than the desk room
  const hiss = c.createBufferSource()
  hiss.buffer = noiseBuffers(c).white
  hiss.loop = true
  const hf = c.createBiquadFilter()
  hf.type = 'bandpass'
  hf.frequency.value = 5000
  hf.Q.value = 0.4
  const hg = c.createGain()
  hg.gain.value = 0.016
  hiss.connect(hf).connect(hg).connect(out)
  hiss.start()
  p = { out, echo: d, step: 0, next: c.currentTime + 0.15, hiss }
  const tick = () => {
    if (!p) return
    const g = audioGraph()
    if (!g) return
    while (p.next < c.currentTime + 0.3) {
      const eighth = 60 / tempo / 2
      if (p.step % 16 === 0) current = layersFor(state) // layers change at the chord (two-bar) boundary
      const chord = chordAt(p.step)
      for (const ev of stepEvents(p.step, current)) {
        const t = p.next + (ev.swing ? eighth * 0.1 : 0) // 55% swing
        const o: Out = { c, dest: out, echo: d, t }
        switch (ev.layer) {
          case 'hook':
            hook(o, ev.note!, eighth)
            break
          case 'keys':
            keys(o, chord.slice(1, 4), eighth * 0.9)
            break
          case 'pad':
            pad(o, chord, eighth * 16)
            break
          case 'bass':
            bass(o, ev.note!, eighth * 0.85, !!ev.accent)
            break
          case 'kick':
            kick(o)
            break
          case 'rim':
            rim(o)
            break
          case 'shaker':
            shaker(o, !!ev.accent)
            break
        }
      }
      p.next += eighth
      p.step++
    }
  }
  tick()
  p.timer = window.setInterval(tick, 100)
}

/** debug: the step counter, to show where in the song we are */
export const musicStep = () => p?.step ?? 0
