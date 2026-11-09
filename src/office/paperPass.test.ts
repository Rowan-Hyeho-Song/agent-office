import { beforeAll, describe, expect, it } from 'vitest'
import { loadOffice } from './glbLoad'
import { formation } from './formation'
import { GRAPH } from './navSpots.fixture'
import { LIMITS, DeskStuff, Furniture, arcY, bodyBetween, chooseMethod, findLane, flyTime, slideTime, timesFor, tossApex, type Env, type Method } from './paperPass'

let env: Env
beforeAll(async () => {
  const { nodes } = await loadOffice()
  env = { furniture: Furniture.from(nodes), desks: DeskStuff.from(nodes), others: [] }
})
const spot = (id: string) => GRAPH.spots[id]
const pick = (a: string, b: string, others: Env['others'] = []) => chooseMethod(spot(a), spot(b), { ...env, others }).method

describe('which way a paper goes (paper-pass.md 1)', () => {
  it('the pod: neighbours hand it over, across the desk slides it, the diagonal tosses (HUE 2, MESH 1, LOOP 3, ECHO 4)', () => {
    // HUE <-> MESH and LOOP <-> ECHO: the neighbours (1.2 m)
    expect(pick('work_1', 'work_2')).toBe('hand')
    expect(pick('work_3', 'work_4')).toBe('hand')
    // HUE <-> LOOP: across (1.62 m)
    expect(pick('work_2', 'work_3')).toBe('slide')
    // the diagonals (2.02 m)
    expect(pick('work_2', 'work_4')).toBe('toss')
    expect(pick('work_1', 'work_3')).toBe('toss')
  })
  it('MEMO at the head desk: 1.63 m to HUE and LOOP is a slide, 2.73 m to the far two is a toss', () => {
    expect(pick('work_0', 'work_2')).toBe('slide')
    expect(pick('work_0', 'work_3')).toBe('slide')
    expect(pick('work_0', 'work_1')).toBe('toss')
    expect(pick('work_0', 'work_4')).toBe('toss')
  })
  it('the meeting circle to the pod is a plane (3 m and more, or a tall thing between); the nearest seat is a toss', () => {
    const slots = formation(spot('meet_center'), 5, false)
    for (const seat of ['work_1', 'work_2']) for (const s of slots) expect(chooseMethod(s, spot(seat), env).method).toBe('plane')
    // the head desk is closer to the circle's last seat (2.76 m): a toss from there, a plane from the rest
    for (const s of slots.slice(0, 4)) expect(chooseMethod(s, spot('work_0'), env).method).toBe('plane')
    expect(chooseMethod(slots[4], spot('work_0'), env).method).toBe('toss')
    expect(chooseMethod(slots[3], spot('work_3'), env).method).toBe('toss')
  })
  it('the sofa and the play spots are far from the desks: a plane', () => {
    for (const a of ['sofa_0', 'sofa_2', 'pingpong_b']) for (const b of ['work_0', 'work_1', 'work_2']) expect(pick(a, b)).toBe('plane')
  })
  it('a body on the line between sends a plane', () => {
    expect(bodyBetween({ x: 0, z: 0 }, { x: 2, z: 0 }, [{ x: 1, z: 0.2 }])).toBe(true)
    expect(bodyBetween({ x: 0, z: 0 }, { x: 2, z: 0 }, [{ x: 1, z: 0.4 }])).toBe(false)
    expect(bodyBetween({ x: 0, z: 0 }, { x: 2, z: 0 }, [{ x: 0.2, z: 0 }])).toBe(false) // beside one of the two
    expect(pick('work_1', 'work_2', [{ x: -3.31, z: -0.6 }])).toBe('plane')
  })
  it('the boundaries: 1.5, 1.8, 3.0', () => {
    const flat = { furniture: null, desks: null, others: [] }
    const at = (d: number): Method => chooseMethod({ x: 0, z: 0, ry: 0 }, { x: d, z: 0, ry: 0 }, flat).method
    expect(at(1.5)).toBe('hand')
    expect(at(1.51)).toBe('toss')
    expect(at(3.0)).toBe('toss')
    expect(at(3.01)).toBe('plane')
    expect(LIMITS.slide).toBe(1.8)
  })
})

describe('the lane (paper-pass.md 2.2)', () => {
  it('across the pod the line is moved sideways off the monitor stands', () => {
    const lane = findLane(env.desks, spot('work_2'), spot('work_3'))!
    expect(Math.abs(lane.offset)).toBeGreaterThan(0.1)
    // 0.30 in front of the sender, 0.30 in front of the receiver
    expect(Math.hypot(lane.put.x - -3.01, 0)).toBeLessThan(0.01)
    expect(lane.dir.x).toBeCloseTo(1, 3)
  })
  it('no desk stuff: the straight line', () => {
    expect(findLane(null, spot('work_2'), spot('work_3'))!.offset).toBe(0)
  })
})

describe('the times (paper-pass.md 2)', () => {
  it('the slide takes 0.5-0.8 s by distance, the toss flies 0.45 + 0.1 (d - 1.5)', () => {
    expect(slideTime(0.3)).toBe(0.5)
    expect(slideTime(5)).toBe(0.8)
    expect(flyTime(2.02)).toBeCloseTo(0.502, 3)
  })
  it('x16: the same stages, shorter, the shared hold stays 0.15 s', () => {
    const n = timesFor(1.2, 1)
    const f = timesFor(1.2, 1, { fast: true, min: 0.1 })
    expect(n.shared).toBe(0.15)
    expect(f.shared).toBe(0.15)
    expect(f.reach).toBeLessThan(n.reach)
    expect(n.look).toBe(1.5)
  })
  it('the toss arc peaks 0.25 over the higher end and 0.2 over what is between', () => {
    expect(tossApex(0.9, 1.0, 0)).toBeCloseTo(1.25)
    expect(tossApex(0.9, 1.0, 1.27)).toBeCloseTo(1.47)
    const apex = tossApex(0.9, 1.0, 1.27)
    let max = 0
    for (let k = 0; k <= 1; k += 0.01) max = Math.max(max, arcY(0.9, 1.0, apex, k))
    expect(max).toBeCloseTo(apex, 2)
    expect(arcY(0.9, 1.0, apex, 0)).toBeCloseTo(0.9)
    expect(arcY(0.9, 1.0, apex, 1)).toBeCloseTo(1.0)
  })
})
