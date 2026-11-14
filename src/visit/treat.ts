// /api/visit, minus the database (#4, office-ui.md 12.2): a visitor gives a robot a snack (☕ 🍪 🍎) or a cheer. The server
// checks again what the page already holds back: the kind and the robot, one snack and one cheer per robot per minute
// from the same visitor, and at most five shared to everyone in any 10 s (past that the sender sees it, nobody else).
//
// Nothing about the visitor is kept: the cooldown row is a keyed hash of the IP (the key is derived from the server key
// and changes every day), the robot and the time, and rows older than two minutes are deleted on every write. The
// shared event has the robot, the kind and the time only. Pure apart from the store, so it is unit tested.

export const SNACKS = ['coffee', 'cookie', 'apple'] as const
export const TREAT_KINDS = [...SNACKS, 'cheer'] as const
export type TreatKind = (typeof TREAT_KINDS)[number]
export const VISIT_AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'] as const

/** one snack and one cheer per robot per visitor this often */
export const PER_ROBOT_MS = 60_000
/** the whole room: past ROOM_MAX in ROOM_WINDOW_MS, the rest is not shared */
export const ROOM_WINDOW_MS = 10_000
export const ROOM_MAX = 5
/** cooldown rows live this long */
export const COOLDOWN_KEEP_MS = 120_000

export const groupOf = (kind: TreatKind): 'snack' | 'cheer' => (kind === 'cheer' ? 'cheer' : 'snack')
export const isTreatKind = (k: unknown): k is TreatKind => typeof k === 'string' && (TREAT_KINDS as readonly string[]).includes(k)
export const isVisitAgent = (a: unknown): a is (typeof VISIT_AGENTS)[number] => typeof a === 'string' && (VISIT_AGENTS as readonly string[]).includes(a)

export interface SharedEvent {
  id: number
  agent: string
  kind: TreatKind
  created_at: string
}

export interface VisitStore {
  /** the newest cooldown row of this hash and robot, ms since the epoch; null without one */
  lastCooldown(hash: string, agent: string): Promise<number | null>
  /** write a cooldown row and delete those older than `before` */
  putCooldown(hash: string, agent: string, at: Date, before: Date): Promise<void>
  /** how many events were shared since `since` */
  sharedSince(since: Date): Promise<number>
  /** share one: the stored row */
  share(agent: string, kind: TreatKind, at: Date): Promise<SharedEvent>
}

export interface VisitConfig {
  /** the server key: the daily hash key is derived from it, never sent anywhere */
  secret: string
  now?: () => Date
  /** after a shared event: the content-free "visitor_events changed" broadcast */
  signal?: () => Promise<unknown>
}

const enc = new TextEncoder()
async function hmac(key: string | Uint8Array<ArrayBuffer>, text: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)))
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/**
 * The cooldown key of a visitor: HMAC(day key, ip | group), the day key = HMAC(server key, "visit-cooldown|YYYY-MM-DD"). The
 * same visitor and group give the same hash during one UTC day only; the IP cannot be read back without the server key.
 */
export async function visitorHash(secret: string, ip: string, group: 'snack' | 'cheer', at: Date): Promise<string> {
  const day = await hmac(secret, `visit-cooldown|${at.toISOString().slice(0, 10)}`)
  return hex(await hmac(day, `${ip}|${group}`))
}

/** the visitor's address as the platform passes it (the first of x-forwarded-for), '' when none */
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * POST {agent, kind}. Answers:
 * - 200 {shared: true, event} — stored and signalled; every screen shows it
 * - 200 {shared: false} — over the room's limit: the sender shows it, nobody else
 * - 429 {retryS} — this visitor gave this robot one of these less than a minute ago
 * - 400 — not a robot or not a kind
 */
export async function handleVisit(req: Request, store: VisitStore, cfg: VisitConfig): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const { agent, kind } = (body ?? {}) as { agent?: unknown; kind?: unknown }
  if (!isVisitAgent(agent) || !isTreatKind(kind)) return json({ error: 'bad request' }, 400)
  const now = cfg.now?.() ?? new Date()
  const hash = await visitorHash(cfg.secret, clientIp(req), groupOf(kind), now)
  const last = await store.lastCooldown(hash, agent)
  if (last !== null && now.getTime() - last < PER_ROBOT_MS) return json({ retryS: Math.ceil((PER_ROBOT_MS - (now.getTime() - last)) / 1000) }, 429)
  await store.putCooldown(hash, agent, now, new Date(now.getTime() - COOLDOWN_KEEP_MS))
  if ((await store.sharedSince(new Date(now.getTime() - ROOM_WINDOW_MS))) >= ROOM_MAX) return json({ shared: false })
  const event = await store.share(agent, kind, now)
  await cfg.signal?.()
  return json({ shared: true, event })
}
