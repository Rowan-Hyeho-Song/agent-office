import { describe, expect, it } from 'vitest'
import { coverOf, groupLibrary, type CoverSource, type DocFile } from './library'
import { DEFAULT_VIEW } from './progressList'
import type { Progress } from './progress'
import { doneAtOf, groupFiles, groupHead, groupOf, isOpen, kstDot, listedFiles, parseDeploy, parseFolds, type Deploy, type DeployPoint } from './deployGroups'

let id = 0
const file = (n: number, progress: Progress | null, day = n): DocFile => {
  const at = `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`
  const c: CoverSource = { id: ++id, kind: 'plan', repo: 'o/r', folder: n, title: `t${n}`, agents: [], grade: 'public', approved: true, created_at: at, updated_at: at, progress }
  return groupLibrary([coverOf(c)])[0].files[0]
}
const done = (_n: number, doneAt?: string): Progress => ({ stage: 'done', checks: null, pending: 0, ...(doneAt ? { doneAt } : {}) })
const p = (stage: Progress['stage'], pending = 0): Progress => ({ stage, checks: null, pending })
const point = (key: string, at: string, title: string, pr: number | null = 1, project = 'o/r'): DeployPoint => ({ key, project, at, title, pr })
const deploy = (key: string, at: string, title = '', pr: number | null = 1, project = 'o/r'): Deploy => parseDeploy(point(key, at, title, pr, project))

describe('parseDeploy (#462)', () => {
  it('a release: the version, the summary after the dash', () => {
    expect(parseDeploy(point('k', '2026-11-15T03:00:00Z', 'release: v1.1.0 — 쪽지 · 냉장고', 470))).toMatchObject({ version: '1.1.0', suffix: '', summary: '쪽지 · 냉장고', pr: 470 })
  })
  it('an older deploy: no version, the bracket word after the date, the summary', () => {
    expect(parseDeploy(point('k', 'x', 'deploy: dev → main (2026-11-10 3차) — 방 확장 · 라운지 동작 · …'))).toMatchObject({ version: null, suffix: '3차', summary: '방 확장 · 라운지 동작 · …' })
    expect(parseDeploy(point('k', 'x', 'deploy: dev → main (2026-11-14 핫픽스) — 둘러보기 끊김'))).toMatchObject({ suffix: '핫픽스' })
    expect(parseDeploy(point('k', 'x', 'deploy: dev → main (2026-11-12) — a'))).toMatchObject({ suffix: '', summary: 'a' })
  })
  it('a merge line (before the PR titles were sent): nothing but the PR', () => {
    expect(parseDeploy(point('k', 'x', 'Merge pull request #5 from o/dev', 5))).toMatchObject({ version: null, suffix: '', summary: '', pr: 5 })
  })
  it('a version only in the summary is not the release’s', () => {
    expect(parseDeploy(point('k', 'x', 'deploy: dev → main (2026-11-12) — v2.0.0 준비')).version).toBeNull()
  })
  it('a SECRET point: no title, no PR', () => {
    expect(parseDeploy({ ...point('k', 'x', '', 9), secret: true })).toMatchObject({ version: null, summary: '', pr: null })
  })
})

describe('kstDot: the Seoul day, as the deploy titles', () => {
  it('11-11 15:32 UTC is 11.12', () => expect(kstDot('2026-11-11T15:32:00Z')).toBe('11.12'))
})

describe('groupFiles (#462, docs-ui.md 2.6)', () => {
  const ds = [deploy('d2', '2026-11-12T00:00:00Z', 'release: v1.0.0 — b', 20), deploy('d1', '2026-11-08T00:00:00Z', '', 10), deploy('other', '2026-11-30T00:00:00Z', '', 1, 'o/else')]
  const files = [
    file(1, done(1, '2026-11-07T00:00:00Z')),
    file(2, done(2, '2026-11-08T00:00:00Z')), // the same moment as the deploy: in it
    file(3, done(3, '2026-11-10T00:00:00Z')),
    file(4, done(4, '2026-11-13T00:00:00Z')), // after the last deploy: next
    file(5, p('doing')),
    file(6, p('waiting', 1)),
    file(7, done(7)), // no doneAt: its newest document (11-07)
  ]
  it('지금 하는 일 on top (2.5 order), then next, then the deploys newest first; other projects ignored', () => {
    const g = groupFiles(files, ds, 'O/R', DEFAULT_VIEW)!
    expect(g.now.map((f) => f.n)).toEqual([5, 6])
    expect(g.done.map((x) => [x.kind, x.key, x.files.map((f) => f.n)])).toEqual([
      ['next', 'next:O/R', [4]],
      ['deploy', 'd2', [3]],
      ['deploy', 'd1', [2, 7, 1]],
    ])
  })
  it('a deploy that shipped no file is left out; no next when nothing waits', () => {
    const g = groupFiles([file(1, done(1, '2026-11-07T00:00:00Z'))], ds, 'o/r', DEFAULT_VIEW)!
    expect(g.done.map((x) => x.key)).toEqual(['d1'])
  })
  it('the 완료 filter drops 지금 하는 일; the other filters and 결재 대기만 are flat (null)', () => {
    expect(groupFiles(files, ds, 'o/r', { ...DEFAULT_VIEW, stage: 'done' })!.now).toEqual([])
    expect(groupFiles(files, ds, 'o/r', { ...DEFAULT_VIEW, stage: 'doing' })).toBeNull()
    expect(groupFiles(files, ds, 'o/r', { ...DEFAULT_VIEW, pendingOnly: true })).toBeNull()
  })
  it('the sort only works inside a group', () => {
    const g = groupFiles(files, ds, 'o/r', { ...DEFAULT_VIEW, sort: 'number' })!
    expect(g.done.find((x) => x.key === 'd1')!.files.map((f) => f.n)).toEqual([7, 2, 1])
    expect(g.done.map((x) => x.key)).toEqual(['next:o/r', 'd2', 'd1'])
  })
  it('no deploys (the private folder, or a project without one): the month it was done, newest first', () => {
    const g = groupFiles([file(1, done(1, '2026-10-31T16:00:00Z')), file(2, done(2, '2026-10-30T00:00:00Z'))], ds, null, DEFAULT_VIEW)!
    expect(g.done.map((x) => [x.key, x.files.map((f) => f.n)])).toEqual([
      ['month:private:2026-11', [1]], // 16:00 UTC on the 31st is November in Seoul
      ['month:private:2026-10', [2]],
    ])
  })
  it('every file is in exactly one place', () => {
    const g = groupFiles(files, ds, 'o/r', DEFAULT_VIEW)!
    const all = [...g.now, ...g.done.flatMap((x) => x.files)].map((f) => f.n).sort()
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('doneAtOf falls back to the newest document', () => expect(doneAtOf(file(7, done(7)))).toBe('2026-11-07T00:00:00Z'))
})

describe('groupHead', () => {
  const g = (d: Deploy, n = 5) => ({ kind: 'deploy' as const, key: d.key, deploy: d, files: Array.from({ length: n }, (_, i) => file(i + 1, done(i + 1))) })
  it("a release: 'v1.1.0 · 11.15 · #470 · 5건' and its spoken name", () => {
    const h = groupHead(g(deploy('k', '2026-11-15T03:00:00Z', 'release: v1.1.0 — 쪽지', 470)))
    expect(h).toEqual({ lead: 'v1.1.0', date: '11.15', pr: 470, count: '5건', summary: '쪽지', spoken: '버전 1.1.0, 11월 15일 배포, PR 470, 완료 5건, 쪽지' })
  })
  it("before v1.0.0: the date and the bracket word lead ('11.14 배포 핫픽스')", () => {
    const h = groupHead(g(deploy('k', '2026-11-14T01:00:00Z', 'deploy: dev → main (2026-11-14 핫픽스) — 둘러보기', 442), 3))
    expect(h).toMatchObject({ lead: '11.14 배포 핫픽스', date: '', pr: 442, count: '3건', spoken: '11월 14일 배포 핫픽스, PR 442, 완료 3건, 둘러보기' })
  })
  it('next and month', () => {
    expect(groupHead({ kind: 'next', key: 'n', files: [] })).toMatchObject({ lead: '다음 배포 대기', count: '완료 0건' })
    expect(groupHead({ kind: 'month', key: 'm', month: '2026-11', files: [] })).toMatchObject({ lead: '2026년 11월', count: '완료 0건' })
  })
})

describe('folds', () => {
  const ds = [deploy('d2', '2026-11-12T00:00:00Z'), deploy('d1', '2026-11-08T00:00:00Z')]
  const files = [file(1, done(1, '2026-11-07T00:00:00Z')), file(3, done(3, '2026-11-10T00:00:00Z')), file(4, done(4, '2026-11-13T00:00:00Z'))]
  const g = groupFiles(files, ds, 'o/r', DEFAULT_VIEW)!
  it('next and the newest deploy start open, the rest folded', () => {
    expect(g.done.map((x) => isOpen(x, g.done, {}))).toEqual([true, true, false])
  })
  it('what the viewer changed wins', () => {
    expect(g.done.map((x) => isOpen(x, g.done, { d2: false, d1: true, 'next:o/r': false }))).toEqual([false, false, true])
  })
  it('a new deploy opens alone: the one before goes back to folded unless it was opened by hand', () => {
    const later = groupFiles(files, [deploy('d3', '2026-11-14T00:00:00Z'), ...ds], 'o/r', DEFAULT_VIEW)!
    expect(later.done.map((x) => [x.key, isOpen(x, later.done, {})])).toEqual([
      ['d3', true],
      ['d2', false],
      ['d1', false],
    ])
  })
  it('groupOf finds the group of a file', () => {
    expect(groupOf(g, files[0].key)?.key).toBe('d1')
    expect(groupOf(g, 'nope')).toBeNull()
  })
  it('parseFolds keeps booleans only and survives junk', () => {
    expect(parseFolds('{"a":true,"b":1,"c":false}')).toEqual({ a: true, c: false })
    expect(parseFolds('[1]')).toEqual({})
    expect(parseFolds('{')).toEqual({})
    expect(parseFolds(null)).toEqual({})
  })
})

describe('listedFiles: the deploy PRs are their group headers, not files (#462 designer)', () => {
  const ds = [deploy('d1', '2026-11-08T00:00:00Z', '', 2), deploy('x', '2026-11-08T00:00:00Z', '', 3, 'o/else'), deploy('s', '2026-11-09T00:00:00Z', '', null)]
  const files = [file(1, done(1)), file(2, done(2)), file(3, done(3))]
  it("this project's deploy PR numbers are left out (and so out of the counts); other projects' are not", () => {
    expect(listedFiles(files, ds, 'O/R').map((f) => f.n)).toEqual([1, 3])
  })
  it('the private folder, or no deploys: all of them', () => {
    expect(listedFiles(files, ds, null)).toHaveLength(3)
    expect(listedFiles(files, [], 'o/r')).toHaveLength(3)
  })
})
