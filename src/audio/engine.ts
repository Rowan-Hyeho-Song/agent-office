// The office's audio graph (docs/design/sound.md 2). Same build as the desk room's rowansong.dev src/audio/audio.ts
// (compressor −18 dB 3:1 on the master, music and sfx buses, a shared echo); keep the levels in step with it.
//
//   cue ─┬─ sfx ────┐
//        ├─ voice ──┤
//   amb ─┴─ ambience┼─ room (crossfade) ─ master (visitor volume × mute) ─ compressor ─ out
//   spk ─── music ──┘
//
// The context is created only on a user gesture (or when the desk says we're entered, the iframe has
// allow="autoplay"): headless smoke must not see an AudioContext before that, and browsers block it anyway.

import { getSetting, subscribe } from './settings'
import { makeEcho } from './synth'

export type Bus = 'music' | 'sfx' | 'voice' | 'ambience' | 'keys'

/**
 * base bus gains (sound.md 2.2), set from the live output.
 * - #205: the room tone masked every cue at 0.1 → 0.009; music matched to the desk room (RMS −39).
 * - #194 louder (user, 2026-11-10: "거의 안 들려"): music and sfx/voice +6 dB. The room tone stays (it must not mask).
 * - #194 thock (user: "타이핑 소리는 살짝 작아져도. 너무 저 소리만 들린다"): typing has its own bus, 5 dB under sfx,
 *   through a compressor so five typists together don't add up (KEYS_GLUE).
 * The desk room: music 0.14, sfx 0.55.
 */
export const BUS_LEVEL: Record<Bus, number> = { music: 0.48, sfx: 1.1, voice: 1.0, ambience: 0.009, keys: 0.62 }

/** the keys bus glue: a firm compressor so the sum of many typists stays near one typist's level */
export const KEYS_GLUE = { threshold: -34, knee: 6, ratio: 8, attack: 0.002, release: 0.15 }
/**
 * Chrome adds its own make-up gain to a DynamicsCompressor: with KEYS_GLUE every signal under the threshold comes out
 * +16.7 dB (measured offline, a 300 Hz sine from −60 to −34 dBFS). Taken back right after it, so a single key passes at
 * its own level and only a pile of typists is squeezed.
 */
export const KEYS_GLUE_MAKEUP_DB = 16.7

/**
 * the default camera is 11–20 m from the room's corners (room.ts DEFAULT_CAMERA (8.5, 8, 9.5) → the far corner
 * (−4.5, 0, −3.5)), so anything in the room plays at full level from the default view and only pans left/right
 */
export const REF_DISTANCE = 20
export const MAX_DISTANCE = 45

/** most one-shot sfx sounding at once (sound.md 6) */
export const MAX_SFX = 6

type Graph = {
  ctx: AudioContext
  master: GainNode
  room: GainNode
  bus: Record<Bus, GainNode>
  echo: DelayNode
  analyser: AnalyserNode
}

let g: Graph | null = null
const readyListeners = new Set<(g: Graph) => void>()
const busLevel: Record<Bus, number> = { ...BUS_LEVEL }

export const audioGraph = () => g
/** run `fn` now if the graph exists, else when it's first built */
export function whenReady(fn: (g: Graph) => void) {
  if (g) fn(g)
  else readyListeners.add(fn)
}

const masterGain = () => {
  const s = getSetting()
  return s.muted ? 0 : s.volume
}

/** build (once) and resume the context. Call from a gesture, or on `entered` in room mode. */
export function ensureAudio(): Graph | null {
  if (!g) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    const ctx = new AC({ latencyHint: 'interactive' })
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    // a safety limiter after the glue compressor: nothing past −1 dBFS whatever piles up (#194 louder)
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.1
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    const master = ctx.createGain()
    master.gain.value = masterGain()
    master.connect(comp).connect(limiter).connect(ctx.destination)
    limiter.connect(analyser)
    const room = ctx.createGain()
    room.gain.value = 1
    room.connect(master)
    const bus = {} as Record<Bus, GainNode>
    for (const b of Object.keys(BUS_LEVEL) as Bus[]) {
      bus[b] = ctx.createGain()
      bus[b].gain.value = busLevel[b]
      if (b === 'keys') {
        const glue = ctx.createDynamicsCompressor()
        glue.threshold.value = KEYS_GLUE.threshold
        glue.knee.value = KEYS_GLUE.knee
        glue.ratio.value = KEYS_GLUE.ratio
        glue.attack.value = KEYS_GLUE.attack
        glue.release.value = KEYS_GLUE.release
        const trim = ctx.createGain()
        trim.gain.value = Math.pow(10, -KEYS_GLUE_MAKEUP_DB / 20)
        bus[b].connect(glue).connect(trim).connect(room)
      } else bus[b].connect(room)
    }
    const echo = makeEcho(ctx, bus.sfx)
    g = { ctx, master, room, bus, echo, analyser }
    document.addEventListener('visibilitychange', () => {
      if (!g) return
      if (document.hidden) void g.ctx.suspend()
      else void g.ctx.resume()
    })
    readyListeners.forEach((f) => f(g!))
    readyListeners.clear()
  }
  if (g.ctx.state === 'suspended' && !document.hidden) void g.ctx.resume()
  return g
}

// the visitor's setting: immediate, with a 10 ms ramp only to avoid a click (sound.md 2.4)
subscribe(() => {
  if (!g) return
  const t = g.ctx.currentTime
  g.master.gain.cancelScheduledValues(t)
  g.master.gain.setTargetAtTime(masterGain(), t, 0.01)
})

/** the whole office up or down (room crossfade, sound.md 2.3) */
export function fadeRoom(to: number, sec: number) {
  if (!g) return
  const p = g.room.gain
  const t = g.ctx.currentTime
  p.cancelScheduledValues(t)
  p.setValueAtTime(p.value, t)
  p.linearRampToValueAtTime(to, t + Math.max(0.01, sec))
}

/** a held duck per bus (music under a ping-pong rally, ③): the bus rests this many dB down until it's let go (0) */
const held: Record<Bus, number> = { music: 0, sfx: 0, voice: 0, ambience: 0, keys: 0 }
/** the deeper of a duck and the held one wins: they don't add up (speech −6 over ping-pong −4 = −6) */
export const duckDb = (db: number, heldDb: number) => Math.min(db, heldDb)
const ducked = (b: Bus, db = 0) => busLevel[b] * Math.pow(10, duckDb(db, held[b]) / 20)

/** a bus's base level (debug faders) */
export function setBusLevel(b: Bus, v: number) {
  busLevel[b] = v
  if (g) g.bus[b].gain.setTargetAtTime(ducked(b), g.ctx.currentTime, 0.02)
}
export const getBusLevel = (b: Bus) => busLevel[b]

/** duck a bus by `db` for a while (music under speech, sound.md 2.2); it comes back to the held level */
export function duck(b: Bus, db: number, down = 0.15, up = 0.6) {
  if (!g) return
  const p = g.bus[b].gain
  const t = g.ctx.currentTime
  p.cancelScheduledValues(t)
  p.setTargetAtTime(ducked(b, db), t, down / 3)
  p.setTargetAtTime(ducked(b), t + down + 0.4, up / 3)
}

/** hold a bus `db` down (0 = let go): down over `down` s, back up over `up` s */
export function holdDuck(b: Bus, db: number, down = 0.5, up = 1.5) {
  if (held[b] === db) return
  const deeper = db < held[b]
  held[b] = db
  if (!g) return
  const p = g.bus[b].gain
  const t = g.ctx.currentTime
  p.cancelScheduledValues(t)
  p.setTargetAtTime(ducked(b), t, (deeper ? down : up) / 3)
}
export const heldDuck = (b: Bus) => held[b]

// ─── 3D: the listener is the camera (sound.md 1, 6) ───

export type Vec = { x: number; y: number; z: number }

/** move the listener (called every frame from the canvas) */
export function setListener(pos: Vec, fwd: Vec, up: Vec) {
  if (!g) return
  const l = g.ctx.listener
  const t = g.ctx.currentTime
  if (l.positionX) {
    l.positionX.setTargetAtTime(pos.x, t, 0.02)
    l.positionY.setTargetAtTime(pos.y, t, 0.02)
    l.positionZ.setTargetAtTime(pos.z, t, 0.02)
    l.forwardX.setTargetAtTime(fwd.x, t, 0.02)
    l.forwardY.setTargetAtTime(fwd.y, t, 0.02)
    l.forwardZ.setTargetAtTime(fwd.z, t, 0.02)
    l.upX.setTargetAtTime(up.x, t, 0.02)
    l.upY.setTargetAtTime(up.y, t, 0.02)
    l.upZ.setTargetAtTime(up.z, t, 0.02)
  } else {
    // Firefox before 2023 / old Safari
    const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(...a: number[]): void }
    legacy.setPosition(pos.x, pos.y, pos.z)
    legacy.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z)
  }
}

/** a panner placed at `pos`, feeding `into`: inverse distance, ref 2 m, max 12 m, equal-power (no HRTF on phones) */
export function panner(c: BaseAudioContext, pos: Vec, into: AudioNode) {
  const p = c.createPanner()
  p.panningModel = 'equalpower'
  p.distanceModel = 'inverse'
  p.refDistance = REF_DISTANCE
  p.maxDistance = MAX_DISTANCE
  p.rolloffFactor = 1
  if (p.positionX) {
    p.positionX.value = pos.x
    p.positionY.value = pos.y
    p.positionZ.value = pos.z
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z)
  p.connect(into)
  return p
}

/** how loud a point sounds from the listener with the panner's law (0..1), to rank voices against the cap */
export function distanceGain(pos: Vec | undefined): number {
  if (!pos || !g) return 1
  const l = g.ctx.listener
  const lx = l.positionX?.value ?? 0
  const ly = l.positionY?.value ?? 0
  const lz = l.positionZ?.value ?? 0
  const d = Math.max(REF_DISTANCE, Math.min(MAX_DISTANCE, Math.hypot(pos.x - lx, pos.y - ly, pos.z - lz)))
  return REF_DISTANCE / d
}

/** debug meter: peak and RMS (dBFS) of the master output right now */
export function meter(): { peak: number; rms: number } | null {
  if (!g) return null
  const a = g.analyser
  const buf = new Float32Array(a.fftSize)
  a.getFloatTimeDomainData(buf)
  let peak = 0
  let sum = 0
  for (const v of buf) {
    const x = Math.abs(v)
    if (x > peak) peak = x
    sum += v * v
  }
  const db = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120)
  return { peak: db(peak), rms: db(Math.sqrt(sum / buf.length)) }
}

/** dev-only snapshot for scripts and the debug panel */
export function audioDebug() {
  const sink = (g?.ctx as (AudioContext & { sinkId?: string | { type: string } }) | undefined)?.sinkId
  return {
    ctx: g?.ctx.state ?? null,
    setting: getSetting(),
    room: g?.room.gain.value ?? null,
    /** '' = the system's default output (Chrome 110+); undefined where the browser doesn't say */
    sink: typeof sink === 'string' ? sink : sink ? sink.type : undefined,
  }
}

/** a plain 440 Hz tone for 0.8 s straight into the master (not through any bus), to tell "the page is silent" apart from
 *  "the tab or the output device is" (#194 audible fix) */
export function testTone() {
  const gr = ensureAudio()
  if (!gr) return
  const c = gr.ctx
  const t = c.currentTime + 0.02
  const o = c.createOscillator()
  o.frequency.value = 440
  const env = c.createGain()
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(0.18, t + 0.02)
  env.gain.setValueAtTime(0.18, t + 0.7)
  env.gain.linearRampToValueAtTime(0, t + 0.8)
  o.connect(env).connect(gr.master)
  o.start(t)
  o.stop(t + 0.85)
}
