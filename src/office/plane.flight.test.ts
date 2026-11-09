import { BoxGeometry, Matrix4, Mesh, Object3D, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { NavGraph } from './nav'
import { GRAPH } from './navSpots.fixture'
import { PaperPlanes } from './plane'
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
  return {
    id: `agent_${seat}`,
    visible,
    gesture: null,
    parts: { hands: { r: { grip, node: grip } } },
    pinchPoint: (_side: string, out = new Vector3()) => out.copy(hand),
    fingerDir: (_side: string, out = new Vector3()) => out.copy(fwd),
  } as unknown as AgentRig
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

  it('reduced motion: on the receiver desk at once, then gone', () => {
    const { tray, planes } = world()
    const trayAt = tray.position.clone()
    const rigs = Object.fromEntries(SEATS.map((n) => [`agent_${n}`, rig(n, true)]))
    planes.receive({ kind: 'handoff', from: 'agent_0', to: 'agent_3' } as never)
    planes.update(0, graph, rigs, true)
    const flier = planes['plane']!.node
    expect(flat(flier.position, PaperPlanes.deskPoint(graph, 'agent_3', new Vector3()))).toBeLessThan(0.01)
    for (let t = 0; t < 4; t += 0.1) planes.update(t, graph, rigs, true)
    expect(flier.visible).toBe(false)
    expect(tray.position.distanceTo(trayAt)).toBe(0)
  })
})
