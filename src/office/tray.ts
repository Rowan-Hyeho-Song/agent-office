// The planner's IN / OUT paper piles (#44, #59). The model has five thin sheets (sheet_h 3 mm, userData from
// Blender); from the default camera five sheets of 3 mm read as one line, so the app draws each sheet 8 mm thick
// (five = 4 cm, still under the tray's upper tier) and shows exactly as many sheets as there is work. The top
// sheet lies a little askew like a paper just dropped on the pile; past five a small amber '+' tab sticks out of
// the top so "more than this" still reads.

import { BufferAttribute, CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type BufferGeometry, type Object3D } from 'three'

/** drawn thickness of one sheet, m (#59: about 0.8 cm) */
export const SHEET_H = 0.008
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
    this.top.name = `${node.name}_top`
    this.top.rotation.y = TOP_TURN
    this.top.position.set(TOP_NUDGE.x, 0, TOP_NUDGE.z)
    node.add(this.top)

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
    node.geometry.computeBoundingBox()
    const box = node.geometry.boundingBox!
    // on the top sheet, just in from the front edge (+z: toward the seat and the room) near the right corner, its
    // local up pointing up and forward (the '+' is symmetric, so whichever face shows is fine)
    this.tab.rotation.set(Math.PI / 2 - TAB_UP, 0, 0)
    const root = { x: node.position.x + box.max.x * 0.55, z: node.position.z + box.max.z - TAB_IN }
    this.tab.position.set(root.x, 0, root.z + (Math.cos(TAB_UP) * TAB_H) / 2)
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

  set(n: number, more: boolean) {
    const l = pileLayout(n, this.sheets, more)
    const node = this.node
    node.visible = l.visible
    this.tab.visible = l.tab
    if (!l.visible) return
    // every modeled sheet drawn SHEET_H thick
    node.scale.y = (this.rest * SHEET_H) / this.sheetH
    node.geometry.setDrawRange(0, l.under ? this.ends[l.under - 1] : 0)
    // local units are the model's (scaled by the node): one modeled sheet = sheet_h
    this.top.position.y = l.under * this.sheetH
    // its root on the top sheet
    this.tab.position.y = node.position.y + l.height + (Math.sin(TAB_UP) * TAB_H) / 2
  }
}
