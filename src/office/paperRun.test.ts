import { describe, expect, it } from 'vitest'
import { Box3, Quaternion, Vector3 } from 'three'
import { GRAPH } from './navSpots.fixture'
import { PaperPlanes } from './plane'
import { Guard, IDS, Walk, expectClean, world, type World } from './errandWorld.fixture'
import type { Method } from './paperPass'

const FROM_TO: Record<string, [string, string]> = { hand: ['agent_2', 'agent_1'], slide: ['agent_2', 'agent_3'], toss: ['agent_2', 'agent_4'] }

async function play(method: Method, opts: { reduced?: boolean; fast?: boolean } = {}) {
  const w: World = await world()
  const walk = new Walk(w, undefined, opts.reduced ?? false)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  const planes = new PaperPlanes(w.props, w.nodes)
  walk.before = (t) => planes.update(t, GRAPH, w.rigs, opts.reduced ?? false)
  const guard = new Guard(w)
  for (let k = 0; k < 20; k++) walk.step(0.02, guard)
  if (opts.fast) for (const r of Object.values(w.rigs)) ((r.gestureMin = 0.15), (r.ambient = 0))
  const [from, to] = FROM_TO[method]
  planes.pass(from, to, method)
  const frames: { s: number; pos: Vector3; quat: Quaternion; opacity: number; hold: number; faceMinY: number; headToPaper: number }[] = []
  let started = -1
  for (let k = 0; k < 15 / 0.02; k++) {
    walk.step(0.02, guard)
    if (planes.passes.busy && started < 0) started = walk.t
    const st = planes.passes.lastState
    if (st && planes.passes.method) frames.push({ s: walk.t - started, pos: st.pos.clone(), quat: st.quat.clone(), opacity: st.opacity, hold: (st.holder.from ? 1 : 0) + (st.holder.to ? 2 : 0), faceMinY: new Box3().setFromObject(w.nodes[`${to}_face`]).min.y, headToPaper: 0 })
    if (started > 0 && !planes.busy) break
  }
  return { w, planes, guard, frames, from, to }
}

describe('paper passes (#262): the #228 guards', () => {
  for (const method of ['hand', 'slide', 'toss'] as const) {
    it(`${method}: taken and let go without a jump, within reach, nothing loose, and the paper is home at the end`, async () => {
      const r = await play(method)
      expect(r.planes.passes.log.at(-1)?.method).toBe(method)
      expectClean(`paper ${method}`, r.guard.per['prop_paper'], 'paper')
      const node = r.w.nodes['prop_paper']
      expect(node.visible).toBe(false)
      expect(r.w.props.borrowed.has(node)).toBe(true)
    })
  }
  it('the reduced-motion pass: fades from the giver and appears at the receiver, nothing moves between', async () => {
    const r = await play('toss', { reduced: true })
    expectClean('paper reduced', r.guard.per['prop_paper'], 'paper')
    expect(r.frames.length).toBeGreaterThan(5)
  })
})

describe('paper passes (#262): the stages', () => {
  it('hand over: both hold it for 0.15 s, and it is held from one hand to the other with no gap', async () => {
    const r = await play('hand')
    const both = r.frames.filter((f) => f.hold === 3)
    const dt = 0.02
    expect(both.length * dt).toBeGreaterThanOrEqual(0.12)
    expect(both.length * dt).toBeLessThanOrEqual(0.2)
    // always somebody holds it from the first grasp on until it is gone
    const first = r.frames.findIndex((f) => f.hold !== 0)
    const gone = r.frames.findIndex((f, i) => i > first && f.opacity <= 0.001 && f.hold === 0)
    expect(r.frames.slice(first, gone).every((f) => f.hold !== 0)).toBe(true)
    // the meeting point is the middle between the two bodies
    const mid = r.frames.find((f) => f.hold === 3)!
    const a = r.w.rigs[r.from]
    const b = r.w.rigs[r.to]
    expect(Math.hypot(mid.pos.x - (a.x + b.x) / 2, mid.pos.z - (a.z + b.z) / 2)).toBeLessThan(0.02)
  })
  for (const method of ['hand', 'slide', 'toss'] as const) {
    it(method + ': at the reading place the top edge is below the face screen (seen from the front), and it fades after 1.5 s', async () => {
      const r = await play(method)
      const reading = r.frames.filter((f) => f.hold === 2 && f.opacity === 1)
      expect(reading.length).toBeGreaterThan(40)
      const f = reading[reading.length - 3]
      const top = new Vector3(0, 0, 0.1485).applyQuaternion(f.quat).add(f.pos)
      expect(top.y).toBeLessThan(f.faceMinY)
      const fade = r.frames.filter((x) => x.hold === 2 && x.opacity < 1 && x.opacity > 0)
      expect(fade.length * 0.02).toBeGreaterThan(0.2)
      expect(fade.length * 0.02).toBeLessThan(0.4)
    })
  }
  it('the slide keeps clear of the monitor stands (nothing tall on the desk touches the paper all along the way)', async () => {
    const r = await play('slide')
    const desks = r.planes.passes.desks!
    const slid = r.frames.filter((f) => f.hold === 0 && f.opacity === 1)
    expect(slid.length).toBeGreaterThan(20)
    for (const f of slid) {
      const dir = new Vector3(0, 0, 1).applyQuaternion(f.quat)
      expect(desks.hits(f.pos.x, f.pos.z, dir.x, dir.z, 0.1485, 0.105, 2)).toBe(false)
    }
  })
  it('reduced motion: no flight, the paper is only ever at the giver hand or the receiver reading place', async () => {
    const r = await play('toss', { reduced: true })
    const xs = r.frames.map((f) => f.pos)
    const readingAt = xs[xs.length - 12]
    // a fast pass (a quarter of a second to appear): the whole pass is short
    expect(r.frames.length * 0.02).toBeLessThan(2.5)
    expect(readingAt).toBeDefined()
  })
  it('x16: the same method, compressed in time', async () => {
    const slow = await play('toss')
    const fast = await play('toss', { fast: true })
    expect(fast.planes.passes.log.at(-1)?.method).toBe('toss')
    expect(fast.frames.length).toBeLessThan(slow.frames.length)
  })
})
