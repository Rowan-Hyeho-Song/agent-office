// The library's binders in the 3D bookshelf (#65; node table of the Blender PR #73). The glb carries 30 binders
// (3 shelves × 10) each with a spine band, a label window and a SECRET stamp; the app shows one per filed issue:
//   shelf_r<r>_b<k>          body: `binder_cover` cloned per binder (navy; manila when SECRET), `binder_ring` untouched
//   shelf_r<r>_b<k>_band     spine colour band = the file's main agent colour (+ a little emissive)
//   shelf_r<r>_b<k>_label    window onto one cell of a shared 640×384 "spines" canvas: the issue number
//   shelf_r<r>_b<k>_secret   stamp: visible on SECRET binders; falls when the document is approved
//   screen_shelf_r<r>        the folder name plate
// The last binder of a shelf leans −8° about world z around the body's pivot (its bottom right front corner).
// Layout and the label cell maths are pure (src/docs/library.ts); this file only moves things.

import { CanvasTexture, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector3, type Material, type Object3D } from 'three'
import { LABEL_GRID, LEAN_DEG, SHELVES, SLOTS, labelCell, type Binder, type ShelfLayout } from '../docs/library'
import { meshesOf } from './nodes'
import { AGENT_INFO } from './world'

const MANILA = '#d9b877' // --manila
const IVORY = '#efe6d2' // --paper
const INK = '#1f1b14' // --paper-ink
const UNKNOWN_AGENT = '#a39d90' // --agent-x
/** the designer asked for 0.15; the ivory still read grey on the dim shelf, so it is higher (see the PR notes) */
const LABEL_GLOW = 0.4
const Z = new Vector3(0, 0, 1)
const FONT = "'Galmuri11', ui-monospace, monospace"

interface Slot {
  stem: string
  body: Object3D | null
  band: Object3D | null
  label: Object3D | null
  stamp: Object3D | null
  /** the cloned `binder_cover` materials of the body */
  covers: MeshStandardMaterial[]
  bands: MeshStandardMaterial[]
  base: Map<Object3D, { p: Vector3; q: Quaternion }>
  /** the binder shown in this slot now */
  shown: Binder | null
  coverColor: string
}

interface Plate {
  mesh: Mesh
  ctx: CanvasRenderingContext2D
  texture: CanvasTexture
  drawn: string
}

interface Drop {
  slot: Slot
  /** seconds so far / in all */
  t: number
  dur: number
}

const hex = (seat: number | null) => (seat === null ? UNKNOWN_AGENT : (AGENT_INFO[`agent_${seat}`]?.color ?? UNKNOWN_AGENT))

export class ShelfRig {
  private slots = new Map<string, Slot>()
  private plates: Plate[] = []
  private labels: { ctx: CanvasRenderingContext2D; texture: CanvasTexture } | null = null
  private drops: Drop[] = []
  /** file keys that were SECRET at the last layout (a file that stops being SECRET gets its stamp dropped) */
  private secretFiles = new Set<string>()
  private lastLayout: ShelfLayout | null = null
  private tiltQ = new Quaternion()
  private zq = new Quaternion().setFromAxisAngle(Z, MathUtils.degToRad(LEAN_DEG))

  constructor(nodes: Record<string, Object3D>) {
    for (let r = 0; r < SHELVES; r++) {
      for (let k = 0; k < SLOTS; k++) {
        const stem = `shelf_r${r}_b${k}`
        const slot: Slot = {
          stem,
          body: nodes[stem] ?? null,
          band: nodes[`${stem}_band`] ?? null,
          label: nodes[`${stem}_label`] ?? null,
          stamp: nodes[`${stem}_secret`] ?? null,
          covers: [],
          bands: [],
          base: new Map(),
          shown: null,
          coverColor: '',
        }
        for (const o of [slot.body, slot.band, slot.label, slot.stamp]) if (o) slot.base.set(o, { p: o.position.clone(), q: o.quaternion.clone() })
        if (slot.body) {
          for (const m of meshesOf(slot.body)) {
            const mat = m.material as Material
            if (mat.name === 'binder_cover') {
              const own = (mat as MeshStandardMaterial).clone()
              m.material = own
              slot.covers.push(own)
            }
          }
        }
        if (slot.band) {
          for (const m of meshesOf(slot.band)) {
            const own = (m.material as MeshStandardMaterial).clone()
            m.material = own
            slot.bands.push(own)
          }
        }
        slot.coverColor = slot.covers[0] ? `#${slot.covers[0].color.getHexString()}` : ''
        this.hideAll(slot)
        this.slots.set(stem, slot)
      }
    }
    this.setupLabels()
    for (let r = 0; r < SHELVES; r++) this.setupPlate(nodes[`screen_shelf_r${r}`])
  }

  private hideAll(s: Slot) {
    for (const o of [s.body, s.band, s.label, s.stamp]) if (o) o.visible = false
  }

  // ---- labels: one shared canvas, one shared material -------------------------------------------------------------

  private setupLabels() {
    const first = [...this.slots.values()].find((s) => s.label)?.label
    if (!first) return
    const c = document.createElement('canvas')
    c.width = LABEL_GRID.w
    c.height = LABEL_GRID.h
    const texture = new CanvasTexture(c)
    texture.flipY = false // glTF UVs (the cell's top is the label's top)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    const base = meshesOf(first)[0]?.material as MeshStandardMaterial | undefined
    const material = (base ?? new MeshStandardMaterial()).clone()
    material.map = texture
    material.color.set('#ffffff')
    // the ivory reads in the dim shelf: a little emissive, through the same canvas so only the paper glows
    material.emissive.set('#ffffff')
    material.emissiveMap = texture
    material.emissiveIntensity = LABEL_GLOW
    for (const s of this.slots.values()) if (s.label) for (const m of meshesOf(s.label)) m.material = material
    this.labels = { ctx: c.getContext('2d')!, texture }
    this.drawLabels([])
  }

  private drawLabels(binders: Binder[]) {
    if (!this.labels) return
    const { ctx, texture } = this.labels
    ctx.fillStyle = IVORY
    ctx.fillRect(0, 0, LABEL_GRID.w, LABEL_GRID.h)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const b of binders) {
      if (!b.label) continue
      const cell = labelCell(b.k, b.r)
      const size = b.label.length <= 3 ? 26 : b.label.length === 4 ? 20 : 16
      ctx.font = `700 ${size}px ${FONT}`
      ctx.fillText(b.label, cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w - 6)
    }
    texture.needsUpdate = true
  }

  // ---- folder name plates -----------------------------------------------------------------------------------------

  private setupPlate(node: Object3D | undefined) {
    const mesh = node && meshesOf(node)[0]
    if (!mesh) return
    const c = document.createElement('canvas')
    c.width = 1024 // 0.30 × 0.035 m (aspect 8.5714) at 1024 px/m is 307 px wide; drawn at 3.3× for a crisp edge
    c.height = 119
    const texture = new CanvasTexture(c)
    texture.flipY = false
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    const old = mesh.material as MeshBasicMaterial
    mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false })
    old.dispose()
    const ctx = c.getContext('2d')!
    this.plates.push({ mesh, ctx, texture, drawn: '\0' })
    this.drawPlate(this.plates[this.plates.length - 1], '')
  }

  private drawPlate(p: Plate, text: string) {
    if (p.drawn === text) return
    p.drawn = text
    const { ctx, texture } = p
    ctx.fillStyle = '#10141a'
    ctx.fillRect(0, 0, 1024, 119)
    ctx.fillStyle = '#f3ead8'
    ctx.font = `700 64px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 512, 62, 980)
    texture.needsUpdate = true
  }

  /** redraw the canvases once the pixel font is in (before that the fallback font draws) */
  redrawWhenFontsReady() {
    void document.fonts?.load(`700 26px ${FONT}`).then(() => {
      for (const p of this.plates) p.drawn = '\0'
      if (this.lastLayout) this.apply(this.lastLayout)
    })
  }

  // ---- showing the layout -----------------------------------------------------------------------------------------

  /** the binder body meshes now visible, by binder (for clicking) */
  binderOf(object: Object3D): Binder | null {
    for (let o: Object3D | null = object; o; o = o.parent) {
      const slot = this.slots.get(o.name)
      if (slot?.shown && slot.body?.visible) return slot.shown
    }
    return null
  }

  visibleBodies(): Object3D[] {
    const out: Object3D[] = []
    for (const s of this.slots.values()) if (s.shown && s.body) out.push(...meshesOf(s.body))
    return out
  }

  apply(layout: ShelfLayout, animate = true) {
    this.lastLayout = layout
    const want = new Map(layout.binders.map((b) => [b.node, b]))
    const nowSecret = new Set(layout.binders.filter((b) => b.secret).map((b) => b.fileKey))
    for (const slot of this.slots.values()) {
      const b = want.get(slot.stem) ?? null
      // a file that was SECRET and is not any more: the stamp falls (once, and only on a binder that was on show)
      const approved = animate && b && !b.secret && this.secretFiles.has(b.fileKey) && slot.shown?.fileKey === b.fileKey
      slot.shown = b
      this.place(slot, b)
      if (approved) this.startDrop(slot)
    }
    this.secretFiles = nowSecret
    layout.plates.forEach((name, r) => this.plates[r] && this.drawPlate(this.plates[r], name))
    this.drawLabels(layout.binders)
  }

  private place(slot: Slot, b: Binder | null) {
    const falling = this.drops.some((d) => d.slot === slot)
    if (!b) {
      this.hideAll(slot)
      this.drops = this.drops.filter((d) => d.slot !== slot)
      return
    }
    // reset, then lean the last binder about the body's pivot (band and label share it; the stamp has its own)
    for (const [o, base] of slot.base) {
      o.position.copy(base.p)
      o.quaternion.copy(base.q)
    }
    if (b.lean && slot.body) {
      const pivot = slot.body.position
      for (const o of [slot.body, slot.band, slot.label]) o?.quaternion.premultiply(this.zq)
      if (slot.stamp) {
        slot.stamp.position.sub(pivot).applyQuaternion(this.zq).add(pivot)
        slot.stamp.quaternion.premultiply(this.zq)
      }
    }
    for (const o of [slot.body, slot.band, slot.label]) if (o) o.visible = true
    if (slot.stamp) slot.stamp.visible = b.secret || falling
    const color = hex(b.seat)
    for (const m of slot.bands) {
      m.color.set(color)
      m.emissive.set(color).multiplyScalar(0.3)
      m.emissiveIntensity = 1
    }
    // manila while SECRET (and while its stamp is still falling), the binder's own navy otherwise
    const manila = b.secret || falling
    for (const m of slot.covers) this.paintCover(m, manila ? MANILA : slot.coverColor)
  }

  /** manila glows a little (the shelf is dim and lit manila reads olive), the navy does not */
  private paintCover(m: MeshStandardMaterial, color: string) {
    m.color.set(color)
    m.emissive.set(color === MANILA ? MANILA : '#000000')
    m.emissiveIntensity = color === MANILA ? 0.4 : 1
  }

  // ---- the stamp falling ------------------------------------------------------------------------------------------

  private startDrop(slot: Slot) {
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--docs-stamp-ms')) || 0
    if (!slot.stamp || ms <= 0) {
      // reduced motion: no stamp, the cover just turns navy
      if (slot.stamp) slot.stamp.visible = false
      return
    }
    slot.stamp.visible = true
    for (const m of slot.covers) this.paintCover(m, MANILA)
    this.drops.push({ slot, t: 0, dur: ms / 1000 })
  }

  /** advance the falling stamps: a short lift and tilt, then a fall about the stamp's own pivot (0.9 s, --docs-stamp-ms) */
  update(dt: number) {
    if (!this.drops.length) return
    for (const d of this.drops) {
      d.t += dt
      const stamp = d.slot.stamp!
      const base = d.slot.base.get(stamp)!
      const u = Math.min(1, d.t / d.dur)
      const lift = u < 0.2 ? u / 0.2 : 1
      const fall = u < 0.2 ? 0 : ((u - 0.2) / 0.8) ** 2
      const tilt = MathUtils.degToRad(-6 * lift + (-70 * fall))
      stamp.position.copy(base.p)
      stamp.position.y += 0.012 * lift * (1 - fall) - 0.3 * fall
      stamp.quaternion.copy(base.q).premultiply(this.tiltQ.setFromAxisAngle(Z, tilt))
      if (u >= 1) {
        stamp.visible = false
        stamp.position.copy(base.p)
        stamp.quaternion.copy(base.q)
      }
    }
    const done = this.drops.filter((d) => d.t >= d.dur)
    if (done.length) {
      this.drops = this.drops.filter((d) => d.t < d.dur)
      for (const d of done) for (const m of d.slot.covers) this.paintCover(m, d.slot.coverColor)
    }
  }
}
