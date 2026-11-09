import { describe, expect, it } from 'vitest'
import { coverOf, groupLibrary, type CoverSource, type DocFile } from './library'
import { DEFAULT_VIEW, defaultRank, parseView, stageCounts, viewFiles } from './progressList'
import type { Progress } from './progress'

let id = 0
const file = (n: number, progress: Progress | null, day = n): DocFile => {
  const c: CoverSource = {
    id: ++id,
    kind: 'plan',
    repo: 'o/r',
    folder: n,
    title: `t${n}`,
    agents: [],
    grade: 'public',
    approved: true,
    created_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
    updated_at: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
    progress,
  }
  return groupLibrary([coverOf(c)])[0].files[0]
}
const p = (stage: Progress['stage'], pending = 0): Progress => ({ stage, checks: null, pending })

const files = [
  file(1, p('done'), 20),
  file(2, p('waiting'), 19),
  file(3, p('review'), 18),
  file(4, p('doing'), 10),
  file(5, p('doing'), 17),
  file(6, p('waiting', 1), 5),
  file(7, null, 25),
  file(8, p('done', 2), 4),
]
const order = (v = DEFAULT_VIEW) => viewFiles(files, v).map((f) => f.n)

describe('default order (#241)', () => {
  it('진행 중 → 검토 → 결재 대기 → 대기 → 완료 → no progress, newest first inside each', () => {
    expect(order()).toEqual([5, 4, 3, 6, 2, 1, 8, 7])
  })
  it('a finished file with a pending request stays with the finished', () => {
    expect(defaultRank(files[7])).toBe(4)
    expect(defaultRank(files[5])).toBe(2)
  })
})

describe('sort and filter', () => {
  it('최근 갱신 and 번호', () => {
    expect(order({ ...DEFAULT_VIEW, sort: 'recent' })).toEqual([7, 1, 2, 3, 5, 4, 6, 8])
    expect(order({ ...DEFAULT_VIEW, sort: 'number' })).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })
  it('one stage; a file with no progress is only in 전체', () => {
    expect(order({ ...DEFAULT_VIEW, stage: 'doing' })).toEqual([5, 4])
    expect(order({ ...DEFAULT_VIEW, stage: 'done' })).toEqual([1, 8])
    expect(order({ ...DEFAULT_VIEW, stage: 'all' })).toContain(7)
  })
  it('결재 대기만 combines with a stage', () => {
    expect(order({ ...DEFAULT_VIEW, pendingOnly: true })).toEqual([6, 8])
    expect(order({ stage: 'waiting', pendingOnly: true, sort: 'default' })).toEqual([6])
  })
  it('counts follow the toggle', () => {
    expect(stageCounts(files, { pendingOnly: false })).toEqual({ all: 8, doing: 2, review: 1, waiting: 2, done: 2 })
    expect(stageCounts(files, { pendingOnly: true })).toEqual({ all: 2, doing: 0, review: 0, waiting: 1, done: 1 })
  })
})

describe('the remembered choice', () => {
  it('reads back what was saved and refuses anything else', () => {
    expect(parseView(JSON.stringify({ stage: 'review', pendingOnly: true, sort: 'number' }))).toEqual({ stage: 'review', pendingOnly: true, sort: 'number' })
    expect(parseView('{"stage":"nope","sort":"x","pendingOnly":"yes"}')).toEqual(DEFAULT_VIEW)
    expect(parseView('not json')).toEqual(DEFAULT_VIEW)
    expect(parseView(null)).toEqual(DEFAULT_VIEW)
  })
})
