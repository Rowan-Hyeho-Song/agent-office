// ?debug=1 tools for close-ups (#184): put an agent into a play / prop scene right now, or loop the three grip stages in place.
//   window.__office.play.force(agent, kind)   kind: water | books | coffee | pingpong | boardgame (a pair game takes the next agent too)
//   window.__office.play.clear()
//   window.__office.grip.demo(agent, prop)    prop: marker | pen | stamp | mouse | cup | paddle | can | book: walks the agent to it and
//                                             repeats reach, pre-grip, close, hold, put back, after, every 6 s
//   window.__office.grip.stop()
// The pair games run on the office clock (a forced one is already 5 s into its first game). Set the clock for the schedule with
// __office.kst.set('HH:MM'); clock.set only changes the wall clock, the play schedule follows kst.

import type { Goal } from './director'
import { standSlot } from './director'
import { WATER_PLANTS, standOf } from './water'
import { hash } from './play'
import { SETTLE_MS, type PlaySession } from '../play/session'
import type { OfficeWorld } from './world'

export interface GripDemo {
  agent: string
  /** the prop's kind in grip.ts, the object's name, the hand, and where the agent stands */
  kind: string
  obj: string
  side: 'l' | 'r'
  goal: Partial<Goal>
}

const BOOK = { stand: { x: 0.07, z: 2.0 }, face: { x: 0.065, z: 2.66 } }
const waterGoal = (): Partial<Goal> => {
  const p = WATER_PLANTS[0]
  return { spot: 'hall_lounge', face: { x: p.x, z: p.z }, ...standSlot({ stand: standOf(p), face: { x: p.x, z: p.z } }) }
}

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
    force(agent: string, kind: string) {
      const ids = Object.keys(world.rigs)
      world.forceGoal = world.forceGoal ?? {}
      if (kind === 'pingpong' || kind === 'boardgame') {
        const other = ids[(ids.indexOf(agent) + 1) % ids.length]
        const spots = kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
        const players: [string, string] = [agent, other]
        const s: PlaySession = { kind, spot: spots[0], players, seed: hash('debug|' + kind + '|' + agent + '|' + other), startMs: Date.now() + world.timeOffsetMs - SETTLE_MS - 5000 }
        world.forcedSessions = [s]
        players.forEach((id, i) => (world.forceGoal![id] = { spot: spots[i], pose: kind }))
        return
      }
      const goals: Record<string, Partial<Goal>> = {
        coffee: { spot: 'coffee', pose: 'coffee' },
        water: { pose: 'water', ...waterGoal() },
        books: { spot: 'shelf', pose: 'books', face: BOOK.face, ...standSlot(BOOK) },
      }
      if (goals[kind]) world.forceGoal[agent] = goals[kind]
    },
    clear() {
      world.forceGoal = null
      world.forcedSessions = []
      world.gripDemo = null
    },
  }
  const grip = {
    demo(agent: string, prop: string) {
      const d = DEMOS[prop]
      if (!d) return
      const demo: GripDemo = { agent, ...d(Number(agent.split('_')[1])) }
      world.gripDemo = demo
      world.forceGoal = { ...(world.forceGoal ?? {}), [agent]: { ...demo.goal, pose: 'idle' } }
    },
    stop() {
      world.gripDemo = null
    },
  }
  return { play, grip }
}
