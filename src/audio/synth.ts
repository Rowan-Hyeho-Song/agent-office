// Synthesis primitives, on any BaseAudioContext so a cue can be drawn live or offline (?debug level check, sound.md 8.2).
// The same voice as the desk room (rowansong.dev src/audio/audio.ts `beep`): a 3 ms attack, an exponential tail, and
// a soft filtered-noise family for the physical sounds (paper, wood, rubber, water).

export const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

/** where a cue plays: its context, the node to feed, an optional echo send, and the start time */
export type Out = { c: BaseAudioContext; dest: AudioNode; echo?: AudioNode; t: number }

type Noise = 'white' | 'pink' | 'brown'
const noiseCache = new WeakMap<BaseAudioContext, Record<Noise, AudioBuffer>>()

/** 2 s of white, pink and brown noise per context, made once (sound.md 7) */
export function noiseBuffers(c: BaseAudioContext): Record<Noise, AudioBuffer> {
  let b = noiseCache.get(c)
  if (b) return b
  const len = Math.floor(c.sampleRate * 2)
  const make = (fill: (d: Float32Array) => void) => {
    const buf = c.createBuffer(1, len, c.sampleRate)
    fill(buf.getChannelData(0))
    return buf
  }
  b = {
    white: make((d) => {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }),
    // Paul Kellet's economy pink filter
    pink: make((d) => {
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22
      }
    }),
    brown: make((d) => {
      let last = 0
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        d[i] = last * 3.5
      }
    }),
  }
  noiseCache.set(c, b)
  return b
}

type ToneOpts = { type?: OscillatorType; level?: number; slide?: number; at?: number; attack?: number; echo?: boolean; detune?: number }

/** the desk room's beep: one oscillator, a fast attack and an exponential tail */
export function tone(o: Out, freq: number, dur: number, opts: ToneOpts = {}) {
  const { c } = o
  const t = o.t + (opts.at ?? 0)
  const osc = c.createOscillator()
  osc.type = opts.type ?? 'triangle'
  osc.frequency.setValueAtTime(freq, t)
  if (opts.detune) osc.detune.value = opts.detune
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(freq * opts.slide, t + dur)
  const g = c.createGain()
  const level = opts.level ?? 0.05
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + (opts.attack ?? 0.003))
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
  osc.connect(g).connect(o.dest)
  if (opts.echo && o.echo) g.connect(o.echo)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

type NoiseOpts = {
  kind?: Noise
  filter?: BiquadFilterType
  freq: number
  /** sweep the filter to this frequency over the length */
  to?: number
  q?: number
  level: number
  at?: number
  attack?: number
  /** 'exp' = a hit that dies away, 'swell' = rises to the middle and falls (a pass-by) */
  shape?: 'exp' | 'swell' | 'flat'
  echo?: boolean
}

/** a burst of filtered noise: clicks, knocks, paper, air */
export function noise(o: Out, dur: number, opts: NoiseOpts) {
  const { c } = o
  const t = o.t + (opts.at ?? 0)
  const src = c.createBufferSource()
  src.buffer = noiseBuffers(c)[opts.kind ?? 'white']
  // a random start inside the 2 s buffer so repeats don't sound identical
  const offset = Math.random() * Math.max(0, 2 - dur - 0.05)
  const f = c.createBiquadFilter()
  f.type = opts.filter ?? 'bandpass'
  f.frequency.setValueAtTime(opts.freq, t)
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur)
  f.Q.value = opts.q ?? 1
  const g = c.createGain()
  const a = opts.attack ?? 0.002
  g.gain.setValueAtTime(0, t)
  if (opts.shape === 'swell') {
    g.gain.linearRampToValueAtTime(opts.level, t + dur * 0.5)
    g.gain.linearRampToValueAtTime(0, t + dur)
  } else if (opts.shape === 'flat') {
    g.gain.linearRampToValueAtTime(opts.level, t + a)
    g.gain.setValueAtTime(opts.level, t + dur - 0.03)
    g.gain.linearRampToValueAtTime(0, t + dur)
  } else {
    g.gain.linearRampToValueAtTime(opts.level, t + a)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
  }
  src.connect(f).connect(g).connect(o.dest)
  if (opts.echo && o.echo) g.connect(o.echo)
  src.start(t, offset, dur + 0.02)
}

/** a struck resonance (wood, a ping-pong ball): a click through a narrow band-pass, plus a short sine body */
export function knock(o: Out, freq: number, dur: number, level: number, q = 12, body = 0.5) {
  noise(o, Math.min(dur, 0.03), { freq, q, level: level * 4, attack: 0.001 })
  tone(o, freq * body, dur, { type: 'sine', level: level * 0.6, attack: 0.001 })
}

/** a shared echo (feedback delay, darkened) whose output goes to `out`; returns the send */
export function makeEcho(c: BaseAudioContext, out: AudioNode, time = 0.42, feedback = 0.38, cutoff = 2400) {
  const d = c.createDelay(1)
  d.delayTime.value = time
  const fb = c.createGain()
  fb.gain.value = feedback
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = cutoff
  d.connect(lp).connect(fb).connect(d)
  lp.connect(out)
  return d
}
