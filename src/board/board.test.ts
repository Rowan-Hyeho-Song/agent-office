import { describe, expect, it } from 'vitest'
import { coverOf, groupLibrary, type DocMeta } from '../docs/library'
import type { Point } from '../timeline/types'
import officeFile from '../timeline/fixtures/agent-office.json'
import hubFile from '../timeline/fixtures/rowansong.dev.json'
import { boardSignature, cardAt, layoutBoard, wrapLines, type Measure } from './layout'
import { BoardStore } from './store'
import { boardFromLibrary, emptyBoard, foldBoard, splitDecision, type BoardCard, type BoardState } from './state'

/** every character 20 px wide: a 48 px line of 330 - 36 px holds 14 characters */
const measure: Measure = (t) => [...t].length * 20

const card = (n: number, title: string | null = `t${n}`, at = `2026-11-08T00:${String(n).padStart(2, '0')}:00Z`): BoardCard => ({ key: `o/r#${n}`, repo: 'o/r', n, title, seat: 3, at })

describe('wrapLines', () => {
  it('breaks at spaces', () => {
    expect(wrapLines('책상 LIVE 연결 작업', 140, 48, true, measure, 3)).toEqual(['책상 LIVE', '연결 작업'])
  })
  it('cuts a word wider than a line by character, and ends with an ellipsis past maxLines', () => {
    expect(wrapLines('abcdefghijklmnop', 100, 48, true, measure, 2)).toEqual(['abcde', 'fghi…'])
    expect(wrapLines('가나 다라 마바 사아', 60, 48, true, measure, 2)).toEqual(['가나', '다라…'])
  })
  it('keeps a short text on one line', () => {
    expect(wrapLines('짧게', 300, 48, true, measure, 2)).toEqual(['짧게'])
  })
})

describe('layoutBoard', () => {
  const state = (): BoardState => ({
    doing: [card(1), card(2)],
    review: [],
    done: [1, 2, 3, 4, 5, 6, 7].map((n) => card(n + 10)),
    decisions: [1, 2, 3, 4, 5].map((n) => ({ key: `d${n}`, repo: 'o/r', n, title: `결정 ${n}`, note: n === 1 ? '보충 설명' : null, at: `2026-11-08T00:0${n}:00Z` })),
  })
  it('shows four cards per column and "+N" for the rest', () => {
    const l = layoutBoard(state(), measure)
    expect(l.columns.map((c) => [c.cards.length, c.more, c.count])).toEqual([[2, 0, 2], [0, 0, 0], [4, 3, 7]])
  })
  it('shows three notes, tilts everything within a degree and a half', () => {
    const l = layoutBoard(state(), measure)
    expect(l.notes).toHaveLength(3)
    expect(l.notes[0].noteLines).toEqual(['보충 설명'])
    expect(l.notes[1].noteLines).toEqual([])
    for (const c of l.columns) for (const k of c.cards) expect(Math.abs(k.tilt)).toBeLessThanOrEqual(1)
  })
  it('a SECRET card has no title lines', () => {
    const l = layoutBoard({ ...emptyBoard(), review: [card(5, null)] }, measure)
    expect(l.columns[1].cards[0].lines).toEqual([])
  })
  it('wraps card titles by spaces, two lines at most', () => {
    const l = layoutBoard({ ...emptyBoard(), doing: [card(1, '책상 소품 모델 만들기 아주 길게 이어지는 제목')] }, measure)
    expect(l.columns[0].cards[0].lines).toHaveLength(2)
    expect(l.columns[0].cards[0].lines[0]).toBe('책상 소품 모델 만들기')
  })
  it('finds the card under a canvas point', () => {
    const l = layoutBoard(state(), measure)
    const k = l.columns[0].cards[1]
    expect(cardAt(l, k.x + 10, k.y + 10)?.card.n).toBe(2)
    expect(cardAt(l, 5, 5)).toBeNull()
  })
  it('signature ignores cards past the shown four', () => {
    const a = state()
    const b = { ...state(), done: [...a.done] }
    expect(boardSignature(a)).toBe(boardSignature(b))
    expect(boardSignature(a)).not.toBe(boardSignature({ ...b, done: [...a.done, card(99)] }))
  })
})

describe('BoardStore', () => {
  it('notifies only when what would be drawn changes', () => {
    const s = new BoardStore()
    let n = 0
    s.subscribe(() => n++)
    s.set({ ...emptyBoard() })
    expect(n).toBe(0)
    s.set({ ...emptyBoard(), doing: [card(1)] })
    s.set({ ...emptyBoard(), doing: [card(1)] })
    expect(n).toBe(1)
  })
})

describe('splitDecision', () => {
  it('splits at the first ": "', () => {
    expect(splitDecision('손 모양: A 엄지·검지: 장갑')).toEqual({ title: '손 모양', note: 'A 엄지·검지: 장갑' })
    expect(splitDecision('콜론 없음')).toEqual({ title: '콜론 없음', note: null })
  })
})

describe('boardFromLibrary', () => {
  let id = 0
  const meta = (over: Partial<DocMeta> & Pick<DocMeta, 'kind'>, day: number): DocMeta =>
    coverOf({ id: ++id, repo: 'o/r', folder: 1, title: '제목', agents: [3], grade: 'public', approved: true, created_at: `2026-11-0${day}T00:00:00Z`, updated_at: `2026-11-0${day}T00:00:00Z`, ...over })
  it('maps documents to columns and hides what a visitor may not see', () => {
    const metas = [
      meta({ kind: 'plan', folder: 1, title: '진행' }, 1),
      meta({ kind: 'plan', folder: 2, title: '끝' }, 2),
      meta({ kind: 'report', folder: 2, title: '끝' }, 3),
      meta({ kind: 'plan', repo: 'o/priv', folder: 3, title: '비밀', grade: 'review', approved: false, agents: [0] }, 4),
      meta({ kind: 'plan', folder: 9, title: '개인', grade: 'private', approved: false }, 5),
      meta({ kind: 'decision', folder: 2, title: '끝' }, 6),
    ]
    const b = boardFromLibrary(groupLibrary(metas))
    expect(b.doing.map((c) => [c.n, c.title])).toEqual([[1, '진행']])
    expect(b.done.map((c) => c.n)).toEqual([2])
    expect(b.review.map((c) => [c.n, c.title, c.seat])).toEqual([[3, null, 0]]) // SECRET: number yes, title no
    expect([...b.doing, ...b.review, ...b.done].some((c) => c.title === '개인' || c.title === '비밀')).toBe(false)
    expect(b.decisions.map((d) => [d.n, d.title])).toEqual([[2, '끝']])
  })
})

describe('foldBoard', () => {
  const P = 'o/r'
  const pt = (over: Partial<Point> & Pick<Point, 'kind' | 'at'>): Point => ({
    key: `k${Math.random()}`, project: P, agent: 3, title: '', secret: false, additions: null, deletions: null, files: null, issue: null, pr: null, tier: 'public', ...over,
  })
  const points: Point[] = [
    pt({ kind: 'plan', at: '2026-11-01T00:00:00Z', issue: 1, title: '첫째', agent: 0 }),
    pt({ kind: 'plan', at: '2026-11-02T00:00:00Z', issue: 2, title: '둘째', agent: 2 }),
    pt({ kind: 'approval', at: '2026-11-03T00:00:00Z', issue: 2, title: '결재 요청: 둘째' }),
    pt({ kind: 'work', at: '2026-11-04T00:00:00Z', issue: 1, pr: 5, title: 'feat (#1) (#5)', agent: 3 }),
    pt({ kind: 'approval', at: '2026-11-05T00:00:00Z', issue: 2, title: '결재: 둘째' }),
    pt({ kind: 'decision', at: '2026-11-05T01:00:00Z', issue: 2, title: '방향: 이렇게 한다' }),
    pt({ kind: 'work', at: '2026-11-06T00:00:00Z', issue: null, title: '직접 커밋' }),
    pt({ kind: 'plan', at: '2026-11-06T00:00:00Z', issue: null, secret: true, project: 'o/priv', tier: 'review' }),
  ]
  const at = (d: number) => `2026-11-0${d}T12:00:00Z`
  const ns = (cs: BoardCard[]) => cs.map((c) => c.n)
  it('is empty before the first point', () => {
    expect(foldBoard(points, '2026-10-31T00:00:00Z')).toEqual(emptyBoard())
  })
  it('opens cards in 진행 중, moves them to 검토 on a request and 완료 on a merged PR', () => {
    expect(ns(foldBoard(points, at(2)).doing)).toEqual([2, 1])
    const b3 = foldBoard(points, at(3))
    expect([ns(b3.doing), ns(b3.review)]).toEqual([[1], [2]])
    const b4 = foldBoard(points, at(4))
    expect([ns(b4.doing), ns(b4.review), ns(b4.done)]).toEqual([[], [2], [1]])
    expect(b4.done[0]).toMatchObject({ title: '첫째', seat: 3 }) // title from the plan, seat from the latest point
    const b5 = foldBoard(points, at(5))
    expect([ns(b5.doing), ns(b5.review)]).toEqual([[2], []])
    expect(b5.decisions).toMatchObject([{ title: '방향', note: '이렇게 한다', n: 2 }])
  })
  it('never makes cards from SECRET or issue-less points, and filters by project', () => {
    const b = foldBoard(points, at(9))
    expect(ns([...b.doing, ...b.review, ...b.done])).toEqual([2, 1])
    expect(foldBoard(points, at(9), { project: 'x/y' })).toEqual(emptyBoard())
  })
  it('a late approval does not reopen a finished card', () => {
    const b = foldBoard([...points, pt({ kind: 'approval', at: '2026-11-07T00:00:00Z', issue: 1, title: '결재 요청: x' })], at(9))
    expect(ns(b.done)).toContain(1)
  })
  it('accepts a time in ms and folds the real fixtures', () => {
    const all = [...officeFile.points, ...hubFile.points] as Point[]
    const end = foldBoard(all, Date.parse('2030-01-01T00:00:00Z'))
    const total = end.doing.length + end.review.length + end.done.length
    expect(total).toBeGreaterThan(10)
    expect(end.done.length).toBeGreaterThan(5)
    expect(end.decisions.length).toBeGreaterThan(0)
    // rowansong.dev points are review (SECRET): nothing of them reaches the board
    expect([...end.doing, ...end.review, ...end.done].every((c) => c.repo === officeFile.project)).toBe(true)
    expect(foldBoard(all, Date.parse('2026-11-07T15:00:00Z')).done.length).toBeLessThanOrEqual(end.done.length)
  })
})
