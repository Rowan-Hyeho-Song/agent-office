// #646 the GitHub client tries a passing failure again (a cut connection, a 5xx, a rate limit) and fails a refusal at once.
import { describe, expect, it } from 'vitest'
import { RETRY, github } from './build.mjs'

const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
const status = (n: number, headers: Record<string, string> = {}) => ({ ok: false, status: n, headers: new Headers(headers), json: async () => ({}) })
const cut = () => {
  throw new TypeError('fetch failed')
}

/** a client over a scripted fetch; the waits are recorded, not slept */
function client(...answers: (() => unknown)[]) {
  const waits: number[] = []
  let calls = 0
  const fetch = (async () => {
    const a = answers[Math.min(calls++, answers.length - 1)]
    return a()
  }) as unknown as typeof globalThis.fetch
  const gh = github('t', { fetch, sleep: async (ms: number) => void waits.push(ms) })
  return { gh, waits, calls: () => calls }
}

describe('the GitHub client retries passing failures (#646)', () => {
  it('a connection cut twice, then an answer: it gets the answer, after waiting 1 s and 2 s', async () => {
    const c = client(cut, cut, () => ok({ n: 1 }))
    await expect(c.gh.get('/x')).resolves.toEqual({ n: 1 })
    expect(c.calls()).toBe(3)
    expect(c.waits).toEqual([1000, 2000])
  })
  it('a body cut while it is read is a passing failure too', async () => {
    const broken = { ok: true, status: 200, headers: new Headers(), json: async () => Promise.reject(new Error('other side closed')) }
    const c = client(() => broken, () => ok([1]))
    await expect(c.gh.get('/x')).resolves.toEqual([1])
    expect(c.waits).toEqual([1000])
  })
  it('a 5xx is retried 1 · 2 · 4 s; still failing after three retries, it fails', async () => {
    const c = client(() => status(502))
    await expect(c.gh.get('/x')).rejects.toThrow('GitHub 502 /x')
    expect(c.calls()).toBe(RETRY.times + 1)
    expect(c.waits).toEqual([1000, 2000, 4000])
  })
  it('a cut connection every time fails after three retries, naming the path', async () => {
    const c = client(cut)
    await expect(c.gh.get('/repos/o/r')).rejects.toThrow('GitHub /repos/o/r: fetch failed')
    expect(c.calls()).toBe(RETRY.times + 1)
  })
  it('a refusal fails at once: 404, 401, a 403 with requests left', async () => {
    for (const r of [status(404), status(401), status(403, { 'x-ratelimit-remaining': '12' })]) {
      const c = client(() => r)
      await expect(c.gh.get('/x')).rejects.toThrow(`GitHub ${r.status} /x`)
      expect(c.calls()).toBe(1)
      expect(c.waits).toEqual([])
    }
  })
  it('a rate limit waits as GitHub says (at least 1 s, at most a minute), then gets the answer', async () => {
    const c = client(() => status(429, { 'retry-after': '3' }), () => status(403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }), () => ok('done'))
    await expect(c.gh.get('/x')).resolves.toBe('done')
    expect(c.waits).toEqual([3000, 60_000])
  })
  it('every page of a list goes through the same retries', async () => {
    const c = client(cut, () => ok(Array.from({ length: 100 }, (_, i) => i)), () => ok([100]))
    await expect(c.gh.all('/repos/o/r/issues')).resolves.toHaveLength(101)
  })
})
