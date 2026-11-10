// The visitor's sound setting, shared with the desk room (docs/design/sound.md 2.4): { muted, volume, music, sfx }.
// Stored under `rowansong.audio` (same origin as the desk in production, so both rooms read one value) and carried by
// the `audio` room message in dev, where the two rooms are on different ports. Pure parsing + a tiny store.
//
// #353 (the turntable's settings panel): `music` and `sfx` are the two category levels, 0..1 on top of `volume`
// (1 = today's mix). A value stored before #353 has only { muted, volume }: it reads as music 1, sfx 1. Saving merges
// into what is stored, so neither room wipes a field the other wrote.

export type SoundSetting = { muted: boolean; volume: number; music: number; sfx: number }

export const STORAGE_KEY = 'rowansong.audio'
/** the first-visit "소리를 켜려면 누르세요" bubble, shown once (office only) */
export const HINT_KEY = 'agent-office.sound-hint'

/** standalone first visit: off until the visitor turns it on (결재 1) */
export const DEFAULT_SETTING: SoundSetting = { muted: true, volume: 1, music: 1, sfx: 1 } // 1 = the mix as designed

export const clampVolume = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SETTING.volume)
/** an optional level: a finite number clamped to 0..1, anything else (missing, an older value) 1 */
export const clampLevel = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

/** a setting from untrusted data (storage, a message): muted + volume required, music / sfx optional (1), else null */
export function parseSetting(data: unknown): SoundSetting | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.muted !== 'boolean' || typeof d.volume !== 'number' || !Number.isFinite(d.volume)) return null
  return { muted: d.muted, volume: clampVolume(d.volume), music: clampLevel(d.music), sfx: clampLevel(d.sfx) }
}

/** what to store: the stored object with our four fields written over it, any other field kept (pure, tested) */
export function mergeStored(stored: unknown, s: SoundSetting): Record<string, unknown> {
  const base = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  return { ...base, muted: s.muted, volume: s.volume, music: s.music, sfx: s.sfx }
}

function readRaw(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null // private mode, blocked storage, bad JSON
  }
}

const load = (): SoundSetting | null => parseSetting(readRaw())

function save(s: SoundSetting) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeStored(readRaw(), s)))
  } catch {
    /* private mode: the setting still holds for this page */
  }
}

let current: SoundSetting = load() ?? DEFAULT_SETTING
/** true once the visitor (or the desk) has set it: a stored value counts */
let known = load() !== null
const listeners = new Set<(s: SoundSetting, from: 'local' | 'desk') => void>()

export const getSetting = () => current
export const isKnown = () => known

export function subscribe(fn: (s: SoundSetting, from: 'local' | 'desk') => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** the next setting from a patch: fields not in the patch stay, levels clamped (pure, tested) */
export function applyPatch(cur: SoundSetting, patch: Partial<SoundSetting>): SoundSetting {
  return {
    muted: patch.muted ?? cur.muted,
    volume: clampVolume(patch.volume ?? cur.volume),
    music: patch.music === undefined ? cur.music : clampLevel(patch.music),
    sfx: patch.sfx === undefined ? cur.sfx : clampLevel(patch.sfx),
  }
}

/** #353 the panel's '기본값으로': the three levels back to the designed mix; `muted` is left as it is (designer) */
export const DEFAULT_LEVELS = { volume: DEFAULT_SETTING.volume, music: DEFAULT_SETTING.music, sfx: DEFAULT_SETTING.sfx } as const
export const resetLevels = () => setSetting({ ...DEFAULT_LEVELS })

/** change it here (HUD button, settings panel, debug panel): saved, and sent to the desk by whoever listens for 'local' */
export function setSetting(patch: Partial<SoundSetting>, from: 'local' | 'desk' = 'local') {
  const next = applyPatch(current, patch)
  known = true
  if (next.muted === current.muted && next.volume === current.volume && next.music === current.music && next.sfx === current.sfx) return
  current = next
  save(next)
  listeners.forEach((f) => f(next, from))
}

export function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true // can't remember it: don't nag on every visit
  }
}

export function markHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* ignore */
  }
}
