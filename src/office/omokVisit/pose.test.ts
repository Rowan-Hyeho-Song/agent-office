import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { OMOK_FIT, OMOK_VIEW, fitView, tagOnScreen, visitPose } from './pose'
import { TAG_MARGIN } from '../keyRackRules'

const center = new Vector3(1, 0.75, -2)
const size = 0.45
const fov = 35

/** the board's share of the screen along the short side, seen straight at its middle from the pose's distance */
const share = (pose: { position: [number, number, number]; target: [number, number, number] }, aspect: number) => {
  const r = new Vector3(...pose.position).distanceTo(new Vector3(...pose.target))
  const half = Math.tan((fov * Math.PI) / 360)
  return size / (2 * r * half * Math.min(1, aspect))
}

describe('the camera for the visitor at the board (#137 ②, play.md 2.2)', () => {
  it('looks 55° down from the visitor side, a little past the middle toward the agent', () => {
    const { position, target } = visitPose(center, { x: 1, z: -1 }, size, fov)
    expect(target[0]).toBeCloseTo(center.x, 9)
    expect(target[1]).toBeCloseTo(center.y, 9)
    expect(target[2]).toBeCloseTo(center.z - OMOK_VIEW.lookAhead * size, 9) // away from the seat (+z)
    const d = new Vector3(...position).sub(new Vector3(...target))
    expect(d.x).toBeCloseTo(0, 6)
    expect(d.z).toBeGreaterThan(0) // on the seat's side
    expect((Math.atan2(d.y, d.z) * 180) / Math.PI).toBeCloseTo(OMOK_VIEW.downDeg, 6)
  })
  it('the board about 60% of the height on a wide screen, 75% of the width on a phone', () => {
    expect(share(visitPose(center, { x: 1, z: -1 }, size, fov, 1.6), 1.6)).toBeCloseTo(OMOK_VIEW.fill, 6)
    expect(share(visitPose(center, { x: 1, z: -1 }, size, fov, 390 / 844), 390 / 844)).toBeCloseTo(OMOK_VIEW.fillNarrow, 6)
  })
  it('right and up as grid steps, for each side the visitor may sit', () => {
    // sitting south (+z) looking north: right is +x (a column), up (away) is -z (a row back)
    expect(visitPose(center, { x: 1, z: 0 }, size, fov).orient).toEqual({ right: [1, 0], up: [0, -1] })
    // sitting north looking south: both turn round
    expect(visitPose(center, { x: 1, z: -4 }, size, fov).orient).toEqual({ right: [-1, 0], up: [0, 1] })
    // sitting west (-x) looking east: right is +z, up is +x
    expect(visitPose(center, { x: -1, z: -2 }, size, fov).orient).toEqual({ right: [0, 1], up: [1, 0] })
  })
})

describe('the "같이 두기" tag stays on the screen (#137 B, as #480)', () => {
  it('centred over the chair; pulled 8 px inside at either edge; its top on the screen', () => {
    expect(tagOnScreen(200, 300, 96, 28, 390)).toEqual({ left: 200, top: 300 })
    // the designer's case: the phone's default view puts the chair off the left edge
    expect(tagOnScreen(-35, 300, 96, 28, 390).left).toBe(TAG_MARGIN + 48)
    expect(tagOnScreen(420, 300, 96, 28, 390).left).toBe(390 - TAG_MARGIN - 48)
    expect(tagOnScreen(200, 10, 96, 28, 390).top).toBe(TAG_MARGIN + 28)
  })
})

describe('the wide screen fitted to the face and the HUD (#137 B designer)', () => {
  // a stand-in screen 800 px high: the board's height grows with fill, the look past the middle moves everything down
  const H = 800
  const measure = (gap: number) => (v: { fill: number; lookAhead: number }) => {
    const board = v.fill * H
    const faceTop = 200 * v.lookAhead - 60 - (board - 400) * 0.6
    return { faceTop, nearEdge: faceTop + gap + board }
  }
  it('room enough: the board at 50%, the face screen 12 px from the top', () => {
    const v = fitView(measure(100), H)
    expect(v.fill).toBeCloseTo(OMOK_VIEW.fill, 6)
    expect(measure(100)(v).faceTop).toBeCloseTo(OMOK_FIT.faceTopPx, 3)
  })
  it('no room: the board as big as keeps its near edge 16 px over the HUD, the face still 12 px from the top', () => {
    const v = fitView(measure(320), H)
    expect(v.fill).toBeLessThan(OMOK_VIEW.fill)
    const m = measure(320)(v)
    expect(m.faceTop).toBeCloseTo(OMOK_FIT.faceTopPx, 1)
    expect(m.nearEdge).toBeLessThanOrEqual(H - OMOK_FIT.hudPx - OMOK_FIT.hudGapPx)
    expect(m.nearEdge).toBeGreaterThan(H - OMOK_FIT.hudPx - OMOK_FIT.hudGapPx - 2)
  })
})
