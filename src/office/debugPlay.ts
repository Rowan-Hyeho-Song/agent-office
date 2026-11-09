// ?debug=1 tools for close-ups (#184): put an agent into a play / prop scene right now, or loop the three grip stages in place.
//   window.__office.play.force(agent, kind, plant?, reduced?)   kind: water | books | coffee | pingpong | boardgame (a pair game takes the next agent too);
//                                             water sends the agent for the can (the whole errand, waterRun.ts); plant: plant_corner | plant_sofa | plant_desk
//   window.__office.play.clear()
//   window.__office.play.stone('current' | 'alt')   the go-grip variant (grip.ts STONE_VARIANT_DEFAULT): call before the stone game starts
//   window.__office.grip.demo(agent, prop)    prop: marker | pen | stamp | mouse | cup | paddle | can | book: walks the agent to it and
//                                             repeats reach, pre-grip, close, hold, put back, after, every 6 s
//   window.__office.grip.stop()
//   window.__office.hand.pose(agent, side, poseId | null)   force one of the 16 named poses of handPose.ts (rest, spread, wrap, fist, ok, tripod, key, point,
//                                             press, type, support, basket, thumbsUp, sweep, + frame, stamp) on one hand; null lets go. agent: 0 or 'agent_0'
// The pair games run on the office clock (a forced one is already 5 s into its first game). Set the clock for the schedule with
// __office.kst.set('HH:MM'); clock.set only changes the wall clock, the play schedule follows kst.

import type { Goal } from './director'
import { standSlot } from './director'
import { ALL_POSES, type AnyPoseId } from './handPose'
import { setStoneVariant, type StoneVariant } from './grip'
import { CAN_HOME, WATER_PLANTS, canStand } from './water'
import { hash } from './play'
import { SETTLE_MS, type PlaySession } from '../play/session'
import { officeNow, type OfficeWorld } from './world'

export interface GripDemo {
  agent: string
  /** the prop's kind in grip.ts, the object's name, the hand, and where the agent stands */
  kind: string
  obj: string
  side: 'l' | 'r'
  goal: Partial<Goal>
}

const BOOK = { stand: { x: 0.07, z: 2.0 }, face: { x: 0.065, z: 2.66 } }
// the grip demo takes the can where it rests: from its own stand
const waterGoal = (): Partial<Goal> => ({ spot: 'water_can', face: CAN_HOME, ...standSlot({ stand: canStand(), face: CAN_HOME }) })

const DEMOS: Record<string, (seat: number) => Omit<GripDemo, 'agent'>> = {
  marker: () => ({ kind: 'marker', obj: 'prop_marker_0', side: 'r', goal: { spot: 'whiteboard' } }),
  pen: () => ({ kind: 'tablet_pen', obj: 'prop_tablet_pen', side: 'r', goal: { spot: 'work_2' } }),
  stamp: () => ({ kind: 'stamp', obj: 'prop_stamp', side: 'r', goal: { spot: 'work_0' } }),
  mouse: (seat) => ({ kind: 'mouse', obj: 'desk_' + seat + '_mouse', side: 'r', goal: { spot: 'work_' + seat } }),
  cup: () => ({ kind: 'cup', obj: 'prop_cup_0', side: 'r', goal: { spot: 'coffee' } }),
  paddle: () => ({ kind: 'paddle', obj: 'prop_paddle_a', side: 'r', goal: { spot: 'pingpong_a' } }),
  can: () => ({ kind: 'watering_can', obj: 'prop_watering_can', side: 'r', goal: waterGoal() }),
  book: () => ({ kind: 'book', obj: 'prop_book', side: 'l', goal: { spot: 'shelf', face: BOOK.face, ...standSlot(BOOK) } }),
}

export function makePlayTools(world: OfficeWorld) {
  const play = {
    force(agent: string, kind: string, plant?: string, reduced = false) {
      const ids = Object.keys(world.rigs)
      world.forceGoal = world.forceGoal ?? {}
      // everyone else goes to their own desk, so nobody else is sent to the same spots by the schedule
      for (const id of ids) if (id !== agent && !world.forceGoal[id]) world.forceGoal[id] = { spot: 'work_' + Number(id.split('_')[1]), pose: 'idle' }
      if (kind === 'pingpong' || kind === 'boardgame') {
        const other = ids[(ids.indexOf(agent) + 1) % ids.length]
        const spots = kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
        const players: [string, string] = [agent, other]
        const s: PlaySession = { kind, spot: spots[0], players, seed: hash('debug|' + kind + '|' + agent + '|' + other), startMs: Date.now() + world.timeOffsetMs - SETTLE_MS - 5000 }
        world.forcedSessions = [s]
        players.forEach((id, i) => (world.forceGoal![id] = { spot: spots[i], pose: kind }))
        return
      }
      if (kind === 'water') {
        world.director.forceWater(agent, WATER_PLANTS.find((p) => p.name === plant)?.name ?? WATER_PLANTS[0].name, officeNow(world), reduced)
        return
      }
      const goals: Record<string, Partial<Goal>> = {
        coffee: { spot: 'coffee', pose: 'coffee' },
        books: { spot: 'shelf', pose: 'books', face: BOOK.face, ...standSlot(BOOK) },
      }
      if (goals[kind]) world.forceGoal[agent] = goals[kind]
    },
    stone(variant: StoneVariant) {
      setStoneVariant(variant)
    },
    clear() {
      world.forceGoal = null
      world.forcedSessions = []
      world.gripDemo = null
      world.director.clearWater()
    },
  }
  const grip = {
    demo(agent: string, prop: string) {
      const d = DEMOS[prop]
      if (!d) return
      const demo: GripDemo = { agent, ...d(Number(agent.split('_')[1])) }
      world.gripDemo = demo
      world.forceGoal = { ...(world.forceGoal ?? {}), [agent]: { ...demo.goal, pose: 'idle' } }
      // the others go to their desks: nobody else holds the prop (a running ping-pong game would have a paddle in hand), and the schedule's pairs fall apart
      world.forcedSessions = []
      for (const id of Object.keys(world.rigs)) if (id !== agent) world.forceGoal[id] = { spot: 'work_' + Number(id.split('_')[1]), pose: 'idle' }
    },
    stop() {
      world.gripDemo = null
    },
  }
  const hand = {
    pose(agent: number | string, side: 'l' | 'r', pose: AnyPoseId | null) {
      if (pose !== null && !(pose in ALL_POSES)) throw new Error('unknown pose ' + pose + ', one of ' + Object.keys(ALL_POSES).join(', '))
      const rig = world.rigs[typeof agent === 'number' ? 'agent_' + agent : agent]
      rig?.forcePose(side, pose)
    },
  }
  return { play, grip, hand }
}
