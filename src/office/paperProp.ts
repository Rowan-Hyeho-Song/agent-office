// The loose sheet of paper (#262, docs/design/paper-pass.md 5). This module is the ONE place that knows where the sheet comes from.
//
// The 3D artist bakes `prop_paper` into office.glb (node table of #262):
//   prop_paper            top level, live prop, pivot at the sheet's centre (on the fold line), extras prop "paper", home, size [0.21, 0.297, 0.0004];
//                         its own mesh is an invisible 2 mm core
//   prop_paper_a / _b     top level, live bot, same pivot; the fold line is local x; extras fold {axis "x", sign}: a +1, b -1.
//                         + folds that half up over the other, text inside. a is the near half (z < 0), b the far half (z > 0)
//   children of prop_paper (empties): _grip_r (near short edge, z -0.1335), _grip_r_far (far edge, z +0.1335), _contact_thumb_near / _far,
//                         _contact_index_near / _far, _contact_palm
//   frame: x = the short side (0.21), z = the long side (0.297), +y = the text side
// `paperOf` reads them by these names; the grip empties give the pinch spots.
import { Euler, Object3D, Quaternion, Vector3, type Mesh } from 'three'

/** the sheet's size, m (A4) */
export const PAPER = { w: 0.21, l: 0.297, t: 0.0004, color: '#f4f1ea', ink: '#9a9a9a', lines: 6 } as const
/** the pinch spots on the short edges (z +-0.1335, the glb's grip empties) when a model lacks them: 1.5 cm in from the edge */
const EDGE_Z = PAPER.l / 2 - 0.015

export interface PaperProp {
  node: Object3D
  a: Object3D
  b: Object3D
  /** the pinch spots in the sheet's frame: near short edge (z -) and far short edge (z +) */
  gripNear: Vector3
  gripFar: Vector3
  /** the underside's centre (where a palm presses) */
  palm: Vector3
  /** every mesh of the sheet (the halves), for fading */
  meshes: Mesh[]
}

const NAMES = { node: 'prop_paper', a: 'prop_paper_a', b: 'prop_paper_b' } as const

/** the sheet's nodes of the glb with their pinch spots; null when the model has no sheet (an older glb: then only the plane passes papers) */
export function paperOf(nodes: Record<string, Object3D>): PaperProp | null {
  const node = nodes[NAMES.node]
  const a = nodes[NAMES.a]
  const b = nodes[NAMES.b]
  if (!node || !a || !b) return null
  const spot = (name: string, fallback: Vector3) => {
    const e = nodes[`${NAMES.node}_${name}`]
    return e ? e.position.clone() : fallback
  }
  const meshes: Mesh[] = []
  for (const h of [a, b]) h.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh))
  return {
    node,
    a,
    b,
    gripNear: spot('grip_r', new Vector3(0, 0, -EDGE_Z)),
    gripFar: spot('grip_r_far', new Vector3(0, 0, EDGE_Z)),
    palm: spot('contact_palm', new Vector3(0, -PAPER.t, 0)),
    meshes,
  }
}

const FOLD = new Quaternion()
const AXIS_X = new Vector3(1, 0, 0)

/**
 * Put the sheet at a world pose with its fold angle (0 = flat, PI = folded in half, text inside): the halves ride on the node.
 * The a half turns +angle and the b half -angle about local x, so folding `angle` turns a up over b (the baked signs), b stays.
 */
export function placePaper(p: PaperProp, pos: Vector3, quat: Quaternion, fold: number) {
  p.node.position.copy(pos)
  p.node.quaternion.copy(quat)
  for (const [h, sign] of [[p.a, 1], [p.b, 0]] as const) {
    h.position.copy(pos)
    FOLD.setFromAxisAngle(AXIS_X, sign * fold)
    h.quaternion.copy(quat).multiply(FOLD)
  }
}

/** a world point of a pinch spot of the sheet (in the sheet's frame) at a pose */
export function spotWorld(spot: Vector3, pos: Vector3, quat: Quaternion, out = new Vector3()) {
  return out.copy(spot).applyQuaternion(quat).add(pos)
}

export const eulerY = (y: number) => new Quaternion().setFromEuler(new Euler(0, y, 0))
