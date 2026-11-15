// The card and the pen on the writing desk (#481, docs/design/wrapup.md 9): app-drawn shapes, no bake. While an agent writes its wrap-up cards
// the card lies on the desk at the writing place (wrapPose.ts writeCard), the pen is in the pen hand, and where the pen's tip touches the card it
// leaves ink. The pen is posed by its tip (wrapPose.ts nibAt: on the card while it writes), 45° to the desk; the pen hand is driven onto the pen
// through the tablet pen's grip (grips.md: 3 cm from the tip), so the tip touches the card exactly and the pen never leaves the fingers.

import {
  BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  Raycaster, SRGBColorSpace, Vector3, type Material, type Object3D,
} from 'three'
import type { Goal } from './director'
import { GRIPS, handFor, objectFor } from './grip'
import { REST_PALM, type AgentRig } from './rig'
import { COLLECT_PEN, PEN, STACK, WRITE_CARD, cardTwist, nibAt, stackCount, writeCard, type WrapBeat } from './wrapPose'
import { hash } from './play'
import { WRAP } from './wrap'

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
/** the ink canvas: 96 x 120 px on the 7.5 x 9.5 cm card (wrapup.md 9.2), redrawn at most 15 times a second */
const INK_PX: [number, number] = [96, 120]
const INK_HZ = 15
/** the pen hand takes the pen over this long, and gives it back */
const DRIVE_S = 0.3
/** the tablet pen's grip in the pen's frame (office.glb prop_tablet_pen_grip_r: 3 cm from the tip, 45° about x) */
const PEN_GRIP = new Matrix4().compose(new Vector3(0, 0, PEN.gripZ), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 45 * DEG), new Vector3(1, 1, 1))
const HOLD = GRIPS.tablet_pen.r!.hold
/** #481 (wrapup.md 9.3 · 9.4): the laid pen fades out over this long when the tidy-up is over; a new card fades in over this long after 'next' */
const PEN_FADE_OUT_S = 0.3
const NEW_CARD_S = 0.15
/** the beats whose pen tip leaves ink (the card lies on its place then) */
const INK_KINDS = new Set(['line', 'newline', 'tapPen', 'strike'])
const ONE = new Vector3(1, 1, 1)
const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}
/** `a` moved toward `b` by k (positions mixed, rotations slerped), in place */
function blendMatrix(a: Matrix4, b: Matrix4, k: number): Matrix4 {
  const pa = new Vector3()
  const qa = new Quaternion()
  const sa = new Vector3()
  const pb = new Vector3()
  const qb = new Quaternion()
  a.decompose(pa, qa, sa)
  b.decompose(pb, qb, sa)
  return a.compose(pa.lerp(pb, k), qa.slerp(qb, k), ONE)
}

/** the pen's axis (tip → back end) in the seat's frame: 45° up, back toward the body, out toward the pen hand (wrapup.md 9.3) */
export function penAxis(s: 1 | -1, out = new Vector3()): Vector3 {
  const e = PEN.elevDeg * DEG
  const o = PEN.outDeg * DEG
  return out.set(s * Math.cos(e) * Math.sin(o), Math.sin(e), Math.cos(e) * Math.cos(o))
}

/** the pen's rotation in the seat's frame for an axis and a roll about it */
function penBasis(axis: Vector3, roll: number): Quaternion {
  const x0 = new Vector3().crossVectors(UP, axis).normalize()
  const y0 = new Vector3().crossVectors(axis, x0)
  const x = x0.multiplyScalar(Math.cos(roll)).addScaledVector(y0, Math.sin(roll))
  const y = new Vector3().crossVectors(axis, x)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, axis))
}

/**
 * The pen's roll about its axis that leaves the pen hand most natural: its palm facing down and a little in toward the card (a writing hand), found
 * once per hand in the seat's frame (the hand's grip and rest rotation are its own).
 */
export function penRoll(rig: AgentRig, side: 'l' | 'r', s: 1 | -1): number {
  const hand = rig.parts.hands[side]
  const grip = hand.grip
  if (!grip) return 0
  grip.updateMatrix()
  const palmLocal = new Vector3(...REST_PALM[side]).applyQuaternion(hand.restQuat.clone().invert())
  const want = new Vector3(-s * 0.45, -0.9, 0).normalize()
  const axis = penAxis(s)
  let best = 0
  let bestDot = -Infinity
  const m = new Matrix4()
  const q = new Quaternion()
  const p = new Vector3()
  const sc = new Vector3()
  for (let k = 0; k < 72; k++) {
    const roll = k * 5 * DEG
    handFor(m.makeRotationFromQuaternion(penBasis(axis, roll)), PEN_GRIP, grip.matrix, m).decompose(p, q, sc)
    const d = palmLocal.clone().applyQuaternion(q).dot(want)
    if (d > bestDot) {
      bestDot = d
      best = roll
    }
  }
  return best
}

/** the desk top under a world point: the seat's desk and the things baked on it (the card lies on 휴's tablet), or null */
export function deskTop(scene: Object3D, seat: number, at: Vector3): number | null {
  const tops = scene.children.filter((o) => o.name === `desk_${seat}` || o.name.startsWith(`desk_${seat}_`))
  const hit = new Raycaster(new Vector3(at.x, 1.4, at.z), new Vector3(0, -1, 0), 0, 1.4).intersectObjects(tops, true)[0]
  return hit ? hit.point.y : null
}

interface Desk {
  /** the card lying on the desk, its ink */
  card: Group
  ink: { ctx: CanvasRenderingContext2D; tex: CanvasTexture; last: [number, number] | null; dirty: boolean; drawnAt: number; key: string }
  pen: Group
  penMats: Material[]
  /** this writing: the card's top (world y), when it began (the pen's fade), the hand drive's weight, the pen's roll */
  top: number | null
  since: number
  w: number
  /** the pen hand's last target and side: let go of over DRIVE_S when the writing ends, so the hand does not jump */
  last: { target: Matrix4; side: 'l' | 'r' } | null
  roll: Record<'l' | 'r', number | null>
  /** the beat whose line was drawn at once (reduced motion) */
  lineKey: string
  /** #481 (wrapup.md 9.4): the done cards' stack (each its own copy of the ink), how many are on it, the desk top under it */
  stack: { group: Group; ctx: CanvasRenderingContext2D; tex: CanvasTexture }[]
  stackN: number
  /** the top card's top (world y): the first card's (`top`) and a step per card under it */
  curTop: number
  cardBody: Mesh
  /** the card's paper and face (faded in after 'next') */
  paper: MeshBasicMaterial
  cardMats: Material[]
  /** the pen laid down beside the card (null while it is in the hand), and how much of it shows (1 laid, fading to 0 after the tidy-up) */
  lie: Matrix4 | null
  lieFade: number
}

export interface WriteIn {
  t: number
  dt: number
  reduced: boolean
  colors: Record<string, string>
}

export class WriteDesk {
  private desks = new Map<string, Desk>()
  private tmp = new Vector3()

  constructor(private scene: Object3D) {}

  private deskOf(rig: AgentRig, color: string): Desk {
    let d = this.desks.get(rig.id)
    if (d) return d
    const c = document.createElement('canvas')
    c.width = INK_PX[0]
    c.height = INK_PX[1]
    const ctx = c.getContext('2d')!
    const tex = new CanvasTexture(c)
    tex.colorSpace = SRGBColorSpace
    const card = new Group()
    card.name = `${rig.id}_write_card`
    const paper = new MeshBasicMaterial({ color: WRITE_CARD.paper })
    const body = new Mesh(new BoxGeometry(WRITE_CARD.w, WRITE_CARD.t, WRITE_CARD.d), paper)
    body.position.y = -WRITE_CARD.t / 2
    // the written face: the canvas, its top row at the card's far edge
    const faceMat = new MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    const face = new Mesh(new PlaneGeometry(WRITE_CARD.w, WRITE_CARD.d).rotateX(-Math.PI / 2), faceMat)
    card.add(body, face)
    card.visible = false
    // the pen along its own z, the tip at PEN.tipZ: a dark cone, the body in the agent's colour, a dark cap (under 200 triangles)
    const pen = new Group()
    pen.name = `${rig.id}_write_pen`
    const dark = new MeshStandardMaterial({ color: PEN.dark, roughness: 0.5 })
    const shell = new MeshStandardMaterial({ color, roughness: 0.45 })
    const bodyLen = PEN.len - PEN.tipLen - PEN.capLen
    const tip = new Mesh(new ConeGeometry(PEN.r, PEN.tipLen, 10).rotateX(-Math.PI / 2), dark)
    tip.position.z = PEN.tipZ + PEN.tipLen / 2
    const barrel = new Mesh(new CylinderGeometry(PEN.r, PEN.r, bodyLen, 10).rotateX(Math.PI / 2), shell)
    barrel.position.z = PEN.tipZ + PEN.tipLen + bodyLen / 2
    const cap = new Mesh(new CylinderGeometry(PEN.r, PEN.r, PEN.capLen, 10).rotateX(Math.PI / 2), dark)
    cap.position.z = PEN.tipZ + PEN.len - PEN.capLen / 2
    pen.add(tip, barrel, cap)
    pen.visible = false
    this.scene.add(card, pen)
    d = { card, ink: { ctx, tex, last: null, dirty: false, drawnAt: -Infinity, key: '' }, pen, penMats: [dark, shell], top: null, since: 0, w: 0, last: null, roll: { l: null, r: null }, lineKey: '', stack: [], stackN: 0, curTop: 0, cardBody: body, paper: new MeshBasicMaterial({ color: WRITE_CARD.paper }), cardMats: [paper, faceMat], lie: null, lieFade: 0 }
    this.clearInk(d)
    this.desks.set(rig.id, d)
    return d
  }

  private clearInk(d: Desk) {
    const g = d.ink.ctx
    g.fillStyle = WRITE_CARD.paper
    g.fillRect(0, 0, INK_PX[0], INK_PX[1])
    d.ink.last = null
    d.ink.tex.needsUpdate = true
  }

  /** the pen side of the writing place: the pen hand */
  private static penSide(rig: AgentRig): { s: 1 | -1; side: 'l' | 'r' } {
    const s = writeCard(rig.writingPlace).s
    return { s, side: rig.writingPlace && s < 0 ? 'l' : 'r' }
  }

  /** writing now: at the desk, the write pose, resting there */
  static writing(rig: AgentRig, goal: Goal | undefined): goal is Goal & { beat: WrapBeat } {
    return !!goal && goal.pose === 'write' && rig.visible && rig.arrived === goal.spot
  }

  /**
   * Before the stage applies the drives: while writing, the card lies on the desk and the pen hand is driven onto the pen at its tip's place (weight
   * up over DRIVE_S, and down again after). Returns whether the pen hand is the stage's this frame.
   */
  drive(rig: AgentRig, goal: Goal | undefined, inp: WriteIn): boolean {
    const writing = WriteDesk.writing(rig, goal)
    const d = this.desks.get(rig.id) ?? (writing ? this.deskOf(rig, inp.colors[rig.id] ?? '#ffffff') : undefined)
    if (!d) return false
    if (!writing) {
      d.card.visible = false
      for (const c of d.stack) c.group.visible = false
      d.stackN = 0
      d.top = null
      d.lineKey = ''
      if (d.ink.key) {
        d.ink.key = ''
        this.clearInk(d)
      }
      // the pen laid beside the card stays on the desk while the wrap-up lasts (to the board and back, the tidy-up), then fades (wrapup.md 9.3)
      this.lying(d, goal, inp)
      this.release(d, rig, inp)
      return false
    }
    const b = goal.beat
    const { s, side } = WriteDesk.penSide(rig)
    const c = writeCard(rig.writingPlace)
    const centre = rig.seatToWorld(c.x, 0, c.z, this.tmp)
    if (d.top === null) {
      const seat = Number(rig.id.split('_')[1])
      d.top = (deskTop(this.scene, seat, centre) ?? 0.76) + WRITE_CARD.lift
      d.since = inp.t
      d.lie = null
      d.lieFade = 0
      d.stackN = 0
    }
    // the done cards under the card (wrapup.md 9.4): a card joining them keeps its ink, the new card on top is clean
    const n = stackCount(b, inp.reduced)
    if (n < d.stackN) d.stackN = n
    for (let i = d.stackN; i < n; i++) {
      const sc = this.stackCard(d, i)
      if (d.ink.key === `${i}`) {
        sc.ctx.drawImage(d.ink.ctx.canvas, 0, 0)
        this.clearInk(d)
        d.ink.key = `${i + 1}`
      } else this.writtenLines(sc.ctx)
      sc.tex.needsUpdate = true
    }
    d.stackN = n
    const sq = rig.seatQuat()
    // gathered: the cards are on the palm now (the rig's bundle)
    const gone = b?.kind === 'collect' && b.u >= 1
    for (let i = 0; i < d.stack.length; i++) {
      const sc = d.stack[i]
      sc.group.visible = i < n && !gone
      if (sc.group.visible) this.onStack(sc.group, rig, c, s, i, 1, d.top, sq)
    }
    // the card on top: the one being written (a step higher per card under it), the new one after 'next'
    const cur = b?.kind === 'next' && n > b.k ? b.k + 1 : (b?.k ?? 0)
    const cardKey = `${cur}`
    if (d.ink.key !== cardKey) {
      d.ink.key = cardKey
      this.clearInk(d)
    }
    d.curTop = d.top + cur * STACK.step
    d.card.visible = !gone
    d.card.position.set(centre.x, d.curTop, centre.z)
    d.card.quaternion.copy(sq)
    // a card on others is as thick as a stack step (no gap under it)
    const thick = cur > 0 ? STACK.step : WRITE_CARD.t
    d.cardBody.scale.y = thick / WRITE_CARD.t
    d.cardBody.position.y = -thick / 2
    // the done card turned a little to its place on the stack, where it lies, by the pressing hand's fingertips (first half of 'next')
    const twist = cardTwist(b, inp.reduced)
    if (b?.kind === 'next' && n <= b.k && twist > 0) this.onStack(d.card, rig, c, s, b.k, twist, d.top, sq)
    // the new card appears over 0.15 s while the hand comes back (reduced motion: at once)
    const fade = b?.kind === 'next' && n > b.k && !inp.reduced ? Math.min(1, (b.u - 0.5) / (NEW_CARD_S / WRAP.next)) : 1
    this.opacity(d.cardMats, fade)
    // the pen: laid down while the cards are gathered (wrapup.md 9.3), else its tip where the beat puts it, above the card's top
    d.roll[side] ??= penRoll(rig, side, s)
    if (b?.kind === 'collect') d.lie ??= this.lieMatrix(rig, c, s, d.roll[side]!, d.top)
    const top = d.curTop
    const down = b?.kind === 'collect' ? (inp.reduced ? 1 : Math.min(1, b.u / COLLECT_PEN)) : 0
    d.lieFade = down >= 1 ? 1 : 0
    if (down >= 1) {
      // laid: the hand lets go of it (the pen is drawn where it lies)
      this.release(d, rig, inp)
      return true
    }
    const nib = nibAt(b, inp.t, { place: rig.writingPlace, reduced: inp.reduced, m: inp.reduced ? 0 : 1 })
    const tip = rig.seatToWorld(nib[0], 0, nib[2])
    tip.y = top + nib[1]
    const q = sq.clone().multiply(penBasis(penAxis(s), d.roll[side]!))
    const penM = new Matrix4().compose(tip.clone().sub(new Vector3(0, 0, PEN.tipZ).applyQuaternion(q)), q, new Vector3(1, 1, 1))
    if (down > 0) blendMatrix(penM, d.lie!, smooth01(down))
    const grip = rig.parts.hands[side].grip
    if (!grip) return false
    grip.updateMatrix()
    d.w = inp.reduced ? 1 : Math.min(1, d.w + inp.dt / DRIVE_S)
    const target = handFor(penM, PEN_GRIP, grip.matrix)
    d.last = { target, side }
    rig.drive[side] = { target, w: d.w, curl: HOLD, wc: d.w, spread: null }
    // reduced motion: the pen stands still, so the line it writes is drawn whole when the line begins (wrapup.md 9.2)
    if (inp.reduced && b?.kind === 'line') {
      const key = `${b.k}:${b.v ?? 0}`
      if (d.lineKey !== key) {
        d.lineKey = key
        const a = nibAt({ ...b, u: 0 }, 0, { place: rig.writingPlace, reduced: false, m: 0 })
        const e = nibAt({ ...b, u: 1 }, 0, { place: rig.writingPlace, reduced: false, m: 0 })
        this.inkSegment(d, rig, a, e)
      }
    }
    return true
  }

  /** the pen hand let go of over DRIVE_S (after the writing, or once the pen is laid down) */
  private release(d: Desk, rig: AgentRig, inp: WriteIn) {
    d.w = inp.reduced ? 0 : Math.max(0, d.w - inp.dt / DRIVE_S)
    if (d.w > 0 && d.last) rig.drive[d.last.side] = { target: d.last.target, w: d.w, curl: HOLD, wc: d.w, spread: null }
    else d.last = null
  }

  /** the laid pen away from the desk's writing: kept while the wrap-up lasts, faded out over PEN_FADE_OUT_S after it */
  private lying(d: Desk, goal: Goal | undefined, inp: WriteIn) {
    if (!d.lie) {
      d.pen.visible = false
      return
    }
    d.lieFade = goal?.wrapStep ? 1 : inp.reduced ? 0 : Math.max(0, d.lieFade - inp.dt / PEN_FADE_OUT_S)
    if (d.lieFade <= 0) {
      d.lie = null
      d.pen.visible = false
      return
    }
    d.lie.decompose(d.pen.position, d.pen.quaternion, d.pen.scale)
    d.pen.visible = true
    this.opacity(d.penMats, d.lieFade)
  }

  /** where the pen lies once laid down (wrapup.md 9.3): `STACK.penOut` beyond the card's edge on the pen side, along the seat's z with its tip toward the monitor, on the desk */
  private lieMatrix(rig: AgentRig, c: { x: number; z: number }, s: 1 | -1, roll: number, top: number): Matrix4 {
    const x = c.x + s * (WRITE_CARD.w / 2 + STACK.penOut)
    // the pen's middle beside the card's centre: its own z runs tip (PEN.tipZ) to back end
    const z = c.z - (PEN.tipZ + PEN.len / 2)
    const at = rig.seatToWorld(x, 0, z)
    const seat = Number(rig.id.split('_')[1])
    at.y = (deskTop(this.scene, seat, at) ?? top - WRITE_CARD.lift) + PEN.r
    const q = rig.seatQuat().multiply(penBasis(new Vector3(0, 0, 1), roll))
    return new Matrix4().compose(at, q, new Vector3(1, 1, 1))
  }

  /** after the drives: the pen in the pen hand (from where the hand is) or where it lies, the card on the reading palm, its ink where the tip touches */
  draw(rig: AgentRig, goal: Goal | undefined, inp: WriteIn) {
    const d = this.desks.get(rig.id)
    if (!d || !WriteDesk.writing(rig, goal) || d.top === null) return
    const b = goal.beat
    // reading the card held up (wrapup.md 9.4): it goes up on the pressing hand's palm and comes back down to its place exactly
    if (b?.kind === 'readUp' && !inp.reduced) {
      const lift = Math.min(smooth01(b.u / 0.25), smooth01((1 - b.u) / 0.25))
      const w = smooth01(lift / 0.35)
      if (w > 0) {
        const palm = rig.palmCard(rig.cardSide)
        const desk = new Matrix4().compose(d.card.position, d.card.quaternion, ONE)
        blendMatrix(desk, palm, w).decompose(d.card.position, d.card.quaternion, d.card.scale)
      }
    }
    if (d.lieFade >= 1 && d.lie) {
      d.lie.decompose(d.pen.position, d.pen.quaternion, d.pen.scale)
      d.pen.visible = true
      this.opacity(d.penMats, 1)
      return
    }
    const { side } = WriteDesk.penSide(rig)
    const hand = rig.parts.hands[side]
    const grip = hand.grip
    if (!grip) return
    hand.node.updateMatrixWorld(true)
    grip.updateMatrix()
    objectFor(hand.node.matrixWorld, grip.matrix, PEN_GRIP).decompose(d.pen.position, d.pen.quaternion, d.pen.scale)
    d.pen.visible = true
    // the pen appears in the hand over 0.2 s (wrapup.md 9.3)
    this.opacity(d.penMats, inp.reduced ? 1 : Math.min(1, (inp.t - d.since) / PEN.fadeInS))
    // the ink: where the tip passes within 2 mm of the card lying on its place (not while it is held up, slid away or the pen goes down)
    d.pen.updateMatrixWorld(true)
    const tipW = new Vector3(0, 0, PEN.tipZ).applyMatrix4(d.pen.matrixWorld)
    if (INK_KINDS.has(b?.kind ?? '') && tipW.y - d.curTop <= PEN.touchM) this.inkTo(d, this.cardPx(d, tipW))
    else d.ink.last = null
    if (d.ink.dirty && inp.t - d.ink.drawnAt >= 1 / INK_HZ) {
      d.ink.tex.needsUpdate = true
      d.ink.dirty = false
      d.ink.drawnAt = inp.t
    }
  }

  /** materials faded to `a` (transparent only while below 1) */
  private opacity(mats: Material[], a: number) {
    for (const m of mats) {
      if (m.transparent !== a < 1) {
        m.transparent = a < 1
        m.needsUpdate = true
      }
      m.opacity = a
    }
  }

  /** a stack card's turn on the stack (rad): ±STACK.turnDeg, seeded by the agent and the card */
  private stackTurn(agent: string, i: number) {
    return (((hash(`${agent}|stack|${i}`) % 1000) / 999) * 2 - 1) * STACK.turnDeg * DEG
  }

  /** card i where it lies on the stack (`k` of the way there): its own turn and move toward the pressing side, its top i steps above the first card's */
  private onStack(g: Object3D, rig: AgentRig, c: { x: number; z: number }, s: 1 | -1, i: number, k: number, top0: number, sq: Quaternion) {
    const off = ((hash(`${rig.id}|stackoff|${i}`) % 1000) / 999) * STACK.offM
    const at = rig.seatToWorld(c.x - s * off * k, 0, c.z)
    g.position.set(at.x, top0 + i * STACK.step, at.z)
    g.quaternion.copy(sq).multiply(new Quaternion().setFromAxisAngle(UP, this.stackTurn(rig.id, i) * k))
  }

  /** stack card i (made the first time it is needed): a card STACK.step thick with its own copy of the ink */
  private stackCard(d: Desk, i: number) {
    while (d.stack.length <= i) {
      const c = document.createElement('canvas')
      c.width = INK_PX[0]
      c.height = INK_PX[1]
      const ctx = c.getContext('2d')!
      ctx.fillStyle = WRITE_CARD.paper
      ctx.fillRect(0, 0, INK_PX[0], INK_PX[1])
      const tex = new CanvasTexture(c)
      tex.colorSpace = SRGBColorSpace
      const group = new Group()
      group.name = `${d.card.name}_stack_${d.stack.length}`
      const body = new Mesh(new BoxGeometry(WRITE_CARD.w, STACK.step, WRITE_CARD.d), d.paper)
      body.position.y = -STACK.step / 2
      const face = new Mesh(new PlaneGeometry(WRITE_CARD.w, WRITE_CARD.d).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
      group.add(body, face)
      group.visible = false
      this.scene.add(group)
      d.stack.push({ group, ctx, tex })
    }
    return d.stack[i]
  }

  /** a card written before it was seen (the page opened part way through): four lines where the lines go */
  private writtenLines(g: CanvasRenderingContext2D) {
    g.fillStyle = WRITE_CARD.paper
    g.fillRect(0, 0, INK_PX[0], INK_PX[1])
    g.strokeStyle = PEN.ink
    g.lineWidth = (PEN.inkM / WRITE_CARD.w) * INK_PX[0]
    g.lineCap = 'round'
    const x0 = (WRITE_CARD.inLeft / WRITE_CARD.w) * INK_PX[0]
    for (let row = 0; row < 4; row++) {
      const y = ((WRITE_CARD.inFar + 0.008 * row) / WRITE_CARD.d) * INK_PX[1]
      g.beginPath()
      g.moveTo(x0, y)
      g.lineTo(x0 + (0.05 / WRITE_CARD.w) * INK_PX[0] * (row === 3 ? 0.6 : 1), y)
      g.stroke()
    }
  }

  /** a world point on the card as canvas pixels (x across from the left edge, y from the far edge) */
  private cardPx(d: Desk, p: Vector3): [number, number] {
    d.card.updateMatrixWorld(true)
    const l = d.card.worldToLocal(p.clone())
    return [((l.x + WRITE_CARD.w / 2) / WRITE_CARD.w) * INK_PX[0], ((l.z + WRITE_CARD.d / 2) / WRITE_CARD.d) * INK_PX[1]]
  }

  /** the ink line from the last touching point to this one, once the tip has moved a pixel */
  private inkTo(d: Desk, px: [number, number]) {
    const last = d.ink.last
    if (last && Math.hypot(px[0] - last[0], px[1] - last[1]) < 1) return
    const g = d.ink.ctx
    g.strokeStyle = PEN.ink
    g.fillStyle = PEN.ink
    g.lineWidth = (PEN.inkM / WRITE_CARD.w) * INK_PX[0]
    g.lineCap = 'round'
    g.beginPath()
    if (last) {
      g.moveTo(last[0], last[1])
      g.lineTo(px[0], px[1])
      g.stroke()
    } else {
      // a touch: a dot
      g.arc(px[0], px[1], g.lineWidth / 2, 0, Math.PI * 2)
      g.fill()
    }
    d.ink.last = px
    d.ink.dirty = true
  }

  /** a whole segment of ink between two tip places (seat frame, wrapPose.ts nibAt), drawn at once */
  private inkSegment(d: Desk, rig: AgentRig, a: [number, number, number], b: [number, number, number]) {
    d.ink.last = null
    const pa = rig.seatToWorld(a[0], 0, a[2])
    const pb = rig.seatToWorld(b[0], 0, b[2])
    pa.y = pb.y = d.curTop
    this.inkTo(d, this.cardPx(d, pa))
    this.inkTo(d, this.cardPx(d, pb))
    d.ink.last = null
    d.ink.tex.needsUpdate = true
    d.ink.dirty = false
  }

  /** tests and the debug view: what is on the desk */
  state(agent: string) {
    const d = this.desks.get(agent)
    if (!d) return null
    d.pen.updateMatrixWorld(true)
    return {
      card: d.card.visible ? d.card.position.clone() : null,
      top: d.top === null ? null : d.curTop,
      tip: d.pen.visible ? new Vector3(0, 0, PEN.tipZ).applyMatrix4(d.pen.matrixWorld) : null,
      grip: d.pen.visible ? new Vector3(0, 0, PEN.gripZ).applyMatrix4(d.pen.matrixWorld) : null,
      w: d.w,
      /** #481: the card's own place and turn now (it slides and is held up), the cards shown on the stack and the stack's desk top, whether the pen lies on the desk */
      cardAt: d.card.visible ? { p: d.card.position.clone(), q: d.card.quaternion.clone() } : null,
      stack: d.stack.filter((c) => c.group.visible).length,
      lying: d.pen.visible && !!d.lie && d.lieFade > 0,
    }
  }

  dispose() {
    for (const d of this.desks.values()) {
      d.card.removeFromParent()
      d.pen.removeFromParent()
      d.ink.tex.dispose()
      for (const c of d.stack) {
        c.group.removeFromParent()
        c.tex.dispose()
      }
    }
    this.desks.clear()
  }
}
