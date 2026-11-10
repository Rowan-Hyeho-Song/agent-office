// ?debug=1 tools for close-ups (#184): put an agent into a play / prop scene right now, or loop the three grip stages in place.
//   window.__office.play.force(agent, kind, plant?, reduced?)   kind: water | books | coffee | pingpong | boardgame (a pair game takes the next agent too);
//                                             water sends the agent for the can (the whole errand, waterRun.ts); plant: plant_corner | plant_sofa | plant_desk
//                                             the lounge (#280): fridge | dispenser | record (put a record on, or lift the arm when the needle is down) | record-lift |
//                                             sofa (a seat: plant a pillow hug with seat 'sofa_0' | 'sofa_2') | lie (the east seat) | door (the door spot: lever, mat)
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
import type { HabitKind } from './waterFx'
import { hash } from './play'
import { isAct } from './lounge'
import { SETTLE_MS, type PlaySession } from '../play/session'
import { officeNow, type OfficeWorld } from './world'
import { onInput } from './inputEvents'
import type { Typist } from './typist'

export interface GripDemo {
  agent: string
  /** the prop's kind in grip.ts, the object's name, the hand, and where the agent stands */
  kind: string
  obj: string
  side: 'l' | 'r'
  goal: Partial<Goal>
}

const BOOK = { stand: { x: 2.81, z: 2.88 }, face: { x: 2.85, z: 2.55 } }
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

/**
 * ?debug=1 (#225): window.__office.typing
 *   force(agent, activity | null)   the agent works with this activity (edit, read, test, think, delegate ...) and the typist uses it; null lets go
 *   keys(agent, seconds = 3)        the keys the schedule has coming up for the agent: [{ t, code, hand, finger }]
 *   watch(true | false)             records the input bus; log() reads it, clear() empties it
 */
export function makeTypingTools(world: OfficeWorld, typist: Typist) {
  const id = (a: number | string) => (typeof a === 'number' ? 'agent_' + a : a)
  const rec: { t: number; type: string; agent: string; kind: string; key?: string; x: number; y: number; z: number }[] = []
  let off: (() => void) | null = null
  return {
    force(agent: number | string, activity: string | null) {
      const a = id(agent)
      if (activity === null) {
        delete typist.forced[a]
        return
      }
      typist.forced[a] = activity
      world.fake?.set(a, 'working', activity)
    },
    keys(agent: number | string, seconds = 3) {
      const a = id(agent)
      const t = world.rigs[a] ? typist.lastT(a) : 0
      return typist.upcoming(a, typist.forced[a], t, seconds, a !== 'agent_2')
    },
    /** hold the schedule at time t (null: let go): a still for close-ups. now(agent) is the schedule time, mouse(agent, s) the mouse acts coming */
    freeze(agent: number | string, t: number | null) {
      const a = id(agent)
      if (t === null) delete typist.frozen[a]
      else typist.frozen[a] = t
    },
    gestures(agent: number | string, seconds = 40) {
      const a = id(agent)
      return typist.upcomingGestures(a, typist.forced[a], typist.lastT(a), seconds)
    },
    now: (agent: number | string) => typist.lastT(id(agent)),
    mouse(agent: number | string, seconds = 8) {
      const a = id(agent)
      return typist.upcomingMouse(a, typist.forced[a], typist.lastT(a), seconds)
    },
    /** frame cost of the typing (ms): timing(true) starts, timing(false) returns { step, fade, applyDrive, frames }: totals per frame over the five agents */
    timing(on: boolean) {
      const acc = world as unknown as { __typingTiming?: { step: number; fade: number; drive: number; frames: number; undo: () => void } }
      if (on) {
        acc.__typingTiming?.undo()
        const s = { step: 0, fade: 0, drive: 0, frames: 0, undo: () => {} }
        const wrapFn = <T extends object>(o: T, k: keyof T, field: 'step' | 'fade' | 'drive') => {
          const orig = o[k] as unknown as (...a: unknown[]) => unknown
          ;(o as Record<string, unknown>)[k as string] = function (this: unknown, ...a: unknown[]) {
            const t0 = performance.now()
            const r = orig.apply(this, a)
            s[field] += performance.now() - t0
            if (field === 'step' && a[0] === world.rigs.agent_0) s.frames++
            return r
          }
          return () => void ((o as Record<string, unknown>)[k as string] = orig)
        }
        const undo = [wrapFn(typist, 'step', 'step'), wrapFn(typist, 'fade', 'fade'), ...Object.values(world.rigs).map((r) => wrapFn(r, 'applyDrive', 'drive'))]
        s.undo = () => undo.forEach((u) => u())
        acc.__typingTiming = s
        return
      }
      const s = acc.__typingTiming
      if (!s) return null
      s.undo()
      const f = Math.max(1, s.frames)
      return { frames: s.frames, stepMs: +(s.step / f).toFixed(3), fadeMs: +(s.fade / f).toFixed(3), applyDriveMs: +(s.drive / f).toFixed(3) }
    },
    watch(on = true) {
      off?.()
      off = on
        ? onInput((e) => {
            rec.push({ t: e.t, type: e.type, agent: e.agent, kind: e.kind, key: e.type === 'mouse' ? undefined : e.key, x: e.pos.x, y: e.pos.y, z: e.pos.z })
            if (rec.length > 2000) rec.shift()
          })
        : null
    },
    log: () => rec.slice(),
    clear: () => void (rec.length = 0),
    /** the keycap press values of a seat (the non-zero ones), to compare with the events */
    pressed: (seat: number) => {
      const kb = typist.keyboard(seat)
      return kb ? [...kb.press].map((p, i) => [i, +p.toFixed(2)] as const).filter(([, p]) => p > 0) : []
    },
  }
}

export function makePlayTools(world: OfficeWorld) {
  const play = {
    force(agent: string, kind: string, plant?: string, reduced = false, habit?: HabitKind | null) {
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
        world.director.forceWater(agent, WATER_PLANTS.find((p) => p.name === plant)?.name ?? WATER_PLANTS[0].name, officeNow(world), reduced, habit)
        return
      }
      // reading (readRun.ts): the book from the low table, read seated on sofa seat 0 (force(agent, 'books', '1'): seat 1), put back
      if (kind === 'books') {
        world.director.forceRead(agent, officeNow(world), plant === '1' ? 1 : 0)
        return
      }
      // the lounge acts (lounge.ts) run through the Director like the schedule's own; the sofa, the east seat and the door are plain goals
      if (isAct(kind)) {
        world.director.forceAct(agent, kind, officeNow(world))
        return
      }
      if (kind === 'record-lift') {
        world.director.forceAct(agent, 'record', officeNow(world), 'lift')
        return
      }
      const goals: Record<string, Partial<Goal>> = {
        sofa: { spot: 'sofa_0', pose: 'sofa' },
        sofa2: { spot: 'sofa_2', pose: 'sofa' },
        lie: { spot: 'sofa_3', pose: 'sofa' },
        door: { spot: 'door', pose: 'idle' },
        coffee: { spot: 'coffee', pose: 'coffee' },
        'books-stand': { spot: 'shelf', pose: 'books', face: BOOK.face, ...standSlot(BOOK) }, // the old standing pick, for the close-up
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
      world.director.clearActs()
      world.director.clearReads()
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
