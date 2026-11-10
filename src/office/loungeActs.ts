// The lounge's acts, drawn (#280, lounge.ts decides when): the fridge door that swings, the water dispenser's tap and stream, the turntable (a record on the platter, the arm over
// the groove, the platter turning), the pillow hugged on the sofa, the sofa's sit sound, the east seat's lying pose (rig.ts), the door lever pressed, the mat stepped on.
// PlayStage owns the hands (grip(), button(), partner()): it hands them over in `StageHooks`, and calls solo() for the poses here and update() once a frame.
// Every sound is a cue of sound.md 4.4 with the position of what makes it; the turntable also tells the speakers (speaker.ts needleDown / needleUp).

import { Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { cue } from '../audio/cues'
import { needleDown, needleUp } from '../audio/speaker'
import type { Goal } from './director'
import { GRIPS, REST, curlOf } from './grip'
import { contactAxis } from './gripTargets'
import { DISPENSER, DISPENSER_T, FRIDGE, FRIDGE_T, RECORD_T, doorDeg, isAct, openTimeAt, recordBeats } from './lounge'
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
} as const
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
    if (handle) handle.name = 'fridge_door_grip_r'
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
    return this.lever ? new Vector3().setFromEuler(this.lever.node.rotation).z / DEG : 0
  }
  doorDeg() {
    return this.deg
  }

  private fire(name: Parameters<typeof cue>[0], agent: string, pos: Vector3, at: number, extra: { dur?: number } = {}) {
    this.fired.push({ name, agent, at })
    cue(name, { pos: pos.clone(), agent, ...extra })
  }

  private crossed(prev: number, u: number, at: number) {
    return prev < at && u >= at
  }

  // ---------------------------------------------------------------------------------------------------------- hands

  /** the hands for the poses here; true = handled (the caller does nothing else for this agent) */
  solo(rig: AgentRig, goal: Goal, inp: StageIn): boolean {
    const a = goal.act
    if (a && isAct(goal.pose) && a.u >= 0) {
      if (a.kind === 'fridge') this.fridgeHands(rig, a.u, inp)
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

  private fridgeHands(rig: AgentRig, u: number, inp: StageIn) {
    // the right hand takes the handle and pulls; the door goes on by itself once the handle is out of the arm's reach; on the way back the hand catches it and pushes it shut
    const want = u < openTimeAt(FRIDGE_T.letGoDeg) || (u >= FRIDGE_T.close - 0.3 && u < FRIDGE_T.shut + 0.05)
    this.hooks.grip(rig, 'r', 'fridge_door', 'fridge_door', want, null, inp)
    if (u > FRIDGE_T.open && u < FRIDGE_T.close) rig.glance = { at: new Vector3(FRIDGE.inside.x, 0.55, FRIDGE.inside.z), max: 0.7 }
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
      this.fire('pillow.hug', rig.id, chest, inp.t)
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
        if (this.crossed(prev, u, FRIDGE_T.open)) this.fire('fridge.open', id, dp, u)
        if (this.crossed(prev, u, FRIDGE_T.shut)) this.fire('fridge.close', id, dp, u)
      } else if (a.kind === 'dispenser') {
        if (this.crossed(prev, u, DISPENSER_T.press)) this.fire('dispenser.pour', id, new Vector3(DISPENSER.face.x, 0.55, DISPENSER.face.z), u, { dur: DISPENSER.pourS })
      } else {
        const mode = a.mode ?? 'put'
        const b = recordBeats(mode, a.recordOn)
        const pp = this.platter?.getWorldPosition(new Vector3()) ?? pos
        if (b.record && this.crossed(prev, u, RECORD_T.take)) this.fire('record.out', id, this.record?.getWorldPosition(new Vector3()) ?? pp, u)
        if (b.record && this.crossed(prev, u, RECORD_T.place)) {
          this.fire('record.place', id, pp, u)
          this.deck.recordOn = true
          for (const m of this.discHere) m.visible = false
          for (const m of this.discThere) m.visible = true
        }
        if (this.crossed(prev, u, b.down)) {
          if (mode === 'put') {
            this.deck.needle = true
            this.fire('record.needle', id, pp, u)
            needleDown()
          } else {
            this.deck.needle = false
            this.fire('record.lift', id, pp, u)
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
      const ang = u >= 0 ? leverAngle(u, press) * DEG : 0
      node.quaternion.copy(base).multiply(new Quaternion().setFromAxisAngle(press.axis === 'x' ? new Vector3(1, 0, 0) : press.axis === 'y' ? UP : new Vector3(0, 0, 1), ang))
    }
    // the mat and the sofa
    for (const id in inp.rigs) {
      const rig = inp.rigs[id]
      const goal = inp.goals[id]
      if (!rig.visible) continue
      const on = onMat(rig.x, rig.z)
      if (on && !this.mat.get(id)) this.fire('mat.step', id, new Vector3(rig.x, 0.02, rig.z), inp.t)
      this.mat.set(id, onMat(rig.x, rig.z))
      const seated = goal?.pose === 'sofa' && rig.arrived === goal.spot ? goal.spot : ''
      if (seated && this.sat.get(id) !== seated) this.fire('sofa.sit', id, new Vector3(rig.x, 0.4, rig.z), inp.t)
      this.sat.set(id, seated)
    }
  }

}
