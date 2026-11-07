import { describe, expect, it } from 'vitest'
import { handle, nextStatus, parseSignal, sameToken, type Activity, type Signal, type StatusRow, type Store } from './events'

describe('parseSignal', () => {
  it('accepts seats 0..3 for each kind', () => {
    for (const seat of [0, 1, 2, 3]) {
      expect(parseSignal({ seat, kind: 'start' })).toEqual({ seat, kind: 'start' })
    }
    expect(parseSignal({ seat: 0, kind: 'stop' })).toEqual({ seat: 0, kind: 'stop' })
    expect(parseSignal({ seat: 0, kind: 'end' })).toEqual({ seat: 0, kind: 'end' })
    expect(parseSignal({ seat: 2, kind: 'activity', activity: 'edit' })).toEqual({ seat: 2, kind: 'activity', activity: 'edit' })
  })

  it('accepts every listed activity', () => {
    for (const a of ['edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think']) {
      expect(parseSignal({ seat: 0, kind: 'activity', activity: a })).toEqual({ seat: 0, kind: 'activity', activity: a })
    }
  })

  it('rejects bad seats', () => {
    for (const seat of [-1, 4, 1.5, NaN, Infinity, '1', null, undefined, [1], {}]) {
      expect(parseSignal({ seat, kind: 'start' })).toBeNull()
    }
  })

  it('rejects bad kinds', () => {
    for (const kind of ['', 'START', 'bogus', 1, null, undefined, ['start']]) {
      expect(parseSignal({ seat: 0, kind })).toBeNull()
    }
  })

  it('requires a valid activity for kind activity', () => {
    expect(parseSignal({ seat: 0, kind: 'activity' })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'activity', activity: 'rm -rf /' })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'activity', activity: 1 })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'activity', activity: null })).toBeNull()
  })

  it('rejects an activity on other kinds', () => {
    for (const kind of ['start', 'stop', 'end']) {
      expect(parseSignal({ seat: 0, kind, activity: 'edit' })).toBeNull()
      expect(parseSignal({ seat: 0, kind, activity: null })).toBeNull()
    }
  })

  it('rejects non-objects', () => {
    for (const b of [null, undefined, 0, 1, '', 'x', true]) expect(parseSignal(b)).toBeNull()
  })

  it('rejects arrays', () => {
    expect(parseSignal([])).toBeNull()
    expect(parseSignal([{ seat: 0, kind: 'start' }])).toBeNull()
  })

  it('rejects extra fields (nothing may ride along)', () => {
    expect(parseSignal({ seat: 1, kind: 'start', junk: 'x' })).toBeNull()
    expect(parseSignal({ seat: 1, kind: 'result', activity: 'test', ok: true, output: 'x' })).toBeNull()
  })

  it('accepts a result for test and build', () => {
    expect(parseSignal({ seat: 3, kind: 'result', activity: 'test', ok: true })).toEqual({ seat: 3, kind: 'result', activity: 'test', ok: true })
    expect(parseSignal({ seat: 1, kind: 'result', activity: 'build', ok: false })).toEqual({ seat: 1, kind: 'result', activity: 'build', ok: false })
  })

  it('rejects a bad result', () => {
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'edit', ok: true })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'install', ok: true })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'test', ok: 'true' })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'test', ok: 1 })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'test' })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', ok: true })).toBeNull()
  })

  it('rejects ok on a non-result kind', () => {
    for (const kind of ['start', 'stop', 'end']) expect(parseSignal({ seat: 0, kind, ok: true })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'activity', activity: 'test', ok: true })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'start', ok: null })).toBeNull()
  })
})

describe('sameToken', () => {
  it('compares', () => {
    expect(sameToken('secret', 'secret')).toBe(true)
    expect(sameToken('secret', 'secreT')).toBe(false)
    expect(sameToken('secret', 'secre')).toBe(false)
    expect(sameToken('secre', 'secret')).toBe(false)
    expect(sameToken('', '')).toBe(false)
    expect(sameToken('secret', '')).toBe(false)
    expect(sameToken('', 'secret')).toBe(false)
  })
})

describe('nextStatus', () => {
  const T0 = '2026-01-01T00:00:00.000Z'
  const T1 = '2026-01-01T00:01:00.000Z'
  const NONE = { last_result_activity: null, last_result_ok: null, last_result_at: null }
  const row = (over: Partial<StatusRow> = {}): StatusRow => ({ seat: 1, state: 'idle', activity: null, since: T0, updated_at: T0, ...NONE, ...over })
  const sig = (kind: 'start' | 'stop' | 'end' | 'activity', activity?: Activity): Signal =>
    kind === 'activity' ? { seat: 1, kind, activity: activity ?? 'think' } : { seat: 1, kind }
  const res = (activity: 'test' | 'build', ok: boolean): Signal => ({ seat: 1, kind: 'result', activity, ok })

  it('maps kinds to states', () => {
    expect(nextStatus(null, sig('start'), T1).row).toMatchObject({ state: 'idle', activity: null })
    expect(nextStatus(null, sig('activity', 'edit'), T1).row).toMatchObject({ state: 'working', activity: 'edit' })
    expect(nextStatus(null, sig('stop'), T1).row).toMatchObject({ state: 'wrapping', activity: null })
    expect(nextStatus(null, sig('end'), T1).row).toMatchObject({ state: 'off', activity: null })
  })

  it('first signal: since = now, changed', () => {
    const r = nextStatus(null, sig('start'), T1)
    expect(r.row).toEqual({ seat: 1, state: 'idle', activity: null, since: T1, updated_at: T1, ...NONE })
    expect(r.changed).toBe(true)
  })

  it('keeps since on repeated state, resets it on change', () => {
    const w = row({ state: 'working', activity: 'edit' })
    expect(nextStatus(w, sig('activity', 'edit'), T1).row.since).toBe(T0)
    expect(nextStatus(w, sig('activity', 'read'), T1).row.since).toBe(T0)
    expect(nextStatus(w, sig('stop'), T1).row.since).toBe(T1)
    expect(nextStatus(w, sig('stop'), T1).row.updated_at).toBe(T1)
  })

  it('changed: false for the same working activity, true when it differs', () => {
    const w = row({ state: 'working', activity: 'edit' })
    expect(nextStatus(w, sig('activity', 'edit'), T1).changed).toBe(false)
    expect(nextStatus(w, sig('activity', 'read'), T1).changed).toBe(true)
    expect(nextStatus(row(), sig('activity', 'edit'), T1).changed).toBe(true)
  })

  it('repeated non-working states are not changes', () => {
    expect(nextStatus(row({ state: 'idle' }), sig('start'), T1).changed).toBe(false)
    expect(nextStatus(row({ state: 'wrapping' }), sig('stop'), T1).changed).toBe(false)
    expect(nextStatus(row({ state: 'off' }), sig('end'), T1).changed).toBe(false)
    expect(nextStatus(row({ state: 'wrapping' }), sig('end'), T1).changed).toBe(true)
  })

  it('a result keeps state/activity/since, sets last_result_*, changed', () => {
    const w = row({ state: 'working', activity: 'build', since: T0 })
    const r = nextStatus(w, res('build', false), T1)
    expect(r.changed).toBe(true)
    expect(r.row).toMatchObject({ state: 'working', activity: 'build', since: T0, updated_at: T1, last_result_activity: 'build', last_result_ok: false, last_result_at: T1 })
    const i = nextStatus(row({ state: 'idle' }), res('test', true), T1)
    expect(i.row).toMatchObject({ state: 'idle', activity: null, since: T0, last_result_ok: true })
    expect(i.changed).toBe(true)
  })

  it('a later activity / stop / end keeps the last result', () => {
    const withResult = nextStatus(row(), res('test', true), T1).row
    const T2 = '2026-01-01T00:02:00.000Z'
    for (const s of [sig('activity', 'edit'), sig('stop'), sig('end'), sig('start')]) {
      expect(nextStatus(withResult, s, T2).row).toMatchObject({ last_result_activity: 'test', last_result_ok: true, last_result_at: T1 })
    }
  })

  it('a result as the very first signal', () => {
    const r = nextStatus(null, res('test', false), T1)
    expect(r.changed).toBe(true)
    expect(r.row).toMatchObject({ seat: 1, state: 'working', since: T1, updated_at: T1, last_result_activity: 'test', last_result_ok: false, last_result_at: T1 })
  })
})

const NONE = { last_result_activity: null, last_result_ok: null, last_result_at: null }

function memoryStore(initial: StatusRow[] = []) {
  const rows = new Map(initial.map((r) => [r.seat, r]))
  const calls = { setStatus: 0, addEvent: [] as Parameters<Store['addEvent']>[0][], prune: [] as string[] }
  const store: Store = {
    status: async (seat) => rows.get(seat) ?? null,
    setStatus: async (r) => {
      calls.setStatus++
      rows.set(r.seat, r)
    },
    addEvent: async (e) => void calls.addEvent.push(e),
    prune: async (b) => void calls.prune.push(b),
  }
  return { store, rows, calls }
}

describe('handle', () => {
  const TOKEN = 'tok-123'
  const NOW = new Date('2026-03-15T12:00:00.000Z')
  const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
    new Request('http://x/api/events', {
      method: 'POST',
      headers: auth === null ? {} : { authorization: auth },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const untouched = (c: ReturnType<typeof memoryStore>) => {
    expect(c.calls.setStatus).toBe(0)
    expect(c.calls.addEvent).toEqual([])
    expect(c.calls.prune).toEqual([])
    expect(c.rows.size).toBe(0)
  }

  it('405 on GET', async () => {
    const m = memoryStore()
    const res = await handle(new Request('http://x/api/events'), m.store, TOKEN, NOW)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    untouched(m)
  })

  it('401 without or with a wrong token, store untouched', async () => {
    for (const auth of [null, '', 'Bearer ', 'Bearer wrong', 'Bearer tok-12', TOKEN + 'x', 'Basic ' + TOKEN]) {
      const m = memoryStore()
      const res = await handle(post({ seat: 0, kind: 'start' }, auth), m.store, TOKEN, NOW)
      expect(res.status).toBe(401)
      untouched(m)
    }
  })

  it('401 when the server token is empty', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 0, kind: 'start' }, 'Bearer '), m.store, '', NOW)
    expect(res.status).toBe(401)
    untouched(m)
  })

  it('accepts the bearer scheme case-insensitively', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 0, kind: 'stop' }, `bearer ${TOKEN}`), m.store, TOKEN, NOW)
    expect(res.status).toBe(200)
  })

  it('400 on bad JSON', async () => {
    const m = memoryStore()
    const res = await handle(post('{not json'), m.store, TOKEN, NOW)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad json' })
    untouched(m)
  })

  it('400 on a bad signal', async () => {
    for (const body of [{ seat: 9, kind: 'start' }, { seat: 0, kind: 'activity' }, { seat: 0, kind: 'start', activity: 'edit' }, null, [], '"x"']) {
      const m = memoryStore()
      const res = await handle(post(body), m.store, TOKEN, NOW)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad signal' })
      untouched(m)
    }
  })

  it('200 writes status and an event on a change', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 2, kind: 'activity', activity: 'edit' }), m.store, TOKEN, NOW)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, state: 'working', changed: true })
    const at = NOW.toISOString()
    expect(m.rows.get(2)).toEqual({ seat: 2, state: 'working', activity: 'edit', since: at, updated_at: at, ...NONE })
    expect(m.calls.addEvent).toEqual([{ seat: 2, kind: 'activity', activity: 'edit', ok: null, created_at: at }])
    expect(m.calls.prune).toEqual([])
  })

  it('writes status but no event when nothing changed', async () => {
    const earlier = '2026-03-15T11:59:00.000Z'
    const m = memoryStore([{ seat: 2, state: 'working', activity: 'edit', since: earlier, updated_at: earlier, ...NONE }])
    const res = await handle(post({ seat: 2, kind: 'activity', activity: 'edit' }), m.store, TOKEN, NOW)
    expect(await res.json()).toEqual({ ok: true, state: 'working', changed: false })
    expect(m.calls.setStatus).toBe(1)
    expect(m.calls.addEvent).toEqual([])
    expect(m.rows.get(2)).toMatchObject({ since: earlier, updated_at: NOW.toISOString() })
  })

  it('a result stores an event with ok and sets the last result', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 3, kind: 'result', activity: 'test', ok: false }), m.store, TOKEN, NOW)
    expect(res.status).toBe(200)
    const at = NOW.toISOString()
    expect(m.calls.addEvent).toEqual([{ seat: 3, kind: 'result', activity: 'test', ok: false, created_at: at }])
    expect(m.rows.get(3)).toMatchObject({ last_result_activity: 'test', last_result_ok: false, last_result_at: at })
  })

  it('400 on a result with extra fields', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 3, kind: 'result', activity: 'test', ok: true, output: 'secret' }), m.store, TOKEN, NOW)
    expect(res.status).toBe(400)
    untouched(m)
  })

  it('event for a stop has a null activity', async () => {
    const m = memoryStore()
    await handle(post({ seat: 1, kind: 'stop' }), m.store, TOKEN, NOW)
    expect(m.calls.addEvent[0]).toMatchObject({ seat: 1, kind: 'stop', activity: null })
  })

  it('prunes only on start, 14 days before now', async () => {
    const m = memoryStore()
    for (const body of [{ seat: 0, kind: 'activity', activity: 'think' }, { seat: 0, kind: 'stop' }, { seat: 0, kind: 'end' }]) {
      await handle(post(body), m.store, TOKEN, NOW)
    }
    expect(m.calls.prune).toEqual([])
    await handle(post({ seat: 0, kind: 'start' }), m.store, TOKEN, NOW)
    expect(m.calls.prune).toEqual(['2026-03-01T12:00:00.000Z'])
  })

  it('prunes on start even when nothing changed', async () => {
    const t = '2026-03-15T11:00:00.000Z'
    const m = memoryStore([{ seat: 0, state: 'idle', activity: null, since: t, updated_at: t, ...NONE }])
    const res = await handle(post({ seat: 0, kind: 'start' }), m.store, TOKEN, NOW)
    expect(await res.json()).toMatchObject({ changed: false })
    expect(m.calls.addEvent).toEqual([])
    expect(m.calls.prune).toHaveLength(1)
  })
})
