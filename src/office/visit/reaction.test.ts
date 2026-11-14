import { describe, expect, it } from 'vitest'
import { moodOf, reactionOf } from './reaction'

describe('how a robot takes a snack or a cheer (#4 12.2)', () => {
  it('the mood from the scene', () => {
    expect(moodOf({ state: 'idle' }, 'coffee')).toBe('free')
    expect(moodOf({ state: 'working' }, 'type')).toBe('working')
    expect(moodOf({ state: 'wrapping' }, 'cardpost')).toBe('working')
    expect(moodOf({ state: 'idle' }, 'listen')).toBe('meeting')
    expect(moodOf({ state: 'off', night: 'sleep' }, 'doze')).toBe('asleep')
    expect(moodOf(undefined, 'doze')).toBe('asleep')
  })
  it("12.2's table", () => {
    expect(reactionOf('coffee', 'free')).toEqual({ face: { expr: 'joy', ms: 2500 }, line: '고마워요!', rest: 'hand', hearts: 0 })
    expect(reactionOf('cheer', 'free')).toMatchObject({ face: { expr: 'joy' }, line: '힘이 나네요', hearts: 3 })
    expect(reactionOf('apple', 'working')).toMatchObject({ face: { expr: 'nodding' }, line: '이따 먹을게요', rest: 'desk' })
    expect(reactionOf('cheer', 'working')).toMatchObject({ line: '고마워요', hearts: 3 })
    expect(reactionOf('cookie', 'meeting')).toEqual({ face: null, line: null, rest: 'floor', hearts: 0 })
    expect(reactionOf('cheer', 'meeting', true).face).toBeNull()
    expect(reactionOf('cheer', 'meeting', false).face?.expr).toBe('nodding')
    // asleep: never woken
    expect(reactionOf('coffee', 'asleep')).toEqual({ face: null, line: null, rest: 'desk', hearts: 0 })
    expect(reactionOf('cheer', 'asleep')).toEqual({ face: null, line: null, rest: null, hearts: 1 })
  })
})
