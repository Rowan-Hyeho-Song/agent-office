/// <reference types="node" />
// #559 (grips.md 버튼): a pressed button on the baked model. As the press starts the index fingertip is on the button's surface (within 1 mm: the press's
// 1 mm tap included) and nowhere goes further into it or the case around it; before and after, it is off it. The coffee machine's button (an agent
// at the coffee spot) and the water dispenser's tap (the lounge act). Numbers to FIT_LOG when set.
import { appendFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Walk, world } from './errandWorld.fixture'
import { contactNormal } from './gripTargets'
import { playAt } from './play'
import type { AgentRig } from './rig'

const LOG = process.env.FIT_LOG
const DT = 1 / 60

const tipWorld = (rig: AgentRig) => {
  const h = rig.parts.hands.r
  const j = h.fingers[0][2]!.node
  j.updateWorldMatrix(true, false)
  return h.tips[0]!.clone().applyMatrix4(j.matrixWorld)
}

/** the fingertip against a contact over a run: the nearest it comes, and the most it goes into the surface where it is over it (within 1.5 cm across) */
function measure(w: Awaited<ReturnType<typeof world>>, rig: AgentRig, contact: string, acc: { near: number; into: number; frames: number }) {
  const c = w.scene.getObjectByName(contact)
  if (!c) return
  const P = c.getWorldPosition(new Vector3())
  const n = contactNormal(w.scene, c)
  const d = tipWorld(rig).sub(P)
  const h = d.dot(n)
  const across = d.clone().addScaledVector(n, -h).length()
  acc.near = Math.min(acc.near, d.length())
  if (across < 0.015) {
    acc.into = Math.max(acc.into, -h)
    acc.frames++
  }
}

describe('a pressed button (#559)', () => {
  it('the coffee machine: the fingertip on its button as it presses (within 1 mm), into nothing', async () => {
    const w = await world()
    const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
    const goals = walk.director.goals.bind(walk.director)
    let coffee = false
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      // everyone else at their desks (the coffee spot free), agent_4 to the machine
      const desks = Object.fromEntries([0, 1, 2, 3].map((k) => [`agent_${k}`, { spot: `work_${k}`, pose: 'idle', label: '' }]))
      return coffee ? { ...g, ...desks, agent_4: { spot: 'coffee', pose: 'coffee', label: '' } } : g
    }) as typeof walk.director.goals
    for (let k = 0; k < 120; k++) walk.step(DT)
    coffee = true
    const acc = { near: Infinity, into: 0, frames: 0 }
    const rig = w.rigs.agent_4
    let arrived = -1
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT)
      if (rig.arrived === 'coffee' && arrived < 0) arrived = walk.t
      if (arrived >= 0) measure(w, rig, 'coffee_button_contact_index', acc)
      if (arrived >= 0 && walk.t - arrived > 2) break
    }
    if (LOG) appendFileSync(LOG, `coffee button: the fingertip ${(acc.near * 1000).toFixed(2)} mm from it at the nearest, ${(acc.into * 1000).toFixed(2)} mm into it at most\n`)
    expect(arrived, 'at the coffee machine').toBeGreaterThan(0)
    expect(acc.frames, 'the fingertip over the button').toBeGreaterThan(5)
    expect(acc.near, 'on its surface').toBeLessThanOrEqual(0.001)
    expect(acc.into, 'not into it (the tap: 1 mm)').toBeLessThanOrEqual(0.0011)
  }, 120_000)

  it('the water dispenser: the fingertip on its tap as it pours (within 1 mm), into nothing', async () => {
    const w = await world()
    // a moment the schedule gives agent_1 no errand of its own (a book or the can would keep the forced act waiting; the schedule moves with its
    // rules, #604 · #605 changed the board's stays)
    const IDS5 = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
    let start = Date.UTC(2026, 10, 9, 5, 0, 0)
    for (let m = 0; m < 600; m++) {
      const k = playAt(start, IDS5, new Set()).agent_1?.kind
      if (k === 'coffee' || k === 'sofa') break
      start += 60_000
    }
    const walk = new Walk(w, start)
    for (let k = 0; k < 60; k++) walk.step(DT)
    walk.director.forceAct('agent_1', 'dispenser', walk.t0 + walk.t * 1000, undefined, null)
    const acc = { near: Infinity, into: 0, frames: 0 }
    let seen = false
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT)
      const g = walk.goals.agent_1
      if (g.act) seen = true
      if (g.act && (g.act.u ?? -1) >= 0) measure(w, w.rigs.agent_1, 'water_tap_1_contact_index', acc)
      if (seen && !g.act) break
    }
    if (LOG) appendFileSync(LOG, `water tap: the fingertip ${(acc.near * 1000).toFixed(2)} mm from it at the nearest, ${(acc.into * 1000).toFixed(2)} mm into it at most\n`)
    expect(acc.frames, 'the fingertip over the tap').toBeGreaterThan(5)
    expect(acc.near, 'on its surface').toBeLessThanOrEqual(0.001)
    expect(acc.into, 'not into it (the tap: 1 mm)').toBeLessThanOrEqual(0.0011)
  }, 120_000)
})
