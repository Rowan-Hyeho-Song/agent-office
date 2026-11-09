// Numbers instead of ears (docs/design/sound.md 8.2): draw a cue offline through the same bus gain and compressor as
// live, then read its peak (dBFS) and a short-term loudness (K-weighted, LUFS approximation over the loudest 400 ms).

import { BUS_LEVEL } from './engine'
import { CUES, playInto, type CueName } from './cues'

export type Level = { peak: number; lufs: number }

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -120)

/** max momentary loudness (400 ms windows, 100 ms hop) of K-weighted mono samples (pure) */
export function momentaryMax(k: Float32Array, rate: number): number {
  const win = Math.floor(rate * 0.4)
  const hop = Math.floor(rate * 0.1)
  if (k.length < win) {
    let s = 0
    for (const v of k) s += v * v
    // a cue shorter than a window is measured over a whole 400 ms (silence-padded), as a listener would hear it
    return -0.691 + 10 * Math.log10(Math.max(1e-12, s / win))
  }
  let best = -120
  for (let i = 0; i + win <= k.length; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += k[j] * k[j]
    best = Math.max(best, -0.691 + 10 * Math.log10(Math.max(1e-12, s / win)))
  }
  return best
}

/** render a cue at the live chain (bus level → master 1 → compressor) and measure it */
export async function measureCue(name: CueName, agent?: string): Promise<Level> {
  const rate = 48000
  const len = Math.ceil((CUES[name].length + 1.2) * rate)
  const c = new OfflineAudioContext(1, len, rate)
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 3
  // the same safety limiter as live (engine.ts)
  const lim = c.createDynamicsCompressor()
  lim.threshold.value = -2
  lim.knee.value = 0
  lim.ratio.value = 20
  lim.attack.value = 0.001
  lim.release.value = 0.1
  comp.connect(lim).connect(c.destination)
  const bus = c.createGain()
  bus.gain.value = BUS_LEVEL[CUES[name].bus]
  bus.connect(comp)
  // start after the compressor has settled: it opens from silence over ~0.5 s and read cues ~11 dB too quiet
  playInto(c, bus, name, 0.6, agent)
  const out = (await c.startRendering()).getChannelData(0)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))

  // K-weighting: a high shelf (+4 dB above ~1.7 kHz) and a high-pass at 38 Hz, rendered the same way
  const k = new OfflineAudioContext(1, len, rate)
  const src = k.createBufferSource()
  const b = k.createBuffer(1, len, rate)
  b.copyToChannel(out, 0)
  src.buffer = b
  const shelf = k.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = 1681
  shelf.gain.value = 4
  const hp = k.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 38
  src.connect(shelf).connect(hp).connect(k.destination)
  src.start()
  const kw = (await k.startRendering()).getChannelData(0)
  return { peak: db(peak), lufs: momentaryMax(kw, rate) }
}
