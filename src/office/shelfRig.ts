// The library's binders in the 3D bookshelf (#65; node table of the Blender PR #73, three rows of 21, one row per project, #280, room-280.md 9.2).
// The glb carries 3 x 21 binders (extras shelf = row r / slot k) each with a spine band, a label window and a SECRET stamp; the app shows one per filed issue:
//   shelf_r<r>_b<k>        body: `binder_cover` cloned per binder (navy; manila when SECRET), `binder_ring` untouched
//   shelf_r<r>_b<k>_band     spine colour band = the file's first topic badge colour (+ a little emissive), 15% darker when done
//   shelf_r<r>_b<k>_label    window onto one cell (extras cell) of a shared "spines" canvas (extras grid / px): the issue number
//   shelf_r<r>_b<k>_secret   stamp: visible on SECRET binders; falls when the document is approved
//   screen_shelf_r<r>      the row's name plate (the project; '<name> (이어서)' on a row that carries on); the '+N' of a project with more files than its rows hold is drawn on it
// In progress: the binder is pulled 3 cm out of the row; awaiting approval: an amber tag (made here, the glb has no node for it) stands on the spine.
// The last binder of a row with empty slots to its right leans -8 deg about world z around the body's pivot (its bottom right front corner).
// Counts, rows and label cells are read from the nodes' extras (library.ts has the defaults); layout and the maths are pure (src/docs/library.ts).

import { BoxGeometry, CanvasTexture, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector3, type Material, type Object3D } from 'three'
import { LABEL_GRID, LEAN_DEG, labelCell, type Binder, type ShelfLayout } from '../docs/library'
import { meshesOf } from './nodes'
import { AGENT_INFO } from './world'

const MANILA = '#d9b877' // --manila
const IVORY = '#efe6d2' // --paper
const INK = '#1f1b14' // --paper-ink
/** the designer asked for 0.15; the ivory still read grey on the dim shelf, so it is higher (see the PR notes) */
const LABEL_GLOW = 0.4
/** an in-progress binder stands this far out of the row (toward the room, +z), m */
export const PULL_M = 0.03
/** the amber awaiting-approval tag, m (designer: 1.5 x 2.5 cm) */
export const TAG = { color: '#ffb347', w: 0.015, h: 0.025, d: 0.003 }
const Z = new Vector3(0, 0, 1)
const PULL = new Vector3(0, 0, PULL_M)
const FLASH_S = 1.6
const FONT = "'Galmuri11', ui-monospace, monospace"
const NAVY_FALLBACK = '#1c2a44'

interface Slot {
  stem: string
  body: Object3D | null
  band: Object3D | null
  label: Object3D | null
  stamp: Object3D | null
  /** the row and the slot along it, as the glb says */
  r: number
  k: number
  /** this label's cell in the spines canvas */
  cell: { k: number; r: number }
  /** the amber tag standing on the spine (made here) */
  tag: Mesh | null
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
  w: number
  h: number
}

interface Drop {
  slot: Slot
  /** seconds so far / in all */
  t: number
  dur: number
}

const hex = (seat: number | null) => (seat === null ? null : (AGENT_INFO[`agent_${seat}`]?.color ?? null))

/** the glb's own numbers for the label canvas (extras grid / px of a label node), else the library defaults */
function gridOf(nodes: Record<string, Object3D>, labelNames: string[]) {
  for (const n of labelNames) {
    const g = nodes[n]?.userData.grid
    const px = nodes[n]?.userData.px
    if (Array.isArray(g) && Array.isArray(px) && g[0] > 0 && g[1] > 0 && px[0] > 0 && px[1] > 0) return { cols: Number(g[0]), rows: Number(g[1]), w: Number(px[0]), h: Number(px[1]) }
  }
  return LABEL_GRID
}

const num = (v: unknown): number | null => (v !== undefined && v !== null && Number.isFinite(Number(v)) ? Number(v) : null)

export class ShelfRig {
  private slots = new Map<string, Slot>()
  /** the slot of each row's place: rows[r][k] */
  private rows: Slot[][] = []
  private grid = LABEL_GRID
  /** the plate of each row (index = r) */
  private plates: (Plate | undefined)[] = []
  private labels: { ctx: CanvasRenderingContext2D; texture: CanvasTexture } | null = null
  private drops: Drop[] = []
  /** binders that are glowing (#97): seconds since the flash began */
  private flashes = new Map<Slot, number>()
  /** file keys that were SECRET at the last layout (a file that stops being SECRET gets its stamp dropped) */
  private secretFiles = new Set<string>()
  private lastLayout: ShelfLayout | null = null
  private tiltQ = new Quaternion()
  private zq = new Quaternion().setFromAxisAngle(Z, MathUtils.degToRad(LEAN_DEG))
  private tagMaterial = new MeshBasicMaterial({ color: TAG.color, toneMapped: false })

  constructor(nodes: Record<string, Object3D>) {
    // every binder body in the model, shelf_r<r>_b<k>: the row is its extras shelf (else the name's r), the slot its extras slot (else the name's k)
    const found = Object.keys(nodes)
      .map((name) => /^shelf_r([0-9]+)_b([0-9]+)$/.exec(name))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => {
        const u = nodes[m[0]].userData
        return { stem: m[0], r: num(u.shelf) ?? Number(m[1]), k: num(u.slot) ?? Number(m[2]) }
      })
      .sort((a, b) => a.r - b.r || a.k - b.k)
    this.grid = gridOf(
      nodes,
      found.map((f) => `${f.stem}_label`),
    )
    for (const f of found) {
      const stem = f.stem
      const label = nodes[`${stem}_label`] ?? null
      const c = label?.userData.cell
      const cell = Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null ? { k: Number(c[0]), r: Number(c[1]) } : { k: f.k, r: f.r }
      const slot: Slot = {
        stem,
        body: nodes[stem] ?? null,
        band: nodes[`${stem}_band`] ?? null,
        label,
        stamp: nodes[`${stem}_secret`] ?? null,
        r: f.r,
        k: f.k,
        cell,
        tag: null,
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
        slot.tag = this.makeTag(slot.band, stem)
      }
      slot.coverColor = slot.covers[0] ? `#${slot.covers[0].color.getHexString()}` : NAVY_FALLBACK
      this.hideAll(slot)
      this.slots.set(stem, slot)
      ;(this.rows[f.r] ??= [])[f.k] = slot
    }
    this.setupLabels()
    // the plates: screen_shelf_r<r>, one per row
    for (const name of Object.keys(nodes)) {
      const m = /^screen_shelf_r([0-9]+)$/.exec(name)
      if (!m) continue
      const aspect = num(nodes[name].userData.aspect)
      this.plates[Number(m[1])] = this.setupPlate(nodes[name], aspect !== null && aspect > 0 ? aspect : 8.5714)
    }
  }

  /** the amber tag, standing on top of the spine band (a child of the band mesh: it follows the pull and the lean); hidden until awaiting approval */
  private makeTag(band: Object3D, stem: string): Mesh | null {
    const mesh = meshesOf(band)[0]
    const geo = mesh?.geometry
    if (!geo) return null
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const tag = new Mesh(new BoxGeometry(TAG.w, TAG.h, TAG.d), this.tagMaterial)
    tag.name = `${stem}_tag`
    tag.position.set((bb.min.x + bb.max.x) / 2, bb.max.y + TAG.h / 2, bb.max.z - TAG.d / 2)
    tag.visible = false
    mesh.add(tag)
    return tag
  }

  private hideAll(s: Slot) {
    for (const o of [s.body, s.band, s.label, s.stamp]) if (o) o.visible = false
    if (s.tag) s.tag.visible = false
  }

  /** the binder's slot as the glb has it: row and slot, nothing for a place the model does not have */
  private slotOf(r: number, k: number): Slot | undefined {
    return this.rows[r]?.[k]
  }

  /** what the glb holds: the places of each row (for the tests) */
  get shape(): number[] {
    return this.rows.map((z) => z.filter(Boolean).length)
  }

  /** the node name a binder of this row and slot goes to (for the tests) */
  stemOf(r: number, k: number): string | undefined {
    return this.slotOf(r, k)?.stem
  }

  // ---- labels: one shared canvas, one shared material -------------------------------------------------------------

  private setupLabels() {
    const first = [...this.slots.values()].find((s) => s.label)?.label
    if (!first) return
    const c = document.createElement('canvas')
    c.width = this.grid.w
    c.height = this.grid.h
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
    ctx.fillRect(0, 0, this.grid.w, this.grid.h)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const b of binders) {
      const slot = this.slotOf(b.r, b.k)
      if (!b.label || !slot) continue
      const cell = labelCell(slot.cell.k, slot.cell.r, this.grid)
      const size = b.label.length <= 3 ? 26 : b.label.length === 4 ? 20 : 16
      ctx.font = `700 ${size}px ${FONT}`
      ctx.fillText(b.label, cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w - 6)
    }
    texture.needsUpdate = true
  }

  // ---- row name plates -------------------------------------------------------------------------------------------

  private setupPlate(node: Object3D | undefined, aspect: number): Plate | undefined {
    const mesh = node && meshesOf(node)[0]
    if (!mesh) return undefined
    const c = document.createElement('canvas')
    c.width = 1024 // 0.30 x 0.035 m at 1024 px/m is 307 px wide; drawn at 4x for a crisp edge
    c.height = Math.max(1, Math.round(1024 / aspect))
    const texture = new CanvasTexture(c)
    texture.flipY = false
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    const old = mesh.material as MeshBasicMaterial
    mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false })
    old.dispose()
    const plate: Plate = { mesh, ctx: c.getContext('2d')!, texture, drawn: '\0', w: c.width, h: c.height }
    this.drawPlate(plate, '')
    return plate
  }

  private drawPlate(p: Plate, text: string) {
    if (p.drawn === text) return
    p.drawn = text
    const { ctx, texture } = p
    ctx.fillStyle = '#10141a'
    ctx.fillRect(0, 0, p.w, p.h)
    ctx.fillStyle = '#f3ead8'
    ctx.font = `700 ${Math.round(p.h * 0.54)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, p.w / 2, p.h * 0.52, p.w - 44)
    texture.needsUpdate = true
  }

  /** redraw the canvases once the pixel font is in (before that the fallback font draws) */
  redrawWhenFontsReady() {
    void document.fonts?.load(`700 26px ${FONT}`).then(() => {
      for (const p of this.plates) if (p) p.drawn = '\0'
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
    // a binder goes where the glb has a place for its row and slot; a place the model lacks is simply not shown
    const want = new Map<Slot, Binder>()
    for (const b of layout.binders) {
      const slot = this.slotOf(b.r, b.k)
      if (slot) want.set(slot, b)
    }
    const nowSecret = new Set(layout.binders.filter((b) => b.secret).map((b) => b.fileKey))
    for (const slot of this.slots.values()) {
      const b = want.get(slot) ?? null
      // a file that was SECRET and is not any more: the stamp falls (once, and only on a binder that was on show)
      const approved = animate && b && !b.secret && this.secretFiles.has(b.fileKey) && slot.shown?.fileKey === b.fileKey
      slot.shown = b
      this.place(slot, b)
      if (approved) this.startDrop(slot)
    }
    this.secretFiles = nowSecret
    this.plates.forEach((p, g) => p && this.drawPlate(p, plateText(layout.plates[g] ?? '', layout.more[g] ?? 0)))
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
    // in progress: the whole binder stands 3 cm out of the row (the amber tag is the band's child and comes with it)
    if (b.pulled) for (const o of [slot.body, slot.band, slot.label, slot.stamp]) o?.position.add(PULL)
    for (const o of [slot.body, slot.band, slot.label]) if (o) o.visible = true
    if (slot.stamp) slot.stamp.visible = b.secret || falling
    if (slot.tag) slot.tag.visible = b.tagged
    // the spine: the file's first topic colour (already 15% darker when done); a binder the layout gave none falls back to its agent's colour
    const color = b.color || hex(b.seat) || '#e9e4d8'
    for (const m of slot.bands) {
      m.color.set(color)
      m.emissive.set(color).multiplyScalar(0.3)
      m.emissiveIntensity = 1
    }
    // manila while SECRET (and while its stamp is still falling), the binder's own navy otherwise (a done one a little darker too)
    const manila = b.secret || falling
    for (const m of slot.covers) this.paintCover(m, manila ? MANILA : slot.coverColor, !manila && b.done)
  }

  /** manila glows a little (the shelf is dim and lit manila reads olive), the navy does not; `dim` is the 15% darker of a finished file */
  private paintCover(m: MeshStandardMaterial, color: string, dim = false) {
    m.color.set(color)
    if (dim) m.color.multiplyScalar(0.85)
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

  /** a meeting just filed its minutes: the binder of this file glows for a moment (a short pulse of its spine band) */
  flash(repo: string | null, n: number | null) {
    const slot = [...this.slots.values()].find((s) => s.shown && s.shown.repo === repo && s.shown.n === n)
    if (slot) this.flashes.set(slot, 0)
  }

  /** advance the falling stamps: a short lift and tilt, then a fall about the stamp's own pivot (0.9 s, --docs-stamp-ms) */
  update(dt: number) {
    for (const [slot, t] of this.flashes) {
      const u = Math.min(1, (t + dt) / FLASH_S)
      this.flashes.set(slot, t + dt)
      for (const m of slot.bands) m.emissiveIntensity = 1 + 3 * Math.sin(Math.PI * u) ** 2
      if (u >= 1) {
        this.flashes.delete(slot)
        for (const m of slot.bands) m.emissiveIntensity = 1
      }
    }
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
      if (d.slot.shown?.pulled) stamp.position.add(PULL)
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
      for (const d of done) for (const m of d.slot.covers) this.paintCover(m, d.slot.coverColor, !!d.slot.shown?.done)
    }
  }
}

/** the plate's text: the project name, and '+N' when the project has more files than its rows hold */
export function plateText(name: string, more: number): string {
  return name && more > 0 ? `${name} +${more}` : name
}
