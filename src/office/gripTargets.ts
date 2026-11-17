// Where an object is held and touched, read from the model (#164): `<obj>_grip_<r|l>` (the hand's own `_grip` frame goes
// onto it) and `<obj>_contact_<finger>[_l]` (a fingertip lands there; +y of the exported node is the outward normal).
// Shared by the app (PlayStage) and the tests / the generator of gripFit.data.ts.

import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { fingerModelOf, type Hand } from './rig'
import { GRIPS, fitContact, pointsAtJoints, solveContacts, tableJoints, type ContactIn, type Finger, type Solved } from './grip'
import { GRIP_OFFSETS } from './gripFit.data'
import { PINCH_LET_GO, PINCH_LIFT, TURN_S, cornerOf, leafAngle } from './bookLeaf'
import { bookBoxes, bookDimsOf, distToBook, halfAngle, readingContacts, readingGrip, type BookBox } from './bookGeom'
import { resolvePaperSideTarget } from './paperSide'

export interface Contact {
  finger: Exclude<Finger, 'palm'>
  /** in the object's frame (the world frame for an object that is part of the room) */
  p: Vector3
  n: Vector3
  /** a disc of this radius round p across the normal (m) instead of a point (grip.ts fitContact) */
  radius?: number
}
export interface GripTarget {
  key: string
  kind: string
  side: 'l' | 'r'
  /** the object that moves (null: a fixture, its frame is the world) */
  obj: Object3D | null
  /** the object's grip frame in its own frame */
  pg: Matrix4
  contacts: Contact[]
  /** solid parts of the object in its frame that a finger must stay out of (the open book: bookGeom.ts); the solver costs fits against them */
  solids?: BookBox[]
  /** the same for an object that moves while held (the turning leaf's corner frame): the solids as seen from several poses of the frame; a finger must be out of all */
  solidSets?: BookBox[][]
  /** an extra cost of a hand frame in the object's frame (the paper's wrist bend at its viewing place, paperSide.ts); 0 when fine */
  cost?: (handInObject: Matrix4, hand: Hand, fits: readonly { finger: Exclude<Finger, 'palm'>; joints: number[] }[]) => number
}

const AXES = new WeakMap<object, 'y' | 'z'>()

/**
 * Which local axis of a contact node is its outward normal. Blender aims +z; the glTF export maps that to the node's +y (the first #172
 * bake), and the re-bake that fixes it makes the node's +z the normal. Read it from the go stone's index contact, which faces straight up or down on its local axis, so
 * both bakes work. #538: the hologram bake has no go stone any more; every bake since the re-bake is 'z', so a scene without it is 'z'.
 */
export function contactAxis(scene: Object3D): 'y' | 'z' {
  let a = AXES.get(scene)
  if (!a) {
    const n = scene.getObjectByName('prop_piece_a_contact_index')
    scene.updateMatrixWorld(true)
    a = !n || Math.abs(new Vector3(0, 0, 1).transformDirection(n.matrixWorld).y) > 0.9 ? 'z' : 'y'
    AXES.set(scene, a)
  }
  return a
}

/** a contact node's outward normal in the world */
export const contactNormal = (scene: Object3D, node: Object3D) => (contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)).transformDirection(node.matrixWorld)

const FINGER_ORDER = ['index', 'middle', 'ring', 'little', 'thumb'] as const

/**
 * The open book held for reading (#231): the grip frame and the contacts are the bake's own empties, children of each half
 * (`<book>_l_grip`, `<book>_l_contact_<finger>`, and the same for _r: four fingers on the cover's outer face, the thumb on the paper near the
 * fore-edge, grips.md 2), turned by the half's open angle (the bake lies the halves flat at 180°; the app lifts each to 150°, bookGeom.ts LIFT).
 * A missing empty falls back on the computed one (bookGeom.ts readingContacts / readingGrip); the glb's closed-book grip empties
 * (`<book>_grip_l`, `_contact_thumb_l`) are not used.
 */
function resolveBookTarget(scene: Object3D, objName: string, side: 'l' | 'r'): GripTarget | null {
  const obj = scene.getObjectByName(objName)
  const l = scene.getObjectByName(objName + '_l')
  const r = scene.getObjectByName(objName + '_r')
  if (!obj || !l || !r) return null
  const d = bookDimsOf(l, r)
  const half = side === 'l' ? l : r
  // an empty in the book frame, the half at its open angle: the empty's own matrix (in its half's frame) under that turn
  const R = new Matrix4().makeRotationZ(halfAngle(side))
  const inBook = (n: Object3D) => R.clone().multiply(n.matrix)
  const grip = half.getObjectByName(`${objName}_${side}_grip`)
  const axis = contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const contacts: Contact[] = readingContacts(d, side).map((c) => {
    const node = half.getObjectByName(`${objName}_${side}_contact_${c.finger}`)
    if (!node) return c
    const m = inBook(node)
    return { finger: c.finger, p: new Vector3().setFromMatrixPosition(m), n: axis.clone().transformDirection(m) }
  })
  return { key: `${objName}:${side}`, kind: 'book', side, obj, pg: grip ? inBook(grip) : readingGrip(d, side), contacts, solids: bookBoxes(d) }
}

/** the leaf's angles (φ, rad) the pinch is kept clear of the book at: from the lift to where the hand lets go (bookLeaf.ts PINCH_LET_GO) */
const pinchAngles = (): number[] => {
  const go = leafAngle(PINCH_LET_GO * TURN_S)
  return Array.from({ length: 41 }, (_, i) => PINCH_LIFT + ((go - PINCH_LIFT) * i) / 40)
}

/**
 * The hand's grip frame in the leaf's corner frame for the pinch (bookLeaf.ts LeafBend.corner): the right hand comes up the page from below the
 * lower outer corner, fingers (grip −y) running up the page (−z), palm (grip −x) toward the page edge (−x), thumb side (grip z) down (−y) turned
 * onto the leaf's top face by the fit. Chosen from the 24 axis-aligned frames by fit error and clearance from the book (all 0.3 mm or better; this one
 * is the one with the hand's natural pose and the smallest move, 16 mm, to clear the book).
 */
export const PINCH_PG = new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0)).setPosition(-0.012, 0, 0.053)

/**
 * The right thumb and index pinching the corner of the book's turning leaf (#231, grips.md "한 장 넘기기"). The target's frame is the leaf's
 * corner frame (bookLeaf.ts LeafBend.corner: x along the leaf, y the face normal, z down the page), the corner at its pinch lift
 * (PINCH_LIFT); the solids of the book are carried into it, so the solver keeps the pinching hand out of the book there. The contacts are the
 * bake's own `<book>_page_contact_thumb` (on the leaf's top face) / `_index` (under it), 1.2 cm in from the edge and the end, at the leaf's
 * lower (+z) outer corner; missing ones are computed the same.
 */
export function resolvePageTarget(scene: Object3D, bookName: string, pg: Matrix4 = PINCH_PG): GripTarget | null {
  const page = scene.getObjectByName(bookName + '_page')
  const l = scene.getObjectByName(bookName + '_l')
  const r = scene.getObjectByName(bookName + '_r')
  const ex = page?.userData as { page_w?: number; page_h?: number } | undefined
  if (!page || !l || !r || !ex?.page_w || !ex.page_h) return null
  const zc = ex.page_h / 2
  const C = cornerOf(PINCH_LIFT, 0.003, ex.page_w, zc)
  const boxes = bookBoxes(bookDimsOf(l, r))
  const solids = boxes.map((b) => ({ ...b, toBox: b.toBox.clone().multiply(C) }))
  // the pinching hand keeps its place on the corner while the leaf turns, so it must be out of the book at the angles it passes through too
  const solidSets = pinchAngles().map((th) => {
    const Ct = cornerOf(th, 0.003, ex.page_w!, zc)
    return boxes.map((b) => ({ ...b, toBox: b.toBox.clone().multiply(Ct) }))
  })
  // the corner's rest frame in the leaf's frame (the leaf's middle surface at the outer end; the bake's pinch spots are measured from it)
  const rest = new Vector3(0.003 + ex.page_w, 0.00035, zc)
  const axis = contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const contacts: Contact[] = (['thumb', 'index'] as const).map((finger) => {
    const node = page.getObjectByName(`${bookName}_page_contact_${finger}`)
    if (!node) return { finger, p: new Vector3(-0.012, finger === 'thumb' ? 0.00005 : -0.00005, -0.012), n: new Vector3(0, finger === 'thumb' ? 1 : -1, 0) }
    return { finger, p: new Vector3().setFromMatrixPosition(node.matrix).sub(rest), n: axis.clone().transformDirection(node.matrix) }
  })
  return { key: `${bookName}_page:r`, kind: 'leaf', side: 'r', obj: null, pg: pg.clone(), contacts, solids, solidSets }
}

/** #538 the light stone's radius, m (hologram.md 3.2: 8 voxels of 2.8 mm) */
export const HOLO_PINCH_R = 0.0112

/**
 * #538 (hologram.md 4.1) the right hand's grip frame for the light stone, in the stone's frame (x: thumb to index across the diameter, y: up,
 * z: forward, away from the body): palm down, the fingers forward and about 15° down. Of the 24 axis-aligned frames every agent fits within
 * 0.35 mm; this one has the palm down (normal y −0.95) and the fingers forward, pitched 25° down so the fingertips look at the board.
 */
export const HOLO_PINCH_PG = new Matrix4().makeRotationX((25 * Math.PI) / 180).multiply(new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(-1, 0, 0)))

/** #538 the light stone held by the thumb and index on its rim, at the two ends of a diameter (not a node of the model: the board is light) */
export const holoPinchTarget = (): GripTarget => ({
  key: 'holo_stone:r',
  kind: 'holo',
  side: 'r',
  obj: null,
  pg: HOLO_PINCH_PG.clone(),
  contacts: [
    { finger: 'thumb', p: new Vector3(-HOLO_PINCH_R, 0, 0), n: new Vector3(-1, 0, 0) },
    { finger: 'index', p: new Vector3(HOLO_PINCH_R, 0, 0), n: new Vector3(1, 0, 0) },
  ],
})

/** #604 a chess glyph's thickness (2 voxels of 3.6 mm, hologram.md 11.2) */
export const CHESS_CARD_T = 0.0072

/**
 * #604 (hologram.md 11.4) a chess piece taken like a card: the thumb on the glyph's back face, the index on its front, at the grip point (the caller puts
 * it at 70% of the glyph's height). The piece's frame: x across the glyph, y up, z out of its front (toward the camera). Of the 24 axis-aligned
 * frames every agent fits within 0.33 mm; these two have the palm down and the fingers along the glyph, A along +x, B along −x (the caller
 * takes the one nearer the player's forward)
 */
export const chessCardTarget = (flip: boolean): GripTarget => ({
  key: `chess_card_${flip ? 'b' : 'a'}:r`,
  kind: 'holo',
  side: 'r',
  obj: null,
  pg: new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(flip ? 1 : -1, 0, 0), new Vector3(0, 0, flip ? -1 : 1)),
  contacts: [
    { finger: 'thumb', p: new Vector3(0, 0, -CHESS_CARD_T / 2), n: new Vector3(0, 0, -1) },
    { finger: 'index', p: new Vector3(0, 0, CHESS_CARD_T / 2), n: new Vector3(0, 0, 1) },
  ],
})

/**
 * #604 (hologram.md 11.4, hand-poses.md 6) the king and the queen taken with three fingers just under the glyph's top: the thumb on the back face,
 * the index and the middle on the front, 2 cm apart (the glyph is 21.6 mm wide there; 1 cm apart no agent's fingers fit within 3 mm, 2 cm within
 * 0.9 mm); the same frames as the card pinch (A / B), the index on the side that keeps the palm down
 */
export const CHESS_TRIPOD_HALF = 0.01
export const chessTripodTarget = (flip: boolean): GripTarget => ({
  ...chessCardTarget(flip),
  key: `chess_tripod_${flip ? 'b' : 'a'}:r`,
  kind: 'holo_tripod',
  contacts: [
    { finger: 'thumb', p: new Vector3(0, 0, -CHESS_CARD_T / 2), n: new Vector3(0, 0, -1) },
    { finger: 'index', p: new Vector3(flip ? CHESS_TRIPOD_HALF : -CHESS_TRIPOD_HALF, 0, CHESS_CARD_T / 2), n: new Vector3(0, 0, 1) },
    { finger: 'middle', p: new Vector3(flip ? -CHESS_TRIPOD_HALF : CHESS_TRIPOD_HALF, 0, CHESS_CARD_T / 2), n: new Vector3(0, 0, 1) },
  ],
})

/** the grip target of `objName` for a `kind` of grip, or null when the model has no grip empty for that hand */
export function resolveTarget(scene: Object3D, objName: string, kind: string, side: 'l' | 'r'): GripTarget | null {
  if (kind === 'book') return resolveBookTarget(scene, objName, side)
  if (kind === 'paper_side') return resolvePaperSideTarget(scene, side, contactAxis(scene))
  if (kind === 'leaf') return side === 'r' ? resolvePageTarget(scene, objName) : null
  if (kind === 'paper_tray_side') return resolveTraySideTarget(scene, objName, side)
  const spec = GRIPS[kind]?.[side]
  const grip = scene.getObjectByName(`${objName}_grip_${side}`)
  if (!spec || !grip) return null
  scene.updateMatrixWorld(true)
  const obj = scene.getObjectByName(objName) ?? null
  const inv = new Matrix4()
  if (obj) inv.copy(obj.matrixWorld).invert()
  const local = (o: Object3D) => inv.clone().multiply(o.matrixWorld)
  const contacts: Contact[] = []
  for (const f of spec.contacts) {
    if (f === 'palm') continue
    const node = scene.getObjectByName(`${objName}_contact_${f}${side === 'l' ? '_l' : ''}`) ?? scene.getObjectByName(`${objName}_contact_${f}`)
    if (!node) continue
    const m = local(node)
    contacts.push({ finger: f, p: new Vector3().setFromMatrixPosition(m), n: (contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)).transformDirection(m) })
  }
  // the closed book's grip is another target of the same book and hand: its offsets are stored under their own key
  return { key: kind === 'bookclosed' ? `${objName}:closed:${side}` : `${objName}:${side}`, kind, side, obj, pg: local(grip), contacts }
}

/**
 * #370 B3 a tray sheet held by a long side for reading (grips.md 낱장 옆 쥐고 읽기): the frames TrayPile makes on the pile's top sheet
 * (`<obj>_grip_side_<l|r>` with its `_contact_thumb` on the face and `_contact_index` under it), the sheet a solid the fingers stay out of.
 */
function resolveTraySideTarget(scene: Object3D, objName: string, side: 'l' | 'r'): GripTarget | null {
  const obj = scene.getObjectByName(objName)
  const grip = scene.getObjectByName(`${objName}_grip_side_${side}`)
  const box = obj?.userData.sheetBox as { min: number[]; max: number[] } | undefined
  if (!obj || !grip || !box) return null
  scene.updateMatrixWorld(true)
  const inv = new Matrix4().copy(obj.matrixWorld).invert()
  const local = (o: Object3D) => inv.clone().multiply(o.matrixWorld)
  const axis = contactAxis(scene) === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const contacts: Contact[] = []
  for (const f of ['index', 'thumb'] as const) {
    const c = scene.getObjectByName(`${objName}_grip_side_${side}_contact_${f}`)
    if (!c) continue
    const m = local(c)
    contacts.push({ finger: f, p: new Vector3().setFromMatrixPosition(m), n: axis.clone().transformDirection(m) })
  }
  const solids = [{ name: 'sheet', half: 'r' as const, min: new Vector3(...box.min), max: new Vector3(...box.max), toBox: new Matrix4() }]
  // as the loose sheet's (paperSide.ts): the fingers not on a contact lie behind the sheet over its footprint, and the palm stays beside the edge
  // (palms facing each other across the sheet), not in over its face
  const [x0, , z0] = box.min
  const [x1, , z1] = box.max
  const inFoot = (p: Vector3, m = 0) => p.x > x0 + m && p.x < x1 - m && p.z > z0 && p.z < z1
  const cost: GripTarget['cost'] = (m, hand, fits) => {
    let c = 0
    const hold = GRIPS.paper_tray_side[side]!.hold
    const p = new Vector3()
    const a = new Vector3()
    for (const [k, f] of (['index', 'middle', 'ring', 'little'] as const).entries()) {
      const model = fingerModelOf(hand, k, side)
      if (!model) continue
      const joints = fits.find((x) => x.finger === f)?.joints ?? tableJoints(model, hold[k], 0)
      const pts = pointsAtJoints(model, joints)
      for (let i = 0; i + 1 < pts.length; i++)
        for (let s = 0; s <= 4; s++) {
          a.copy(pts[i]).lerp(pts[i + 1], s / 4)
          p.copy(a).applyMatrix4(m)
          if (inFoot(p) && p.y > -0.0005) c += 4000 * (p.y + 0.0005) ** 2
        }
    }
    // the palm block (the hand's own meshes) beside the edge: how far its corners come in over the sheet, in front of or through it
    const corners = palmCorners(hand)
    for (const q of corners) {
      p.copy(q).applyMatrix4(m)
      if (!inFoot(p) || p.y < -0.002) continue
      const inside = Math.min(p.x - x0, x1 - p.x)
      c += 4000 * Math.min(inside, p.y + 0.002) ** 2
    }
    return c
  }
  return { key: `${objName}:side:${side}`, kind: 'paper_tray_side', side, obj, pg: local(grip), contacts, solids, cost }
}

/** the corners of a hand's palm block (its own meshes, not the fingers'), in the hand's frame */
const PALMS = new WeakMap<Hand, Vector3[]>()
function palmCorners(hand: Hand): Vector3[] {
  let out = PALMS.get(hand)
  if (out) return out
  out = []
  const own = new RegExp(`^${hand.node.name}_(\d+|cuff)$`)
  hand.node.updateWorldMatrix(true, true)
  const inv = hand.node.matrixWorld.clone().invert()
  for (const c of hand.node.children) {
    const g = (c as unknown as { geometry?: { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void } }).geometry
    if (!own.test(c.name) || !g) continue
    g.computeBoundingBox()
    const b = g.boundingBox!
    const toHand = inv.clone().multiply(c.matrixWorld)
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new Vector3(x, y, z).applyMatrix4(toHand))
  }
  PALMS.set(hand, out)
  return out
}

/** the hand's `_grip` frame in the hand's own frame */
export const handGripMatrix = (hand: Hand) => (hand.grip ? new Matrix4().compose(hand.grip.position, hand.grip.quaternion, new Vector3(1, 1, 1)) : new Matrix4())

/** the target's contacts in the frame of a hand whose grip is exactly on the object's grip */
export function contactsInHand(t: GripTarget, hand: Hand): ContactIn[] {
  const spec = GRIPS[t.kind][t.side]!
  const toHand = handGripMatrix(hand).multiply(new Matrix4().copy(t.pg).invert())
  const out: ContactIn[] = []
  for (const c of t.contacts) {
    const k = FINGER_ORDER.indexOf(c.finger)
    const model = fingerModelOf(hand, c.finger === 'thumb' ? 'thumb' : k, t.side)
    if (!model) continue
    out.push({
      finger: c.finger,
      model,
      p: c.p.clone().applyMatrix4(toHand),
      n: c.n.clone().transformDirection(toHand),
      a0: spec.hold[c.finger === 'thumb' ? 4 : k],
      b0: c.finger === 'thumb' ? spec.hold[5] : 0,
      radius: c.radius,
    })
  }
  return out
}

/** the hand offset the generator stored for this target and agent (identity when there is none) */
export function offsetOf(key: string, agent: number): Matrix4 {
  const v = GRIP_OFFSETS[`${key}:${agent}`]
  return v ? composeOffset(v) : new Matrix4()
}

export function composeOffset(v: readonly number[]): Matrix4 {
  return new Matrix4().compose(new Vector3(v[0], v[1], v[2]), new Quaternion().setFromEuler(new Euler(v[3], v[4], v[5], 'XYZ')), new Vector3(1, 1, 1))
}

export interface FitResult {
  finger: Exclude<Finger, 'palm'>
  /** the fitted joint angles, degrees: a finger [MCP, PIP, total abduction], the thumb [CMC flex, CMC abduct, MCP, IP] (grip.ts fitContact) */
  joints: number[]
  /** tip-to-contact distance, m, and how far the tip stands off the surface along the normal (negative = through it) */
  err: number
  off: number
}

/** every contact finger's bend for a hand placed at `offset` from "grip on grip" */
export function fitFingers(t: GripTarget, hand: Hand, offset: Matrix4): FitResult[] {
  const inv = new Matrix4().copy(offset).invert()
  return contactsInHand(t, hand).map((c) => {
    const f = fitContact(c.model, c.p.clone().applyMatrix4(inv), c.n.clone().transformDirection(inv), c.a0, c.b0, 14, c.radius ?? 0)
    return { finger: c.finger, joints: f.joints, err: f.err, off: f.off }
  })
}

const FINGER_NAMES = ['index', 'middle', 'ring', 'little'] as const

/** the hand's pose in the object's frame for a hand placed at `offset` from "grip on grip": pg · Hg⁻¹ · offset */
export const handInObject = (t: GripTarget, hand: Hand, offset: Matrix4) => t.pg.clone().multiply(handGripMatrix(hand).invert()).multiply(offset)

export interface Penetration {
  /** the smallest signed distance, m, from any sampled point on any finger's centre line to the object's solids (negative = inside) */
  min: number
  finger: string
  /** per finger */
  per: Record<string, number>
}

/**
 * How near the fingers (every segment of the centre line, `samples` points each, the tips included) come to the object's solids, with the hand
 * at `offset` and the fingers bent to `fits`. A pad that touches is within 1 mm of a surface (the contact's own skin, grip.ts SKIN); nothing may
 * be inside, so `min` ≥ −1e-4 is "no finger through the book".
 */
export function fingerPenetration(t: GripTarget, hand: Hand, offset: Matrix4, fits: readonly { finger: Exclude<Finger, 'palm'>; joints: number[] }[], samples = 8, rest?: readonly number[], frame?: Matrix4): Penetration {
  const sets = t.solidSets ?? (t.solids ? [t.solids] : [])
  const per: Record<string, number> = {}
  if (!sets.length) return { min: Infinity, finger: '', per }
  const M = frame ? frame.clone().multiply(handInObject(t, hand, offset)) : handInObject(t, hand, offset)
  const p = new Vector3()
  const a = new Vector3()
  let min = Infinity
  let which = ''
  // the fingers that touch (their fitted joints) and, when `rest` (a six-number curl) is given, the others at that curl
  const all: { finger: Exclude<Finger, 'palm'>; joints: number[] }[] = fits.slice()
  if (rest) {
    for (const [k, f] of FINGER_NAMES.entries()) if (!all.some((x) => x.finger === f)) {
      const m = fingerModelOf(hand, k, t.side)
      if (m) all.push({ finger: f, joints: tableJoints(m, rest[k], 0) })
    }
    if (!all.some((x) => x.finger === 'thumb')) {
      const m = fingerModelOf(hand, 'thumb', t.side)
      if (m) all.push({ finger: 'thumb', joints: tableJoints(m, rest[4], rest[5]) })
    }
  }
  for (const f of all) {
    const model = fingerModelOf(hand, f.finger === 'thumb' ? 'thumb' : FINGER_NAMES.indexOf(f.finger), t.side)
    if (!model) continue
    const pts = pointsAtJoints(model, f.joints)
    let fm = Infinity
    for (let i = 0; i + 1 < pts.length; i++)
      for (let k = 0; k <= samples; k++) {
        a.copy(pts[i]).lerp(pts[i + 1], k / samples)
        p.copy(a).applyMatrix4(M)
        for (const solids of sets) fm = Math.min(fm, distToBook(p, solids).d)
      }
    per[f.finger] = fm
    if (fm < min) {
      min = fm
      which = f.finger
    }
  }
  return { min, finger: which, per }
}

/**
 * The hand offset and fingers for a target: grip.ts solveContacts, and for an object with solids a cost for every finger inside them (a margin
 * of 0.15 mm, so the finer check never finds a finger inside). The search is local, so when the first solution still has a finger inside the
 * solids or a tip more than 2.9 mm from its contact it is solved again with a heavier cost, a smaller margin and a weaker pull toward the grip frame; the best of the tries
 * (no finger inside first, then the smallest error) is kept.
 */
export function solveTarget(t: GripTarget, hand: Hand): Solved {
  const contacts = contactsInHand(t, hand)
  if (!t.solids) {
    // an object without solids: the plain search; when a tip is left more than 2.9 mm off, once more with scattered starts (the better of the two)
    const first = solveContacts(contacts)
    if (first.worst <= 0.0029) return first
    const again = solveContacts(contacts, 0.02, undefined, 24)
    return again.worst < first.worst ? again : first
  }
  const rest = GRIPS[t.kind][t.side]?.hold
  let best: { sol: Solved; inside: number } | null = null
  // the last try also scatters 20 more starts of the hand: for a hand that cannot make it (the baked spots out of its reach) it is the best the search finds, and a local minimum is left
  for (const [w, margin, keep, scatter] of [[4000, 0.00015, 0.02, 0], [40000, 0.0001, 0.02, 0], [40000, 0.0001, 0.08, 0], [400000, 0.00006, 0.2, 0], [40000, 0.0001, 0.02, 20]] as const) {
    const sol = solveContacts(contacts, keep, (offset, fits) => {
      const pen = fingerPenetration(t, hand, offset, fits, 10, rest).min - margin
      return (pen < 0 ? w * pen * pen : 0) + (t.cost ? t.cost(handInObject(t, hand, offset), hand, fits) : 0)
    }, scatter)
    const inside = Math.min(0, fingerPenetration(t, hand, sol.offset, sol.fits, 12, rest).min + 0.00005)
    const ok = inside === 0 && sol.worst <= 0.0029
    // a finger inside the solids counts far more than a tip error
    const score = (x: { sol: Solved; inside: number }) => x.sol.worst - 10 * x.inside
    if (!best || score({ sol, inside }) < score(best)) best = { sol, inside }
    if (ok) break
  }
  return best!.sol
}
