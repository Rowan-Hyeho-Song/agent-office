import { BoxGeometry, Matrix4, Mesh, Object3D, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { NavGraph } from './nav'
import { GRAPH } from './navSpots.fixture'
import { FADE_S, LOOK_S, PaperPlanes, REDUCED_IN_S } from './plane'
import { planGesture } from './aim'
import type { AgentRig, PropBank } from './rig'

// #224: after a handoff the plane (or the receiver) was seen going to 메모's desk. The plane's home is the planner's tray,
// and at the end of every flight it was let go and eased back there. Now a copy flies, is put down on the receiver's
// desk and is gone; the tray's plane never moves.

const SEATS = [0, 1, 2, 3, 4]
/** the fixture has four desks; a fifth (#193) beside them, facing the same way */
const graph: NavGraph = { ...GRAPH, spots: { ...GRAPH.spots, work_4: { id: 'work_4', x: 0.8, z: -2.57, ry: 0, kind: 'work' } } } as NavGraph

function world() {
  const scene = new Scene()
  const tray = new Object3D()
  tray.name = 'prop_plane'
  tray.add(new Mesh(new BoxGeometry(0.06, 0.01, 0.08)))
  // on 메모's tray (seat 0)
  const home = PaperPlanes.deskPoint(graph, 'agent_0', new Vector3())
  tray.position.set(home.x + 0.2, home.y, home.z)
  scene.add(tray)
  scene.updateMatrixWorld(true)
  const props = { find: () => ({ node: tray, gripLocal: new Matrix4() }), borrowed: new Set<Object3D>() } as unknown as PropBank
  return { scene, tray, planes: new PaperPlanes(props, {}) }
}

/** a rig at its desk: the right hand in front of the chest, the fingers pointing at the desk */
function rig(seat: number, visible: boolean): AgentRig {
  const s = graph.spots[`work_${seat}`]
  const fwd = new Vector3(-Math.sin(s.ry), 0, -Math.cos(s.ry))
  const hand = new Vector3(s.x, 1.1, s.z).addScaledVector(fwd, 0.3)
  const grip = new Object3D()
  grip.position.copy(hand)
  grip.updateMatrixWorld(true)
  const me = {
    id: `agent_${seat}`,
    visible,
    x: s.x,
    z: s.z,
    gesture: null as AgentRig['gesture'],
    /** the real rig plans the turn from its own position and heading (seated at a desk here) */
    startGesture(kind: 'throw' | 'catch', t: number, at: Vector3, o: { reduced?: boolean; flyFor?: number; holdS?: number; oneHand?: boolean } = {}) {
      const theta = Math.atan2(-(at.x - s.x), -(at.z - s.z)) - s.ry
      const plan = planGesture(kind, Math.atan2(Math.sin(theta), Math.cos(theta)), { seated: true, reduced: !!o.reduced, fast: false, minTurn: 0, bodyOk: true, flyFor: o.flyFor, holdS: o.holdS })
      return (me.gesture = { kind, until: t + plan.times.end, oneHand: o.oneHand, t0: t, at, plan })
    },
    parts: { hands: { r: { grip, node: grip } } },
    pinchPoint: (_side: string, out = new Vector3()) => out.copy(hand),
    fingerDir: (_side: string, out = new Vector3()) => out.copy(fwd),
    /** the received-paper face (#267): what the plane asked for, and when */
    reactions: [] as { kind: string; t: number; reduced: boolean }[],
    paperReaction(kind: string, t: number, reduced = false) {
      me.reactions.push({ kind, t, reduced })
    },
    /** the test moves the catching hand */
    hand,
  }
  return me as unknown as AgentRig
}

const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

describe('the paper plane stays with the receiver (#224)', () => {
  for (const caught of [true, false])
    it(`${caught ? 'caught' : 'landed on an empty desk'}: every sender → receiver of the five seats; after it arrives the plane never leaves the receiver's desk, it is gone at the end, and the tray's plane never moves`, () => {
      for (const from of SEATS)
        for (const to of SEATS) {
          if (from === to) continue
          const { tray, planes } = world()
          const trayAt = tray.position.clone()
          const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, n === to ? caught : true)]))
          planes.receive({ kind: 'handoff', from: `agent_${from}`, to: `agent_${to}` } as never)
          const desk = PaperPlanes.deskPoint(graph, `agent_${to}`, new Vector3())
          const flier = planes['plane']!.node
          let arrived = false
          let far = 0
          for (let t = 0; t < 12; t += 1 / 60) {
            planes.update(t, graph, rigs, false)
            const ph = planes.phase
            if (ph === 'held' || ph === 'landed') arrived = true
            // from the catch on: within reach of the receiver's desk (the hand is 0.3 m ahead of the seat, the desk 0.33)
            if (arrived && flier.visible) far = Math.max(far, flat(flier.position, desk))
            expect(tray.position.distanceTo(trayAt), `tray moved, ${from} → ${to} at ${t.toFixed(2)} s`).toBe(0)
          }
          expect(arrived, `${from} → ${to} arrived`).toBe(true)
          expect(far, `${from} → ${to}: the plane left the receiver's desk`).toBeLessThan(0.5)
          expect(planes.phase, `${from} → ${to} finished`).toBe(null)
          expect(flier.visible, `${from} → ${to}: gone at the end`).toBe(false)
        }
    })

  it('a sender that is not in throws from its own desk, never from the planner tray', () => {
    const { planes } = world()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, n !== 2)]))
    planes.receive({ kind: 'handoff', from: 'agent_2', to: 'agent_1' } as never)
    planes.update(0, graph, rigs, false)
    const start = planes['flight']!.start as Vector3
    expect(flat(start, PaperPlanes.deskPoint(graph, 'agent_2', new Vector3()))).toBeLessThan(0.01)
  })

  it('reduced motion: in the receiver hand at once (fading in over 0.12 s), looked at, faded out there, gone (#267)', () => {
    const { tray, planes } = world()
    const trayAt = tray.position.clone()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, true)]))
    planes.receive({ kind: 'handoff', from: 'agent_0', to: 'agent_3' } as never)
    planes.update(0, graph, rigs, true)
    const flier = planes['plane']!.node
    const hand = (rigs.agent_3 as unknown as { hand: Vector3 }).hand
    expect(planes.phase).toBe('held')
    expect(flier.position.distanceTo(hand)).toBeLessThan(0.1)
    planes.update(REDUCED_IN_S / 2, graph, rigs, true)
    expect(planes.fade).toBeGreaterThan(0)
    expect(planes.fade).toBeLessThan(1)
    expect((rigs.agent_3 as unknown as { reactions: { kind: string; reduced: boolean }[] }).reactions[0]).toMatchObject({ kind: 'surprise', reduced: true })
    for (let t = 0; t < 4; t += 0.1) planes.update(t, graph, rigs, true)
    expect(flier.visible).toBe(false)
    expect(tray.position.distanceTo(trayAt)).toBe(0)
  })
})

// #267: a received plane was seen gliding to the receiver's desk by itself after the catch. Now it stays in the hand, is looked at
// for LOOK_S (paper-pass.md 5 "끝맺음"), fades out there over FADE_S and is gone; the face goes surprise -> nod -> status
describe('a received plane ends in the hand (#267)', () => {
  it('every pair: from the catch on the plane is in the catching hand every frame (never moving on its own), opaque for LOOK_S, faded by LOOK_S + FADE_S, then gone; the receiver is asked for surprise at the catch; the tray plane never fades', () => {
    for (const from of SEATS)
      for (const to of SEATS) {
        if (from === to) continue
        const { tray, planes } = world()
        const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, true)]))
        planes.receive({ kind: 'handoff', from: `agent_${from}`, to: `agent_${to}` } as never)
        const flier = planes['plane']!.node
        const hand = (rigs[`agent_${to}`] as unknown as { hand: Vector3 }).hand
        let caughtAt: number | null = null
        let lastHandGap = -1
        let minFade = 1
        let lastHeld = -1
        let opaqueUntil = -1
        for (let t = 0; t < 12; t += 1 / 60) {
          planes.update(t, graph, rigs, false)
          if (planes.phase === 'held') {
            caughtAt ??= t
            const gap = flier.position.distanceTo(hand)
            // in the hand: the same offset from the fingers every frame (it follows the hand, nothing else)
            if (lastHandGap >= 0) expect(Math.abs(gap - lastHandGap), `${from} → ${to} at ${t.toFixed(2)} s`).toBeLessThan(1e-6)
            lastHandGap = gap
            if (planes.fade === 1) opaqueUntil = t - caughtAt
            minFade = Math.min(minFade, planes.fade)
            lastHeld = t - caughtAt
          }
          expect(planes.phase === 'landed', `${from} → ${to}: never put down on a desk`).toBe(false)
          tray.traverse((n) => {
            const m = (n as Mesh).material as { opacity?: number } | undefined
            if (m?.opacity !== undefined) expect(m.opacity, 'tray plane').toBe(1)
          })
        }
        expect(caughtAt, `${from} → ${to} caught`).not.toBeNull()
        expect(opaqueUntil).toBeGreaterThanOrEqual(LOOK_S - 1 / 30)
        expect(opaqueUntil).toBeLessThan(LOOK_S + 1 / 30)
        expect(planes.phase).toBe(null)
        expect(flier.visible).toBe(false)
        expect(planes.fade, 'reset for the next one').toBe(1)
        const r = (rigs[`agent_${to}`] as unknown as { reactions: { kind: string; t: number }[] }).reactions
        expect(r[0]?.kind, `${from} → ${to}`).toBe('surprise')
        expect(Math.abs(r[0].t - caughtAt!)).toBeLessThan(1 / 30)
        // it faded out in the hand: nearly transparent by its last frame there, LOOK_S + FADE_S after the catch
        expect(minFade, `${from} → ${to}`).toBeLessThan(0.1)
        expect(Math.abs(lastHeld - (LOOK_S + FADE_S)), `${from} → ${to}: in the hand until LOOK_S + FADE_S`).toBeLessThan(1 / 30)
      }
  })

  it('a receiver that is not in: the plane lies on its desk without moving, then fades out where it lies', () => {
    const { planes } = world()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, n !== 1)]))
    planes.receive({ kind: 'handoff', from: 'agent_0', to: 'agent_1' } as never)
    const flier = planes['plane']!.node
    let at: Vector3 | null = null
    let faded = false
    for (let t = 0; t < 10; t += 1 / 60) {
      planes.update(t, graph, rigs, false)
      if (planes.phase === 'landed') {
        at ??= flier.position.clone()
        expect(flier.position.distanceTo(at)).toBeLessThan(1e-9)
        if (planes.fade < 1) faded = true
      }
    }
    expect(at).not.toBeNull()
    expect(faded).toBe(true)
    expect(flier.visible).toBe(false)
  })
})

describe('looking before throwing, turning to catch (#224)', () => {
  const run = (from: number, to: number, step: (t: number, rigs: Record<string, AgentRig>, planes: PaperPlanes) => void) => {
    const { planes } = world()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, true)]))
    planes.receive({ kind: 'handoff', from: `agent_${from}`, to: `agent_${to}` } as never)
    for (let t = 0; t < 12; t += 1 / 60) {
      planes.update(t, graph, rigs, false)
      step(t, rigs, planes)
    }
    return { planes, rigs }
  }

  it('the plane is released only after the aim hold: in the hand until 1.0 s, flying right after', () => {
    let release = -1
    let inHandUntil = 0
    let plan: { holdEnd: number; release: number } | undefined
    run(0, 3, (t, rigs, planes) => {
      plan ??= rigs.agent_0.gesture?.plan?.times
      if (planes.phase === 'fold') inHandUntil = t
      if (planes.phase === 'fly' && release < 0) release = t
    })
    expect(plan!.holdEnd).toBeCloseTo(0.85, 6)
    // the aim hold (0.55 - 0.85) is over before the plane leaves the hand
    expect(inHandUntil).toBeGreaterThan(0.85)
    expect(release).toBeGreaterThanOrEqual(0.85)
    expect(release).toBeLessThanOrEqual(1.0 + 1 / 30)
    expect(inHandUntil).toBeLessThan(release)
  })

  it('the flight ends at the receiver catching hand, wherever it has reached to', () => {
    let worst = 0
    let seen = 0
    run(0, 3, (_t, rigs, planes) => {
      const r = rigs.agent_3 as unknown as { hand: Vector3 }
      // the hand reaches sideways 0.3 m once the catch begins (a back-to-back catch)
      if (rigs.agent_3.gesture?.kind === 'catch') r.hand.x = graph.spots.work_3.x + 0.3
      if (planes.phase === 'held') {
        const at = rigs.agent_3.pinchPoint('r', new Vector3())
        worst = Math.max(worst, planes['plane']!.node.position.distanceTo(at))
        seen++
      }
    })
    expect(seen).toBeGreaterThan(10)
    expect(worst).toBeLessThan(0.1)
  })

  it('the receiver gets a catch gesture covering the flight, the hold and the 0.6 s turn back; the sender follows the plane', () => {
    let catching: NonNullable<AgentRig['gesture']> | undefined
    let throwing: NonNullable<AgentRig['gesture']> | undefined
    let followed = false
    const { planes } = run(0, 3, (_t, rigs, p) => {
      catching ??= rigs.agent_3.gesture ?? undefined
      throwing ??= rigs.agent_0.gesture ?? undefined
      if (p.phase === 'fly' && rigs.agent_0.gesture?.at === p['plane']!.node.position) followed = true
    })
    expect(catching!.kind).toBe('catch')
    expect(catching!.until - catching!.t0!).toBeCloseTo(catching!.plan!.times.end, 6)
    expect(catching!.plan!.times.end).toBeGreaterThan(1.8)
    expect(catching!.at).toBe(planes['plane']!.node.position)
    expect(throwing!.kind).toBe('throw')
    expect(followed).toBe(true)
  })

  it('reduced motion: both heads turn (no body turn, no hold), the plane is on the desk', () => {
    const { planes } = world()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, true)]))
    planes.receive({ kind: 'handoff', from: 'agent_0', to: 'agent_3' } as never)
    planes.update(0, graph, rigs, true)
    for (const id of ['agent_0', 'agent_3']) {
      const g = rigs[id].gesture!
      expect(g.plan!.body, id).toBe(0)
      expect(g.plan!.opts.reduced, id).toBe(true)
    }
  })
})
