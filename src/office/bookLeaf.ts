// The one leaf that turns (#231, grips.md "한 장 넘기기"). The glb carries `<book>_page`: two sheets back to back, 16 columns along the width
// (point attribute _PAGE_U, spine 0 → fore-edge 1) × 4 rows (_PAGE_V), its pivot on the spine axis, turned about local z (extras turn_axis z,
// turn_dir 1). The leaf rotates 0 → 180° about the spine; while it does, its outer third lags behind the turn (bent), most at mid-turn, and is
// straight again at the end. The halves never rotate. The bend is done on the CPU on the mesh's own float vertices (17 columns × 10 vertices,
// nothing allocated per frame).

import { Matrix4, Mesh, Quaternion, Vector3, type BufferAttribute, type Object3D } from 'three'

/** the leaf's whole turn, s (grips.md: 0.75, 0.6–0.9) */
export const TURN_S = 0.75
/** how far the outer end lags the inner part at mid-turn, rad (grips.md: 25°) */
export const LAG = (25 * Math.PI) / 180
/** the corner is lifted this far (rad) when the thumb and index take it, before the turn proper */
export const PINCH_LIFT = (8 * Math.PI) / 180

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/** the leaf's angle about the spine at `tau` s from the start of the turn proper (tau < 0: the corner being lifted for the pinch) */
export function leafAngle(tau: number, dur = TURN_S, lead = 0.2): number {
  if (tau <= -lead) return 0
  if (tau < 0) return PINCH_LIFT * smooth(0, 1, (tau + lead) / lead)
  if (tau >= dur) return Math.PI
  return PINCH_LIFT + (Math.PI - PINCH_LIFT) * smooth(0, 1, tau / dur)
}

/** the hand lets go of the leaf (and starts back) this far into the turn, as a fraction of its duration: the index is under the leaf, which must not land on it (angle there ~94°) */
export const PINCH_LET_GO = 0.5

/**
 * The hand goes to the corner and comes back along an arc: the straight blend between the reading pose (behind the cover) and the pinch pose
 * (above the corner) would pass through the book. With k = how far the hand is from the reading pose (0 … 1) it is also pushed, in the book
 * frame, first straight off the fore-edge (+x: the thumb slides off the page, the fingers slide off the cover), and later off the cover and up
 * the page (−y, −z), over the book's top edge. bookGrip.test.ts walks this path and finds no finger inside the book.
 */
export const PINCH_ARC = { x: 0.1, y: -0.12, z: -0.15 }
export function pinchArc(k: number, out: Vector3): Vector3 {
  const s = Math.sin(Math.PI * Math.min(1, Math.max(0, k)))
  const early = s ** 0.4
  const late = s * s
  return out.set(PINCH_ARC.x * early, PINCH_ARC.y * late, PINCH_ARC.z * late)
}

/**
 * The hand's pose and its fingers follow the arc's k late: first the hand only slides off the fore-edge (fingers still as they were on the
 * cover, the thumb on the paper), then it turns toward the corner, and the fingers take the pinch last, so no finger is dragged into the book
 * while it changes shape (and the same backwards on the way home).
 */
export const poseWeight = (k: number) => smooth(0.15, 1, k)
export const fingerWeight = (k: number) => smooth(0.4, 1, k)

/** how much of LAG the leaf shows at angle theta: none flat, most at mid-turn, none again when it lies down (the last 10° are straight) */
export function bendAmount(theta: number): number {
  return Math.sin(Math.min(theta, Math.PI)) ** 0.8
}

/** a leaf's lag at arc position s (0 spine … 1 fore-edge): nothing over the inner part, rising smoothly over the outer third */
export function lagAt(s: number): number {
  return LAG * smooth(0.25, 0.95, s)
}

/** one mesh of the leaf (the paper; a later bake adds a second primitive for the text lines): its vertices and their rest data */
interface Part {
  geo: Mesh['geometry']
  pos: BufferAttribute
  nor: BufferAttribute | null
  /** each vertex's place along the leaf in columns (_PAGE_U · 16, any value: a vertex between two columns is bent between them) */
  col: Float32Array
  y0: Float32Array
  ny: Int8Array
  z0: Float32Array
}

export class LeafBend {
  readonly node: Object3D
  private parts: Part[] = []
  private x0 = 0
  private ds = 0
  private cols = 16
  /** the leaf's polyline in its own frame at the last update: x, y per column, and the direction of each segment */
  readonly px: Float32Array
  readonly py: Float32Array
  readonly phi: Float32Array
  /** the page's top edge (v = 0) in the leaf frame: z */
  readonly zTop: number
  theta = 0
  bend = 0
  /** the leaf's width (the columns' extent) */
  readonly width: number

  /** every mesh under the node that carries _PAGE_U bends, the paper and the text lines alike */
  constructor(node: Object3D) {
    this.node = node
    const meshes: Mesh[] = []
    node.traverse((o) => {
      if ((o as Mesh).isMesh && (o as Mesh).geometry.getAttribute('_page_u')) meshes.push(o as Mesh)
    })
    if (!meshes.length) throw new Error('leaf has no mesh with _PAGE_U')
    let xmin = Infinity
    let xmax = -Infinity
    let zmin = Infinity
    for (const m of meshes) {
      const g = m.geometry
      const pos = g.getAttribute('position') as BufferAttribute
      const nor = (g.getAttribute('normal') as BufferAttribute | undefined) ?? null
      const au = g.getAttribute('_page_u') as BufferAttribute
      const av = g.getAttribute('_page_v') as BufferAttribute | undefined
      const n = pos.count
      const part: Part = { geo: g, pos, nor, col: new Float32Array(n), y0: new Float32Array(n), z0: new Float32Array(n), ny: new Int8Array(n) }
      for (let i = 0; i < n; i++) {
        const u = au.getX(i)
        // the extent of the leaf from the vertices at its edges (the text lines lie inside it)
        if (u < 1e-4) xmin = Math.min(xmin, pos.getX(i))
        if (u > 1 - 1e-4) xmax = Math.max(xmax, pos.getX(i))
        if (!av || av.getX(i) < 1e-4) zmin = Math.min(zmin, pos.getZ(i))
        part.col[i] = Math.min(this.cols, Math.max(0, u * this.cols))
        part.y0[i] = pos.getY(i)
        part.z0[i] = pos.getZ(i)
        part.ny[i] = nor ? (nor.getY(i) >= 0 ? 1 : -1) : 1
      }
      this.parts.push(part)
    }
    this.x0 = xmin
    this.ds = (xmax - xmin) / this.cols
    this.width = xmax - xmin
    this.zTop = zmin
    this.px = new Float32Array(this.cols + 1)
    this.py = new Float32Array(this.cols + 1)
    this.phi = new Float32Array(this.cols)
    this.set(0)
  }

  /** the leaf at angle `theta` (rad) about the spine: the node's turn and the vertices' bend */
  set(theta: number) {
    this.theta = theta
    this.node.rotation.z = theta
    const k = bendAmount(theta)
    this.bend = k
    const C = this.cols
    this.px[0] = this.x0
    this.py[0] = 0
    for (let j = 0; j < C; j++) {
      const a = -k * lagAt((j + 0.5) / C)
      this.phi[j] = a
      this.px[j + 1] = this.px[j] + this.ds * Math.cos(a)
      this.py[j + 1] = this.py[j] + this.ds * Math.sin(a)
    }
    for (const pt of this.parts) {
      const n = pt.pos.count
      for (let i = 0; i < n; i++) {
        // any vertex with a _PAGE_U bends: between columns c0 and c0 + 1 along that segment, with the segment's direction
        const u = pt.col[i]
        const c0 = Math.min(C - 1, Math.floor(u))
        const f = (u - c0) * this.ds
        const a = this.phi[c0]
        const sn = Math.sin(a)
        const co = Math.cos(a)
        const y = pt.y0[i]
        pt.pos.setXYZ(i, this.px[c0] + co * f - sn * y, this.py[c0] + sn * f + co * y, pt.z0[i])
        if (pt.nor) pt.nor.setXYZ(i, -sn * pt.ny[i], co * pt.ny[i], 0)
      }
      pt.pos.needsUpdate = true
      if (pt.nor) pt.nor.needsUpdate = true
      // the bounds follow (the leaf swings about the spine; three culls by the sphere)
      pt.geo.boundingSphere = null
      pt.geo.boundingBox = null
    }
  }

  /**
   * The corner the thumb and index take (the top corner at the fore-edge) as a frame in the BOOK frame (the page node's parent frame): the
   * origin on the leaf's middle surface at the corner, x along the leaf (outward), y the face's normal (up while the leaf lies on the right
   * page), z along the page's height (down the page: the corner is at z = top edge).
   */
  corner(out: Matrix4, theta = this.theta): Matrix4 {
    const q = Q1
    const v = V1
    const C = this.cols
    const k = bendAmount(theta)
    let x = this.x0
    let y = 0
    let a = 0
    for (let j = 0; j < C; j++) {
      a = -k * lagAt((j + 0.5) / C)
      x += this.ds * Math.cos(a)
      y += this.ds * Math.sin(a)
    }
    y += 0.00035
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    // the leaf's own turn about z, then the polyline's end direction
    v.set(ct * x - st * y, st * x + ct * y, this.zTop)
    q.setFromAxisAngle(Z_AXIS, theta + a)
    return out.compose(v, q, ONE)
  }
}

const Q1 = new Quaternion()
const V1 = new Vector3()
const Z_AXIS = new Vector3(0, 0, 1)
const ONE = new Vector3(1, 1, 1)

/**
 * The pinch corner of a leaf at angle `theta` as a frame in the book frame, from the page's size alone (the leaf's polyline, as LeafBend.set
 * draws it): used once to place the pinch grip, not per frame. `x0` the leaf's first column (0.003 m), `width` page_w, `zTop` = −page_h / 2.
 */
export function cornerOf(theta: number, x0: number, width: number, zTop: number, out = new Matrix4()): Matrix4 {
  const C = 16
  const ds = width / C
  let x = x0
  let y = 0
  let a = 0
  const k = bendAmount(theta)
  for (let j = 0; j < C; j++) {
    a = -k * lagAt((j + 0.5) / C)
    x += ds * Math.cos(a)
    y += ds * Math.sin(a)
  }
  y += 0.00035
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  return out.compose(new Vector3(ct * x - st * y, st * x + ct * y, zTop), new Quaternion().setFromAxisAngle(Z_AXIS, theta + a), ONE)
}
