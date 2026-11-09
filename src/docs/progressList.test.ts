import { describe, expect, it } from 'vitest'
import { coverOf, groupLibrary, type CoverSource, type DocFile, type DocMeta } from './library'
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
  it('진행 중 → 검토 → 결재 대기 → 대기 → 완료, newest first inside each (no progress = 대기, #301)', () => {
    expect(order()).toEqual([5, 4, 3, 6, 7, 2, 1, 8])
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
  it('one stage; a file with no progress counts as 대기 (#301)', () => {
    expect(order({ ...DEFAULT_VIEW, stage: 'doing' })).toEqual([5, 4])
    expect(order({ ...DEFAULT_VIEW, stage: 'done' })).toEqual([1, 8])
    expect(order({ ...DEFAULT_VIEW, stage: 'waiting' })).toEqual([6, 7, 2])
  })
  it('결재 대기만 combines with a stage', () => {
    expect(order({ ...DEFAULT_VIEW, pendingOnly: true })).toEqual([6, 8])
    expect(order({ stage: 'waiting', pendingOnly: true, sort: 'default' })).toEqual([6])
  })
  it('counts follow the toggle', () => {
    expect(stageCounts(files, { pendingOnly: false })).toEqual({ all: 8, doing: 2, review: 1, waiting: 3, done: 2 })
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

describe('every file has a status (designer, #301)', () => {
  it('a file the pipeline sent no progress for: 완료 with a merged PR report, else 대기; the chips add up to 전체', () => {
    const base = { kind: 'plan' as const, repo: 'o/r', title: 't', agents: [], labels: [], grade: 'public' as const, approved: true, readable: true, created_at: '2026-11-01', updated_at: '2026-11-01' }
    const metas: DocMeta[] = [
      { ...base, id: 1, folder: 1, progress: { stage: 'doing', checks: null, pending: 0 } },
      { ...base, id: 2, folder: 2 },
      { ...base, id: 3, folder: 3 },
      { ...base, id: 4, folder: 3, kind: 'report' },
      { ...base, id: 5, folder: 4, kind: 'minutes' },
    ]
    const files = groupLibrary(metas).flatMap((f) => f.files)
    const by = (n: number) => files.find((f) => f.n === n)!.progress
    expect(by(1)).toMatchObject({ stage: 'doing' })
    expect(by(1).guessed).toBeUndefined()
    expect(by(2)).toMatchObject({ stage: 'waiting', guessed: true, checks: null, pending: 0 })
    expect(by(3)).toMatchObject({ stage: 'done', guessed: true })
    expect(by(4)).toMatchObject({ stage: 'waiting', guessed: true })
    const c = stageCounts(files, { pendingOnly: false })
    expect(c.waiting + c.doing + c.review + c.done).toBe(c.all)
    expect(c.all).toBe(files.length)
  })
})
