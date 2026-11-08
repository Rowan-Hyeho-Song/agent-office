// The visitor's sound setting, shared with the desk room (docs/design/sound.md 2.4): { muted, volume }.
// Stored under `rowansong.audio` (same origin as the desk in production, so both rooms read one value) and carried by
// the `audio` room message in dev, where the two rooms are on different ports. Pure parsing + a tiny store.

export type SoundSetting = { muted: boolean; volume: number }

export const STORAGE_KEY = 'rowansong.audio'
/** the first-visit "소리를 켜려면 누르세요" bubble, shown once (office only) */
export const HINT_KEY = 'agent-office.sound-hint'

/** standalone first visit: off until the visitor turns it on (결재 1) */
export const DEFAULT_SETTING: SoundSetting = { muted: true, volume: 0.8 }

export const clampVolume = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SETTING.volume)

/** a setting from untrusted data (storage, a message): only the two known fields, volume clamped, else null */
export function parseSetting(data: unknown): SoundSetting | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.muted !== 'boolean' || typeof d.volume !== 'number' || !Number.isFinite(d.volume)) return null
  return { muted: d.muted, volume: clampVolume(d.volume) }
}

function load(): SoundSetting | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseSetting(JSON.parse(raw)) : null
  } catch {
    return null // private mode, blocked storage, bad JSON
  }
}

function save(s: SoundSetting) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
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

/** change it here (HUD button, debug panel): saved, and sent to the desk by whoever listens for 'local' */
export function setSetting(patch: Partial<SoundSetting>, from: 'local' | 'desk' = 'local') {
  const next = { muted: patch.muted ?? current.muted, volume: clampVolume(patch.volume ?? current.volume) }
  known = true
  if (next.muted === current.muted && next.volume === current.volume) return
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
