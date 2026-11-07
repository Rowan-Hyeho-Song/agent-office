import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commentKind, docForComment, docForIssue, docForPull, requestAnswered, trusted } from './build.mjs'

const REPO = 'Rowan-Hyeho-Song/agent-office'
const URL = `https://github.com/${REPO}`
const FIX = join(__dirname, '../../src/docs/fixtures')
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8')

const OWNER = { author_association: 'OWNER', user: { login: 'Rowan-Hyeho-Song' } }
const STRANGER = { author_association: 'NONE', user: { login: 'someone' } }
const issue = { ...OWNER, number: 26, title: '에이전트 정체성', html_url: `${URL}/issues/26`, created_at: '2026-11-08T00:00:00Z', updated_at: '2026-11-08T01:00:00Z' }
let t = 0
const comment = (body: string, who: object = OWNER) => {
  t++
  return { ...who, body, html_url: `${URL}/issues/26#issuecomment-${t}`, created_at: `2026-11-08T02:${String(t).padStart(2, '0')}:00Z`, updated_at: `2026-11-08T02:${String(t).padStart(2, '0')}:00Z` }
}
const request = (kind: string, who: object = OWNER) => comment(`### 🖊 결재 요청 (2026-11-08)\n**종류**: ${kind}\n**요청**: 기획\n**내용**: …`, who)
const result = (r: string, who: object = OWNER) => comment(`### ✅ 결재 (2026-11-08)\n**결과**: ${r}\n**의견**: …`, who)

describe('who may file (#38)', () => {
  const as = (association: string) => ({ author_association: association, user: { login: 'x' } })
  it.each([
    ['OWNER', true, true],
    ['COLLABORATOR', true, false],
    ['MEMBER', false, false],
    ['CONTRIBUTOR', false, false],
    ['FIRST_TIME_CONTRIBUTOR', false, false],
    ['NONE', false, false],
  ])('%s: documents %s, approvals %s', (association, docs, approvals) => {
    const who = as(association)
    expect(docForIssue({ ...issue, ...who, body: 'b' }, REPO) !== null).toBe(docs)
    expect(docForComment(comment(fixture('minutes-6709681788.md'), who), issue, REPO) !== null).toBe(docs)
    expect(docForPull({ ...who, number: 9, html_url: `${URL}/pull/9`, created_at: 'x', merged_at: '2026-11-08T00:00:00Z', body: 'Closes #1' }, REPO) !== null).toBe(docs)
    const q = request('결정 요청')
    const r = result('선택지 1', who)
    expect(docForComment(r, issue, REPO, [q, r]) !== null).toBe(approvals)
  })

  it('a missing association is a stranger', () => {
    expect(trusted({})).toBe(false)
    expect(docForIssue({ ...issue, author_association: undefined }, REPO)).toBeNull()
  })

  it("a stranger's fake ✅ makes no decision, and a stranger's 🖊 / ✅ can't shift the owner's pairing", () => {
    const q1 = request('결정 요청')
    const fakeRequest = request('산출물 확인', STRANGER)
    const fakeResult = result('승인', STRANGER)
    const r1 = result('선택지 2')
    const all = [q1, fakeRequest, fakeResult, r1]
    expect(docForComment(fakeResult, issue, REPO, all)).toBeNull()
    // the owner's result still answers the owner's 결정 요청
    const d = docForComment(r1, issue, REPO, all)
    expect(d?.kind).toBe('decision')
    expect(d!.meta).toMatchObject({ request: q1.body, requestAuthor: { association: 'OWNER' } })
  })

  it("a ✅ answering a stranger's 🖊 is not a decision", () => {
    const fake = request('결정 요청', STRANGER)
    const r = result('승인')
    expect(docForComment(r, issue, REPO, [fake, r])).toBeNull()
  })

  it('documents carry their author for the server check', () => {
    expect(docForIssue({ ...issue, body: '' }, REPO)!.author).toEqual({ login: 'Rowan-Hyeho-Song', association: 'OWNER' })
  })
})

describe('commentKind', () => {
  it('recognizes every real fixture', () => {
    for (const f of readdirSync(FIX)) {
      const kind = commentKind(fixture(f))
      if (f.startsWith('minutes-')) expect(kind, f).toBe('minutes')
      else expect(['request', 'result'], f).toContain(kind)
    }
  })
  it('other comments are not documents', () => {
    expect(commentKind('LGTM')).toBeNull()
    expect(commentKind('### 🙋 개성 제안 — 루프')).toBeNull()
    expect(commentKind('### 🪴 책상 꾸미기 — 루프')).toBeNull()
    expect(commentKind('')).toBeNull()
  })
})

describe('docForIssue', () => {
  it('an issue is a plan filed under itself, with state and labels', () => {
    const d = docForIssue({ ...issue, body: 'b', state: 'open', closed_at: null, labels: [{ name: 'feature' }] }, REPO)
    expect(d).toMatchObject({ kind: 'plan', folder: 26, title: '에이전트 정체성', body: 'b', source: { kind: 'issue', url: `${URL}/issues/26` } })
    expect(d!.meta).toEqual({ state: 'open', closed_at: null, labels: ['feature'] })
  })
  it('pull requests in the issues list are skipped, a missing body is empty', () => {
    expect(docForIssue({ ...issue, pull_request: {} }, REPO)).toBeNull()
    expect(docForIssue({ ...issue, body: null }, REPO)!.body).toBe('')
  })
})

describe('docForComment', () => {
  it('a minutes comment → minutes in the issue file', () => {
    const c = comment(fixture('minutes-6709681788.md'))
    expect(docForComment(c, issue, REPO)).toMatchObject({ kind: 'minutes', folder: 26, title: '회의록: 에이전트 정체성', source: { kind: 'comment', url: c.html_url } })
  })

  it('results answer requests in order: 결정 요청 → decision, 산출물 확인 → nothing', () => {
    const reqs = [request('결정 요청'), request('결정 요청'), request('산출물 확인')]
    const results = [result('선택지 1'), result('선택지 1'), result('승인')]
    const all = [...reqs, ...results]
    expect(results.map((r) => requestAnswered(r, all))).toEqual(reqs)
    const docs = results.map((r) => docForComment(r, issue, REPO, all))
    expect(docs.map((d) => d?.kind ?? null)).toEqual(['decision', 'decision', null])
    expect(docs[0]!.meta).toEqual({ request: reqs[0].body, requestAuthor: { login: 'Rowan-Hyeho-Song', association: 'OWNER' } })
    expect(docs[0]!.title).toBe('결정: 에이전트 정체성')
  })

  it('a result without a request, or after one already answered, is not a decision', () => {
    const r = result('승인')
    expect(docForComment(r, issue, REPO, [r])).toBeNull()
    const q = request('결정 요청')
    const r1 = result('선택지 1')
    const r2 = result('선택지 2')
    expect(requestAnswered(r2, [q, r1, r2])).toBeNull()
  })

  it('the result being processed may be missing from the fetched list (it is added)', () => {
    const q = request('결정 요청')
    const r = result('선택지 2')
    expect(docForComment(r, issue, REPO, [q])?.kind).toBe('decision')
  })

  it('comments on pull requests, requests themselves and chatter are not documents', () => {
    expect(docForComment(comment(fixture('minutes-6709681788.md')), { ...issue, pull_request: {} }, REPO)).toBeNull()
    expect(docForComment(request('결정 요청'), issue, REPO)).toBeNull()
    expect(docForComment(comment('고맙습니다'), issue, REPO)).toBeNull()
  })
})

describe('docForPull', () => {
  const pr = { ...OWNER, number: 31, title: '사무실 이동·놀이', html_url: `${URL}/pull/31`, created_at: '2026-11-08T03:00:00Z', merged_at: '2026-11-08T04:00:00Z' }
  it('a merged PR is a report filed under the issue it closes', () => {
    expect(docForPull({ ...pr, body: '<!-- 대상 -->\n\nCloses #17\n\n## 무엇을, 왜' }, REPO)).toMatchObject({
      kind: 'report',
      folder: 17,
      updated_at: pr.merged_at,
      meta: { pr: 31, merged_at: pr.merged_at },
    })
  })
  it('else under the issue it refers to, else under itself', () => {
    expect(docForPull({ ...pr, body: 'Refs #28\n\n## 무엇을, 왜' }, REPO)!.folder).toBe(28)
    expect(docForPull({ ...pr, body: 'fixes: #9, refs #2' }, REPO)!.folder).toBe(9)
    expect(docForPull({ ...pr, body: '' }, REPO)!.folder).toBe(31)
  })
  it('an unmerged PR is not a report', () => {
    expect(docForPull({ ...pr, merged_at: null, body: 'Closes #17' }, REPO)).toBeNull()
  })
})
