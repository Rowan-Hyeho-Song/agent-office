/// <reference types="node" />
// The hand tuck (lounge-props.md 3, rule 3; #280): walking within 0.7 m of a body resting on a sofa seat, the free hand on the sitter's side is pulled in toward
// its own body (a smaller lateral offset), blended in and out without a jump; the other hand is unchanged. The sofa seat is any nav spot of kind 'sofa'.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
/** the jump tolerance of the walking-hand tests (walkHands.test.ts: a blend moves a hand by at most 6 cm a frame) */
const JUMP = 0.06
const goal = (spot: string, pose: Goal['pose'] = 'idle'): Goal => ({ spot, pose, label: '' }) as Goal
const seat = Object.values(GRAPH.spots).filter((s) => s.kind === 'sofa').sort((a, b) => (a.id < b.id ? -1 : 1))[0]

const local = (rig: AgentRig, side: 'l' | 'r') => {
  rig.parts.root.updateMatrixWorld(true)
  return rig.parts.root.worldToLocal(rig.parts.hands[side].node.getWorldPosition(new Vector3()))
}

interface Frame {
  x: number
  z: number
  h: number
  l: Vector3
  r: Vector3
  tuck: { l: number; r: number }
  speed: number
}

/** the walker goes door -> work_3 (a long open walk); a sitter, if any, rests on a sofa seat spot and is moved beside the walker's path at `at` */
async function walk(sitter: { frame: number; lateral: number; seatSide: 1 | -1 } | null, track?: Frame[]) {
  const { scene, nodes } = await loadOffice()
  const walker = new AgentRig('agent_0', 0, buildRig(scene, nodes, 0), '#ffffff')
  const sit = new AgentRig('agent_1', 1, buildRig(scene, nodes, 1), '#ffffff')
  const rigs = { agent_0: walker, agent_1: sit }
  walker.setGoal(goal('door'), GRAPH)
  sit.setGoal(goal(seat.id), GRAPH)
  for (let k = 0; k < 120; k++) for (const r of [walker, sit]) r.update(DT, k * DT, GRAPH, rigs, false)
  walker.setGoal(goal('work_3'), GRAPH)
  const out: Frame[] = []
  let t = 120 * DT
  for (let k = 0; k < 60 * 30; k++) {
    t += DT
    if (sitter && track && k === sitter.frame) {
      // beside the walker's path at this frame: lateral m to the right (+1) / left (-1) of where it heads
      const f = track[k]
      sit.x = f.x + Math.cos(f.h) * sitter.lateral * sitter.seatSide
      sit.z = f.z - Math.sin(f.h) * sitter.lateral * sitter.seatSide
    }
    for (const r of [walker, sit]) r.update(DT, t, GRAPH, rigs, false)
    out.push({ x: walker.x, z: walker.z, h: walker.heading, l: local(walker, 'l'), r: local(walker, 'r'), tuck: { l: walker.tuckAmount('l'), r: walker.tuckAmount('r') }, speed: walker.speed })
    if (!(walker as unknown as { path: string[] }).path.length && k > 120) break
  }
  return out
}

describe('the hand tuck beside a sitter (#280)', () => {
  it('the near hand comes in toward the body while passing a sitter, the far hand stays, no jumps', async () => {
    const base = await walk(null)
    const mid = base.findIndex((f, k) => k > 60 && f.speed > 0.6) + 60
    for (const side of [1, -1] as const) {
      // sitter 0.45 m beside the path (within 0.5: full tuck), on the right (+1) or the left (-1)
      const run = await walk({ frame: mid, lateral: 0.45, seatSide: side }, base)
      const near = side === 1 ? 'r' : 'l'
      const far = side === 1 ? 'l' : 'r'
      let tucked = 0
      let maxStep = 0
      let farDiff = 0
      let nearIn = 0
      for (let k = mid; k < Math.min(run.length, base.length); k++) {
        // the same walk with and without the sitter (the walker's path does not depend on it): compare the hands in the body's frame
        const dn = Math.abs(run[k][near].x) - Math.abs(base[k][near].x)
        farDiff = Math.max(farDiff, Math.abs(run[k][far].x - base[k][far].x), Math.abs(run[k][far].z - base[k][far].z))
        if (run[k].tuck[near] > 0.95) {
          tucked++
          nearIn = Math.min(nearIn, dn)
        }
        if (k > mid) maxStep = Math.max(maxStep, Math.abs(run[k][near].x - base[k][near].x - (run[k - 1][near].x - base[k - 1][near].x)))
      }
      expect(tucked, 'fully tucked for a while').toBeGreaterThan(5)
      // the near hand's lateral offset is smaller by about TUCK.inM (5 cm)
      expect(nearIn).toBeLessThan(-0.03)
      expect(farDiff, 'the far hand is unchanged').toBeLessThan(1e-3)
      expect(maxStep, 'no jump per frame').toBeLessThan(JUMP)
      // and it blends: the largest per-frame change of the difference is far below the tolerance
      expect(maxStep).toBeLessThan(0.01)
    }
  }, 120_000)

  it('no sitter beside the path (far away): no tuck', async () => {
    const base = await walk(null)
    expect(Math.max(...base.map((f) => f.tuck.l + f.tuck.r))).toBe(0)
  }, 60_000)
})
