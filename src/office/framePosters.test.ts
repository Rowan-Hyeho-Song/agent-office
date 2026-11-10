import { describe, expect, it } from 'vitest'
import { FRAME_POSTERS, containRect, frameOfNode, posterOf } from './framePosters'

describe('frame posters', () => {
  it('frame_0 rowansong, frame_1 agent office (the big one), frame_2 desk room (lounge-props.md 6)', () => {
    expect([0, 1, 2].map(posterOf)).toEqual(['poster_rowansong', 'poster_agent_office', 'poster_desk_room'])
    expect(FRAME_POSTERS).toHaveLength(3)
    expect(posterOf(3)).toBeNull()
    expect(posterOf(-1)).toBeNull()
  })
  it('the frame of a node: the art slots only, extras first', () => {
    expect(frameOfNode('frame_1_art', { frame: 1 })).toBe(1)
    expect(frameOfNode('frame_2_art')).toBe(2)
    expect(frameOfNode('frame_0_art', { frame: 'x' })).toBe(0)
    expect(frameOfNode('frame_0')).toBeNull()
    expect(frameOfNode('screen_door')).toBeNull()
  })
  it('contain: no stretching, centred', () => {
    // the art faces are 0.75 and 0.667, the posters 512 x 684 and 512 x 768: they fill the face
    expect(containRect(512, 684, 512, 684)).toEqual({ x: 0, y: 0, w: 512, h: 684 })
    expect(containRect(512, 768, 512, 768)).toEqual({ x: 0, y: 0, w: 512, h: 768 })
    // a wider picture in a taller face: bars above and below
    expect(containRect(100, 200, 100, 50)).toEqual({ x: 0, y: 75, w: 100, h: 50 })
    // a taller picture in a wider face: bars at the sides
    expect(containRect(200, 100, 50, 100)).toEqual({ x: 75, y: 0, w: 50, h: 100 })
    // nonsense sizes fill the face instead of throwing
    expect(containRect(10, 20, 0, 5)).toEqual({ x: 0, y: 0, w: 10, h: 20 })
  })
})
