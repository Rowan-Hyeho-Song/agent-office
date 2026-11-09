// What echo's body and desk show about the sound (#193, agents.md 2.11, desks.md 4 / sound.md 5): the loudness of the room as the
// visitor hears it, whether they hear it at all, and their volume. All of it is the visitor's own browser state (the AnalyserNode on
// the master, the sound setting); nothing leaves the page. Read once per frame and shared by the rig (fork, grille light) and the
// desk (speaker cones, level meter, faders, LED).

import { BUS_LEVEL, getBusLevel, meter } from '../audio/engine'
import { getSetting } from '../audio/settings'

export interface RoomSound {
  /** the visitor has sound switched on (the speaker LED) */
  on: boolean
  /** the visitor has sound on and the page's audio is running */
  audible: boolean
  /** master RMS as 0..1 (−60 dBFS → 0, −18 dBFS → 1), eased so a cone or meter does not flicker; 0 while not audible */
  level: number
  /** the four mixer faders 0..1: music, effects, ambience, master volume (0 while muted) */
  faders: readonly [number, number, number, number]
}

const SILENT: RoomSound = { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] }
const FLOOR_DB = -60
const TOP_DB = -18

// "off for me" (sound.md 5): the visitor switched the speakers off for this page only; the office keeps playing for everybody else
let offForMe = false

let last = -1
let cached: RoomSound = SILENT
let eased = 0

/** the sound state at `t` (s, any monotonic clock); a second call in the same frame returns the first's answer */
export function roomSound(t: number, dt: number): RoomSound {
  if (t === last) return cached
  last = t
  try {
    const set = getSetting()
    const m = set.muted ? null : meter()
    if (set.muted || offForMe) {
      eased = 0
      cached = SILENT
      return cached
    }
    const bus = (b: 'music' | 'sfx' | 'ambience') => Math.min(1, Math.max(0, getBusLevel(b) / BUS_LEVEL[b])) * set.volume
    const raw = m ? Math.min(1, Math.max(0, (m.rms - FLOOR_DB) / (TOP_DB - FLOOR_DB))) : 0
    // quick up, slower down
    eased += (raw - eased) * (1 - Math.exp(-(raw > eased ? 30 : 8) * Math.max(dt, 0)))
    cached = { on: true, audible: m !== null, level: eased, faders: [bus('music'), bus('sfx'), bus('ambience'), set.volume] }
  } catch {
    cached = SILENT
  }
  return cached
}

// ---- the speaker adapter ------------------------------------------------------------------------------------------------------
// TODO(#194 ③): these have the shape of src/audio/speaker.ts (the sound engineer's PR, feature/194-speaker); when it is in dev, replace the
// bodies by imports of the same names. The desk and the rig only call these.

/** meter cells lit, 0..8 from the front */
export const speakerCells = () => Math.round(Math.min(1, Math.max(0, cached.level)) * 8)
/** woofer cone travel, 0..1 */
export const speakerCone = () => cached.level
/** the speaker LED */
export const speakerOn = () => cached.on
/** the four faders [hook, piano, bass, drums], 0..1 (here the visitor's four volumes until the layers exist) */
export const faderLevels = (): readonly [number, number, number, number] => cached.faders
/** extra brightness of echo's grille ring from the music, 0..0.3 */
export const musicGlow = () => (cached.audible ? 0.3 * cached.level : 0)
/** a click on the speaker: switch it off / on for this visitor only, or 'muted' when the page's sound is off (nothing starts then) */
export function toggleSpeakerForMe(): 'on' | 'off' | 'muted' {
  if (getSetting().muted) return 'muted'
  offForMe = !offForMe
  return offForMe ? 'off' : 'on'
}
export const speakerHoverLabel = () => (getSetting().muted ? '소리가 꺼져 있어요' : offForMe ? '스피커 켜기' : '스피커 끄기')
/** where the two speakers are, for the panning of the music (the engine's side) */
export function setSpeakerNodes(_l: unknown, _r: unknown) {
  /* TODO(#194 ③): forwarded to speaker.ts */
}
