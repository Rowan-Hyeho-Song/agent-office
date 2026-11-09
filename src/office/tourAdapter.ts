// The ONE place that reads what each agent is doing for the tour (#207): the status map, the director's goals and the rigs.
// After #186 `director.shown` can replace the pose lookup here without touching tour.ts.

import type { AgentObs } from './tour'
import { tourEventOf } from './tourEvents'
import type { OfficeWorld } from './world'

/** the state a goal pose stands for when there is no live status (the timelapse acts the record out through goals only) */
const poseState = (pose: string | undefined) => (pose === 'type' ? 'working' : pose === 'post' ? 'wrapping' : 'idle')

const KIND_STATE = { work: 'working', wrap: 'wrapping', rest: 'idle', duty: 'idle', talk: 'idle', off: 'off' } as const

/** a test / build result counts as an event for this long after it (the tour's own 15 s window starts there) */
const RESULT_MS = 3000

export function observe(world: OfficeWorld, replaying: boolean): AgentObs[] {
  const status = world.source.getSnapshot()
  return world.director.agents.map((id) => {
    const rig = world.rigs[id]
    const goal = world.goals[id]
    const s = status[id]
    const shown = world.director.shown[id] // #217: what the body shows (wrapping a card, walking to the desk ...)
    const arrived = !!rig && !!goal && rig.arrived === goal.spot
    const pose = arrived ? goal.pose : undefined
    // a talk circle: the floor one, the board one (director) or the meeting runner's seats; the key drops the seat number
    const meet = pose === 'talk' && /^meet_/.test(goal.spot) ? goal.spot.replace(/_\d+$/, '') : undefined
    let event = tourEventOf(id)
    const r = s?.lastResult
    if (r && (!event || r.at > event.at)) event = { at: r.at, until: r.at + RESULT_MS }
    return {
      id,
      visible: !!rig && rig.visible,
      state: replaying ? poseState(goal?.pose) : shown ? KIND_STATE[shown.kind] : (s?.state ?? 'off'),
      pose: pose ?? (goal?.pose === 'doze' ? 'doze' : undefined),
      ...(meet ? { meet } : {}),
      ...(event ? { event } : {}),
    }
  })
}
