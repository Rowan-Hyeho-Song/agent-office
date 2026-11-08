import { describe, expect, it } from 'vitest'
import { redact as redactTs } from '../../src/docs/filter'
import { toPoint, mergePoints as mergeTs } from '../../src/timeline/points'
import {
  SEAT_WORDS,
  build,
  collect,
  decisionRows,
  finalize,
  issueSeat,
  mergePoints,
  minutesDecisions,
  minutesSeat,
  seatIn,
  serialize,
  tierFor,
} from './build.mjs'
import { redact } from './filter.mjs'

const PUB = 'Rowan-Hyeho-Song/agent-office'
const REV = 'Rowan-Hyeho-Song/rowansong.dev'
const URL = (r: string) => `https://github.com/${r}`
const cfg = { publicRepos: [PUB] }

const OWNER = { author_association: 'OWNER', user: { login: 'Rowan-Hyeho-Song' } }
const COLLAB = { author_association: 'COLLABORATOR', user: { login: 'friend' } }
const STRANGER = { author_association: 'NONE', user: { login: 'someone' } }

const issue = (n: number, title: string, body = '', extra: object = {}, who: object = OWNER) => ({
  ...who, number: n, title, body, html_url: `${URL(PUB)}/issues/${n}`, created_at: `2026-11-08T0${n}:00:00Z`, labels: [], ...extra,
})
const comment = (n: number, id: number, body: string, who: object = OWNER) => ({
  ...who, body, issue_url: `https://api.github.com/repos/${PUB}/issues/${n}`, html_url: `${URL(PUB)}/issues/${n}#issuecomment-${id}`,
  created_at: `2026-11-08T1${id}:00:00Z`, updated_at: `2026-11-08T1${id}:00:00Z`,
})
const commit = (sha: string, message: string, parents = 1, login = 'Rowan-Hyeho-Song', date = '2026-11-08T05:00:00Z') => ({
  sha, html_url: `${URL(PUB)}/commit/${sha}`, parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
  author: { login }, commit: { message, committer: { date } }, stats: { additions: 10, deletions: 2 }, files: [{ filename: 'src/secret/path.ts' }, { filename: 'b.ts' }],
})
const pull = (n: number, body = '', sha = `sha${n}`) => ({ number: n, body, merged_at: '2026-11-08T05:00:00Z', merge_commit_sha: sha })

const FORM = '## 누가 하나\n코더'
const MINUTES = '### 🗂 에이전트 간 협의 기록 (2026-11-08)\n| 순서 | 보낸 쪽 → 받는 쪽 | 내용 |\n|---|---|---|\n| 1 | 사용자 → 기획 | 해 줘 |\n| 2 | 기획 → 코더 | 이것 |\n\n**결정**: 점은 커밋 하나\n**후속**: 없음'
const REQUEST = '### 🖊 결재 요청 (2026-11-08)\n**종류**: 결정 요청\n**요청**: 코더(루프)\n**내용**: …'
const RESULT = '### ✅ 결재 (2026-11-08)\n**결과**: 승인'

const data = (over: object = {}) => ({
  repo: PUB,
  issues: [issue(1, 'a', FORM), issue(2, '[에셋] b', '', { labels: [{ name: 'asset' }] }), issue(3, '이전 이슈', '무엇')],
  comments: [comment(1, 1, MINUTES), comment(1, 2, REQUEST), comment(1, 3, RESULT)],
  pulls: [pull(4, 'Closes #1'), pull(5, '', 'd1')],
  devCommits: [commit('c1', 'feat: 하나 (#1) (#4)'), commit('c0', 'chore: 처음'), commit('m1', 'Merge branch main', 2)],
  mainCommits: [commit('d1', 'Merge pull request #5 from x/dev', 2), commit('c1', 'feat: 하나 (#1) (#4)')],
  docs: ['## 결정 기록\n\n| 날짜 | 결정 | 이유 |\n|---|---|---|\n| 2026-11-07 | 별도 저장소 | 이유 |'],
  logins: { 'Rowan-Hyeho-Song': 'OWNER' },
  ...over,
})

describe('determinism', () => {
  it('the same input twice gives byte-identical output, whatever the input order', () => {
    const a = serialize(PUB, 'public', build(data(), cfg))
    expect(serialize(PUB, 'public', build(data(), cfg))).toBe(a)
    const d = data() as ReturnType<typeof data>
    const shuffled = { ...d, issues: [...d.issues].reverse(), comments: [...d.comments].reverse(), devCommits: [...d.devCommits].reverse() }
    expect(serialize(PUB, 'public', build(shuffled, cfg))).toBe(a)
  })
  it('output is JSON, one point per line, with no run time in it', () => {
    const text = serialize(PUB, 'public', build(data(), cfg))
    const json = JSON.parse(text)
    expect(json).toMatchObject({ version: 1, project: PUB, tier: 'public' })
    expect(text.split('\n').filter((l) => l.startsWith('    {')).length).toBe(json.points.length)
  })
})

describe('kinds and attribution', () => {
  const points = build(data(), cfg)
  const of = (kind: string) => points.filter((p) => p.kind === kind)
  it('collects every kind', () => {
    expect(of('plan')).toHaveLength(3)
    expect(of('work')).toHaveLength(2) // the merge commit on dev is not a work point
    expect(of('minutes')).toHaveLength(1)
    expect(of('decision').map((p) => p.title).sort()).toEqual(['별도 저장소', '점은 커밋 하나'])
    expect(of('approval')).toHaveLength(2)
    expect(of('deploy')).toHaveLength(1) // reached main without being on dev
  })
  it('a squash commit "(#issue) (#PR)" is one point, with the issue seat', () => {
    const w = points.find((p) => p.key.endsWith('/c1'))!
    expect(w).toMatchObject({ kind: 'work', issue: 1, pr: 4, agent: 3, additions: 10, deletions: 2, files: 2 })
  })
  it('a commit before roles existed is null', () => {
    expect(points.find((p) => p.key.endsWith('/c0'))).toMatchObject({ issue: null, pr: null, agent: null })
  })
  it('deploy is the main-only merge, with its PR number and no seat', () => {
    expect(of('deploy')[0]).toMatchObject({ agent: null, pr: 5 })
  })
  it('issue seat: form field, then asset label, then title tag; none = null', () => {
    expect(issueSeat(issue(1, 'a', '## 누가 하나\n디자이너, 코더'))).toEqual({ known: true, seat: 2 })
    expect(issueSeat(issue(1, '[에셋] x', '', { labels: [{ name: 'asset' }] }))).toEqual({ known: true, seat: 1 })
    expect(issueSeat(issue(1, '[디자인] x'))).toEqual({ known: true, seat: 2 })
    expect(issueSeat(issue(1, '[기능] x', 'no field'))).toEqual({ known: false, seat: null })
  })
  it('plan: the planner opened it once roles existed, else null', () => {
    expect(of('plan').map((p) => [p.issue, p.agent])).toEqual([[1, 0], [2, 0], [3, null]])
  })
  it('minutes: first speaking seat, the owner speaking first is skipped; its 결정 becomes a decision of the planner', () => {
    expect(minutesSeat(MINUTES)).toBe(0)
    expect(of('minutes')[0].agent).toBe(0)
    expect(of('decision').every((p) => p.agent === 0)).toBe(true)
    expect(minutesDecisions(MINUTES)).toEqual(['점은 커밋 하나'])
  })
  it('approval: the requester seat for the 🖊 and for the ✅ that answers it', () => {
    expect(of('approval').map((p) => p.agent)).toEqual([3, 3])
  })
  it('decision rows read the 결정 기록 table; the key has no file path', () => {
    expect(decisionRows(data().docs[0])).toEqual([{ date: '2026-11-07', decision: '별도 저장소' }])
    const d = of('decision').find((p) => p.title === '별도 저장소')!
    expect(d.key).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/#decision-2026-11-07-[0-9a-f]{8}$/)
    expect(d.at).toBe('2026-11-06T15:00:00Z')
  })
  it('a comment on a pull request makes no point', () => {
    const c = { ...comment(4, 4, MINUTES), issue_url: `https://api.github.com/repos/${PUB}/issues/4` }
    expect(collect(data({ comments: [c] })).filter((p) => p.kind === 'minutes')).toHaveLength(0)
  })
  it('seat words match src/docs/parse.ts', () => {
    expect(SEAT_WORDS.map(([s]) => s)).toEqual([0, 1, 2, 3])
    expect([seatIn('메모'), seatIn('Blender'), seatIn('휴'), seatIn('루프'), seatIn('MESH'), seatIn('x')]).toEqual([0, 1, 2, 3, 1, null])
    expect(seatIn('코더 → 기획')).toBe(3) // first mention wins
  })
})

describe('publish filter', () => {
  it('review points have no title and are marked secret; sizes and numbers stay', () => {
    const points = build(data({ repo: REV }), cfg)
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(p.tier).toBe('review')
      expect(p.title).toBe('')
      expect(p.secret).toBe(true)
    }
    expect(JSON.stringify(points)).not.toMatch(/별도 저장소|회의록|feat/)
    expect(points.find((p) => p.kind === 'work' && p.pr === 4)).toMatchObject({ additions: 10, files: 2 })
  })
  it('no file path or file name is ever collected: a point has only its own fields', () => {
    const p = build(data(), cfg).find((x) => x.kind === 'work')!
    expect(Object.keys(p).sort()).toEqual(
      ['additions', 'agent', 'at', 'deletions', 'files', 'issue', 'key', 'kind', 'pr', 'project', 'secret', 'tier', 'title'].sort(),
    )
    expect(JSON.stringify(build(data(), cfg))).not.toMatch(/secret\/path|b\.ts/)
  })
  it('a public title with a path, email or key is hidden and the point drops to review', () => {
    const d = data({ devCommits: [commit('c9', 'fix: C:\\Users\\me\\a.ts 와 me@example.com'), commit('c8', 'fix: sk-abcdefghijklmnopqrstuv')] })
    for (const sha of ['c9', 'c8']) {
      const p = build(d, cfg).find((x) => x.key.endsWith(`/${sha}`))!
      expect(p).toMatchObject({ title: '', secret: true, tier: 'review' })
    }
  })
  it('banned words hide the title', () => {
    const p = build(data(), { ...cfg, banned: ['처음'] }).find((x) => x.key.endsWith('/c0'))!
    expect(p).toMatchObject({ title: '', tier: 'review' })
  })
  it('a private repo produces nothing', () => {
    expect(tierFor(PUB, { publicRepos: [PUB], privateRepos: [PUB] })).toBe('private')
    expect(build(data(), { publicRepos: [], privateRepos: [PUB] })).toEqual([])
  })
  it('tiers: allow list = public, anything else = review', () => {
    expect(tierFor(PUB, cfg)).toBe('public')
    expect(tierFor('someone/else', cfg)).toBe('review')
    expect(tierFor(PUB.toUpperCase(), cfg)).toBe('public')
  })
})

describe('author filter (#38)', () => {
  it("strangers' issues, minutes and commits are dropped; collaborators' are kept", () => {
    const d = data({
      issues: [issue(1, 'own', FORM), issue(2, 'stranger', FORM, {}, STRANGER), issue(3, 'collab', FORM, {}, COLLAB)],
      comments: [comment(1, 1, MINUTES, STRANGER), comment(1, 2, MINUTES, COLLAB)],
      devCommits: [commit('s1', 'feat: x', 1, 'someone'), commit('s2', 'feat: y', 1, 'friend')],
      logins: { 'Rowan-Hyeho-Song': 'OWNER', friend: 'COLLABORATOR' },
    })
    const points = build(d, cfg)
    expect(points.filter((p) => p.kind === 'plan').map((p) => p.issue)).toEqual([1, 3])
    expect(points.filter((p) => p.kind === 'minutes')).toHaveLength(1)
    expect(points.filter((p) => p.kind === 'work').map((p) => p.key.split('/').pop())).toEqual(['s2'])
  })
  it('approvals are the owner only: a collaborator\'s 🖊 / ✅ make no point', () => {
    const d = data({ comments: [comment(1, 1, REQUEST, COLLAB), comment(1, 2, RESULT, COLLAB)] })
    expect(build(d, cfg).filter((p) => p.kind === 'approval')).toEqual([])
  })
  it('finalize itself checks the author', () => {
    const [raw] = collect(data()).filter((p) => p.kind === 'plan')
    expect(finalize({ ...raw, author: { login: 'x', association: 'NONE' } }, cfg)).toBeNull()
    expect(finalize({ ...raw, author: { login: 'x', association: 'COLLABORATOR' } }, cfg)).not.toBeNull()
  })
})

describe('keys', () => {
  it('are unique: the same source twice is one point, the later copy wins', () => {
    const d = data()
    const twice = build({ ...d, issues: [...d.issues, ...d.issues], devCommits: [...d.devCommits, ...d.devCommits] }, cfg)
    expect(new Set(twice.map((p) => p.key)).size).toBe(twice.length)
    expect(twice).toEqual(build(d, cfg))
  })
  it('mergePoints: replaces by key, sorted by time then key', () => {
    const a = build(data(), cfg)
    const edited = a.map((p) => (p.kind === 'plan' ? { ...p, title: 'edited' } : p))
    const merged = mergePoints(a, edited)
    expect(merged).toHaveLength(a.length)
    expect(merged.filter((p) => p.title === 'edited')).toHaveLength(3)
    const keys = merged.map((p) => `${p.at}|${p.key}`)
    expect(keys).toEqual([...keys].sort())
  })
})

describe('twin of the TypeScript side', () => {
  const titles = [
    '열어 보세요 C:\\Repo\\agent-office\\src\\a.ts 입니다', '문의 someone@example.com 으로', 'sk-abcdefghijklmnopqrstuv', '(/Users/rowan/dev/app)',
    '설정은 ~/.claude/settings.json, 그리고', 'src/office/nav.ts 와 docs/plan.md', 'feat: 로봇 대사 (#3)', 'noreply@anthropic.com', '\\\\server\\share\\f.txt',
  ]
  it.each(titles)('redact: %s', (t) => {
    expect(redact(t, ['Acme'])).toEqual(redactTs(t, ['Acme']))
  })
  it('finalize = toPoint, mergePoints = mergePoints', () => {
    const raw = collect(data())
    for (const r of raw) expect(finalize(r, cfg)).toEqual(toPoint(r as never, cfg))
    const pts = build(data(), cfg)
    expect(mergePoints(pts)).toEqual(mergeTs(pts))
    for (const r of collect(data({ repo: REV }))) expect(finalize(r, cfg)).toEqual(toPoint(r as never, cfg))
  })
})
