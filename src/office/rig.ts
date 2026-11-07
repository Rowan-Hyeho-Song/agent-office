// One agent on screen (#17, reshaped for the floating form #27/#28): a floating head over a beam of light and
// two floating hands. The agent_i floor node is the root that glides along the nav graph (no teleporting,
// never through furniture); the head bobs, lifts while moving and leans into turns; the hands follow their
// pose targets on a critically damped spring, so they trail the head by ~0.1 s; props are taken from their
// home into a hand's grip and put back. The Director says where to go and what to do; the rig only moves.

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Euler,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Mesh,
} from 'three'
import type { Goal } from './director'
import { dist, routeFromEdge, shortestPath, type NavGraph } from './nav'
import { GLOW } from './nodes'
import type { AgentStatus } from './status'

const SPEED = 0.75 // m/s cruising
const ACCEL = 1.4 // m/s²
const CORNER_SPEED = 0.32 // through a sharp turn
const TURN_RATE = 4.5 // rad/s
const LIFT = 0.06 // extra hover height while moving
/** seated spots: the head floats lower over the cushion / stool */
const SEAT: Record<string, number> = { sofa: -0.3, stool: -0.2 }
/** where the beam of light ends when the agent hovers over furniture (else the floor) */
const SURFACE: Record<string, number> = { work: 0.76, stool: 0.525, sofa: 0.44 }
/** through the door: how far past the door spot an agent glides before it's out of the room */
const EXIT_DEPTH = 0.9
const EXIT = '__exit'
/** hand spring (#28: critically damped, ω ≈ 12 → about 0.12 s behind the head) */
const HAND_OMEGA = 12
const PROP_OMEGA = 14
/** the planner's sticky notes shown (#28: = open issues, fixed until the count is wired, #44) */
const POSTITS = 3
/** the beam's height in the model (pivot at its top, the head's underside) */
const BEAM_H = 0.97

const FAIL_RED = new Color('#ff5a5f').multiplyScalar(2)

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const damp = MathUtils.damp
const UP = new Vector3(0, 1, 0)

export interface Hand {
  node: Object3D
  grip: Object3D | undefined
  index: Object3D | undefined
  fingers: Object3D | undefined
  thumb: Object3D | undefined
  /** rest pose in the root's frame */
  restPos: Vector3
  restQuat: Quaternion
  vel: Vector3
}

export interface RigParts {
  /** agent_i: the floor node that moves */
  root: Object3D
  head: Object3D
  headRestY: number
  face: Mesh | undefined
  beam: Object3D | undefined
  floor: Mesh | undefined
  hands: { l: Hand; r: Hand }
  /** role parts: 3D orbit (agent_1), coder's ring (agent_3_tip), coder's ear-cup glow, planner's sticky notes */
  orbit: Object3D | undefined
  ring: Object3D | undefined
  ear: Object3D | undefined
  postits: Object3D[]
}

/** a soft round light on the floor: the floor disc's alpha falls off to its edge (#27: done in the app) */
function radialAlpha() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.45, '#9a9a9a')
  grad.addColorStop(1, '#000000')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}
let alphaMap: CanvasTexture | null = null

/**
 * The light under the head (#54, the designer's numbers, agents.md 2.1/2.3): ring under the head → a faint beam
 * that is gone well before the floor → a pool of light on the floor. Two lights, not a cone, so it never reads
 * as a body again.
 */
export const BEAM = {
  /** alpha right under the head */
  opacity: 0.28,
  /** alpha = opacity × (1 − t)^falloff, t = 0 under the head → 1 at `reach` of the beam's length, 0 below */
  falloff: 1.6,
  reach: 0.75,
  /** color = the agent's color × this (the live default would be ×2.6) */
  color: 0.9,
}
export const FLOOR_POOL = { opacity: 0.45 }

/**
 * Additive, no depth writes, front faces only. The fade is computed from the beam's own height in the shader
 * (the cone has no UVs; its pivot is at the top, the model spans 0 → −BEAM_H), so however far the rig stretches
 * or cuts it, the fade keeps its proportions.
 */
/**
 * The hover ring and the wrist cuffs (#54): bright, but still the agent's own color. The live default
 * (emissive × 2.6, not tone mapped) pushes lavender past 1 in every channel and it washes out to white, and the
 * cuff's color is how you tell whose hand it is. So: color × min(1.2, 1 / its largest channel).
 */
function keepHue(node: Object3D | undefined) {
  node?.traverse((o) => {
    const mesh = o as Mesh
    const base = mesh.userData.baseColor as Color | undefined
    if (!mesh.isMesh || !base || mesh.userData.hueKept) return
    mesh.userData.hueKept = true
    const c = base.clone().multiplyScalar(1 / GLOW.neon) // back to the agent's color
    const top = Math.max(c.r, c.g, c.b, 1e-6)
    ;(mesh.material as MeshBasicMaterial).color.copy(c.multiplyScalar(Math.min(1.2, 1 / top)))
  })
}

function fadeBeam(mesh: Mesh) {
  const m = mesh.material as MeshBasicMaterial
  if (m.userData.faded) return
  m.userData.faded = true
  const base = mesh.userData.baseColor as Color | undefined // emissive × GLOW.neon, from nodes.tsx
  if (base) m.color.copy(base).multiplyScalar(BEAM.color / GLOW.neon)
  m.transparent = true
  m.depthWrite = false
  m.blending = AdditiveBlending
  m.opacity = BEAM.opacity
  m.onBeforeCompile = (shader) => {
    shader.uniforms.beamReach = { value: BEAM_H * BEAM.reach }
    shader.uniforms.beamFalloff = { value: BEAM.falloff }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeamY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamY;\nuniform float beamReach;\nuniform float beamFalloff;')
      .replace(
        '#include <opaque_fragment>',
        'float beamT = clamp(-vBeamY / beamReach, 0.0, 1.0);\ndiffuseColor.a *= pow(1.0 - beamT, beamFalloff);\n#include <opaque_fragment>',
      )
  }
  m.needsUpdate = true
}

/**
 * Regroup an agent's flat glb parts (each already at its pivot, see nodes.tsx rebase) into
 * agent_i → head → face / tip / glow / role parts, agent_i → beam / floor. The hands stay in the scene (they
 * follow on a spring), fingers and cuff go under their hand. Object3D.attach keeps every world pose.
 * Idempotent per scene (StrictMode renders twice).
 */
export function buildRig(scene: Object3D, nodes: Record<string, Object3D>, i: number): RigParts {
  const key = `rig_${i}`
  const cached = scene.userData[key] as RigParts | undefined
  if (cached) return cached
  const n = (s: string) => nodes[`agent_${i}${s}`]
  scene.updateMatrixWorld(true)
  const root = n('')
  const head = n('_head')
  root.attach(head)
  for (const s of ['_face', '_tip', '_glow', '_orbit', '_ear_glow', '_postit_0', '_postit_1', '_postit_2', '_postit_3', '_postit_4']) {
    if (n(s)) head.attach(n(s))
  }
  for (const s of ['_beam', '_floor']) if (n(s)) root.attach(n(s))
  root.updateMatrixWorld(true)
  const rootQuatInv = root.getWorldQuaternion(new Quaternion()).invert()
  const hand = (side: 'l' | 'r'): Hand => {
    const node = n(`_hand_${side}`)
    for (const s of ['_index', '_fingers', '_thumb', '_cuff']) if (n(`_hand_${side}${s}`)) node.attach(n(`_hand_${side}${s}`))
    return {
      node,
      grip: n(`_hand_${side}_grip`),
      index: n(`_hand_${side}_index`),
      fingers: n(`_hand_${side}_fingers`),
      thumb: n(`_hand_${side}_thumb`),
      restPos: root.worldToLocal(node.getWorldPosition(new Vector3())),
      restQuat: rootQuatInv.clone().multiply(node.getWorldQuaternion(new Quaternion())),
      vel: new Vector3(),
    }
  }
  const floor = n('_floor') as Mesh | undefined
  if (floor) {
    const m = floor.material as MeshBasicMaterial
    m.alphaMap = alphaMap ??= radialAlpha()
    m.transparent = true
    m.depthWrite = false
    m.blending = AdditiveBlending
    m.opacity = FLOOR_POOL.opacity
  }
  keepHue(n('_glow'))
  keepHue(n('_hand_l_cuff'))
  keepHue(n('_hand_r_cuff'))
  const beam = n('_beam')
  beam?.traverse((o) => {
    if ((o as Mesh).isMesh) fadeBeam(o as Mesh)
  })
  const rig: RigParts = {
    root,
    head,
    headRestY: head.position.y,
    face: n('_face') as Mesh | undefined,
    beam,
    floor,
    hands: { l: hand('l'), r: hand('r') },
    orbit: n('_orbit'),
    ring: i === 3 ? n('_tip') : undefined,
    ear: n('_ear_glow'),
    postits: [0, 1, 2, 3, 4].map((k) => n(`_postit_${k}`)).filter(Boolean),
  }
  rig.postits.forEach((p, k) => (p.visible = k < POSTITS))
  scene.userData[key] = rig
  return rig
}

// ------------------------------------------------------------------ the face screen (#28, simple first)

type FaceMood = 'open' | 'blink' | 'happy' | 'sleep' | 'fail'

/** the head's screen: two eyes in the agent's color on a dark glass; drawn only when the mood changes */
class FaceScreen {
  private ctx: CanvasRenderingContext2D
  readonly texture: CanvasTexture
  private mood: FaceMood | null = null
  private color: string

  constructor(color: string) {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 180
    this.ctx = c.getContext('2d')!
    this.color = color
    this.texture = new CanvasTexture(c)
    this.texture.flipY = false // glTF UVs (v = 0 at the top of the image)
    this.texture.colorSpace = SRGBColorSpace
  }

  draw(mood: FaceMood) {
    if (mood === this.mood) return
    this.mood = mood
    const g = this.ctx
    g.fillStyle = '#05080b'
    g.fillRect(0, 0, 300, 180)
    g.strokeStyle = g.fillStyle = mood === 'fail' ? '#ff5a5f' : this.color
    g.lineWidth = 14
    g.lineCap = 'round'
    for (const x of [100, 200]) {
      g.beginPath()
      if (mood === 'open') g.roundRect(x - 16, 60, 32, 60, 12)
      if (mood === 'open') g.fill()
      else if (mood === 'blink' || mood === 'sleep') (g.moveTo(x - 20, 95), g.lineTo(x + 20, 95), g.stroke())
      else if (mood === 'happy') (g.moveTo(x - 22, 102), g.lineTo(x, 80), g.lineTo(x + 22, 102), g.stroke())
      else (g.moveTo(x - 18, 72), g.lineTo(x + 18, 108), g.moveTo(x + 18, 72), g.lineTo(x - 18, 108), g.stroke())
    }
    this.texture.needsUpdate = true
  }
}

// ------------------------------------------------------------------ props in hand (#20 nodes, #27 grips)

interface Prop {
  node: Object3D
  kind: string
  /** where it rests, in the frame of homeParent (the scene, or the head for the planner's pen) */
  homeParent: Object3D
  homeLocal: Matrix4
  /** its pose in a hand's grip frame (extras.grip) */
  gripLocal: Matrix4
  holder: { rig: AgentRig; side: 'l' | 'r' } | null
}

/** extras { pos, rot } (rot = Blender XYZ Euler) → a matrix */
const toMatrix = (t: { pos?: number[]; rot?: number[] } | undefined) => {
  const [x, y, z] = (t?.rot ?? [0, 0, 0]) as [number, number, number]
  return new Matrix4().compose(
    new Vector3(...((t?.pos ?? [0, 0, 0]) as [number, number, number])),
    new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')),
    new Vector3(1, 1, 1),
  )
}

/** every prop in the office, who holds it, and how it moves between its home and a hand */
export class PropBank {
  private props: Prop[] = []

  constructor(scene: Object3D, nodes: Record<string, Object3D>) {
    scene.updateMatrixWorld(true)
    for (const node of Object.values(nodes)) {
      const x = node.userData as { prop?: string; home_on?: string; grip?: { pos?: number[]; rot?: number[] } }
      if (!x.prop || node.userData.__prop) continue
      node.userData.__prop = true
      const homeParent = (x.home_on && nodes[x.home_on]) || scene
      homeParent.updateMatrixWorld(true)
      const homeLocal = homeParent.matrixWorld.clone().invert().multiply(node.matrixWorld)
      scene.attach(node) // props move in world space; their home is recomputed from homeParent every frame
      this.props.push({ node, kind: x.prop, homeParent, homeLocal, gripLocal: toMatrix(x.grip), holder: null })
    }
  }

  /** the prop an activity uses at a spot, if it's free (or already this agent's) */
  private pick(rig: AgentRig, kind: string, prefer?: string) {
    const mine = this.props.find((p) => p.holder?.rig === rig && p.kind === kind)
    if (mine) return mine
    const free = this.props.filter((p) => p.kind === kind && !p.holder && (kind !== 'pen' || p.homeParent === rig.parts.head))
    return free.find((p) => p.node.name === prefer) ?? free[0]
  }

  /** set what each agent holds this frame: one prop per agent, everything else goes home */
  hold(wants: Map<AgentRig, { kind: string; side: 'l' | 'r'; prefer?: string } | null>) {
    const taken = new Set<Prop>()
    for (const [rig, want] of wants) {
      if (!want) continue
      const p = this.pick(rig, want.kind, want.prefer)
      if (!p || taken.has(p)) continue
      p.holder = { rig, side: want.side }
      taken.add(p)
    }
    for (const p of this.props) if (!taken.has(p)) p.holder = null
  }

  private m = new Matrix4()
  private pos = new Vector3()
  private quat = new Quaternion()
  private scl = new Vector3()

  update(dt: number) {
    const k = 1 - Math.exp(-PROP_OMEGA * dt)
    for (const p of this.props) {
      const grip = p.holder && p.holder.rig.parts.hands[p.holder.side].grip
      if (grip && p.holder!.rig.visible) {
        grip.updateWorldMatrix(true, false)
        this.m.multiplyMatrices(grip.matrixWorld, p.gripLocal)
      } else {
        p.homeParent.updateWorldMatrix(true, false)
        this.m.multiplyMatrices(p.homeParent.matrixWorld, p.homeLocal)
      }
      this.m.decompose(this.pos, this.quat, this.scl)
      // cups and the watering can stay upright in a hand (#27: the grip is tilted 60°); the can tips to pour
      if (grip && (p.kind === 'cup' || p.kind === 'watering_can')) {
        const yaw = p.holder!.rig.heading
        this.quat.setFromAxisAngle(UP, yaw)
        if (p.kind === 'watering_can') this.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.5))
      }
      p.node.position.lerp(this.pos, k)
      p.node.quaternion.slerp(this.quat, k)
      p.node.visible = !p.holder || p.holder.rig.visible
    }
  }
}

// ------------------------------------------------------------------ hand poses

interface HandPose {
  pos: Vector3
  /** extra rotation in the root's frame, applied before the rest rotation */
  turn: Quaternion
  /** finger curls (+ = toward the palm) */
  curl: { index: number; fingers: number; thumb: number }
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const qz = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a)
const qy = (a: number) => new Quaternion().setFromAxisAngle(UP, a)
const NONE = new Quaternion()
const REST_CURL = { index: 0.15, fingers: 0.25, thumb: 0.1 }
const HOLD_CURL = { index: 1.2, fingers: 1.35, thumb: 0.8 }

/** what an activity does with its hands, and which prop it takes (side = the hand that holds it) */
const PROP_FOR: Record<string, { kind: string; side: 'l' | 'r' }> = {
  pingpong: { kind: 'paddle', side: 'r' },
  coffee: { kind: 'cup', side: 'l' },
  water: { kind: 'watering_can', side: 'r' },
  boardgame: { kind: 'piece', side: 'r' },
}

export class AgentRig {
  readonly id: string
  readonly parts: RigParts
  private phase: number
  private face: FaceScreen | null
  /** the emitters this rig tints, with their own colors (a node may hold several meshes) */
  private glowBase = new Map<Mesh, Color>()

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
  /** the first frame after placing: take the seat height at once instead of floating into it */
  private snap = true

  // motion state
  private speed = 0
  private turnVel = 0
  private lift = 0
  private seat = 0
  private surface = 0
  private look = { pitch: 0, yaw: 0, roll: 0 }
  private curls = { l: { ...REST_CURL }, r: { ...REST_CURL } }
  private spin = { orbit: 0, ring: 0 }
  private blinkAt = 0
  /** what it is holding this frame (read by the PropBank) */
  want: { kind: string; side: 'l' | 'r'; prefer?: string } | null = null

  constructor(id: string, index: number, parts: RigParts, color: string) {
    this.id = id
    this.parts = parts
    this.phase = index * 1.7
    // one screen per face node: StrictMode builds the rigs twice, and both must draw on the texture that's shown
    const face = parts.face
    this.face = face ? (face.userData.faceScreen ??= new FaceScreen(color)) : null
    if (face && this.face && (face.material as MeshBasicMaterial).map !== this.face.texture) {
      const old = face.material as MeshBasicMaterial
      // the screen sits exactly on the head's front glass on some heads (메시, 루프: same plane): pull it forward
      // in depth so it always wins
      face.material = new MeshBasicMaterial({
        map: this.face.texture,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      old.dispose()
    }
    for (const node of [parts.ring, parts.ear]) node?.traverse((o) => {
      const mat = (o as Mesh).material as MeshBasicMaterial | undefined
      if (mat?.color) this.glowBase.set(o as Mesh, mat.color.clone())
    })
  }

  /** the node that moves (the bubble and the debug overlay follow it) */
  get group() {
    return this.parts.root
  }

  get visible() {
    return !this.hidden
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

  update(dt: number, t: number, g: NavGraph, others: Record<string, AgentRig>, reduced: boolean, status?: AgentStatus) {
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

    const goal = this.goal
    const resting = !moving && this.arrived === goal.spot
    // seated on arrival, and kept seated while sliding from one seat to the next (sofa_1 → sofa_2)
    const kindOf = (id: string | null | undefined) => (id ? g.spots[id]?.kind : undefined)
    const seatKind = resting ? kindOf(goal.spot) : moving && kindOf(this.from) === kindOf(this.path[0]) ? kindOf(this.from) : undefined
    this.lift = damp(this.lift, moving ? LIFT : 0, 4, dt)
    const seatTarget = (seatKind && SEAT[seatKind]) || 0
    const surfaceTarget = (seatKind && SURFACE[seatKind]) || 0
    this.seat = this.snap ? seatTarget : damp(this.seat, seatTarget, 3, dt)
    this.surface = this.snap ? surfaceTarget : damp(this.surface, surfaceTarget, 6, dt)
    this.snap = false
    const motion = reduced ? 0.2 : 1
    const bob = Math.sin(t * 2.1 + this.phase) * 0.015 * motion

    const { root, head, beam } = this.parts
    root.visible = !this.hidden
    root.position.set(this.x, 0, this.z)
    root.rotation.set(0, this.heading, 0)
    root.updateMatrixWorld(true)

    // the head: lifts while moving, sits lower on seats, bobs, leans into turns and forward with speed
    const pose = resting ? goal.pose : moving ? 'move' : 'idle'
    const lookTarget = this.headLook(pose, t, reduced, others)
    this.look.pitch = damp(this.look.pitch, lookTarget.pitch, 6, dt)
    this.look.yaw = damp(this.look.yaw, lookTarget.yaw, 6, dt)
    this.look.roll = damp(this.look.roll, lookTarget.roll, 6, dt)
    const lean = MathUtils.clamp(this.turnVel * 0.09, -0.22, 0.22) * motion
    const forward = Math.min(this.speed / SPEED, 1) * 0.12 * motion
    const dy = this.lift + this.seat + bob
    head.position.y = this.parts.headRestY + dy
    head.rotation.set(this.look.pitch - forward, this.look.yaw, this.look.roll + lean, 'YXZ')

    // the beam reaches from the head's underside down to the floor, or to the furniture it hovers over
    if (beam) {
      const top = BEAM_H + dy
      beam.position.y = top
      beam.scale.y = Math.max(0.02, (top - this.surface) / BEAM_H)
    }
    // the pool of light on the floor: fainter and wider the higher the head floats (#54)
    const pool = this.parts.floor
    if (pool) {
      const up = MathUtils.clamp(dy, 0, 0.3) / 0.3
      pool.scale.setScalar(1 + up * 0.35)
      ;(pool.material as MeshBasicMaterial).opacity = FLOOR_POOL.opacity * (1 - up * 0.45)
    }

    this.updateHands(dt, t, pose, reduced, others)
    this.updateRole(dt, t, status, reduced)
    this.updateFace(t, pose, status, reduced)

    // the prop for this activity (the planner takes the pen from its ear to the whiteboard)
    const prop = resting ? PROP_FOR[goal.pose] : undefined
    const pen = resting && goal.pose === 'post' && this.id === 'agent_0'
    this.want = prop
      ? { ...prop, prefer: goal.pose === 'pingpong' || goal.pose === 'boardgame' ? `prop_${prop.kind}_${goal.spot.endsWith('_b') ? 'b' : 'a'}` : undefined }
      : pen
        ? { kind: 'pen', side: 'r' }
        : null
  }

  private headLook(pose: string, t: number, reduced: boolean, others: Record<string, AgentRig>) {
    const m = reduced ? 0.3 : 1
    const s = (f: number, o = 0) => Math.sin(t * f + this.phase + o) * m
    const idle = { pitch: 0, yaw: reduced ? 0 : s(0.35) * 0.25, roll: 0 }
    switch (pose) {
      case 'move':
        return { pitch: 0, yaw: 0, roll: 0 }
      case 'type':
        return { pitch: -0.08, yaw: 0, roll: 0 }
      case 'listen': {
        const o = this.goal?.lookAt ? others[this.goal.lookAt] : undefined
        const yaw = o ? MathUtils.clamp(wrap(Math.atan2(-(o.x - this.x), -(o.z - this.z)) - this.heading), -1.1, 1.1) : 0
        return { pitch: 0, yaw, roll: 0 }
      }
      case 'talk':
        return { pitch: 0.04 + s(5) * 0.04, yaw: 0, roll: 0 }
      case 'post':
        return { pitch: 0.2, yaw: 0, roll: 0 }
      case 'boardgame':
        return { pitch: -0.35, yaw: s(0.5) * 0.15, roll: 0 }
      case 'sofa':
        return { pitch: -0.22, yaw: 0, roll: 0.28 }
      case 'water':
        return { pitch: -0.3, yaw: 0, roll: 0 }
      case 'books':
        return { pitch: 0.2, yaw: 0, roll: 0 }
      case 'pingpong':
        return { pitch: -0.05, yaw: s(5.5) * 0.12, roll: 0 }
      default:
        return idle
    }
  }

  /** each hand's target in the root's frame for this pose */
  private handPose(side: 'l' | 'r', pose: string, t: number, reduced: boolean): HandPose {
    const m = reduced ? 0.3 : 1
    const s = (f: number, o = 0) => Math.sin(t * f + this.phase + o) * m
    const sx = side === 'l' ? -1 : 1
    const rest = this.parts.hands[side].restPos
    const down = qz(-sx * Math.PI / 2) // palm down (#27 rest: palms face each other)
    const at = (x: number, y: number, z: number, turn = NONE, curl = REST_CURL): HandPose => ({ pos: v(x, y, z), turn, curl })
    const sit = this.seat
    switch (pose) {
      case 'move':
        return at(rest.x, rest.y - 0.03, rest.z + 0.08)
      case 'type':
      case 'listen': {
        const tap = pose === 'type' ? Math.max(0, s(14, side === 'l' ? 0 : 1.6)) * 0.02 : 0
        return at(sx * 0.13, 0.81 + tap, -0.42, down, { index: 0.5 + tap * 15, fingers: 0.6, thumb: 0.2 })
      }
      case 'talk':
        return at(sx * 0.24, 0.98 + sit + s(3, sx) * 0.05, -0.28, qy(-sx * 0.3), side === 'r' ? { index: 0, fingers: 1.3, thumb: 0.6 } : REST_CURL)
      case 'post':
        return side === 'r' ? at(0.12, 1.42 + s(2.5) * 0.03, -0.32, qz(0.4), HOLD_CURL) : at(rest.x, rest.y, rest.z)
      case 'pingpong':
        return side === 'r'
          ? at(0.26 + s(5.5) * 0.12, 0.92, -0.3 - Math.cos(t * 5.5 + this.phase) * 0.1 * m, qy(s(5.5) * 0.6), HOLD_CURL)
          : at(-0.24, 0.88, -0.12)
      case 'boardgame': {
        const reach = Math.max(0, s(1.4)) ** 4
        return side === 'r'
          ? at(0.1 - reach * 0.06, 0.84 + reach * 0.04, -0.34 - reach * 0.12, down, HOLD_CURL)
          : at(-0.16, 0.8, -0.3, down, { index: 0.4, fingers: 0.5, thumb: 0.2 })
      }
      case 'coffee':
        return side === 'l'
          ? at(-0.1, 1.02 + sit + Math.max(0, s(0.8)) * 0.08, -0.22 - Math.max(0, s(0.8)) * 0.06, NONE, HOLD_CURL)
          : at(rest.x, rest.y, rest.z)
      case 'sofa':
        return at(sx * 0.22, 0.62, -0.08, down, { index: 0.6, fingers: 0.7, thumb: 0.3 })
      case 'water':
        return side === 'r' ? at(0.16, 0.86 + s(1.2) * 0.02, -0.42, NONE, HOLD_CURL) : at(rest.x, rest.y, rest.z)
      case 'books':
        return side === 'r' ? at(0.14, 1.3 + Math.max(0, s(0.6)) * 0.12, -0.4, qz(0.3), { index: 0.2, fingers: 0.4, thumb: 0.2 }) : at(rest.x, rest.y, rest.z)
      default:
        return at(rest.x, rest.y + s(1.1, sx) * 0.01, rest.z)
    }
  }

  private tmpPos = new Vector3()
  private tmpQuat = new Quaternion()
  private rootQuat = new Quaternion()

  private updateHands(dt: number, t: number, pose: string, reduced: boolean, _others: Record<string, AgentRig>) {
    const { root } = this.parts
    root.getWorldQuaternion(this.rootQuat)
    const k = 1 - Math.exp(-HAND_OMEGA * dt)
    for (const side of ['l', 'r'] as const) {
      const hand = this.parts.hands[side]
      const p = this.handPose(side, pose, t, reduced)
      hand.node.visible = root.visible
      // target in world: the root frame, then the pose's turn on top of the rest rotation
      this.tmpPos.copy(p.pos)
      root.localToWorld(this.tmpPos)
      this.tmpQuat.copy(this.rootQuat).multiply(p.turn).multiply(hand.restQuat)
      if (this.snapHands) {
        hand.node.position.copy(this.tmpPos)
        hand.node.quaternion.copy(this.tmpQuat)
        hand.vel.set(0, 0, 0)
      } else {
        // critically damped spring: x'' = ω²(target − x) − 2ω x'
        const w = HAND_OMEGA
        const steps = Math.ceil(dt / (1 / 120))
        const h = dt / steps
        for (let i = 0; i < steps; i++) {
          const ax = w * w * (this.tmpPos.x - hand.node.position.x) - 2 * w * hand.vel.x
          const ay = w * w * (this.tmpPos.y - hand.node.position.y) - 2 * w * hand.vel.y
          const az = w * w * (this.tmpPos.z - hand.node.position.z) - 2 * w * hand.vel.z
          hand.vel.x += ax * h
          hand.vel.y += ay * h
          hand.vel.z += az * h
          hand.node.position.addScaledVector(hand.vel, h)
        }
        hand.node.quaternion.slerp(this.tmpQuat, k)
      }
      const c = this.curls[side]
      c.index = damp(c.index, p.curl.index, 10, dt)
      c.fingers = damp(c.fingers, p.curl.fingers, 10, dt)
      c.thumb = damp(c.thumb, p.curl.thumb, 10, dt)
      if (hand.index) hand.index.rotation.x = c.index
      if (hand.fingers) hand.fingers.rotation.x = c.fingers
      if (hand.thumb) hand.thumb.rotation.x = c.thumb
    }
    this.snapHands = false
  }
  private snapHands = true
  private tmpColor = new Color()

  /** the 3D agent's orbit and the coder's ring spin; the coder's ear cups glow while it works (#28) */
  private updateRole(dt: number, _t: number, status: AgentStatus | undefined, reduced: boolean) {
    const working = status?.state === 'working'
    const running = working && (status?.activity === 'test' || status?.activity === 'build')
    const failed = !running && status?.lastResult?.ok === false
    const m = reduced ? 0.25 : 1
    if (this.parts.orbit) {
      this.spin.orbit += dt * (running ? 3 : 0.8) * m
      this.parts.orbit.rotation.y = this.spin.orbit
    }
    const tint = (node: Object3D | undefined, color: (base: Color) => Color) =>
      node?.traverse((o) => {
        const base = this.glowBase.get(o as Mesh)
        if (base) ((o as Mesh).material as MeshBasicMaterial).color.copy(color(base))
      })
    const ring = this.parts.ring
    if (ring) {
      // the coder's loop: slow, fast while tests run, stopped and red when they failed
      this.spin.ring += dt * (failed ? 0 : running ? 5 : 0.6) * m
      ring.rotation.y = this.spin.ring
      tint(ring, (base) => (failed ? FAIL_RED : base))
    }
    tint(this.parts.ear, (base) => this.tmpColor.copy(base).multiplyScalar(working ? 1 : 0.15))
  }

  private updateFace(t: number, pose: string, status: AgentStatus | undefined, reduced: boolean) {
    if (!this.face) return
    if (pose === 'sofa') return this.face.draw('sleep')
    if (this.id === 'agent_3' && status?.lastResult && !(status.state === 'working' && (status.activity === 'test' || status.activity === 'build'))) {
      const fresh = Date.now() - status.lastResult.at < 8_000
      if (!status.lastResult.ok) return this.face.draw('fail')
      if (fresh) return this.face.draw('happy')
    }
    if (pose === 'talk' || pose === 'pingpong') return this.face.draw('happy')
    // a blink every few seconds (never with reduced motion)
    if (!reduced && t > this.blinkAt) {
      if (t > this.blinkAt + 0.14) this.blinkAt = t + 2.5 + ((this.phase * 7.3 + t) % 3)
      else return this.face.draw('blink')
    }
    this.face.draw('open')
  }
}
