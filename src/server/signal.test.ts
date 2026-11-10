import { afterEach, describe, expect, it, vi } from 'vitest'
import { handle, type DocStore, type IngestConfig } from '../docs/ingest'
import { SIGNAL_EVENT, SIGNAL_TOPIC, broadcastSignal, signalPayload, signals } from './signal'

afterEach(() => vi.restoreAllMocks())

const ok = (_url?: string, _init?: RequestInit) => Promise.resolve(new Response(null, { status: 202 }))
const URL_ = 'https://example.supabase.co'

describe('signalPayload', () => {
  it('is the table and the time, nothing else', () => {
    const p = signalPayload('approvals', new Date('2026-11-10T01:02:03Z'))
    expect(p).toEqual({ table: 'approvals', at: '2026-11-10T01:02:03.000Z' })
    expect(Object.keys(p).sort()).toEqual(['at', 'table'])
  })
})

describe('broadcastSignal', () => {
  it('posts one message to the HTTP broadcast endpoint on the public channel', async () => {
    const f = vi.fn(ok)
    const now = new Date('2026-11-10T01:02:03Z')
    expect(await broadcastSignal(URL_, 'sb_secret_x', 'docs', { fetch: f as typeof fetch, now })).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${URL_}/realtime/v1/api/broadcast`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ topic: SIGNAL_TOPIC, event: SIGNAL_EVENT, payload: { table: 'docs', at: now.toISOString() } }],
    })
  })

  it('a legacy JWT key goes in both headers, a new sb_secret_ key in apikey only', async () => {
    const f = vi.fn(ok)
    await broadcastSignal(URL_, 'eyJhbGciOi.x.y', 'docs', { fetch: f as typeof fetch })
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ apikey: 'eyJhbGciOi.x.y', authorization: 'Bearer eyJhbGciOi.x.y' })
    f.mockClear()
    await broadcastSignal(URL_, 'sb_secret_x', 'docs', { fetch: f as typeof fetch })
    const h = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(h.apikey).toBe('sb_secret_x')
    expect(h.authorization).toBeUndefined()
  })

  it('never throws: a network error, a refusal and a timeout all answer false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await broadcastSignal(URL_, 'k', 'docs', { fetch: (() => Promise.reject(new Error('down'))) as typeof fetch })).toBe(false)
    expect(await broadcastSignal(URL_, 'k', 'docs', { fetch: (() => Promise.resolve(new Response('no', { status: 401 }))) as typeof fetch })).toBe(false)
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('timeout'))))) as unknown as typeof fetch
    expect(await broadcastSignal(URL_, 'k', 'docs', { fetch: hang, timeoutMs: 20 })).toBe(false)
  })

  it('logs without the key or the body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await broadcastSignal(URL_, 'sb_secret_topsecret', 'docs', { fetch: (() => Promise.reject(new Error('down'))) as typeof fetch })
    expect(JSON.stringify(log.mock.calls)).not.toContain('topsecret')
  })
})

describe('signals (after a write)', () => {
  it('signals each table once, only after the write resolved', async () => {
    const f = vi.fn(ok)
    const sig = signals(URL_, 'k', { fetch: f as typeof fetch })
    const write = sig.after('approvals', async (_rows: number[]) => {})
    await write([1])
    await write([2])
    expect(f).not.toHaveBeenCalled() // nothing until the request is done
    await sig.flush()
    expect(f).toHaveBeenCalledTimes(1)
    await sig.flush()
    expect(f).toHaveBeenCalledTimes(1) // flushed: nothing left
  })

  it('a failed write sends no signal and still throws its own error', async () => {
    const f = vi.fn(ok)
    const sig = signals(URL_, 'k', { fetch: f as typeof fetch })
    const bad = sig.after('docs', async () => {
      throw new Error('supabase 500')
    })
    await expect(bad()).rejects.toThrow('supabase 500')
    await sig.flush()
    expect(f).not.toHaveBeenCalled()
  })

  it('a failed signal does not fail flush', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sig = signals(URL_, 'k', { fetch: (() => Promise.reject(new Error('down'))) as typeof fetch })
    sig.note('docs')
    await expect(sig.flush()).resolves.toBeUndefined()
  })
})

// the write sites: /api/docs wraps its store like this (docs → 'docs', requests and results → 'approvals')
describe('the /api/docs ingest with signals', () => {
  const cfg: IngestConfig = { token: 't', publicRepos: ['o/r'], banned: [] }
  const OWNER = { login: 'o', association: 'OWNER' }
  const post = (body: unknown) => new Request('https://x.test/api/docs', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) })
  const plan = { kind: 'plan', repo: 'o/r', folder: 1, title: 'T', body: '## 배경\nx', author: OWNER, source: { kind: 'issue', url: 'https://github.com/o/r/issues/1' }, created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' }
  const base = { upsert: async () => {}, setOpenIssues: async () => {}, addHandoffs: async () => {}, upsertApprovals: async () => {}, decide: async () => {} }

  const run = async (body: unknown, over: Partial<DocStore> = {}) => {
    const f = vi.fn(ok)
    const sig = signals(URL_, 'k', { fetch: f as typeof fetch })
    const store: DocStore = { ...base, ...over, upsert: sig.after('docs', over.upsert ?? base.upsert), upsertApprovals: sig.after('approvals', over.upsertApprovals ?? base.upsertApprovals), decide: sig.after('approvals', over.decide ?? base.decide) }
    let res: Response | undefined
    try {
      res = await handle(post(body), store, cfg)
    } catch {
      /* the function answers 502 itself */
    } finally {
      await sig.flush()
    }
    const sent = f.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).messages[0].payload.table)
    return { res, sent }
  }

  it('a document write signals docs', async () => {
    const { sent } = await run({ docs: [plan] })
    expect(sent).toEqual(['docs'])
  })

  it('an empty batch writes nothing and signals nothing', async () => {
    expect((await run({ docs: [] })).sent).toEqual([])
  })

  it('a write that fails signals nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sent } = await run({ docs: [plan] }, { upsert: async () => { throw new Error('supabase 500') } })
    expect(sent).toEqual([])
  })
})

describe('the /api/docs ingest with signals: approvals', () => {
  const raw = import.meta.glob('../docs/fixtures/approval-*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const REPO = 'Rowan-Hyeho-Song/agent-office'
  const cfg: IngestConfig = { token: 't', publicRepos: [REPO], banned: [] }
  const OWNER = { login: 'Rowan-Hyeho-Song', association: 'OWNER' }
  const url = (id: string) => `https://github.com/${REPO}/issues/26#issuecomment-${id}`
  const req = (id: string) => ({ type: 'request', repo: REPO, folder: 26, url: url(id), body: raw[`../docs/fixtures/approval-${id}.md`], author: OWNER, created_at: '2026-11-08T02:00:00Z', updated_at: '2026-11-08T02:00:00Z' })

  it('a filed request signals approvals once (and not docs)', async () => {
    const f = vi.fn(ok)
    const sig = signals(URL_, 'k', { fetch: f as typeof fetch })
    const store: DocStore = {
      upsert: sig.after('docs', async () => {}),
      setOpenIssues: async () => {},
      addHandoffs: async () => {},
      upsertApprovals: sig.after('approvals', async () => {}),
      decide: sig.after('approvals', async () => {}),
    }
    const res = await handle(new Request('https://x.test', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ docs: [], approvals: [req('6709822206')] }) }), store, cfg)
    await sig.flush()
    expect(res.status).toBe(200)
    expect(f.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).messages[0].payload.table)).toEqual(['approvals'])
  })
})
