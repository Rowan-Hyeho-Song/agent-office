import { describe, expect, it } from 'vitest'
import { SEATS, handle, matchRepo, nextStatus, parseSignal, sameToken, type Activity, type Signal, type StatusRow, type Store } from './events'

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
    for (const seat of [-1, 5, 1.5, NaN, Infinity, '1', null, undefined, [1], {}]) {
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

  it('accepts a handoff to another seat (#51)', () => {
    for (const seat of [0, 1, 2, 3])
      for (const to of [0, 1, 2, 3]) {
        if (to === seat) continue
        expect(parseSignal({ seat, kind: 'handoff', to })).toEqual({ seat, kind: 'handoff', to })
      }
  })

  it('rejects a bad handoff: missing / unknown / own seat, or anything riding along', () => {
    expect(parseSignal({ seat: 0, kind: 'handoff' })).toBeNull()
    for (const to of [-1, 5, 1.5, NaN, '1', null, [1], {}]) expect(parseSignal({ seat: 0, kind: 'handoff', to })).toBeNull()
    expect(parseSignal({ seat: 2, kind: 'handoff', to: 2 })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'handoff', to: 3, activity: 'delegate' })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'handoff', to: 3, ok: true })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'handoff', to: 3, message: '비밀 문자열' })).toBeNull()
  })

  it('rejects to on other kinds', () => {
    for (const kind of ['start', 'stop', 'end']) expect(parseSignal({ seat: 0, kind, to: 1 })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'activity', activity: 'edit', to: 1 })).toBeNull()
    expect(parseSignal({ seat: 0, kind: 'result', activity: 'test', ok: true, to: 1 })).toBeNull()
  })
})

describe('the task a signal names (#182)', () => {
  it('matchRepo takes the short name or owner/name from the list, nothing else', () => {
    const repos = ['Rowan-Hyeho-Song/agent-office', 'Rowan-Hyeho-Song/rowansong.dev']
    expect(matchRepo('agent-office', repos)).toBe('Rowan-Hyeho-Song/agent-office')
    expect(matchRepo('ROWANSONG.dev', repos)).toBe('Rowan-Hyeho-Song/rowansong.dev')
    expect(matchRepo('rowan-hyeho-song/agent-office', repos)).toBe('Rowan-Hyeho-Song/agent-office')
    for (const bad of ['evil/agent-office', 'secret', '', 'agent-office extra', 5, null, undefined, 'a'.repeat(200)]) expect(matchRepo(bad, repos)).toBeNull()
  })

  it('parseSignal carries a valid repo + issue, and ignores a bad one without failing the event', () => {
    expect(parseSignal({ seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 })).toEqual({
      seat: 3, kind: 'activity', activity: 'edit', task: { repo: 'agent-office', issue: 170 },
    })
    const plain = { seat: 3, kind: 'activity', activity: 'edit' }
    for (const extra of [
      { repo: 'secret', issue: 1 },
      { repo: 'agent-office', issue: 0 },
      { repo: 'agent-office', issue: -1 },
      { repo: 'agent-office', issue: 1.5 },
      { repo: 'agent-office', issue: '170' },
      { repo: 'agent-office', issue: 1_000_001 },
      { repo: 'agent-office' },
      { issue: 170 },
      { repo: ['agent-office'], issue: 170 },
    ])
      expect(parseSignal({ ...plain, ...extra })).toEqual(plain)
    // anything else still may not ride along
    expect(parseSignal({ ...plain, repo: 'agent-office', issue: 1, title: 'x' })).toBeNull()
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
  const TASK_NONE = { task_repo: null, task_issue: null, task_title: null, task_private: null }
const NONE = { last_result_activity: null, last_result_ok: null, last_result_at: null, ...TASK_NONE }
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

  it('a handoff keeps state, activity, since and the last result; it is always an event (#51)', () => {
    const prev = row({ state: 'working', activity: 'edit', last_result_activity: 'build', last_result_ok: true, last_result_at: T0 })
    const r = nextStatus(prev, { seat: 1, kind: 'handoff', to: 3 }, T1)
    expect(r.changed).toBe(true)
    expect(r.row).toEqual({ ...prev, updated_at: T1 })
  })

  it('a handoff as the very first signal: working, delegating', () => {
    const r = nextStatus(null, { seat: 1, kind: 'handoff', to: 0 }, T1)
    expect(r.changed).toBe(true)
    expect(r.row).toEqual({ seat: 1, state: 'working', activity: 'delegate', since: T1, updated_at: T1, ...NONE })
  })
})

const TASK_NONE = { task_repo: null, task_issue: null, task_title: null, task_private: null }
const NONE = { last_result_activity: null, last_result_ok: null, last_result_at: null, ...TASK_NONE }

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
    expect(m.calls.addEvent).toEqual([{ seat: 2, kind: 'activity', activity: 'edit', ok: null, to_seat: null, created_at: at }])
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
    expect(m.calls.addEvent).toEqual([{ seat: 3, kind: 'result', activity: 'test', ok: false, to_seat: null, created_at: at }])
    expect(m.rows.get(3)).toMatchObject({ last_result_activity: 'test', last_result_ok: false, last_result_at: at })
  })

  it('400 on a result with extra fields', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 3, kind: 'result', activity: 'test', ok: true, output: 'secret' }), m.store, TOKEN, NOW)
    expect(res.status).toBe(400)
    untouched(m)
  })

  it('a handoff stores an event with to_seat only (#51)', async () => {
    const m = memoryStore()
    const res = await handle(post({ seat: 0, kind: 'handoff', to: 3 }), m.store, TOKEN, NOW)
    expect(res.status).toBe(200)
    expect(m.calls.addEvent).toEqual([{ seat: 0, kind: 'handoff', activity: null, ok: null, to_seat: 3, created_at: NOW.toISOString() }])
    expect(m.calls.prune).toEqual([])
  })

  it('400 on a handoff carrying anything else, store untouched', async () => {
    for (const body of [
      { seat: 0, kind: 'handoff', to: 3, message: '비밀 문자열' },
      { seat: 0, kind: 'handoff', to: 0 },
      { seat: 0, kind: 'handoff', to: 9 },
      { seat: 0, kind: 'handoff' },
    ]) {
      const m = memoryStore()
      const res = await handle(post(body), m.store, TOKEN, NOW)
      expect(res.status).toBe(400)
      untouched(m)
    }
  })

  describe('a task (#182)', () => {
    const cfg = { repos: ['Rowan-Hyeho-Song/agent-office', 'Rowan-Hyeho-Song/rowansong.dev'], publicRepos: ['Rowan-Hyeho-Song/agent-office'] }
    const withTitles = (titles: Record<string, string>, store: Store): { store: Store; asked: string[] } => {
      const asked: string[] = []
      return { asked, store: { ...store, issueTitle: async (repo, issue) => (asked.push(repo + '#' + issue), titles[repo + '#' + issue] ?? null) } }
    }
    const send = (store: Store, body: unknown) => handle(post(body), store, TOKEN, NOW, cfg)

    it('a public issue stores the repo name, number and the title the server found', async () => {
      const m = memoryStore()
      const { store, asked } = withTitles({ 'Rowan-Hyeho-Song/agent-office#170': '서재 옆 패널' }, m.store)
      expect((await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 })).status).toBe(200)
      expect(m.rows.get(3)).toMatchObject({ task_repo: 'agent-office', task_issue: 170, task_title: '서재 옆 패널', task_private: false })
      expect(asked).toEqual(['Rowan-Hyeho-Song/agent-office#170'])
    })

    it('the title is looked up once per issue, not on every signal', async () => {
      const m = memoryStore()
      const { store, asked } = withTitles({ 'Rowan-Hyeho-Song/agent-office#170': '제목' }, m.store)
      for (const activity of ['edit', 'read', 'test']) await send(store, { seat: 3, kind: 'activity', activity, repo: 'agent-office', issue: 170 })
      expect(asked).toHaveLength(1)
      await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 171 })
      expect(asked).toHaveLength(2)
      expect(m.rows.get(3)).toMatchObject({ task_issue: 171, task_title: null, task_private: false })
    })

    it('no public document for the issue: the number alone', async () => {
      const m = memoryStore()
      await send(withTitles({}, m.store).store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 5 })
      expect(m.rows.get(3)).toMatchObject({ task_repo: 'agent-office', task_issue: 5, task_title: null, task_private: false })
    })

    it('a failed title lookup does not fail the signal', async () => {
      const m = memoryStore()
      const store: Store = { ...m.store, issueTitle: async () => Promise.reject(new Error('down')) }
      expect((await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 5 })).status).toBe(200)
      expect(m.rows.get(3)).toMatchObject({ task_issue: 5, task_title: null })
    })

    it('a private repo stores no repo, number or title, and is never looked up', async () => {
      const m = memoryStore()
      const { store, asked } = withTitles({ 'Rowan-Hyeho-Song/rowansong.dev#12': '비밀 제목' }, m.store)
      await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'rowansong.dev', issue: 12 })
      expect(m.rows.get(3)).toMatchObject({ task_repo: null, task_issue: null, task_title: null, task_private: true })
      expect(asked).toEqual([])
    })

    it('a repo outside the list or a bad number is ignored and the event still goes through', async () => {
      for (const extra of [{ repo: 'secret-company', issue: 9 }, { repo: 'agent-office', issue: 0 }, { repo: 'agent-office', issue: 1e9 }]) {
        const m = memoryStore()
        const { store, asked } = withTitles({}, m.store)
        expect((await send(store, { seat: 3, kind: 'activity', activity: 'edit', ...extra })).status).toBe(200)
        expect(m.rows.get(3)).toMatchObject(TASK_NONE)
        expect(asked).toEqual([])
      }
    })

    it('a signal without a task clears it; the session ending clears it too', async () => {
      const m = memoryStore()
      const { store } = withTitles({ 'Rowan-Hyeho-Song/agent-office#170': '제목' }, m.store)
      await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 })
      await send(store, { seat: 3, kind: 'activity', activity: 'read' })
      expect(m.rows.get(3)).toMatchObject(TASK_NONE)
      await send(store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 })
      await send(store, { seat: 3, kind: 'end', repo: 'agent-office', issue: 170 })
      expect(m.rows.get(3)).toMatchObject({ state: 'off', ...TASK_NONE })
    })

    it('the event row carries no task', async () => {
      const m = memoryStore()
      await send(withTitles({}, m.store).store, { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 })
      expect(m.calls.addEvent[0]).toEqual({ seat: 3, kind: 'activity', activity: 'edit', ok: null, to_seat: null, created_at: NOW.toISOString() })
    })
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

describe('the fifth seat (#193)', () => {
  it('accepts seat 4 and a handoff to it; 5 is still no seat', () => {
    expect(SEATS).toContain(4)
    expect(SEATS).not.toContain(5)
    expect(parseSignal({ seat: 4, kind: 'start' })).toEqual({ seat: 4, kind: 'start' })
    expect(parseSignal({ seat: 0, kind: 'handoff', to: 4 })).toEqual({ seat: 0, kind: 'handoff', to: 4 })
    expect(parseSignal({ seat: 5, kind: 'start' })).toBeNull()
  })
})
