// The planner's IN / OUT paper piles (#44, #59). The model has five thin sheets (sheet_h 3 mm, userData from
// Blender); from the default camera five sheets of 3 mm read as one line, so the app draws each sheet 8 mm thick
// (five = 4 cm, still under the tray's upper tier) and shows exactly as many sheets as there is work. The top
// sheet lies a little askew like a paper just dropped on the pile; past five a small amber '+' tab sticks out of
// the top so "more than this" still reads.

import { BufferAttribute, CanvasTexture, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry } from 'three'

/** drawn thickness of one sheet, m (#59: about 0.8 cm) */
export const SHEET_H = 0.008
/** #370 B3 a sheet in a hand is drawn this thin, m */
export const HELD_T = 0.001
/**
 * the top sheet: turned and nudged so the pile doesn't look like a block. The tray leaves ~5 mm either side of a
 * sheet (wider turns poke through its side walls), and the sheets sit against its front rail, so the offset goes
 * back, where there is room.
 */
const TOP_TURN = 0.035
const TOP_NUDGE = { x: 0, z: -0.01 }
/**
 * the '+' tab: a flag standing on the top sheet near its front-right corner, leaning toward the room. Its height
 * stays under the tier above (about 3 cm over a full pile): 0.03 × sin 55° ≈ 2.5 cm.
 */
const TAB_W = 0.03
const TAB_H = 0.03
const TAB_IN = 0.012
const TAB_UP = 0.96
const TAB_GLOW = 0.6
/** the paper's own warm glow, as a fraction of its colour */
const PAPER_GLOW = 0.25
const AMBER = '#ffb347' // --agent-0 / --color-amber
const INK = '#2a1e1a'

/**
 * Reorder a stack mesh's triangles bottom sheet first and return, for each sheet, the index count up to and
 * including it (draw the first k sheets with drawRange(0, ends[k − 1])). A triangle belongs to the sheet its
 * centroid sits in, so the order Blender exported in doesn't matter. Pure apart from mutating `geo`.
 */
export function sortSheets(geo: BufferGeometry, sheetH: number, sheets: number): number[] {
  const pos = geo.getAttribute('position')
  if (!geo.index) geo.setIndex(Array.from({ length: pos.count }, (_, i) => i))
  const index = geo.index!
  const tris: { band: number; v: [number, number, number] }[] = []
  for (let t = 0; t < index.count; t += 3) {
    const v: [number, number, number] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    const cy = (pos.getY(v[0]) + pos.getY(v[1]) + pos.getY(v[2])) / 3
    tris.push({ band: Math.max(0, Math.min(sheets - 1, Math.floor(cy / sheetH))), v })
  }
  tris.sort((a, b) => a.band - b.band) // stable: keeps each sheet's own order
  const out = new (pos.count > 65535 ? Uint32Array : Uint16Array)(index.count)
  const ends = new Array<number>(sheets).fill(0)
  tris.forEach((tri, i) => {
    out.set(tri.v, i * 3)
    ends[tri.band] = i * 3 + 3
  })
  // a sheet with no triangles ends where the one below it does
  for (let k = 1; k < sheets; k++) ends[k] = Math.max(ends[k], ends[k - 1])
  geo.setIndex(new BufferAttribute(out, 1))
  return ends
}

/** how the pile looks for n sheets of work (pure; the 3D class below applies it) */
export function pileLayout(n: number, sheets: number, more: boolean) {
  const shown = Math.max(0, Math.min(sheets, Math.floor(n) || 0))
  return {
    visible: shown > 0,
    /** sheets in the straight part of the pile (the top one is drawn askew on its own) */
    under: Math.max(0, shown - 1),
    /** height of the top sheet's bottom above the tray floor, m */
    topAt: Math.max(0, shown - 1) * SHEET_H,
    /** height of the pile's top, m */
    height: shown * SHEET_H,
    tab: more && shown > 0,
  }
}

export class TrayPile {
  private node: Mesh
  private top: Mesh
  private tab: Mesh
  private ends: number[]
  private sheets: number
  private sheetH: number
  private rest: number
  /** #370 B3 the top sheet taken in a hand (its world pose while lifted), and laid back squared (until the pile's count changes) */
  private lifted = false
  /** #370 B3 the top sheet's unstretched frame (desk_0_in_top): its grips and contacts */
  private frame: Object3D
  /** #370 B3b the pile's own place (node local) and its size (node frame: the sheets' box, x/z in m, y the drawn height) */
  private home: { p: Vector3; q: Quaternion }
  private box: { min: Vector3; max: Vector3 }
  private height = 0
  private posed = false
  private squared = false
  private count = -1

  /** one per node (React StrictMode builds the desk twice; the geometry must be sorted once) */
  static of(node: Object3D | undefined) {
    if (!(node instanceof Mesh)) return null
    return (node.userData.trayPile ??= new TrayPile(node)) as TrayPile
  }

  private constructor(node: Mesh) {
    this.node = node
    this.sheets = (node.userData.sheets as number) || 5
    this.sheetH = (node.userData.sheet_h as number) || 0.003
    this.rest = node.scale.y
    this.ends = sortSheets(node.geometry, this.sheetH, this.sheets)

    // the room's cool real-time light turns the warm white paper (#efece4) blue-grey, like metal plates: a faint
    // warm glow of its own keeps it reading as paper (designer, #59). A copy, so nothing else sharing it changes.
    if (node.material instanceof MeshStandardMaterial) {
      const paper = node.material.clone()
      paper.emissive.copy(paper.color).multiplyScalar(PAPER_GLOW)
      node.material = paper
    }

    // the top sheet: the bottom sheet's triangles again, as a child (inherits the sheet scale)
    const one = node.geometry.clone()
    one.setDrawRange(0, this.ends[0])
    this.top = new Mesh(one, node.material)
    this.top.name = `${node.name}_top_sheet`
    this.top.rotation.y = TOP_TURN
    this.top.position.set(TOP_NUDGE.x, 0, TOP_NUDGE.z)
    node.add(this.top)

    // #370 B3 the top sheet's own frame, unstretched (the pile draws each sheet SHEET_H thick by scaling its node: a hand's fit is in metres), at the
    // sheet's bottom face: it lies where the top sheet lies, or where a hand holds it. Its grip frames and contacts are its children.
    this.home = { p: node.position.clone(), q: node.quaternion.clone() }
    this.frame = new Object3D()
    this.frame.name = `${node.name}_top`
    this.frame.matrixAutoUpdate = false
    node.parent?.add(this.frame)

    // (grips.md 서류 한 장 집기): the top sheet's front-right corner pinched on the pile, the thumb on its drawn face (SHEET_H up) and the index under
    // it, the hand beside the corner (its grip frame: the palm toward the sheet, the fingers along -z into it, the thumb up). Contacts' own z is out of
    // the surface.
    node.geometry.computeBoundingBox()
    const bb = node.geometry.boundingBox!
    this.box = { min: bb.min.clone(), max: bb.max.clone() }
    const corner = { x: bb.max.x - 0.015, z: bb.max.z - 0.015 }
    const empty = (suffix: string, p: [number, number, number], q: Quaternion) => {
      const o = new Object3D()
      o.name = `${node.name}_top_${suffix}`
      o.position.set(...p)
      o.quaternion.copy(q)
      this.frame.add(o)
    }
    const X = new Vector3(1, 0, 0)
    empty('contact_thumb', [corner.x, SHEET_H, corner.z], new Quaternion().setFromAxisAngle(X, -Math.PI / 2))
    empty('contact_index', [corner.x, 0, corner.z], new Quaternion().setFromAxisAngle(X, Math.PI / 2))
    empty('grip_r', [corner.x + 0.02, SHEET_H / 2, corner.z + 0.05], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2))
    // read held by its long sides (grips.md 낱장 옆 쥐고 읽기, as the loose sheet: paperSide.ts): each long edge 1.5 cm in, 45 % up from the near short
    // edge (+z: the reader's side), the thumb on the face and the index under it. The reader's left is -x. The grip frames are the loose sheet's turned
    // half round (its reader is at -z).
    const Y = new Vector3(0, 1, 0)
    const Z = new Vector3(0, 0, 1)
    const at = bb.max.z - 0.45 * (bb.max.z - bb.min.z)
    for (const [side, x] of [['l', bb.min.x + 0.015], ['r', bb.max.x - 0.015]] as const) {
      const g = `grip_side_${side}`
      empty(g, [x, HELD_T / 2, at], new Quaternion().setFromAxisAngle(Y, Math.PI).multiply(new Quaternion().setFromAxisAngle(Z, ((side === 'l' ? -1 : 1) * Math.PI) / 2)))
      empty(`${g}_contact_thumb`, [x, HELD_T, at], new Quaternion().setFromAxisAngle(X, -Math.PI / 2))
      empty(`${g}_contact_index`, [x, 0, at], new Quaternion().setFromAxisAngle(X, Math.PI / 2))
    }
    // the sheet in a hand as a solid for the fit (no finger through it), in its frame
    this.frame.userData.sheetBox = { min: [bb.min.x, 0, bb.min.z], max: [bb.max.x, HELD_T, bb.max.z] }

    // the '+' tab lives next to the pile, not under it, so the pile's y scale doesn't stretch it
    // lit like the pile, plus a weak glow of its own so it still shows as a dot from the default camera (designer:
    // amber, about 0.6, tone mapped; no brighter). The texture is also the glow map, so the '+' stays dark.
    const label = TrayPile.tabTexture()
    this.tab = new Mesh(
      new PlaneGeometry(TAB_W, TAB_H),
      new MeshStandardMaterial({ map: label, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: TAB_GLOW, roughness: 0.9, side: DoubleSide, transparent: true }),
    )
    this.tab.name = `${node.name}_more`
    this.tab.visible = false
    node.parent?.add(this.tab)
    const box = bb
    // on the top sheet, just in from the front edge (+z: toward the seat and the room) near the right corner, its
    // local up pointing up and forward (the '+' is symmetric, so whichever face shows is fine)
    this.tab.rotation.set(Math.PI / 2 - TAB_UP, 0, 0)
    const root = { x: node.position.x + box.max.x * 0.55, z: node.position.z + box.max.z - TAB_IN }
    this.tab.position.set(root.x, 0, root.z + (Math.cos(TAB_UP) * TAB_H) / 2)
    this.place(this.topRest())
  }

  private static tabTexture() {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 56
    const g = c.getContext('2d')!
    g.fillStyle = AMBER
    g.beginPath()
    g.roundRect(2, 2, 60, 52, 10)
    g.fill()
    g.fillStyle = INK
    g.fillRect(28, 12, 8, 32)
    g.fillRect(16, 24, 32, 8)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
    return t
  }

  /** #370 B3 the top sheet's frame (its grips and contacts are its children: desk_0_in_top_grip_r, _contact_thumb, _contact_index, _grip_side_l/r) */
  get topNode(): Object3D {
    return this.frame
  }

  /** #370 B3b the pile as it rests (world, without the sheet stretch), its size (x / z of a sheet, m) and drawn height (m) */
  pileRest(): Matrix4 {
    const parent = this.node.parent
    parent?.updateWorldMatrix(true, false)
    const local = new Matrix4().compose(this.home.p, this.home.q, new Vector3(1, 1, 1))
    return parent ? parent.matrixWorld.clone().multiply(local) : local
  }
  get pileSize() {
    return { min: this.box.min.clone(), max: this.box.max.clone(), height: this.height }
  }

  /** #370 B3b the whole pile held at `world` (its pose without the stretch: the hands square it), or back where it rests (null); the '+' tab hides meanwhile */
  pose(world: Matrix4 | null) {
    const node = this.node
    if (!world) {
      if (!this.posed) return
      this.posed = false
      node.position.copy(this.home.p)
      node.quaternion.copy(this.home.q)
    } else {
      this.posed = true
      const parent = node.parent
      parent?.updateWorldMatrix(true, false)
      const local = parent ? parent.matrixWorld.clone().invert().multiply(world) : world.clone()
      const sc = new Vector3()
      local.decompose(node.position, node.quaternion, sc)
    }
    node.updateMatrixWorld(true)
    if (!this.lifted) this.place(this.topRest())
  }

  /** the frame where the sheet is (world) */
  private place(world: Matrix4) {
    const parent = this.frame.parent
    parent?.updateWorldMatrix(true, false)
    this.frame.matrix.copy(parent ? parent.matrixWorld.clone().invert().multiply(world) : world)
    this.frame.updateMatrixWorld(true)
  }

  /** the top sheet's world pose as it lies on the pile, without the pile's sheet stretch (`squared`: laid straight, not askew) */
  topRest(squared = this.squared): Matrix4 {
    this.node.updateWorldMatrix(true, false)
    const local = new Matrix4().compose(
      new Vector3(squared ? 0 : TOP_NUDGE.x, this.top.position.y, squared ? 0 : TOP_NUDGE.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), squared ? 0 : TOP_TURN),
      new Vector3(1, 1, 1),
    )
    const m = new Matrix4().multiplyMatrices(this.node.matrixWorld, local)
    // drop the pile's sheet stretch (y) from the pose
    const p = new Vector3()
    const q = new Quaternion()
    const sc = new Vector3()
    m.decompose(p, q, sc)
    return new Matrix4().compose(p, q, new Vector3(1, 1, 1))
  }

  /**
   * #370 B3 the top sheet held at `world` (its pose without the stretch: drawn a sheet thin, 1 mm), or back on the pile (null): laid `squared` there
   * (straight on the pile's edges) until the count changes.
   */
  lift(world: Matrix4 | null, squared = false) {
    const top = this.top
    if (world) {
      this.lifted = true
      this.node.updateWorldMatrix(true, false)
      const thin = new Matrix4().makeScale(1, HELD_T / this.sheetH, 1)
      top.matrixAutoUpdate = false
      top.matrix.copy(this.node.matrixWorld).invert().multiply(world).multiply(thin)
      top.updateMatrixWorld(true)
      this.place(world)
      return
    }
    if (this.lifted || squared) {
      this.lifted = false
      if (squared) this.squared = true
      top.matrixAutoUpdate = true
      top.rotation.set(0, this.squared ? 0 : TOP_TURN, 0)
      top.position.x = this.squared ? 0 : TOP_NUDGE.x
      top.position.z = this.squared ? 0 : TOP_NUDGE.z
      top.updateMatrixWorld(true)
    }
    this.place(this.topRest())
  }

  set(n: number, more: boolean) {
    // a new count: the top sheet lies askew again (as dropped on the pile)
    if (n !== this.count && this.count >= 0 && this.squared && !this.lifted) {
      this.squared = false
      this.lift(null)
    }
    this.count = n
    const l = pileLayout(n, this.sheets, more)
    const node = this.node
    node.visible = l.visible
    this.tab.visible = l.tab && !this.posed
    if (!l.visible) return
    // every modeled sheet drawn SHEET_H thick
    node.scale.y = (this.rest * SHEET_H) / this.sheetH
    node.geometry.setDrawRange(0, l.under ? this.ends[l.under - 1] : 0)
    // local units are the model's (scaled by the node): one modeled sheet = sheet_h
    this.top.position.y = l.under * this.sheetH
    this.height = l.height
    // its root on the top sheet
    this.tab.position.y = node.position.y + l.height + (Math.sin(TAB_UP) * TAB_H) / 2
    // the top sheet's frame where it lies (a hand that holds it places it: lift)
    if (!this.lifted) this.place(this.topRest())
  }
}
