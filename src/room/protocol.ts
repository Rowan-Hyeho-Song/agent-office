// The room message contract with the desk page (rowansong.dev). Same table as docs/plan.md 2.1 and the desk's
// docs/post-access-plan.md section 9. Pure functions only: the window wiring lives in link.ts.

export const NS = 'rowansong.room'
export const VERSION = 1

/** office -> desk. `audio`: the visitor changed the sound setting in the office (docs/design/sound.md 2.4) */
export type OfficeMessage =
  | { type: 'ready'; room: 'office' }
  | { type: 'exit'; room: 'office'; via: 'door' | 'esc' }
  | { type: 'audio'; room: 'office'; muted: boolean; volume: number }
/** desk -> office (`audio` is read by parseDeskAudio) */
export type DeskMessageType = 'entered' | 'leaving'
/** the shared sound setting, desk -> office: on `entered` and whenever it changes */
export type DeskAudio = { muted: boolean; volume: number }

/** the desk site's origins: its deployment today, and the custom domain once it's attached (either may embed the office) */
export const DEFAULT_PARENT_ORIGINS = 'https://rowansong-dev.vercel.app,https://rowansong.dev'
/** where the standalone "← 책상으로" goes: the desk site that is live now */
export const DEFAULT_DESK_URL = 'https://rowansong-dev.vercel.app/'

const originOf = (url: string) => {
  try {
    const o = new URL(url).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/** own origin + the comma-separated env list (default: the production desk); invalid entries are dropped */
export function allowedOrigins(own: string, env: string | undefined): string[] {
  const list = (env?.trim() ? env : DEFAULT_PARENT_ORIGINS).split(',').map((s) => originOf(s.trim()))
  return [...new Set([own, ...list].filter((o): o is string => !!o))]
}

/** the parent's origin to post to: ancestorOrigins[0], else the referrer's, and only when allow-listed */
export function parentOrigin(ancestor: string | undefined, referrer: string, allowed: string[]): string | null {
  const o = ancestor ? originOf(ancestor) : originOf(referrer)
  return o && allowed.includes(o) ? o : null
}

export const envelope = <T extends OfficeMessage>(m: T) => ({ ns: NS, v: VERSION, ...m })

export type Incoming = { source: unknown; origin: string; data: unknown }

/** the message's fields when it is exactly our envelope from the allow-listed parent window, else null */
function fromDesk(ev: Incoming, parent: unknown, allowed: string[]): Record<string, unknown> | null {
  if (!parent || ev.source !== parent) return null
  if (!allowed.includes(ev.origin)) return null
  const d = ev.data
  if (typeof d !== 'object' || d === null) return null
  const m = d as Record<string, unknown>
  if (m.ns !== NS || m.v !== VERSION) return null
  return m
}

/** a desk message to act on, or null for anything that is not exactly the contract from the parent window */
export function parseDeskMessage(ev: Incoming, parent: unknown, allowed: string[]): DeskMessageType | null {
  const m = fromDesk(ev, parent, allowed)
  if (!m) return null
  return m.type === 'entered' || m.type === 'leaving' ? m.type : null
}

/** the desk's sound setting: only `muted` (boolean) and `volume` (number, clamped 0–1); other fields are dropped */
export function parseDeskAudio(ev: Incoming, parent: unknown, allowed: string[]): DeskAudio | null {
  const m = fromDesk(ev, parent, allowed)
  if (!m || m.type !== 'audio') return null
  if (typeof m.muted !== 'boolean' || typeof m.volume !== 'number' || !Number.isFinite(m.volume)) return null
  return { muted: m.muted, volume: Math.min(1, Math.max(0, m.volume)) }
}
