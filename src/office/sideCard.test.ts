// #461: writing a wrap-up card beside the monitor (#229, x ±0.32) left the body facing front with both hands off to one side. The body now turns 20° toward
// the card and moves 4 cm toward it in 0.4 s, the hands staying on the card; the designer's check: the two hands' x centre within ±0.12 m of the
// body's (turned) centre, and no hand jump while it turns and turns back. On the baked model.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { makeChunk } from './typingSchedule'
import { WRITE_ASIDE, writePlace } from './wrapPose'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
/** the walking-hand tests' jump tolerance: a hand moves at most 6 cm a frame */
const JUMP = 0.06

async function desk(seat: number) {
  const { scene, nodes } = await loadOffice()
  const id = `agent_${seat}`
  const rig = new AgentRig(id, seat, buildRig(scene, nodes, seat), '#ffffff')
  const rigs = { [id]: rig }
  const spot = GRAPH.spots[`work_${seat}`]
  rig.x = spot.x
  rig.z = spot.z
  rig.heading = spot.ry
  const idle = { spot: spot.id, pose: 'idle', label: '' } as Goal
  rig.setGoal(idle, GRAPH)
  let t = 0
  for (let k = 0; k < 240; k++) rig.update(DT, (t += DT), GRAPH, rigs, false)
  return { rig, rigs, idle, spot, step: (reduced = false) => void rig.update(DT, (t += DT), GRAPH, rigs, reduced) }
}

const handsWorld = (rig: AgentRig) => (['l', 'r'] as const).map((s) => rig.parts.hands[s].node.getWorldPosition(new Vector3()))
const handsLocal = (rig: AgentRig) => {
  rig.parts.root.updateMatrixWorld(true)
  return handsWorld(rig).map((p) => rig.parts.root.worldToLocal(p))
}

describe('writing a card beside the monitor: the body turns to it (#461)', () => {
  for (const seat of [0, 2]) {
    it(`desk ${seat}: 24° and 4 cm toward the card in 0.4 s, both hands in front of the body, no jump, and back after`, async () => {
      const place = writePlace(GRAPH.spots, `work_${seat}`)
      expect(place, 'a desk with the card beside the monitor').not.toBeNull()
      const d = await desk(seat)
      const write = { spot: d.spot.id, pose: 'write', label: '', beat: { kind: 'line', u: 0.4, k: 0, v: 0 } } as unknown as Goal
      d.rig.setGoal(write, GRAPH)
      let prev = handsWorld(d.rig)
      let worstJump = 0
      const frames: { turn: number; mid: number }[] = []
      for (let k = 0; k < 90; k++) {
        d.step()
        const now = handsWorld(d.rig)
        worstJump = Math.max(worstJump, ...now.map((p, i) => p.distanceTo(prev[i])))
        prev = now
        const [l, r] = handsLocal(d.rig)
        frames.push({ turn: d.rig.parts.root.rotation.y - d.rig.heading, mid: (l.x + r.x) / 2 })
      }
      const settled = frames.at(-1)!
      expect(Math.abs(Math.abs(settled.turn) - (WRITE_ASIDE.turnDeg * Math.PI) / 180)).toBeLessThan(1e-3)
      expect(Math.sign(-settled.turn)).toBe(place!.side) // toward the card's side
      // turned in 0.4 s (24 frames), not at once
      expect(Math.abs(frames[11].turn)).toBeGreaterThan(0.05)
      expect(Math.abs(frames[11].turn)).toBeLessThan((WRITE_ASIDE.turnDeg * Math.PI) / 180 - 0.05)
      // the designer's check: the hands' x centre within ±0.12 m of the turned body's centre, from the moment it is turned
      for (const f of frames.slice(30)) expect(Math.abs(f.mid)).toBeLessThanOrEqual(0.12)
      // the body moved 4 cm toward the card (along the seat's right)
      const right = new Vector3(Math.cos(d.rig.heading), 0, -Math.sin(d.rig.heading))
      const off = new Vector3(d.rig.parts.root.position.x - d.rig.x, 0, d.rig.parts.root.position.z - d.rig.z).dot(right)
      expect(off * place!.side).toBeCloseTo(WRITE_ASIDE.shiftM, 2)
      // and back when the writing is over
      d.rig.setGoal(d.idle, GRAPH)
      for (let k = 0; k < 60; k++) {
        d.step()
        const now = handsWorld(d.rig)
        worstJump = Math.max(worstJump, ...now.map((p, i) => p.distanceTo(prev[i])))
        prev = now
      }
      expect(Math.abs(d.rig.parts.root.rotation.y - d.rig.heading)).toBeLessThan(1e-6)
      expect(worstJump).toBeLessThanOrEqual(JUMP)
    }, 60000)
  }

  it('reduced motion: the turn is there at once (the body still says where the card is)', async () => {
    const d = await desk(0)
    const write = { spot: d.spot.id, pose: 'write', label: '', beat: { kind: 'line', u: 0.4, k: 0, v: 0 } } as unknown as Goal
    d.rig.setGoal(write, GRAPH)
    d.step(true)
    expect(Math.abs(d.rig.parts.root.rotation.y - d.rig.heading)).toBeCloseTo((WRITE_ASIDE.turnDeg * Math.PI) / 180, 3)
  }, 60000)
})

describe('휴 drawing on the tablet: the left hand on the keyboard, a shortcut every 3–6 s (#461)', () => {
  it('only the left hand, only shortcuts (Ctrl + a letter), 3–6 s apart, no chin rest or head tap', () => {
    for (let i = 0; i < 20; i++) {
      const c = makeChunk('agent_2', i, 'tablet', { mouse: false })
      expect(c.keys.every((k) => k.hand === 'l' && k.shortcut)).toBe(true)
      expect(c.gestures).toEqual([])
      const ctrls = c.keys.filter((k) => k.code === 'ControlLeft').map((k) => k.t)
      expect(ctrls.length).toBeGreaterThanOrEqual(1)
      for (let j = 1; j < ctrls.length; j++) {
        expect(ctrls[j] - ctrls[j - 1]).toBeGreaterThanOrEqual(3)
        expect(ctrls[j] - ctrls[j - 1]).toBeLessThanOrEqual(7)
      }
    }
  })
})
