/// <reference types="node" />
// A headless office for the prop tests (#184, #228): the baked model, the four rigs, PropBank + PlayStage, and (for errands that walk)
// the Director + TrafficPlanner driven the way Agents.tsx drives them. `Guard` watches every prop every frame and counts the ways a prop
// can cheat: away from home with no hand on it, a jump when a hand takes it or lets it go, and a hand holding something its body cannot reach.
import { expect } from 'vitest'
import { Vector3, type Object3D } from 'three'
import { Director, requestOf, type Goal } from './director'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { loadOffice } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import type { StatusMap } from './status'
import type { WaterStage } from './waterRun'
import { TrafficPlanner } from './traffic'
import { PATH_BLOCKERS, REACH } from './water'

export { REACH }

// the faces draw on a canvas every frame (rig.update): a 2D context that accepts every call and draws nothing (glbLoad.stubCanvas only knows the rig's build)
const g = globalThis as { document?: unknown }
if (!g.document) {
  const ctx: object = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true })
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
}

export const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

export async function world() {
  const { scene, nodes } = await loadOffice()
  const props = new PropBank(scene, nodes)
  const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
  const stage = new PlayStage(scene, nodes, props)
  return { scene, nodes, props, rigs, stage }
}
export type World = Awaited<ReturnType<typeof world>>

/** the prop nodes that rest on the floor / a table (not the planner's pen on its head) and where each rests */
export const loosePropNodes = (w: World) => Object.values(w.nodes).filter((n) => n.userData.prop && !n.userData.home_on)

/** a prop's "grip point" for reach: its grip empty of the holder's side, else its own origin */
const gripPoint = (w: World, node: Object3D, side: 'l' | 'r') => (w.scene.getObjectByName(`${node.name}_grip_${side}`) ?? node).getWorldPosition(new Vector3())


/** the most a prop may move in the frame a hand takes it or lets it go (m) */
export const JUMP = 0.005
/**
 * Props the schedule hands out from further than REACH. The marker's old entry went with #195 (the poster stands at nav_board_tray, within 0.51 m of
 * the markers). NEW with #195: the tablet pen rests in the pen cup of HUE's desk (desk_2), 0.78 m from the seat spot work_2 (0.57 m across the desk,
 * 0.53 m along it; the new #187 kit moved the cup), 3 cm past the 0.75 m reach. A model follow-up (cup or seat); the entry must go the day it is within REACH.
 */
export const KNOWN_FAR: Record<string, number> = { tablet_pen: 0.8 }
/**
 * The paddle is swung for a wide ball: the rally engine lets it go as far sideways as the table is wide plus 0.3 m (pingpong.ts, playStage.pingpong clamps z
 * to W/2 + 0.3) with the body standing still, so its grip point goes up to 0.81 m from the body in the walking stretch. Still an arm swinging, not a hand flying.
 */
export const SWING: Record<string, number> = { paddle: 0.9 }
export const reachOf = (kind: string) => KNOWN_FAR[kind] ?? SWING[kind] ?? REACH
/** the checks every prop gets in every scene */
export function expectClean(name: string, s: GuardStats, kind: string, grasps = 1) {
  expect(s.loose, name + ': frames with a loose prop away from where it rests').toBe(0)
  expect(s.grasps, name + ': taken').toBeGreaterThanOrEqual(grasps)
  expect(s.graspJump, name + ': no jump when the hand takes it').toBeLessThanOrEqual(JUMP)
  // a placed go stone stays on the board as the board's own instance and its proxy goes back to the bowl in the same frame (playStage.omok)
  if (kind !== 'piece') expect(s.releaseJump, name + ': no jump when the hand lets go').toBeLessThanOrEqual(JUMP)
  expect(s.graspReach, name + ': taken within reach of the body').toBeLessThanOrEqual(reachOf(kind))
  expect(s.releaseReach, name + ': put down within reach of the body').toBeLessThanOrEqual(reachOf(kind))
  // a listed exception must still be one: when the stand moves in, take the entry out
  if (kind in KNOWN_FAR && s.grasps > 0) expect(s.graspReach, name + ': still out of reach, so still listed').toBeGreaterThan(REACH)
  expect(s.heldReach, name + ': within reach of the body every frame it is held').toBeLessThanOrEqual(reachOf(kind))
}

export interface GuardStats {
  frames: number
  heldFrames: number
  /** frames in which a prop that no hand held was more than 1 cm from where it rests */
  loose: number
  looseWorst: number
  grasps: number
  releases: number
  /** the biggest move of a prop in the frame a hand took it / let it go (m) */
  graspJump: number
  releaseJump: number
  /** the biggest distance (m, horizontal) between a holder's body and the prop's grip point: at the grasp, at the release, any frame it was held */
  graspReach: number
  releaseReach: number
  heldReach: number
  /** per prop name: how many times it was grasped */
  byProp: Record<string, number>
}

export class Guard {
  private home = new Map<string, Vector3>()
  private prev = new Map<string, Vector3>()
  /** how far each prop moved in the frame before, and the first frame's move of a grasp waiting for its next frame (a jump is a move the motion around it does not explain) */
  private step = new Map<string, number>()
  private graspStep = new Map<string, number>()
  private heldBy = new Map<string, { rig: AgentRig; side: 'l' | 'r' } | null>()
  readonly stats: GuardStats = emptyStats()
  /** (prop, frame) samples for a log: set to record them */
  readonly log: { t: number; prop: string; holder: string | null; x: number; y: number; z: number; dist: number }[] = []
  constructor(private w: World, private skip: (n: Object3D) => boolean = () => false) {
    for (const n of loosePropNodes(w)) this.home.set(n.name, n.position.clone())
  }

  /** the same numbers per prop (by node name) */
  readonly per: Record<string, GuardStats> = {}

  /** call after props.update() and scene.updateMatrixWorld(true) */
  frame(t = 0, record = false) {
    const w = this.w
    this.stats.frames++
    for (const n of loosePropNodes(w)) {
      if (this.skip(n)) continue
      const p = (this.per[n.name] ??= emptyStats())
      const both = [this.stats, p]
      const holder = Object.values(w.rigs).find((r) => r.want?.attached && (r.want.prefer === n.name || (r.want.kind === n.userData.prop && !r.want.prefer))) ?? null
      const side = holder?.want?.side ?? 'r'
      const now = n.position.clone()
      const before = this.prev.get(n.name)
      const was = this.heldBy.get(n.name) ?? null
      const moved = before ? now.distanceTo(before) : 0
      // the move of the frame a hand took it, minus the move of the frame after: a prop already travelling (the stone lifted off its pile) is not a jump,
      // one that is put in the hand and then stays there is
      const gs = this.graspStep.get(n.name)
      if (gs !== undefined) {
        for (const s of both) s.graspJump = Math.max(s.graspJump, gs - moved)
        this.graspStep.delete(n.name)
      }
      if (holder) {
        const g = gripPoint(w, n, side)
        const root = holder.parts.root.position
        const reach = Math.hypot(g.x - root.x, g.z - root.z)
        for (const s of both) {
          s.heldFrames++
          s.heldReach = Math.max(s.heldReach, reach)
          if (!was) {
            s.grasps++
            s.byProp[n.name] = (s.byProp[n.name] ?? 0) + 1
            s.graspReach = Math.max(s.graspReach, reach)
          }
        }
        if (!was) this.graspStep.set(n.name, moved)
      } else {
        const d = now.distanceTo(this.home.get(n.name)!)
        for (const s of both) {
          s.looseWorst = Math.max(s.looseWorst, d)
          if (d > 0.01) s.loose++
          if (was) {
            s.releases++
            const g = gripPoint(w, n, was.side)
            const root = was.rig.parts.root.position
            s.releaseReach = Math.max(s.releaseReach, Math.hypot(g.x - root.x, g.z - root.z))
            // the move of the frame it was let go, minus the move of the frame before it
            s.releaseJump = Math.max(s.releaseJump, moved - (this.step.get(n.name) ?? 0))
          }
        }
      }
      if (record && (holder || was)) {
        const root = (holder ?? was!.rig).parts.root.position
        const g = gripPoint(w, n, side)
        this.log.push({ t, prop: n.name, holder: holder ? holder.id : null, x: g.x, y: g.y, z: g.z, dist: Math.hypot(g.x - root.x, g.z - root.z) })
      }
      this.prev.set(n.name, now)
      this.step.set(n.name, moved)
      this.heldBy.set(n.name, holder ? { rig: holder, side } : null)
    }
  }
}

const emptyStats = (): GuardStats => ({ frames: 0, heldFrames: 0, loose: 0, looseWorst: 0, grasps: 0, releases: 0, graspJump: 0, releaseJump: 0, graspReach: 0, releaseReach: 0, heldReach: 0, byProp: {} })

/** expectClean for every prop a guard saw taken (its kind from the node), and nothing loose for the ones it did not */
export function expectCleanAll(name: string, w: World, guard: Guard) {
  for (const [prop, s] of Object.entries(guard.per)) {
    const kind = w.nodes[prop].userData.prop as string
    expectClean(name + ' ' + prop, s, kind, 0)
  }
}

/** the planner's grid is the baked footprint, as the day simulation uses */
export const office = () => new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)

/**
 * The office as Agents.tsx runs it: each frame the Director's goals go to the planner, the planner's samples move the rigs, the stage
 * draws the hands, the props follow. `status` and `minute` are the caller's; `t` is the office clock in s from `t0` ms.
 */
export class Walk {
  readonly director = new Director(IDS)
  readonly planner = office()
  /** everyone idle (resting: the schedule plays) unless the caller says otherwise */
  status: StatusMap = Object.fromEntries(IDS.map((id) => [id, { state: 'idle' as const, since: 0 }]))
  goals: Record<string, Goal> = {}
  private first = true
  private departs = new Map<string, number>()
  t = 0
  constructor(readonly w: World, readonly t0 = Date.UTC(2026, 10, 9, 5, 0, 0), readonly reduced = false) {}

  step(dt: number, guard?: Guard) {
    const w = this.w
    const now = this.t0 + this.t * 1000
    this.goals = this.director.goals(now, Math.floor(now / 60000), this.status, (a) => w.rigs[a].arrived, { reduced: this.reduced })
    // Agents.tsx forgets the departures no goal holds any more (and keeps the held ones, so their planner time does not drift)
    const held = new Set(Object.entries(this.goals).filter(([, g]) => g.depart !== undefined).map(([id, g]) => `${id}|${g.spot}|${g.depart}`))
    for (const k of [...this.departs.keys()]) if (!held.has(k)) this.departs.delete(k)
    for (const id of IDS) {
      const g = this.goals[id]
      const idx = IDS.indexOf(id)
      // a goal that sets off later (a play ending: the prop goes back first) is held to that time, as Agents.tsx does
      let notBefore: number | undefined
      if (g.depart !== undefined) {
        const key = `${id}|${g.spot}|${g.depart}`
        notBefore = this.departs.get(key) ?? this.t + Math.max(0, (g.depart - now) / 1000)
        this.departs.set(key, notBefore)
      }
      const req = requestOf(g, 1, notBefore)
      // everyone starts at their own desk (the schedule's first goal is then walked to), as the office does after a reload mid-play
      if (this.first) this.planner.place(id, { spot: `work_${idx}`, pace: 1 }, this.t, idx)
      this.planner.request(id, req, this.t, idx)
      w.rigs[id].traffic = true
      w.rigs[id].setGoal(g, GRAPH)
    }
    this.first = false
    this.planner.update(this.t)
    for (const id of IDS) {
      w.rigs[id].track = this.planner.sample(id, this.t)
      w.rigs[id].update(dt, this.t, GRAPH, w.rigs, this.reduced, this.status[id])
    }
    w.stage.update({ now, t: this.t, dt, reduced: this.reduced, replaying: false, rigs: w.rigs, goals: this.goals, status: this.status, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    guard?.frame(this.t, true)
    this.t += dt
  }
}

/**
 * One watering errand by `agent` for `plant`, from its desk, until the Director has nothing more to do with it and the hand has let go. The
 * others work at their desks (nobody sits on the sofa beside the monstera's stand, nobody else plays). The caller's guard watches every frame.
 */
export function runErrand(w: World, agent: string, plant: string, guard: Guard, opts: { dt?: number; reduced?: boolean; maxS?: number } = {}) {
  const dt = opts.dt ?? 0.02
  const walk = new Walk(w, undefined, opts.reduced ?? false)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  for (let k = 0; k < 10; k++) walk.step(dt, guard) // standing at the desks first
  walk.status[agent] = { state: 'idle', since: 0 }
  // a plant whose way in runs past a seat (water.ts PATH_BLOCKERS): the seat's owner is away (the schedule only sends the errand then)
  for (const spot of PATH_BLOCKERS[plant] ?? []) walk.status[`agent_${spot.split('_')[1]}`] = { state: 'idle', since: 0 }
  walk.director.forceWater(agent, plant, walk.t0 + walk.t * 1000, opts.reduced ?? false)
  const stages: WaterStage[] = []
  const at: Record<string, { t: number; x: number; z: number }> = {}
  const started = walk.t
  let ended = -1
  for (let k = 0; k < (opts.maxS ?? 120) / dt; k++) {
    walk.step(dt, guard)
    const g = walk.goals[agent]
    const st = g.water?.stage
    if (st && stages[stages.length - 1] !== st) {
      stages.push(st)
      const r = w.rigs[agent].parts.root.position
      at[st] = { t: walk.t - started, x: r.x, z: r.z }
    }
    if (!g.water && stages.length) {
      ended = walk.t - started
      break
    }
  }
  // back to the desk, the hand lets go and settles
  walk.status[agent] = { state: 'working', activity: 'test', since: 0 }
  for (let k = 0; k < 20 / dt; k++) {
    walk.step(dt, guard)
    if (w.rigs[agent].arrived === `work_${agent.split('_')[1]}` && k > 1 / dt) break
  }
  return { walk, stages, at, ended }
}
