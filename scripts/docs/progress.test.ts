import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchIssue, countChecks, docForIssue, pendingApprovals, progressFor } from './build.mjs'
import { docsForEvent, issuesOfPull } from './event-docs.mjs'
import { parseDoc, toRow } from '../../src/docs/ingest'

const REPO = 'Rowan-Hyeho-Song/agent-office'
const URL = `https://github.com/${REPO}`
const OWNER = { author_association: 'OWNER', user: { login: 'Rowan-Hyeho-Song' } }
const STRANGER = { author_association: 'NONE', user: { login: 'someone' } }

const issue = (over: object = {}) => ({ ...OWNER, number: 241, title: '[기능] 진행 상황', body: '', state: 'open', html_url: `${URL}/issues/241`, created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', ...over })
const pr = (over: object = {}) => ({ ...OWNER, number: 300, state: 'open', draft: false, merged_at: null, body: '', head: { ref: 'feature/999-other' }, ...over })

describe('countChecks (#241)', () => {
  it('counts - [ ] and - [x]; null when there are none', () => {
    expect(countChecks('## 완료 기준\n- [x] a\n- [ ] b\n- [ ] c')).toEqual({ done: 1, total: 3 })
    expect(countChecks('아무 것도 없음')).toBeNull()
    expect(countChecks('')).toBeNull()
    expect(countChecks(null)).toBeNull()
  })
  it('nested items, * + and numbered markers, upper-case X, CRLF', () => {
    expect(countChecks('- [x] a\r\n  - [X] 안쪽\r\n    * [ ] 더 안쪽\r\n+ [ ] p\r\n1. [x] 번호')).toEqual({ done: 3, total: 5 })
  })
  it('not the ones in code blocks or HTML comments; not malformed boxes', () => {
    const body = '- [x] 진짜\n```md\n- [ ] 코드 안\n```\n~~~\n- [x] 물결 안\n~~~\n<!--\n- [ ] 주석\n-->\n- [] 빈 칸 없음\n- [ ]\n-[ ] 붙음\n- [y] 이상\n- [ ] 진짜 둘'
    expect(countChecks(body)).toEqual({ done: 1, total: 2 })
  })
  it('a fence that is never closed hides the rest (like markdown)', () => {
    expect(countChecks('- [ ] a\n```\n- [ ] b')).toEqual({ done: 0, total: 1 })
  })
})

describe('pendingApprovals', () => {
  let t = 0
  const c = (body: string, who: object = OWNER) => ({ ...who, body, created_at: `2026-11-10T00:${String(++t).padStart(2, '0')}:00Z`, html_url: `${URL}/issues/241#c${t}` })
  const req = (who?: object) => c('### 🖊 결재 요청 (2026-11-10)\n**종류**: 결정 요청', who)
  const res = (who?: object) => c('### ✅ 결재 (2026-11-10)\n**결과**: 승인', who)
  it('requests without a result', () => {
    expect(pendingApprovals([])).toBe(0)
    expect(pendingApprovals([req()])).toBe(1)
    expect(pendingApprovals([req(), req(), req(), res()])).toBe(2)
    expect(pendingApprovals([req(), res()])).toBe(0)
  })
  it('order does not matter, only time; a stray result does not go negative', () => {
    const a = req()
    const b = res()
    expect(pendingApprovals([b, a])).toBe(0)
    expect(pendingApprovals([res(), req()])).toBe(1)
  })
  it("only the owner's count: a stranger's 🖊 adds none and a stranger's ✅ closes none", () => {
    expect(pendingApprovals([req(STRANGER)])).toBe(0)
    expect(pendingApprovals([req(), res(STRANGER)])).toBe(1)
  })
  it('other comments are ignored', () => {
    expect(pendingApprovals([c('그냥 댓글'), req(), c('### 🗂 에이전트 간 협의 기록')])).toBe(1)
  })
})

describe('branchIssue', () => {
  it.each([
    ['feature/241-library-progress', 241],
    ['fix/3-x', 3],
    ['main', null],
    ['dev', null],
    ['feature/abc-241', null],
    ['241-x', null],
  ])('%s', (name, n) => expect(branchIssue(name)).toBe(n))
})

describe('progressFor: the stage (#241)', () => {
  const stage = (i: object, ctx: Parameters<typeof progressFor>[1] = {}) => progressFor(issue(i), ctx).stage
  const merged = '2026-11-10T02:00:00Z'
  it('nothing but the issue: waiting', () => {
    expect(stage({})).toBe('waiting')
    expect(stage({}, { prs: [pr()], branches: ['main', 'feature/999-other'] })).toBe('waiting')
  })
  it('a branch <type>/<n>-…: doing (names or objects; another issue number does not count)', () => {
    expect(stage({}, { branches: ['dev', 'feature/241-library-progress'] })).toBe('doing')
    expect(stage({}, { branches: [{ name: 'fix/241-x' }] })).toBe('doing')
    expect(stage({}, { branches: ['feature/2410-x', 'feature/24-x'] })).toBe('waiting')
  })
  it('an open, non-draft PR: review', () => {
    expect(stage({}, { prs: [pr({ body: 'Closes #241' })] })).toBe('review')
    expect(stage({}, { prs: [pr({ body: 'Refs #241' })] })).toBe('review')
    expect(stage({}, { prs: [pr({ head: { ref: 'feature/241-x' } })], branches: ['feature/241-x'] })).toBe('review')
  })
  it('a draft PR is still being worked on: doing, even without a branch listed', () => {
    expect(stage({}, { prs: [pr({ body: 'Closes #241', draft: true })] })).toBe('doing')
    expect(stage({}, { prs: [pr({ body: 'Closes #241', draft: true }), pr({ number: 302, body: 'Refs #241' })] })).toBe('review')
  })
  it('a closed issue is done, whatever else is going on', () => {
    expect(stage({ state: 'closed' })).toBe('done')
    expect(stage({ state: 'closed' }, { prs: [pr({ body: 'Closes #241' })], branches: ['feature/241-x'] })).toBe('done')
  })
  it('a merged PR that closes it (keyword or its own branch): done even while the issue is open', () => {
    expect(stage({}, { prs: [pr({ body: 'Closes #241', state: 'closed', merged_at: merged })] })).toBe('done')
    expect(stage({}, { prs: [pr({ head: { ref: 'fix/241-x' }, state: 'closed', merged_at: merged })] })).toBe('done')
  })
  it('a merged PR that only refs it leaves the issue doing; an open review PR beats an earlier merged one', () => {
    expect(stage({}, { prs: [pr({ body: 'Refs #241', state: 'closed', merged_at: merged })] })).toBe('doing')
    expect(stage({}, { prs: [pr({ body: 'Closes #241', state: 'closed', merged_at: merged }), pr({ number: 305, body: 'Refs #241' })] })).toBe('review')
  })
  it('a closed, unmerged PR counts for nothing', () => {
    expect(stage({}, { prs: [pr({ body: 'Closes #241', state: 'closed' })] })).toBe('waiting')
  })
  it('several issues in one body; the number must match whole', () => {
    expect(stage({}, { prs: [pr({ body: 'Closes #7, closes #241' })] })).toBe('review')
    expect(stage({}, { prs: [pr({ body: 'Closes #2410' })] })).toBe('waiting')
  })
  it("a stranger's PR cannot move the stage", () => {
    expect(stage({}, { prs: [pr({ ...STRANGER, body: 'Closes #241' })] })).toBe('waiting')
  })
  it('checks and pending ride along', () => {
    const p = progressFor(issue({ body: '- [x] a\n- [ ] b' }), { comments: [{ ...OWNER, body: '### 🖊 결재 요청 (d)', created_at: '2026-11-10T01:00:00Z' }] })
    expect(p).toEqual({ stage: 'waiting', checks: { done: 1, total: 2 }, pending: 1 })
    expect(progressFor(issue()).checks).toBeNull()
  })
})

describe('the plan document carries it, the server keeps only a valid one', () => {
  const progress = { stage: 'review', checks: { done: 3, total: 5 }, pending: 1 }
  const input = (meta: Record<string, unknown>, kind = 'plan') => {
    const d = docForIssue(issue(), REPO, progress as never)!
    return parseDoc({ ...d, kind, meta: { ...d.meta, ...meta } })!
  }
  const cfg = { publicRepos: [REPO], banned: [] }
  it('docForIssue puts it in meta.progress; without it, none', () => {
    expect(docForIssue(issue(), REPO, progress as never)?.meta?.progress).toEqual(progress)
    expect(docForIssue(issue(), REPO)?.meta).not.toHaveProperty('progress')
  })
  it('toRow stores it in data.progress', () => {
    expect(toRow(input({}), cfg).data.progress).toEqual(progress)
  })
  it('nonsense is not stored', () => {
    for (const bad of [{ stage: 'x' }, { stage: 'doing', checks: { done: 9, total: 2 } }, { stage: 'doing', pending: -3 }, { stage: 'doing', checks: { done: 0, total: 10_000_000 } }, 'review', null, 7]) {
      expect(toRow(input({ progress: bad }), cfg).data).not.toHaveProperty('progress')
    }
  })
  it('only a plan carries it', () => {
    expect(toRow(input({}, 'report'), cfg).data).not.toHaveProperty('progress')
    expect(toRow(input({}, 'minutes'), cfg).data).not.toHaveProperty('progress')
  })
})

describe('docsForEvent: what each GitHub event files', () => {
  type State = { issues?: Record<number, object>; prs?: object[]; branches?: string[]; comments?: Record<number, object[]> }
  /** a GitHub that answers from memory and records its calls */
  function fakeGh(state: State = {}) {
    const calls: string[] = []
    return {
      calls,
      gh: {
        async get(path: string) {
          calls.push(path)
          const m = /\/issues\/(\d+)$/.exec(path)
          const found = m && state.issues?.[Number(m[1])]
          if (!found) throw new Error(`GitHub 404 ${path}`)
          return found
        },
        async all(path: string) {
          calls.push(path)
          if (path.includes('/pulls')) return state.prs ?? []
          if (path.includes('/branches')) return (state.branches ?? []).map((name) => ({ name }))
          const m = /\/issues\/(\d+)\/comments/.exec(path)
          return (m && state.comments?.[Number(m[1])]) || []
        },
        async openIssues() {
          return 4
        },
      },
    }
  }
  const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures/pull_request-opened.json'), 'utf8'))
  const kinds = (docs: { kind: string }[]) => docs.map((d) => d.kind)

  it('a recorded pull_request opened event re-files the plan of the issue it closes, now in review, and nothing else', async () => {
    const { gh } = fakeGh({ issues: { 241: issue({ body: '- [x] a\n- [ ] b' }) }, prs: [sample.pull_request], branches: ['feature/241-library-progress'] })
    const out = await docsForEvent('pull_request', sample, REPO, gh)
    expect(out.docs).toHaveLength(1)
    expect(out.docs[0]).toMatchObject({ kind: 'plan', folder: 241, meta: { progress: { stage: 'review', checks: { done: 1, total: 2 }, pending: 0 } } })
    expect(out.approvals).toEqual([])
    expect(out.project).toBeUndefined()
  })
  it("a stranger's PR does nothing, not even a GitHub call", async () => {
    const { gh, calls } = fakeGh({ issues: { 241: issue() } })
    const stranger = { ...sample, pull_request: { ...sample.pull_request, author_association: 'NONE' } }
    expect((await docsForEvent('pull_request', stranger, REPO, gh)).docs).toEqual([])
    expect(calls).toEqual([])
  })
  it("a PR naming an issue written by a stranger, or a pull request's number, files nothing", async () => {
    expect((await docsForEvent('pull_request', sample, REPO, fakeGh({ issues: { 241: issue({ ...STRANGER }) } }).gh)).docs).toEqual([])
    expect((await docsForEvent('pull_request', sample, REPO, fakeGh({ issues: { 241: issue({ pull_request: {} }) } }).gh)).docs).toEqual([])
    expect((await docsForEvent('pull_request', sample, REPO, fakeGh({}).gh)).docs).toEqual([])
  })
  it('a merged PR still files its report, and the plan is refreshed too', async () => {
    const mergedEvent = { ...sample, action: 'closed', pull_request: { ...sample.pull_request, state: 'closed', merged_at: '2026-11-10T03:00:00Z' } }
    const { gh } = fakeGh({ issues: { 241: issue({ state: 'closed' }) }, prs: [mergedEvent.pull_request] })
    const out = await docsForEvent('pull_request', mergedEvent, REPO, gh)
    expect(kinds(out.docs)).toEqual(['report', 'plan'])
    expect(out.docs[1].meta.progress.stage).toBe('done')
  })
  it('a branch created: the plan of its issue goes to doing; a tag or a branch without a number does nothing', async () => {
    const { gh } = fakeGh({ issues: { 241: issue() }, branches: ['feature/241-x'] })
    const created = await docsForEvent('create', { ref: 'feature/241-x', ref_type: 'branch' }, REPO, gh)
    expect(created.docs[0].meta.progress.stage).toBe('doing')
    expect((await docsForEvent('create', { ref: 'v1', ref_type: 'tag' }, REPO, gh)).docs).toEqual([])
    expect((await docsForEvent('create', { ref: 'dev', ref_type: 'branch' }, REPO, gh)).docs).toEqual([])
  })
  it('a branch deleted: back to waiting', async () => {
    const { gh } = fakeGh({ issues: { 241: issue() }, branches: [] })
    expect((await docsForEvent('delete', { ref: 'feature/241-x', ref_type: 'branch' }, REPO, gh)).docs[0].meta.progress.stage).toBe('waiting')
  })
  it("an issue event: the plan with progress, the opened mark, the project count; a stranger's issue no plan and no list calls", async () => {
    const out = await docsForEvent('issues', { action: 'opened', issue: issue({ body: '- [ ] a' }) }, REPO, fakeGh().gh)
    expect(out.docs[0].meta).toMatchObject({ opened: true, progress: { stage: 'waiting', checks: { done: 0, total: 1 } } })
    expect(out.project).toEqual({ repo: REPO, open_issues: 4 })
    const { gh, calls } = fakeGh()
    expect((await docsForEvent('issues', { action: 'opened', issue: issue({ ...STRANGER }) }, REPO, gh)).docs).toEqual([])
    expect(calls.filter((c) => c.includes('/pulls'))).toEqual([])
  })
  it('an owner 🖊 comment re-files the plan with the new pending count; an ordinary comment does not', async () => {
    const request = { ...OWNER, body: '### 🖊 결재 요청 (2026-11-10)\n**종류**: 산출물 확인\n**요청**: 코더', html_url: `${URL}/issues/241#issuecomment-1`, created_at: '2026-11-10T04:00:00Z', updated_at: '2026-11-10T04:00:00Z' }
    const { gh } = fakeGh({ comments: { 241: [] } })
    const out = await docsForEvent('issue_comment', { action: 'created', issue: issue(), comment: request }, REPO, gh)
    expect(out.approvals).toHaveLength(1)
    expect(out.docs.find((d: { kind: string }) => d.kind === 'plan')?.meta.progress.pending).toBe(1)
    const plain = { ...request, body: '그냥 댓글' }
    expect((await docsForEvent('issue_comment', { action: 'created', issue: issue(), comment: plain }, REPO, gh)).docs).toEqual([])
  })
  it('issuesOfPull: keywords, Refs, the branch; at most a few', () => {
    expect(issuesOfPull({ body: 'Closes #1\nRefs #2, related to #3', head: { ref: 'fix/4-x' } })).toEqual([1, 2, 3, 4])
    expect(issuesOfPull({ body: '', head: { ref: 'dev' } })).toEqual([])
    expect(issuesOfPull({ body: Array.from({ length: 20 }, (_, i) => `Closes #${i + 1}`).join('\n') })).toHaveLength(5)
  })
})
