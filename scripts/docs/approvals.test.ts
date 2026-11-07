import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approvalForComment } from './build.mjs'

const REPO = 'Rowan-Hyeho-Song/agent-office'
const URL = `https://github.com/${REPO}`
const FIX = join(__dirname, '../../src/docs/fixtures')
const fixture = (id: string) => readFileSync(join(FIX, `approval-${id}.md`), 'utf8')

const OWNER = { author_association: 'OWNER', user: { login: 'Rowan-Hyeho-Song' } }
const STRANGER = { author_association: 'NONE', user: { login: 'someone' } }
const issue = { ...OWNER, number: 26, title: '에이전트 정체성', html_url: `${URL}/issues/26` }

const mk = (id: string, minute: number, who: object = OWNER, body = fixture(id)) => ({
  ...who,
  body,
  html_url: `${URL}/issues/26#issuecomment-${id}`,
  created_at: `2026-11-08T02:${String(minute).padStart(2, '0')}:00Z`,
  updated_at: `2026-11-08T02:${String(minute).padStart(2, '0')}:00Z`,
})

const REQ = ['6709822206', '6709822480', '6709822762']
const RES = ['6709870843', '6709871153', '6709871446']
const owner26 = [...REQ.map((id, i) => mk(id, i)), ...RES.map((id, i) => mk(id, 10 + i))]

describe('approvalForComment', () => {
  it('owner 🖊 → request carrying the author', () => {
    const c = owner26[0]
    expect(approvalForComment(c, issue, REPO, owner26)).toEqual({
      type: 'request',
      repo: REPO,
      folder: 26,
      url: c.html_url,
      title: issue.title,
      body: c.body,
      author: { login: 'Rowan-Hyeho-Song', association: 'OWNER' },
      created_at: c.created_at,
      updated_at: c.updated_at,
    })
  })

  it.each([0, 1, 2])('owner ✅ %i answers request %i (1-1, 2-2, 3-3)', (i) => {
    const a = approvalForComment(owner26[3 + i], issue, REPO, owner26)
    expect(a).toMatchObject({ type: 'result', folder: 26, answers: owner26[i].html_url, author: { association: 'OWNER' } })
  })

  it('a result with no request before it answers null', () => {
    const a = approvalForComment(owner26[3], issue, REPO, [])
    expect(a).toMatchObject({ type: 'result', answers: null })
  })

  it('stranger 🖊 and ✅ → null', () => {
    expect(approvalForComment(mk('6709822206', 1, STRANGER), issue, REPO, [])).toBeNull()
    expect(approvalForComment(mk('6709870843', 2, STRANGER), issue, REPO, [])).toBeNull()
    expect(approvalForComment(mk('6709870843', 2, { author_association: 'COLLABORATOR', user: { login: 'c' } }), issue, REPO, [])).toBeNull()
  })

  it('an owner ✅ after a stranger’s 🖊 does not answer the stranger’s', () => {
    const strangerReq = mk('6709822206', 1, STRANGER)
    const ownerRes = mk('6709870843', 2)
    const a = approvalForComment(ownerRes, issue, REPO, [strangerReq, ownerRes])
    expect(a).toMatchObject({ type: 'result', answers: null })
  })

  it('a stranger’s 🖊 does not shift the owner’s pairing', () => {
    const ownerReq = mk('6709822480', 3)
    const strangerReq = mk('6709822206', 1, STRANGER)
    const ownerRes = mk('6709871153', 4)
    const a = approvalForComment(ownerRes, issue, REPO, [strangerReq, ownerReq, ownerRes])
    expect(a).toMatchObject({ answers: ownerReq.html_url })
  })

  it('comments on PRs → null', () => {
    expect(approvalForComment(owner26[0], { ...issue, pull_request: {} }, REPO, [])).toBeNull()
  })

  it('ordinary comments, empty input → null', () => {
    expect(approvalForComment(mk('x', 1, OWNER, '그냥 댓글'), issue, REPO, [])).toBeNull()
    expect(approvalForComment(mk('x', 1, OWNER, '### 🗂 에이전트 간 협의 기록'), issue, REPO, [])).toBeNull()
    expect(approvalForComment(null, issue, REPO)).toBeNull()
    expect(approvalForComment(owner26[0], null, REPO)).toBeNull()
  })
})
