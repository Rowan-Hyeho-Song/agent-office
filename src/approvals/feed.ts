// /api/approvals, minus the database (#25): the approval hook on the PC asks "anything decided for my seat
// since …?". It uses the same token as the signal hook (OFFICE_HOOK_TOKEN), and gets only decided approvals
// that the owner both asked for (🖊) and answered (✅): /api/docs and /api/approve never store anyone else's.

import { sameToken } from '../docs/ingest'
import type { StoredApproval } from './types'

export interface FeedStore {
  decidedFor(seat: number, since: string, limit: number): Promise<StoredApproval[]>
}

export interface FeedItem {
  repo: string
  folder: number
  kind: string
  content: string
  result: string
  /** the chosen option's text for a 선택지 N */
  chosen: string | null
  opinion: string | null
  result_url: string | null
  decided_at: string
}

const LIMIT = 10

export function toFeedItem(a: StoredApproval): FeedItem {
  return {
    repo: a.repo,
    folder: a.folder,
    kind: a.kind,
    content: a.content,
    result: a.result ?? '',
    chosen: a.option && a.options[a.option - 1] ? a.options[a.option - 1] : null,
    opinion: a.opinion,
    result_url: a.result_url,
    decided_at: a.decided_at ?? '',
  }
}

export async function handle(request: Request, store: FeedStore, token: string): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const auth = request.headers.get('authorization') ?? ''
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), token)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(request.url).searchParams
  const seat = Number(q.get('seat'))
  const since = q.get('since') ?? ''
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) return Response.json({ error: 'bad seat' }, { status: 400 })
  if (Number.isNaN(Date.parse(since))) return Response.json({ error: 'bad since' }, { status: 400 })
  const rows = await store.decidedFor(seat, new Date(since).toISOString(), LIMIT)
  return Response.json({ approvals: rows.map(toFeedItem) })
}
