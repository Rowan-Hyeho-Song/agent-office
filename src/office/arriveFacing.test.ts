/// <reference types="node" />
// Facing on arrival (#333): an agent that walks to a spot turns to the spot's designed facing (nav ry) as it stops, and stays square to it. The
// designer measured agents that had walked from their desks to a forced game standing 60-80° off for the whole game: the forced goal kept a
// departure the director had set for another spot, the frame loop re-timed it every frame (Agents.tsx forgot it, judged on the director's spot),
// and the planner answered a held departure from where the agent already stood with a stand-then-step plan that is not labelled as arrived, so the
// rig kept the heading it walked in with. Headless on the baked model with the real Director + TrafficPlanner (errandWorld.fixture's Walk), from
// the desks where the agents were working and from a few other places, with the departure held back as the play goals hold it and with one that
// slides every frame (the old Agents.tsx shape). Numbers go to FIT_LOG when set.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stubCanvas } from './glbLoad'
import { IDS, Walk, world } from './errandWorld.fixture'
import { GRAPH } from './navSpots.fixture'
import type { Goal } from './director'

stubCanvas()
const LOG = process.env.FIT_LOG
const DEG = 180 / Math.PI
const DT = 0.02
/** turned to the spot's facing within this long after it stops (s) */
const TURN_S = 0.4
/** with a departure re-timed every frame (the old Agents.tsx shape: no longer made, kept as the planner's own guard) the last centimetre in is
 * replanned every frame as stand-then-step, and the label comes up to 0.4 s late: it must still square up, never stand across the spot */
const SLIDE_TURN_S = 1.0
/** and then within this much of it (deg) */
const MAX_DEG = 5
/** for this long (s) */
const HOLD_S = 2
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

type Slide = 'held' | 'sliding'

/**
 * Everyone works at their desk; then `agent` (and, for a game, the next agent at the other end) is sent to `spot` with `pose`, starting from `from`
 * (its desk, or a spot it is first sent to and stands at). The others stay at their desks. Returns the worst angle to the spot's ry over HOLD_S
 * from TURN_S (SLIDE_TURN_S) after the agent stops on the spot, and how long it took to come within MAX_DEG.
 */
async function arrive(agent: string, spot: string, pose: Goal['pose'], from: string | null, slide: Slide) {
  const turnS = slide === 'held' ? TURN_S : SLIDE_TURN_S
  const w = await world()
  const walk = new Walk(w)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'edit', since: 0 }
  const pair = pose === 'pingpong' || pose === 'boardgame'
  const other = pair ? IDS[(IDS.indexOf(agent) + 1) % IDS.length] : null
  const otherSpot = pair ? { pingpong_a: 'pingpong_b', pingpong_b: 'pingpong_a', game_a: 'game_b', game_b: 'game_a' }[spot]! : null
  let stage: 'from' | 'go' = from ? 'from' : 'go'
  let held: number | undefined
  const orig = walk.director.goals.bind(walk.director)
  walk.director.goals = ((...a: Parameters<typeof orig>) => {
    const g = orig(...a)
    const now = a[0]
    for (const id of IDS) g[id] = { ...g[id], spot: `work_${IDS.indexOf(id)}`, pose: 'type' }
    if (stage === 'from') g[agent] = { ...g[agent], spot: from!, pose: 'idle' }
    else {
      // the goals' departure: held at the time it was first given, 0.5 s on (the director's putAway holds a play's end so), or re-timed every frame
      held ??= now + 500
      const depart = slide === 'sliding' ? now : held
      g[agent] = { ...g[agent], spot, pose, depart }
      if (other) g[other] = { ...g[other], spot: otherSpot!, pose, depart }
    }
    return g
  }) as typeof orig
  for (let k = 0; k < 1 / DT; k++) walk.step(DT)
  const rig = w.rigs[agent]
  if (from) {
    for (let k = 0; k < 40 / DT && rig.arrived !== from; k++) walk.step(DT)
    expect(rig.arrived, `${agent} stands at ${from} first`).toBe(from)
    stage = 'go'
  }
  const s = GRAPH.spots[spot]
  let stopT = -1
  let turnedT = -1
  let worst = 0
  for (let k = 0; k < 60 / DT; k++) {
    walk.step(DT)
    const tk = rig.track!
    if (stopT < 0) {
      if (!tk.moving && Math.hypot(tk.x - s.x, tk.z - s.z) < 0.02) stopT = walk.t
      continue
    }
    const off = Math.abs(wrap(rig.parts.root.rotation.y - s.ry)) * DEG
    if (turnedT < 0 && off <= MAX_DEG) turnedT = walk.t - stopT
    if (walk.t - stopT >= turnS) worst = Math.max(worst, off)
    if (walk.t - stopT >= turnS + HOLD_S) break
  }
  const out = { stopT, turnedS: turnedT, turnS, worst, arrived: rig.arrived }
  if (LOG) appendFileSync(LOG, `arrive ${agent} ${from ?? 'desk'} -> ${spot} (${pose}, ${slide}): stopped ${stopT.toFixed(2)} s, within ${MAX_DEG}° after ${turnedT.toFixed(2)} s, worst ${worst.toFixed(2)}° over ${HOLD_S} s, arrived ${out.arrived}\n`)
  return out
}

function check(r: Awaited<ReturnType<typeof arrive>>, spot: string) {
  expect(r.stopT, 'stopped on the spot').toBeGreaterThan(0)
  expect(r.arrived, 'labelled as arrived').toBe(spot)
  expect(r.turnedS, `turned to within ${MAX_DEG}° (s)`).toBeGreaterThanOrEqual(0)
  expect(r.turnedS, `turned to within ${MAX_DEG}° (s)`).toBeLessThanOrEqual(r.turnS)
  expect(r.worst, `facing over ${HOLD_S} s (deg)`).toBeLessThanOrEqual(MAX_DEG)
}

const PLAY: [string, Goal['pose']][] = [
  ['game_a', 'boardgame'],
  ['game_b', 'boardgame'],
  ['pingpong_a', 'pingpong'],
  ['pingpong_b', 'pingpong'],
]

describe('facing on arrival', () => {
  for (const slide of ['held', 'sliding'] as const)
    for (const agent of IDS)
      for (const [spot, pose] of PLAY)
        it(`${agent}, desk -> ${spot} (${slide} departure): square to the spot within ${slide === 'held' ? TURN_S : SLIDE_TURN_S} s and for ${HOLD_S} s`, async () => {
          check(await arrive(agent, spot, pose, null, slide), spot)
        }, 120_000)

  // other ways in: from the coffee bar, the shelf and the whiteboard (echo and mesh, the two the designer saw)
  for (const agent of ['agent_4', 'agent_1'])
    for (const from of ['coffee', 'shelf', 'whiteboard'])
      for (const [spot, pose] of PLAY)
        it(`${agent}, ${from} -> ${spot}: square to the spot`, async () => {
          check(await arrive(agent, spot, pose, from, 'held'), spot)
        }, 120_000)

  // the other spots an agent turns to on arrival: its desk, the whiteboard, the coffee bar, the shelf, a sofa seat
  for (const agent of IDS)
    for (const spot of ['whiteboard', 'coffee', 'shelf', 'sofa_1'])
      it(`${agent}, desk -> ${spot} (idle): square to the spot`, async () => {
        check(await arrive(agent, spot, 'idle', null, 'held'), spot)
      }, 120_000)
  for (const agent of IDS)
    it(`${agent}, whiteboard -> its desk: square to the desk`, async () => {
      check(await arrive(agent, `work_${IDS.indexOf(agent)}`, 'type', 'whiteboard', 'held'), `work_${IDS.indexOf(agent)}`)
    }, 120_000)
})
