// Hologram chess layer (#604 stage 1a, docs/design/hologram.md 11.1-11.4, 11.6): the 89x89 board texture, coordinates, glyph voxel pieces
// (one merged mesh per kind, instanced per kind and colour), last move / check marks, captured row, castling slide, promotion redraw,
// end looks. It plugs into HoloBoard (holoBoard.ts) through a HoloStage and draws with the stage's film, clock and marks.
// Colours here follow the hologram: 2 = ivory = white, 1 = cyan = black. Board cells follow the engine (src/play/chess.ts): a1 = 0,
// rank * 8 + file, + white, - black, 1 pawn .. 6 king. Pure rendering: all state comes from the sync()/draw() inputs and the clock t.
import {
  AdditiveBlending,
  type Blending,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  type Group,
  type InstancedMesh,
  Mesh,
  NearestFilter,
  NormalBlending,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'

export const SQ = 0.04
export const SQ_PX = 11
export const BOARD_PX = 89
export const FILM_PX = 121 // the 0.44 m film in board pixels (coordinates live outside the board)
export const PXC = SQ / SQ_PX // one chess board-texture pixel
export const BOARD_SIZE = BOARD_PX * PXC
export const CVOX = 0.0036
/** hologram.md 11.2 (#658): the opaque glyphs are solid, no 8% gap between voxels (it let the back layer's tops show as dark lines and dots) */
export const CBOX = 1
/** hologram.md 11.2 (#658): in the visitor's game view the glyphs lean toward the camera this part of the way to facing it full on */
export const TILT_PART = 0.5
export const CGLOW_R = 0.018
export const CGLOW_Y = 0.0002
export const CPIECE_Y = 0.0005
export const CAP_SCALE = 0.5
export const CAP_BRIGHT = 0.5
export const CAP_OUT = 0.02 // captured row, outside the board edge
export const T_CAPTURE = 0.3
export const T_SLIDE = 0.1 // per square
export const T_PROMO_WAIT = 0.2
export const T_PROMO = 0.3
export const T_SHAKE = 0.1
export const T_MATE_GLOW = 2
export const T_DRAW_DIM = 1
export const T_RIPPLE_C = 0.3
export const RIPPLE_RADII_C = [0.5, 0.83, 1.17, 1.5] // squares, 4 discrete steps
export const CHESS_COLORS = { cyan: '#4df3ff', ivory: '#f3ead8', grid: '#8fd3da', red: '#ff5a5f', ink: '#0b0e13' }

const CYAN = new Color(CHESS_COLORS.cyan)
const IVORY = new Color(CHESS_COLORS.ivory)
const RED = new Color(CHESS_COLORS.red)
export const VISITOR_LIFT = 0.01 // the selected piece rises 1 cm (11.3)
export const VISITOR_DRAG_Y = 0.02 // a dragged piece floats 2 cm over the board (11.5)
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k))
const sideColor = (colour: number) => (colour === 1 ? CYAN : IVORY)

/** the six glyphs, top row first (`#` = voxel); king 10x14, queen 10x13, bishop 10x12, knight 10x12 (faces left), rook 10x10, pawn 10x8 */
export const GLYPHS: Record<number, string[]> = {
  1: ['....##....', '...####...', '...####...', '....##....', '...####...', '..######..', '.########.', '.########.'],
  2: ['...##.....', '..#####...', '.#######..', '.##.#####.', '#########.', '####..###.', '.....####.', '....#####.', '...######.', '...#####..', '..#######.', '##########'],
  3: ['....##....', '...####...', '..###.##..', '..##.###..', '..######..', '...####...', '...####...', '...####...', '..######..', '...####...', '.########.', '##########'],
  4: ['.##.##.##.', '.########.', '..######..', '..######..', '..######..', '..######..', '..######..', '.########.', '##########', '##########'],
  5: ['.#..##..#.', '.#..##..#.', '.########.', '..######..', '...####...', '...####...', '...####...', '...####...', '..######..', '...####...', '..######..', '.########.', '##########'],
  6: ['....##....', '..######..', '....##....', '...####...', '..######..', '.########.', '..######..', '...####...', '...####...', '...####...', '..######..', '.########.', '##########', '##########'],
}
export const GLYPH_DEPTH = 2
export const glyphVoxels = (kind: number): number => GLYPHS[kind].join('').split('#').length - 1

// ---- pixels ---------------------------------------------------------------------------------------------------------------

/** 89x89 brightness bytes. Row y=0 is the near (+z) side, rank 1 for the viewer. Lines every 11 px; inner 0.5, border 1.0; light squares dithered at 0.25 */
export function boardPixels(): Uint8Array {
  const px = new Uint8Array(BOARD_PX * BOARD_PX)
  const inner = Math.round(0.5 * 255)
  const dither = Math.round(0.25 * 255)
  const last = BOARD_PX - 1
  for (let y = 0; y < BOARD_PX; y++)
    for (let x = 0; x < BOARD_PX; x++) {
      const onX = x % SQ_PX === 0
      const onY = y % SQ_PX === 0
      if (onX || onY) px[y * BOARD_PX + x] = x === 0 || y === 0 || x === last || y === last ? 255 : inner
      else if ((Math.floor(x / SQ_PX) + Math.floor(y / SQ_PX)) % 2 === 1 && (x + y) % 2 === 0) px[y * BOARD_PX + x] = dither
    }
  return px
}

// 3x5 pixel font, only a-h and 1-8
export const FONT: Record<string, string[]> = {
  a: ['.#.', '#.#', '###', '#.#', '#.#'],
  b: ['##.', '#.#', '##.', '#.#', '##.'],
  c: ['.##', '#..', '#..', '#..', '.##'],
  d: ['##.', '#.#', '#.#', '#.#', '##.'],
  e: ['###', '#..', '##.', '#..', '###'],
  f: ['###', '#..', '##.', '#..', '#..'],
  g: ['.##', '#..', '#.#', '#.#', '.##'],
  h: ['#.#', '#.#', '###', '#.#', '#.#'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
}
export const BOARD_OFF = (FILM_PX - BOARD_PX) / 2 // board's first pixel inside the film texture (16)

/** 121x121 coordinates over the film: letters under the near edge, digits left of the board, brightness 0.5. `flip` = black's side near. Row y=0 is the near side. */
export function coordPixels(flip: boolean): Uint8Array {
  const px = new Uint8Array(FILM_PX * FILM_PX)
  const v = Math.round(0.5 * 255)
  // a glyph's top row is its far row, so rows are written from the top (high y) down
  const glyph = (ch: string, x0: number, y0: number) => {
    const g = FONT[ch]
    for (let k = 0; k < 5; k++) for (let i = 0; i < 3; i++) if (g[k][i] === '#') px[(y0 + 4 - k) * FILM_PX + x0 + i] = v
  }
  for (let f = 0; f < 8; f++) glyph('abcdefgh'[flip ? 7 - f : f], BOARD_OFF + SQ_PX * f + 5, BOARD_OFF - 7)
  for (let r = 0; r < 8; r++) glyph(String(flip ? 8 - r : r + 1), BOARD_OFF - 5, BOARD_OFF + SQ_PX * r + 3)
  return px
}

function tex(src: Uint8Array, size: number): DataTexture {
  const data = new Uint8Array(src.length * 4)
  for (let i = 0; i < src.length; i++) data.fill(src[i], i * 4, i * 4 + 4)
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  t.minFilter = NearestFilter
  t.magFilter = NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

// ---- geometry -------------------------------------------------------------------------------------------------------------

/**
 * One merged glyph: 2 layers deep, standing (rows up the y axis, x across, z depth), visible faces only. Per vertex: aShade (hologram.md 11.2, #655:
 * front/back 1.0 (the face that draws the shape is the brightest), top 0.6, left/right 0.5), aRow (voxel row from the bottom) and aCap (1 = the top of a voxel with another above it, shown only while it is the topmost visible row).
 */
export function buildPieceGeometry(kind: number, ink = true): BufferGeometry {
  const rows = GLYPHS[kind]
  const H = rows.length
  const pos: number[] = []
  const shade: number[] = []
  const row: number[] = []
  const cap: number[] = []
  const idx: number[] = []
  const has = (c: number, rb: number) => rb >= 0 && rb < H && c >= 0 && c < 10 && rows[H - 1 - rb][c] === '#'
  const quad = (v: number[][], s: number, rb: number, cp: number) => {
    const base = pos.length / 3
    for (const p of v) {
      pos.push(p[0], p[1], p[2])
      shade.push(s)
      row.push(rb)
      cap.push(cp)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  // #659 the ink rim: the voxels next to the glyph (8 ways) that are not in it, from its foot up to a row over its top (none under the board).
  // Its rows show and go with the glyph's nearest row (aRow clamped), its faces carry aShade INK_SHADE (drawn in ink, no light, no scanline)
  const rim = (c: number, rb: number) => {
    if (!ink || rb < 0 || rb > H || c < -1 || c > 10 || has(c, rb)) return false
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (has(c + dx, rb + dy)) return true
    return false
  }
  const solid = (c: number, rb: number) => has(c, rb) || rim(c, rb)
  const h = (CBOX * CVOX) / 2
  for (let rb = 0; rb <= H; rb++)
    for (let c = -1; c <= 10; c++) {
      const glyph = has(c, rb)
      if (!glyph && !rim(c, rb)) continue
      const r = Math.min(rb, H - 1)
      const sh = (s: number) => (glyph ? s : INK_SHADE)
      const x0 = (c - 4.5) * CVOX - h
      const x1 = (c - 4.5) * CVOX + h
      const y0 = rb * CVOX + ((1 - CBOX) / 2) * CVOX
      const y1 = y0 + CBOX * CVOX
      for (let d = 0; d < GLYPH_DEPTH; d++) {
        const z0 = (d - 0.5) * CVOX - h
        const z1 = (d - 0.5) * CVOX + h
        quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], sh(SHADE.top), r, glyph && has(c, rb + 1) ? 1 : 0)
        if (d === GLYPH_DEPTH - 1) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], sh(SHADE.front), r, 0)
        if (d === 0) quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], sh(SHADE.front), r, 0)
        if (!solid(c + 1, rb)) quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], sh(SHADE.side), r, 0)
        if (!solid(c - 1, rb)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], sh(SHADE.side), r, 0)
      }
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('aShade', new Float32BufferAttribute(shade, 1))
  g.setAttribute('aRow', new Float32BufferAttribute(row, 1))
  g.setAttribute('aCap', new Float32BufferAttribute(cap, 1))
  g.setIndex(idx)
  return g
}

/** hologram.md 11.2 (#655): the pieces' face brightness, the face toward the viewer the brightest */
export const SHADE = { front: 1, side: 0.5, top: 0.6 } as const
/** hologram.md 11.2 (#659): a 1-voxel rim of --color-ink round the opaque glyph, 2 layers deep, unlit and without scanline: a piece's outline
 * is drawn over the same-coloured piece behind it. Its faces are marked by this aShade */
export const INK_SHADE = -1
/** hologram.md 11.2 (#655): the pieces' scanline, weaker than the board's 0.55 (a voxel is about 3 px, as the scanline's period) */
export const PIECE_SCAN = 0.85
/** hologram.md 11.2 (#655): the lean toward the camera comes and goes over this long (s) as the visitor's game view starts and ends */
export const TILT_S = 0.3

const PIECE_VERT = /* glsl */ `
attribute float aShade; attribute float aRow; attribute float aCap;
attribute vec3 iPos; attribute vec4 iSt; attribute vec4 iRows; attribute vec4 iCol;
uniform vec3 uCam; uniform float uTilt; uniform vec3 uInk; uniform vec3 uRimCursor;
varying vec3 vCol; varying float vA; varying float vInk;
const float VOX = ${CVOX};
const float BACK = ${(-GLYPH_DEPTH / 2) * CVOX};
void main() {
  // iSt = scale, brightness, alpha, yaw; iRows = first row, row count, sideways shake (m), stair flag (vanishing)
  bool vis = aRow + 0.5 > iRows.x && aRow + 0.5 < iRows.y && (aCap < 0.5 || iRows.y < aRow + 1.5);
  float k = mod(aRow, 2.0);
  float off = iRows.w > 0.5 ? (k < 1.0 ? 1.0 : -1.0) * (1.0 + mod(floor(aRow / 2.0), 2.0)) * VOX : 0.0;
  vec3 p = position; p.x += iRows.z + off; p *= iSt.x;
  // the visitor's game view (uTilt 1): the glyph leans back about its foot's back edge TILT_PART of the way to facing the line of sight (the
  // camera's elevation from the piece; full on, the opaque back rank hid the pawns behind it, #658); else it stands (yaw only)
  vec3 d = uCam - iPos;
  float e = uTilt * ${TILT_PART.toFixed(3)} * max(atan(d.y, max(length(d.xz), 1e-4)), 0.0);
  float ce = cos(e); float se = sin(e); float zb = BACK * iSt.x; float pz = p.z - zb;
  p = vec3(p.x, p.y * ce + pz * se, -p.y * se + pz * ce + zb);
  float c = cos(iSt.w); float s = sin(iSt.w);
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + iPos;
  // #659 the ink rim: its own colour, not the piece's, nor its brightness (a lit piece keeps a dark rim); #660 cyan on the cursor's piece (iCol.w)
  vInk = aShade < 0.0 ? 1.0 : 0.0;
  vCol = vInk > 0.5 ? (iCol.w > 0.5 ? uRimCursor : uInk) : iCol.rgb * aShade * iSt.y; vA = iSt.z;
  gl_Position = vis ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`

// ---- types ----------------------------------------------------------------------------------------------------------------

export interface HoloStage {
  root: Group
  uniforms: { uDpr: { value: number }; uAlpha: { value: number } }
  scan: string
  onRender: (r: WebGLRenderer) => void
  light(m: ShaderMaterial, blending: Blending): void
  inst(g: BufferGeometry, mat: ShaderMaterial, cap: number, attrs: Record<string, number>, order: number): InstancedMesh
  put(m: InstancedMesh, i: number, name: string, ...v: number[]): void
  flush(...ms: InstancedMesh[]): void
  flat(color: string, blending: Blending, map: DataTexture | null, opacity: number): ShaderMaterial
  toLocal(world: Vector3, out: Vector3): Vector3
  lift(): number
}

export interface ChessCaptured {
  kind: number // 1..6
  color: 1 | 2 // the captured piece's colour (2 = white)
}
/** a move that just landed (the drop frame). The board input is already the position after it. */
export interface ChessMoveEvent {
  /** unique per move (the ply number): the same id is handled once, so the caller may repeat the event every frame */
  id: number
  from: number
  to: number
  /** the clock time the piece touched down; animations run from it */
  at: number
  /** the captured piece and its cell (differs from `to` for en passant) */
  capture?: { sq: number; kind: number; color: 1 | 2 } | null
  /** castling: the rook's cells (king's move is from/to) */
  castle?: { from: number; to: number } | null
  /** promotion: the new piece kind 2..5 (the board already holds it on `to`) */
  promotion?: number
}
export interface ChessInput {
  /** engine board, a1 = 0, + white - black; with the held piece's cell either empty or named in held.from */
  board: Int8Array | null
  lastMove: { from: number; to: number } | null
  /** the king's cell while in check */
  check: number | null
  /** the pieces each side took, in order: key = the capturing colour (2 = white took these) */
  captured?: { 1: ChessCaptured[]; 2: ChessCaptured[] }
  /** the latest landed move (may be repeated) */
  move?: ChessMoveEvent | null
  /** end of game: checkmate (`loser` = the mated colour) or draw, from `since` */
  end?: { result: 'mate' | 'draw'; loser?: 1 | 2; since: number } | null
  /** turn the board so black's side is near */
  flip?: boolean
  /** camera position in world space (the pieces turn to face it) */
  camera?: Vector3
  /** the visitor's marks (11.3, 11.5); absent = none */
  visitor?: {
    /** the chosen piece's cell */
    selected: number | null
    /** squares it may move to; `capture` squares get cyan corners, the others a centre dot */
    targets: { sq: number; capture: boolean }[]
    /** keyboard cursor cell (cyan ring) */
    cursor: number | null
    /** while dragged: the selected piece follows this world point (2 cm over the board) instead of standing on its cell */
    drag: { pos: Vector3 } | null
  }
}
export interface ChessFrame {
  t: number
  reduced: boolean
  live: boolean // pieces shown (phase on or wait)
  on: boolean // marks shown
  c: ChessInput | undefined
  held: { pos: Vector3; kind?: number; color: 1 | 2; since: number; facing?: number; from?: number } | null
  glow(colour: number, x: number, z: number, r: number, a: number): void
  mark(x: number, y: number, z: number, sx: number, sz: number, rot: number, c: Color, bright: number, a?: number): void
  dot(x: number, y: number, z: number, sx: number, sz: number, c: Color, a: number): void
  /** #660 the same, drawn over the opaque pieces (no depth test): the visitor's cursor ring, target dots, capture corners */
  markOver?(x: number, y: number, z: number, sx: number, sz: number, rot: number, c: Color, bright: number, a?: number): void
  dotOver?(x: number, y: number, z: number, sx: number, sz: number, c: Color, a: number): void
}

const LAND = 0
const GROW = 1
interface Ghost { sq: number; code: number; start: number; dur: number }
interface Slide { sq: number; from: number; start: number; n: number; code: number }
interface Promo { sq: number; start: number; dur: number; oldCode: number; newCode: number }

const rowsOf = (kind: number) => GLYPHS[kind].length
const colourOf = (code: number) => (code > 0 ? 2 : 1)

// ---- the layer ------------------------------------------------------------------------------------------------------------

export class ChessLayer {
  readonly grid: Mesh
  readonly coords: Mesh
  readonly pieces: Record<1 | 2, Record<number, InstancedMesh>>
  readonly materials: { piece: ShaderMaterial; grid: ShaderMaterial; coords: ShaderMaterial }

  private readonly stage: HoloStage
  private readonly coordTex: [DataTexture, DataTexture]
  private readonly boardTex: DataTexture
  private dx = 0
  private dz = 1
  private flip = false
  private theta = 0
  private readonly cam = new Vector3()
  private hasCam = false
  private readonly v = new Vector3()

  private readonly disp = new Int8Array(64)
  private readonly born = new Float64Array(64).fill(-Infinity)
  private readonly birth = new Uint8Array(64)
  private ghosts: Ghost[] = []
  private slides: Slide[] = []
  private promos: Promo[] = []
  private ripples: { sq: number; colour: number; start: number }[] = []
  private shake: { sq: number; start: number } | null = null
  private prevCheck: number | null = null
  private lastId: number | null = null
  private capAppear: { 1: number[]; 2: number[] } = { 1: [], 2: [] }
  private pendCap: { end: number; until: number } | null = null
  private offAt: number | null = null
  private heldSince = NaN
  private heldYaw = 0
  /** #655 the lean toward the camera: where it was going from, to (0 standing, 1 facing the camera) and since when */
  private tilt = { from: 0, to: 0, at: -Infinity }

  constructor(stage: HoloStage) {
    this.stage = stage
    const pieceMat = new ShaderMaterial({
      vertexShader: PIECE_VERT,
      fragmentShader: /* glsl */ `
uniform float uDpr; uniform float uAlpha;
varying vec3 vCol; varying float vA; varying float vInk;
void main() {
  float scan = vInk > 0.5 ? 1.0 : mod(floor(gl_FragCoord.y / uDpr), 3.0) < 1.0 ? ${PIECE_SCAN.toFixed(2)} : 1.0;
  gl_FragColor = vec4(vCol * scan, vA * uAlpha);
  #include <colorspace_fragment>
}`,
      uniforms: { ...stage.uniforms, uCam: { value: new Vector3() }, uTilt: { value: 0 }, uInk: { value: new Color(CHESS_COLORS.ink) }, uRimCursor: { value: new Color(CHESS_COLORS.cyan) } },
    })
    // hologram.md 11.2 (#657, #655): the pieces' voxels are opaque (normal blending, depth written, unlit), not added light: a piece in front
    // hides the one behind it (the near pawns stand out against the back rank) at every view. Still drawn after the film (transparent pass,
    // render order 2) so a fading piece blends over it
    stage.light(pieceMat, NormalBlending)
    pieceMat.depthWrite = true
    this.boardTex = tex(boardPixels(), BOARD_PX)
    this.coordTex = [tex(coordPixels(false), FILM_PX), tex(coordPixels(true), FILM_PX)]
    const gridMat = stage.flat(CHESS_COLORS.grid, AdditiveBlending, this.boardTex, 1)
    const coordMat = stage.flat(CHESS_COLORS.grid, AdditiveBlending, this.coordTex[0], 1)
    this.materials = { piece: pieceMat, grid: gridMat, coords: coordMat }
    const plane = (size: number) => new PlaneGeometry(size, size).rotateX(-Math.PI / 2)
    this.grid = new Mesh(plane(BOARD_SIZE), gridMat)
    this.coords = new Mesh(plane(FILM_PX * PXC), coordMat)
    this.grid.renderOrder = 0
    this.coords.renderOrder = 0
    for (const m of [this.grid, this.coords]) {
      m.frustumCulled = false
      m.visible = false
      m.onBeforeRender = stage.onRender
      stage.root.add(m)
    }
    const geos: Record<number, BufferGeometry> = {}
    const meshes = (colour: 1 | 2) => {
      const out: Record<number, InstancedMesh> = {}
      for (let k = 1; k <= 6; k++) {
        geos[k] ??= buildPieceGeometry(k)
        out[k] = stage.inst(geos[k].clone(), pieceMat, 40, { iPos: 3, iSt: 4, iRows: 4, iCol: 4 }, 2)
        stage.root.add(out[k])
      }
      void colour
      return out
    }
    this.pieces = { 1: meshes(1), 2: meshes(2) }
    for (const k of Object.keys(geos)) geos[+k].dispose()
  }

  // ---- squares --------------------------------------------------------------------------------------------------------------

  /** set the board's turn from the seat of the near colour (white, or black when flipped); the other seat is used negated; none = white near +z */
  setOrientation(players: { seat: Vector3; color: number }[], flip: boolean) {
    this.flip = flip
    const near = flip ? 1 : 2
    let p = players.find((q) => q.color === near)
    let sg = 1
    if (!p) {
      p = players.find((q) => q.color !== near)
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
    const tex = this.coordTex[flip ? 1 : 0]
    this.materials.coords.uniforms.uMap.value = tex
  }

  /** surface-frame point of a cell centre (y = the light plane) */
  squareLocal(sq: number, out: Vector3): Vector3 {
    const s = this.flip ? -1 : 1
    return this.viewLocal(s * ((sq & 7) - 3.5) * SQ, s * ((sq >> 3) - 3.5) * SQ, out)
  }

  /** u metres to the viewer's right, w away from the viewer, on the light plane */
  private viewLocal(u: number, w: number, out: Vector3): Vector3 {
    return out.set(this.dz * u - this.dx * w, this.stage.lift(), -this.dx * u - this.dz * w)
  }

  /** the cell under a surface-frame point, or -1 */
  squareIndexLocal(p: Vector3): number {
    const u = this.dz * p.x - this.dx * p.z
    const w = -(this.dx * p.x + this.dz * p.z)
    const s = this.flip ? -1 : 1
    const f = Math.floor((s * u) / SQ + 4)
    const r = Math.floor((s * w) / SQ + 4)
    return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f
  }

  private yawAt(x: number, z: number): number {
    return this.hasCam ? Math.atan2(this.cam.x - x, this.cam.z - z) : 0
  }

  // ---- state ----------------------------------------------------------------------------------------------------------------

  clear() {
    this.disp.fill(0)
    this.born.fill(-Infinity)
    this.ghosts.length = 0
    this.slides.length = 0
    this.promos.length = 0
    this.ripples.length = 0
    this.shake = null
    this.prevCheck = null
    this.lastId = null
    this.capAppear = { 1: [], 2: [] }
    this.pendCap = null
    this.offAt = null
    this.heldSince = NaN
  }

  private any(c: ChessInput | undefined): boolean {
    return this.disp.some((v) => v !== 0) || this.ghosts.length > 0 || !!(c?.captured && (c.captured[1].length || c.captured[2].length))
  }

  /** the board folds: every piece shrinks away over 0.15 s (0.1 s fade when reduced) */
  killAll(t: number, c: ChessInput | undefined) {
    this.offAt = this.any(c) ? t : null
  }

  /** 1 while pieces are still fading out, else 0 */
  liveCount(t: number, reduced: boolean): number {
    if (this.offAt === null) return 0
    if (t - this.offAt >= (reduced ? 0.1 : 0.15)) {
      this.clear()
      return 0
    }
    return 1
  }

  /**
   * every frame: the board's turn and the camera (pieces face it). In the visitor's game view (c.visitor) they face it full on, leaning back
   * (hologram.md 11.2, #655); the lean comes and goes over TILT_S, at once when reduced
   */
  prepare(c: ChessInput | undefined, players: { seat: Vector3; color: number }[], t = 0, reduced = false) {
    this.setOrientation(players, !!c?.flip)
    if (c?.camera) {
      this.stage.toLocal(c.camera, this.cam)
      this.hasCam = true
    } else this.hasCam = false
    const to = this.hasCam && c?.visitor ? 1 : 0
    const now = this.tiltAt(t, reduced)
    if (to !== this.tilt.to) this.tilt = { from: now, to, at: t }
    const u = this.materials.piece.uniforms
    u.uTilt.value = this.tiltAt(t, reduced)
    ;(u.uCam.value as Vector3).copy(this.cam)
  }
  /** the lean at time t (0 standing … 1 facing the camera) */
  tiltAt(t: number, reduced = false): number {
    const { from, to, at } = this.tilt
    if (reduced) return to
    const k = Math.min(1, Math.max(0, (t - at) / TILT_S))
    return from + (to - from) * k * k * (3 - 2 * k)
  }

  /** drive state from the frame's inputs (phase on): reconcile the board, then events, captured row, check */
  sync(c: ChessInput | undefined, t: number, reduced: boolean, quiet: boolean, newGame: boolean, res: { landed: number[]; checkStart?: boolean }) {
    const board = c?.board ?? null
    // finish slides and promotions
    this.slides = this.slides.filter((s) => t - s.start < s.n * T_SLIDE)
    this.ghosts = this.ghosts.filter((g) => t - g.start < g.dur)
    this.promos = this.promos.filter((p) => {
      if (t - p.start < p.dur) return true
      this.disp[p.sq] = p.newCode
      return false
    })
    this.ripples = this.ripples.filter((r) => t - r.start < T_RIPPLE_C)

    if (newGame && !quiet) {
      for (let sq = 0; sq < 64; sq++) {
        if (!this.disp[sq]) continue
        const row = this.flip ? 7 - (sq >> 3) : sq >> 3
        this.ghosts.push({ sq, code: this.disp[sq], start: t + (7 - row) * 0.05, dur: reduced ? 0.1 : T_CAPTURE })
        this.disp[sq] = 0
      }
      this.promos.length = 0
      this.slides.length = 0
      this.capAppear = { 1: [], 2: [] }
      this.prevCheck = null
      return
    }

    // the landed move
    const ev = c?.move ?? null
    if (ev && ev.id !== this.lastId) {
      this.lastId = ev.id
      if (!quiet) this.apply(ev, board, reduced, res)
    }

    // reconcile the board with what is shown
    for (let sq = 0; sq < 64; sq++) {
      if (this.promos.some((p) => p.sq === sq)) continue
      const want = board ? board[sq] : 0
      if (this.disp[sq] === want) continue
      this.disp[sq] = want
      if (want) {
        this.born[sq] = quiet ? -Infinity : t
        this.birth[sq] = GROW
      }
    }

    // captured rows: a new entry shows once its capture vanish is over
    for (const col of [1, 2] as const) {
      const list = c?.captured?.[col] ?? []
      const a = this.capAppear[col]
      a.length = Math.min(a.length, list.length)
      while (a.length < list.length) {
        const p = this.pendCap
        a.push(!quiet && p && t < p.until ? p.end : -Infinity)
        if (p && !quiet && t < p.until) this.pendCap = null
      }
    }

    // check: a stair shake of the king the moment it starts
    const ck = c?.check ?? null
    if (ck !== null && ck !== this.prevCheck && !quiet) {
      if (!reduced) this.shake = { sq: ck, start: t }
      res.checkStart = true
    }
    if (ck === null) this.shake = null
    this.prevCheck = ck
  }

  private apply(ev: ChessMoveEvent, board: Int8Array | null, reduced: boolean, res: { landed: number[] }) {
    const at = ev.at
    const after = board ? board[ev.to] : 0
    const sgn = (this.disp[ev.from] || after) < 0 ? -1 : 1
    const mover = this.disp[ev.from] || after
    this.disp[ev.from] = 0
    if (ev.capture) {
      const sq = ev.capture.sq
      const code = this.disp[sq] || (ev.capture.color === 2 ? 1 : -1) * ev.capture.kind
      const dur = reduced ? 0.1 : T_CAPTURE
      this.ghosts.push({ sq, code, start: at, dur })
      this.disp[sq] = 0
      this.pendCap = { end: at + dur, until: at + 2 }
    }
    if (ev.castle) {
      const rook = this.disp[ev.castle.from] || sgn * 4
      this.disp[ev.castle.from] = 0
      this.disp[ev.castle.to] = rook
      this.born[ev.castle.to] = at
      this.birth[ev.castle.to] = LAND
      const n = Math.abs((ev.castle.to & 7) - (ev.castle.from & 7)) + Math.abs((ev.castle.to >> 3) - (ev.castle.from >> 3))
      if (!reduced && n > 0) this.slides.push({ sq: ev.castle.to, from: ev.castle.from, start: at, n, code: rook })
    }
    if (ev.promotion) {
      const pawn = sgn * 1
      this.disp[ev.to] = pawn
      this.promos.push({ sq: ev.to, start: at + T_PROMO_WAIT, dur: reduced ? 0.1 : T_PROMO, oldCode: pawn, newCode: sgn * ev.promotion })
    } else this.disp[ev.to] = mover
    this.born[ev.to] = at
    this.birth[ev.to] = LAND
    if (!reduced) this.ripples.push({ sq: ev.to, colour: sgn > 0 ? 2 : 1, start: at })
    res.landed.push(ev.to)
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------

  /** show / hide the board meshes and set their fold clip (the film's half extents) and brightness */
  setView(visible: boolean, hx: number, hz: number, bright: number) {
    const lift = this.stage.lift()
    const swap = Math.abs(Math.sin(this.theta)) > 0.5
    for (const m of [this.grid, this.coords]) {
      m.visible = visible
      m.position.y = lift
      m.rotation.y = this.theta
    }
    for (const mat of [this.materials.grid, this.materials.coords]) {
      ;(mat.uniforms.uClip.value as Vector2).set(swap ? hz : hx, swap ? hx : hz)
      mat.uniforms.uBright.value = bright
    }
  }

  private counts = new Map<InstancedMesh, number>()

  /** one glyph instance */
  private emit(kind: number, colour: number, x: number, y: number, z: number, o: { scale?: number; bright: number; alpha: number; lo?: number; hi?: number; shake?: number; stair?: boolean; yaw?: number; rim?: boolean }) {
    const m = this.pieces[colour === 2 ? 2 : 1][kind]
    const i = this.counts.get(m) ?? 0
    if (i >= 40) return
    this.counts.set(m, i + 1)
    const c = sideColor(colour)
    const s = this.stage
    s.put(m, i, 'iPos', x, y, z)
    s.put(m, i, 'iSt', o.scale ?? 1, o.bright, o.alpha, o.yaw ?? this.yawAt(x, z))
    s.put(m, i, 'iRows', o.lo ?? 0, o.hi ?? rowsOf(kind), o.shake ?? 0, o.stair ? 1 : 0)
    s.put(m, i, 'iCol', c.r, c.g, c.b, o.rim ? 1 : 0)
  }

  draw(f: ChessFrame) {
    const { t, reduced, c } = f
    const lift = this.stage.lift()
    const base = lift + CPIECE_Y
    const p = new Vector3()
    this.counts.clear()
    const off = this.offAt === null ? 0 : (t - this.offAt) / (reduced ? 0.1 : 0.15)
    const end = c?.end ?? null
    const endBright = (colour: number): number | null => {
      if (!end) return null
      const d = t - end.since
      if (end.result === 'draw') return d >= 0 && d < T_DRAW_DIM ? 0.6 : null
      return d >= 0 && d < T_MATE_GLOW && colour !== end.loser ? 1.3 : null
    }
    /** shrink factor 0..1 left of a vanish; rows count and fade */
    const vanish = (kind: number, k: number, o: { hi: number; alpha: number; stair: boolean }) => {
      if (reduced) o.alpha *= Math.max(0, 1 - k)
      else {
        o.hi = Math.min(o.hi, Math.ceil(rowsOf(kind) * (1 - k) - 1e-9))
        o.stair = k > 0
      }
    }

    if (f.live) {
      let kingSq = -1
      if (end?.result === 'mate' && end.loser) for (let sq = 0; sq < 64; sq++) if (this.disp[sq] === (end.loser === 2 ? 6 : -6)) kingSq = sq

      for (let sq = 0; sq < 64; sq++) {
        let code = this.disp[sq]
        const promo = this.promos.find((q) => q.sq === sq)
        if (promo) code = promo.oldCode
        if (!code || (f.held && f.held.from === sq && t >= f.held.since)) continue
        const vs = c?.visitor && c.visitor.selected === sq ? c.visitor : null
        if (vs?.drag) continue // drawn at the pointer below
        const colour = colourOf(code)
        const kind = Math.abs(code)
        this.squareLocal(sq, p)
        let x = p.x
        let z = p.z
        const slide = this.slides.find((q) => q.sq === sq)
        if (slide) {
          const step = Math.min(slide.n, Math.max(0, Math.floor((t - slide.start) / T_SLIDE)))
          const a = this.squareLocal(slide.from, new Vector3())
          x = a.x + (p.x - a.x) * (step / slide.n)
          z = a.z + (p.z - a.z) * (step / slide.n)
        }
        // look from its birth
        const a = t - this.born[sq]
        // #660 the keyboard cursor on this piece's square: its rim turns cyan (hologram.md 11.3)
        const o = { bright: 1, alpha: 1, hi: rowsOf(kind), stair: false, lo: 0, rim: c?.visitor?.cursor === sq }
        if (this.birth[sq] === LAND) {
          if (reduced) {
            o.alpha = Math.min(1, a / 0.1)
            o.bright = lerp(1.3, 1, a / 0.3)
          } else o.bright = lerp(1.3, 1, a / 0.2)
        } else if (reduced) o.alpha = Math.min(1, a / 0.1)
        else o.hi = Math.max(1, Math.ceil(rowsOf(kind) * Math.min(1, Math.max(0, a / 0.2)) - 1e-9))
        const eb = endBright(colour)
        if (eb !== null) o.bright = eb
        if (vs) o.bright = 1.3
        if (sq === kingSq && t >= end!.since) {
          const k = (t - end!.since) / (reduced ? 0.1 : T_CAPTURE)
          if (k >= 1) continue
          vanish(kind, k, o)
        }
        if (this.offAt !== null) vanish(kind, off, o)
        const shake = this.shake && this.shake.sq === sq && !reduced ? [1, -1, 1][Math.floor((t - this.shake.start) / T_SHAKE)] ?? 0 : 0
        if (o.hi <= 0 || o.alpha <= 0) continue
        if (promo && t >= promo.start) {
          const k = Math.min(1, (t - promo.start) / promo.dur)
          const nk = Math.abs(promo.newCode)
          if (reduced) {
            this.emit(kind, colour, x, base, z, { ...o, alpha: o.alpha * (1 - k) })
            this.emit(nk, colour, x, base, z, { ...o, alpha: o.alpha * k })
          } else {
            const cut = Math.floor(k * rowsOf(nk))
            if (cut < rowsOf(kind)) this.emit(kind, colour, x, base, z, { ...o, lo: cut })
            if (cut > 0) this.emit(nk, colour, x, base, z, { ...o, hi: cut })
          }
        } else this.emit(kind, colour, x, vs ? base + VISITOR_LIFT : base, z, { ...o, shake: shake * CVOX })
        f.glow(colour, x, z, CGLOW_R, 0.3 * o.alpha * (o.hi / rowsOf(kind)))
      }

      // the dragged piece: follows the pointer 2 cm over the board, facing the camera
      const vd = c?.visitor
      if (vd?.drag && vd.selected !== null && this.offAt === null) {
        const code = this.disp[vd.selected]
        if (code) {
          const q = this.stage.toLocal(vd.drag.pos, this.v)
          this.emit(Math.abs(code), colourOf(code), q.x, lift + VISITOR_DRAG_Y, q.z, { bright: 1.3, alpha: 1 })
          f.glow(colourOf(code), q.x, q.z, CGLOW_R, 0.1)
        }
      }

      // captured pieces vanishing where they stood
      for (const g of this.ghosts) {
        const d = t - g.start
        const colour = colourOf(g.code)
        const kind = Math.abs(g.code)
        this.squareLocal(g.sq, p)
        const o = { bright: 1, alpha: 1, hi: rowsOf(kind), stair: false }
        if (d > 0 && d < g.dur) vanish(kind, d / g.dur, o)
        else if (d >= g.dur) continue
        if (this.offAt !== null) vanish(kind, off, o)
        if (o.hi <= 0 || o.alpha <= 0) continue
        this.emit(kind, colour, p.x, base, p.z, o)
        f.glow(colour, p.x, p.z, CGLOW_R, 0.3 * o.alpha * (o.hi / rowsOf(kind)))
      }

      // the captured rows: outside the board, at the capturing side's right hand
      const near = this.flip ? 1 : 2
      for (const col of [1, 2] as const) {
        const list = c?.captured?.[col] ?? []
        for (let i = 0; i < list.length; i++) {
          if (t < (this.capAppear[col][i] ?? -Infinity)) continue
          const mine = col === near
          const u = (mine ? 1 : -1) * (4 * SQ + CAP_OUT + 5 * CVOX * CAP_SCALE)
          const w = mine ? -4 * SQ + SQ / 4 + i * (SQ / 2) : 4 * SQ - SQ / 4 - i * (SQ / 2)
          this.viewLocal(u, w, p)
          const kind = list[i].kind
          const o = { scale: CAP_SCALE, bright: CAP_BRIGHT, alpha: 1, hi: rowsOf(kind), stair: false }
          if (this.offAt !== null) vanish(kind, off, o)
          if (o.hi <= 0 || o.alpha <= 0) continue
          this.emit(kind, list[i].color, p.x, base, p.z, o)
          f.glow(list[i].color, p.x, p.z, CGLOW_R * CAP_SCALE, 0.3 * CAP_BRIGHT * o.alpha)
        }
      }
    }

    if (f.on) {
      // the held piece: keeps the facing it had at the pick, 1.3
      const h = f.held
      if (h && h.kind && t >= h.since) {
        const q = this.stage.toLocal(h.pos, this.v)
        if (h.since !== this.heldSince) {
          this.heldSince = h.since
          this.heldYaw = this.yawAt(q.x, q.z)
        }
        const alpha = reduced ? Math.min(1, (t - h.since) / 0.1) : 1
        this.emit(h.kind, h.color, q.x, q.y, q.z, { bright: 1.3, alpha, yaw: h.facing ?? this.heldYaw })
        const rise = Math.min(1, Math.max(0, (q.y - base) / 0.06))
        f.glow(h.color, q.x, q.z, CGLOW_R, lerp(0.3, 0.1, rise) * alpha)
      } else if (!h) this.heldSince = NaN

      // last move: red L-corners at the four corners of both cells (arms 3 px, 1 px)
      const dotY = lift + 0.0004
      const corners = (sq: number) => {
        this.squareLocal(sq, p)
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            f.dot(p.x + sx * 3.5 * PXC, dotY, p.z + sz * 4.5 * PXC, 3 * PXC, PXC, RED, 1)
            f.dot(p.x + sx * 4.5 * PXC, dotY, p.z + sz * 3.5 * PXC, PXC, 3 * PXC, RED, 1)
          }
      }
      const lm = c?.lastMove
      if (lm) {
        corners(lm.from)
        corners(lm.to)
      }
      // check: a red 1 px border round the king's cell
      if (c?.check !== null && c?.check !== undefined) {
        this.squareLocal(c.check, p)
        for (const s of [-1, 1]) {
          f.dot(p.x, dotY, p.z + s * 4.5 * PXC, 10 * PXC, PXC, RED, 1)
          f.dot(p.x + s * 4.5 * PXC, dotY, p.z, PXC, 8 * PXC, RED, 1)
        }
      }
      // the visitor's marks: centre dots (0.7), cyan ring round the cursor, cyan corners over the red last-move corners; over the pieces
      // (#660: not hidden by the opaque glyphs; the red last move stays under them)
      const vm = c?.visitor
      const mark = f.markOver ?? f.mark
      const dot = f.dotOver ?? f.dot
      if (vm) {
        const my = lift + CGLOW_Y
        for (const tg of vm.targets) {
          if (tg.capture) continue
          this.squareLocal(tg.sq, p)
          mark(p.x, my, p.z, 2 * PXC, 2 * PXC, 0, CYAN, 0.7)
        }
        if (vm.cursor !== null) {
          this.squareLocal(vm.cursor, p)
          for (const s of [-1, 1]) {
            mark(p.x, my, p.z + s * 4.5 * PXC, 10 * PXC, PXC, 0, CYAN, 1)
            mark(p.x + s * 4.5 * PXC, my, p.z, PXC, 8 * PXC, 0, CYAN, 1)
          }
        }
        for (const tg of vm.targets) {
          if (!tg.capture) continue
          this.squareLocal(tg.sq, p)
          for (const sx of [-1, 1])
            for (const sz of [-1, 1]) {
              dot(p.x + sx * 3.5 * PXC, dotY + 0.0001, p.z + sz * 4.5 * PXC, 3 * PXC, PXC, CYAN, 1)
              dot(p.x + sx * 4.5 * PXC, dotY + 0.0001, p.z + sz * 3.5 * PXC, PXC, 3 * PXC, CYAN, 1)
            }
        }
      }
      // landing ripple from one square size
      for (const r of this.ripples) {
        const a = t - r.start
        if (a < 0) continue
        const step = Math.min(3, Math.floor((a / T_RIPPLE_C) * 4))
        const R = RIPPLE_RADII_C[step] * SQ
        const bright = 0.6 * (1 - a / T_RIPPLE_C)
        this.squareLocal(r.sq, p)
        const col = sideColor(r.colour)
        const y = lift + CGLOW_Y
        f.mark(p.x, y, p.z - R, 2 * R + PXC, PXC, 0, col, bright)
        f.mark(p.x, y, p.z + R, 2 * R + PXC, PXC, 0, col, bright)
        f.mark(p.x - R, y, p.z, PXC, 2 * R - PXC, 0, col, bright)
        f.mark(p.x + R, y, p.z, PXC, 2 * R - PXC, 0, col, bright)
      }
    }

    const all: InstancedMesh[] = []
    for (const colour of [1, 2] as const)
      for (let k = 1; k <= 6; k++) {
        const m = this.pieces[colour][k]
        m.count = this.counts.get(m) ?? 0
        all.push(m)
      }
    this.stage.flush(...all)
  }

  /** instances drawn this frame for a kind and colour (tests) */
  count(kind: number, colour: 1 | 2): number {
    return this.pieces[colour][kind].count
  }

  /** the shown piece code of a cell (tests) */
  shown(sq: number): number {
    return this.disp[sq]
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose()
    this.boardTex.dispose()
    for (const t of this.coordTex) t.dispose()
    for (const o of [this.grid, this.coords]) o.geometry.dispose()
    for (const colour of [1, 2] as const) for (const m of Object.values(this.pieces[colour])) m.geometry.dispose()
  }
}
