import { describe, expect, it } from 'vitest'
import {
  conversations,
  coverOf,
  decisionView,
  formatRef,
  groupLibrary,
  labelCell,
  landOn,
  mainSeat,
  ownerMeta,
  paperText,
  parseRef,
  sections,
  shelfLayout,
  PRIVATE_LABEL,
  type CoverSource,
  type DocMeta,
} from './library'

const docsSql = (import.meta.glob('../../supabase/docs.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../../supabase/docs.sql']

const row = (o: Partial<CoverSource> & Pick<CoverSource, 'id'>): CoverSource => ({
  kind: 'plan',
  repo: 'o/agent-office',
  folder: 1,
  title: '제목',
  agents: [],
  labels: [],
  grade: 'public',
  approved: true,
  created_at: '2026-11-08T01:00:00Z',
  updated_at: '2026-11-08T01:00:00Z',
  ...o,
})
const meta = (o: Partial<CoverSource> & Pick<CoverSource, 'id'>): DocMeta => coverOf(row(o))

describe('what a visitor and the owner may see (mirrors docs_cover)', () => {
  it('public + approved: title and project', () => {
    const m = coverOf(row({ id: 1 }))
    expect(m).toMatchObject({ readable: true, title: '제목', repo: 'o/agent-office', folder: 1 })
  })
  it('review: a visitor gets the cover without the title and cannot read it', () => {
    const m = coverOf(row({ id: 2, kind: 'report', grade: 'review', approved: false }))
    expect(m).toMatchObject({ readable: false, title: null, repo: 'o/agent-office', folder: 1, kind: 'report' })
  })
  it('private: no title, no number, no project, for the visitor and for the owner', () => {
    const p = row({ id: 3, grade: 'private', approved: false, repo: 'secret/co', folder: 77, title: '회사 일' })
    for (const m of [coverOf(p), ownerMeta(p)]) {
      expect(m).toMatchObject({ readable: false, title: null, repo: null, folder: null })
      expect(JSON.stringify(m)).not.toMatch(/secret|77|회사/)
    }
  })
  it('the owner reads review documents (title, readable) but they are still not approved', () => {
    const m = ownerMeta(row({ id: 4, grade: 'review', approved: false }))
    expect(m).toMatchObject({ readable: true, title: '제목', approved: false })
  })
  it('a cover carries nothing a visitor must not have: no body or data keys', () => {
    expect(Object.keys(coverOf(row({ id: 5, grade: 'review', approved: false }))).sort()).toEqual([
      'agents',
      'approved',
      'created_at',
      'folder',
      'grade',
      'id',
      'kind',
      'labels',
      'progress',
      'readable',
      'repo',
      'title',
      'updated_at',
    ])
  })
})

describe('docs_cover view in supabase/docs.sql', () => {
  it('hides what coverOf hides', () => {
    const sql = docsSql.replace(/\r\n/g, '\n')
    const view = sql.slice(sql.indexOf('create or replace view public.docs_cover'), sql.indexOf('grant select on public.docs_cover'))
    expect(view).toMatch(/case when grade = 'private' then null else repo end as repo/)
    expect(view).toMatch(/case when grade = 'private' then null else folder end as folder/)
    expect(view).toMatch(/case when grade = 'public' and approved then title end as title/)
    // labels are topic info like the title: given out only where the title is, and only the labels of the document's data
    expect(view).toMatch(/case when grade = 'public' and approved then coalesce\(data->'labels', '\[\]'::jsonb\) else '\[\]'::jsonb end as labels/)
    expect(view).not.toMatch(/\bbody\b|source_url|summary/)
    // the rest of the document's data stays in the table: only labels and progress are read from it
    expect(view.replace(/data->'labels'|data->'progress'(->'stage')?/g, '')).not.toMatch(/\bdata\b/)
  })
  it('progress (#241): all of it, SECRET included; a private row only the stage; appended last', () => {
    const sql = docsSql.replace(/\r\n/g, '\n')
    const view = sql.slice(sql.indexOf('create or replace view public.docs_cover'), sql.indexOf('grant select on public.docs_cover'))
    expect(view).toMatch(/case when grade = 'private' then jsonb_build_object\('stage', data->'progress'->'stage'\) else data->'progress' end as progress/)
    // Postgres can only append columns to a view: progress is the last one, after labels
    expect(view.trimEnd().split('\n').slice(-2)[0]).toMatch(/as progress$/)
    expect(view.indexOf('as labels')).toBeGreaterThan(-1)
    expect(view.indexOf('as labels')).toBeLessThan(view.indexOf('as progress'))
  })
})

describe('progress on the cover (#241)', () => {
  const progress = { stage: 'review', checks: { done: 3, total: 5 }, pending: 1 }
  it('public and SECRET (review) rows carry all of it, for a visitor and for the owner', () => {
    for (const r of [row({ id: 1, progress }), row({ id: 2, grade: 'review', approved: false, progress })]) {
      expect(coverOf(r).progress).toEqual(progress)
      expect(ownerMeta(r).progress).toEqual(progress)
    }
  })
  it('a private row only the stage, for both', () => {
    const p = row({ id: 3, grade: 'private', approved: false, progress })
    for (const m of [coverOf(p), ownerMeta(p)]) expect(m.progress).toEqual({ stage: 'review', checks: null, pending: 0 })
  })
  it('a row without it (the view not run again, or a document that has none) has none', () => {
    expect(coverOf(row({ id: 4 })).progress).toBeNull()
    expect(ownerMeta(row({ id: 5, progress: null })).progress).toBeNull()
  })
  it('nonsense is dropped, not drawn', () => {
    for (const bad of [{ stage: 'blocked' }, { stage: 'doing', checks: { done: 6, total: 5 } }, { stage: 'doing', pending: -1 }, { stage: 'doing', checks: { done: 1.5, total: 2 } }, 'doing', []]) {
      expect(coverOf(row({ id: 6, progress: bad })).progress).toBeNull()
    }
  })
  it('a file takes the progress of its plan; a file without a plan has none', () => {
    const files = groupLibrary([meta({ id: 10, kind: 'plan', folder: 1, progress }), meta({ id: 11, kind: 'minutes', folder: 1 }), meta({ id: 12, kind: 'minutes', folder: 2 })]).flatMap((f) => f.files)
    expect(files.find((f) => f.n === 1)?.progress).toEqual(progress)
    expect(files.find((f) => f.n === 2)?.progress).toBeNull()
  })
})

describe('groupLibrary', () => {
  const metas = [
    meta({ id: 1, kind: 'report', folder: 28, agents: [3], created_at: '2026-11-08T05:00:00Z' }),
    meta({ id: 2, kind: 'plan', folder: 28, agents: [2, 3], created_at: '2026-11-05T05:00:00Z' }),
    meta({ id: 3, kind: 'decision', folder: 28, created_at: '2026-11-07T05:00:00Z' }),
    meta({ id: 4, kind: 'minutes', folder: 28, created_at: '2026-11-06T05:00:00Z' }),
    meta({ id: 5, kind: 'plan', folder: 18, created_at: '2026-11-01T05:00:00Z' }),
    meta({ id: 6, kind: 'report', repo: 'o/rowansong.dev', folder: 3, grade: 'review', approved: false, created_at: '2026-11-07T01:00:00Z' }),
    meta({ id: 7, kind: 'minutes', repo: 'x/co', folder: 9, grade: 'private', approved: false, created_at: '2026-11-06T01:00:00Z' }),
    meta({ id: 8, kind: 'report', repo: 'y/co2', folder: 2, grade: 'private', approved: false, created_at: '2026-11-05T01:00:00Z' }),
    meta({ id: 9, kind: 'worklog', folder: 28 }),
  ]
  const folders = groupLibrary(metas)
  it('groups by repo, collapses every private document into one folder without names', () => {
    expect(folders.map((f) => f.label)).toEqual(['agent-office', 'rowansong.dev', PRIVATE_LABEL])
    const priv = folders.find((f) => f.repo === null)!
    expect(priv.files).toHaveLength(2)
    expect(priv.files.every((f) => f.n === null && f.title === null && f.secret === 'private')).toBe(true)
    expect(JSON.stringify(priv)).not.toMatch(/x\/co|y\/co2/)
  })
  it('lists a file in table-of-contents order and only the kinds present (no worklog)', () => {
    const f = folders[0].files.find((x) => x.n === 28)!
    expect(f.docs.map((d) => d.kind)).toEqual(['plan', 'minutes', 'decision', 'report'])
    expect(f.title).toBe('제목')
    expect(f.secret).toBeNull()
    expect(f.seats).toEqual([2, 3])
  })
  it('a SECRET file has no title for the visitor and keeps its stamp until approved', () => {
    const f = folders[1].files[0]
    expect(f).toMatchObject({ title: null, secret: 'review', n: 3 })
  })
  it('newest first, files too', () => {
    expect(folders[0].files.map((f) => f.n)).toEqual([28, 18])
  })
  it('a file with a public plan and a SECRET report is secret and titled', () => {
    const f = groupLibrary([meta({ id: 1, folder: 5 }), meta({ id: 2, kind: 'report', folder: 5, grade: 'review', approved: false })])[0].files[0]
    expect(f.secret).toBe('review')
    expect(f.title).toBe('제목')
  })
})

describe('bookshelf layout', () => {
  const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}T00:00:00Z`
  const file = (n: number, d: number) => meta({ id: n, folder: n, created_at: day(d), agents: [1] })
  it('one binder per file, oldest left, the newest last and leaning; stamp only on SECRET', () => {
    const folders = groupLibrary([file(1, 1), file(2, 2), meta({ id: 3, folder: 3, grade: 'review', approved: false, created_at: day(3), agents: [3, 3] })])
    const l = shelfLayout(folders)
    expect(l.binders.map((b) => [b.node, b.fileKey, b.secret, b.lean])).toEqual([
      ['shelf_r0_b0', 'o/agent-office#1', false, false],
      ['shelf_r0_b1', 'o/agent-office#2', false, false],
      ['shelf_r0_b2', 'o/agent-office#3', true, true],
    ])
    expect(l.binders.map((b) => b.label)).toEqual(['#1', '#2', '#3'])
    expect(l.binders[0].seat).toBe(1)
    expect(l.plates).toEqual(['agent-office', '', ''])
    expect(l.note).toBeNull()
  })
  it('three newest public folders on r0..r2, newest lowest; private is never on the shelf', () => {
    const l = shelfLayout(
      groupLibrary([
        meta({ id: 1, repo: 'o/a', folder: 1, created_at: day(1) }),
        meta({ id: 2, repo: 'o/b', folder: 1, created_at: day(2) }),
        meta({ id: 3, repo: 'o/c', folder: 1, created_at: day(3) }),
        meta({ id: 4, repo: 'o/d', folder: 1, created_at: day(4), grade: 'private', approved: false, agents: [0, 3] }),
        meta({ id: 5, repo: 'o/e', folder: 1, created_at: day(5), grade: 'private', approved: false }),
      ]),
    )
    expect(l.plates).toEqual(['c', 'b', 'a'])
    expect(l.binders).toHaveLength(3)
    expect(l.binders.every((b) => b.repo !== null && b.secret === false)).toBe(true)
    expect(l.plates).not.toContain(PRIVATE_LABEL)
    expect(l.note).toBeNull()
  })
  it('private only: an empty shelf', () => {
    const l = shelfLayout(groupLibrary([meta({ id: 1, grade: 'private', approved: false, agents: [3] })]))
    expect(l.binders).toEqual([])
    expect(l.plates).toEqual(['', '', ''])
  })
  it('more than ten files in a folder: the latest ten, with a note', () => {
    const l = shelfLayout(groupLibrary(Array.from({ length: 12 }, (_, i) => meta({ id: i + 1, folder: i + 1, created_at: day(i + 1) }))))
    expect(l.binders).toHaveLength(10)
    expect(l.binders[0].n).toBe(3)
    expect(l.binders[9]).toMatchObject({ n: 12, lean: true, node: 'shelf_r0_b9' })
    expect(l.note).not.toBeNull()
    expect(l.binders.filter((b) => b.lean)).toHaveLength(1)
  })
  it('main agent: most frequent seat, ties to the lower seat', () => {
    expect(mainSeat({ docs: [meta({ id: 1, agents: [3, 1] }), meta({ id: 2, agents: [3] })] })).toBe(3)
    expect(mainSeat({ docs: [meta({ id: 1, agents: [2, 1] })] })).toBe(1)
    expect(mainSeat({ docs: [meta({ id: 1 })] })).toBeNull()
  })
  it('label cell: column k, row r, row 0 = top of the canvas, UV in tenths and thirds', () => {
    expect(labelCell(0, 0)).toMatchObject({ x: 0, y: 0, w: 64, h: 128, u0: 0, u1: 0.1, v0: 0 })
    const c = labelCell(5, 1)
    expect(c).toMatchObject({ x: 320, y: 128, u0: 0.5, u1: 0.6 })
    expect(c.v0).toBeCloseTo(1 / 3)
    expect(c.v1).toBeCloseTo(2 / 3)
    const d = labelCell(9, 2)
    expect(d).toMatchObject({ x: 576, y: 256 })
    expect(d.u1).toBeCloseTo(1)
    expect(d.v1).toBeCloseTo(1)
  })
})

describe('minutes as a conversation', () => {
  const data = {
    minutes: [
      {
        date: '2026-11-08',
        rows: [
          { order: 1, from: { seat: 2 }, to: [{ seat: 3 }], text: '질문' },
          { order: 2, from: { owner: true }, to: [{ seat: 0 }, { seat: 3 }], text: '승인' },
          { order: 3, from: { name: '임시' }, to: [], text: '메모' },
        ],
        decision: '이렇게 한다',
        followUp: null,
      },
      { date: null, rows: [{ order: 1, from: { seat: 1 }, to: [{ seat: 2 }], text: '두 번째 글' }], decision: null, followUp: '다음' },
    ],
  }
  const [a, b] = conversations(data)
  it('one table row = one utterance, with sender tag, receivers and stable keys', () => {
    expect(a.lines.map((l) => l.key)).toEqual(['1-1', '1-2', '1-3'])
    expect(a.lines[0].from).toEqual({ seat: '2', tag: 'HUE', ko: '휴' })
    expect(a.lines[0].to.map((w) => w.ko)).toEqual(['루프'])
    expect(a.lines[1].to.map((w) => w.ko)).toEqual(['메모', '루프'])
    expect(b.lines[0].key).toBe('2-1')
  })
  it('the owner is ROWAN on the right; an unknown name stays as written', () => {
    expect(a.lines[1]).toMatchObject({ owner: true, from: { seat: 'owner', tag: 'ROWAN', ko: '사용자' } })
    expect(a.lines[2].from).toEqual({ seat: 'x', tag: '임시', ko: '임시' })
    expect(a.lines[0].owner).toBe(false)
  })
  it('keeps decision and follow-up, and survives malformed data', () => {
    expect(a.decision).toBe('이렇게 한다')
    expect(b.followUp).toBe('다음')
    expect(conversations({})).toEqual([])
    expect(conversations({ minutes: [{ date: null }] })[0].lines).toEqual([])
  })
})

describe('paper text', () => {
  it('splits an issue form into its ## sections', () => {
    expect(sections('intro\n\n## 배경\n글\n\n## 범위\n- a\n- b\n')).toEqual([
      { heading: null, text: 'intro' },
      { heading: '배경', text: '글' },
      { heading: '범위', text: '- a\n- b' },
    ])
    expect(sections('## 하나\n')).toEqual([{ heading: '하나', text: '' }])
  })
  it('checks become ✓ / ☐ and images are dropped', () => {
    expect(paperText('- [x] 했다\n- [ ] 안 했다\n![전](a.png)')).toBe('- ✓ 했다\n- ☐ 안 했다\n')
  })
  it('a decision shows the chosen option, else what was asked, with the reason', () => {
    const request = { content: '골라 주세요.\n자세히', options: ['A 하나', 'B 둘'], reason: '이유' }
    expect(decisionView({ result: { result: '선택지 2', option: 2, opinion: null, date: '2026-11-08' }, request })).toEqual({
      text: 'B 둘',
      why: '이유',
      result: '선택지 2',
      date: '2026-11-08',
    })
    expect(decisionView({ result: { result: '승인', option: null, opinion: '좋다', date: null }, request })).toMatchObject({ text: '골라 주세요.', why: '좋다' })
    expect(decisionView({})).toBeNull()
  })
})

describe('addresses', () => {
  it('round-trips a row address', () => {
    const ref = { repo: 'o/agent-office', n: 28, kind: 'minutes' as const, row: '1-3' }
    expect(formatRef(ref)).toBe('#library/o/agent-office/28/minutes/1-3')
    expect(parseRef('#library/o/agent-office/28/minutes/1-3')).toEqual(ref)
    expect(parseRef('#library/o/agent-office/28')).toEqual({ repo: 'o/agent-office', n: 28 })
  })
  it('rejects anything else, and private documents have no address', () => {
    for (const h of ['', '#x', '#library/o/a/0', '#library/o/a/1/bad', '#library/o/a/1/minutes/x', '#library/../a/1']) expect(parseRef(h)).toBeNull()
    expect(formatRef({ id: 3 })).toBeNull()
  })
})

describe('landOn', () => {
  const folders = groupLibrary([
    meta({ id: 1, kind: 'plan', folder: 28, created_at: '2026-11-08T05:00:00Z' }),
    meta({ id: 2, kind: 'minutes', folder: 28 }),
    meta({ id: 3, kind: 'report', repo: 'x/co', folder: 4, grade: 'private', approved: false, created_at: '2026-11-01T05:00:00Z' }),
  ])
  it('finds the file, kind and row of an address', () => {
    expect(landOn(folders, { repo: 'o/agent-office', n: 28, kind: 'minutes', row: '1-3' })).toEqual({ fileKey: 'o/agent-office#28', kind: 'minutes', row: '1-3' })
  })
  it('falls back to the newest file, and ignores a kind the file does not have', () => {
    expect(landOn(folders, null)).toEqual({ fileKey: 'o/agent-office#28', kind: null, row: null })
    expect(landOn(folders, { n: 28, kind: 'report' }).kind).toBeNull()
    expect(landOn(folders, { repo: 'nope/x', n: 99 }).fileKey).toBe('o/agent-office#28')
  })
  it('reaches a private document by id', () => {
    expect(landOn(folders, { id: 3 })).toEqual({ fileKey: 'private:3', kind: 'report', row: null })
  })
})
