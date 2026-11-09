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
// Until it is baked, `ensurePaper` builds the same nodes in code (same names, frames, pivots, fold signs). When the glb has them
// `ensurePaper` does nothing and `paperOf` reads the glb's: that is the whole switch (see the report of #262).
import { BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'

/** the sheet's size, m (A4) */
export const PAPER = { w: 0.21, l: 0.297, t: 0.0004, color: '#f4f1ea', ink: '#9a9a9a', lines: 6 } as const
/** where the sheet rests when nobody has it: above the planner's IN tray (it is hidden then) */
export const PAPER_HOME = { pos: [-2.94, 0.835, -1.972] as const, rotY: Math.PI }
/** the pinch spots on the short edges, in the sheet's frame: 1.5 cm in from the edge (the fingers point into the paper) */
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

const sheetMaterial = () => new MeshStandardMaterial({ color: PAPER.color, roughness: 0.9, emissive: PAPER.color, emissiveIntensity: 0.12 })
const inkMaterial = () => new MeshStandardMaterial({ color: PAPER.ink, roughness: 1 })

/** one half of the sheet: the leaf and three grey text lines (a: the near half z < 0, b: the far half z > 0) */
function half(name: string, side: -1 | 1): Object3D {
  const g = new Group()
  g.name = name
  g.userData = { live: 'bot', fold: { axis: 'x', sign: side === -1 ? 1 : -1 } }
  const leaf = new Mesh(new BoxGeometry(PAPER.w, PAPER.t, PAPER.l / 2), sheetMaterial())
  leaf.position.set(0, 0, (side * PAPER.l) / 4)
  g.add(leaf)
  // three lines per half, 12 cm long, one every 3.5 cm, the first 2.5 cm from the page's outer margin
  for (let i = 0; i < PAPER.lines / 2; i++) {
    const line = new Mesh(new BoxGeometry(PAPER.w * 0.62, PAPER.t, 0.006), inkMaterial())
    line.position.set(0, PAPER.t, side * (0.03 + i * 0.035))
    g.add(line)
  }
  return g
}

/** build the sheet in code when the glb does not have it yet (same names, frames, pivots and fold signs as the baked one) */
export function ensurePaper(scene: Object3D, nodes: Record<string, Object3D>) {
  if (nodes[NAMES.node]) return
  const node = new Group()
  node.name = NAMES.node
  node.userData = { prop: 'paper', live: 'prop', home: { pos: [...PAPER_HOME.pos], rot: [0, PAPER_HOME.rotY, 0] }, size: [PAPER.w, PAPER.l, PAPER.t], temp: true }
  // an invisible 2 mm core
  const core = new Mesh(new BoxGeometry(PAPER.w, 0.002, PAPER.l), new MeshStandardMaterial({ visible: false }))
  core.name = 'prop_paper_core'
  node.add(core)
  const empty = (name: string, x: number, y: number, z: number, extras: Record<string, unknown> = {}) => {
    const e = new Object3D()
    e.name = `${NAMES.node}_${name}`
    e.position.set(x, y, z)
    e.userData = extras
    node.add(e)
  }
  empty('grip_r', 0, 0, -EDGE_Z, { grip_for: 'r', edge: 'near' })
  empty('grip_r_far', 0, 0, EDGE_Z, { grip_for: 'r', edge: 'far' })
  empty('contact_thumb_near', 0.01, PAPER.t, -EDGE_Z)
  empty('contact_thumb_far', 0.01, PAPER.t, EDGE_Z)
  empty('contact_index_near', -0.01, -PAPER.t, -EDGE_Z)
  empty('contact_index_far', -0.01, -PAPER.t, EDGE_Z)
  empty('contact_palm', 0, -PAPER.t, 0)
  node.position.set(...PAPER_HOME.pos)
  node.rotation.set(0, PAPER_HOME.rotY, 0)
  scene.add(node)
  const a = half(NAMES.a, -1)
  const b = half(NAMES.b, 1)
  for (const h of [a, b]) {
    h.position.copy(node.position)
    h.quaternion.copy(node.quaternion)
    scene.add(h)
  }
  node.visible = a.visible = b.visible = false
  scene.updateMatrixWorld(true)
  for (const n of [node, a, b]) n.traverse((o) => o.name && !nodes[o.name] && (nodes[o.name] = o))
}

/** the sheet's nodes (glb or temporary) with its pinch spots; null when there is no sheet at all */
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
