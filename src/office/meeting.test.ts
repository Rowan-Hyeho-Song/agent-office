import { describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import type { Minutes } from '../docs/types'
import { buildScript, frameAt, namedSeats, newMinutes, pickReplay, replayDue, trimScript } from './meeting'

const meta = (over: Partial<DocMeta> = {}): DocMeta => ({
  id: 7, kind: 'minutes', repo: 'o/r', folder: 28, title: 'T', agents: [0, 2, 3], grade: 'public', approved: true, readable: true, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...over,
})
const minutes: Minutes[] = [
  {
    date: '2026-11-08',
    rows: [
      { order: 1, from: { seat: 2 }, to: [{ seat: 3 }], text: '질문 셋이에요. 얼굴을 캔버스로 그릴지 먼저 정해요' },
      { order: 2, from: { seat: 3 }, to: [{ seat: 2 }], text: '그 방향으로 진행합니다.' },
      { order: 3, from: { owner: true }, to: [{ seat: 0 }], text: '승인합니다' },
      { order: 4, from: { name: '낯선이' }, to: [{ seat: 0 }], text: '난 누구' },
    ],
    decision: '얼굴은 캔버스 슬롯으로 한다.',
    followUp: '루프가 구현한다.',
  },
]
const convs = conversations({ minutes })

describe('buildScript', () => {
  it('one row = one line: speaker, listener, first sentence', () => {
    const s = buildScript(meta(), convs)
    expect(s.lines.map((l) => [l.key, l.from, l.to])).toEqual([['1-1', 2, [3]], ['1-2', 3, [2]], ['1-3', 'owner', [0]]])
    expect(s.lines[0].text).toBe('질문 셋이에요.')
    expect(buildScript(meta(), conversations({ minutes: [{ ...minutes[0], rows: [{ ...minutes[0].rows[0], text: '가'.repeat(60) }] }] })).lines[0].text).toHaveLength(36)
    expect(s.seats).toEqual([2, 3, 0])
    expect(s.decision).toBe('얼굴은 캔버스 슬롯으로 한다.')
    expect(s.followUps).toEqual([3])
    expect(s.masked).toBe(false)
  })
  it('times each line after the previous one finished', () => {
    const s = buildScript(meta(), convs)
    expect(s.lines[0].startMs).toBe(0)
    expect(s.lines[1].startMs).toBe(s.lines[0].typeMs + s.lines[0].holdMs)
    expect(s.linesMs).toBeGreaterThan(s.lines[2].startMs)
  })
  it('masks a document that is not approved even when the viewer can read it (the owner)', () => {
    const s = buildScript(meta({ approved: false, grade: 'review' }), convs)
    expect(s.masked).toBe(true)
    expect(s.lines.every((l) => l.masked && l.full === '' && /^[█ ]+$/.test(l.text))).toBe(true)
    expect(s.decision).toMatch(/^[█ ]+$/)
  })
  it('invents a scene from the cover alone for a SECRET document: same for everyone, no words', () => {
    const cover = meta({ readable: false, approved: false, grade: 'review', title: null })
    const a = buildScript(cover, null)
    const b = buildScript(cover, null)
    expect(a).toEqual(b)
    expect(a.secret).toBe(true)
    expect([...a.seats].sort()).toEqual([0, 2, 3])
    expect(a.lines.length).toBeGreaterThanOrEqual(3)
    expect(a.lines.every((l) => l.masked && l.full === '' && /^[█ ]+$/.test(l.text))).toBe(true)
    expect(a.decision).toBeNull()
  })
  it('uses the lock, not blocks, for a private one and never opens a row', () => {
    const s = buildScript(meta({ grade: 'private', readable: false, repo: null, folder: null, agents: [3] }), null)
    expect(s.private).toBe(true)
    expect(s.seats).toHaveLength(2)
    expect(frameAt(s, 10).bubbles[0].row).toBeNull()
    expect(frameAt(s, 10).bubbles[0].kind).toBe('private')
  })
  it('finds who a follow-up names', () => {
    expect(namedSeats('휴가 시안을 고치고 루프에게 넘긴다')).toEqual([2, 3])
    expect(namedSeats('3D 쪽 확인')).toEqual([1])
    expect(namedSeats('아무도')).toEqual([])
  })
  it('leaves out absent agents and re-times', () => {
    const s = trimScript(buildScript(meta(), convs), [2, 0])
    expect(s.lines.map((l) => l.from)).toEqual([2, 'owner'])
    expect(s.lines[1].startMs).toBe(s.lines[0].typeMs + s.lines[0].holdMs)
    expect(s.followUps).toEqual([])
  })
})

describe('frameAt', () => {
  const s = buildScript(meta(), convs)
  it('types the current line and keeps the other speaker greyed', () => {
    const t = s.lines[1].startMs + 56
    const f = frameAt(s, t)
    expect(f.index).toBe(1)
    expect(f.speaker).toBe(3)
    const now = f.bubbles.find((b) => b.seat === 3)!
    expect(now.typed).toBe(2)
    expect(now.dim).toBe(false)
    expect(now.row).toBe('1-2')
    const prev = f.bubbles.find((b) => b.seat === 2)!
    expect(prev.dim).toBe(true)
    expect(prev.typed).toBe([...prev.text].length)
  })
  it('puts the owner on the door, not in a bubble', () => {
    const f = frameAt(s, s.lines[2].startMs + 10)
    expect(f.door?.text).toBe('승인합니다')
    expect(f.speaker).toBeNull()
  })
  it('is empty after the last hold', () => {
    expect(frameAt(s, s.linesMs).ended).toBe(true)
    expect(frameAt(s, s.linesMs).bubbles).toEqual([])
  })
  it('logs the words only when readable', () => {
    expect(frameAt(s, 0).bubbles[0].log).toBe('휴(디자인) → 루프(코더): 질문 셋이에요. 얼굴을 캔버스로 그릴지 먼저 정해요')
    const secret = buildScript(meta({ readable: false, approved: false, grade: 'review' }), null)
    expect(frameAt(secret, 0).bubbles[0].log).toContain('내용 가림')
  })
})

describe('which minutes to replay', () => {
  const metas = [1, 2, 3, 4, 5].map((id) => meta({ id }))
  const hour = 3600_000
  it('is a fixed function of the hour', () => {
    const t = 480_000 * hour + 20 * 60_000
    expect(pickReplay(metas, t)?.id).toBe(pickReplay([...metas].reverse(), t + 1234)?.id)
  })
  it('walks through the documents over the hours', () => {
    const ids = new Set(Array.from({ length: 60 }, (_, h) => pickReplay(metas, h * hour)?.id))
    expect(ids.size).toBeGreaterThan(2)
  })
  it('ignores other kinds and an empty list', () => {
    expect(pickReplay([meta({ kind: 'plan' })], 0)).toBeNull()
    expect(pickReplay([], 0)).toBeNull()
  })
  it('replays once per hour, early in minute 20..24', () => {
    const base = 100 * hour
    expect(replayDue(base + 19 * 60_000, null)).toBe(false)
    expect(replayDue(base + 21 * 60_000, null)).toBe(true)
    expect(replayDue(base + 21 * 60_000, 100)).toBe(false)
    expect(replayDue(base + 26 * 60_000, null)).toBe(false)
  })
  it('sees new or changed minutes, but not the first answer', () => {
    expect(newMinutes(null, metas)).toEqual([])
    expect(newMinutes(metas, [...metas, meta({ id: 9 })]).map((m) => m.id)).toEqual([9])
    expect(newMinutes(metas, [meta({ id: 1, updated_at: 'later' }), ...metas.slice(1)]).map((m) => m.id)).toEqual([1])
    expect(newMinutes(metas, [...metas, meta({ id: 9, kind: 'plan' })])).toEqual([])
  })
})
