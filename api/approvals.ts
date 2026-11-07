import { handle } from '../src/approvals/feed.js'
import type { StoredApproval } from '../src/approvals/types.js'
import { supabaseServer } from '../src/server/supabase.js'

// Decided approvals for one seat, for the approval hook (hooks/approval-hook.mjs, #25).
// Environment: SUPABASE_URL, SUPABASE_SECRET_KEY, OFFICE_HOOK_TOKEN (the same token as /api/events).

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const token = process.env.OFFICE_HOOK_TOKEN ?? ''

export async function GET(request: Request) {
  if (!url || !key || !token) return Response.json({ error: 'not configured' }, { status: 503 })
  const db = supabaseServer(url, key)
  try {
    return await handle(
      request,
      {
        decidedFor: (seat, since, limit) =>
          db.rest<StoredApproval[]>(
            `approvals?select=*&status=eq.decided&requester_seat=eq.${seat}&decided_at=gt.${encodeURIComponent(since)}&order=decided_at.asc&limit=${limit}`,
          ),
      },
      token,
    )
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'failed' }, { status: 502 })
  }
}
