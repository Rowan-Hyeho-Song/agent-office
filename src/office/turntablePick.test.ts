import { Object3D, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { TOUCH_SCALE, turntableTarget } from './TurntablePick'

describe('turntable press box (#353)', () => {
  const sceneWith = (size: number[]) => {
    const s = new Scene()
    const hit = new Object3D()
    hit.name = 'hit_turntable'
    hit.userData = { hit: 'turntable', size }
    hit.position.set(2, 1, 3)
    s.add(hit)
    s.updateMatrixWorld(true)
    return s
  }
  it('is the model\'s hit_turntable box, where the empty is', () => {
    const b = turntableTarget(sceneWith([0.46, 0.16, 0.36]), false)!
    expect(b.position.toArray()).toEqual([2, 1, 3])
    expect(b.scale.x).toBe(1)
  })
  it('grows 1.5x on touch', () => {
    expect(turntableTarget(sceneWith([0.46, 0.16, 0.36]), true)!.scale.x).toBe(TOUCH_SCALE)
  })
  it('is null while the model has no hit_turntable', () => {
    expect(turntableTarget(new Scene(), false)).toBeNull()
  })
})
