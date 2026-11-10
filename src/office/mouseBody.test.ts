/// <reference types="node" />
// The mouse as a live body (#305): the re-hung parts, the shadow plate, the pad clamp, the schedule's slides (cursor moves, a drag, nothing under
// the wheel, home at the end), the body and its shadow following, the events, and the hand that goes with the body.
import { Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { AgentRig, PropBank, buildRig } from './rig'
import { Typist } from './typist'
import { PlayStage, type StageIn } from './playStage'
import { GRAPH } from './navSpots.fixture'
import { chunkIndexAt, makeChunk, type Chunk } from './typingSchedule'
import { DEFAULT_PAD, clampToPad, offsetAt, padOf, slideTargets } from './mouseBody'
import { onInput, type InputEvent } from './inputEvents'
import type { Goal } from './director'

stubCanvas()

const SEATS = [0, 1, 3, 4]
const PARTS = ['_l', '_r', '_wheel', '_contact_index', '_contact_middle', '_grip_r', '_shadow']

const setup = async () => {
  const { scene, nodes } = await loadOffice()
  scene.updateMatrixWorld(true)
  const rigs = [0, 1, 2, 3, 4].map((i) => new AgentRig(`agent_${i}`, i, buildRig(scene, nodes, i), '#ffffff'))
  return { scene, nodes, rigs, ty: new Typist(nodes) }
}
const opts = (t: number, extra: object = {}) => ({ t, dt: 1 / 60, reduced: false, activity: 'edit', dilation: 1, still: false, leftOnly: false, hasMouse: true, ...extra })
function run(ty: Typist, rig: AgentRig, seat: number, t0: number, t1: number, each?: (t: number) => void, extra: object = {}) {
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    rig.drive = { l: null, r: null }
    ty.step(rig, seat, opts(t, extra))
    rig.applyDrive('l', t, false)
    rig.applyDrive('r', t, false)
    each?.(t)
  }
}

/** the body's offset from rest in its rest frame (x, z), read off the scene graph */
const offsetOf = (body: Object3D, restPos: Vector3, restQ: { clone(): { invert(): unknown } } & Parameters<Vector3['applyQuaternion']>[0]) => {
  const d = body.position.clone().sub(restPos)
  const inv = (restQ as unknown as { clone(): { invert(): Parameters<Vector3['applyQuaternion']>[0] } }).clone().invert()
  d.applyQuaternion(inv)
  return { x: d.x, y: d.y, z: d.z }
}

/** the chunks of an agent in an activity that have slides, with their number */
function chunksWithSlides(agent: string, activity: string, want: (c: Chunk) => boolean = () => true, n = 200) {
  const out: Chunk[] = []
  for (let i = 0; i < n; i++) {
    const c = makeChunk(agent, i, activity, { mouse: true })
    if (c.slides.length && want(c)) out.push(c)
  }
  return out
}

describe('the pad (mouseBody.ts)', () => {
  it('reads the glb pad extras, junk falls back to the baked desk pad', () => {
    expect(padOf({ center: [0, 0.03], half: [0.125, 0.105] })).toEqual({ cx: 0, cz: 0.03, hx: 0.125, hz: 0.105 })
    expect(padOf(undefined)).toEqual(DEFAULT_PAD)
    expect(padOf({ center: [0, 0], half: [0, 1] })).toEqual(DEFAULT_PAD)
    expect(padOf({ center: [0, 'x'], half: [1, 1] })).toEqual(DEFAULT_PAD)
  })

  it('clamps to the pad rectangle, per axis (it slides along an edge)', () => {
    const pad = padOf({ center: [0, 0.03], half: [0.125, 0.105] })
    expect(clampToPad(0.5, 0.5, pad)).toEqual({ x: 0.125, z: 0.135 })
    expect(clampToPad(-0.5, -0.5, pad)).toEqual({ x: -0.125, z: -0.075 })
    expect(clampToPad(0.05, -0.5, pad)).toEqual({ x: 0.05, z: -0.075 })
    expect(clampToPad(0.01, 0.02, pad)).toEqual({ x: 0.01, z: 0.02 })
  })

  it('the integrated slides never leave the pad, however far they ask; home is back at rest', () => {
    const pad = padOf({ center: [0, 0.03], half: [0.125, 0.105] })
    const slides = [
      { t0: 0, t1: 1, dx: 0.3, dz: 0.3 },
      { t0: 2, t1: 3, dx: 0.3, dz: 0.3 },
      { t0: 4, t1: 5, dx: -1, dz: -1 },
      { t0: 6, t1: 7, dx: 0, dz: 0, home: true },
    ]
    const tg = slideTargets(slides, pad)
    for (let i = 0; i < slides.length; i++) {
      const c = clampToPad(tg[i * 2], tg[i * 2 + 1], pad)
      expect([tg[i * 2], tg[i * 2 + 1]]).toEqual([c.x, c.z])
    }
    expect([tg[0], tg[1]]).toEqual([0.125, 0.135])
    expect([tg[4], tg[5]]).toEqual([-0.125 + 0, -0.075]) // 0.125 - 1 clamps to the far edge
    expect([tg[6], tg[7]]).toEqual([0, 0])
    // eased between ends, a function of t alone, never outside the pad
    const o = { x: 0, z: 0 }
    for (let t = -1; t <= 8; t += 0.05) {
      offsetAt(slides, tg, t, o)
      expect(o.x).toBeGreaterThanOrEqual(-0.125 - 1e-12)
      expect(o.x).toBeLessThanOrEqual(0.125 + 1e-12)
      expect(o.z).toBeGreaterThanOrEqual(-0.075 - 1e-12)
      expect(o.z).toBeLessThanOrEqual(0.135 + 1e-12)
    }
    expect(offsetAt(slides, tg, -1, o)).toEqual({ x: 0, z: 0 })
    expect(offsetAt(slides, tg, 1.5, o)).toEqual({ x: 0.125, z: 0.135 }) // held between
    expect(offsetAt(slides, tg, 8, o)).toEqual({ x: 0, z: 0 })
  })
})

describe('the mouse body in the model', () => {
  it('buttons, wheel, contacts, hand place and shadow hang under the body, rigidly, from load', async () => {
    const { scene, nodes } = await setup()
    for (const i of SEATS) {
      const body = nodes[`desk_${i}_mouse`]
      expect(body.userData.pad, `desk ${i} pad`).toBeTruthy()
      for (const p of PARTS) expect(scene.getObjectByName(`desk_${i}_mouse${p}`)?.parent, `desk ${i} ${p}`).toBe(body)
      // moving the body moves every one of them by the same step
      const before = PARTS.map((p) => scene.getObjectByName(`desk_${i}_mouse${p}`)!.getWorldPosition(new Vector3()))
      body.position.x += 0.03
      body.updateMatrixWorld(true)
      PARTS.forEach((p, k) => expect(scene.getObjectByName(`desk_${i}_mouse${p}`)!.getWorldPosition(new Vector3()).sub(before[k]).length(), `${p}`).toBeCloseTo(0.03, 6))
      body.position.x -= 0.03
      body.updateMatrixWorld(true)
    }
    // desk 2 has none
    expect(nodes.desk_2_mouse).toBeUndefined()
    expect(scene.getObjectByName('desk_2_mouse_shadow')).toBeUndefined()
  })

  it('the world pose of every part is where the model baked it (the rest frame: buttons in front, the wheel between them)', async () => {
    const { nodes } = await setup()
    const b = nodes.desk_0_mouse.getWorldPosition(new Vector3())
    expect(b.toArray().map((v) => +v.toFixed(3))).toEqual([-3.1, 0.743, -2.39])
    const l = nodes.desk_0_mouse_l.getWorldPosition(new Vector3())
    const r = nodes.desk_0_mouse_r.getWorldPosition(new Vector3())
    const w = nodes.desk_0_mouse_wheel.getWorldPosition(new Vector3())
    expect(l.toArray().map((v) => +v.toFixed(3))).toEqual([-3.088, 0.778, -2.385])
    expect(r.toArray().map((v) => +v.toFixed(3))).toEqual([-3.112, 0.778, -2.385])
    expect(w.toArray().map((v) => +v.toFixed(3))).toEqual([-3.1, 0.77, -2.356])
  })

  it('the shadow plate: a soft radial blob, unlit, depth-write off, offset toward the camera, about 35 % dark at the centre', async () => {
    const { nodes } = await setup()
    for (const i of SEATS) {
      const meshes: Mesh[] = []
      nodes[`desk_${i}_mouse_shadow`].traverse((o) => o instanceof Mesh && meshes.push(o))
      expect(meshes).toHaveLength(1)
      const m = meshes[0].material as MeshBasicMaterial
      expect(m.type).toBe('MeshBasicMaterial')
      expect(m.transparent).toBe(true)
      expect(m.depthWrite).toBe(false)
      expect(m.polygonOffset).toBe(true)
      expect(m.color.getHex()).toBe(0)
      const img = m.map!.image as { data: Uint8Array; width: number; height: number }
      const a = (u: number, v: number) => img.data[(v * img.width + u) * 4 + 3]
      const mid = img.width >> 1
      expect(a(mid, mid) / 255).toBeGreaterThan(0.3)
      expect(a(mid, mid) / 255).toBeLessThan(0.4)
      expect(a(0, 0)).toBe(0) // soft to nothing at the edge
      expect(a(mid, 0)).toBeLessThan(a(mid, mid) * 0.2)
      expect(a(mid, mid >> 1)).toBeLessThanOrEqual(a(mid, mid))
    }
  })
})

describe('the schedule slides', () => {
  const all = [...['agent_0', 'agent_1', 'agent_3', 'agent_4']].flatMap((a) => ['edit', 'read', 'cmd', 'think', 'delegate'].flatMap((act) => chunksWithSlides(a, act, () => true, 60)))
  it('there are plenty, deterministic from the seed', () => {
    expect(all.length).toBeGreaterThan(50)
    const a = makeChunk('agent_1', 7, 'edit', { mouse: true })
    expect(makeChunk('agent_1', 7, 'edit', { mouse: true }).slides).toEqual(a.slides)
    // the keys and clicks of a chunk do not depend on the slides' own random stream: the same acts as before
    expect(a.mouse.every((m) => m.kind === 'down' || m.kind === 'up' || m.kind === 'wheel')).toBe(true)
  })

  it('cursor moves are 1-4 cm in 0.15-0.35 s; the way home is at most a few cm; all inside an episode, after the hand is there, before it lets go', () => {
    for (const c of all) {
      for (const s of c.slides) {
        const ep = c.episodes.find((e) => s.t0 >= e.t0 && s.t1 <= e.t1)
        expect(ep, 'a slide inside an episode').toBeTruthy()
        expect(s.t0, 'the hand has closed on the body').toBeGreaterThanOrEqual(ep!.t0 + 0.55 - 1e-9)
        expect(s.t1, 'done before the hand lets go').toBeLessThanOrEqual(ep!.t1 - 0.15 + 1e-9)
        expect(s.t1 - s.t0).toBeGreaterThanOrEqual(0.15 - 1e-9)
        expect(s.t1 - s.t0).toBeLessThanOrEqual(0.35 + 1e-9)
        if (s.home) continue
        const len = Math.hypot(s.dx, s.dz)
        expect(len).toBeGreaterThanOrEqual(0.0099)
        expect(len).toBeLessThanOrEqual(0.0401)
      }
    }
  })

  it('every episode with slides ends with exactly one way home, and the unclamped walk stays within 6 cm of rest', () => {
    for (const c of all) {
      for (const ep of c.episodes) {
        const mine = c.slides.filter((s) => s.t0 >= ep.t0 && s.t1 <= ep.t1)
        if (!mine.length) continue
        expect(mine.filter((s) => s.home)).toHaveLength(1)
        expect(mine[mine.length - 1].home).toBe(true)
        let x = 0
        let z = 0
        for (const s of mine) {
          if (s.home) break
          x += s.dx
          z += s.dz
          expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.06)
        }
      }
      for (let i = 1; i < c.slides.length; i++) expect(c.slides[i].t0, 'one slide at a time').toBeGreaterThanOrEqual(c.slides[i - 1].t1 - 1e-9)
    }
  })

  it('a drag is a button held down while it slides: down … slide … up, and the events stay down / up / wheel', () => {
    const withDrag = all.filter((c) => c.slides.some((s) => s.drag))
    expect(withDrag.length).toBeGreaterThan(3)
    for (const c of withDrag) {
      for (const s of c.slides.filter((x) => x.drag)) {
        const down = [...c.mouse].filter((m) => m.kind === 'down' && m.t <= s.t0).pop()!
        const up = c.mouse.find((m) => m.kind === 'up' && m.button === down.button && m.t > down.t)!
        expect(down.t).toBeLessThan(s.t0)
        expect(up.t).toBeGreaterThan(s.t1)
      }
      for (const e of c.events) if (e.type === 'mouse') expect(['down', 'up', 'wheel']).toContain(e.kind)
      expect(Object.keys(c.events.find((e) => e.type === 'mouse')!).sort()).toEqual(['button', 'kind', 't', 'type', ...(c.events.find((e) => e.type === 'mouse')!.kind === 'wheel' ? ['dir', 'ticks'] : [])].sort())
    }
  })

  it('the wheel rolls under the finger with the body still: no slide near a notch', () => {
    let n = 0
    for (const c of all) {
      for (const w of c.mouse.filter((m) => m.kind === 'wheel')) {
        n++
        for (const s of c.slides) expect(s.t1 <= w.t - 0.4 || s.t0 >= w.t + 0.4, `slide ${s.t0.toFixed(2)}-${s.t1.toFixed(2)} vs notch ${w.t.toFixed(2)}`).toBe(true)
      }
    }
    expect(n).toBeGreaterThan(30)
  })

  it('desk 2 (no mouse) has no slides, ever', () => {
    for (const act of ['edit', 'read', 'cmd', 'think', 'delegate']) for (let i = 0; i < 40; i++) expect(makeChunk('agent_2', i, act, { mouse: false }).slides).toEqual([])
  })
})

describe('the body moves with the typist', () => {
  it('slides inside the pad, a drag moves it while held, comes home at the end of the episode, the shadow and the buttons ride along, events at the buttons', async () => {
    const { ty, rigs, nodes } = await setup()
    const seat = 1
    const rig = rigs[seat]
    const body = nodes[`desk_${seat}_mouse`]
    const pad = padOf(body.userData.pad)
    const restPos = body.position.clone()
    const restQ = body.quaternion.clone()
    const c = chunksWithSlides(rig.id, 'edit', (x) => x.slides.some((s) => s.drag) && x.mouse.some((m) => m.kind === 'down'), 120)[0]
    expect(c, 'a chunk with a drag').toBeTruthy()
    const ep = c.episodes.find((e) => c.slides.some((s) => s.t0 >= e.t0 && s.t1 <= e.t1 && s.drag))!
    const drag = c.slides.find((s) => s.drag && s.t0 >= ep.t0 && s.t1 <= ep.t1)!
    const events: InputEvent[] = []
    const off = onInput((e) => events.push(e))
    let maxOff = 0
    let dragMoved = 0
    let dragStart: { x: number; z: number } | null = null
    const shadow = nodes[`desk_${seat}_mouse_shadow`]
    const bl = nodes[`desk_${seat}_mouse_l`]
    let rigid = 0
    run(ty, rig, seat, ep.t0 - 0.5, ep.t1 + 0.4, (t) => {
      const o = offsetOf(body, restPos, restQ)
      expect(o.y, 'never lifted').toBeCloseTo(0, 9)
      // inside the pad, in the rest frame
      expect(o.x).toBeGreaterThanOrEqual(pad.cx - pad.hx - 1e-9)
      expect(o.x).toBeLessThanOrEqual(pad.cx + pad.hx + 1e-9)
      expect(o.z).toBeGreaterThanOrEqual(pad.cz - pad.hz - 1e-9)
      expect(o.z).toBeLessThanOrEqual(pad.cz + pad.hz + 1e-9)
      maxOff = Math.max(maxOff, Math.hypot(o.x, o.z))
      if (t <= drag.t0) dragStart = { x: o.x, z: o.z }
      if (t >= drag.t1 && dragStart) dragMoved = Math.max(dragMoved, Math.hypot(o.x - dragStart.x, o.z - dragStart.z))
      // the shadow and the button are the body's rigid riders: their offset from the body is what the model baked
      const rel = shadow.getWorldPosition(new Vector3()).sub(body.getWorldPosition(new Vector3()))
      expect(rel.length()).toBeLessThan(1e-6)
      rigid = Math.max(rigid, bl.getWorldPosition(new Vector3()).sub(body.getWorldPosition(new Vector3())).length())
    })
    off()
    expect(maxOff, 'it did slide').toBeGreaterThan(0.009)
    expect(dragMoved, 'the drag moved the body').toBeGreaterThan(0.009)
    expect(rigid).toBeLessThan(0.04)
    // home at the end, exactly
    const end = offsetOf(body, restPos, restQ)
    expect(Math.hypot(end.x, end.z)).toBeLessThan(1e-6)
    // the events: down / up / wheel at the button (the body's own world), with t and pos
    const mice = events.filter((e) => e.type === 'mouse')
    expect(mice.length).toBeGreaterThan(1)
    for (const e of mice) {
      expect(['down', 'up', 'wheel']).toContain(e.kind)
      expect(typeof e.t).toBe('number')
      expect(e.pos).toBeInstanceOf(Vector3)
    }
    const downs = mice.filter((e) => e.kind === 'down').length
    expect(mice.filter((e) => e.kind === 'up').length).toBe(downs)
  })

  it('the event position follows the body: a click during a slide is where the button then is', async () => {
    const { ty, rigs, nodes } = await setup()
    const seat = 3
    const rig = rigs[seat]
    const body = nodes[`desk_${seat}_mouse`]
    const bl = nodes[`desk_${seat}_mouse_l`]
    const restPos = body.position.clone()
    const c = chunksWithSlides(rig.id, 'edit', (x) => x.slides.some((s) => s.drag) && x.mouse.some((m) => m.kind === 'down'), 160)[0]
    const drag = c.slides.find((s) => s.drag)!
    const down = c.mouse.filter((m) => m.kind === 'down' && m.t < drag.t0).pop()!
    const up = c.mouse.find((m) => m.kind === 'up' && m.t > drag.t1)!
    const ev: InputEvent[] = []
    const off = onInput((e) => ev.push(e))
    let upPos: Vector3 | null = null
    run(ty, rig, seat, down.t - 0.6, up.t + 0.1, () => {
      // the first frame after the up is sent, the button is where the event says
      const e = ev.find((x) => x.type === 'mouse' && x.kind === 'up' && Math.abs(x.t - up.t) < 1e-6)
      if (e && !upPos) {
        upPos = e.pos.clone()
        expect(bl.getWorldPosition(new Vector3()).distanceTo(e.pos)).toBeLessThan(0.002)
      }
    })
    off()
    const dn = ev.find((x) => x.type === 'mouse' && x.kind === 'down' && Math.abs(x.t - down.t) < 1e-6)
    expect(dn && upPos).toBeTruthy()
    // the drag shows in the events: the button was elsewhere when it went up
    expect(upPos!.distanceTo(dn!.pos)).toBeGreaterThan(0.008)
    expect(body.position.distanceTo(restPos)).toBeLessThan(0.2)
  })

  it('reduced motion and a still frame: the body does not move', async () => {
    const { ty, rigs, nodes } = await setup()
    const seat = 4
    const rig = rigs[seat]
    const body = nodes[`desk_${seat}_mouse`]
    const rest = body.position.clone()
    const c = chunksWithSlides(rig.id, 'edit', () => true, 120)[0]
    const s = c.slides[0]
    run(ty, rig, seat, s.t0 - 0.3, s.t1 + 0.3, undefined, { reduced: true })
    expect(body.position.distanceTo(rest)).toBe(0)
    run(ty, rig, seat, s.t0 - 0.3, s.t1 + 0.3, undefined, { still: true })
    expect(body.position.distanceTo(rest)).toBe(0)
  })

  it('a clock jump into the middle of a slide never teleports the body: it catches up at a bounded speed', async () => {
    const { ty, rigs, nodes } = await setup()
    const seat = 0
    const rig = rigs[seat]
    const body = nodes[`desk_${seat}_mouse`]
    const c = chunksWithSlides(rig.id, 'edit', () => true, 120)[0]
    const s = c.slides.find((x) => !x.home)!
    let prev = body.position.clone()
    let worst = 0
    run(ty, rig, seat, s.t0 - 2, s.t0 - 1.9) // somewhere before, at rest
    prev = body.position.clone()
    run(ty, rig, seat, (s.t0 + s.t1) / 2, (s.t0 + s.t1) / 2 + 0.5, () => {
      worst = Math.max(worst, body.position.distanceTo(prev) * 60)
      prev = body.position.clone()
    })
    expect(worst, 'm/s').toBeLessThanOrEqual(1.0 + 1e-6)
  })
})

describe('the hand goes with the body', () => {
  it('while the right hand grips the mouse, the hand follows the body across the pad (palm on the body)', async () => {
    const { scene, nodes, rigs } = await setup()
    const props = new PropBank(scene, nodes)
    const stage = new PlayStage(scene, nodes, props)
    const seat = 1
    const rig = rigs[seat]
    const ids = Object.keys(Object.fromEntries(rigs.map((r) => [r.id, 1])))
    const sp = GRAPH.spots[`work_${seat}`]
    rig.at = `work_${seat}`
    rig.x = sp.x
    rig.z = sp.z
    rig.heading = sp.ry
    rig.parts.root.position.set(sp.x, 0, sp.z)
    rig.parts.root.rotation.set(0, sp.ry, 0)
    rig.parts.root.updateMatrixWorld(true)
    const goals = Object.fromEntries(ids.map((id) => [id, { spot: 'work_0', pose: 'idle', label: '' } as Goal]))
    goals[rig.id] = { spot: `work_${seat}`, pose: 'type', label: '' }
    const body = nodes[`desk_${seat}_mouse`]
    const restPos = body.position.clone()
    const c = chunksWithSlides(rig.id, 'edit', (x) => x.slides.some((s) => s.drag), 160)[0]
    const ep = c.episodes.find((e) => c.slides.some((s) => s.t0 >= e.t0 && s.t1 <= e.t1 && s.drag))!
    const drag = c.slides.find((s) => s.drag && s.t0 >= ep.t0 && s.t1 <= ep.t1)!
    const rigsById = Object.fromEntries(rigs.map((r) => [r.id, r]))
    const frame = (t: number): StageIn => ({ now: Math.round(t * 1000), t, dt: 1 / 60, reduced: false, replaying: false, rigs: rigsById, goals, status: { [rig.id]: { state: 'working', activity: 'edit', since: 0 } }, tablet: false, stamp: false, colors: {} })
    const handAt: { t: number; hand: Vector3; body: Vector3 }[] = []
    for (let t = ep.t0 - 0.6; t <= ep.t1 + 0.3; t += 1 / 60) {
      stage.update(frame(t))
      for (const r of rigs) {
        r.applyDrive('l', t, false)
        r.applyDrive('r', t, false)
      }
      scene.updateMatrixWorld(true)
      const hand = rig.parts.hands.r.grip!.getWorldPosition(new Vector3())
      handAt.push({ t, hand, body: body.getWorldPosition(new Vector3()) })
    }
    // gripped (well after the hand arrives, well before it lets go), the hand keeps its place on the body while the body slides
    const during = handAt.filter((h) => h.t >= ep.t0 + 0.6 && h.t <= ep.t1 - 0.2)
    expect(during.length).toBeGreaterThan(20)
    const rel = during.map((h) => h.hand.clone().sub(h.body))
    const spread = Math.max(...rel.map((r) => r.distanceTo(rel[0])))
    expect(spread, 'the hand stays on the body (m)').toBeLessThan(0.02)
    // and the body really went somewhere
    const far = Math.max(...during.map((h) => h.body.distanceTo(restPos)))
    expect(far).toBeGreaterThan(0.009)
    expect(drag.t1).toBeLessThanOrEqual(ep.t1)
    void chunkIndexAt
  }, 60000)
})
