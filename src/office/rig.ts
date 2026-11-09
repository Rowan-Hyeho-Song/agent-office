// One agent on screen (#17, reshaped for the floating form #27/#28): a floating head over a beam of light and
// two floating hands. The agent_i floor node is the root that glides along the nav graph (no teleporting,
// never through furniture); the head bobs, lifts while moving and leans into turns; the hands follow their
// pose targets on a critically damped spring, so they trail the head by ~0.1 s; props are taken from their
// home into a hand's grip and put back. The Director says where to go and what to do; the rig only moves.

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  Euler,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { Goal } from './director'
import { aimPose, planGesture, type AimPose, type Plan } from './aim'
import { DOZE } from './doze'
import { DESK_SIDES, dist, routeFromEdge, shortestPath, type NavGraph } from './nav'
import { GLOW } from './nodes'
import type { FingerModel } from './grip'
import {
  ALL_POSES,
  DEFAULT_FAN,
  POSES,
  VARIANTS,
  clampAngles,
  fingerRootQuat,
  fromCurl,
  fromVec,
  readJoint,
  segmentQuat,
  thumbRootQuat,
  toVec,
  type AnyPoseId,
  type HandAngles,
  type JointSpec,
  type Range,
} from './handPose'
import { TRAFFIC, type Sample } from './traffic'
import type { AgentStatus } from './status'
import { musicGlow, speakerCone, speakerOn } from '../audio/speaker'

/** the poses of the play schedule (play.ts PlayKind): what "resting" means (sound.md 5) */
const RESTING_POSES: ReadonlySet<string> = new Set(['pingpong', 'boardgame', 'coffee', 'sofa', 'water', 'books'])
const SPEED = 0.75 // m/s cruising
const ACCEL = 1.4 // m/s²
const CORNER_SPEED = 0.32 // through a sharp turn
const TURN_RATE = 4.5 // rad/s
// a meeting listener's nod (#141): how long it takes, how far the head dips, how long the addressee's hand stays up
const NOD_S = 0.5
/** where a caught paper / plane is held to be looked at, from the head (paper-pass.md 5, #273) */
export const LOOK_AT = { ahead: 0.22, down: 0.1, side: 0.06 }
/** a received plane / toss: how long the eyes stay wide before the nod (paper-pass.md 4) */
const PAPER_SURPRISE_S = 1.2
const NOD_DEG = 5
const NOD_HAND_S = 0.8
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
/** finger bends ease at this rate (1/s): ~95 % of a change in 120 ms (agents.md 2.7) */
const FINGER_RATE = 25
/** a closing hand: each finger starts this much after the one before it (index first); opening is the reverse (hand-poses.md 2) */
const FINGER_LAG_S = 0.015
/** a resting hand's fingers start to drift after this long (s), fading in over a second; ±3°, 4–7 s periods */
const IDLE_AFTER_S = 3
const IDLE_DRIFT_DEG = 3
const NO_DRIFT = [0, 0, 0, 0]
/** a string → 0 … 1, always the same (the idle drift's seed) */
function hash01(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}
/** a drive's curl (six numbers) and per-finger swing (rad, on top of the baked fan) as angles */
function fromCurlWithSwing(curl: readonly number[], fan: readonly number[], swing: readonly number[] | null): HandAngles {
  const a = fromCurl(curl, undefined, fan.map((x, f) => x + ((swing?.[f] ?? 0) * 180) / Math.PI))
  return a
}
const PROP_OMEGA = 14
/** the planner's sticky notes shown (#28: = open issues, fixed until the count is wired, #44) */
const POSTITS = 3
/** the beam's height in the model (pivot at its top, the head's underside) */
const BEAM_H = 0.97

const FAIL_RED = new Color('#ff5a5f').multiplyScalar(2)

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const damp = MathUtils.damp
const UP = new Vector3(0, 1, 0)

/** one finger joint (#134): the node and its rest rotation in its parent (bends are applied on top of it) */
export interface Joint {
  node: Object3D
  rest: Quaternion
  /** the node's `joint` extras (axis and sign per joint), see handPose.ts */
  spec?: JointSpec
  /** a finger root's baked fan angle, degrees (extras rest_abduct) */
  restAbd?: number
}

export interface Hand {
  node: Object3D
  grip: Object3D | undefined
  /** f[finger][knuckle]: index … little, root … tip (agent_i_hand_*_f{1..4}_{1,2,3}); missing nodes are null */
  fingers: (Joint | null)[][]
  /** the thumb's three joints (agent_i_hand_*_t_{0,1,2}): the root (CMC), MCP, IP */
  thumb: (Joint | null)[]
  /** the index and thumb tips in their own part's frame (the vertex farthest from the pivot), for the pinch */
  indexTip: Vector3 | null
  thumbTip: Vector3 | null
  /** every finger's tip in its last segment's frame (index … little) */
  tips: (Vector3 | null)[]
  /** rest pose in the root's frame */
  restPos: Vector3
  restQuat: Quaternion
  vel: Vector3
}

/**
 * What a grip (grip.ts, PlayStage) makes a hand do on top of its pose: where the hand goes (a world matrix, weight w: 0 = the
 * pose's own place), and how the fingers bend (six values, weight wc over the pose's own curls; spread = each finger's sideways
 * swing, rad). The hand's spring keeps following its pose underneath, so the weights fade back without a jump.
 */
export interface HandDrive {
  target: Matrix4 | null
  w: number
  curl: readonly number[] | null
  /** the fingers as 20 joint angles (handPose.toVec), already mixed by the caller: used instead of `curl` + `spread` when given (the contact fit carries full per-joint angles) */
  angles?: readonly number[] | null
  /** a grip's own abduction range per finger (index … little; grip.ts STONE_ABD), degrees: the rig clamps with these instead of the general ones while this drive shows */
  abdLimits?: readonly (Range | undefined)[] | null
  wc: number
  spread: readonly number[] | null
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
  /** echo (#193): the tuning fork over the head (swings about its local x) and the light ring round the speaker grille on the back of the head */
  fork: Object3D | undefined
  grille: Object3D | undefined
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

/** a finger (0 = index … 3 = little) or the thumb as plain data for the contact fit (grip.ts), or null if the hand lacks its parts */
export function fingerModelOf(hand: Hand, finger: number | 'thumb', side: 'l' | 'r'): FingerModel | null {
  const chain = finger === 'thumb' ? hand.thumb : hand.fingers[finger]
  const tip = finger === 'thumb' ? hand.thumbTip : hand.tips[finger]
  if (!tip || chain.some((j) => !j)) return null
  return {
    p: chain.map((j) => j!.node.position.clone()),
    rest: chain.map((j) => j!.rest.clone()),
    tip: tip.clone(),
    thumb: finger === 'thumb',
    sx: side === 'l' ? -1 : 1,
    finger: finger === 'thumb' ? undefined : finger,
    joint: chain.map((j) => j!.spec),
    restAbd: chain[0]!.restAbd,
  }
}

/** two vertices this close to the farthest distance count as equally far (the glb's quantization noise is far below it) */
const TIP_TIE_M = 2e-5

/**
 * the vertex of a part farthest from its pivot, in the part's own frame (a finger's tip). A fingertip mesh is symmetric, so several
 * vertices are equally far (±8 mm across the pad); the quantized glb breaks that tie differently from bake to bake, and a tip picked
 * on the other side moved the fingertip 16 mm sideways (#195: omok fingers 2.3 mm into the stone). Ties go to the +z side (the side
 * every grip and fit was made with), and there to the farthest vertex as before.
 */
function tipOf(part: Object3D | undefined): Vector3 | null {
  if (!part) return null
  part.updateWorldMatrix(true, true)
  const inv = new Matrix4().copy(part.matrixWorld).invert()
  const rel = new Matrix4()
  const v = new Vector3()
  const all: Vector3[] = []
  let far = 0
  part.traverse((o) => {
    const pos = (o as Mesh).geometry?.getAttribute('position')
    if (!pos) return
    rel.multiplyMatrices(inv, o.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel)
      all.push(v.clone())
      far = Math.max(far, v.length())
    }
  })
  // among the (near-)farthest: the +z side first, then the truly farthest one there
  let best: Vector3 | null = null
  const side = (p: Vector3) => (p.z > 1e-6 ? 1 : 0)
  for (const p of all) {
    if (p.length() < far - TIP_TIE_M) continue
    if (!best || side(p) > side(best) || (side(p) === side(best) && p.lengthSq() > best.lengthSq())) best = p
  }
  return best
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
  for (const s of ['_face', '_tip', '_glow', '_orbit', '_ear_glow', '_fork', '_ring', '_postit_0', '_postit_1', '_postit_2', '_postit_3', '_postit_4']) {
    if (n(s)) head.attach(n(s))
  }
  for (const s of ['_beam', '_floor', '_floor_ring']) if (n(s)) root.attach(n(s))
  root.updateMatrixWorld(true)
  const rootQuatInv = root.getWorldQuaternion(new Quaternion()).invert()
  const hand = (side: 'l' | 'r'): Hand => {
    const node = n(`_hand_${side}`)
    if (n(`_hand_${side}_cuff`)) node.attach(n(`_hand_${side}_cuff`))
    // the finger chains (#134, Blender #148): each segment hangs off the one before, the first off the palm
    const chain = (names: string[]): (Joint | null)[] => {
      let parent = node
      return names.map((s) => {
        const part = n(`_hand_${side}_${s}`)
        if (!part) return null
        parent.attach(part)
        parent = part
        const fan = part.userData.rest_abduct
        return { node: part, rest: part.quaternion.clone(), spec: readJoint(part.userData), restAbd: typeof fan === 'number' ? fan : undefined }
      })
    }
    const fingers = [1, 2, 3, 4].map((f) => chain([1, 2, 3].map((k) => `f${f}_${k}`)))
    const thumb = chain(['t_0', 't_1', 't_2'])
    return {
      node,
      grip: n(`_hand_${side}_grip`),
      fingers,
      thumb,
      indexTip: tipOf(fingers[0][2]?.node),
      thumbTip: tipOf(thumb[2]?.node),
      tips: fingers.map((c) => tipOf(c[2]?.node)),
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
  keepHue(n('_ring'))
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
    fork: n('_fork'),
    grille: n('_ring'),
    postits: [0, 1, 2, 3, 4].map((k) => n(`_postit_${k}`)).filter(Boolean),
  }
  rig.postits.forEach((p, k) => (p.visible = k < POSTITS))
  scene.userData[key] = rig
  return rig
}

// ------------------------------------------------------------------ the face screen (#28, simple first)

type FaceMood = 'open' | 'blink' | 'happy' | 'sleep' | 'fail' | 'doze' | 'focus' | 'wide'
/** the eyes' look is drawn in steps of this many px (up to 3 steps each way) */
const EYE_STEP = 4

/** the head's screen: two eyes in the agent's color on a dark glass; drawn only when the mood changes */
class FaceScreen {
  private ctx: CanvasRenderingContext2D
  readonly texture: CanvasTexture
  private mood: string | null = null
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

  /** `gx`, `gy`: where the eyes look, in steps (−3 … 3; +x = the viewer's right = the agent's left, +y = down) */
  draw(mood: FaceMood, gx = 0, gy = 0) {
    const key = `${mood}|${gx}|${gy}`
    if (key === this.mood) return
    this.mood = key
    const dx = gx * EYE_STEP
    const dy = gy * EYE_STEP
    const g = this.ctx
    g.fillStyle = '#05080b'
    g.fillRect(0, 0, 300, 180)
    g.strokeStyle = g.fillStyle = mood === 'fail' ? '#ff5a5f' : this.color
    g.globalAlpha = mood === 'doze' ? DOZE.faceBrightness : 1
    g.lineWidth = 14
    g.lineCap = 'round'
    for (const x of [100, 200]) {
      g.beginPath()
      // aiming: narrowed eyes; a plane coming: wide ones
      if (mood === 'open') g.roundRect(x - 16 + dx, 60 + dy, 32, 60, 12)
      else if (mood === 'focus') g.roundRect(x - 18 + dx, 78 + dy, 36, 26, 10)
      else if (mood === 'wide') g.roundRect(x - 20 + dx, 48 + dy, 40, 84, 14) // 1.25 x 1.4 the open bar, same centre (#273)
      if (mood === 'open' || mood === 'focus' || mood === 'wide') g.fill()
      else if (mood === 'blink' || mood === 'sleep' || mood === 'doze') (g.moveTo(x - 20, 95), g.lineTo(x + 20, 95), g.stroke())
      else if (mood === 'happy') (g.moveTo(x - 22, 102), g.lineTo(x, 80), g.lineTo(x + 22, 102), g.stroke())
      else (g.moveTo(x - 18, 72), g.lineTo(x + 18, 108), g.moveTo(x + 18, 72), g.lineTo(x - 18, 108), g.stroke())
    }
    g.globalAlpha = 1
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
  /** who has it; `attached` = it is in the hand now (false while the hand is still reaching for it: it stays home, reserved) */
  holder: { rig: AgentRig; side: 'l' | 'r'; attached: boolean } | null
  /** the grip empties (`<name>_grip_r|l`) in the node's own frame (grip.ts: the hand's _grip goes onto it) */
  grips: Partial<Record<'l' | 'r', Matrix4>>
  /** a pose someone else decided for this frame (PlayStage: the paddle's swing, the cup at the lips): taken exactly, no easing */
  forced: Matrix4 | null
}

/** a prop's info for the play stage */
export interface PropInfo {
  node: Object3D
  kind: string
  grips: Partial<Record<'l' | 'r', Matrix4>>
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
      const grips: Prop['grips'] = {}
      const inv = node.matrixWorld.clone().invert()
      for (const side of ['l', 'r'] as const) {
        const g = scene.getObjectByName(`${node.name}_grip_${side}`)
        if (g) grips[side] = inv.clone().multiply(g.matrixWorld)
      }
      this.props.push({ node, kind: x.prop, homeParent, homeLocal, gripLocal: toMatrix(x.grip), holder: null, grips, forced: null })
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
  hold(wants: Map<AgentRig, { kind: string; side: 'l' | 'r'; prefer?: string; attached?: boolean } | null>) {
    const taken = new Set<Prop>()
    for (const [rig, want] of wants) {
      if (!want) continue
      const p = this.pick(rig, want.kind, want.prefer)
      if (!p || taken.has(p)) continue
      p.holder = { rig, side: want.side, attached: want.attached ?? true }
      taken.add(p)
    }
    for (const p of this.props) if (!taken.has(p)) p.holder = null
  }

  /** the prop a rig would take for this kind (the one it holds, else a free one, preferring `prefer`) */
  info(rig: AgentRig, kind: string, prefer?: string): PropInfo | null {
    const p = this.pick(rig, kind, prefer)
    return p ? { node: p.node, kind: p.kind, grips: p.grips } : null
  }

  /** where a prop rests, in the world */
  homeWorld(node: Object3D, out = new Matrix4()): Matrix4 {
    const p = this.props.find((x) => x.node === node)
    if (!p) return out.copy(node.matrixWorld)
    p.homeParent.updateWorldMatrix(true, false)
    return out.multiplyMatrices(p.homeParent.matrixWorld, p.homeLocal)
  }

  /** the pose PlayStage wants for this prop this frame (null: leave it to the easing) */
  force(node: Object3D, pose: Matrix4 | null) {
    const p = this.props.find((x) => x.node === node)
    if (p) p.forced = pose ? (p.forced ?? new Matrix4()).copy(pose) : null
  }

  private m = new Matrix4()
  private pos = new Vector3()
  private quat = new Quaternion()
  private scl = new Vector3()

  /** props someone else moves right now (the paper plane in flight, plane.ts); update() leaves them alone */
  readonly borrowed = new Set<Object3D>()

  /** a prop node of this kind (the first), with its grip offset, for animations that move it themselves */
  find(kind: string): { node: Object3D; gripLocal: Matrix4 } | undefined {
    const p = this.props.find((x) => x.kind === kind)
    return p && { node: p.node, gripLocal: p.gripLocal }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-PROP_OMEGA * dt)
    for (const p of this.props) {
      if (this.borrowed.has(p.node)) continue
      if (p.forced && p.holder) {
        // a pose decided elsewhere (the hand was placed from it, grip.ts): exactly, with no easing
        p.forced.decompose(p.node.position, p.node.quaternion, this.scl)
        p.node.visible = p.holder.rig.visible
        continue
      }
      const grip = p.holder?.attached ? p.holder.rig.parts.hands[p.holder.side].grip : undefined
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
      // a go stone that has been placed is back on its bowl at once (the next one of the pile): nothing flies home
      if (!grip && p.kind === 'piece') {
        p.node.position.copy(this.pos)
        p.node.quaternion.copy(this.quat)
        p.node.visible = !p.holder || !p.holder.attached || p.holder.rig.visible
        continue
      }
      p.node.position.lerp(this.pos, k)
      p.node.quaternion.slerp(this.quat, k)
      p.node.visible = !p.holder || !p.holder.attached || p.holder.rig.visible
    }
  }
}

// ------------------------------------------------------------------ hand poses

interface HandPose {
  pos: Vector3
  /** extra rotation in the root's frame, applied before the rest rotation */
  turn: Quaternion
  /** how the fingers bend: joint angles (a named pose of handPose.ts) or an old curl */
  curl: PoseSpec
}

/**
 * An old hand shape (agents.md 2.7, #134): one bend value c per finger, index … little (0 = straight, 1 = fully bent), and the thumb's
 * bend and opposition. Callers that still hold one are converted with fromCurl (hand-poses.md 3) at the rig's edge.
 */
export interface HandShape {
  f: readonly [number, number, number, number]
  thumb: readonly [bend: number, oppose: number]
}
export type PoseSpec = HandShape | HandAngles
const isAngles = (p: PoseSpec): p is HandAngles => !Array.isArray((p as HandAngles).thumb)

type Four = [number, number, number, number]
const shape = (f: Four, thumb: [number, number]): HandShape => ({ f, thumb })

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const qz = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a)
const qy = (a: number) => new Quaternion().setFromAxisAngle(UP, a)
const NONE = new Quaternion()
/**
 * The hand's frame (#148, measured in Blender and in the app): at rest the palms face each other, the right palm toward
 * the agent's −x and the left toward +x, thumbs up. Palm down is a roll about the agent's forward axis: the right hand
 * +90° about +z, the left −90°. (#178: the sign was the other way round for the old glove hand and turned the new
 * hand's palms up, back of the hand on the keyboard.)
 */
export const REST_PALM: Record<'l' | 'r', readonly [number, number, number]> = { r: [-1, 0, 0], l: [1, 0, 0] }
export const palmDown = (side: 'l' | 'r') => qz(((side === 'l' ? -1 : 1) * Math.PI) / 2)
/** the shapes of agents.md 2.7 as the named poses of hand-poses.md 2 (#282) */
const REST_POSE = POSES.rest
const TYPE_POSE = POSES.type
const HOLD_POSE = POSES.wrap
/** the index and thumb tips meet (#62): the 끝 집기 (OK) pose, the other three fingers stretched and fanned (designer, #154) */
const PINCH_POSE = POSES.ok
const POINT_POSE = POSES.point
const WAVE_POSE = POSES.spread
const FRAME_POSE = VARIANTS.frame
const STAMP_POSE = VARIANTS.stamp
const YIELD_POSE = POSES.sweep
/** a hand holding a pen to write: the three pen fingers closed, the other two loose (wrap-up, #186): 세 손가락 집기 */
const PEN_POSE = POSES.tripod
/** seated, a gesturing hand stays at or above the desk top + 5 cm (root frame, same as the desk poses ~0.82; #226 ④) */
const DESK_HAND_MIN = 0.79
/** a loose hand (sofa, reading, the board-game hand at rest): between rest and hold, still an old curl converted by hand-poses.md 3 */
const LOOSE_POSE = shape([0.45, 0.5, 0.55, 0.6], [0.3, 0.2])
/** typing (agents.md 2.7): on top of 타자, each finger alternates (MCP +12.75°, PIP +15° = the old c 0.35 ↔ 0.5) four times a second, out of step with its neighbours. A real key press (MCP +12 · PIP +8) is a later issue */
function typing(t: number, side: 'l' | 'r', phase: number): HandAngles {
  const o = side === 'l' ? 0 : Math.PI / 4
  const f = TYPE_POSE.f.map((a, k) => {
    const w = 0.5 + 0.5 * Math.sin(t * Math.PI * 8 + phase + o + k * Math.PI * 0.5)
    return { ...a, mcp: a.mcp + 12.75 * w, pip: a.pip + 15 * w }
  }) as unknown as HandAngles['f']
  return { f, thumb: TYPE_POSE.thumb }
}
/** how far the hand holding a caught plane moves out from the head's centre line, m (designer, #62) */
const CAUGHT_OUT = 0.055
/** named hand poses, for anything that holds something (the plane's catch; later 휴's dropper, 메시's vertex pick) */
export const HAND_POSES = {
  rest: REST_POSE,
  type: TYPE_POSE,
  hold: HOLD_POSE,
  pinch: PINCH_POSE,
  point: POINT_POSE,
  wave: WAVE_POSE,
  frame: FRAME_POSE,
  stamp: STAMP_POSE,
  yield: YIELD_POSE,
} as const satisfies Record<string, HandAngles>
/** the old curls still in this file (for the clip audit, hand-poses.md 3) */
export const RIG_CURLS = { LOOSE: LOOSE_POSE } as const satisfies Record<string, HandShape>
/** how long the paper plane's gestures last, seconds (#51) */
export const GESTURE_S = { throw: 0.7, catch: 1.6 }

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
  /** walking pace scale (the replay walks faster) */
  pace = 1
  /** the traffic planner (traffic.ts) moves this rig: its trajectory sample for this frame; when set, nothing here integrates */
  track: Sample | null = null
  traffic = false
  private turnVel = 0
  private lift = 0
  private seat = 0
  private surface = 0
  /** 0 → 1 while dozing (#110): lowers the head, dims the beam */
  private dozing = 0
  private look = { pitch: 0, yaw: 0, roll: 0 }
  /** the current bends per hand (eased toward the pose's shape): four fingers, then the thumb's bend and opposition */
  private curls: Record<'l' | 'r', number[]> = { l: toVec(REST_POSE), r: toVec(REST_POSE) }
  /** a pose forced from outside (the ?debug=1 hook __office.hand.pose), per hand */
  private forced: Record<'l' | 'r', HandAngles | null> = { l: null, r: null }
  /** how long each hand has been at rest (no drive, nothing to do), s: the idle finger drift starts after a while */
  private restFor: Record<'l' | 'r', number> = { l: 0, r: 0 }
  /** idle drift of each finger, degrees on MCP and PIP (index … little) */
  private drift: Record<'l' | 'r', number[]> = { l: [0, 0, 0, 0], r: [0, 0, 0, 0] }
  /** the grip weight of each hand over the last moments (the fingers close one after another) */
  private wcHist: Record<'l' | 'r', { t: number; w: number }[]> = { l: [], r: [] }
  private wcClosing: Record<'l' | 'r', boolean> = { l: true, r: true }
  private clockT = 0
  private reducedNow = false
  private spin = { orbit: 0, ring: 0 }
  /** echo's fork: how hard it rings now (0..1), decays over ~0.4 s after the sound stops */
  private forkAmp = 0
  private blinkAt = 0
  /** what it is holding this frame (read by the PropBank) */
  want: { kind: string; side: 'l' | 'r'; prefer?: string; attached?: boolean } | null = null
  /** the meeting reaction in progress (#141): when it started on the scene clock, whether a hand lifts with it; the key it answered last */
  private nod: { t0: number; hand: boolean } | null = null
  private nodKey = ''
  /** a received paper / plane (#267, paper-pass.md 4): the wide eyes of surprise until `until`, then a nod at `nodAt` */
  private paperFace: { until: number; nodAt: number | null } | null = null

  /**
   * What the receiver's face does when a paper or a plane reaches its hand (#267, paper-pass.md 4): 'surprise' (a plane, a
   * toss) = wide eyes for 1.2 s, then a nod while it looks; 'nod' (handed over, pushed) = a nod at once. Then the status face.
   */
  paperReaction(kind: 'surprise' | 'nod', t: number, reduced = false) {
    const surpriseS = Math.max(PAPER_SURPRISE_S, this.gestureMin)
    if (kind === 'surprise') this.paperFace = { until: t + surpriseS, nodAt: t + surpriseS }
    else this.paperFace = { until: t, nodAt: t }
    if (reduced) this.paperFace.nodAt = null // the nod is motion; the surprise face is information and stays
  }

  /** tests: whether the face shows the received-paper surprise now */
  surprisedAt(t: number): boolean {
    return !!this.paperFace && t < this.paperFace.until
  }
  /** a point to turn the head to while resting (the coder's rubber duck when a test fails, #44) */
  watch: Vector3 | null = null
  /** grips and play (PlayStage): what each hand is made to do this frame (null = just its pose) */
  drive: Record<'l' | 'r', HandDrive | null> = { l: null, r: null }
  private spring: Record<'l' | 'r', { pos: Vector3; quat: Quaternion } | null> = { l: null, r: null }
  /** a small extra head turn while playing (the omok thinker's 5° tilt, 10° toward the last stone); rad */
  headExtra = { pitch: 0, yaw: 0, roll: 0 }
  /** a point the head glances at, up to `glanceMax` rad of yaw (the opponent's last stone) */
  glance: { at: Vector3; max: number } | null = null
  /** a short reaction on top of the hand pose: the winner's fist, the loser's three claps (play.md 2.5) */
  reaction: { kind: 'fist' | 'clap'; t0: number; dur: number } | null = null
  /** the left hand at the chin, its fingers drumming (the omok thinker 메시) */
  chin = false
  /** the timelapse at x16 (#158, timelapse.md): a gesture lasts at least this long on the scene clock (s; 0 = as designed) ... */
  gestureMin = 0
  /** where to draw the body when it is not where the plan puts it (the timelapse caps the screen speed); x, z stay the plan's */
  drawAt: { x: number; z: number } | null = null
  /** ... and the repeating ambient motion (bob, sway, typing flutter) is scaled by this (1 = on, 0 = off) */
  ambient = 1
  private cueMem: { kind: NonNullable<Sample['cue']>['kind']; dur: number; gesture: boolean; toward: { x: number; z: number } | null; startT: number } | null = null
  private cueT = 0
  /** a short gesture set by the paper plane (#51): until = the scene clock time it ends */
  gesture: { kind: 'throw' | 'catch'; until: number; oneHand?: boolean; caught?: boolean; t0?: number; at?: Vector3; plan?: Plan } | null = null
  /** this frame's look-and-turn of a gesture (aim.ts); null without one */
  aim: AimPose | null = null
  private stance = { seated: false, still: true }
  private aimPitch = 0

  /**
   * Begin a throw or a catch (#224): look at `at` (a point the caller keeps moving, e.g. the plane), turn as aim.ts says.
   * Returns the gesture; `until` is when everything is back at the desk.
   */
  startGesture(kind: 'throw' | 'catch', t: number, at: Vector3, o: { reduced?: boolean; flyFor?: number; holdS?: number; oneHand?: boolean } = {}) {
    const theta = Math.hypot(at.x - this.x, at.z - this.z) > 0.05 ? wrap(Math.atan2(-(at.x - this.x), -(at.z - this.z)) - this.heading) : 0
    const plan = planGesture(kind, theta, {
      seated: this.stance.seated,
      reduced: !!o.reduced,
      fast: this.gestureMin > 0 && this.ambient === 0,
      minTurn: this.gestureMin,
      bodyOk: this.stance.still,
      flyFor: o.flyFor,
      holdS: o.holdS,
    })
    return (this.gesture = { kind, until: t + plan.times.end, oneHand: o.oneHand, t0: t, at, plan })
  }

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
    for (const node of [parts.ring, parts.ear, parts.grille]) node?.traverse((o) => {
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

  /** what it is doing where it stands (null while walking): the typing sound reads this (#194 ②) */
  get doing(): string | null {
    // throwing or catching a plane (#224): the hands have stopped typing, so the typing sound stops too
    if (this.gesturing) return null
    return this.goal && this.arrived === this.goal.spot ? this.goal.pose : null
  }
  /** it is free and at play: its goal is a play (pingpong, a board game, coffee, the sofa, watering, a book), also while it walks there; talks, meetings, dozing and work are not */
  get resting(): boolean {
    return !!this.goal && RESTING_POSES.has(this.goal.pose)
  }
  /** a throw / catch is under way this frame (set in update) */
  private gesturing = false

  /** the spot it has arrived at and stopped on, if any */
  get arrived(): string | null {
    if (this.traffic) return this.track ? this.track.arrived : this.at
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
    const avoid = goal.quiet ? DESK_SIDES : undefined
    if (this.at === EXIT) route = [EXIT, ...(shortestPath(g, 'door', target) ?? ['door'])]
    else if (this.at) route = shortestPath(g, this.at, target, avoid) ?? shortestPath(g, this.at, target)
    else route = (avoid && routeFromEdge(g, this, this.from!, this.path[0], target, avoid)) || routeFromEdge(g, this, this.from!, this.path[0], target) || [this.path[0]]
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
    if (this.traffic) {
      this.placed = true
      return
    }
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

  /** snap onto the goal's spot at once (replay seeks and fast speeds: no walking) */
  placeAt(goal: Goal, g: NavGraph) {
    this.goal = goal
    if (this.placed && this.path.length === 0 && this.at === goal.spot) return
    this.placed = true
    const p = this.point(g, goal.spot)
    this.at = goal.spot
    this.from = null
    this.path = []
    this.speed = 0
    this.x = p.x
    this.z = p.z
    this.heading = this.restHeading(g)
  }

  private restHeading(g: NavGraph, others?: Record<string, AgentRig>) {
    const goal = this.goal!
    if (goal.face) return Math.atan2(-(goal.face.x - this.x), -(goal.face.z - this.z))
    const look = goal.lookAt && others?.[goal.lookAt]
    if (look && goal.pose !== 'listen') return Math.atan2(-(look.x - this.x), -(look.z - this.z))
    return goal.slot?.ry ?? g.spots[goal.spot]?.ry ?? this.heading
  }

  update(dt: number, t: number, g: NavGraph, others: Record<string, AgentRig>, reduced: boolean, status?: AgentStatus) {
    if (!this.goal) return
    dt = Math.min(dt, 0.1)
    let wantHeading = this.heading
    let moving = false

    if (this.traffic) {
      const k = this.track
      if (k) {
        this.x = k.x
        this.z = k.z
        this.speed = k.speed
        this.at = k.arrived
        this.from = null
        this.path = []
        moving = k.moving
        if (k.moving && k.heading !== null) wantHeading = k.heading
        else if (k.arrived) wantHeading = this.restHeading(g, others)
      }
    } else if (this.path.length) {
      moving = true
      // slow down for the final stop and for sharp corners
      const next = this.point(g, this.path[0])
      const dx = next.x - this.x
      const dz = next.z - this.z
      const d = Math.hypot(dx, dz)
      let remaining = d
      for (let k = 1; k < this.path.length; k++) remaining += dist(this.point(g, this.path[k - 1]), this.point(g, this.path[k]))
      let cap = Math.min(SPEED * this.pace, Math.sqrt(2 * ACCEL * this.pace * remaining) + 0.04)
      if (this.path.length > 1 && d < 0.35) {
        const after = this.point(g, this.path[1])
        const turn = Math.abs(wrap(Math.atan2(-(after.x - next.x), -(after.z - next.z)) - Math.atan2(-dx, -dz)))
        if (turn > 0.8) cap = Math.min(cap, CORNER_SPEED * this.pace)
      }
      // a hover bot turns before it sets off when the new direction is behind it
      const headingTo = Math.atan2(-dx, -dz)
      if (d > 1e-4) wantHeading = headingTo
      const behind = Math.abs(wrap(headingTo - this.heading)) > 1.6 && this.speed < 0.1
      this.speed = behind ? 0 : Math.min(cap, this.speed + ACCEL * this.pace * dt)
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
    this.cueT = t
    const doze = resting && goal.pose === 'doze'
    this.dozing = damp(this.dozing, doze ? 1 : 0, 3, dt)
    // dozing breathes slowly (none with reduced motion) instead of the usual bob
    const dozeBob = -DOZE.lowerM + (reduced ? 0 : Math.sin(((t + this.phase) / DOZE.bobPeriodS) * Math.PI * 2) * DOZE.bobM)
    const bob = MathUtils.lerp(Math.sin(t * 2.1 + this.phase) * 0.015 * motion * this.ambient, dozeBob, this.dozing)

    this.stance.seated = resting && !!(seatKind && SURFACE[seatKind])
    this.stance.still = !moving
    // looking at what it throws to / catches (#224, aim.ts): the root turns on top of its heading (a rotation only: the
    // agent stays on its spot and the plan never sees it), the head and eyes lead
    const gz = this.gesture && t < this.gesture.until ? this.gesture : null
    this.gesturing = !!gz
    let aim: AimPose | null = null
    let gazeFrom = 0
    if (gz?.plan && gz.at && gz.t0 !== undefined) {
      const dx = gz.at.x - this.x
      const dz = gz.at.z - this.z
      const flat = Math.hypot(dx, dz)
      const raw = flat > 0.05 ? wrap(Math.atan2(-dx, -dz) - this.heading) : gz.plan.theta
      // near 180° the sign flips: stay on the side the gesture began on. A plane close by (in this agent's own hand)
      // has no steady direction from here: it is looked at along the way the gesture began, until it is 1.6 m off
      const near = MathUtils.smoothstep(flat, 0.6, 1.6)
      aim = aimPose(gz.plan, t - gz.t0, gz.plan.theta + wrap(raw - gz.plan.theta) * near)
      this.aimPitch = MathUtils.clamp(Math.atan2(gz.at.y - (this.parts.headRestY + this.seat), Math.max(flat, 0.3)), -0.5, 0.5)
      gazeFrom = aim.phase === 'done' ? 0 : 1
    }
    this.aim = gazeFrom ? aim : null
    const { root, head, beam } = this.parts
    root.visible = !this.hidden
    root.position.set(this.drawAt?.x ?? this.x, 0, this.drawAt?.z ?? this.z)
    root.rotation.set(0, this.heading + (this.aim?.body ?? 0), 0)
    root.updateMatrixWorld(true)

    // the head: lifts while moving, sits lower on seats, bobs, leans into turns and forward with speed
    const pose = resting ? goal.pose : moving ? 'move' : 'idle'
    const lookTarget = this.headLook(pose, t, reduced, others)
    lookTarget.pitch -= this.nodDip(goal, t, reduced)
    if (this.glance && pose !== 'move') {
      const dx = this.glance.at.x - this.x
      const dz = this.glance.at.z - this.z
      lookTarget.yaw += MathUtils.clamp(wrap(Math.atan2(-dx, -dz) - this.heading), -this.glance.max, this.glance.max)
    }
    lookTarget.pitch += this.headExtra.pitch
    lookTarget.yaw += this.headExtra.yaw
    lookTarget.roll += this.headExtra.roll
    if (this.aim) {
      // the schedule is already eased: the head follows it as it is
      this.look.pitch = this.aimPitch * this.aim.pitchW - this.aim.nod
      this.look.yaw = this.aim.head
      this.look.roll = damp(this.look.roll, 0, 6, dt)
    } else {
      this.look.pitch = damp(this.look.pitch, lookTarget.pitch, 6, dt)
      this.look.yaw = damp(this.look.yaw, lookTarget.yaw, 6, dt)
      this.look.roll = damp(this.look.roll, lookTarget.roll, 6, dt)
    }
    const lean = MathUtils.clamp(this.turnVel * 0.09, -0.22, 0.22) * motion
    const forward = Math.min(this.speed / (SPEED * this.pace), 1) * 0.12 * motion
    const dy = this.lift + this.seat + bob
    head.position.y = this.parts.headRestY + dy
    head.rotation.set(this.look.pitch - forward, this.look.yaw, this.look.roll + lean, 'YXZ')

    // the beam reaches from the head's underside down to the floor, or to the furniture it hovers over
    if (beam) {
      const top = BEAM_H + dy
      beam.position.y = top
      beam.scale.y = Math.max(0.02, (top - this.surface) / BEAM_H)
      beam.traverse((o) => {
        const m = (o as Mesh).isMesh ? ((o as Mesh).material as MeshBasicMaterial) : null
        if (m?.transparent) m.opacity = BEAM.opacity * (1 - this.dozing * (1 - DOZE.beamShare))
      })
    }
    // the pool of light on the floor: fainter and wider the higher the head floats (#54)
    const pool = this.parts.floor
    if (pool) {
      const up = MathUtils.clamp(dy, 0, 0.3) / 0.3
      pool.scale.setScalar(1 + up * 0.35)
      ;(pool.material as MeshBasicMaterial).opacity = FLOOR_POOL.opacity * (1 - up * 0.45)
    }

    this.updateHands(dt, t, pose, reduced, others)
    this.updateCards(goal.carry ?? 0, goal.pose === 'write')
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

  /** a goal's gesture starts once per new key; the head dips NOD_DEG over NOD_S (rad now; 0 when still or with reduced motion) */
  private nodDip(goal: Goal, t: number, reduced: boolean): number {
    const g = goal.gesture
    if (g && g.key !== this.nodKey) {
      this.nodKey = g.key
      this.nod = reduced ? null : { t0: t, hand: g.hand }
    }
    const n = this.nod
    const nodS = Math.max(NOD_S, this.gestureMin)
    if (!n || reduced || t - n.t0 > nodS) return 0
    return Math.sin(((t - n.t0) / nodS) * Math.PI) * NOD_DEG * (Math.PI / 180)
  }

  /**
   * The yield / pass cue to draw. In the timelapse (gestureMin > 0) a cue shorter than gestureMin is played slower, and
   * kept after the planner has dropped it, so it still shows for gestureMin of scene time.
   */
  private cue(): NonNullable<Sample['cue']> | null {
    const live = this.track?.cue ?? null
    if (this.gestureMin <= 0) return live
    const t = this.cueT
    if (live) {
      if (!this.cueMem || this.cueMem.kind !== live.kind || t - this.cueMem.startT > Math.max(live.dur, this.gestureMin) * 1.01 + 1e-6 || live.age < 0.06)
        this.cueMem = { kind: live.kind, dur: live.dur, gesture: live.gesture, toward: live.toward, startT: t - live.age }
      else if (live.toward) this.cueMem.toward = live.toward
    }
    const m = this.cueMem
    if (!m) return null
    const s = Math.max(1, this.gestureMin / m.dur)
    const el = t - m.startT
    if (el >= m.dur * s) {
      if (!live) this.cueMem = null
      return null
    }
    return { kind: m.kind, age: el / s, dur: m.dur, gesture: m.gesture, toward: m.toward }
  }

  /** the angle from the body's heading to the other agent of the current yield / pass cue (positive = to the left) */
  private cueRel(): number {
    const c = this.cue()
    if (!c?.toward) return 0
    return wrap(Math.atan2(-(c.toward.x - this.x), -(c.toward.z - this.z)) - this.heading)
  }

  /** the designer's yield gestures (agents.md 2.8) as head motion; none with reduced motion (the step aside is the gesture) */
  private cueLook(reduced: boolean): { pitch: number; yaw: number; roll: number } | null {
    const c = this.cue()
    if (!c || reduced) return null
    const C = TRAFFIC.cue
    const D = Math.PI / 180
    const rel = this.cueRel()
    const clampDeg = (deg: number) => MathUtils.clamp(rel, -deg * D, deg * D)
    const env = MathUtils.clamp(c.age / 0.15, 0, 1) * MathUtils.clamp((c.dur - c.age) / 0.15, 0, 1)
    const arc = Math.sin(MathUtils.clamp(c.age / c.dur, 0, 1) * Math.PI)
    switch (c.kind) {
      case 'yield': {
        const k = MathUtils.clamp((c.age - C.nodFromS) / (C.nodToS - C.nodFromS), 0, 1)
        const turn = MathUtils.clamp(c.age / C.stepAsideS, 0, 1)
        return { pitch: c.gesture ? -Math.sin(k * Math.PI) * C.nodDeg * D : 0, yaw: clampDeg(C.yieldHeadDeg) * turn * env, roll: 0 }
      }
      case 'pass':
        return { pitch: -arc * C.nodDeg * D, yaw: clampDeg(C.passHeadDeg) * arc, roll: 0 }
      case 'wide':
        return { pitch: 0, yaw: clampDeg(C.wideHeadDeg) * arc, roll: 0 }
      case 'tilt':
        return { pitch: 0, yaw: 0, roll: C.tiltDeg * D * arc }
      case 'dest':
        return { pitch: 0, yaw: clampDeg(40) * MathUtils.clamp(c.age / 0.3, 0, 1), roll: 0 }
    }
  }

  private headLook(pose: string, t: number, reduced: boolean, others: Record<string, AgentRig>) {
    const cue = this.cueLook(reduced)
    if (cue) return cue
    const m = reduced ? 0.3 : this.ambient
    const s = (f: number, o = 0) => Math.sin(t * f + this.phase + o) * m
    const idle = { pitch: 0, yaw: reduced ? 0 : s(0.35) * 0.25, roll: 0 }
    // looking at something on the desk (the duck): turn toward it and look down at it
    if (this.watch && pose !== 'move') {
      const dx = this.watch.x - this.x
      const dz = this.watch.z - this.z
      const yaw = MathUtils.clamp(wrap(Math.atan2(-dx, -dz) - this.heading), -1.2, 1.2)
      const pitch = MathUtils.clamp(Math.atan2(this.watch.y - (this.parts.headRestY + this.seat), Math.hypot(dx, dz)), -0.6, 0.3)
      return { pitch, yaw, roll: 0.08 } // a small tilt: puzzled
    }
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
      case 'talk': {
        // the head alone turns to the one it listens to / speaks to (#141); the body keeps the circle's direction
        const o = this.goal?.gaze ? others[this.goal.gaze] : undefined
        const yaw = o ? MathUtils.clamp(wrap(Math.atan2(-(o.x - this.x), -(o.z - this.z)) - this.heading), -1.1, 1.1) : 0
        return { pitch: 0.04 + s(5) * 0.04, yaw, roll: 0 }
      }
      case 'post':
        return { pitch: 0.2, yaw: 0, roll: 0 }
      // the wrap-up (#186, wrap.ts): writing nods 2° every 0.6 s, re-reading turns the head ±3° (2 s loop), carrying looks at
      // the board and then at the poster while it waits, posting looks at the card after the last one, tidying leans back 3°
      case 'write': {
        const nod = this.goal?.reread ? 0 : Math.max(0, Math.sin((t / 0.6) * Math.PI * 2)) * 0.035
        return { pitch: -0.14 + nod, yaw: this.goal?.reread ? Math.sin(t * Math.PI) * 0.052 : 0, roll: 0 }
      }
      case 'carry':
        return { pitch: 0.04, yaw: this.goal?.waiting ? (Math.floor(t / 2) % 2 === 0 ? 0 : 0.5) : 0, roll: 0 }
      case 'cardpost': {
        const b = this.goal?.beat
        return { pitch: b?.kind === 'look' ? 0.12 + Math.sin(b.u * Math.PI) * 0.035 : 0.06, yaw: 0, roll: 0 }
      }
      case 'tidy': {
        const b = this.goal?.beat
        return { pitch: b?.kind === 'lean' ? -0.03 - Math.sin(b.u * Math.PI) * 0.05 : -0.1, yaw: 0, roll: 0 }
      }
      case 'boardgame':
        return { pitch: -0.35, yaw: s(0.5) * 0.15, roll: 0 }
      case 'sofa':
        return { pitch: -0.22, yaw: 0, roll: 0.28 }
      case 'doze':
        return { pitch: -DOZE.tiltRad, yaw: 0, roll: 0 }
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

  /** the wrap-up's stack of cards (#186): a thin card box on the left palm, one card thicker per card; hidden without a stack */
  private cards: Mesh | null = null
  private updateCards(count: number, flat: boolean) {
    const hand = this.parts.hands.l
    if (!this.cards) {
      if (count <= 0) return
      // the palm's normal and the finger direction in the hand's own frame (the palm faces +x of the agent at rest)
      const n = new Vector3(...REST_PALM.l).applyQuaternion(hand.restQuat.clone().invert()).normalize()
      const knuckle = hand.fingers[1][0]?.node.position ?? new Vector3(0, 0.08, 0)
      const f = knuckle.clone().addScaledVector(n, -knuckle.dot(n)).normalize()
      const x = new Vector3().crossVectors(n, f)
      const m = new Mesh(new BoxGeometry(0.075, 0.004, 0.095), new MeshBasicMaterial({ color: '#f3ead8' }))
      m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, n, f))
      m.userData.base = f.clone().multiplyScalar(Math.max(0.045, knuckle.length() * 0.8))
      m.userData.n = n
      hand.node.add(m)
      this.cards = m
    }
    const m = this.cards
    m.visible = count > 0 && this.parts.root.visible
    if (!m.visible) return
    const n = m.userData.n as Vector3
    m.scale.y = Math.max(1, count)
    m.position.copy(m.userData.base as Vector3).addScaledVector(n, 0.012 + 0.002 * count + (flat ? 0.004 : 0))
  }

  /**
   * a hand's target for the plane gesture (#224, aim.ts): the throwing hand rises to shoulder height pointing at the receiver, holds,
   * strokes forward and lowers; the catching hand rises toward the plane, reaching sideways when the body and head can't turn
   * that far, palm open, pinching once it is caught. The other hand stops what it was doing.
   */
  private handPose(side: 'l' | 'r', pose: string, t: number, reduced: boolean): HandPose {
    const g = this.gesture
    const a = this.aim
    if (!g?.plan || !a || reduced) return this.basePose(side, pose, t, reduced)
    const sx = side === 'l' ? -1 : 1
    const sit = this.seat
    const rest = this.parts.hands[side].restPos
    // once caught only the pinching (right) hand holds it; the other one rests (paper-pass.md 5, #273)
    const gesturing = g.kind === 'throw' ? side === 'r' : g.caught ? side === 'r' : side === 'r' || !g.oneHand
    // seated at a desk the hands never go below the desk top + 5 cm (designer, #226 ④): the throw's follow-through stops there
    const floor = this.stance.seated ? DESK_HAND_MIN : -Infinity
    const lift = (p: Vector3) => ((p.y = Math.max(p.y, floor)), p)
    if (!gesturing) return { pos: lift(v(rest.x, rest.y, rest.z)), turn: NONE, curl: REST_POSE }
    const base = a.arm < 1 ? this.basePose(side, pose, t, reduced) : null
    const sin = Math.sin(a.handAngle)
    const cos = Math.cos(a.handAngle)
    let target: Vector3
    let curl: PoseSpec = REST_POSE
    if (g.kind === 'throw') {
      // from the shoulder, along the way to the receiver; the stroke carries it forward
      const R = 0.38 + 0.28 * a.stroke
      target = v(-sin * R + sx * 0.12 * cos, 1.0 + sit + 0.06 * a.stroke, -cos * R - sx * 0.12 * sin)
      curl = a.phase === 'follow' || a.phase === 'back' ? REST_POSE : HOLD_POSE
    } else {
      // the usual catching place in front, drifting to the plane's side as the angle grows
      const caught = side === 'r' && g.caught
      if (caught) {
        // looking at what was caught (paper-pass.md 5, #273): in front of the face screen and below it, so neither the hand
        // nor the plane covers the screen: 0.22 ahead, 0.10 down, 0.06 to the holding hand's side, in the head's frame
        const head = this.parts.head.position
        const yaw = a.head
        const ox = sx * LOOK_AT.side
        const oz = -LOOK_AT.ahead
        target = v(head.x + ox * Math.cos(yaw) + oz * Math.sin(yaw), head.y - LOOK_AT.down, head.z - ox * Math.sin(yaw) + oz * Math.cos(yaw))
        curl = PINCH_POSE
      } else {
        // the usual catching place in front, drifting to the plane's side as the angle grows
        const front = v(sx * 0.16, 1.32 + sit, -0.32)
        // (the hands flank the line to the plane)
        const off = sx * 0.12
        const out = v(-sin * 0.42 + off * cos, 1.3 + sit, -cos * 0.42 - off * sin)
        target = front.lerp(out, MathUtils.clamp(Math.abs(a.handAngle) / 0.5, 0, 1))
        curl = WAVE_POSE
      }
    }
    if (!base) return { pos: lift(target), turn: NONE, curl }
    return { pos: lift(base.pos.clone().lerp(target, a.arm)), turn: a.arm > 0.3 ? NONE : base.turn, curl: a.arm > 0.3 ? curl : base.curl }
  }

  /** each hand's target in the root's frame for this pose */
  private basePose(side: 'l' | 'r', pose: string, t: number, reduced: boolean): HandPose {
    const m = reduced ? 0.3 : this.ambient
    const s = (f: number, o = 0) => Math.sin(t * f + this.phase + o) * m
    const sx = side === 'l' ? -1 : 1
    const rest = this.parts.hands[side].restPos
    const down = palmDown(side)
    const at = (x: number, y: number, z: number, turn = NONE, curl: PoseSpec = REST_POSE): HandPose => ({ pos: v(x, y, z), turn, curl })
    const sit = this.seat
    // a moment's gesture on top of whatever the agent does (#51): throw the plane, raise a hand to catch it
    const g = this.gesture && !this.gesture.plan && t < this.gesture.until ? this.gesture : null
    if (g?.kind === 'throw' && side === 'r') {
      const k = MathUtils.clamp(1 - (g.until - t) / GESTURE_S.throw, 0, 1) // 0 → 1 over the gesture
      return at(0.2, 1.05 + sit + Math.sin(k * Math.PI) * 0.2, -0.15 - k * 0.35, NONE, HOLD_POSE)
    }
    if (g?.kind === 'catch' && (side === 'r' || !g.oneHand)) {
      // once caught, the pinching hand moves out a little so it doesn't cover the face screen (its reaction shows)
      const caught = side === 'r' && g.caught
      return at(sx * (0.16 + (caught ? CAUGHT_OUT : 0)), 1.32 + sit, -0.32, NONE, caught ? PINCH_POSE : WAVE_POSE)
    }
    // the yield gesture: the hand on the passer's side opens palm up in front and sweeps toward them ("after you")
    const cue = this.cue()
    if (cue && !reduced) {
      const C = TRAFFIC.cue
      if (cue.kind === 'yield' && cue.gesture && cue.age >= C.nodFromS && cue.age < C.followFromS && side === (this.cueRel() > 0 ? 'l' : 'r')) {
        const k = (cue.age - C.nodFromS) / (C.followFromS - C.nodFromS)
        const sweep = Math.sin(k * Math.PI * 0.5 + 0.0) * C.handSweepM * (k < 0.7 ? k / 0.7 : 1)
        return at(sx * (0.2 + sweep), 1.0 + sit, -0.15 - C.handForwardM, NONE, YIELD_POSE)
      }
      if (cue.kind === 'dest' && side === 'r') {
        // a small impatient tap every 1.5 s: the fingers in turn, index to little, 0.1 s each (agents.md 2.8)
        const ph = (cue.age % C.destTapEveryS) / 0.1
        const f = REST_POSE.f.map((a, k) => {
          const c = ph >= k && ph < k + 1 ? Math.sin((ph - k) * Math.PI) * C.destTapCurl : 0
          return { ...a, mcp: a.mcp + 85 * c, pip: a.pip + 100 * c }
        }) as unknown as HandAngles['f']
        return at(rest.x, rest.y + 0.02, rest.z + 0.1, NONE, { f, thumb: REST_POSE.thumb })
      }
    }
    // the addressee's small reaction: the left hand lifts a few cm, its curl as at rest (#141)
    if (this.nod?.hand && !reduced && side === 'l' && t - this.nod.t0 < Math.max(NOD_HAND_S, this.gestureMin)) return at(rest.x, rest.y + 0.07, rest.z + 0.1)
    const rx = this.reaction
    if (rx && !reduced && t - rx.t0 >= 0 && t - rx.t0 < rx.dur) {
      const u = (t - rx.t0) / rx.dur
      // the winner's small fist, raised a little and let go; the loser's three claps, the hands meeting in front (play.md 2.5)
      if (rx.kind === 'fist' && side === 'r') return at(0.16, 1.0 + sit + Math.sin(u * Math.PI) * 0.05, -0.3, NONE, POSES.fist)
      if (rx.kind === 'clap') {
        const k = 0.5 + 0.5 * Math.cos(u * 3 * Math.PI * 2)
        return at(sx * (0.012 + 0.07 * k), 1.0 + sit, -0.3, NONE, WAVE_POSE)
      }
    }
    if (this.chin && side === 'l' && pose === 'boardgame') {
      // the hand under the chin, the fingers drumming in turn
      const f = [0, 1, 2, 3].map((k) => 0.45 + 0.2 * Math.max(0, Math.sin(t * Math.PI * 6 - k * 0.9))) as Four
      return at(-0.07, this.parts.head.position.y - 0.17, -0.12, qz(0.5), shape(f, [0.4, 0.3]))
    }
    // the wrap-up (#186): the stack of cards in the left hand, palm up at chest height (rest of the pose below is for the other hand)
    const wg = this.goal
    if (side === 'l' && wg?.carry && pose !== 'write' && pose !== 'tidy') return at(-0.13, 1.0 + sit, -0.3, down.clone().invert(), STAMP_POSE)
    const wb = wg?.beat
    const stroke = m * (wg?.reread ? 0.35 : 1)
    switch (pose) {
      case 'write':
        // the right hand writes (small strokes, the wrist moves within 2 cm), the left presses the card flat and pushes it to the stack
        return side === 'l'
          ? at(-0.13 - (wb?.kind === 'push' ? Math.sin(wb.u * Math.PI) * 0.1 : 0), 0.82, -0.42, down, STAMP_POSE)
          : at(0.14 + 0.012 * Math.sin(t * 9) * stroke, 0.83, -0.41 + 0.01 * Math.sin(t * 6.5 + 1) * stroke, down, PEN_POSE)
      case 'carry': {
        // the free hand (designer, #217): at the resting height 0.86 m, not hanging below the desk; it swings ±8 cm back and
        // forth with the walk (a stride a second), still when standing by the board
        // reduced motion: no swing at all (agents.md 2.5)
        const walk = reduced ? 0 : MathUtils.clamp(this.speed / 0.5, 0, 1) * m
        return at(rest.x, 0.86 + sit, rest.z - 0.08 * walk * Math.sin(t * Math.PI * 2 + this.phase))
      }
      case 'cardpost': {
        if (side === 'l') return at(rest.x, rest.y, rest.z)
        const u = wb?.u ?? 0
        const stack = v(-0.06, 1.04 + sit, -0.3)
        const cell = v(0.1, 1.34 + sit, -0.6)
        const lerp3 = (a: Vector3, b: Vector3, k: number) => a.clone().lerp(b, k)
        const from = v(rest.x, rest.y, rest.z)
        switch (wb?.kind) {
          case 'pick':
            return { pos: lerp3(from, stack, u), turn: NONE, curl: PINCH_POSE }
          case 'place':
            return { pos: lerp3(stack, cell, u), turn: NONE, curl: PINCH_POSE }
          case 'press':
            return { pos: cell.clone().add(v(0, 0, -0.02 * Math.sin(u * Math.PI))), turn: NONE, curl: STAMP_POSE }
          case 'release':
            return { pos: lerp3(cell, stack, u), turn: NONE, curl: REST_POSE }
          case 'gap':
            return { pos: stack, turn: NONE, curl: REST_POSE }
          default:
            return at(rest.x, rest.y, rest.z)
        }
      }
      case 'tidy': {
        // gather the papers, tap them twice (palms facing each other), push the keyboard in with the right hand, lean back
        const u = wb?.u ?? 0
        if (wb?.kind === 'tap') return at(sx * 0.06, 0.84 + Math.sin(u * Math.PI) * 0.05, -0.42, NONE, STAMP_POSE)
        if (wb?.kind === 'keys') return side === 'r' ? at(0.1, 0.81, -0.42 - Math.sin(u * Math.PI) * 0.05, down, STAMP_POSE) : at(-0.13, 0.81, -0.42, down, STAMP_POSE)
        if (wb?.kind === 'lean') return at(sx * 0.13, 0.81, -0.42, down, STAMP_POSE)
        return at(sx * 0.1, 0.82, -0.42, down, STAMP_POSE)
      }
      case 'move':
        return at(rest.x, rest.y - 0.03, rest.z + 0.08)
      case 'type':
      case 'listen':
        // the fingers type now (#134), not the whole hand: it rests on the keys
        return at(sx * 0.13, 0.81, -0.42, down, pose === 'type' && !reduced && this.ambient > 0 ? typing(t, side, this.phase) : TYPE_POSE)
      case 'talk':
        return at(sx * 0.24, 0.98 + sit + s(3, sx) * 0.05, -0.28, qy(-sx * 0.3), side === 'r' ? POINT_POSE : REST_POSE)
      case 'post':
        return side === 'r' ? at(0.12, 1.42 + s(2.5) * 0.03, -0.32, qz(0.4), HOLD_POSE) : at(rest.x, rest.y, rest.z)
      case 'pingpong':
        return side === 'r'
          ? at(0.26 + s(5.5) * 0.12, 0.92, -0.3 - Math.cos(t * 5.5 + this.phase) * 0.1 * m, qy(s(5.5) * 0.6), HOLD_POSE)
          : at(-0.24, 0.88, -0.12)
      case 'boardgame': {
        const reach = Math.max(0, s(1.4)) ** 4
        return side === 'r'
          ? at(0.1 - reach * 0.06, 0.84 + reach * 0.04, -0.34 - reach * 0.12, down, HOLD_POSE)
          : at(-0.16, 0.8, -0.3, down, LOOSE_POSE)
      }
      case 'coffee':
        return side === 'l'
          ? at(-0.1, 1.02 + sit + Math.max(0, s(0.8)) * 0.08, -0.22 - Math.max(0, s(0.8)) * 0.06, NONE, HOLD_POSE)
          : at(rest.x, rest.y, rest.z)
      case 'doze':
        // both palms flat on the desk either side of the keyboard
        return at(sx * DOZE.hands.x, SURFACE.work + DOZE.hands.aboveDeskM, DOZE.hands.z, down, STAMP_POSE)
      case 'sofa':
        return at(sx * 0.22, 0.62, -0.08, down, LOOSE_POSE)
      case 'water':
        return side === 'r' ? at(0.16, 0.86 + s(1.2) * 0.02, -0.42, NONE, HOLD_POSE) : at(rest.x, rest.y, rest.z)
      case 'books':
        return side === 'r' ? at(0.14, 1.3 + Math.max(0, s(0.6)) * 0.12, -0.4, qz(0.3), LOOSE_POSE) : at(rest.x, rest.y, rest.z)
      default:
        return at(rest.x, rest.y + s(1.1, sx) * 0.01, rest.z)
    }
  }

  /** put these joint angles on a hand right now, through the rig's own finger path (limits, then the joint math): the measuring tool (pnpm hand:measure) */
  poseNow(side: 'l' | 'r', angles: HandAngles) {
    this.setFingers(side, toVec(angles))
    this.parts.hands[side].node.updateWorldMatrix(true, true)
  }

  /** force a named pose on one hand (null = let go): the debug hook __office.hand.pose */
  forcePose(side: 'l' | 'r', pose: AnyPoseId | null) {
    this.forced[side] = pose ? ALL_POSES[pose] : null
  }

  /** where a hand's index and thumb tips meet, in world space (the hand itself if it has no tips) */
  pinchPoint(side: 'l' | 'r', out = new Vector3()) {
    const h = this.parts.hands[side]
    const index = h.fingers[0][2]?.node
    const thumb = h.thumb[2]?.node
    if (!index || !thumb || !h.indexTip || !h.thumbTip) return h.node.getWorldPosition(out)
    h.node.updateWorldMatrix(true, true)
    out.copy(h.indexTip).applyMatrix4(index.matrixWorld)
    return out.add(this.tmpTip.copy(h.thumbTip).applyMatrix4(thumb.matrixWorld)).multiplyScalar(0.5)
  }

  /** where a hand's fingers point, flattened to the floor (the way the agent faces if they point straight up / down) */
  fingerDir(side: 'l' | 'r', out = new Vector3()) {
    const h = this.parts.hands[side]
    out.set(0, 1, 0).applyQuaternion(h.node.getWorldQuaternion(this.tmpQuat2))
    out.y = 0
    if (out.lengthSq() < 0.1) this.parts.root.getWorldDirection(out).negate().setY(0) // the agent faces its −z
    return out.normalize()
  }

  private tmpTip = new Vector3()
  private tmpQuat2 = new Quaternion()
  private tmpPos = new Vector3()
  private tmpScl = new Vector3()
  private tmpQuat = new Quaternion()
  private rootQuat = new Quaternion()

  private updateHands(dt: number, t: number, pose: string, reduced: boolean, _others: Record<string, AgentRig>) {
    const { root } = this.parts
    root.getWorldQuaternion(this.rootQuat)
    const k = 1 - Math.exp(-HAND_OMEGA * dt)
    for (const side of ['l', 'r'] as const) {
      const hand = this.parts.hands[side]
      const p = this.handPose(side, pose, t, reduced)
      if (this.forced[side]) p.curl = this.forced[side]!
      const sp = this.spring[side]
      if (sp) {
        // the spring state under last frame's drive
        hand.node.position.copy(sp.pos)
        hand.node.quaternion.copy(sp.quat)
        this.spring[side] = null
      }
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
      // blend the joint angles over ~120 ms (agents.md 2.7); at once with reduced motion
      const c = this.curls[side]
      const want = toVec(this.anglesOf(side, p.curl))
      for (let k = 0; k < c.length; k++) c[k] = reduced || this.snapHands ? want[k] : damp(c[k], want[k], FINGER_RATE, dt)
      this.clockT = t
      this.reducedNow = reduced
      this.idleDrift(side, p.curl === REST_POSE && !this.forced[side], t, dt, reduced)
      this.setFingers(side, c, this.drift[side])
    }
    this.snapHands = false
  }
  private snapHands = true

  /** a pose as angles for this hand: angles as they are, an old curl converted by hand-poses.md 3 (keeping the fan this hand's mesh bakes in) */
  private anglesOf(side: 'l' | 'r', pose: PoseSpec): HandAngles {
    return isAngles(pose) ? pose : fromCurl([...pose.f, ...pose.thumb], undefined, this.fanOf(side))
  }
  /** an old curl (six numbers) as this hand's 20 joint angles (handPose.toVec), keeping the fan its mesh bakes in */
  curlVec(side: 'l' | 'r', curl: readonly number[]): number[] {
    return toVec(fromCurl(curl, undefined, this.fanOf(side)))
  }
  fanOf(side: 'l' | 'r'): number[] {
    return this.parts.hands[side].fingers.map((c, f) => c[0]?.restAbd ?? DEFAULT_FAN[f])
  }

  /**
   * At rest for a while each finger drifts on its own, ±3° with a 4–7 s period, seeded by agent and finger (deterministic); off under
   * reduced motion, and while the hand does anything else (hand-poses.md 2).
   */
  private idleDrift(side: 'l' | 'r', idle: boolean, t: number, dt: number, reduced: boolean) {
    const hand = this.parts.hands[side]
    this.restFor[side] = idle && !this.drive[side] ? this.restFor[side] + dt : 0
    const w = reduced ? 0 : MathUtils.clamp(this.restFor[side] - IDLE_AFTER_S, 0, 1)
    for (let f = 0; f < 4; f++) {
      if (w === 0 || !hand.fingers[f][0]) {
        this.drift[side][f] = 0
        continue
      }
      const h1 = hash01(this.id + side + f)
      const h2 = hash01(this.id + side + f + 'p')
      this.drift[side][f] = w * IDLE_DRIFT_DEG * Math.sin((t / (4 + 3 * h1)) * Math.PI * 2 + h2 * Math.PI * 2)
    }
  }

  /** the finger joints for a vector of 20 angles (handPose.toVec) plus each finger's idle drift (°): clamped to the limits, then the joint math of handPose.ts */
  private setFingers(side: 'l' | 'r', vec: readonly number[], drift: readonly number[] = NO_DRIFT, abdLimits?: readonly (Range | undefined)[] | null) {
    const hand = this.parts.hands[side]
    const v = vec.slice()
    for (let f = 0; f < 4; f++) {
      v[f * 4] += drift[f]
      v[f * 4 + 1] += drift[f]
    }
    const { angles } = clampAngles(fromVec(v), abdLimits ?? undefined)
    hand.fingers.forEach((chain, f) => {
      const a = angles.f[f]
      const [j1, j2, j3] = chain
      if (j1) fingerRootQuat(j1.rest, j1.spec, j1.restAbd ?? DEFAULT_FAN[f], a.abd, a.mcp, j1.node.quaternion)
      if (j2) segmentQuat(j2.rest, j2.spec, a.pip, j2.node.quaternion)
      if (j3) segmentQuat(j3.rest, j3.spec, a.dip!, j3.node.quaternion)
    })
    const [t0, t1, t2] = hand.thumb
    const t = angles.thumb
    if (t0) thumbRootQuat(t0.rest, t0.spec, t, t0.node.quaternion)
    if (t1) segmentQuat(t1.rest, t1.spec, t.mcp, t1.node.quaternion)
    if (t2) segmentQuat(t2.rest, t2.spec, t.ip, t2.node.quaternion)
  }

  /**
   * The grip weight of finger f this frame: the fingers close index → little, each 15 ms after the one before, and open in the
   * reverse order (hand-poses.md 2). The weight's last 0.1 s are kept; a finger reads it that much later. None under reduced motion.
   */
  private fingerWeights(side: 'l' | 'r', wc: number): number[] {
    const hist = this.wcHist[side]
    const now = this.clockT
    if (hist.length && now < hist[hist.length - 1].t) hist.length = 0
    if (!hist.length) hist.push({ t: now - 0.1, w: 0 })
    const last = hist[hist.length - 1]
    if (wc !== last.w) this.wcClosing[side] = wc > last.w
    if (last.t !== now) hist.push({ t: now, w: wc })
    else last.w = wc
    while (hist.length > 2 && hist[1].t < now - 0.1) hist.shift()
    if (this.reducedNow) return [wc, wc, wc, wc, wc]
    const at = (tt: number) => {
      if (tt >= now) return wc
      if (tt <= hist[0].t) return hist[0].w
      for (let i = hist.length - 1; i > 0; i--) {
        if (hist[i - 1].t <= tt) {
          const k = (tt - hist[i - 1].t) / Math.max(1e-6, hist[i].t - hist[i - 1].t)
          return hist[i - 1].w + (hist[i].w - hist[i - 1].w) * k
        }
      }
      return hist[0].w
    }
    const closing = this.wcClosing[side]
    const res = [0, 1, 2, 3].map((f) => at(now - (closing ? f : 3 - f) * FINGER_LAG_S))
    res.push(wc)
    return res
  }

  /**
   * Put this frame's `drive` on a hand (PlayStage calls it after update(), so the hand and the object it holds are placed
   * from the same pose): the place blended over the pose's by w, the fingers over the pose's curls by wc. The spring keeps its
   * own state (restored at the start of the next update), so letting go fades back with no jump.
   */
  applyDrive(side: 'l' | 'r', t?: number, reduced?: boolean) {
    const dv = this.drive[side]
    const hand = this.parts.hands[side]
    // the scene clock of this frame: the stage passes it, so the fingers' staggered closing does not depend on update() having run
    if (t !== undefined) this.clockT = t
    if (reduced !== undefined) this.reducedNow = reduced
    if ((dv?.angles || dv?.curl) && dv.wc > 0) {
      const base = this.curls[side]
      const fan = this.fanOf(side)
      // the drive's fingers as angles: given as they are, or from the curl (the fan the mesh bakes in plus each finger's swing, rad → deg)
      const drv = dv.angles ? [...dv.angles] : toVec(fromCurlWithSwing(dv.curl!, fan, dv.spread))
      const w = this.fingerWeights(side, dv.wc)
      const vec = base.map((x, k) => x + (drv[k] - x) * w[k < 16 ? k >> 2 : 4])
      this.setFingers(side, vec, this.drift[side].map((d) => d * (1 - dv.wc)), dv.abdLimits)
    } else {
      this.wcHist[side].length = 0
      this.wcClosing[side] = true
    }
    if (dv?.target && dv.w > 0) {
      if (!this.spring[side]) this.spring[side] = { pos: hand.node.position.clone(), quat: hand.node.quaternion.clone() }
      dv.target.decompose(this.tmpPos, this.tmpQuat, this.tmpScl)
      hand.node.position.lerp(this.tmpPos, dv.w)
      hand.node.quaternion.slerp(this.tmpQuat, dv.w)
    }
    hand.node.updateMatrixWorld(true)
  }
  private tmpColor = new Color()

  /** the 3D agent's orbit and the coder's ring spin; the coder's ear cups glow while it works (#28) */
  private updateRole(dt: number, t: number, status: AgentStatus | undefined, reduced: boolean) {
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
    if (this.parts.fork || this.parts.grille) this.updateEcho(dt, t, reduced, tint)
  }

  /**
   * Echo (agents.md 2.11): the fork's prongs ring at 24 Hz, +-0.6 deg about local x, while the visitor hears the office (0.4 s decay); the
   * grille's light ring breathes 0.35..0.6 over 4 s, and musicGlow() (0..0.3, speaker.ts) is added while the music plays. Reduced motion: no ringing, steady light.
   */
  private updateEcho(dt: number, t: number, reduced: boolean, tint: (node: Object3D | undefined, color: (base: Color) => Color) => void) {
    const level = speakerOn() ? speakerCone() : 0
    const fork = this.parts.fork
    if (fork) {
      this.forkAmp = level > 0.05 ? Math.max(this.forkAmp, Math.min(1, level * 1.6)) : Math.max(0, this.forkAmp - dt / 0.4)
      fork.rotation.x = reduced ? 0 : this.forkAmp * 0.6 * MathUtils.DEG2RAD * Math.sin(t * Math.PI * 2 * 24)
    }
    const breath = reduced ? 0.475 : 0.475 + 0.125 * Math.sin((t / 4) * Math.PI * 2)
    const k = Math.min(1, breath + musicGlow())
    tint(this.parts.grille, (base) => this.tmpColor.copy(base).multiplyScalar(k))
  }

  private updateFace(t: number, pose: string, status: AgentStatus | undefined, reduced: boolean) {
    // a received paper / plane: the nod once its surprise is over, the wide eyes until then (#267)
    const pf = this.paperFace
    if (pf) {
      if (pf.nodAt !== null && t >= pf.nodAt) {
        this.nod = reduced ? null : { t0: t, hand: false }
        pf.nodAt = null
      }
      if (t < pf.until) {
        if (!this.face) return
        const a = this.aim
        const gx = a ? Math.round(MathUtils.clamp(a.eyes, -1, 1) * 3) : 0
        return this.face.draw('wide', gx, 0)
      }
      if (pf.nodAt === null) this.paperFace = null
    }
    if (!this.face) return
    // looking at the plane / the one it throws to (#224): the eyes go first, the mood narrows to aim and widens to catch.
    // Eye direction is information, not motion: it stays with reduced motion
    const aim = this.aim
    if (aim) {
      const gx = Math.round(MathUtils.clamp(aim.eyes, -1, 1) * 3)
      const gy = -Math.round(MathUtils.clamp(this.aimPitch / 0.4, -1, 1) * 2) // up = negative y on the screen
      return this.face.draw(aim.mood ?? 'open', gx, gy)
    }
    if (pose === 'sofa') return this.face.draw('sleep')
    if (pose === 'doze') return this.face.draw('doze')
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
