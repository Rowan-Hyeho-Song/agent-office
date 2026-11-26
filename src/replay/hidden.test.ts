import { describe, expect, it } from 'vitest'
import { hiddenPointOf } from '../signal/events'
import type { Point } from '../timeline/types'
import privateFile from '../timeline/fixtures/private.json'
import { projectKind } from './barDraw'
import { HIDDEN_KIND, describe as describePoint, isHidden, shortName, statusAt, valueText } from './engine'
import { byFirstPoint } from './store'

// #710 (C안, timelapse.md 14): a private project's point says who and when, nothing else: `휴 · 비공개 작업`; its band is the diagonal; its button is
// `비공개`, always last; the agent works at its desk with the monitor's "비공개 작업 중"
const point = (seat: number, at: string): Point => ({ ...hiddenPointOf(seat, new Date(at)), additions: null, deletions: null, files: null, issue: null, pr: null, result: false }) as unknown as Point

describe('a private project point (#710)', () => {
  const p = point(2, '2026-11-26T03:05:00Z')

  it('says who and 비공개 작업, no title, number or size; screen reading the same', () => {
    expect(isHidden(p)).toBe(true)
    const d = describePoint(p)
    expect(d).toEqual({ who: '휴', kind: HIDDEN_KIND, head: '휴 · 비공개 작업', title: '', size: '' })
    expect(valueText([p], 0)).toMatch(/^1번째 점, .+, 휴, 비공개 작업$/)
  })

  it('the band and the button: the diagonal kind, 비공개, after every other project', () => {
    expect(projectKind('private')).toBe('private')
    expect(shortName('private')).toBe('비공개')
    const others = [
      { project: 'private', at: '2026-11-01T00:00:00Z' },
      { project: 'Rowan-Hyeho-Song/somewhere', at: '2026-11-02T00:00:00Z' },
      { project: 'Rowan-Hyeho-Song/agent-office', at: '2026-11-03T00:00:00Z' },
    ] as Point[]
    expect(byFirstPoint(others)).toEqual(['Rowan-Hyeho-Song/agent-office', 'Rowan-Hyeho-Song/somewhere', 'private'])
  })

  it('its agent works at the desk as "비공개 작업 중"', () => {
    expect(statusAt(p).agent_2).toMatchObject({ state: 'working', activity: 'private' })
  })

  it('the practice copy: contentless points of the alias project only', () => {
    const pts = privateFile.points as unknown as Point[]
    expect(pts.length).toBeGreaterThan(3)
    for (const x of pts) expect(x).toMatchObject({ project: 'private', kind: 'work', title: '', secret: true, issue: null, pr: null, additions: null, tier: 'review' })
  })
})
