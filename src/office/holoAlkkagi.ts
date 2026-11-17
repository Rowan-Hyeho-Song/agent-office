// Hologram alkkagi layer (#605 stage 1b, docs/design/hologram.md 12.1-12.3, 12.6, 5): the 117 px board texture (19 lines, edge border),
// 8x8 disc stones of 2.3 mm voxels (two layers, flat), hit brightening, falling off in stair steps, the aim dotted line and the end looks.
// It plugs into HoloBoard (holoBoard.ts) through a HoloStage, like the chess layer (holoChess.ts), and draws with the stage's film, clock and marks.
// Sides follow the engine (src/play/alkkagi.ts): side 0 = cyan (colour 1, flicks first, starts near engine y = -6), side 1 = ivory (colour 2).
// Engine coordinates are in lines (x, y); the surface frame is (x * 0.020, lift, +-y * 0.020), turned so side 0's player sits at engine y < 0.
// Pure rendering: all state comes from the draw() inputs and the clock t; hits and outs are given as the whole list so far this flick, so
// repeating them every frame is harmless (nothing is counted twice, the looks are a function of t).
import { AdditiveBlending, BufferGeometry, Color, DataTexture, Float32BufferAttribute, type InstancedMesh, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3 } from 'three'
import type { HoloStage } from './holoChess'

/** engine constants mirrored here so the board does not pull the game in (a test keeps them equal to ALK) */
export const ALK_EDGE = 9.6
export const ALK_RADIUS = 0.46
export const ALK_MAX_SPEED = 26

export const LINE = 0.02 // one engine line in metres
export const LINE_PX = 6
export const PXA = LINE / LINE_PX // one board-texture pixel
export const ALK_PX = 117 // +-58 px: the board edge at 57.6 px (0.192 m) rounds to the border at pixel 0 / 116
export const ALK_SIZE = ALK_PX * PXA // 0.39 m, the same plane as the omok grid
export const ALK_LINES = 19
export const AVOX = 0.0023
export const ABOX = 0.92
export const ALK_LAYERS = 2
export const A_BASE = 0.9
export const A_HIT_MAX = 1.4
export const A_END_WIN = 1.3
export const A_END_DRAW = 0.6
export const T_HIT = 0.12
export const T_FALL = 0.3
export const T_FALL_R = 0.1 // reduced motion
export const T_WIN_GLOW = 2
export const T_DRAW_DIM = 1
export const T_OFF = 0.15 // the stones vanish layer by layer when the board folds
export const T_OFF_R = 0.1
export const AIM_BRIGHT = 0.6
export const AIM_MAX_DOTS = 6
export const A_GLOW_R = 1.1 * ALK_RADIUS * LINE
export const A_GLOW_Y = 0.0002
export const A_STONE_Y = 0.0005
export const ALK_COLORS = { cyan: '#4df3ff', ivory: '#f3ead8', grid: '#8fd3da' }
const CAP = 64

const CYAN = new Color(ALK_COLORS.cyan)
const IVORY = new Color(ALK_COLORS.ivory)
const sideColor = (side: number) => (side === 0 ? CYAN : IVORY)
const colourOf = (side: number): 1 | 2 => (side === 0 ? 1 : 2)

const MASK = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..']
/** voxels in the disc footprint (the omok mask) */
export const ALK_FOOTPRINT = MASK.join('').split('#').length - 1

// ---- types ----------------------------------------------------------------------------------------------------------------

export interface AlkStone {
  /** engine lines */
  x: number
  y: number
  /** 0 = cyan, flicks first; 1 = ivory */
  side: 0 | 1
  out: boolean
}
export interface AlkHit {
  /** stone indices */
  a: number
  b: number
  /** the closing speed (engine `speed`, lines/s) */
  speed: number
  /** scene clock s */
  at: number
}
export interface AlkOut {
  a: number
  /** scene clock s the centre crossed the edge */
  at: number
  /** the direction of travel in engine coordinates (any length; zero = away from the centre) */
  dir: { x: number; y: number }
}
export interface AlkAim {
  /** index of the stone to flick */
  stone: number
  /** the flick's direction in engine coordinates (any length) and power 1..1000 */
  dx: number
  dy: number
  power: number
  /** 0..1, how much of the line has grown while aiming (1 = full) */
  grow: number
}
export interface AlkInput {
  /** positions now, engine coordinates (the caller interpolates the simulation); out stones are not drawn unless a matching `outs` entry is falling */
  stones: AlkStone[]
  /** every hit so far this flick */
  hits: AlkHit[]
  /** every stone that went over the edge so far this flick */
  outs: AlkOut[]
  aim: AlkAim | null
  /** the game is over: the winner (a side) or null for a draw, from `since` */
  end: { winner: 0 | 1 | null; since: number } | null
}
export interface AlkFrame {
  t: number
  reduced: boolean
  live: boolean // stones shown (phase on or wait)
  on: boolean // aim line shown
  a: AlkInput | undefined
  glow(colour: number, x: number, z: number, r: number, a: number): void
  mark(x: number, y: number, z: number, sx: number, sz: number, rot: number, c: Color, bright: number, a?: number): void
}

// ---- pixels ---------------------------------------------------------------------------------------------------------------

/**
 * 117x117 brightness bytes (0..255). Lines every 6 px from pixel 4 to 112 (the 19 lines, the outer ones at 0.6, the inner at 0.35), a 1 px border
 * at the board edge (pixel 0 and 116) at 1.0. No star points. The texture is symmetric.
 */
export function alkPixels(): Uint8Array {
  const px = new Uint8Array(ALK_PX * ALK_PX)
  const mid = (ALK_PX - 1) / 2
  const at = (i: number) => mid + LINE_PX * (i - 9)
  const inner = Math.round(0.35 * 255)
  const outer = Math.round(0.6 * 255)
  const put = (x: number, y: number, v: number) => {
    px[y * ALK_PX + x] = Math.max(px[y * ALK_PX + x], v)
  }
  for (let i = 0; i < ALK_LINES; i++) {
    const v = i === 0 || i === ALK_LINES - 1 ? outer : inner
    for (let k = at(0); k <= at(ALK_LINES - 1); k++) {
      put(at(i), k, v)
      put(k, at(i), v)
    }
  }
  for (let k = 0; k < ALK_PX; k++) {
    put(0, k, 255)
    put(ALK_PX - 1, k, 255)
    put(k, 0, 255)
    put(k, ALK_PX - 1, 255)
  }
  return px
}

function boardTexture(): DataTexture {
  const src = alkPixels()
  const data = new Uint8Array(src.length * 4)
  for (let i = 0; i < src.length; i++) data.fill(src[i], i * 4, i * 4 + 4)
  const tex = new DataTexture(data, ALK_PX, ALK_PX, RGBAFormat, UnsignedByteType)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

// ---- geometry -------------------------------------------------------------------------------------------------------------

/**
 * One merged stone: the 8x8 disc mask, 2 layers, 2.3 mm voxels, visible faces only. Per vertex: aShade (top 1.0, front/back 0.7, left/right 0.5),
 * aLayer (the layer the face belongs to; -1 = the cap of the lower layer, shown only while the stone is one layer thick) and aRow (the mask row).
 */
export function buildStoneGeometry(): BufferGeometry {
  const pos: number[] = []
  const shade: number[] = []
  const layer: number[] = []
  const rowOf: number[] = []
  const idx: number[] = []
  const has = (x: number, z: number) => x >= 0 && z >= 0 && x < 8 && z < 8 && MASK[z][x] === '#'
  const quad = (v: number[][], s: number, l: number, r: number) => {
    const base = pos.length / 3
    for (const p of v) {
      pos.push(p[0], p[1], p[2])
      shade.push(s)
      layer.push(l)
      rowOf.push(r)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const h = (ABOX * AVOX) / 2
  for (let l = 0; l < ALK_LAYERS; l++) {
    const y0 = l * AVOX + ((1 - ABOX) / 2) * AVOX
    const y1 = y0 + ABOX * AVOX
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++) {
        if (!has(x, z)) continue
        const cx = (x - 3.5) * AVOX
        const cz = (z - 3.5) * AVOX
        const [x0, x1, z0, z1] = [cx - h, cx + h, cz - h, cz + h]
        quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1, l === ALK_LAYERS - 1 ? l : -1, z)
        if (!has(x, z + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.7, l, z)
        if (!has(x, z - 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.7, l, z)
        if (!has(x + 1, z)) quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 0.5, l, z)
        if (!has(x - 1, z)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.5, l, z)
      }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('aShade', new Float32BufferAttribute(shade, 1))
  g.setAttribute('aLayer', new Float32BufferAttribute(layer, 1))
  g.setAttribute('aRow', new Float32BufferAttribute(rowOf, 1))
  g.setIndex(idx)
  return g
}

const STONE_VERT = /* glsl */ `
attribute float aShade; attribute float aLayer; attribute float aRow;
attribute vec3 iPos; attribute vec4 iSt; attribute vec3 iDir; attribute vec3 iCol;
varying vec3 vCol; varying float vA;
const float VOX = ${AVOX};
void main() {
  // iSt = layers, brightness, alpha, rows shown (rows 0..n-1); iDir = direction of travel on the surface (x, z) and the stair flag (falling)
  bool vis = (aLayer < 0.0 ? (iSt.x > 0.5 && iSt.x < 1.5) : (aLayer + 0.5 < iSt.x)) && aRow + 0.5 < iSt.w;
  vec3 p = position + iPos;
  p.xz += iDir.xy * iDir.z * (1.0 + mod(aRow, 2.0)) * VOX;
  vCol = iCol * aShade * iSt.y; vA = iSt.z;
  gl_Position = vis ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`

// ---- the layer ------------------------------------------------------------------------------------------------------------

export class AlkkagiLayer {
  readonly grid: Mesh
  readonly stones: InstancedMesh
  readonly materials: { stone: ShaderMaterial; grid: ShaderMaterial }

  private readonly stage: HoloStage
  private readonly boardTex: DataTexture
  private dx = 0
  private dz = 1
  private theta = 0
  private readonly v = new Vector3()
  private offAt: number | null = null
  private fall = new Map<number, { at: number; x: number; y: number }>()
  private n = 0

  constructor(stage: HoloStage) {
    this.stage = stage
    const stoneMat = new ShaderMaterial({
      vertexShader: STONE_VERT,
      fragmentShader: /* glsl */ `
uniform float uDpr; uniform float uAlpha;
varying vec3 vCol; varying float vA;
void main() {
  float scan = ${stage.scan};
  gl_FragColor = vec4(vCol * scan, vA * uAlpha);
  #include <colorspace_fragment>
}`,
      uniforms: { ...stage.uniforms },
    })
    stage.light(stoneMat, AdditiveBlending)
    this.boardTex = boardTexture()
    const gridMat = stage.flat(ALK_COLORS.grid, AdditiveBlending, this.boardTex, 1)
    this.materials = { stone: stoneMat, grid: gridMat }
    this.grid = new Mesh(new PlaneGeometry(ALK_SIZE, ALK_SIZE).rotateX(-Math.PI / 2), gridMat)
    this.grid.renderOrder = 0
    this.grid.frustumCulled = false
    this.grid.visible = false
    this.grid.onBeforeRender = stage.onRender
    stage.root.add(this.grid)
    this.stones = stage.inst(buildStoneGeometry(), stoneMat, CAP, { iPos: 3, iSt: 4, iDir: 3, iCol: 3 }, 2)
    stage.root.add(this.stones)
  }

  // ---- engine <-> surface ---------------------------------------------------------------------------------------------------

  /** turn the board so side 0's player (colour 1) sits at engine y < 0; with only the other player seated its seat is used negated; none = side 0 at +z */
  setOrientation(players: { seat: Vector3; color: number }[]) {
    let p = players.find((q) => q.color === 1)
    let sg = 1
    if (!p) {
      p = players.find((q) => q.color !== 1)
      sg = -1
    }
    if (!p) {
      this.dx = 0
      this.dz = 1
    } else {
      const s = this.stage.toLocal(p.seat, this.v)
      const alongX = Math.abs(s.x) >= Math.abs(s.z)
      const e = ((alongX ? s.x : s.z) >= 0 ? 1 : -1) * sg
      this.dx = alongX ? e : 0
      this.dz = alongX ? 0 : e
    }
    this.theta = Math.atan2(this.dx, this.dz)
  }

  /** u metres to the viewer's right (engine x), w away from the viewer (engine y), on the light plane */
  private viewLocal(u: number, w: number, out: Vector3): Vector3 {
    return out.set(this.dz * u - this.dx * w, this.stage.lift(), -this.dx * u - this.dz * w)
  }

  /** surface-frame point of an engine position (y = the light plane) */
  posLocal(x: number, y: number, out: Vector3): Vector3 {
    return this.viewLocal(x * LINE, y * LINE, out)
  }

  /** engine coordinates under a surface-frame point (not clipped to the board) */
  atLocal(p: Vector3): { x: number; y: number } {
    const u = this.dz * p.x - this.dx * p.z
    const w = -(this.dx * p.x + this.dz * p.z)
    return { x: u / LINE, y: w / LINE }
  }

  prepare(players: { seat: Vector3; color: number }[]) {
    this.setOrientation(players)
  }

  // ---- state ----------------------------------------------------------------------------------------------------------------

  clear() {
    this.offAt = null
    this.fall.clear()
  }

  /** the board folds: the stones lose their layers over 0.15 s (0.1 s fade when reduced) */
  killAll(t: number, a: AlkInput | undefined) {
    this.offAt = a && a.stones.length ? t : null
  }

  /** 1 while stones are still vanishing, else 0 */
  liveCount(t: number, reduced: boolean): number {
    if (this.offAt === null) return 0
    if (t - this.offAt >= (reduced ? T_OFF_R : T_OFF)) {
      this.clear()
      return 0
    }
    return 1
  }

  /** a new game: forget the fall positions (events are the caller's list; they are not counted here) */
  sync(_a: AlkInput | undefined, _t: number, _reduced: boolean, _quiet: boolean, newGame: boolean) {
    if (newGame) this.fall.clear()
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------

  /** show / hide the board mesh and set its fold clip (half extents in metres) and brightness */
  setView(visible: boolean, hx: number, hz: number, bright: number) {
    const swap = Math.abs(Math.sin(this.theta)) > 0.5
    this.grid.visible = visible
    this.grid.position.y = this.stage.lift()
    this.grid.rotation.y = this.theta
    ;(this.materials.grid.uniforms.uClip.value as Vector2).set(swap ? hz : hx, swap ? hx : hz)
    this.materials.grid.uniforms.uBright.value = bright
  }

  private emit(side: number, x: number, y: number, z: number, o: { layers: number; bright: number; alpha: number; rows: number; dir?: [number, number]; stair?: boolean }) {
    const i = this.n
    if (i >= CAP) return
    this.n++
    const c = sideColor(side)
    const s = this.stage
    s.put(this.stones, i, 'iPos', x, y, z)
    s.put(this.stones, i, 'iSt', o.layers, o.bright, o.alpha, o.rows)
    s.put(this.stones, i, 'iDir', o.dir?.[0] ?? 0, o.dir?.[1] ?? 0, o.stair ? 1 : 0)
    s.put(this.stones, i, 'iCol', c.r, c.g, c.b)
  }

  draw(f: AlkFrame) {
    const { t, reduced } = f
    const a = f.a
    const lift = this.stage.lift()
    const base = lift + A_STONE_Y
    const p = new Vector3()
    this.n = 0
    if (a && f.live) {
      const off = this.offAt === null ? 0 : t - this.offAt
      /** layered vanish when the board folds: top layer first, 0.075 s each; reduced = a 0.1 s fade */
      const folded = (o: { layers: number; alpha: number }) => {
        if (this.offAt === null) return
        if (reduced) o.alpha *= Math.max(0, 1 - off / T_OFF_R)
        else o.layers = Math.min(o.layers, off < T_OFF / 2 ? 2 : 1)
      }
      const fell = (i: number) => a.outs.some((e) => e.a === i && e.at <= t)

      // brightness from hits (not in reduced motion: no flash at all)
      const hit = new Map<number, number>()
      if (!reduced)
        for (const h of a.hits) {
          const d = t - h.at
          if (d < 0 || d >= T_HIT) continue
          const peak = A_BASE + (A_HIT_MAX - A_BASE) * Math.min(1, Math.max(0, h.speed / ALK_MAX_SPEED))
          const b = A_BASE + (peak - A_BASE) * (1 - d / T_HIT)
          for (const s of [h.a, h.b]) hit.set(s, Math.max(hit.get(s) ?? 0, b))
        }
      const end = a.end
      const endBright = (side: number): number | null => {
        if (!end) return null
        const d = t - end.since
        if (end.winner === null) return d >= 0 && d < T_DRAW_DIM ? A_END_DRAW : null
        return d >= 0 && d < T_WIN_GLOW && side === end.winner ? A_END_WIN : null
      }

      a.stones.forEach((st, i) => {
        if (st.out || fell(i)) return
        this.posLocal(st.x, st.y, p)
        const o = { layers: 2, alpha: 1, bright: hit.get(i) ?? A_BASE, rows: 8 }
        const eb = endBright(st.side)
        if (eb !== null) o.bright = eb
        folded(o)
        if (o.alpha <= 0) return
        this.emit(st.side, p.x, base, p.z, o)
        f.glow(colourOf(st.side), p.x, p.z, A_GLOW_R, 0.3 * o.alpha * (o.layers / 2))
      })

      // stones falling off: where they crossed the edge, scattering forward in stair steps
      for (const e of a.outs) {
        const d = t - e.at
        const st = a.stones[e.a]
        if (!st || d < 0 || d >= (reduced ? T_FALL_R : T_FALL)) continue
        let c = this.fall.get(e.a)
        if (!c || c.at !== e.at) {
          c = { at: e.at, x: st.x, y: st.y }
          this.fall.set(e.a, c)
        }
        this.posLocal(c.x, c.y, p)
        const o = { layers: 2, alpha: 1, bright: A_BASE, rows: 8, stair: false, dir: undefined as [number, number] | undefined }
        if (reduced) o.alpha = 1 - d / T_FALL_R
        else {
          const k = d / T_FALL
          o.rows = Math.ceil(8 * (1 - k) - 1e-9)
          o.stair = k > 0
          // direction of travel on the surface; no direction = away from the board's centre
          const dir = this.posLocal(e.dir.x, e.dir.y, new Vector3())
          let ux = dir.x
          let uz = dir.z
          if (ux === 0 && uz === 0) {
            this.posLocal(c.x, c.y, dir)
            ux = dir.x
            uz = dir.z
          }
          const len = Math.hypot(ux, uz) || 1
          o.dir = [ux / len, uz / len]
        }
        folded(o)
        if (o.rows <= 0 || o.alpha <= 0) continue
        this.emit(st.side, p.x, base, p.z, o)
        f.glow(colourOf(st.side), p.x, p.z, A_GLOW_R, 0.3 * o.alpha * (o.rows / 8))
      }
    }

    // the aim dotted line: one 2 x 2 px dot per line from the stone, its own colour at 0.6; the length (6 lines at 1000) shows the power
    const aim = a?.aim
    if (f.on && a && aim) {
      const st = a.stones[aim.stone]
      const len = Math.hypot(aim.dx, aim.dy)
      if (st && !st.out && len > 0) {
        const all = Math.min(AIM_MAX_DOTS, Math.max(1, Math.round((AIM_MAX_DOTS * aim.power) / 1000)))
        const grow = f.reduced ? 1 : aim.grow
        const shown = grow <= 0 ? 0 : Math.min(all, Math.max(1, Math.ceil(all * grow - 1e-9)))
        const c = sideColor(st.side)
        const y = lift + A_GLOW_Y
        for (let k = 1; k <= shown; k++) {
          this.posLocal(st.x + (aim.dx / len) * k, st.y + (aim.dy / len) * k, p)
          // snap to the texture pixels: a 2 px dot is centred on a pixel boundary
          const sx = (Math.round(p.x / PXA - 0.5) + 0.5) * PXA
          const sz = (Math.round(p.z / PXA - 0.5) + 0.5) * PXA
          f.mark(sx, y, sz, 2 * PXA, 2 * PXA, 0, c, AIM_BRIGHT)
        }
      }
    }

    this.stones.count = this.n
    this.stage.flush(this.stones)
  }

  /** stone instances drawn this frame (tests) */
  count(): number {
    return this.stones.count
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose()
    this.boardTex.dispose()
    this.grid.geometry.dispose()
    this.stones.geometry.dispose()
  }
}
