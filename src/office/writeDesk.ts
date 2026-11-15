// The held bundle of cards and the pen (#481 → #532, docs/design/wrapup.md 9): app-drawn shapes, no bake. While an agent writes its wrap-up cards the
// left hand holds the bundle in front of the chest, above the desk (nothing on the desk is touched: the desks' things differ, #500–#507), and the right
// hand writes on its front card; where the pen's tip touches that card it leaves ink. The bundle is placed from the head (wrapPose.ts heldCard) and both
// hands are driven onto it exactly: the holding hand's palm 3 mm behind the last card, the pen hand onto the pen through the tablet pen's grip (6.5 cm from
// the tip, #532: the hand is bigger than the card), the pen posed by its tip (wrapPose.ts nibAt), 50° to the card. 'next' turns the written card over the top to the back of the bundle;
// when the writing is done the pen goes and the bundle goes over to the carrying hold (rig.ts updateCards).

import {
  BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SRGBColorSpace, Vector3, type Material, type Object3D,
} from 'three'
import type { Goal } from './director'
import { GRIPS, curlOf, handFor, objectFor } from './grip'
import type { AgentRig } from './rig'
import { HELD, PEN, WRITE_CARD, doneBehind, flipOf, heldCard, nibAt, type WrapBeat } from './wrapPose'
import { hash } from './play'
import { WRAP } from './wrap'

const UP = new Vector3(0, 1, 0)
const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const ONE = new Vector3(1, 1, 1)
/** the ink canvas: 96 x 120 px on the card (wrapup.md 9.2), redrawn at most 15 times a second */
const INK_PX: [number, number] = [96, 120]
const INK_HZ = 15
/** the hands are taken over this long when the writing begins, and given back */
const DRIVE_S = 0.3
/** the tablet pen's grip frame in the pen's frame (office.glb prop_tablet_pen_grip_r: 45° about x), at PEN.gripZ (#532: 6.5 cm from the tip) */
const penGrip = () => new Matrix4().compose(new Vector3(0, 0, PEN.gripZ), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 45 * DEG), ONE)
const HOLD = GRIPS.tablet_pen.r!.hold
/** the holding hand's fingers nearly straight behind the bundle (they would go through the cards curled), the thumb over its foot (wrapup.md 9.1) */
const BEHIND = curlOf([0.04, 0.04, 0.04, 0.04], [0.15, 0.3])
/** the beats whose pen tip leaves ink */
const INK_KINDS = new Set(['line', 'newline', 'tapPen', 'strike'])
/** the palm block's face this far out of the palm frame's base along its normal (measured on the hand: its palm block reaches 22.5 mm) */
export const PALM_SKIN = 0.0225
/** rig.ts palmCard: its frame is this far out of the palm frame's base (a card's top on the palm) */
const PALM_CARD = 0.016
/** the share of 'next' in which the card goes over the top (the rest it slides down behind the bundle) */
const OVER = 0.66
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

/** the pen's axis (tip → back end) in the front card's frame: 50° up off its face, back toward the body (down the card) and out toward the pen hand (wrapup.md 9.3) */
export function penAxis(s: 1 | -1, out = new Vector3()): Vector3 {
  const e = PEN.elevDeg * DEG
  const o = PEN.outDeg * DEG
  return out.set(s * Math.cos(e) * Math.sin(o), Math.sin(e), Math.cos(e) * Math.cos(o))
}

/** the pen's rotation for an axis and a roll about it */
function penBasis(axis: Vector3, roll: number): Quaternion {
  const x0 = new Vector3().crossVectors(UP, axis).normalize()
  const y0 = new Vector3().crossVectors(axis, x0)
  const x = x0.multiplyScalar(Math.cos(roll)).addScaledVector(y0, Math.sin(roll))
  const y = new Vector3().crossVectors(axis, x)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, axis))
}

/** the front card's frame in world for a beat (wrapPose.ts heldCard): its face's centre, x across, y its normal toward the head, z down the card */
export function frontFrame(rig: AgentRig, b: WrapBeat | undefined, reduced: boolean, out = new Matrix4()): Matrix4 {
  const h = rig.headCentre()
  const held = heldCard(b, { reduced })
  const local = new Matrix4().compose(new Vector3(h[0] + held.c[0], h[1] + held.c[1], h[2] + held.c[2]), new Quaternion().setFromAxisAngle(X, held.tilt), ONE)
  rig.parts.root.updateMatrixWorld(true)
  return out.multiplyMatrices(rig.parts.root.matrixWorld, local)
}

/** the bundle's depth behind the front card's face: `n` cards a step each */
const depthOf = (n: number) => Math.max(1, n) * HELD.step

/**
 * Where the palm frame of rig.ts palmCard goes for the held bundle, in the front card's frame: its normal along the card's (the palm faces the last card's
 * back from `palmGap` behind it), the fingers up the card turned in toward the pen side, its centre a little toward the holding side and down the card
 */
export function holdInCard(n: number, out = new Matrix4()): Matrix4 {
  const a = HELD.fingersInDeg * DEG
  // the palm frame's z (the fingers) to (sin a, 0, -cos a) in the card's frame: a turn about y by pi - a
  return out.compose(new Vector3(-HELD.palmOut, -depthOf(n) - HELD.palmGap + (PALM_CARD - PALM_SKIN), HELD.palmDown), new Quaternion().setFromAxisAngle(Y, Math.PI - a), ONE)
}

interface Card {
  group: Group
  ctx: CanvasRenderingContext2D
  tex: CanvasTexture
  mats: Material[]
}

interface Held {
  /** the bundle's cards: [0] the front one written on, the rest behind it */
  cards: Card[]
  /** which card's writing the front's ink is (the card index k), or '' clean */
  inkKey: string
  ink: { last: [number, number] | null; dirty: boolean; drawnAt: number }
  /** the done cards' ink, by card index (copied from the front when it goes to the back) */
  done: Map<number, HTMLCanvasElement>
  pen: Group
  penMats: Material[]
  /** this writing: when it began (the pen's fade), the hands' drive weight, the pen's roll */
  on: boolean
  since: number
  w: number
  roll: number | null
  /** the hands' last targets: let go of over DRIVE_S when the writing ends, so the hands do not jump */
  last: { pen: Matrix4 | null; hold: Matrix4 | null }
  /** this frame's front card frame (world) and the hand → front card offset it was held with */
  front: Matrix4
  rel: Matrix4 | null
  /** the beat whose line was drawn at once (reduced motion) */
  lineKey: string
  /** the pen's opacity now (in over PEN.fadeInS, out over PEN.fadeOutS) */
  penA: number
}

export interface WriteIn {
  t: number
  dt: number
  reduced: boolean
  colors: Record<string, string>
}

export class WriteDesk {
  private held = new Map<string, Held>()
  /** per agent: the holding hand's palmCard frame in the hand's own frame (fixed by the rig), found once */
  private palmOf = new Map<string, Matrix4>()

  constructor(private scene: Object3D) {}

  private heldOf(rig: AgentRig, color: string): Held {
    let d = this.held.get(rig.id)
    if (d) return d
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
    this.scene.add(pen)
    d = { cards: [], inkKey: '', ink: { last: null, dirty: false, drawnAt: -Infinity }, done: new Map(), pen, penMats: [dark, shell], on: false, since: 0, w: 0, roll: null, last: { pen: null, hold: null }, front: new Matrix4(), rel: null, lineKey: '', penA: 0 }
    this.held.set(rig.id, d)
    return d
  }

  /** card i of the bundle (made the first time it is needed): a card a step thick, its face its own ink canvas, the face at the group's origin (+y) */
  private card(d: Held, rig: AgentRig, i: number): Card {
    while (d.cards.length <= i) {
      const c = document.createElement('canvas')
      c.width = INK_PX[0]
      c.height = INK_PX[1]
      const ctx = c.getContext('2d')!
      ctx.fillStyle = WRITE_CARD.paper
      ctx.fillRect(0, 0, INK_PX[0], INK_PX[1])
      const tex = new CanvasTexture(c)
      tex.colorSpace = SRGBColorSpace
      const group = new Group()
      group.name = `${rig.id}_write_card_${d.cards.length}`
      const paper = new MeshBasicMaterial({ color: WRITE_CARD.paper })
      const body = new Mesh(new BoxGeometry(WRITE_CARD.w, HELD.step, WRITE_CARD.d), paper)
      body.position.y = -HELD.step / 2
      // the written face: the canvas, its top row at the card's top edge (-z)
      const faceMat = new MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      const face = new Mesh(new PlaneGeometry(WRITE_CARD.w, WRITE_CARD.d).rotateX(-Math.PI / 2), faceMat)
      group.add(body, face)
      group.visible = false
      this.scene.add(group)
      d.cards.push({ group, ctx, tex, mats: [paper, faceMat] })
    }
    return d.cards[i]
  }

  private clear(card: Card) {
    card.ctx.fillStyle = WRITE_CARD.paper
    card.ctx.fillRect(0, 0, INK_PX[0], INK_PX[1])
    card.tex.needsUpdate = true
  }

  /** writing now: at the desk, the write pose, resting there */
  static writing(rig: AgentRig, goal: Goal | undefined): goal is Goal & { beat: WrapBeat } {
    return !!goal && goal.pose === 'write' && rig.visible && rig.arrived === goal.spot
  }

  /** the holding hand's palmCard frame in its own frame (rig.ts: fixed by the hand) */
  private palmIn(rig: AgentRig): Matrix4 {
    let p = this.palmOf.get(rig.id)
    if (p) return p
    const hand = rig.parts.hands[rig.cardSide].node
    hand.updateMatrixWorld(true)
    p = new Matrix4().copy(hand.matrixWorld).invert().multiply(rig.palmCard(rig.cardSide))
    this.palmOf.set(rig.id, p)
    return p
  }

  /** the holding hand's world matrix that holds the bundle whose front card's frame is `front` */
  holdTarget(rig: AgentRig, front: Matrix4, n: number, out = new Matrix4()): Matrix4 {
    return out.copy(front).multiply(holdInCard(n)).multiply(this.palmIn(rig).clone().invert())
  }

  /**
   * Before the stage applies the drives: while writing, both hands are driven onto the bundle and the pen (weight up over DRIVE_S, and down again after,
   * and over the finishing 0.4 s the bundle's hand goes to the carrying hold). Returns whether the pen hand is the stage's this frame.
   */
  drive(rig: AgentRig, goal: Goal | undefined, inp: WriteIn): boolean {
    const writing = WriteDesk.writing(rig, goal)
    const d = this.held.get(rig.id) ?? (writing ? this.heldOf(rig, inp.colors[rig.id] ?? '#ffffff') : undefined)
    if (!d) return false
    if (!writing) {
      if (d.on) {
        d.on = false
        d.lineKey = ''
        d.inkKey = ''
        d.done.clear()
        for (const c of d.cards) {
          c.group.visible = false
          c.group.userData.ink = undefined
          this.clear(c)
        }
      }
      d.pen.visible = false
      this.release(d, rig, inp)
      return false
    }
    const b = goal.beat
    if (!d.on) {
      d.on = true
      d.since = inp.t
      d.penA = 0
    }
    const n = Math.max(1, b?.n ?? b.k + 1)
    const front = frontFrame(rig, b, inp.reduced, d.front)
    d.w = inp.reduced ? 1 : Math.min(1, d.w + inp.dt / DRIVE_S)
    // the finishing beat: the drives let go over it, so the hands go to the rig's own poses (the bundle's hand to the carrying hold, the pen hand to rest)
    const finish = b?.kind === 'collect' ? (inp.reduced ? 1 : smooth01(b.u)) : 0
    const w = d.w * (1 - finish)
    // the holding hand
    const hold = this.holdTarget(rig, front, n)
    d.last.hold = hold
    rig.drive[rig.cardSide] = { target: hold, w, curl: BEHIND, wc: w, spread: null }
    // the pen: its tip where the beat puts it on the front card, or (read up) stood in front of the chest
    const s: 1 | -1 = 1
    const side: 'l' | 'r' = 'r'
    d.roll ??= PEN.rollDeg * DEG
    const fq = new Quaternion()
    front.decompose(new Vector3(), fq, new Vector3())
    const nib = nibAt(b, inp.t, { reduced: inp.reduced, m: inp.reduced ? 0 : 1 })
    const tip = new Vector3(...nib).applyMatrix4(front)
    const q = fq.clone().multiply(penBasis(penAxis(s), d.roll))
    const penM = new Matrix4().compose(tip.clone().sub(new Vector3(0, 0, PEN.tipZ).applyQuaternion(q)), q, ONE)
    if (b?.kind === 'readUp' && !inp.reduced) {
      // the pen hand rests in front of the chest with the pen stood up while the bundle is read (wrapup.md 9.4)
      const k = Math.min(smooth01(b.u / 0.25), smooth01((1 - b.u) / 0.25))
      const h = rig.headCentre()
      const restTip = rig.seatToWorld(0.14, h[1] - 0.24, -0.24)
      const rq = rig.seatQuat().multiply(penBasis(new Vector3(0.15, 0.95, 0.25).normalize(), d.roll))
      blendMatrix(penM, new Matrix4().compose(restTip.sub(new Vector3(0, 0, PEN.tipZ).applyQuaternion(rq)), rq, ONE), k)
    }
    const grip = rig.parts.hands[side].grip
    if (!grip) return false
    grip.updateMatrix()
    const target = handFor(penM, penGrip(), grip.matrix)
    d.last.pen = target
    rig.drive[side] = { target, w, curl: HOLD, wc: w, spread: null }
    // the pen in over 0.2 s when the writing begins, out over 0.2 s when it is done (wrapup.md 9.3: not laid on the desk)
    const out = b?.kind === 'collect' ? (inp.reduced ? 1 : Math.min(1, (b.u * WRAP.collect) / PEN.fadeOutS)) : 0
    d.penA = inp.reduced ? 1 - out : Math.min(1, (inp.t - d.since) / PEN.fadeInS) * (1 - out)
    // reduced motion: the pen stands still, so the line it writes is drawn whole when the line begins (wrapup.md 9.2)
    if (inp.reduced && b?.kind === 'line') {
      const key = `${b.k}:${b.v ?? 0}`
      if (d.lineKey !== key) {
        d.lineKey = key
        const a = nibAt({ ...b, u: 0 }, 0, { reduced: false, m: 0 })
        const e = nibAt({ ...b, u: 1 }, 0, { reduced: false, m: 0 })
        this.frontInk(d, rig, b.k)
        d.ink.last = null
        this.inkTo(d, this.px(a[0], a[2]))
        this.inkTo(d, this.px(e[0], e[2]))
        d.ink.last = null
      }
    }
    return true
  }

  /** the hands let go of over DRIVE_S (after the writing) */
  private release(d: Held, rig: AgentRig, inp: WriteIn) {
    d.w = inp.reduced ? 0 : Math.max(0, d.w - inp.dt / DRIVE_S)
    if (d.w > 0) {
      if (d.last.pen) rig.drive.r = { target: d.last.pen, w: d.w, curl: HOLD, wc: d.w, spread: null }
      if (d.last.hold) rig.drive[rig.cardSide] = { target: d.last.hold, w: d.w, curl: BEHIND, wc: d.w, spread: null }
    } else d.last = { pen: null, hold: null }
  }

  /** the front card's canvas is card k's writing (a new card starts clean) */
  private frontInk(d: Held, rig: AgentRig, k: number) {
    const key = `${k}`
    if (d.inkKey === key) return
    const front = this.card(d, rig, 0)
    this.clear(front)
    d.inkKey = key
    d.ink.last = null
  }

  /** after the drives: the bundle in the holding hand (from where it is now), the pen in the pen hand, its ink where the tip touches the front card */
  draw(rig: AgentRig, goal: Goal | undefined, inp: WriteIn) {
    const d = this.held.get(rig.id)
    if (!d || !d.on || !WriteDesk.writing(rig, goal)) return
    const b = goal.beat
    const n = Math.max(1, b?.n ?? b.k + 1)
    const hand = rig.parts.hands[rig.cardSide].node
    hand.updateMatrixWorld(true)
    // the bundle rides the holding hand at the held offset (with the hand fully driven it is exactly at its frame), finishing it goes over to the palm's
    // carrying place (rig.ts palmCard)
    const relHeld = new Matrix4().copy(this.holdTarget(rig, d.front, n)).invert().multiply(d.front)
    const finish = b?.kind === 'collect' ? (inp.reduced ? 1 : smooth01(b.u)) : 0
    const relNow = finish > 0 ? blendMatrix(relHeld, this.palmIn(rig), finish) : relHeld
    const front = new Matrix4().multiplyMatrices(hand.matrixWorld, relNow)
    d.front.copy(front)
    const gone = b?.kind === 'collect' && b.u >= 1
    // the cards: card k on the front (written), the clean ones behind it, the written ones at the back turned over (their faces to the palm), each ±3°
    const done = doneBehind(b, inp.reduced)
    const flip = flipOf(b, inp.reduced)
    const flipping = b?.kind === 'next' && flip > 0 && flip < 1
    // the front card's writing: card k's, or (once it starts over, or went) the next one's, clean
    const frontK = b?.kind === 'next' && (flip > 0 || done > b.k) ? b.k + 1 : b.k
    if (d.inkKey !== `${frontK}`) {
      // the card that was on the front went to the back: its ink goes with it
      if (d.inkKey !== '' && Number(d.inkKey) < frontK) {
        const copy = document.createElement('canvas')
        copy.width = INK_PX[0]
        copy.height = INK_PX[1]
        copy.getContext('2d')!.drawImage(this.card(d, rig, 0).ctx.canvas, 0, 0)
        d.done.set(Number(d.inkKey), copy)
      }
      this.frontInk(d, rig, frontK)
    }
    // the clean cards behind the front (the one going over is neither)
    const clean = Math.max(0, n - 1 - done - (flipping ? 1 : 0))
    const tmp = new Matrix4()
    const at = (i: number, m: Matrix4) => {
      const c = this.card(d, rig, i)
      c.group.visible = !gone
      m.decompose(c.group.position, c.group.quaternion, c.group.scale)
      return c
    }
    // [0] the front (while a card goes over, the next clean one: the moving one is drawn last)
    let slot = 0
    at(slot++, front).group.userData.ink = 'front'
    for (let j = 1; j <= clean; j++) {
      const c = at(slot++, tmp.copy(front).multiply(new Matrix4().makeTranslation(0, -j * HELD.step, 0)))
      if (c.group.userData.ink !== 'clean') {
        this.clear(c)
        c.group.userData.ink = 'clean'
      }
    }
    for (let j = 0; j < done; j++) {
      // written card j at the back, the latest last: turned over (face toward the palm) and a little turned
      const depth = (1 + clean + j + 1) * HELD.step
      const turn = this.turnOf(rig.id, j)
      const m = tmp.copy(front).multiply(new Matrix4().compose(new Vector3(0, -depth, 0), new Quaternion().setFromAxisAngle(Y, turn).multiply(new Quaternion().setFromAxisAngle(X, Math.PI)), ONE))
      const c = at(slot++, m)
      if (c.group.userData.ink !== j) {
        // its own ink, or (written before this page was opened) lines where the lines go
        const ink = d.done.get(j)
        if (ink) c.ctx.drawImage(ink, 0, 0)
        else this.writtenLines(c.ctx)
        c.tex.needsUpdate = true
        c.group.userData.ink = j
      }
    }
    if (flipping) {
      // card k going over the top edge to the back (wrapup.md 9.4): over the top first (its foot toward the face, up, over), then down behind the bundle
      const c = at(slot++, this.overTop(front, flip, n * HELD.step))
      const ink = d.done.get(b.k)
      if (ink && c.group.userData.ink !== b.k) {
        c.ctx.drawImage(ink, 0, 0)
        c.tex.needsUpdate = true
        c.group.userData.ink = b.k
      }
    }
    for (let i = slot; i < d.cards.length; i++) d.cards[i].group.visible = false
    // the pen in the pen hand (from where the hand is)
    const pHand = rig.parts.hands.r
    const grip = pHand.grip
    if (!grip) return
    pHand.node.updateMatrixWorld(true)
    grip.updateMatrix()
    objectFor(pHand.node.matrixWorld, grip.matrix, penGrip()).decompose(d.pen.position, d.pen.quaternion, d.pen.scale)
    d.pen.visible = d.penA > 0
    this.opacity(d.penMats, d.penA)
    // the ink: where the tip passes within 2 mm of the front card's face (not while it is read or goes over)
    d.pen.updateMatrixWorld(true)
    const tipW = new Vector3(0, 0, PEN.tipZ).applyMatrix4(d.pen.matrixWorld)
    const l = tipW.clone().applyMatrix4(new Matrix4().copy(front).invert())
    const on = Math.abs(l.x) <= WRITE_CARD.w / 2 && Math.abs(l.z) <= WRITE_CARD.d / 2 && l.y >= -0.001 && l.y <= PEN.touchM
    if (INK_KINDS.has(b?.kind ?? '') && on) this.inkTo(d, this.px(l.x, l.z))
    else d.ink.last = null
    const fc = this.card(d, rig, 0)
    if (d.ink.dirty && inp.t - d.ink.drawnAt >= 1 / INK_HZ) {
      fc.tex.needsUpdate = true
      d.ink.dirty = false
      d.ink.drawnAt = inp.t
    }
  }

  /** the card going over in 'next' at `f` (0..1), relative to the front card's frame `front`: hinged on its top edge, then slid down `depth` behind */
  private overTop(front: Matrix4, f: number, depth: number): Matrix4 {
    const half = WRITE_CARD.d / 2
    const a = Math.PI * smooth01(f / OVER)
    const kb = Math.max(0, (f - OVER) / (1 - OVER))
    // about the top edge (z = -d/2): the foot (+z) toward the face (+y) and up; at pi the card stands above the edge, its face to the back
    const hinge = new Matrix4().makeTranslation(0, 0, -half).multiply(new Matrix4().makeRotationX(-a)).multiply(new Matrix4().makeTranslation(0, 0, half))
    const slide = new Matrix4().makeTranslation(0, -(depth + 0.0006) * smooth01(kb / 0.4), WRITE_CARD.d * smooth01((kb - 0.2) / 0.8))
    return new Matrix4().copy(front).multiply(slide).multiply(hinge)
  }

  /** a card written before it was seen (the page opened part way through): four lines where the lines go */
  private writtenLines(g: CanvasRenderingContext2D) {
    g.fillStyle = WRITE_CARD.paper
    g.fillRect(0, 0, INK_PX[0], INK_PX[1])
    g.strokeStyle = PEN.ink
    g.lineWidth = (PEN.inkM / WRITE_CARD.w) * INK_PX[0]
    g.lineCap = 'round'
    for (let row = 0; row < 4; row++) {
      const [x, y] = this.px(-WRITE_CARD.w / 2 + WRITE_CARD.inLeft, -WRITE_CARD.d / 2 + WRITE_CARD.inFar + WRITE_CARD.lineGap * row)
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + (WRITE_CARD.lineLen / WRITE_CARD.w) * INK_PX[0] * (row === 3 ? 0.6 : 1), y)
      g.stroke()
    }
  }

  /** a written card's turn at the back of the bundle (rad): ±HELD.turnDeg, seeded by the agent and the card */
  private turnOf(agent: string, i: number) {
    return (((hash(`${agent}|held|${i}`) % 1000) / 999) * 2 - 1) * HELD.turnDeg * DEG
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

  /** a point on the front card (x across from its centre, z down from its centre) as canvas pixels */
  private px(x: number, z: number): [number, number] {
    return [((x + WRITE_CARD.w / 2) / WRITE_CARD.w) * INK_PX[0], ((z + WRITE_CARD.d / 2) / WRITE_CARD.d) * INK_PX[1]]
  }

  /** the ink line from the last touching point to this one, once the tip has moved a pixel */
  private inkTo(d: Held, px: [number, number]) {
    const last = d.ink.last
    if (last && Math.hypot(px[0] - last[0], px[1] - last[1]) < 1) return
    const g = d.cards[0]?.ctx
    if (!g) return
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

  /** tests and the debug view: the bundle and the pen now */
  state(agent: string) {
    const d = this.held.get(agent)
    if (!d) return null
    d.pen.updateMatrixWorld(true)
    const shown = d.cards.filter((c) => c.group.visible)
    return {
      /** the front card's frame (world) and the cards shown */
      front: d.on && shown.length ? d.front.clone() : null,
      cards: shown.length,
      cardGroups: shown.map((c) => c.group),
      tip: d.pen.visible ? new Vector3(0, 0, PEN.tipZ).applyMatrix4(d.pen.matrixWorld) : null,
      grip: d.pen.visible ? new Vector3(0, 0, PEN.gripZ).applyMatrix4(d.pen.matrixWorld) : null,
      pen: d.pen.visible ? d.pen : null,
      penA: d.penA,
      w: d.w,
    }
  }

  dispose() {
    for (const d of this.held.values()) {
      d.pen.removeFromParent()
      for (const c of d.cards) {
        c.group.removeFromParent()
        c.tex.dispose()
      }
    }
    this.held.clear()
  }
}
