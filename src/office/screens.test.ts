import { describe, expect, it } from 'vitest'
import { ACTIVITY_LABELS } from './status'
import { ICONS, SCREEN_STATES, screenPlan, screenState } from './screens'

const texts = (p: ReturnType<typeof screenPlan>) => p.flatMap((o) => ('text' in o ? [o.text] : []))
const icons = (p: ReturnType<typeof screenPlan>) => p.flatMap((o) => ('icon' in o ? [o.icon] : []))

describe('screenState', () => {
  it('maps the five states', () => {
    expect(screenState({ state: 'working', activity: 'edit' })).toBe('work')
    expect(screenState({ state: 'working' })).toBe('work')
    expect(screenState({ state: 'wrapping' })).toBe('wrap')
    expect(screenState({ state: 'idle' })).toBe('rest')
    expect(screenState({ state: 'off' })).toBe('off')
    expect(screenState({ state: 'working', activity: 'private' })).toBe('private')
    expect(screenState(undefined)).toBe('off')
  })
})

describe('screenPlan', () => {
  it('work shows the activity words and its icon', () => {
    const p = screenPlan('work', 'test')
    expect(texts(p)).toEqual(['테스트 실행 중'])
    expect(icons(p)).toEqual(['test'])
  })

  it('private carries no activity text and no tool icon, whatever the activity', () => {
    const base = screenPlan('private')
    for (const activity of [...Object.keys(ACTIVITY_LABELS), undefined]) {
      expect(screenPlan('private', activity)).toEqual(base)
    }
    const activityWords = Object.entries(ACTIVITY_LABELS)
      .filter(([k]) => k !== 'private')
      .map(([, v]) => v)
    for (const t of texts(base)) expect(activityWords).not.toContain(t)
    expect(texts(base)).toEqual(['비공개 작업 중'])
    expect(icons(base)).toEqual(['lock'])
    expect(base.some((o) => o.op === 'strip')).toBe(true) // "working right now" stays
  })

  it('every state has a plan and every icon is a 12 x 12 bitmap', () => {
    for (const s of SCREEN_STATES) expect(screenPlan(s, 'edit').length).toBeGreaterThan(0)
    for (const rows of Object.values(ICONS)) {
      expect(rows).toHaveLength(12)
      for (const r of rows) expect(r).toHaveLength(12)
    }
  })

  it('think: 생각 중 with the ellipsis-bubble icon (designer, #98)', () => {
    const p = screenPlan('work', 'think')
    expect(texts(p)).toEqual(['생각 중'])
    expect(icons(p)).toEqual(['think'])
  })

  it('an unknown activity falls back to a generic word and icon', () => {
    const p = screenPlan('work', 'mystery')
    expect(texts(p)).toEqual(['작업 중'])
    expect(icons(p)).toEqual(['cmd'])
  })
})
