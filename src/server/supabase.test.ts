import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabaseServer } from './supabase'

// PostgREST's answers as fetch really returns them (#162): a write with `prefer: return=minimal` can come back as an
// empty 200, 201 or 204; a read is a JSON array. The old events helper trusted the status code and parsed an empty
// 200 as JSON, so every hook signal failed in production while the fake-store tests passed.
const reply = (status: number, body: string | null) => () => Promise.resolve(new Response(body, { status }))

afterEach(() => vi.unstubAllGlobals())

describe('supabaseServer().rest', () => {
  const db = supabaseServer('https://example.supabase.co', 'sb_secret_test')

  it.each([
    ['200, empty (upsert with return=minimal)', 200, ''],
    ['201, empty', 201, ''],
    ['204, no body', 204, null],
  ])('%s → null', async (_name, status, body) => {
    vi.stubGlobal('fetch', vi.fn(reply(status, body)))
    await expect(db.rest('agent_status?on_conflict=seat', { method: 'POST' })).resolves.toBeNull()
  })

  it('200 with JSON → the parsed rows', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(200, '[{"seat":0,"state":"idle"}]')))
    await expect(db.rest('agent_status?select=*')).resolves.toEqual([{ seat: 0, state: 'idle' }])
  })

  it('an error status throws with the server text', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(409, '{"message":"conflict"}')))
    await expect(db.rest('agent_events', { method: 'POST' })).rejects.toThrow('supabase 409: {"message":"conflict"}')
  })
})

describe('api/events with PostgREST answering empty 200s (#162)', () => {
  it('a hook signal is stored (2xx), not 502 "store failed"', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test')
    vi.stubEnv('OFFICE_HOOK_TOKEN', 'tok-123')
    // reads get JSON, every write an empty 200 (what production returned)
    const fetch = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(new Response(init?.method === 'POST' || init?.method === 'DELETE' ? '' : '[]', { status: 200 })))
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    // a path the type checker does not follow: api/ is Node code (tsconfig.node.json), this test lives with the app's types
    const handler = '../../api/events'
    const { POST } = (await import(/* @vite-ignore */ handler)) as { POST: (r: Request) => Promise<Response> }
    const res = await POST(
      new Request('http://x/api/events', { method: 'POST', headers: { authorization: 'Bearer tok-123' }, body: JSON.stringify({ seat: 0, kind: 'start' }) }),
    )
    expect(res.status).toBeLessThan(300)
    expect(fetch.mock.calls.some(([u, i]) => String(u).includes('agent_status?on_conflict=seat') && i?.method === 'POST')).toBe(true)
    vi.unstubAllEnvs()
  })
})
