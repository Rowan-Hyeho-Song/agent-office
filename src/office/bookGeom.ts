// The open book as geometry (#231, grips.md 1 "펼친 책 쥐기" / "한 장 넘기기"). Pure three.js math, no scene.
//
// Book frame = the prop's frame (prop_book, prop_shelfbook_<k>): the origin on the spine axis at mid thickness, the pages along +x
// (width W), the spine along z (height H), the thickness along y. The lower half (_r) lies under y = 0, the upper one (_l, the front
// cover) above; a reader holds the book open flat (flat, 180°: _l turned about z by π; the app lifts both halves by LIFT, below), so both covers' outer faces are at
// y = −T/2 and the two paper blocks have their tops at y = 0. The held book's +z runs DOWN the reader's view (playStage: z = right × face),
// so a page's top edge is at z = −H/2.
//
// What the model gives and what this derives (the Blender bake, assets/blender/office_bake.py make_book): each half is a cover board
// of 2 mm at its outer face and a paper block in two steps (the fore-edge hollows a little). The boxes below are those solids; the
// test (bookGrip.test.ts) checks them against the baked meshes' bounds so a re-bake that moves them is noticed.

import { Matrix4, Vector3, type Object3D } from 'three'

export interface BookDims {
  /** page width (the cover's extent along x), height along the spine, full thickness, m */
  W: number
  H: number
  T: number
}

/** the cover board's thickness (make_book: box (W, 0.002, H)) and the first paper step's (0.004) */
export const COVER_T = 0.002
const STEP_T = 0.004

/**
 * The open book's angle between its two halves: 150° (grips.md, designer 2026-11-10 #231). The bake lies both halves flat (180°); the app lifts each
 * one about the spine by LIFT = 15° (the lower half +LIFT about local z, the upper one turned by π − LIFT). The one place the angle is set.
 */
export const OPEN_ANGLE = (150 * Math.PI) / 180
export const LIFT = (Math.PI - OPEN_ANGLE) / 2
/** a half's rotation about its spine (local z) when the book is open: the lower half is raised by LIFT, the upper one lies at π − LIFT */
export const halfAngle = (half: 'l' | 'r') => (half === 'r' ? LIFT : Math.PI - LIFT)

/** the dimensions from the baked halves (the node's mesh bounds in its own frame: pivot on the spine) */
export function bookDimsOf(l: Object3D, r: Object3D): BookDims {
  const box = (n: Object3D) => {
    let b: { min: Vector3; max: Vector3 } | null = null
    n.traverse((o) => {
      const g = (o as { geometry?: { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void } }).geometry
      if (!g) return
      if (!g.boundingBox) g.computeBoundingBox()
      const bb = g.boundingBox!
      b = b ? { min: b.min.clone().min(bb.min), max: b.max.clone().max(bb.max) } : { min: bb.min.clone(), max: bb.max.clone() }
    })
    return b!
  }
  const bl = box(l)
  const br = box(r)
  return { W: br.max.x, H: 2 * bl.max.z, T: -2 * br.min.y }
}

export interface BookBox {
  name: string
  half: 'l' | 'r'
  /** the box in its half's frame (the lower half's frame: y < 0; the upper half is the same turned by π − LIFT about z) */
  min: Vector3
  max: Vector3
  /** book frame → box frame */
  toBox: Matrix4
}

/** the solids of the open book in the book frame: per half the cover board, the two paper steps and the spine's strip */
export function bookBoxes(d: BookDims, lift = LIFT): BookBox[] {
  const { W, H, T } = d
  const t2 = T / 2
  const mk = (name: string, x0: number, x1: number, y0: number, y1: number, hz: number) => ({ name, min: new Vector3(x0, y0, -hz), max: new Vector3(x1, y1, hz) })
  const lower = [
    mk('cover', 0, W, -t2, -t2 + COVER_T, H / 2),
    mk('paper_a', 0, W - 0.0055, -STEP_T, 0, (H - 0.01) / 2),
    mk('paper_b', 0.002, W - 0.004, -(t2 - COVER_T), -STEP_T, (H - 0.01) / 2),
    mk('spine', -0.003, 0, -t2, 0, H / 2),
  ]
  const out: BookBox[] = []
  // each half is turned about the spine: book frame → box frame is the inverse of that turn
  const Rinv = new Matrix4().makeRotationZ(-(Math.PI - lift))
  const Rr = new Matrix4().makeRotationZ(-lift)
  const flip = (b: ReturnType<typeof mk>) => ({ ...b, min: new Vector3(b.min.x, -b.max.y, b.min.z), max: new Vector3(b.max.x, -b.min.y, b.max.z) })
  for (const b of lower) out.push({ ...b, half: 'r', toBox: Rr.clone() })
  // the upper half is built like the lower one with y mirrored, then turned about the spine
  for (const b of lower) {
    const f = flip(b)
    out.push({ name: b.name, half: 'l', min: f.min, max: f.max, toBox: Rinv.clone() })
  }
  return out
}

const q = new Vector3()
/** the signed distance from `p` (book frame) to a box: negative inside (the distance to the nearest face), positive outside */
export function distToBox(p: Vector3, b: BookBox): number {
  q.copy(p).applyMatrix4(b.toBox)
  const dx = Math.max(b.min.x - q.x, q.x - b.max.x)
  const dy = Math.max(b.min.y - q.y, q.y - b.max.y)
  const dz = Math.max(b.min.z - q.z, q.z - b.max.z)
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0))
  return out > 0 ? out : Math.max(dx, dy, dz)
}

/** the smallest signed distance from `p` to any solid of the book, and which one */
export function distToBook(p: Vector3, boxes: readonly BookBox[]): { d: number; box: BookBox } {
  let best = Infinity
  let which = boxes[0]
  for (const b of boxes) {
    const d = distToBox(p, b)
    if (d < best) {
      best = d
      which = b
    }
  }
  return { d: best, box: which }
}

// ------------------------------------------------------------------------------------------------------ the reading grip

/** the four fingers' tips land this far apart down the cover (the fingers lie side by side), m */
const FINGER_PITCH = 0.02
/** how far each finger reaches along the cover beyond the common line (m, toward the spine): the middle finger is longest, the little one shortest */
const REACH = [0, 0.004, -0.003, -0.012]
/** the thumb lands this far inside the paper block's fore-edge, m (grips.md: within 1.5 cm) */
const THUMB_IN = 0.008
/** how far above the paper's top the right thumb rests when a leaf lies there (its two sheets stand 0.4 mm proud), m */
const LEAF_ON_PAGE = 0.0004
/** every pad is aimed this far off its surface (0.5 mm; the fit adds its own 0.3 mm skin): well inside the spec's "within 1 mm", and a joint that dips a fraction of a millimetre is still not inside the book */
const HOVER = 0.0005

export interface BookContact {
  finger: 'index' | 'middle' | 'ring' | 'little' | 'thumb'
  p: Vector3
  n: Vector3
  /** the pad may land anywhere on a disc of this radius round p (m): where exactly on the cover or on the paper is not what the grip is about */
  radius: number
}

export const PAD_DISC = 0.006

/**
 * Where each finger lands when a hand holds the open book (spec): the four fingers on the cover's outer face (normal −y) in the lower
 * third of the page, side by side, their tips `inward` of the fore-edge; the thumb alone comes round to the paper's top (normal +y) within
 * 1.5 cm of the fore-edge, on the index side (nearest the page's top). `side` = which half the hand holds: l = the left one (x < 0).
 */
export function readingContacts(d: BookDims, side: 'l' | 'r', lift = LIFT): BookContact[] {
  const sx = side === 'l' ? -1 : 1
  const bottom = d.H / 2 - 0.016
  const xTip = sx * (d.W - 0.07)
  const out: BookContact[] = []
  const names = ['index', 'middle', 'ring', 'little'] as const
  for (let k = 0; k < 4; k++) out.push({ finger: names[k], p: new Vector3(xTip - sx * REACH[k], -d.T / 2 - HOVER, bottom - (3 - k) * FINGER_PITCH), n: new Vector3(0, -1, 0), radius: PAD_DISC })
  const zThumb = bottom - 3 * FINGER_PITCH - 0.008
  out.push({ finger: 'thumb', p: new Vector3(sx * (d.W - 0.004 - THUMB_IN), (side === 'r' ? LEAF_ON_PAGE : 0) + HOVER, zThumb), n: new Vector3(0, 1, 0), radius: PAD_DISC })
  // the half is lifted: the flat places turn with it about the spine
  const R = new Matrix4().makeRotationZ(side === 'r' ? lift : -lift)
  for (const c of out) {
    c.p.applyMatrix4(R)
    c.n.transformDirection(R)
  }
  return out
}

/** the hand's grip frame onto the book for the reading grip (book frame): the palm (grip +x on the left, −x on the right) toward the cover, the fingers (−y) pointing inward */
export function readingGrip(d: BookDims, side: 'l' | 'r', lift = LIFT): Matrix4 {
  const sx = side === 'l' ? -1 : 1
  const bottom = d.H / 2 - 0.016
  const zMid = bottom - 1.5 * FINGER_PITCH
  // grip x = ∓y (the palm into the cover), grip y = sx·x (the fingers run to −y: inward), grip z = +z (a right-handed frame on both sides)
  const x = new Vector3(0, -sx, 0)
  const y = new Vector3(sx, 0, 0)
  const z = new Vector3(0, 0, 1)
  const m = new Matrix4().makeBasis(x, y, z)
  // the palm's centre: 6.5 cm behind the fingertips along the fingers, 2 cm off the cover
  const pos = new Vector3(sx * (d.W - 0.07) + sx * 0.065, -d.T / 2 - 0.02, zMid)
  return new Matrix4().makeRotationZ(side === 'r' ? lift : -lift).multiply(m.setPosition(pos))
}
