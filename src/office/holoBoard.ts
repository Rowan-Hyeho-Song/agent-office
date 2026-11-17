// Hologram go board, "pixel monitor light" (#538, docs/design/hologram.md 1-3, 5, 6, 4.2, 1.5).
// A projection film, a 91x91 pixel grid, voxel stones (one merged mesh per stone, two InstancedMeshes), glow discs, marks
// (ripple, win line, last move dot, turn line) and stone founts. Everything is unlit additive light with a static screen scanline;
// only the red last-move dot is normal blended. Pure rendering: all state comes from update() inputs and the scene clock t.
import {
  AdditiveBlending,
  type Blending,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { ChessLayer, type ChessInput } from './holoChess'

export const N = 15
export const CELL = 0.026
export const STONE_H = 0.0056
export const VOXEL = 0.0028
export const BOX = 0.92
export const GRID_SIZE = 0.39
export const FILM_SIZE = 0.44
export const FILM_DROP = 0.001
/**
 * #538 (hologram.md 1.4, #650) the film's opacity, set by what shows: over the cream table the screen reads about #1c1f24 (L 12–15), the projector's
 * disc and panel only faintly through. Blended in linear space, measured on the page: 0.62 read #a6a69d, 0.9 #5a5b56, 0.99 #1e2021
 */
export const FILM_OPACITY = 0.99
export const GRID_PX = 91
export const CELL_PX = 6
export const PX = CELL / CELL_PX // one board-texture pixel
export const GLOW_Y = 0.0002
export const STONE_Y = 0.0005 // stone bottom above the light plane (glow is 0.3 mm under it)
export const GLOW_R = 0.012
export const GLOW_R_WIN = 0.016
export const FOUNT_OUT = 7 * CELL + 0.025
export const FOUNT_SIDE = 0.12
export const TURN_LEN = 0.12
export const TURN_IN = 0.006
export const STAR_CELLS: [number, number][] = [[7, 7], [3, 3], [11, 3], [3, 11], [11, 11]]
export const MASK = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..']
export const RIPPLE_RADII = [0.5, 0.5 + 2 / 3, 0.5 + 4 / 3, 2.5] // cells, 4 discrete steps
export const COLORS = { cyan: '#4df3ff', ivory: '#f3ead8', grid: '#8fd3da', red: '#ff5a5f', ink: '#0b0e13' }

const T_ON = 0.3
const T_ON_LINE = 0.24
const T_FOLD = 0.2
const T_LINE = 0.1
const T_LAYER = 0.06
const T_VANISH = 0.075
const T_RIPPLE = 0.3
const T_WIN = 0.4
const T_WIPE = 0.4
const MAX_RIPPLES = 12
const CAP = N * N + 1 // 225 stones + the held one
const SCAN = 'mod(floor(gl_FragCoord.y / uDpr), 3.0) < 1.0 ? 0.55 : 1.0'

const sideColor = (c: 1 | 2 | number): Color => (c === 1 ? CYAN : IVORY)
const CYAN = new Color(COLORS.cyan)
const IVORY = new Color(COLORS.ivory)
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k))

export type Phase = 'off' | 'open' | 'on' | 'wait' | 'fold' | 'line'

export interface HoloInput {
  t: number
  reduced: boolean
  snap?: boolean
  on: boolean
  board: Uint8Array | null
  lastMove: number
  win: { line: number[]; color: 1 | 2 } | null
  newGame?: boolean
  turn: 1 | 2 | null
  players: { seat: Vector3; color: 1 | 2 }[]
  /** chess: `kind` 1..6 (needed to draw it), `facing` yaw in the surface frame (else the facing at the pick is kept), `from` the cell it was lifted from (hidden while held); pos = the point under its base */
  held: { pos: Vector3; color: 1 | 2; since: number; kind?: number; facing?: number; from?: number } | null
  pick?: number
  /** which game the film shows (default omok). Chess: color 2 = white, 1 = black; board/lastMove/win are ignored, see `chess` */
  game?: 'omok' | 'chess'
  chess?: ChessInput
}
export interface HoloResult {
  landed: number[]
  boardOn: boolean
  boardOffStart: boolean
  boardOnStart: boolean
  /** chess: the king's check started this frame (the shake begins) */
  checkStart?: boolean
}

// ---- pixels and geometry --------------------------------------------------------------------------------------------------

/** 91x91 brightness bytes (0..255). Row y=0 is the near-row (+z) side. Lines at 3+6i; inner 0.75, border and star points 1.0. */
export function gridPixels(): Uint8Array {
  const px = new Uint8Array(GRID_PX * GRID_PX)
  const at = (i: number) => 3 + CELL_PX * i
  const inner = Math.round(0.75 * 255)
  const put = (x: number, y: number, v: number) => {
    px[y * GRID_PX + x] = Math.max(px[y * GRID_PX + x], v)
  }
  for (let i = 0; i < N; i++) {
    const v = i === 0 || i === N - 1 ? 255 : inner
    for (let k = at(0); k <= at(N - 1); k++) {
      put(at(i), k, v)
      put(k, at(i), v)
    }
  }
  for (const [c, r] of STAR_CELLS)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(at(c) + dx, at(r) + dy, 255)
  return px
}

function gridTexture(): DataTexture {
  const src = gridPixels()
  const data = new Uint8Array(src.length * 4)
  for (let i = 0; i < src.length; i++) data.fill(src[i], i * 4, i * 4 + 4)
  const tex = new DataTexture(data, GRID_PX, GRID_PX, RGBAFormat, UnsignedByteType)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

const maskHas = (ring: boolean, x: number, z: number): boolean => {
  const at = (a: number, b: number) => a >= 0 && b >= 0 && a < 8 && b < 8 && MASK[b][a] === '#'
  if (!at(x, z)) return false
  return !ring || !(at(x - 1, z) && at(x + 1, z) && at(x, z - 1) && at(x, z + 1))
}

/**
 * One merged stone: only visible faces. Per vertex: aShade (top 1.0, front/back 0.7, left/right 0.5) and aLayer (layer the face
 * belongs to; -1 = the cap of a lower layer, shown only while it is the topmost layer). Four vertices per quad.
 */
export function buildVoxelGeometry(layers: number, ring: boolean): BufferGeometry {
  const pos: number[] = []
  const shade: number[] = []
  const layer: number[] = []
  const idx: number[] = []
  const quad = (v: number[][], s: number, l: number) => {
    const base = pos.length / 3
    for (const p of v) {
      pos.push(p[0], p[1], p[2])
      shade.push(s)
      layer.push(l)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const h = (BOX * VOXEL) / 2
  for (let l = 0; l < layers; l++) {
    const y0 = l * VOXEL + ((1 - BOX) / 2) * VOXEL
    const y1 = y0 + BOX * VOXEL
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++) {
        if (!maskHas(ring, x, z)) continue
        const cx = (x - 3.5) * VOXEL
        const cz = (z - 3.5) * VOXEL
        const [x0, x1, z0, z1] = [cx - h, cx + h, cz - h, cz + h]
        quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1, l === layers - 1 ? l : -1)
        if (!maskHas(ring, x, z + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.7, l)
        if (!maskHas(ring, x, z - 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.7, l)
        if (!maskHas(ring, x + 1, z)) quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 0.5, l)
        if (!maskHas(ring, x - 1, z)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.5, l)
      }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('aShade', new Float32BufferAttribute(shade, 1))
  g.setAttribute('aLayer', new Float32BufferAttribute(layer, 1))
  g.setIndex(idx)
  return g
}

// ---- shaders --------------------------------------------------------------------------------------------------------------

const VOXEL_VERT = /* glsl */ `
attribute float aShade; attribute float aLayer;
attribute vec3 iPos; attribute vec3 iSt; attribute vec3 iCol;
varying vec3 vCol; varying float vA;
void main() {
  bool vis = aLayer < 0.0 ? (iSt.x > 0.5 && iSt.x < 1.5) : (aLayer + 0.5 < iSt.x);
  vCol = iCol * aShade * iSt.y; vA = iSt.z;
  gl_Position = vis ? projectionMatrix * modelViewMatrix * vec4(position + iPos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`
const VOXEL_FRAG = /* glsl */ `
uniform float uDpr; uniform float uAlpha;
varying vec3 vCol; varying float vA;
void main() {
  float scan = ${SCAN};
  gl_FragColor = vec4(vCol * scan, vA * uAlpha);
  #include <colorspace_fragment>
}`
const QUAD_VERT = /* glsl */ `
attribute vec3 iPos; attribute vec2 iSize; attribute float iRot; attribute vec4 iCol;
varying vec4 vCol; varying vec2 vUv;
void main() {
  vec2 p = position.xz * iSize; float c = cos(iRot); float s = sin(iRot);
  vec3 w = vec3(p.x * c + p.y * s, 0.0, -p.x * s + p.y * c) + iPos;
  vCol = iCol; vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}`
const QUAD_FRAG = /* glsl */ `
uniform float uDpr; uniform float uAlpha;
varying vec4 vCol; varying vec2 vUv;
void main() {
  float scan = ${SCAN};
  float a = vCol.a * uAlpha;
  #ifdef RADIAL
  a *= max(0.0, 1.0 - length(vUv - 0.5) * 2.0);
  #endif
  gl_FragColor = vec4(vCol.rgb * scan, a);
  #include <colorspace_fragment>
}`
const FLAT_VERT = /* glsl */ `
varying vec2 vUv; varying vec2 vLocal;
void main() { vUv = uv; vLocal = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const FLAT_FRAG = /* glsl */ `
uniform float uDpr; uniform float uAlpha; uniform vec3 uColor; uniform float uBright; uniform float uOpacity; uniform vec2 uClip;
#ifdef HAS_MAP
uniform sampler2D uMap;
#endif
varying vec2 vUv; varying vec2 vLocal;
void main() {
  if (abs(vLocal.x) > uClip.x || abs(vLocal.y) > uClip.y) discard;
  float m = 1.0;
  #ifdef HAS_MAP
  m = texture2D(uMap, vUv).r;
  #endif
  float scan = ${SCAN};
  gl_FragColor = vec4(uColor * m * uBright * scan, uOpacity * uAlpha);
  #include <colorspace_fragment>
}`

// ---- the board ------------------------------------------------------------------------------------------------------------

export class HoloBoard {
  readonly root = new Group()
  readonly film: Mesh
  readonly grid: Mesh
  readonly stones: { 1: InstancedMesh; 2: InstancedMesh }
  readonly glow: InstancedMesh
  readonly founts: InstancedMesh
  readonly marks: InstancedMesh // additive: ripple, win line, turn line
  readonly dots: InstancedMesh // normal blended: last move
  readonly materials: Record<'film' | 'grid' | 'stone' | 'glow' | 'fount' | 'marks' | 'dot', ShaderMaterial>

  private readonly surface: Object3D
  private readonly scene: Object3D
  private readonly frame = new Matrix4()
  private readonly inv = new Matrix4()
  private readonly tmp = new Matrix4()
  private readonly sp = new Vector3()
  private readonly sq = new Quaternion()
  private readonly ss = new Vector3()
  private lift = 0.02
  private readonly uDpr = { value: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1 }
  private readonly uAlpha = { value: 1 }

  private phase: Phase = 'off'
  private t0 = 0
  private synced = false
  private readonly col = new Uint8Array(N * N)
  private readonly start = new Float64Array(N * N)
  private readonly dieAt = new Float64Array(N * N).fill(NaN)
  private readonly dieKind = new Uint8Array(N * N) // 0 layered, 1 fade 0.1, 2 fade 0.15
  private ripples: { cell: number; color: number; start: number }[] = []
  private winKey = ''
  private winStart = 0
  private flashUntil = [0, 0, 0, 0]
  private readonly v = new Vector3()
  private game: 'omok' | 'chess' = 'omok'
  private chess: ChessLayer | null = null
  private flatMat!: (color: string, blending: Blending, map: DataTexture | null, opacity: number) => ShaderMaterial

  constructor(scene: Object3D, surface: Object3D) {
    this.scene = scene
    this.surface = surface
    this.root.name = 'holo_board'
    this.root.matrixAutoUpdate = false
    const shared = { uDpr: this.uDpr, uAlpha: this.uAlpha }

    const flat = (color: string, blending: Blending, map: DataTexture | null, opacity: number) => {
      const m = new ShaderMaterial({
        vertexShader: FLAT_VERT,
        fragmentShader: FLAT_FRAG,
        uniforms: {
          ...shared,
          uColor: { value: new Color(color) },
          uBright: { value: 1 },
          uOpacity: { value: opacity },
          uClip: { value: new Vector2(1, 1) },
          uMap: { value: map },
        },
        defines: map ? { HAS_MAP: '' } : {},
      })
      this.light(m, blending)
      return m
    }
    // film: normal blended ink, unlit, no scanline needed (scan only dims colour that is already dark)
    const film = flat(COLORS.ink, NormalBlending, null, FILM_OPACITY)
    const grid = flat(COLORS.grid, AdditiveBlending, gridTexture(), 1)
    this.flatMat = flat
    const quadMat = (blending: Blending, radial: boolean) => {
      const m = new ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: QUAD_FRAG,
        uniforms: { ...shared },
        defines: radial ? { RADIAL: '' } : {},
      })
      this.light(m, blending)
      return m
    }
    const voxMat = () => {
      const m = new ShaderMaterial({ vertexShader: VOXEL_VERT, fragmentShader: VOXEL_FRAG, uniforms: { ...shared } })
      this.light(m, AdditiveBlending)
      return m
    }
    this.materials = {
      film,
      grid,
      stone: voxMat(),
      glow: quadMat(AdditiveBlending, true),
      fount: voxMat(),
      marks: quadMat(AdditiveBlending, false),
      dot: quadMat(NormalBlending, false),
    }

    const plane = (size: number) => new PlaneGeometry(size, size).rotateX(-Math.PI / 2)
    this.film = new Mesh(plane(FILM_SIZE), film)
    this.film.position.y = -FILM_DROP
    this.film.renderOrder = -1
    this.grid = new Mesh(plane(GRID_SIZE), grid)
    this.grid.renderOrder = 0
    for (const m of [this.film, this.grid]) {
      m.frustumCulled = false
      m.visible = false
      m.onBeforeRender = this.onRender
    }

    const stoneGeo = buildVoxelGeometry(2, false)
    const ringGeo = buildVoxelGeometry(1, true)
    const vox = (g: BufferGeometry, mat: ShaderMaterial, cap: number, order: number) =>
      this.inst(g.clone(), mat, cap, { iPos: 3, iSt: 3, iCol: 3 }, order)
    this.stones = { 1: vox(stoneGeo, this.materials.stone, CAP, 2), 2: vox(stoneGeo, this.materials.stone, CAP, 2) }
    this.founts = vox(ringGeo, this.materials.fount, 4, 2)
    const unit = plane(1)
    const quads = (mat: ShaderMaterial, cap: number, order: number) =>
      this.inst(unit.clone(), mat, cap, { iPos: 3, iSize: 2, iRot: 1, iCol: 4 }, order)
    this.glow = quads(this.materials.glow, CAP, 1)
    this.marks = quads(this.materials.marks, MAX_RIPPLES * 4 + 8, 3)
    this.dots = quads(this.materials.dot, 48, 5)

    this.root.add(this.film, this.grid, this.glow, this.stones[1], this.stones[2], this.founts, this.marks, this.dots)
    scene.add(this.root)
    this.sync()
  }

  private light(m: ShaderMaterial, blending: Blending) {
    m.blending = blending
    m.transparent = true
    m.depthWrite = false
    m.toneMapped = false
    m.side = DoubleSide
  }

  private readonly onRender = (r: WebGLRenderer) => {
    this.uDpr.value = r.getPixelRatio()
  }

  private inst(g: BufferGeometry, mat: ShaderMaterial, cap: number, attrs: Record<string, number>, order: number) {
    for (const [k, n] of Object.entries(attrs)) g.setAttribute(k, new InstancedBufferAttribute(new Float32Array(cap * n), n))
    const m = new InstancedMesh(g, mat, cap)
    m.count = 0
    m.frustumCulled = false
    m.renderOrder = order
    m.onBeforeRender = this.onRender
    return m
  }

  /** Set the device pixel ratio used by the scanline (the renderer's own ratio overrides it while rendering). */
  setPixelRatio(dpr: number) {
    this.uDpr.value = dpr
  }

  // ---- geometry helpers -----------------------------------------------------------------------------------------------------

  private sync() {
    this.surface.updateWorldMatrix(true, false)
    this.surface.matrixWorld.decompose(this.sp, this.sq, this.ss)
    const l = this.surface.userData?.lift
    if (typeof l === 'number') this.lift = l
    // the light plane is lift over the surface (the projector's panel); the film 1 mm under it (#648: both were left at the panel, under its top)
    this.grid.position.y = this.lift
    this.film.position.y = this.lift - FILM_DROP
    this.frame.compose(this.sp, this.sq, new Vector3(1, 1, 1))
    this.inv.copy(this.frame).invert()
    this.scene.updateWorldMatrix(true, false)
    this.tmp.copy(this.scene.matrixWorld).invert().multiply(this.frame)
    this.root.matrix.copy(this.tmp)
    this.root.matrixWorldNeedsUpdate = true
  }

  /** World y of the light plane at the surface centre. */
  get planeY(): number {
    this.sync()
    return this.sp.y + this.lift
  }

  get state(): Phase {
    return this.phase
  }

  /** World point on the light plane at an intersection. */
  cellPos(cell: number, out = new Vector3()): Vector3 {
    this.sync()
    const c = cell % N
    const r = (cell - c) / N
    return out.set((c - 7) * CELL, this.lift, (r - 7) * CELL).applyMatrix4(this.frame)
  }

  /** Nearest intersection within half a cell (in the plane), else -1. */
  cellAt(world: Vector3): number {
    this.sync()
    const p = this.v.copy(world).applyMatrix4(this.inv)
    const c = Math.round(p.x / CELL) + 7
    const r = Math.round(p.z / CELL) + 7
    return c < 0 || c >= N || r < 0 || r >= N ? -1 : r * N + c
  }

  /**
   * The stone fount of a player seated at `seat` (hologram.md 4.2), in the surface frame: 2.5 cm outside its board edge, 0.12 m toward its right
   * hand; `alongX` / `sign` say which film edge is its side
   */
  private fountLocal(seat: Vector3, out: Vector3) {
    const s = this.v.copy(seat).applyMatrix4(this.inv)
    const alongX = Math.abs(s.x) >= Math.abs(s.z)
    const sign = (alongX ? s.x : s.z) >= 0 ? 1 : -1
    // the player faces -u; its right is (-fz, 0, fx)
    const fx = alongX ? -sign : 0
    const fz = alongX ? 0 : -sign
    out.set((alongX ? sign * FOUNT_OUT : 0) - fz * FOUNT_SIDE, this.lift + GLOW_Y + 0.0003, (alongX ? 0 : sign * FOUNT_OUT) + fx * FOUNT_SIDE)
    return { alongX, sign }
  }

  /** the world point of the stone fount of a player seated at `seat` (the pinch takes its stone there) */
  fountPos(seat: Vector3, out = new Vector3()): Vector3 {
    this.sync()
    this.fountLocal(seat, out)
    return out.applyMatrix4(this.frame)
  }

  private ensureChess(): ChessLayer {
    return (this.chess ??= new ChessLayer({
      root: this.root,
      uniforms: { uDpr: this.uDpr, uAlpha: this.uAlpha },
      scan: SCAN,
      onRender: this.onRender,
      light: (m, b) => this.light(m, b),
      inst: (g, m, cap, attrs, order) => this.inst(g, m, cap, attrs, order),
      put: (m, i, name, ...v) => this.put(m, i, name, ...v),
      flush: (...ms) => this.flush(...ms),
      flat: this.flatMat,
      toLocal: (w, out) => out.copy(w).applyMatrix4(this.inv),
      lift: () => this.lift,
    }))
  }

  /** chess: the world point on the light plane at a cell centre (a1 = 0; turned as of the last update, white near +z before any) */
  squarePos(sq: number, out = new Vector3()): Vector3 {
    this.sync()
    return this.ensureChess().squareLocal(sq, out).applyMatrix4(this.frame)
  }

  /** chess: the cell under a world point (in the plane), else -1 */
  squareAt(world: Vector3): number {
    this.sync()
    return this.ensureChess().squareIndexLocal(this.v.copy(world).applyMatrix4(this.inv))
  }

  /** the chess layer, once created (tests, hand code) */
  get chessLayer(): ChessLayer | null {
    return this.chess
  }

  private local(cell: number, out: Vector3): Vector3 {
    const c = cell % N
    return out.set((c - 7) * CELL, this.lift, ((cell - c) / N - 7) * CELL)
  }

  // ---- stone bookkeeping ----------------------------------------------------------------------------------------------------

  private kill(c: number, at: number, kind: number) {
    this.dieAt[c] = at
    this.dieKind[c] = kind
  }

  private create(c: number, color: number, at: number) {
    this.col[c] = color
    this.start[c] = at
    this.dieAt[c] = NaN
  }

  private clearStones() {
    this.col.fill(0)
    this.dieAt.fill(NaN)
    this.ripples.length = 0
    this.chess?.clear()
  }

  private stoneLook(c: number, t: number, reduced: boolean, win: boolean) {
    const a = t - this.start[c]
    let layers = 2
    let alpha = 1
    let bright: number
    if (reduced) {
      alpha = Math.min(1, a / 0.1)
      bright = lerp(1.3, 0.9, a / 0.3)
    } else {
      layers = a < T_LAYER ? 1 : 2
      bright = lerp(1.3, 0.9, a / 0.2)
    }
    const d = t - this.dieAt[c]
    if (d >= 0) {
      const kind = this.dieKind[c]
      if (kind === 0) layers = Math.min(layers, d < T_VANISH ? 2 : 1)
      else alpha *= 1 - d / (kind === 1 ? 0.1 : 0.15)
    }
    return { layers, alpha, bright: win ? 1.3 : bright }
  }

  private vanished(c: number, t: number): boolean {
    const d = t - this.dieAt[c]
    return d >= (this.dieKind[c] === 1 ? 0.1 : 0.15)
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------

  update(inp: HoloInput): HoloResult {
    this.sync()
    const { t, reduced } = inp
    const snap = !!inp.snap
    const res: HoloResult = { landed: [], boardOn: false, boardOffStart: false, boardOnStart: false }
    const game = inp.game ?? 'omok'
    if (game !== this.game) {
      this.game = game
      this.clearStones()
      this.synced = false
    }
    const chess = game === 'chess' ? this.ensureChess() : null
    chess?.prepare(inp.chess, inp.players)

    // ---- phase machine
    if (snap) {
      this.phase = inp.on ? 'on' : 'off'
      this.clearStones()
      this.synced = false
    } else {
      if (inp.on) {
        if (this.phase !== 'on' && this.phase !== 'open') {
          this.clearStones()
          this.phase = 'open'
          this.t0 = t
          res.boardOnStart = true
        }
      } else if (this.phase === 'on') {
        if (chess) chess.killAll(t, inp.chess)
        else for (let c = 0; c < N * N; c++) if (this.col[c] && Number.isNaN(this.dieAt[c])) this.kill(c, t, reduced ? 1 : 0)
        this.phase = 'wait'
        this.t0 = t
      } else if (this.phase === 'open') {
        this.phase = 'wait'
        this.t0 = t
      }
      if (this.phase === 'open' && t - this.t0 >= (reduced ? 0.15 : T_ON)) {
        this.phase = 'on'
        this.synced = false
      }
    }
    // ---- stones
    const quiet = snap || !this.synced
    if (this.phase === 'on' && chess) {
      this.synced = true
      chess.sync(inp.chess, t, reduced, quiet, !!inp.newGame, res)
    } else if (this.phase === 'on') {
      this.synced = true
      const wiped = new Uint8Array(N * N)
      if (inp.newGame && !quiet) this.wipe(inp, wiped)
      const b = inp.board
      for (let c = 0; c < N * N; c++) {
        const d = b ? b[c] : 0
        const live = this.col[c] !== 0 && Number.isNaN(this.dieAt[c])
        if (d === 0) {
          if (live) this.kill(c, t, reduced ? 1 : 0)
        } else if (!wiped[c] && (!live || this.col[c] !== d)) {
          this.create(c, d, quiet ? -Infinity : t)
          if (!quiet) {
            res.landed.push(c)
            if (!reduced) this.ripples.push({ cell: c, color: d, start: t })
          }
        }
      }
    }
    let n = chess ? chess.liveCount(t, reduced) : 0
    for (let c = 0; c < N * N; c++) {
      if (this.col[c] && !Number.isNaN(this.dieAt[c]) && this.vanished(c, t)) this.col[c] = 0
      if (this.col[c]) n++
    }
    if (this.phase === 'wait' && n === 0) {
      this.phase = 'fold'
      this.t0 = t
      res.boardOffStart = true
    }
    if (this.phase === 'fold' && t - this.t0 >= (reduced ? 0.15 : T_FOLD)) {
      if (reduced) this.phase = 'off'
      else {
        this.phase = 'line'
        this.t0 += T_FOLD
      }
    }
    if (this.phase === 'line' && t - this.t0 >= T_LINE) this.phase = 'off'

    this.drawBoard(t, reduced)
    this.drawLight(inp, quiet, n)
    res.boardOn = this.phase !== 'off'
    return res
  }

  private wipe(inp: HoloInput, wiped: Uint8Array) {
    const seat = inp.players[0]?.seat
    const nearPlus = seat ? this.v.copy(seat).applyMatrix4(this.inv).z > 0 : false
    for (let c = 0; c < N * N; c++) {
      if (!this.col[c] || !Number.isNaN(this.dieAt[c])) continue
      const row = Math.floor(c / N)
      const k = nearPlus ? row : N - 1 - row // far row first
      if (inp.reduced) this.kill(c, inp.t, 2)
      else this.kill(c, inp.t + (k * T_WIPE) / N, 0)
      wiped[c] = 1
    }
  }

  private drawBoard(t: number, reduced: boolean) {
    const ph = this.phase
    const visible = ph !== 'off'
    this.film.visible = visible
    this.grid.visible = visible
    let rowsZ = 45
    let rowsX = 45
    let bright = 1
    let alpha = 1
    const a = t - this.t0
    if (ph === 'open') {
      if (reduced) alpha = Math.min(1, a / 0.15)
      else if (a < T_ON_LINE) {
        rowsZ = Math.min(45, Math.floor((a / T_ON_LINE) * 46))
        bright = 1.3
      } else bright = lerp(1.3, 1, (a - T_ON_LINE) / (T_ON - T_ON_LINE))
    } else if (ph === 'fold') {
      if (reduced) alpha = 1 - Math.min(1, a / 0.15)
      else rowsZ = 45 - Math.min(45, Math.floor((a / T_FOLD) * 46))
    } else if (ph === 'line') {
      rowsZ = 0
      rowsX = 45 - Math.min(45, Math.floor((a / T_LINE) * 46))
    }
    const hz = rowsZ === 45 ? 1 : (rowsZ + 0.5) * (GRID_SIZE / GRID_PX)
    const hx = rowsX === 45 ? 1 : (rowsX + 0.5) * (GRID_SIZE / GRID_PX)
    const k = FILM_SIZE / GRID_SIZE
    this.materials.grid.uniforms.uClip.value.set(hx, hz)
    this.materials.film.uniforms.uClip.value.set(hx === 1 ? 1 : hx * k, hz === 1 ? 1 : hz * k)
    this.materials.grid.uniforms.uBright.value = bright
    this.uAlpha.value = alpha
    const chessOn = this.game === 'chess'
    this.grid.visible = visible && !chessOn
    this.chess?.setView(visible && chessOn, hx === 1 ? 1 : hx * k, hz === 1 ? 1 : hz * k, bright)
  }

  private put(m: InstancedMesh, i: number, name: string, ...v: number[]) {
    const arr = (m.geometry.getAttribute(name) as InstancedBufferAttribute).array as Float32Array
    for (let k = 0; k < v.length; k++) arr[i * v.length + k] = v[k]
  }

  private flush(...ms: InstancedMesh[]) {
    for (const m of ms) for (const a of Object.values(m.geometry.attributes)) if ((a as InstancedBufferAttribute).isInstancedBufferAttribute) a.needsUpdate = true
  }

  private drawLight(inp: HoloInput, quiet: boolean, _nStones: number) {
    const { t, reduced } = inp
    const on = this.phase === 'on'
    const live = this.phase === 'on' || this.phase === 'wait'
    const cnt = { 1: 0, 2: 0 }
    let nGlow = 0
    let nMark = 0
    let nDot = 0
    let nFount = 0
    const p = new Vector3()
    const base = this.lift + STONE_Y

    // win bookkeeping
    const w = on ? inp.win : null
    const key = w ? `${w.line.join(',')}:${w.color}` : ''
    if (key !== this.winKey) {
      this.winKey = key
      this.winStart = quiet || reduced ? -Infinity : t
    }
    const winSet = new Set(w ? w.line : [])

    const stone = (color: number, x: number, y: number, z: number, layers: number, bright: number, alpha: number) => {
      const m = this.stones[color === 2 ? 2 : 1]
      const i = cnt[color === 2 ? 2 : 1]++
      const c = sideColor(color)
      this.put(m, i, 'iPos', x, y, z)
      this.put(m, i, 'iSt', layers, bright, alpha)
      this.put(m, i, 'iCol', c.r, c.g, c.b)
    }
    const glow = (color: number, x: number, z: number, r: number, a: number) => {
      const c = sideColor(color)
      const i = nGlow++
      this.put(this.glow, i, 'iPos', x, this.lift + GLOW_Y, z)
      this.put(this.glow, i, 'iSize', r * 2, r * 2)
      this.put(this.glow, i, 'iRot', 0)
      this.put(this.glow, i, 'iCol', c.r, c.g, c.b, a)
    }
    const mark = (x: number, y: number, z: number, sx: number, sz: number, rot: number, c: Color, bright: number, a = 1) => {
      const i = nMark++
      this.put(this.marks, i, 'iPos', x, y, z)
      this.put(this.marks, i, 'iSize', sx, sz)
      this.put(this.marks, i, 'iRot', rot)
      this.put(this.marks, i, 'iCol', c.r * bright, c.g * bright, c.b * bright, a)
    }

    const omok = this.game === 'omok'
    const dot = (x: number, y: number, z: number, sx: number, sz: number, c: Color, a: number) => {
      const i = nDot++
      this.put(this.dots, i, 'iPos', x, y, z)
      this.put(this.dots, i, 'iSize', sx, sz)
      this.put(this.dots, i, 'iRot', 0)
      this.put(this.dots, i, 'iCol', c.r, c.g, c.b, a)
    }
    // the chess layer always runs, so its instance counts drop to zero when it is not shown
    this.chess?.draw({ t, reduced, live: live && !omok, on: on && !omok, c: inp.chess, held: inp.held, glow, mark, dot })

    if (live && omok) {
      for (let c = 0; c < N * N; c++) {
        const color = this.col[c]
        if (!color) continue
        const s = this.stoneLook(c, t, reduced, winSet.has(c))
        if (s.layers <= 0 || s.alpha <= 0) continue
        this.local(c, p)
        stone(color, p.x, base, p.z, s.layers, s.bright, s.alpha)
        glow(color, p.x, p.z, winSet.has(c) ? GLOW_R_WIN : GLOW_R, 0.3 * s.alpha)
      }
    }

    if (on && omok) {
      // last move dot, once its stone is fully up
      const lm = inp.lastMove
      if (lm >= 0 && lm < N * N && this.col[lm] && Number.isNaN(this.dieAt[lm])) {
        const s = this.stoneLook(lm, t, reduced, false)
        if (s.layers === 2) {
          this.local(lm, p)
          const i = nDot++
          const r = new Color(COLORS.red)
          this.put(this.dots, i, 'iPos', p.x, base + STONE_H + 0.0005, p.z)
          this.put(this.dots, i, 'iSize', 2 * PX, 2 * PX)
          this.put(this.dots, i, 'iRot', 0)
          this.put(this.dots, i, 'iCol', r.r, r.g, r.b, s.alpha)
        }
      }

      // win line
      if (w && w.line.length >= 2) {
        const cells = [...w.line].sort((x, y) => x - y)
        const a = this.local(cells[0], new Vector3())
        const b = this.local(cells[cells.length - 1], new Vector3())
        const k = reduced ? 1 : Math.min(1, Math.max(0, (t - this.winStart) / T_WIN))
        if (k > 0) {
          const ex = a.x + (b.x - a.x) * k
          const ez = a.z + (b.z - a.z) * k
          const len = Math.hypot(ex - a.x, ez - a.z) + 2 * PX
          mark((a.x + ex) / 2, base + STONE_H + 0.001, (a.z + ez) / 2, len, 2 * PX, Math.atan2(-(ez - a.z), ex - a.x), sideColor(w.color), 1)
        }
      }

      // ripples (not in reduced motion)
      this.ripples = this.ripples.filter((r) => t - r.start < T_RIPPLE)
      for (const r of this.ripples) {
        const a = t - r.start
        const step = Math.min(3, Math.floor((a / T_RIPPLE) * 4))
        const R = RIPPLE_RADII[step] * CELL
        const bright = 0.6 * (1 - a / T_RIPPLE)
        this.local(r.cell, p)
        const y = this.lift + GLOW_Y
        const c = sideColor(r.color)
        mark(p.x, y, p.z - R, 2 * R + PX, PX, 0, c, bright)
        mark(p.x, y, p.z + R, 2 * R + PX, PX, 0, c, bright)
        mark(p.x - R, y, p.z, PX, 2 * R - PX, 0, c, bright)
        mark(p.x + R, y, p.z, PX, 2 * R - PX, 0, c, bright)
      }

    }

    if (on) {
      // turn light line and founts
      const ps = inp.players
      const info = ps.map((pl) => {
        const at = new Vector3()
        return { ...this.fountLocal(pl.seat, at), at, color: pl.color }
      })
      if (inp.turn) {
        const q = info.find((i) => i.color === inp.turn)
        if (q) {
          const e = (FILM_SIZE / 2 - TURN_IN) * q.sign
          const y = this.lift + GLOW_Y
          if (q.alongX) mark(e, y, 0, 2 * PX, TURN_LEN, 0, sideColor(q.color), 0.6)
          else mark(0, y, e, TURN_LEN, 2 * PX, 0, sideColor(q.color), 0.6)
        }
      }
      for (let i = 0; i < (omok ? Math.min(info.length, 4) : 0); i++) {
        const q = info[i]
        if (inp.pick === i) this.flashUntil[i] = t + 0.05
        const c = sideColor(q.color)
        const j = nFount++
        this.put(this.founts, j, 'iPos', q.at.x, q.at.y, q.at.z)
        this.put(this.founts, j, 'iSt', 1, t <= this.flashUntil[i] ? 1 : 0.35, 1)
        this.put(this.founts, j, 'iCol', c.r, c.g, c.b)
      }

      // held stone and its glow
      const h = omok ? inp.held : null
      if (h) {
        const a = t - h.since
        if (a >= 0) {
          const q = this.v.copy(h.pos).applyMatrix4(this.inv)
          const layers = reduced ? 2 : Math.min(2, Math.floor(a / T_LAYER) + 1)
          const alpha = reduced ? Math.min(1, a / 0.1) : 1
          const bright = lerp(1.3, 0.9, a / 0.2)
          stone(h.color, q.x, q.y - STONE_H / 2, q.z, layers, bright, alpha)
          const rise = Math.min(1, Math.max(0, (q.y - STONE_H / 2 - base) / 0.06))
          glow(h.color, q.x, q.z, GLOW_R, lerp(0.3, 0.1, rise) * alpha)
        }
      }
    }

    this.stones[1].count = cnt[1]
    this.stones[2].count = cnt[2]
    this.glow.count = nGlow
    this.marks.count = nMark
    this.dots.count = nDot
    this.founts.count = nFount
    this.flush(this.stones[1], this.stones[2], this.glow, this.marks, this.dots, this.founts)
  }

  dispose() {
    this.root.removeFromParent()
    this.chess?.dispose()
    for (const m of Object.values(this.materials)) m.dispose()
    const tex = this.materials.grid.uniforms.uMap.value as DataTexture
    tex.dispose()
    for (const o of [this.film, this.grid, this.glow, this.stones[1], this.stones[2], this.founts, this.marks, this.dots]) o.geometry.dispose()
  }
}
