// #416 ① the receiving hand (paper-pass.md 3 "받는 손 고르기"): a free hand receives, and with both hands busy the pass waits or the paper lies on the desk.
//  - the right hand busy (a mug): the paper passes and the paper plane are received and read with the left hand (the one-hand grips are paperSide.test.ts's);
//  - both hands busy with something that cannot be put down (the can while it pours): a hand-over / slide is not started (the message waits, it does not
//    turn into a plane), a toss or a plane lands on the receiver's desk about 0.3 m in front of the body and is picked up when a hand is free, without a jump.
import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { PaperPlanes } from './plane'
import { Guard, IDS, Walk, expectClean, world, type World } from './errandWorld.fixture'
import type { AgentRig } from './rig'
import type { Method } from './paperPass'

stubCanvas()

type Mode = 'none' | 'mug-r' | 'both'
const PAIR: Record<string, [string, string]> = { hand: ['agent_2', 'agent_1'], slide: ['agent_2', 'agent_3'], toss: ['agent_2', 'agent_4'], plane: ['agent_2', 'agent_4'] }
const FAKE = { target: new Matrix4(), w: 1, curl: null, angles: [], wc: 1, spread: null }

/** the receiver's hands as the stage would leave them this frame: a mug in the right hand, or the can poured with both (until `freeAt`) */
function hold(rig: AgentRig, mode: Mode) {
  if (mode === 'mug-r') rig.want = { kind: 'cup', side: 'r', prefer: 'prop_cup_0', attached: true }
  if (mode === 'both') {
    rig.want = { kind: 'watering_can', side: 'r', prefer: 'prop_watering_can', attached: true }
    rig.drive.l = FAKE as never
  }
}

async function run(method: Method, mode: Mode, freeAt: number, seconds = 14) {
  const w: World = await world()
  const walk = new Walk(w, undefined, false)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  const planes = new PaperPlanes(w.props, w.nodes)
  const [from, to] = PAIR[method]
  const rto = w.rigs[to]
  let faked = false
  walk.before = (t) => {
    faked = t < freeAt
    if (faked) hold(rto, mode)
    planes.update(t, GRAPH, w.rigs, false)
    // the pretend second hand must not drive the real hand
    if (faked && mode === 'both') rto.drive.l = null
  }
  const guard = new Guard(w)
  for (let k = 0; k < 20; k++) walk.step(0.02, guard)
  planes.pass(from, to, method)
  const paper = w.nodes['prop_paper']
  const plane = planes['plane']?.node
  const frames: { t: number; busyNow: boolean; phase: string | null; paper: Vector3; paperVisible: boolean; plane: Vector3 | null; pinchL: Vector3; pinchR: Vector3; passing: boolean; flown: number; log: number; side: string | undefined }[] = []
  for (let k = 0; k < seconds / 0.02; k++) {
    walk.step(0.02, guard)
    frames.push({
      t: walk.t,
      busyNow: faked,
      phase: planes.phase,
      paper: paper.position.clone(),
      paperVisible: paper.visible,
      plane: plane?.visible ? plane.position.clone() : null,
      pinchL: rto.pinchPoint('l', new Vector3()),
      pinchR: rto.pinchPoint('r', new Vector3()),
      passing: planes.passes.busy,
      flown: planes.flown,
      log: planes.passes.log.length,
      side: rto.gesture?.side,
    })
  }
  return { w, planes, guard, frames, from, to, rto, paper, freeAt }
}

const root = (r: AgentRig) => r.parts.root.getWorldPosition(new Vector3())
const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

describe('the receiving hand (#416 ①): the right hand busy, the left one receives', () => {
  for (const method of ['hand', 'slide', 'toss'] as const) {
    it(`${method}: a mug in the right hand, the pass plays with the left hand only (grips and reading: paperSide.test.ts), the paper is clean`, async () => {
      const r = await run(method, 'mug-r', Infinity, 12)
      expect(r.planes.passes.log.at(-1)?.method).toBe(method)
      expectClean(`paper ${method} (right busy)`, r.guard.per['prop_paper'], 'paper')
    })
  }
  it('the paper plane: the left hand catches and looks at it (gesture side l), the plane is in the left hand and never jumps', async () => {
    const r = await run('plane', 'mug-r', Infinity, 12)
    const sides = new Set(r.frames.filter((f) => f.phase === 'fly' || f.phase === 'held').map((f) => f.side))
    expect([...sides]).toEqual(['l'])
    const held = r.frames.filter((f) => f.phase === 'held')
    expect(held.length).toBeGreaterThan(40)
    // it stays in the left hand: the plane's place equals the left pinch while held (no jump between frames)
    // (the biggest step in the held phase is no bigger than with the right hand: the turn to the face and the settling are the same)
    const heldStep = (fr: typeof r.frames) => {
      let worst = 0
      for (let i = 1; i < fr.length; i++) {
        const a = fr[i - 1].plane
        const b = fr[i].plane
        if (a && b && fr[i - 1].phase === 'held' && fr[i].phase === 'held') {
          worst = Math.max(worst, a.distanceTo(b))
        }
      }
      return worst
    }
    const right = await run('plane', 'none', Infinity, 12)
    expect(heldStep(r.frames)).toBeLessThanOrEqual(heldStep(right.frames) * 1.25 + 0.005)
    const mid = held[Math.floor(held.length / 2)]
    expect(mid.plane!.distanceTo(mid.pinchL)).toBeLessThan(0.03)
    expect(mid.plane!.distanceTo(mid.pinchL)).toBeLessThan(mid.plane!.distanceTo(mid.pinchR))
  })
})

describe('both hands busy with what cannot be put down (#416 ①)', () => {
  for (const method of ['hand', 'slide'] as const) {
    it(`${method}: it is not started while both hands are busy (the message waits, it does not turn into a plane), and starts when a hand is free`, async () => {
      const r = await run(method, 'both', 6, 16)
      const waiting = r.frames.filter((f) => f.t < r.freeAt - 0.1)
      expect(waiting.every((f) => !f.passing && f.log === 0 && f.flown === 0 && f.phase === null && !f.paperVisible)).toBe(true)
      expect(r.planes.passes.log.at(-1)?.method).toBe(method)
      expect(r.frames.some((f) => f.t > r.freeAt && f.passing)).toBe(true)
      expectClean(`paper ${method} (deferred)`, r.guard.per['prop_paper'], 'paper')
    })
  }

  it('toss: it lands on the desk 0.3 m in front of the body and lies still, then a hand is free and it is picked up without a jump and read', async () => {
    const r = await run('toss', 'both', 7, 18)
    const body = root(r.rto)
    const lying = r.frames.filter((f) => f.t > r.freeAt - 1.5 && f.t < r.freeAt - 0.1)
    expect(lying.length).toBeGreaterThan(30)
    expect(lying.every((f) => f.paperVisible)).toBe(true)
    const p0 = lying[0].paper
    for (const f of lying) expect(f.paper.distanceTo(p0), 'the paper lies still').toBeLessThan(1e-4)
    // in front of the body (its desk), 0.3 m: horizontally 0.3 +- 0.07, a few cm above the desk top
    expect(Math.abs(flat(p0, body) - 0.3)).toBeLessThan(0.07)
    expect(p0.y).toBeGreaterThan(0.73)
    expect(p0.y).toBeLessThan(0.8)
    // after the hand is free it is lifted (real motion: no frame moves it more than 8 cm) and it ends gone and home
    let worst = 0
    let lifted = 0
    for (let i = 1; i < r.frames.length; i++) {
      const a = r.frames[i - 1]
      const b = r.frames[i]
      if (a.t > r.freeAt - 0.5 && a.paperVisible && b.paperVisible) {
        worst = Math.max(worst, a.paper.distanceTo(b.paper))
        lifted = Math.max(lifted, b.paper.y - p0.y)
      }
    }
    expect(worst).toBeLessThan(0.08)
    expect(lifted, 'it is lifted to the reading place').toBeGreaterThan(0.12)
    expect(r.planes.passes.busy).toBe(false)
    expect(r.paper.visible).toBe(false)
    expectClean('paper toss (landed on the desk)', r.guard.per['prop_paper'], 'paper')
  })

  it('the paper plane: it lands on the desk in front, lies there, and when a hand is free it is picked up (pick, lift, held) with no jump, then gone', async () => {
    const r = await run('plane', 'both', 7, 18)
    const body = root(r.rto)
    const phases: string[] = []
    for (const f of r.frames) if (f.phase && phases.at(-1) !== f.phase) phases.push(f.phase)
    expect(phases).toEqual(['fold', 'fly', 'landed', 'pick', 'lift', 'held'])
    const lying = r.frames.filter((f) => f.phase === 'landed')
    expect(lying.length).toBeGreaterThan(30)
    expect(lying.every((f) => f.t < r.freeAt + 0.05)).toBe(true)
    const p0 = lying[lying.length - 1].plane!
    expect(Math.abs(flat(p0, body) - 0.3)).toBeLessThan(0.12)
    let worst = 0
    for (let i = 1; i < r.frames.length; i++) {
      const a = r.frames[i - 1].plane
      const b = r.frames[i].plane
      if (a && b && r.frames[i - 1].t > r.freeAt) worst = Math.max(worst, a.distanceTo(b))
    }
    expect(worst).toBeLessThan(0.08)
    // the hand really goes down to it before it is lifted: at the end of the reach the free (left) hand is at the plane
    const pick = r.frames.filter((f) => f.phase === 'pick')
    const last = pick[pick.length - 1]
    expect(pick.length).toBeGreaterThan(10)
    expect(last.plane!.distanceTo(last.pinchL), 'the hand is at the plane when it is picked up').toBeLessThan(0.12)
    expect(r.frames.at(-1)!.plane).toBeNull()
    expect(r.planes.busy).toBe(false)
  })
})
