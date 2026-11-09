import { describe, expect, it } from 'vitest'
import { coverOf, groupLibrary, ownerMeta, type CoverSource } from './library'
import { prefixParts, topicsOf, TOPICS } from './topics'

describe('topicsOf', () => {
  it('reads labels first', () => {
    expect(topicsOf(['bug'], '[디자인] x')).toEqual(['bug', 'design'])
    expect(topicsOf(['design', 'asset'], '[버그] x')).toEqual(['design', 'asset'])
  })
  it('knows the aliases of a label', () => {
    expect(topicsOf(['enhancement'], null)).toEqual(['feature'])
    expect(topicsOf(['documentation'], null)).toEqual(['docs'])
    expect(topicsOf(['Accessibility'], null)).toEqual(['a11y'])
  })
  it('falls back to the title prefix when there are no labels', () => {
    expect(topicsOf([], '[버그] 고침')).toEqual(['bug'])
    expect(topicsOf([], '[오류] 고침')).toEqual(['bug'])
    expect(topicsOf([], '[3D 에셋] 책상')).toEqual(['asset'])
    expect(topicsOf([], '[사운드] 음악')).toEqual(['sound'])
    expect(topicsOf([], '[소리] 음악')).toEqual(['sound'])
    expect(topicsOf([], '[UI] 패널')).toEqual(['ui'])
    expect(topicsOf([], '[접근성] 키보드')).toEqual(['a11y'])
    expect(topicsOf([], '[기획] 방향')).toEqual(['plan'])
    expect(topicsOf([], '[성능] 빠르게')).toEqual(['perf'])
    expect(topicsOf([], '[문서] 설명')).toEqual(['docs'])
  })
  it('splits a multi-prefix from the front and keeps two', () => {
    expect(topicsOf([], '[디자인·3D·기능] 책상')).toEqual(['design', 'asset'])
    expect(topicsOf([], '[기능·버그] 책상')).toEqual(['feature', 'bug'])
  })
  it('fills the slots the labels leave from the prefix', () => {
    expect(topicsOf(['enhancement'], '[UI] 패널')).toEqual(['feature', 'ui'])
    expect(topicsOf(['bug'], '[디자인·3D] 책상')).toEqual(['bug', 'design'])
  })
  it('counts a repeated topic once', () => {
    expect(topicsOf(['feature', 'enhancement'], '[기능·디자인] x')).toEqual(['feature', 'design'])
    expect(topicsOf([], '[기능·기능] x')).toEqual(['feature'])
  })
  it('never gives more than two', () => {
    expect(topicsOf(['bug', 'design', 'asset'], '[기능] x')).toEqual(['bug', 'design'])
  })
  it('ignores what is not in the table', () => {
    expect(topicsOf(['question', 'duplicate', 'wontfix'], '잡담')).toEqual([])
    expect(topicsOf(['question', 'bug'], '[잡담·디자인] x')).toEqual(['bug', 'design'])
    expect(topicsOf([7, null, {}], '[기능] x')).toEqual(['feature'])
  })
  it('only a leading bracket counts', () => {
    expect(topicsOf([], '제목 [버그] 가운데')).toEqual([])
    expect(prefixParts('  [디자인·3D] x')).toEqual(['디자인', '3d'])
    expect(prefixParts(null)).toEqual([])
  })
  it('a hidden title (SECRET) leaves only the labels', () => {
    expect(topicsOf([], null)).toEqual([])
    expect(topicsOf(['bug'], null)).toEqual(['bug'])
  })
  it('the table is complete: ten topics, no label or prefix used twice', () => {
    expect(TOPICS).toHaveLength(10)
    const keys = TOPICS.flatMap((t) => [...t.labels, ...t.prefixes])
    expect(new Set(keys).size).toBe(keys.length)
  })
})

const row = (o: Partial<CoverSource> & Pick<CoverSource, 'id'>): CoverSource => ({
  kind: 'plan',
  repo: 'o/agent-office',
  folder: 1,
  title: '[디자인] 제목',
  agents: [],
  labels: ['bug'],
  grade: 'public',
  approved: true,
  created_at: '2026-11-08T01:00:00Z',
  updated_at: '2026-11-08T01:00:00Z',
  ...o,
})

describe('labels follow the title (visitor vs owner)', () => {
  it('public + approved: both see the labels', () => {
    expect(coverOf(row({ id: 1 })).labels).toEqual(['bug'])
    expect(ownerMeta(row({ id: 1 })).labels).toEqual(['bug'])
  })
  it('review: a visitor gets none, the owner gets them', () => {
    const r = row({ id: 2, grade: 'review', approved: false })
    expect(coverOf(r).labels).toEqual([])
    expect(ownerMeta(r).labels).toEqual(['bug'])
  })
  it('private: nobody gets any', () => {
    const r = row({ id: 3, grade: 'private', approved: false })
    expect(coverOf(r).labels).toEqual([])
    expect(ownerMeta(r).labels).toEqual([])
  })
  it('keeps only strings', () => {
    expect(coverOf(row({ id: 4, labels: ['bug', 3, null] as unknown as string[] })).labels).toEqual(['bug'])
    expect(coverOf(row({ id: 5, labels: null as unknown as string[] })).labels).toEqual([])
  })
})

describe('the topics of a file', () => {
  const topics = (rows: CoverSource[], viewer: typeof coverOf) => groupLibrary(rows.map(viewer))[0].files[0].topics
  it('come from the plan, labels then prefix', () => {
    const rows = [row({ id: 1, kind: 'report', title: '[기능] x', labels: [] }), row({ id: 2, labels: ['bug'] })]
    expect(topics(rows, coverOf)).toEqual(['bug', 'design'])
  })
  it('come from the first document that has any when the plan has none', () => {
    const rows = [row({ id: 1, title: '말머리 없음', labels: [] }), row({ id: 2, kind: 'minutes', title: '[소리] 음악', labels: [] })]
    expect(topics(rows, coverOf)).toEqual(['sound'])
  })
  it('a SECRET file has none for a visitor, and its own for the owner', () => {
    const rows = [row({ id: 1, grade: 'review', approved: false })]
    expect(topics(rows, coverOf)).toEqual([])
    expect(topics(rows, ownerMeta)).toEqual(['bug', 'design'])
  })
  it('a private file has none for anyone', () => {
    const rows = [row({ id: 1, grade: 'private', approved: false, repo: 'x/co', folder: 9 })]
    expect(topics(rows, coverOf)).toEqual([])
    expect(topics(rows, ownerMeta)).toEqual([])
  })
  it('none at all gives no badges', () => {
    expect(topics([row({ id: 1, title: '없음', labels: ['question'] })], coverOf)).toEqual([])
  })
})
