// ③ ECHO's speakers (docs/design/sound.md 5, #194 memo on #249's nodes): the office music comes out of the pair of
// near-field speakers on ECHO's desk, follows the agents (break / work / night off), dips under a ping-pong rally, and
// the visitor can switch it off for themselves. The 3D side (echoLive.ts, coder) reads the values below every frame and
// moves the nodes: the sound owns the values, the coder owns the nodes.
//
//   music out ─ forMe (visitor on/off) ─┬─ ½ ─ panner at desk_4_spk_l ─┬─ music bus
//                                       ├─ ½ ─ panner at desk_4_spk_r ─┘
//                                       └─ analyser (before the panners: the meters don't care where the camera is)

import type { Object3D } from 'three'
import { Vector3 } from 'three'
import { audioGraph, holdDuck, REF_DISTANCE, MAX_DISTANCE, whenReady } from './engine'
import { currentLayers, getMusicState, routeMusic, setMusicState, WORK_DB, type Layer, type MusicState } from './music'
import { getSetting } from './settings'

// ─── pure rules (tested) ───

/** two or more agents on a break (play · coffee · sofa) = break music (sound.md 5) */
export const BREAK_AT = 2
/** a new state must hold this long (scene seconds) before the music follows: one agent fetching a coffee doesn't flip it */
export const HOLD_S = 8
/** the music under a ping-pong rally */
export const PINGPONG_DUCK_DB = -4

export function wantedState(resting: number, night: boolean): MusicState {
  if (night) return 'off'
  return resting >= BREAK_AT ? 'break' : 'work'
}

export type Hold = { state: MusicState; want: MusicState; since: number }
/** follow `want` only once it has held HOLD_S (a jump back in time, a scrub, starts the wait again) */
export function holdState(h: Hold | null, want: MusicState, t: number, hold = HOLD_S): Hold {
  if (!h) return { state: want, want, since: t }
  if (want === h.state) return { state: h.state, want, since: t }
  if (want !== h.want || t < h.since) return { state: h.state, want, since: t }
  return t - h.since >= hold ? { state: want, want, since: t } : h
}

/** the 8-cell meter: RMS −48 → −12 dBFS in 4.5 dB steps */
export const METER_FLOOR_DB = -48
export const METER_STEP_DB = 4.5
export const METER_CELLS = 8
export const rawCells = (rmsDb: number) => Math.max(0, Math.min(METER_CELLS, Math.ceil((rmsDb - METER_FLOOR_DB) / METER_STEP_DB)))

/** LED-meter ballistics: up at once, held 0.3 s, then down one cell every 0.08 s */
export const PEAK_HOLD_S = 0.3
export const FALL_S = 0.08
/** `next` = when the next cell may drop */
export type Meter = { cells: number; next: number }
export function meterStep(m: Meter, raw: number, t: number): Meter {
  if (raw >= m.cells) return { cells: raw, next: t + PEAK_HOLD_S }
  if (t < m.next) return m
  const drop = 1 + Math.floor((t - m.next) / FALL_S)
  return { cells: Math.max(raw, m.cells - drop), next: m.next + drop * FALL_S }
}

/** the woofer: the level under 150 Hz, −40 → −10 dB = 0 → 1 (the kick on 1 and 3 kicks it) */
export const coneFromLow = (lowDb: number) => Math.max(0, Math.min(1, (lowDb + 40) / 30))

/** ECHO's grille ring: 0 → 0.3 with the music's RMS (added to the coder's breathing) */
export const glowFromRms = (rmsDb: number) => 0.3 * Math.max(0, Math.min(1, (rmsDb - METER_FLOOR_DB) / (METER_CELLS * METER_STEP_DB)))

/** the mixer's four channels: hook · piano (keys + pad) · bass · drums (kick · shaker · rim), each layer's weight */
export const FADERS: readonly (readonly [Layer, number][])[] = [
  [['hook', 1]],
  [['keys', 0.75], ['pad', 0.25]],
  [['bass', 1]],
  [['kick', 0.4], ['shaker', 0.35], ['rim', 0.25]],
]
/** where a fader sits for a level: 0 dB → 0.8 of the slot (headroom above), −12 dB → 0.5, linear in dB, off → 0 */
export const faderAt = (db: number) => Math.max(0, Math.min(1, 0.8 + db * 0.025))
export function faderTargets(state: MusicState, layers: readonly Layer[], forMe: boolean): [number, number, number, number] {
  const on = new Set(layers)
  const lvl = !forMe || state === 'off' ? 0 : faderAt(state === 'work' ? WORK_DB : 0)
  return FADERS.map((ch) => lvl * ch.reduce((s, [l, w]) => s + (on.has(l) ? w : 0), 0)) as [number, number, number, number]
}

/** how a speaker sounds with distance (sound.md 6, to be judged on #194):
 *  - 'room': like every other cue, the whole room at full level from the default view, left/right only (the default)
 *  - 'near': quieter far away, louder close up; the same level at the default view (16 m), at most +4 dB nearer */
export type MusicDist = 'room' | 'near'
export const DEFAULT_VIEW_M = 16.1 // room.ts DEFAULT_CAMERA (8.5, 8, 9.5) → the speakers (−2.32, 0.82, ±0.4)
export const NEAR_GAIN_DB = 4
export function distParams(d: MusicDist): { ref: number; trim: number } {
  if (d === 'room') return { ref: REF_DISTANCE, trim: 1 }
  const trim = Math.pow(10, NEAR_GAIN_DB / 20)
  return { ref: DEFAULT_VIEW_M / trim, trim } // ref / d × trim = 1 at the default view; ≤ ref → trim (+4 dB)
}

export type Toggle = 'on' | 'off' | 'muted'
export const hoverLabel = (forMe: boolean, night: boolean) => (night ? '밤에는 음악을 쉬어요' : forMe ? '음악 끄기 (나에게만)' : '음악 켜기')

// ─── runtime ───

type Chain = { forMe: GainNode; split: GainNode[]; pans: PannerNode[]; trim: GainNode; analyser: AnalyserNode; time: Float32Array<ArrayBuffer>; freq: Float32Array<ArrayBuffer> }
let chain: Chain | null = null
let nodes: [Object3D, Object3D] | null = null
let forMe = true
let night = false
let dist: MusicDist = 'room'
let force: MusicState | null = null
let hold: Hold | null = null
let meterS: Meter = { cells: 0, next: 0 }
const out = { cells: 0, cone: 0, on: false, glow: 0, faders: [0, 0, 0, 0] as [number, number, number, number] }
const pos = new Vector3()
let lastT = 0

/** the speakers' nodes (echoLive calls this once): the music follows them, nothing is hard-coded */
export function setSpeakerNodes(l: Object3D, r: Object3D) {
  nodes = [l, r]
}

function build(g: NonNullable<ReturnType<typeof audioGraph>>): AudioNode {
  if (chain) return chain.forMe
  const c = g.ctx
  const forMeG = c.createGain()
  forMeG.gain.value = forMe ? 1 : 0
  const { ref, trim: tr } = distParams(dist)
  const trim = c.createGain()
  // each panner gets half, ×√2 back for the equal-power pan law (a centred panner is −3 dB per channel)
  trim.gain.value = tr * Math.SQRT2
  trim.connect(g.bus.music)
  const split: GainNode[] = []
  const pans: PannerNode[] = []
  for (let i = 0; i < 2; i++) {
    const half = c.createGain()
    half.gain.value = 0.5
    const p = c.createPanner()
    p.panningModel = 'equalpower'
    p.distanceModel = 'inverse'
    p.refDistance = ref
    p.maxDistance = MAX_DISTANCE
    p.rolloffFactor = 1
    // until the nodes are known: where #249 puts them
    const z = i === 0 ? 0.389 : -0.409
    if (p.positionX) {
      p.positionX.value = -2.322
      p.positionY.value = 0.819
      p.positionZ.value = z
    }
    forMeG.connect(half).connect(p).connect(trim)
    split.push(half)
    pans.push(p)
  }
  const analyser = c.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.5
  forMeG.connect(analyser)
  chain = { forMe: forMeG, split, pans, trim, analyser, time: new Float32Array(analyser.fftSize), freq: new Float32Array(analyser.frequencyBinCount) }
  return forMeG
}
routeMusic(build)

/** debug: how the music falls off with distance (sound.md 6, judged on #194) */
export function setMusicDist(d: MusicDist) {
  dist = d
  if (!chain) return
  const { ref, trim } = distParams(d)
  chain.pans.forEach((p) => (p.refDistance = ref))
  const g = audioGraph()
  if (g) chain.trim.gain.setTargetAtTime(trim * Math.SQRT2, g.ctx.currentTime, 0.05)
}
export const getMusicDist = () => dist

/** debug: play this state whatever the agents do (null = follow them again) */
export function forceMusic(s: MusicState | null) {
  force = s
  if (s) setMusicState(s)
  else if (hold) setMusicState(hold.state)
}
export const forcedMusic = () => force

const silent = () => {
  const s = getSetting()
  const g = audioGraph()
  return s.muted || s.volume <= 0.001 || !g || g.ctx.state !== 'running' || document.hidden || g.room.gain.value < 0.01
}

/**
 * once a frame (SoundListener): `resting` = visible agents on a break, `playing` = one is at the ping-pong table,
 * `isNight` = 23–09 KST, `sceneS` = the office clock in seconds (the replay's too)
 */
export function speakerFrame(resting: number, playing: boolean, isNight: boolean, sceneS: number) {
  night = isNight
  hold = holdState(hold, wantedState(resting, isNight), sceneS)
  const want = force ?? hold.state
  if (want !== getMusicState()) setMusicState(want)
  holdDuck('music', playing ? PINGPONG_DUCK_DB : 0)

  const g = audioGraph()
  const now = performance.now() / 1000
  const dt = Math.min(0.1, Math.max(0, now - lastT))
  lastT = now
  if (chain && g && nodes) {
    const t = g.ctx.currentTime
    chain.pans.forEach((p, i) => {
      nodes![i].getWorldPosition(pos)
      if (p.positionX) {
        p.positionX.setTargetAtTime(pos.x, t, 0.05)
        p.positionY.setTargetAtTime(pos.y, t, 0.05)
        p.positionZ.setTargetAtTime(pos.z, t, 0.05)
      }
    })
  }

  const quiet = silent()
  let rmsDb = -120
  let lowDb = -120
  if (chain && g && !quiet) {
    const a = chain.analyser
    a.getFloatTimeDomainData(chain.time)
    let sum = 0
    for (const v of chain.time) sum += v * v
    rmsDb = 10 * Math.log10(sum / chain.time.length + 1e-12)
    a.getFloatFrequencyData(chain.freq)
    const hz = g.ctx.sampleRate / a.fftSize
    let e = 0
    for (let k = 1; k * hz <= 150; k++) e += Math.pow(10, chain.freq[k] / 10)
    lowDb = 10 * Math.log10(e + 1e-12)
  }
  meterS = meterStep(meterS, quiet ? 0 : rawCells(rmsDb), now)
  out.cells = meterS.cells
  out.cone = quiet ? 0 : coneFromLow(lowDb)
  out.glow = quiet ? 0 : glowFromRms(rmsDb)
  out.on = !quiet && forMe && getMusicState() !== 'off'
  const target = faderTargets(getMusicState(), currentLayers(), forMe)
  const k = 1 - Math.exp(-dt / (0.4 / 3)) // slides over ~0.4 s
  out.faders = out.faders.map((v, i) => v + (target[i] - v) * k) as typeof out.faders
}

// ─── what echoLive reads (agreed with the coder, #193 2/2) ───

/** 0..8: meter cells to light, front cell first */
export const speakerCells = () => out.cells
/** 0..1: the woofer cones' push (× travel 3 mm) */
export const speakerCone = () => out.cone
/** the speakers' LED: the music is on for this visitor and actually sounding */
export const speakerOn = () => out.on
/** 0..1 each: hook · piano · bass · drums */
export const faderLevels = (): readonly [number, number, number, number] => out.faders
/** 0..0.3: added to ECHO's grille-ring breathing */
export const musicGlow = () => out.glow
export const speakerHoverLabel = () => hoverLabel(forMe, night)

/** a click on a speaker: the music on/off for this visitor only (not saved). Muted: the HUD button blinks instead. */
export function toggleSpeakerForMe(): Toggle {
  const s = getSetting()
  if (s.muted || s.volume <= 0.001) {
    window.dispatchEvent(new Event('office-sound-flash')) // SoundButton's flashSoundButton, without importing the component
    return 'muted'
  }
  forMe = !forMe
  whenReady((g) => {
    if (!chain) return
    chain.forMe.gain.setTargetAtTime(forMe ? 1 : 0, g.ctx.currentTime, 0.4 / 3)
  })
  return forMe ? 'on' : 'off'
}
export const speakerForMe = () => forMe
