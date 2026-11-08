// /api/timeline, minus the database (#81, plan.md 6.7): check the Action's token and payload, then turn each
// collected point into a stored one: author check, tier, title filter. Pure apart from the store, so it's unit tested.

import { sameToken } from '../docs/ingest.js'
import { parsePointInput, toPoint, type PointConfig } from './points.js'
import type { Point, PointInput } from './types.js'

export interface TimelineStore {
  /** insert or update by key: a point sent twice stays one */
  upsert(rows: Point[]): Promise<void>
}

export interface IngestConfig extends PointConfig {
  token: string
}

export interface Payload {
  points: PointInput[]
}

const MAX_POINTS = 100

export async function handle(request: Request, store: TimelineStore, cfg: IngestConfig): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const auth = request.headers.get('authorization') ?? ''
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), cfg.token)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const p = body as Partial<Payload> | null
  if (!p || !Array.isArray(p.points) || p.points.length > MAX_POINTS) return Response.json({ error: 'bad payload' }, { status: 400 })
  const parsed = p.points.map(parsePointInput)
  const bad = parsed.findIndex((x) => !x)
  if (bad >= 0) return Response.json({ error: `bad point ${bad}` }, { status: 400 })
  // strangers' and private repos' points are skipped, not refused: one bad point must not stop a backfill batch
  const rows = (parsed as PointInput[]).map((x) => toPoint(x, cfg)).filter((x): x is Point => x !== null)
  // one key twice in a batch would make the upsert fail: the later one wins
  const unique = [...new Map(rows.map((r) => [r.key, r])).values()]
  if (unique.length) await store.upsert(unique)
  return Response.json({ ok: true, stored: unique.length, skipped: parsed.length - unique.length })
}
