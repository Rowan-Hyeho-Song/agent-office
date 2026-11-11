// #413: the timelapse reads the timeline table over the bundled copies, and falls back to the copies.
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLive, loadPoints, rowToPoint } from './livePoints'
import type { Point } from '../timeline/types'

const GH = 'https://github.com/Rowan-Hyeho-Song/agent-office'
const point = (key: string, at: string, extra: Partial<Point> = {}): Point => ({ key, project: 'Rowan-Hyeho-Song/agent-office', at, kind: 'work', agent: 3, title: 't', secret: false, additions: 1, deletions: 0, files: 1, issue: null, pr: null, tier: 'public', ...extra })
const row = (key: string, at: string, extra: Record<string, unknown> = {}) => ({ ...point(key, at), result: false, ...extra })

/** a fake client: `pages` are what successive range() calls return (or an error) */
function fakeClient(pages: (Record<string, unknown>[] | Error)[], calls: number[][] = []) {
  let n = 0
  const q = {
    select: () => q,
    order: () => q,
    range: async (a: number, b: number) => {
      calls.push([a, b])
      const p = pages[n++] ?? []
      return p instanceof Error ? { data: null, error: { message: p.message } } : { data: p, error: null }
    },
  }
  return { from: () => q } as unknown as SupabaseClient
}

describe('the timeline table as the timelapse reads it (#413)', () => {
  it('a row is a Point: `at` in the copies\' "…Z" form, `result` only when true, seat 4 kept, a bad row dropped', () => {
    expect(rowToPoint(row(`${GH}/commit/a`, '2026-11-11T03:04:05+00:00', { agent: 4 }))).toEqual(point(`${GH}/commit/a`, '2026-11-11T03:04:05Z', { agent: 4 }))
    expect(rowToPoint(row(`${GH}/issues/1#c`, '2026-11-11T00:00:00.000Z', { kind: 'approval', result: true }))).toMatchObject({ kind: 'approval', result: true })
    expect(rowToPoint(row(`${GH}/x`, '2026-11-11T00:00:00Z'))).not.toHaveProperty('result')
    expect(rowToPoint(row(`${GH}/x`, 'nope'))).toBeNull()
    expect(rowToPoint(row(`${GH}/x`, '2026-11-11T00:00:00Z', { kind: 'other' }))).toBeNull()
  })

  it('reads every page until a short one', async () => {
    const calls: number[][] = []
    const full = Array.from({ length: 3 }, (_, i) => row(`${GH}/commit/${i}`, `2026-11-1${i}T00:00:00Z`))
    const pts = await loadLive(fakeClient([full, [row(`${GH}/commit/z`, '2026-11-11T09:00:00Z')]], calls), 3)
    expect(pts).toHaveLength(4)
    expect(calls).toEqual([[0, 2], [3, 5]])
  })

  it('the copies with the table over them: one point per key, the table\'s row wins, sorted by time', async () => {
    const copies = async () => [point(`${GH}/commit/old`, '2026-11-08T00:00:00Z', { title: 'copy' }), point('https://github.com/Rowan-Hyeho-Song/rowansong.dev/commit/h', '2026-11-07T00:00:00Z')]
    const client = fakeClient([[row(`${GH}/commit/old`, '2026-11-08T00:00:00Z', { title: 'table' }), row(`${GH}/commit/new`, '2026-11-11T00:00:00Z')]])
    const pts = await loadPoints(copies, client)
    expect(pts.map((p) => [p.key.split('/').pop(), p.title])).toEqual([['h', 't'], ['old', 'table'], ['new', 't']])
  })

  it('no client, an error or a slow table: the copies alone', async () => {
    const copies = async () => [point(`${GH}/commit/c`, '2026-11-08T00:00:00Z')]
    expect(await loadPoints(copies, null)).toHaveLength(1)
    const warn = console.warn
    console.warn = () => {}
    try {
      expect(await loadPoints(copies, fakeClient([new Error('relation "public.timeline" does not exist')]))).toHaveLength(1)
      const never = { from: () => ({ select: () => never.q, order: () => never.q, range: () => new Promise(() => {}) }), q: null as unknown } as { from: () => unknown; q: unknown }
      never.q = never.from()
      expect(await loadPoints(copies, never as unknown as SupabaseClient, 20)).toHaveLength(1)
    } finally {
      console.warn = warn
    }
  })
})
