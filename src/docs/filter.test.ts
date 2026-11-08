import { describe, expect, it } from 'vitest'
import { gradeFor, redact } from './filter'

const raw = import.meta.glob('./fixtures/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

type Hit = 'path' | 'email' | 'token' | 'banned'
const M = '[가림]'

// [input, expected output, expected hits]
const cases: [string, string, Hit[]][] = [
  // ---- path: redact
  ['열어 보세요 C:\\Repo\\agent-office\\src\\a.ts 입니다', `열어 보세요 ${M} 입니다`, ['path']],
  ['c:/Repo/x/y.md.', `${M}.`, ['path']],
  ['폴더 "C:\\Program Files\\My App\\x.exe" 에서', `폴더 ${M} 에서`, ['path']],
  ["'D:/My Docs/a b.txt' 파일", `${M} 파일`, ['path']],
  ['공유 \\\\server\\share\\dir\\f.txt 에', `공유 ${M} 에`, ['path']],
  ['(/Users/rowan/dev/app)', `(${M})`, ['path']],
  ['/home/ubuntu/.ssh/id_rsa 를', `${M} 를`, ['path']],
  // ---- path: leave alone
  ['설정은 ~/.claude/settings.json, 그리고', '설정은 ~/.claude/settings.json, 그리고', []],
  ['src/office/nav.ts 와 docs/plan.md', 'src/office/nav.ts 와 docs/plan.md', []],
  ['public/models/office.glb', 'public/models/office.glb', []],
  ['https://github.com/Rowan-Hyeho-Song/agent-office/blob/dev/a.md', 'https://github.com/Rowan-Hyeho-Song/agent-office/blob/dev/a.md', []],
  ['http://localhost:5173/rooms/office', 'http://localhost:5173/rooms/office', []],
  ['.github/workflows/docs.yml', '.github/workflows/docs.yml', []],
  ['src/home/Users/x.ts', 'src/home/Users/x.ts', []],
  ['`hooks/README.md` 참고', '`hooks/README.md` 참고', []],
  ['시각 12:30/13:00 와 비율 16:10', '시각 12:30/13:00 와 비율 16:10', []],
  // ---- email
  ['문의 someone@example.com 으로', `문의 ${M} 으로`, ['email']],
  ['a.b+tag@sub.corp.co.kr, 그리고', `${M}, 그리고`, ['email']],
  ['Co-Authored-By: Claude <noreply@anthropic.com>', 'Co-Authored-By: Claude <noreply@anthropic.com>', []],
  ['12345+name@users.noreply.github.com', '12345+name@users.noreply.github.com', []],
  ['react@18.3.1 와 @types/node', 'react@18.3.1 와 @types/node', []],
  // ---- token
  ['key sk-abcdefghijklmnopqrstuv12 끝', `key ${M} 끝`, ['token']],
  ['sk-short', 'sk-short', []],
  ['ghp_' + 'A1b2'.repeat(9), M, ['token']],
  ['gho_' + 'a'.repeat(30) + ' ' + 'ghs_' + 'b'.repeat(30), `${M} ${M}`, ['token']],
  ['ghp_tooShort', 'ghp_tooShort', []],
  ['github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwx', M, ['token']],
  ['sb_secret_AbCdEfGhIj12345', M, ['token']],
  ['sb_publishable_AbCdEfGhIj12345', M, ['token']],
  ['sb_secret_… 와 SUPABASE_SECRET_KEY', 'sb_secret_… 와 SUPABASE_SECRET_KEY', []],
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-xyz', M, ['token']],
  ['AKIAIOSFODNN7EXAMPLE', M, ['token']],
  ['AKIA123', 'AKIA123', []],
  ['xoxb-1234567890-abcdefghij', M, ['token']],
  ['xoxp-12', 'xoxp-12', []],
  // ---- token: leave alone
  ['커밋 c18d48c, c516d4f 와 0123456789abcdef0123456789abcdef01234567', '커밋 c18d48c, c516d4f 와 0123456789abcdef0123456789abcdef01234567', []],
  ['#24 PR #33 이슈 #1', '#24 PR #33 이슈 #1', []],
  ['sk 와 ghost 와 token 이라는 낱말, task-runner-with-a-very-long-kebab-name', 'sk 와 ghost 와 token 이라는 낱말, task-runner-with-a-very-long-kebab-name', []],
  // ---- several
  ['C:\\x\\y 와 a@b.com 와 sk-abcdefghijklmnopqrstuvwx', `${M} 와 ${M} 와 ${M}`, ['path', 'email', 'token']],
  ['', '', []],
]

describe('redact', () => {
  it.each(cases)('%j', (input, text, hits) => {
    expect(redact(input)).toEqual({ text, hits })
  })

  it('hits are unique and in a stable order', () => {
    const r = redact('sk-abcdefghijklmnopqrstuvwx a@b.com C:\\a\\b C:\\c\\d a@b.org ACME')
    expect(r.hits).toEqual(['path', 'email', 'token'])
    expect(redact('a@b.com ACME C:\\a', ['acme']).hits).toEqual(['path', 'email', 'banned'])
  })

  describe('banned words', () => {
    it('case-insensitive, every occurrence', () => {
      expect(redact('Acme 와 ACME 와 acme', ['AcMe'])).toEqual({ text: `${M} 와 ${M} 와 ${M}`, hits: ['banned'] })
    })
    it('several words, regex characters are literal', () => {
      expect(redact('Foo.Bar (주)회사 x', ['foo.bar', '(주)회사'])).toEqual({ text: `${M} ${M} x`, hits: ['banned'] })
      expect(redact('fooxbar', ['foo.bar'])).toEqual({ text: 'fooxbar', hits: [] })
    })
    it('none, blank entries and misses change nothing', () => {
      expect(redact('아무 말', [])).toEqual({ text: '아무 말', hits: [] })
      expect(redact('아무 말', ['', '  '])).toEqual({ text: '아무 말', hits: [] })
      expect(redact('아무 말', ['회사'])).toEqual({ text: '아무 말', hits: [] })
    })
  })
})

describe('gradeFor', () => {
  const pub = ['Rowan-Hyeho-Song/agent-office']
  it('public only for an allowed repo without hits', () => {
    expect(gradeFor('Rowan-Hyeho-Song/agent-office', pub, [])).toBe('public')
    expect(gradeFor('rowan-hyeho-song/AGENT-OFFICE', pub, [])).toBe('public')
  })
  it('review with hits, for unknown repos, or with an empty list', () => {
    expect(gradeFor('Rowan-Hyeho-Song/agent-office', pub, ['path'])).toBe('review')
    expect(gradeFor('Rowan-Hyeho-Song/rowansong.dev', pub, [])).toBe('review')
    expect(gradeFor('Rowan-Hyeho-Song/agent-office', [], [])).toBe('review')
  })
})

describe('fixtures', () => {
  const entries = Object.entries(raw)
  it('found the fixtures', () => {
    expect(entries.length).toBeGreaterThanOrEqual(15)
  })
  it.each(entries.filter(([p]) => p.includes('minutes-')))('minutes %s is clean', (_p, text) => {
    expect(redact(text)).toEqual({ text, hits: [] })
  })
})
