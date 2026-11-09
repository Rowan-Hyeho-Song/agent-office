import { handle } from '../src/approvals/approve.js'
import type { StoredApproval } from '../src/approvals/types.js'
import { signals } from '../src/server/signal.js'
import { supabaseServer } from '../src/server/supabase.js'

// The owner's decision from the office's approval box (#25). See src/approvals/approve.ts.
//
// Environment (docs/deploy.md):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)   as for /api/docs
//   OFFICE_OWNER_GITHUB_ID     the owner's numeric GitHub user id (`gh api user --jq .id`)
//   GITHUB_ISSUES_TOKEN        fine-grained token: this repository only, Issues read & write, nothing else.
//                              It posts the ✅ comment as the owner, so /api/docs files it like any owner's ✅.

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const owner = process.env.OFFICE_OWNER_GITHUB_ID ?? ''
const ghToken = process.env.GITHUB_ISSUES_TOKEN

async function comment(repo: string, folder: number, body: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${folder}/comments`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${ghToken}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { html_url: string }).html_url
}

export async function POST(request: Request) {
  if (!url || !key || !owner || !ghToken) return Response.json({ error: 'not configured' }, { status: 503 })
  const db = supabaseServer(url, key)
  const sig = signals(url, key) // #240 one content-free signal once the decision is stored
  try {
    return await handle(request, {
      githubIdOf: db.githubIdOf,
      ownerGithubId: owner,
      approval: async (id) => (await db.rest<StoredApproval[]>(`approvals?id=eq.${id}&select=*`))[0] ?? null,
      // one conditional update: pending (or a deciding left behind by a crashed call over 2 minutes ago) → deciding;
      // the row comes back only to the call that changed it
      lock: async (id) => {
        const stale = new Date(Date.now() - 2 * 60_000).toISOString()
        const rows = await db.rest<unknown[]>(
          `approvals?id=eq.${id}&or=(status.eq.pending,and(status.eq.deciding,updated_at.lt.${encodeURIComponent(stale)}))`,
          {
            method: 'PATCH',
            headers: { prefer: 'return=representation' },
            body: JSON.stringify({ status: 'deciding', updated_at: new Date().toISOString() }),
          },
        )
        return Array.isArray(rows) && rows.length === 1
      },
      unlock: async (id) => {
        await db.rest(`approvals?id=eq.${id}&status=eq.deciding`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
        })
      },
      comment,
      decide: sig.after('approvals', async (id, d) => {
        await db.rest(`approvals?id=eq.${id}&status=eq.deciding`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'decided', ...d, updated_at: d.decided_at }),
        })
      }),
    })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'failed' }, { status: 502 })
  } finally {
    await sig.flush()
  }
}
