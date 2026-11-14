import { describe, expect, it } from 'vitest'
import { COOLDOWN_KEEP_MS, PER_ROBOT_MS, ROOM_MAX, handleVisit, visitorHash, type SharedEvent, type TreatKind, type VisitStore } from './treat'

/** the store as the tables would hold it */
function memStore() {
  const cooldown: { hash: string; agent: string; at: number }[] = []
  const events: SharedEvent[] = []
  const store: VisitStore = {
    async lastCooldown(hash, agent) {
      const r = cooldown.filter((c) => c.hash === hash && c.agent === agent).map((c) => c.at)
      return r.length ? Math.max(...r) : null
    },
    async putCooldown(hash, agent, at, before) {
      for (let i = cooldown.length - 1; i >= 0; i--) if (cooldown[i].at < before.getTime()) cooldown.splice(i, 1)
      cooldown.push({ hash, agent, at: at.getTime() })
    },
    async sharedSince(since) {
      return events.filter((e) => Date.parse(e.created_at) >= since.getTime()).length
    },
    async share(agent, kind, at) {
      const e = { id: events.length + 1, agent, kind, created_at: at.toISOString() }
      events.push(e)
      return e
    },
  }
  return { store, cooldown, events }
}

const T0 = Date.parse('2026-11-14T03:00:00Z')
const req = (body: unknown, ip = '203.0.113.7') =>
  new Request('https://x/api/visit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) })
const send = async (m: ReturnType<typeof memStore>, at: number, agent: string, kind: TreatKind, ip?: string, signals?: { n: number }) => {
  const res = await handleVisit(req({ agent, kind }, ip), m.store, { secret: 'server-key', now: () => new Date(at), signal: async () => void (signals && signals.n++) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('/api/visit (#4 12.2)', () => {
  it('only the five robots and the four kinds', async () => {
    const m = memStore()
    expect((await send(m, T0, 'agent_9', 'coffee')).status).toBe(400)
    expect((await send(m, T0, 'agent_1', 'cake' as TreatKind)).status).toBe(400)
    const bad = await handleVisit(new Request('https://x', { method: 'POST', body: '{' }), m.store, { secret: 'k' })
    expect(bad.status).toBe(400)
    expect(m.events).toHaveLength(0)
  })

  it('a snack and a cheer each once a minute per robot per visitor; another robot or visitor is free', async () => {
    const m = memStore()
    const signals = { n: 0 }
    expect((await send(m, T0, 'agent_1', 'coffee', undefined, signals)).body.shared).toBe(true)
    const again = await send(m, T0 + 20_000, 'agent_1', 'apple')
    expect(again.status).toBe(429)
    expect(again.body.retryS).toBe(40)
    expect((await send(m, T0 + 20_000, 'agent_1', 'cheer')).status).toBe(200) // a cheer is its own minute
    expect((await send(m, T0 + 20_000, 'agent_2', 'coffee')).status).toBe(200) // another robot
    expect((await send(m, T0 + 20_000, 'agent_1', 'coffee', '198.51.100.4')).status).toBe(200) // another visitor
    expect((await send(m, T0 + PER_ROBOT_MS, 'agent_1', 'cookie')).status).toBe(200) // a minute later
    expect(signals.n).toBe(1)
  })

  it('past five in 10 s the room is not told (the sender still sees it); nothing kept about the visitor in the event', async () => {
    const m = memStore()
    const ips = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => `192.0.2.${i + 1}${x === 'a' ? '' : ''}`)
    const out = []
    for (const [i, ip] of ips.entries()) out.push(await send(m, T0 + i * 1000, 'agent_0', 'cheer', ip))
    expect(out.slice(0, ROOM_MAX).every((r) => r.body.shared === true)).toBe(true)
    expect(out[ROOM_MAX].body.shared).toBe(false)
    expect(m.events).toHaveLength(ROOM_MAX)
    expect(Object.keys(m.events[0]).sort()).toEqual(['agent', 'created_at', 'id', 'kind'])
    // 10 s later the room has room again
    expect((await send(m, T0 + 16_000, 'agent_2', 'cheer', '192.0.2.99')).body.shared).toBe(true)
  })

  it('cooldown rows: a keyed hash (no IP), gone after two minutes, a new key every day', async () => {
    const m = memStore()
    await send(m, T0, 'agent_3', 'coffee')
    expect(m.cooldown).toHaveLength(1)
    expect(m.cooldown[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(m.cooldown)).not.toContain('203.0.113.7')
    await send(m, T0 + COOLDOWN_KEEP_MS + 1, 'agent_4', 'coffee', '198.51.100.9')
    expect(m.cooldown).toHaveLength(1) // the old one deleted on this write
    const d1 = await visitorHash('k', '203.0.113.7', 'snack', new Date(T0))
    expect(await visitorHash('k', '203.0.113.7', 'snack', new Date(T0 + 3600_000))).toBe(d1)
    expect(await visitorHash('k', '203.0.113.7', 'snack', new Date(T0 + 86_400_000))).not.toBe(d1)
    expect(await visitorHash('k', '203.0.113.7', 'cheer', new Date(T0))).not.toBe(d1)
    expect(await visitorHash('other', '203.0.113.7', 'snack', new Date(T0))).not.toBe(d1)
  })
})
