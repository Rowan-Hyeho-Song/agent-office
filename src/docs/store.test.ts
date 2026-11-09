import { describe, expect, it } from 'vitest'
import type { Role } from '../approvals/source'
import { FakeDocsSource } from './fakeSource'
import { LibraryStore } from './store'

const setup = (role: Role = 'visitor') => {
  const fake = new FakeDocsSource()
  const state = { role }
  const store = new LibraryStore(fake, () => state.role)
  fake.setRole = (r) => (state.role = r)
  return { fake, state, store }
}

describe('library store with the fake source', () => {
  it('a visitor gets covers: no titles of SECRET documents, no private names, no review bodies', async () => {
    const { store, fake } = setup()
    await store.refresh()
    const metas = store.getSnapshot().metas!
    const review = metas.filter((m) => m.grade === 'review')
    expect(review.length).toBeGreaterThan(0)
    expect(review.every((m) => m.title === null && !m.readable)).toBe(true)
    const priv = metas.filter((m) => m.grade === 'private')
    expect(priv).toHaveLength(3)
    expect(priv.every((m) => m.title === null && m.repo === null && m.folder === null)).toBe(true)
    // progress (#241): a private plan shows its stage and nothing of its count or pending requests; the others in full
    expect(priv.map((m) => m.progress)).toContainEqual({ stage: 'doing', checks: null, pending: 0 })
    expect(JSON.stringify(priv)).not.toMatch(/"total":4/)
    expect(metas.find((m) => m.progress?.pending === 2)?.progress).toEqual({ stage: 'doing', checks: { done: 1, total: 3 }, pending: 2 })
    expect(JSON.stringify(metas)).not.toMatch(/비공개 회의|비공개 보고|private\/x/)
    // asking for every body returns only the readable (public + approved) ones
    const bodies = await fake.read(
      metas.map((m) => m.id),
      'visitor',
    )
    expect(bodies.map((b) => b.id).sort()).toEqual(metas.filter((m) => m.readable).map((m) => m.id).sort())
    expect(JSON.stringify(bodies)).not.toMatch(/never sent|결재 전이라/)
  })
  it('the owner reads review bodies, never private ones', async () => {
    const { store, fake } = setup('owner')
    await store.refresh()
    const metas = store.getSnapshot().metas!
    const bodies = await fake.read(
      metas.map((m) => m.id),
      'owner',
    )
    const ids = new Set(bodies.map((b) => b.id))
    for (const m of metas) expect(ids.has(m.id)).toBe(m.grade !== 'private')
    expect(metas.filter((m) => m.grade === 'review').every((m) => m.readable && m.title)).toBe(true)
    expect(metas.filter((m) => m.grade === 'private').every((m) => !m.readable && m.title === null)).toBe(true)
  })
  it('ensure() fetches only readable bodies', async () => {
    const { store } = setup()
    await store.refresh()
    const metas = store.getSnapshot().metas!
    await store.ensure(metas.map((m) => m.id))
    const got = Object.keys(store.getSnapshot().bodies).map(Number)
    expect(got.sort()).toEqual(metas.filter((m) => m.readable).map((m) => m.id).sort())
  })
  it('publishing makes the document readable and announces it; a role change drops bodies', async () => {
    const { store, fake, state } = setup()
    await store.refresh()
    const secret = store.getSnapshot().metas!.find((m) => m.grade === 'review')!
    const seen: number[][] = []
    store.onPublish((ids) => seen.push(ids))
    fake.publish(secret.id)
    await store.refresh()
    expect(seen).toEqual([[secret.id]])
    expect(store.getSnapshot().metas!.find((m) => m.id === secret.id)).toMatchObject({ readable: true, approved: true })
    await store.ensure([secret.id])
    expect(store.getSnapshot().bodies[secret.id]).toBeDefined()
    state.role = 'owner'
    await store.refresh()
    expect(store.getSnapshot().bodies[secret.id]).toBeUndefined()
    expect(seen).toHaveLength(1)
  })
})
