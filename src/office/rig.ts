// One agent's body on screen: its glb parts regrouped under the torso, gliding along the nav graph with a
// hover lift, a bob, a lean into turns, and small per-activity gestures. The Director says where to go; the
// rig gets there without teleporting and without leaving the graph's edges.

import { Color, Euler, Group, MathUtils, type Mesh, type MeshBasicMaterial, type Object3D } from 'three'
import type { Goal } from './director'
import { dist, routeFromEdge, shortestPath, type NavGraph } from './nav'

const SPEED = 0.75 // m/s cruising
const ACCEL = 1.4 // m/s²
const CORNER_SPEED = 0.32 // through a sharp turn
const TURN_RATE = 4.5 // rad/s
const LIFT = 0.06 // extra hover height while moving
/** seated spots: how far up the agent floats to rest over the cushion / stool top */
const SEAT: Record<string, number> = { sofa: 0.27, stool: 0.36 }
/** through the door: how far past the door spot an agent glides before it's out of the room */
const EXIT_DEPTH = 0.9
const EXIT = '__exit'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const damp = MathUtils.damp

export interface RigParts {
  torso: Object3D
  head: Object3D
  armL: Object3D
  armR: Object3D
  face: Mesh
}

/**
 * Regroup an agent's flat glb parts (each already at its pivot, see nodes.tsx rebase) into
 * rig → torso → head → face / tip, torso → arms / glow. Object3D.attach keeps every world pose.
 * Idempotent per scene (StrictMode renders twice).
 */
export function buildRig(scene: Object3D, nodes: Record<string, Object3D>, i: number): { group: Group; parts: RigParts } {
  const key = `rig_${i}`
  const cached = scene.userData[key] as { group: Group; parts: RigParts } | undefined
  if (cached) return cached
  const n = (s: string) => nodes[`agent_${i}${s}`]
  const torso = n('')
  scene.updateMatrixWorld(true)
  const group = new Group()
  group.name = key
  group.position.set(torso.position.x, 0, torso.position.z)
  group.rotation.y = new Euler().setFromQuaternion(torso.quaternion, 'YXZ').y
  scene.add(group)
  group.updateMatrixWorld(true)
  group.attach(torso)
  const head = n('_head')
  for (const s of ['_arm_l', '_arm_r', '_glow']) torso.attach(n(s))
  torso.attach(head)
  for (const s of ['_face', '_tip']) head.attach(n(s))
  const rig = { group, parts: { torso, head, armL: n('_arm_l'), armR: n('_arm_r'), face: n('_face') as Mesh } }
  scene.userData[key] = rig
  return rig
}

export class AgentRig {
  readonly id: string
  readonly group: Group
  private parts: RigParts
  private phase: number
  private faceBase: Color

  // where it is on the graph
  x = 0
  z = 0
  heading = 0
  /** the spot it rests on (null while gliding) */
  at: string | null = null
  private from: string | null = null
  private path: string[] = []
  private goal: Goal | null = null
  private placed = false
  /** the first frame after placing: take the seat height at once instead of rising into it */
  private snap = true

  // motion state
  private speed = 0
  private turnVel = 0
  private lift = 0
  private seat = 0
  private gestures = { armL: 0, armR: 0, pitch: 0, yaw: 0, roll: 0, glow: 1 }

  constructor(id: string, index: number, rig: { group: Group; parts: RigParts }) {
    this.id = id
    this.group = rig.group
    this.parts = rig.parts
    this.phase = index * 1.7
    const mat = rig.parts.face.material as MeshBasicMaterial
    this.faceBase = ((rig.parts.face.userData.baseColor as Color | undefined) ?? mat.color).clone()
  }

  /** the spot it has arrived at and stopped on, if any */
  get arrived(): string | null {
    return this.path.length === 0 && this.at !== EXIT ? this.at : null
  }

  get hidden() {
    return this.at === EXIT
  }

  /** the remaining route as floor points, for the debug overlay */
  route(g: NavGraph): { x: number; z: number }[] {
    return [{ x: this.x, z: this.z }, ...this.path.map((id) => this.point(g, id))]
  }

  private point(g: NavGraph, id: string): { x: number; z: number } {
    if (id !== EXIT) return g.spots[id]
    const d = g.spots.door
    return { x: d.x - Math.sin(d.ry) * EXIT_DEPTH, z: d.z - Math.cos(d.ry) * EXIT_DEPTH }
  }

  private plan(g: NavGraph) {
    const goal = this.goal!
    const target = goal.spot
    let route: string[] | null
    if (this.at === EXIT) route = [EXIT, ...(shortestPath(g, 'door', target) ?? ['door'])]
    else if (this.at) route = shortestPath(g, this.at, target)
    else route = routeFromEdge(g, this, this.from!, this.path[0], target) ?? [this.path[0]]
    if (!route) return
    if (this.at && route[0] === this.at) route = route.slice(1)
    if (goal.pose === 'leave') route.push(EXIT)
    this.path = route
    if (this.at && route.length) {
      this.from = this.at
      this.at = null
    }
  }

  setGoal(goal: Goal, g: NavGraph) {
    const prev = this.goal
    this.goal = goal
    if (!this.placed) {
      // first frame: start where the schedule says (every visitor sees the same scene from the start)
      this.placed = true
      const leave = goal.pose === 'leave'
      const p = this.point(g, leave ? EXIT : goal.spot)
      this.at = leave ? EXIT : goal.spot
      this.x = p.x
      this.z = p.z
      this.heading = this.restHeading(g)
      return
    }
    if (prev && prev.spot === goal.spot && (prev.pose === 'leave') === (goal.pose === 'leave')) return
    this.plan(g)
  }

  private restHeading(g: NavGraph, others?: Record<string, AgentRig>) {
    const goal = this.goal!
    if (goal.face) return Math.atan2(-(goal.face.x - this.x), -(goal.face.z - this.z))
    const look = goal.lookAt && others?.[goal.lookAt]
    if (look && goal.pose !== 'listen') return Math.atan2(-(look.x - this.x), -(look.z - this.z))
    return g.spots[goal.spot]?.ry ?? this.heading
  }

  update(dt: number, t: number, g: NavGraph, others: Record<string, AgentRig>, reduced: boolean) {
    if (!this.goal) return
    dt = Math.min(dt, 0.1)
    let wantHeading = this.heading
    let moving = false

    if (this.path.length) {
      moving = true
      // slow down for the final stop and for sharp corners
      const next = this.point(g, this.path[0])
      const dx = next.x - this.x
      const dz = next.z - this.z
      const d = Math.hypot(dx, dz)
      let remaining = d
      for (let k = 1; k < this.path.length; k++) remaining += dist(this.point(g, this.path[k - 1]), this.point(g, this.path[k]))
      let cap = Math.min(SPEED, Math.sqrt(2 * ACCEL * remaining) + 0.04)
      if (this.path.length > 1 && d < 0.35) {
        const after = this.point(g, this.path[1])
        const turn = Math.abs(wrap(Math.atan2(-(after.x - next.x), -(after.z - next.z)) - Math.atan2(-dx, -dz)))
        if (turn > 0.8) cap = Math.min(cap, CORNER_SPEED)
      }
      // a hover bot turns before it sets off when the new direction is behind it
      const headingTo = Math.atan2(-dx, -dz)
      if (d > 1e-4) wantHeading = headingTo
      const behind = Math.abs(wrap(headingTo - this.heading)) > 1.6 && this.speed < 0.1
      this.speed = behind ? 0 : Math.min(cap, this.speed + ACCEL * dt)
      let step = this.speed * dt
      while (step > 0 && this.path.length) {
        const p = this.point(g, this.path[0])
        const left = Math.hypot(p.x - this.x, p.z - this.z)
        if (left <= step) {
          this.x = p.x
          this.z = p.z
          step -= left
          this.from = this.path.shift()!
          if (!this.path.length) this.at = this.from
        } else {
          this.x += ((p.x - this.x) / left) * step
          this.z += ((p.z - this.z) / left) * step
          step = 0
        }
      }
    } else {
      this.speed = 0
      wantHeading = this.restHeading(g, others)
    }

    // heading with a capped turn rate; the turn rate drives the lean
    const diff = wrap(wantHeading - this.heading)
    const turn = MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt) * Math.min(1, dt * 12 + 0.4)
    this.heading = wrap(this.heading + turn)
    this.turnVel = damp(this.turnVel, turn / Math.max(dt, 1e-3), 8, dt)

    const g2 = this.goal
    const resting = !moving && this.arrived === g2.spot
    // seated on arrival, and kept up while sliding from one seat to the next (sofa_1 → sofa_2)
    const kindOf = (id: string | null | undefined) => (id ? g.spots[id]?.kind : undefined)
    const seatKind = resting
      ? kindOf(g2.spot)
      : moving && kindOf(this.from) === kindOf(this.path[0])
        ? kindOf(this.from)
        : undefined
    this.lift = damp(this.lift, moving ? LIFT : 0, 4, dt)
    const seatTarget = (seatKind && SEAT[seatKind]) || 0
    this.seat = this.snap ? seatTarget : damp(this.seat, seatTarget, 3, dt)
    this.snap = false
    const motion = reduced ? 0.2 : 1
    const bob = Math.sin(t * 2.1 + this.phase) * 0.012 * motion

    this.group.visible = !this.hidden
    this.group.position.set(this.x, this.lift + this.seat + bob, this.z)
    this.group.rotation.y = this.heading
    const { torso, head, armL, armR, face } = this.parts
    torso.rotation.z = MathUtils.clamp(this.turnVel * 0.09, -0.22, 0.22) * motion
    torso.rotation.x = -Math.min(this.speed / SPEED, 1) * 0.1 * motion

    // gestures: targets per pose, eased
    const target = this.pose(resting ? g2.pose : moving ? 'move' : 'idle', t, reduced, others)
    const k = 6
    const gs = this.gestures
    gs.armL = damp(gs.armL, target.armL, k, dt)
    gs.armR = damp(gs.armR, target.armR, k, dt)
    gs.pitch = damp(gs.pitch, target.pitch, k, dt)
    gs.yaw = damp(gs.yaw, target.yaw, k, dt)
    gs.roll = damp(gs.roll, target.roll, k, dt)
    gs.glow = damp(gs.glow, target.glow, 3, dt)
    armL.rotation.x = gs.armL
    armR.rotation.x = gs.armR
    head.rotation.set(gs.pitch, gs.yaw, gs.roll, 'YXZ')
    ;(face.material as MeshBasicMaterial).color.copy(this.faceBase).multiplyScalar(gs.glow)
  }

  /** arm swing (+ = hand forward / up), head pitch (+ = look up), yaw, roll, face glow */
  private pose(pose: string, t: number, reduced: boolean, others: Record<string, AgentRig>) {
    const m = reduced ? 0.3 : 1
    const s = (f: number, o = 0) => Math.sin(t * f + this.phase + o) * m
    const p = { armL: 0.12, armR: 0.12, pitch: 0, yaw: reduced ? 0 : s(0.35) * 0.25, roll: 0, glow: 1 }
    switch (pose) {
      case 'move':
        return { ...p, armL: 0.25, armR: 0.25, yaw: 0 }
      case 'type':
        return { ...p, armL: 0.95 + s(13) * 0.07, armR: 0.95 + s(13, 1.6) * 0.07, pitch: 0.05, yaw: 0 }
      case 'listen': {
        // keeps typing slowly, head turned to whoever came to the desk
        const o = this.goal?.lookAt ? others[this.goal.lookAt] : undefined
        const yaw = o ? MathUtils.clamp(wrap(Math.atan2(-(o.x - this.x), -(o.z - this.z)) - this.heading), -1.1, 1.1) : 0
        return { ...p, armL: 0.8, armR: 0.8, pitch: 0.1, yaw }
      }
      case 'talk':
        return { ...p, armL: 0.35 + s(3) * 0.25, armR: 0.35 + s(3, 2) * 0.25, pitch: 0.06 + s(5) * 0.04, yaw: 0 }
      case 'post':
        return { ...p, armR: 2.5 + s(2.5) * 0.15, armL: 0.2, pitch: 0.25, yaw: 0 }
      case 'pingpong':
        return { ...p, armR: 0.9 + s(5.5) * 0.6, armL: 0.3, yaw: 0, roll: s(5.5) * 0.06 }
      case 'boardgame':
        return { ...p, armR: 0.35 + Math.max(0, s(1.4)) ** 4 * 0.6, armL: 0.5, pitch: -0.35, yaw: s(0.5) * 0.15 }
      case 'coffee':
        return { ...p, armL: 1.25 + Math.max(0, s(0.8)) * 0.35, pitch: 0.05 + Math.max(0, s(0.8)) * 0.12 }
      case 'sofa':
        return { ...p, armL: 0.05, armR: 0.05, pitch: -0.22, roll: 0.28, yaw: 0, glow: 0.3 }
      case 'water':
        return { ...p, armR: 1.1 + s(1.2) * 0.12, pitch: -0.3, yaw: 0 }
      case 'books':
        return { ...p, armR: 1.4 + Math.max(0, s(0.6)) * 0.5, pitch: 0.2 }
      default:
        return p
    }
  }
}
