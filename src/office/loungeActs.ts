// The lounge's acts, drawn (#280, lounge.ts decides when): the fridge door that swings, the water dispenser's tap and stream, the turntable (a record on the platter, the arm over
// the groove, the platter turning), the pillow hugged on the sofa, the sofa's sit sound, the east seat's lying pose (rig.ts), the door lever pressed, the mat stepped on.
// PlayStage owns the hands (grip(), button(), partner()): it hands them over in `StageHooks`, and calls solo() for the poses here and update() once a frame.
// Every sound is a cue of sound.md 4.4 with the position of what makes it; the turntable also tells the speakers (speaker.ts needleDown / needleUp).

import { AdditiveBlending, Color, DataTexture, Matrix4, Mesh, MeshBasicMaterial, Object3D, PointLight, Quaternion, RGBAFormat, Vector3, type Material } from 'three'
import { cue, getCueSpeed } from '../audio/cues'
import { needleDown, needleUp } from '../audio/speaker'
import type { Goal } from './director'
import { GRIPS, REST, curlOf } from './grip'
import { contactAxis } from './gripTargets'
import { DISPENSER, DISPENSER_T, DRINKS, FRIDGE, FRIDGE_LIGHT, FRIDGE_T, RECORD_T, doorDeg, fridgeLightOn, fridgeStepK, grabAt, isAct, openTimeAt, recordBeats, type DrinkKind } from './lounge'
import { DRINK_T, SIP_TOPS, sipLift } from './fridgeDrink'
import { hash } from './play'
import type { StageIn } from './playStage'
import type { AgentRig, PropBank } from './rig'

const DEG = Math.PI / 180
const UP = new Vector3(0, 1, 0)
const ONE = new Vector3(1, 1, 1)
const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k))
  return c * c * (3 - 2 * c)
}
const all = (c: number, thumb: [number, number]) => curlOf([c, c, c, c], thumb)

/**
 * The hands of the lounge (hand-poses.md 2: the names; grips.md has no rows for these yet, so the values are the table's, #280):
 *  - the record: the side pinch (옆 집기), the thumb pad on the side of the index finger, at the disc's edge;
 *  - the pillow: both hands open to receive (펴서 받기), then wrapped round its sides (감아 쥐기);
 *  - the fridge door's handle and the door lever: a wrapped hand (감아 쥐기) round the bar.
 * Registered into GRIPS here, so grip.ts stays as it is.
 */
export const LOUNGE_GRIPS = {
  record: { r: { pre: all(0.2, [0.1, 0.3]), hold: curlOf([0.6, 0.65, 0.7, 0.75], [0.35, 0.55]), after: REST, contacts: ['index', 'thumb'] } },
  pillow: {
    l: { pre: curlOf([0.2, 0.2, 0.25, 0.25], [0.1, 0.5]), hold: curlOf([0.5, 0.55, 0.6, 0.65], [0.3, 0.6]), after: REST, contacts: ['palm'] },
    r: { pre: curlOf([0.2, 0.2, 0.25, 0.25], [0.1, 0.5]), hold: curlOf([0.5, 0.55, 0.6, 0.65], [0.3, 0.6]), after: REST, contacts: ['palm'] },
  },
  fridge_door: { r: { pre: all(0.25, [0.2, 0.5]), hold: curlOf([0.7, 0.75, 0.8, 0.85], [0.45, 0.9]), after: REST, contacts: [] } },
  door_lever: { l: { pre: all(0.25, [0.2, 0.5]), hold: curlOf([0.7, 0.75, 0.8, 0.85], [0.45, 0.9]), after: REST, contacts: [] } },
  // #457 (grips.md): the can wrapped round by the left hand (as the paper cup), the small milk with four fingers flat on one face and the thumb
  // on the other; the pads on the side (fitted to the contacts: palm, index, thumb)
  fridge_can: { l: { pre: curlOf([0.25, 0.25, 0.25, 0.25], [0.1, 0.6]), hold: curlOf([0.55, 0.6, 0.62, 0.65], [0.3, 0.9]), after: REST, contacts: ['palm', 'index', 'thumb'] } },
  fridge_milk: { l: { pre: curlOf([0.2, 0.2, 0.25, 0.25], [0.1, 0.5]), hold: curlOf([0.4, 0.42, 0.45, 0.48], [0.3, 0.8]), after: REST, contacts: ['palm', 'index', 'thumb'] } },
} as const

/** #457 the drink in the left hand, in the agent's frame (root, m): before the chest, its bottom here; at a sip its top rim just under the face screen */
export const DRINK_HOLD = {
  // (a desk top is 0.75: held lower it reads as set down on the desk; its top stays under the head)
  carry: { x: -0.1, y: 0.84, z: -0.28 },
  /** the rim, from the head: a little to the left, under the screen's bottom edge, in front of it */
  rim: { x: -0.03, y: -0.11, z: -0.2 },
  /** each drink's height (its rim above its bottom) and how far it tips back at a sip (grips.md: the wrist 40° back for the can) */
  can: { h: 0.122, tilt: 40 },
  milk: { h: 0.12, tilt: 35 },
} as const

/** the floor spill's soft edges (lounge-props.md 5.4): across the trapezoid (u) faded at both sides, along it (v: 0 at the fridge) fading out into the room */
function spillAlpha(n = 32) {
  const s = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return k * k * (3 - 2 * k)
  }
  const data = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n
      const v = (j + 0.5) / n
      const a = s(0, 0.3, u) * s(1, 0.7, u) * s(0, 0.08, v) * (1 - s(0.35, 1, v))
      const o = (j * n + i) * 4
      data[o] = data[o + 1] = data[o + 2] = Math.round(a * 255)
      data[o + 3] = 255
    }
  const t = new DataTexture(data, n, n, RGBAFormat)
  t.needsUpdate = true
  return t
}
Object.assign(GRIPS, LOUNGE_GRIPS)

/** what PlayStage lends (its grip clocks and drive live there) */
export interface StageHooks {
  grip(rig: AgentRig, side: 'l' | 'r', kind: string, objName: string, want: boolean, held: Matrix4 | null, inp: StageIn, prefer?: string): boolean
  /** the other hand of a two-handed hold, following the primary hand's object pose (the last grip() call's) */
  partner(rig: AgentRig, kind: string, side: 'l' | 'r', objName: string, primary: 'l' | 'r'): void
  /** the index fingertip on a contact `<name>_contact_index`, pressed for `holdS` from u = 0.5, `depth` deep */
  button(rig: AgentRig, name: string, u: number, inp: StageIn, holdS?: number, depth?: number): void
  /** when the agent reached its goal's spot (the scene clock), if it has */
  arrivedAt(id: string): number | undefined
  /** #457 the hand lets go of a prop that is gone from it (faded out): nothing is carried back, the hand's grip starts over */
  drop(rig: AgentRig, side: 'l' | 'r', objName: string): void
}

/** the door mat (office_bake.py build_entry: 0.5 × 0.8 at x −4.48, z = the door's) */
export const MAT = { x0: -4.73, x1: -4.23, z0: 2.0, z1: 2.8 }
export const onMat = (x: number, z: number) => x >= MAT.x0 && x <= MAT.x1 && z >= MAT.z0 && z <= MAT.z1

/** the door lever's press, s from the agent's arrival: the left hand takes it, it goes down (extras press_s), is held, comes up (release_s) */
export const LEVER_T = { grab: 0.42, hold: 0.2 }
export const leverAngle = (u: number, press: { deg: number; sign: number; press_s: number; release_s: number }) => {
  const down = ease((u - LEVER_T.grab) / press.press_s)
  const up = ease((u - LEVER_T.grab - press.press_s - LEVER_T.hold) / press.release_s)
  return press.sign * press.deg * (down - up)
}

interface Arm {
  node: Object3D
  y: number
  axis: 'x' | 'y' | 'z'
  sign: number
  playDeg: number
  restDeg: number
}

/** a contact node the button hand lands on (the model has none for these; created in the scene at the right place, its normal toward `normal`) */
function makeContact(scene: Object3D, parent: Object3D, name: string, world: Vector3, normal: Vector3) {
  const c = new Object3D()
  c.name = `${name}_contact_index`
  // the exported normal is +y or +z of the node, by the bake (gripTargets.ts contactAxis): rotate that axis onto `normal`
  const from = contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const q = new Quaternion().setFromUnitVectors(from, normal.clone().normalize())
  parent.updateWorldMatrix(true, false)
  const local = parent.worldToLocal(world.clone())
  c.position.copy(local)
  const pq = parent.getWorldQuaternion(new Quaternion())
  c.quaternion.copy(pq.invert().multiply(q))
  parent.add(c)
  c.updateWorldMatrix(true, false)
  return c
}

export class LoungeActs {
  // the fridge
  private door?: Object3D
  private doorOpen = { axis: 'y' as 'x' | 'y' | 'z', sign: 1 }
  private deg = 0
  // #457 the inside light (lounge-props.md 5.4): the point light, the LED strip, the floor spill; on (with hysteresis) and how far up (0 … 1)
  private light: PointLight | null = null
  private strip: { mat: MeshBasicMaterial; base: Color }[] = []
  private spill: { node: Object3D; mats: MeshBasicMaterial[] } | null = null
  private lightOn = false
  private lightK = 0
  // #457 the drinks: their own materials (to fade them without fading the door's milk carton), who holds which, the ones waiting to go back on the shelf
  private drinkMats = new Map<string, Material[]>()
  private holding = new Map<string, string>()
  /** prop → the frame (scene time) it was hidden: back on view no earlier than the next frame, once the prop bank has put it home unseen */
  private refill = new Map<string, number>()
  private lastSip = new Map<string, number>()
  // the turntable
  private arm?: Arm
  private platter?: Object3D
  private record?: Object3D
  private discHere: Mesh[] = []
  private discThere: Mesh[] = []
  private spin = 0
  private armK = 0
  private armLift = 0
  /** what the deck shows: a record on the platter, the needle down */
  readonly deck = { recordOn: false, needle: false }
  // the door lever
  private lever?: { node: Object3D; base: Quaternion; press: { axis: string; sign: number; deg: number; press_s: number; release_s: number } }
  private leverT: Map<string, number> = new Map()
  /** each agent's lever `u` of the last frame (the lever cues fire on crossing) */
  private leverPrev: Map<string, number> = new Map()
  private leverAng = 0
  // events: the last `u` of each act, who stood on the mat, who sat
  private lastU = new Map<string, number>()
  private mat = new Map<string, boolean>()
  private sat = new Map<string, string>()
  private hugged = new Set<string>()
  /** the cues fired this frame (tests read them) */
  readonly fired: { name: string; agent: string; at: number }[] = []
  /** the dispenser's stream this frame (PlayStage draws the drops) */
  private streamOn: { tip: Vector3; dir: Vector3; soilY: number } | null = null

  constructor(
    private scene: Object3D,
    nodes: Record<string, Object3D>,
    private props: PropBank,
    private hooks: StageHooks,
  ) {
    scene.updateMatrixWorld(true)
    // the fridge door and the handle on it: the grip finds `<obj>_grip_<hand>`, and the handle follows the door
    this.door = nodes.fridge_door
    const open = this.door?.userData.open as { axis?: 'x' | 'y' | 'z'; sign?: number } | undefined
    this.doorOpen = { axis: open?.axis ?? 'y', sign: open?.sign ?? 1 }
    const handle = scene.getObjectByName('fridge_door_grip')
    if (handle) {
      handle.name = 'fridge_door_grip_r'
      // the grip empty is a top-level node of the model: hung on the door (keeping its place) it swings with it
      if (this.door) this.door.attach(handle)
    }
    // the door lever and its grip
    const lever = nodes.door_lever
    const press = lever?.userData.press as { axis: string; sign: number; deg: number; press_s: number; release_s: number } | undefined
    const leverGrip = scene.getObjectByName('door_lever_grip')
    if (leverGrip) leverGrip.name = 'door_lever_grip_l'
    if (lever && press) this.lever = { node: lever, base: lever.quaternion.clone(), press }
    // the turntable
    const arm = nodes.turntable_arm
    const spec = arm?.userData.arm as { axis?: 'x' | 'y' | 'z'; rest_deg?: number; play_deg?: number; sign?: number } | undefined
    if (arm) {
      this.arm = { node: arm, y: arm.position.y, axis: spec?.axis ?? 'y', sign: spec?.sign ?? 1, playDeg: spec?.play_deg ?? 25, restDeg: spec?.rest_deg ?? 0 }
      // the headshell's lift handle: its end (arm-local (-0.015, 0.014, -0.242), the top of the end), where the index finger lands
      const tip = arm.localToWorld(new Vector3(-0.0225, 0.0, -0.225))
      makeContact(scene, arm, 'turntable_arm', tip, UP)
    }
    this.platter = nodes.turntable_platter
    this.record = nodes.prop_record
    if (this.record && this.platter) {
      // the disc (vinyl, label, groove) is what goes on the platter: the same three meshes again, as the platter's children, centred on it
      const discs = this.record.children.filter((c): c is Mesh => (c as Mesh).isMesh && /record_(vinyl|label|groove)/.test(((c as Mesh).material as { name?: string }).name ?? ''))
      this.discHere = discs
      for (const m of discs) {
        const twin = new Mesh(m.geometry, m.material)
        twin.position.set(-0.08, 0.023 - 0.002, 0)
        twin.visible = false
        this.platter.add(twin)
        this.discThere.push(twin)
      }
    }
    // #457 the inside light: an app light where the model's fridge_light empty is (always in the scene, at 0 when off: a light coming and going
    // would recompile every lit material), the strip lit with it, the spill drawn added on the floor
    const at = scene.getObjectByName('fridge_light')
    if (at) {
      this.light = new PointLight(FRIDGE_LIGHT.color, 0, FRIDGE_LIGHT.distance, FRIDGE_LIGHT.decay)
      this.light.name = 'fridge_light_app'
      this.light.position.copy(at.getWorldPosition(new Vector3()))
      scene.add(this.light)
    }
    nodes.fridge_light_strip?.traverse((o) => {
      const mat = (o as Mesh).material as MeshBasicMaterial | undefined
      const base = (o.userData.baseColor as Color | undefined) ?? mat?.color
      if ((o as Mesh).isMesh && mat?.color && base) {
        this.strip.push({ mat, base: base.clone() })
        mat.color.setScalar(0)
      }
    })
    const spill = nodes.fridge_spill
    if (spill) {
      const alphaMap = spillAlpha()
      const mats: MeshBasicMaterial[] = []
      spill.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh) return
        const mat = new MeshBasicMaterial({ color: FRIDGE_LIGHT.color, alphaMap, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
        ;(m.material as Material).dispose()
        m.material = mat
        m.renderOrder = 1
        mats.push(mat)
      })
      spill.visible = false
      this.spill = { node: spill, mats }
    }
    for (const d of Object.values(DRINKS)) {
      const node = nodes[d.prop]
      if (!node) continue
      const mats: Material[] = []
      node.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh) return
        const own = (m.material as Material).clone()
        own.transparent = true
        m.material = own
        mats.push(own)
      })
      this.drinkMats.set(d.prop, mats)
    }
    // the dispenser's two taps: a fingertip target in front of each (toward the west, where the agent stands)
    for (const k of [0, 1]) {
      const tap = scene.getObjectByName(`water_tap_${k}`)
      if (tap) makeContact(scene, scene, `water_tap_${k}`, tap.getWorldPosition(new Vector3()).add(new Vector3(-0.02, 0.01, 0)), new Vector3(-1, 0, 0))
    }
  }

  /** a new frame: nothing fired, no stream yet (the hands set them) */
  begin() {
    this.fired.length = 0
    this.streamOn = null
  }

  /** the stream the dispenser pours this frame (null: none) */
  stream() {
    return this.streamOn
  }

  /** the lever angle (for tests and the debug panel) */
  leverDeg() {
    return this.leverAng / DEG
  }
  doorDeg() {
    return this.deg
  }

  /**
   * one cue. `at` is the act's own clock (tests read it); `t` the scene time (the stage time in a replay), which keys the
   * cue so the ×4 replay keeps or drops the same ones every time (cues.ts keyRoll). `delay` (scene s) moves it later.
   */
  private fire(name: Parameters<typeof cue>[0], agent: string, pos: Vector3, at: number, t: number, extra: { dur?: number; delay?: number } = {}) {
    this.fired.push({ name, agent, at })
    const key = `lounge:${name}:${agent}:${Math.round(t * 10)}`
    const later = extra.delay ? { at: extra.delay / Math.max(1, getCueSpeed()) } : {}
    cue(name, { pos: pos.clone(), agent, key, ...(extra.dur !== undefined ? { dur: extra.dur } : {}), ...later })
  }

  private crossed(prev: number, u: number, at: number) {
    return prev < at && u >= at
  }

  // ---------------------------------------------------------------------------------------------------------- hands

  /** the hands for the poses here; true = handled (the caller does nothing else for this agent) */
  solo(rig: AgentRig, goal: Goal, inp: StageIn): boolean {
    const a = goal.act
    if (a && isAct(goal.pose) && a.u >= 0) {
      if (a.kind === 'fridge') this.fridgeHands(rig, a.u, a.pick ?? null, inp)
      else if (a.kind === 'dispenser') this.dispenserHands(rig, a.u, inp)
      else this.recordHands(rig, a, inp)
      return true
    }
    if (a && isAct(goal.pose)) return true
    if (goal.pose === 'sofa' && rig.arrived === goal.spot) {
      this.sofaHands(rig, goal, inp)
      return true
    }
    if (goal.spot === 'door' && rig.arrived === 'door') {
      this.leverHands(rig, inp)
      return true
    }
    return false
  }

  private fridgeHands(rig: AgentRig, u: number, pick: DrinkKind | null, inp: StageIn) {
    // the right hand takes the handle and pulls; the door goes on by itself once the handle is out of the arm's reach; on the way back the hand catches it and pushes it shut
    const want = u < openTimeAt(FRIDGE_T.letGoDeg) || (u >= FRIDGE_T.close - 0.3 && u < FRIDGE_T.shut + 0.05)
    this.hooks.grip(rig, 'r', 'fridge_door', 'fridge_door', want, null, inp)
    if (u > FRIDGE_T.open && u < FRIDGE_T.close) rig.glance = { at: new Vector3(FRIDGE.inside.x, 0.55, FRIDGE.inside.z), max: 0.7 }
    if (!pick) return
    // #457 (lounge-props.md 5.5): a step in, the left hand takes the drink off its shelf (lifted 2 cm, drawn out past the front), a step back with it
    // before the chest. Reduced motion: no step, no reach; it is in the hand as the door passes 70°
    const d = DRINKS[pick]
    const node = this.props.info(rig, d.kind, d.prop)?.node
    if (!node) return
    if (inp.reduced) {
      if (u >= grabAt(true)) this.drinkHands(rig, pick, this.carryPose(rig, pick, 0), Math.min(1, (u - grabAt(true)) / DRINK_T.appearS), inp)
      return
    }
    const k = fridgeStepK(u)
    rig.nudge((FRIDGE.step.x - rig.x) * k, (FRIDGE.step.z - rig.z) * k)
    // the body bends to the shelf while the hand is in (the middle shelf more)
    const inK = ease((u - FRIDGE_T.reach) / 0.3) - ease((u - FRIDGE_T.back) / 0.3)
    rig.bodyDip = Math.max(rig.bodyDip, d.dip * inK)
    if (u < FRIDGE_T.reach) return
    rig.glance = { at: new Vector3(d.grip.x, d.grip.y, d.grip.z), max: 0.8 }
    const home = this.props.homeWorld(node)
    const hp = new Vector3().setFromMatrixPosition(home)
    const hq = new Quaternion().setFromRotationMatrix(home)
    const ta = u - FRIDGE_T.grab
    const lift = hp.clone().setY(hp.y + 0.02)
    // out past the front of the body (x 4.335) by its own radius and a little more, at the lifted height: it clears the shelf above and the side wall;
    // then to the chest while the body steps back, so it is before the chest as the door starts to close (5.5: by 2.1 s)
    const out = lift.clone().setX(FRIDGE.hinge.x - 0.045)
    const carry = this.carryPose(rig, pick, 0)
    const cp = new Vector3().setFromMatrixPosition(carry)
    const cq = new Quaternion().setFromRotationMatrix(carry)
    let pos: Vector3
    let q = hq
    if (ta < 0.1) pos = hp.clone().lerp(lift, ease(ta / 0.1))
    else if (ta < 0.3) pos = lift.clone().lerp(out, ease((ta - 0.1) / 0.2))
    else {
      const kk = ease((ta - 0.3) / 0.3)
      pos = out.clone().lerp(cp, kk)
      q = hq.clone().slerp(cq, kk)
    }
    this.drinkHands(rig, pick, new Matrix4().compose(pos, q, ONE), 1, inp)
  }

  /**
   * #457 the drink's pose in the left hand (world): before the chest, lifted toward the face screen by `sipK` (0 … 1) and tipped back so its top rim
   * meets the screen's bottom edge. Its grip side faces the body (the shelf's pose: grip empty on the -x side, the agent east of it… west of it).
   */
  private carryPose(rig: AgentRig, kind: DrinkKind, sipK: number): Matrix4 {
    const root = rig.parts.root
    root.updateWorldMatrix(true, false)
    const rq = root.getWorldQuaternion(new Quaternion())
    // the drink's +x along the body's forward (the root's -z): its -x grip side toward the body
    const yawQ = rq.clone().multiply(new Quaternion().setFromAxisAngle(UP, Math.PI / 2))
    const c = DRINK_HOLD.carry
    const low = root.localToWorld(new Vector3(c.x, c.y, c.z))
    if (sipK <= 0) return new Matrix4().compose(low, yawQ, ONE)
    const spec = DRINK_HOLD[kind]
    const right = new Vector3(1, 0, 0).applyQuaternion(rq)
    const tipQ = new Quaternion().setFromAxisAngle(right, spec.tilt * DEG * sipK).multiply(yawQ)
    const head = rig.parts.head.position
    const r = DRINK_HOLD.rim
    const rim = root.localToWorld(new Vector3(head.x + r.x, head.y + r.y, head.z + r.z))
    const top = rim.sub(new Vector3(0, spec.h, 0).applyQuaternion(tipQ))
    return new Matrix4().compose(low.lerp(top, sipK), tipQ, ONE)
  }

  /** the left hand holds the drink at `held`, seen at `opacity` (it appears / fades) */
  private drinkHands(rig: AgentRig, kind: DrinkKind, held: Matrix4, opacity: number, inp: StageIn) {
    const d = DRINKS[kind]
    // only a drink the hand has closed on is the hand's to let go of (one still on its shelf stays there, seen)
    if (this.hooks.grip(rig, 'l', d.kind, d.prop, true, held, inp, d.prop)) this.holding.set(rig.id, d.prop)
    for (const m of this.drinkMats.get(d.prop) ?? []) m.opacity = opacity
  }

  /**
   * #457 the drink outside the fridge act (Goal.drink): carried, sipped twice where the agent stays, faded out. The hands are the drink's while it is
   * in one (true: nothing else takes them this frame). Once the Director has let it go, the hand is free and the prop waits, hidden, to go back.
   */
  drink(rig: AgentRig, goal: Goal, inp: StageIn): boolean {
    const dr = goal.drink
    const inAct = goal.act?.kind === 'fridge' && goal.act.u >= 0
    if (!dr || inAct) {
      if (!dr) this.letGo(rig, inp.t)
      return false
    }
    const sipK = inp.reduced ? 0 : sipLift(dr.sip)
    const opacity = dr.fade >= 0 ? Math.max(0, 1 - dr.fade / DRINK_T.fadeS) : 1
    this.drinkHands(rig, dr.kind, this.carryPose(rig, dr.kind, sipK), opacity, inp)
    return true
  }

  /** the drink the hand had is gone (faded out, or the agent was taken off the stage): back on its shelf, hidden until the fridge is shut */
  private letGo(rig: AgentRig, t: number) {
    const prop = this.holding.get(rig.id)
    if (!prop) return
    this.holding.delete(rig.id)
    this.hooks.drop(rig, 'l', prop)
    this.props.hide(prop, true)
    for (const m of this.drinkMats.get(prop) ?? []) m.opacity = 1
    this.refill.set(prop, t)
  }

  private dispenserHands(rig: AgentRig, u: number, inp: StageIn) {
    const seat = Number(rig.id.split('_')[1])
    this.hooks.button(rig, `water_tap_${seat % 2}`, u, inp, DISPENSER.pourS, 0.01)
    const tap = this.scene.getObjectByName(`water_tap_${seat % 2}`)
    if (tap && u >= DISPENSER_T.press && u < DISPENSER_T.release) {
      const tip = tap.getWorldPosition(new Vector3()).add(new Vector3(-0.03, -0.02, 0))
      this.streamOn = { tip, dir: new Vector3(-1, -0.15, 0).normalize(), soilY: tip.y - 0.12 }
    }
  }

  private recordHands(rig: AgentRig, a: NonNullable<Goal['act']>, inp: StageIn) {
    const u = a.u
    const b = recordBeats(a.mode ?? 'put', a.recordOn)
    const rec = this.record
    if (rec && b.record && u < RECORD_T.free) {
      const home = this.props.homeWorld(rec)
      const platter = this.platter?.getWorldPosition(new Vector3()) ?? new Vector3()
      const hp = new Vector3()
      const hq = new Quaternion()
      home.decompose(hp, hq, new Vector3())
      // out of its shelf (up and towards the agent), over the platter (flat, the disc's centre on the platter's), and back to the jacket's place
      const outPos = hp.clone().add(new Vector3(0.05, 0.12, -0.16))
      const onPos = new Vector3(platter.x - 0.08, 0.935, platter.z)
      const flat = new Quaternion()
      let pos: Vector3
      let q: Quaternion
      if (u < RECORD_T.take) [pos, q] = [hp, hq]
      else if (u < RECORD_T.out) {
        const k = ease((u - RECORD_T.take) / (RECORD_T.out - RECORD_T.take))
        ;[pos, q] = [hp.clone().lerp(outPos, k), hq]
      } else if (u < RECORD_T.place) {
        const k = ease((u - RECORD_T.out) / (RECORD_T.place - RECORD_T.out))
        ;[pos, q] = [outPos.clone().lerp(onPos, k), hq.clone().slerp(flat, k)]
      } else {
        const k = ease((u - RECORD_T.place) / 0.4)
        ;[pos, q] = [onPos.clone().lerp(hp, k), flat.clone().slerp(hq, k)]
      }
      const held = new Matrix4().compose(pos, q, ONE)
      this.hooks.grip(rig, 'r', 'record', rec.name, u < RECORD_T.place + 0.4 + 0.05, held, inp, rec.name)
      rig.glance = { at: platter.clone().setY(0.9), max: 0.8 }
    } else if (u >= b.arm0 && u < b.down + 0.15) {
      // the right hand on the headshell's lift handle: the arm follows it (armK below), the hand follows the arm
      this.hooks.button(rig, 'turntable_arm', 0.55, inp, 10, 0.004)
      const p = this.platter?.getWorldPosition(new Vector3())
      if (p) rig.glance = { at: p.setY(0.9), max: 0.8 }
    }
  }

  private sofaHands(rig: AgentRig, goal: Goal, inp: StageIn) {
    const at = this.hooks.arrivedAt(rig.id)
    if (at === undefined || rig.lyingK > 0.2) return
    const u = inp.t - at
    // hugging a pillow now and then (lounge-props.md 3: 0.5 s to the chest, kept while sitting): the pillow by this seat, 60% of the sittings, a second after sitting
    const key = `${rig.id}|${at.toFixed(2)}`
    const name = goal.spot === 'sofa_2' ? 'prop_pillow_1' : goal.spot === 'sofa_0' || goal.spot === 'sofa_1' ? 'prop_pillow_0' : null
    if (!name || hash(key) % 100 >= 60 || u < 1.2 + (hash(key + 'w') % 100) / 100) return
    const info = this.props.info(rig, 'pillow', name)
    if (info?.node.name !== name) return
    const right = new Vector3(Math.cos(rig.heading), 0, -Math.sin(rig.heading))
    const fwd = new Vector3(-Math.sin(rig.heading), 0, -Math.cos(rig.heading))
    const up = new Vector3().crossVectors(right, fwd).normalize()
    const root = rig.parts.root
    const chest = root.localToWorld(new Vector3(0, 0.98 - 0.3, -0.27))
    const held = new Matrix4().makeBasis(right, fwd, up).setPosition(chest)
    const attached = this.hooks.grip(rig, 'r', 'pillow', name, true, held, inp, name)
    this.hooks.partner(rig, 'pillow', 'l', name, 'r')
    if (attached && !this.hugged.has(key)) {
      this.hugged.add(key)
      this.fire('pillow.hug', rig.id, chest, inp.t, inp.t)
    }
  }

  private leverHands(rig: AgentRig, inp: StageIn) {
    const at = this.hooks.arrivedAt(rig.id)
    if (at === undefined || !this.lever) return
    const u = inp.t - at
    const p = this.lever.press
    const end = LEVER_T.grab + p.press_s + LEVER_T.hold + p.release_s
    this.leverT.set(rig.id, u)
    this.hooks.grip(rig, 'l', 'door_lever', 'door_lever', u < end, null, inp)
  }

  /**
   * #457 the inside light follows the door (lounge-props.md 5.4): on past 8°, off below 4°, up in 0.12 s and down in 0.08 (at once with reduced
   * motion); the strip with it; the spill 0.16 × how far open. A drink put back (faded out of a hand) shows on its shelf again only while it is dark.
   */
  private fridgeLight(inp: StageIn) {
    this.lightOn = fridgeLightOn(this.deg, this.lightOn)
    const want = this.lightOn ? 1 : 0
    if (inp.reduced) this.lightK = want
    else if (this.lightOn) this.lightK = Math.min(1, this.lightK + inp.dt / FRIDGE_LIGHT.onS)
    else this.lightK = Math.max(0, this.lightK - inp.dt / FRIDGE_LIGHT.offS)
    if (this.light) this.light.intensity = FRIDGE_LIGHT.intensity * this.lightK
    for (const s of this.strip) s.mat.color.copy(s.base).multiplyScalar(this.lightK)
    if (this.spill) {
      const o = FRIDGE_LIGHT.spill * (this.deg / FRIDGE.openDeg) * this.lightK
      for (const m of this.spill.mats) m.opacity = o
      this.spill.node.visible = o > 0.001
    }
    if (!this.lightOn && this.lightK === 0)
      for (const [prop, at] of [...this.refill]) {
        if (inp.t <= at) continue
        this.props.hide(prop, false)
        this.refill.delete(prop)
      }
  }

  /** the inside light now: on, and how far up (tests, the debug panel) */
  fridgeLightState() {
    return { on: this.lightOn, k: this.lightK, intensity: this.light?.intensity ?? 0, spill: this.spill?.mats[0]?.opacity ?? 0 }
  }

  // ------------------------------------------------------------------------------------------------------------ frame

  /** once a frame, after the hands: the things that move (door, arm, platter, lever), the sounds, the mat and the sofa */
  update(inp: StageIn) {
    let doorTarget: number | null = null
    for (const id in inp.rigs) {
      const goal = inp.goals[id]
      const rig = inp.rigs[id]
      const a = goal?.act
      if (!a || a.u < 0) {
        if (!a) this.lastU.delete(id)
        continue
      }
      const prev = this.lastU.get(id) ?? -1
      const u = a.u
      this.lastU.set(id, u)
      const pos = rig.parts.root.position
      if (a.kind === 'fridge') {
        doorTarget = Math.max(doorTarget ?? 0, doorDeg(u))
        const dp = this.door?.getWorldPosition(new Vector3()) ?? new Vector3(FRIDGE.hinge.x, 0.5, FRIDGE.hinge.z)
        if (this.crossed(prev, u, FRIDGE_T.open)) {
          this.fire('fridge.open', id, dp, u, inp.t)
          // the cold inside for as long as the door is open (sound.md 4.4: called with fridge.open, dur = the seconds it is open)
          this.fire('fridge.hum', id, new Vector3(FRIDGE.inside.x, 0.45, FRIDGE.inside.z), u, inp.t, { dur: FRIDGE_T.shut - FRIDGE_T.open })
        }
        if (this.crossed(prev, u, FRIDGE_T.shut)) this.fire('fridge.close', id, dp, u, inp.t)
        if (a.pick) {
          const d = DRINKS[a.pick]
          // looking for it (의문), then glad to have it (기쁨, 1 s), lounge-props.md 5.5
          if (!inp.reduced && this.crossed(prev, u, FRIDGE_T.reach)) rig.faceEvent('question', inp.t, FRIDGE_T.grab - FRIDGE_T.reach)
          if (this.crossed(prev, u, grabAt(inp.reduced))) {
            rig.faceEvent('joy', inp.t, 1)
            this.fire(a.pick === 'can' ? 'fridge.can' : 'fridge.milk', id, new Vector3(d.grip.x, d.grip.y, d.grip.z), u, inp.t)
          }
        }
      } else if (a.kind === 'dispenser') {
        if (this.crossed(prev, u, DISPENSER_T.press)) this.fire('dispenser.pour', id, new Vector3(DISPENSER.face.x, 0.55, DISPENSER.face.z), u, inp.t, { dur: DISPENSER.pourS })
      } else {
        const mode = a.mode ?? 'put'
        const b = recordBeats(mode, a.recordOn)
        const pp = this.platter?.getWorldPosition(new Vector3()) ?? pos
        if (b.record && this.crossed(prev, u, RECORD_T.take)) this.fire('record.out', id, this.record?.getWorldPosition(new Vector3()) ?? pp, u, inp.t)
        if (b.record && this.crossed(prev, u, RECORD_T.place)) {
          this.fire('record.place', id, pp, u, inp.t)
          this.deck.recordOn = true
          for (const m of this.discHere) m.visible = false
          for (const m of this.discThere) m.visible = true
        }
        if (this.crossed(prev, u, b.down)) {
          if (mode === 'put') {
            this.deck.needle = true
            this.fire('record.needle', id, pp, u, inp.t)
            needleDown()
          } else {
            this.deck.needle = false
            this.fire('record.lift', id, pp, u, inp.t)
            needleUp()
          }
        }
        // the arm: raised and carried over (put) / back (lift) between swing0 and over, set down by `down`
        const k = ease((u - b.swing0) / (b.over - b.swing0))
        this.armK = mode === 'put' ? k : 1 - k
        this.armLift = u < b.swing0 - 0.1 ? 0 : u < b.over ? 1 : 1 - ease((u - b.over) / (b.down - b.over))
        // a record on the platter from the start when one is on already
        if (a.recordOn && !this.deck.recordOn) {
          this.deck.recordOn = true
          for (const m of this.discHere) m.visible = false
          for (const m of this.discThere) m.visible = true
        }
      }
    }
    // the door: follows the act; with nobody at it, it closes by itself (never snaps)
    const dt = inp.dt
    if (doorTarget !== null) this.deg = doorTarget
    else this.deg = Math.max(0, this.deg - (FRIDGE.openDeg / FRIDGE.closeS) * dt)
    if (this.door) this.door.rotation[this.doorOpen.axis] = this.doorOpen.sign * this.deg * DEG
    this.fridgeLight(inp)
    // #457 the sips: drink.sip at the top of each lift (sound.md 4.4)
    for (const id in inp.rigs) {
      const dr = inp.goals[id]?.drink
      const prev = this.lastSip.get(id) ?? -1
      if (dr && dr.sip >= 0 && !inp.reduced) {
        const rig = inp.rigs[id]
        const at = rig.parts.root.localToWorld(new Vector3(0, rig.parts.head.position.y - 0.1, -0.2))
        for (const top of SIP_TOPS) if (this.crossed(prev, dr.sip, top)) this.fire('drink.sip', id, at, dr.sip, inp.t)
        this.lastSip.set(id, dr.sip)
      } else this.lastSip.delete(id)
    }
    // the turntable: with no act on it the arm sits where the deck says; the platter turns while the needle is down on a record
    const acting = Object.values(inp.goals).some((g) => g?.act?.kind === 'record' && g.act.u >= 0)
    if (!acting) {
      this.armK += ((this.deck.needle ? 1 : 0) - this.armK) * (1 - Math.exp(-8 * dt))
      this.armLift = 0
    }
    if (this.arm) {
      const deg = this.arm.restDeg + (this.arm.playDeg - this.arm.restDeg) * this.armK
      this.arm.node.rotation[this.arm.axis] = this.arm.sign * deg * DEG
      this.arm.node.position.y = this.arm.y + 0.012 * this.armLift
    }
    if (this.deck.needle && this.deck.recordOn && this.platter) {
      this.spin += Math.PI * 2 * 0.556 * dt * (inp.reduced ? 0.2 : 1)
      this.platter.rotation.y = this.spin
    }
    // the door lever: the left hand's press at the door
    if (this.lever) {
      const { node, base, press } = this.lever
      let u = -1
      for (const id in inp.rigs) if (inp.rigs[id].arrived === 'door' && this.leverT.has(id)) u = Math.max(u, this.leverT.get(id)!)
      for (const id of [...this.leverT.keys()]) if (inp.rigs[id].arrived !== 'door') this.leverT.delete(id)
      // the lever's two sounds (sound.md 4.4): the latch at the bottom of the press, the spring back at the top
      const downAt = LEVER_T.grab + press.press_s
      const upAt = downAt + LEVER_T.hold + press.release_s
      const lp = node.getWorldPosition(new Vector3())
      for (const [id, lu] of this.leverT) {
        const prev = this.leverPrev.get(id) ?? -1
        if (this.crossed(prev, lu, downAt)) this.fire('lever.down', id, lp, lu, inp.t)
        if (this.crossed(prev, lu, upAt)) this.fire('lever.up', id, lp, lu, inp.t)
        this.leverPrev.set(id, lu)
      }
      for (const id of [...this.leverPrev.keys()]) if (!this.leverT.has(id)) this.leverPrev.delete(id)
      const ang = u >= 0 ? leverAngle(u, press) * DEG : 0
      this.leverAng = ang
      node.quaternion.copy(base).multiply(new Quaternion().setFromAxisAngle(press.axis === 'x' ? new Vector3(1, 0, 0) : press.axis === 'y' ? UP : new Vector3(0, 0, 1), ang))
    }
    // the mat and the sofa
    for (const id in inp.rigs) {
      const rig = inp.rigs[id]
      const goal = inp.goals[id]
      if (!rig.visible) continue
      const on = onMat(rig.x, rig.z)
      if (on && !this.mat.get(id)) this.fire('mat.step', id, new Vector3(rig.x, 0.02, rig.z), inp.t, inp.t)
      this.mat.set(id, onMat(rig.x, rig.z))
      const seated = goal?.pose === 'sofa' && rig.arrived === goal.spot ? goal.spot : ''
      // the body settles about 0.3 s after arriving (rig.ts seat: damp rate 3): the cushion thump then
      if (seated && this.sat.get(id) !== seated) this.fire('sofa.sit', id, new Vector3(rig.x, 0.4, rig.z), inp.t, inp.t, { delay: 0.3 })
      this.sat.set(id, seated)
    }
  }

}
