// The LED pixel face (#193 2/2, docs/design/robots.md 3-5): a 24 x 14 grid of lit pixels for one agent and one
// expression. Pure: parameters in, a grid of palette codes out. No three.js, no canvas, no allocation per call.

export const FACE_W = 24
export const FACE_H = 14

/** the palette a lit pixel can have; the agent's own colour is MAIN, the failure red replaces it */
export const P = { OFF: 0, MAIN: 1, IVORY: 2, SWEAT: 3, PINK: 4, RED: 5 } as const
export const PALETTE_HEX = { ivory: '#fff6e0', sweat: '#8fd3ff', pink: '#ff8fb8', red: '#ff5a5f' }

export const EXPRESSIONS = ['neutral', 'focused', 'thinking', 'proud', 'embarrassed', 'surprised', 'greeting', 'joy', 'sleepy', 'asleep', 'bored', 'question', 'anxious', 'nodding', 'yielding'] as const
export type Expression = (typeof EXPRESSIONS)[number]

/** the names of robots.md 4, for the judging sheet and the debug panel */
export const EXPRESSION_KO: Record<Expression, string> = {
  neutral: '평소', focused: '집중', thinking: '생각', proud: '뿌듯', embarrassed: '당황', surprised: '놀람', greeting: '반가움', joy: '기쁨',
  sleepy: '졸림', asleep: '잠', bored: '지루', question: '의문', anxious: '초조', nodding: '끄덕임', yielding: '양보',
}

/** who: 0 메모 (bars), 1 메시 (hollow squares), 2 휴 (circles + cheeks), 3 루프 (blocks + a cursor), 4 에코 (a waveform) */
export const ECHO = 4

/** the whole face is dimmed with these: sleepy 60 %, asleep 45 % (robots.md 4) */
export const dimOf = (e: Expression) => (e === 'sleepy' ? 0.6 : e === 'asleep' ? 0.45 : 1)

/** which expressions are an event (they win over a talk and over a state; priority, robots.md 4) */
export const EVENT_EXPRESSIONS: ReadonlySet<Expression> = new Set<Expression>(['proud', 'embarrassed', 'surprised', 'greeting', 'joy', 'question', 'yielding'])
/** talk / meeting tier */
export const TALK_EXPRESSIONS: ReadonlySet<Expression> = new Set<Expression>(['nodding'])
/** how long an event lasts, s (robots.md 4); the states have none */
export const EVENT_SECONDS: Partial<Record<Expression, number>> = { proud: 3, embarrassed: 3, surprised: 1.2, greeting: 2, joy: 2.5, question: 2, yielding: 1.5 }

export interface FaceGrid {
  /** FACE_W * FACE_H palette codes, row by row */
  cells: Uint8Array
  /** brightness 0..255 of each lit pixel (255 unless Echo's waveform is blending) */
  lum: Uint8Array
}
export const newGrid = (): FaceGrid => ({ cells: new Uint8Array(FACE_W * FACE_H), lum: new Uint8Array(FACE_W * FACE_H) })

export interface FaceParams {
  agent: number
  expr: Expression
  /** 0 open, 1 half closed, 2 closed (a blink, or the swap of an expression) */
  blink: 0 | 1 | 2
  /** the eyes' look, pixels: -1 left, +1 right (the viewer's), up = -1 */
  gx: number
  gy: number
  /** the talking mouth: -1 none, else the shape 0 short line, 1 'o', 2 wide line */
  mouth: number
  /** the cursor of Loop is lit */
  cursor: boolean
  /** the failure red (1.5 s) */
  red: boolean
  /** Echo's waveform amplitude from the voice, 0..1 */
  amp: number
  /** a step counter of the little animations (sparkle, zzz, the waveform's travel); 0 = still */
  anim: number
  /** seconds since the expression began (Echo's single spike dies out) */
  age: number
  /** Echo only: the expression it blends from and how far (0 = all `from`, 1 = all `expr`) */
  from: Expression | null
  blend: number
}

export const newParams = (): FaceParams => ({ agent: 0, expr: 'neutral', blink: 0, gx: 0, gy: 0, mouth: -1, cursor: true, red: false, amp: 0, anim: 0, age: 0, from: null, blend: 1 })

// ------------------------------------------------------------------------------------------------------------------ pixels

const put = (g: FaceGrid, x: number, y: number, code: number, lum = 255) => {
  if (x < 0 || x >= FACE_W || y < 0 || y >= FACE_H) return
  const i = y * FACE_W + x
  if (g.cells[i] === P.OFF || g.lum[i] < lum) {
    g.cells[i] = code
    g.lum[i] = lum
  } else if (g.cells[i] !== code && lum >= g.lum[i]) g.cells[i] = code
}
const hline = (g: FaceGrid, x0: number, x1: number, y: number, code: number, lum = 255) => {
  for (let x = x0; x <= x1; x++) put(g, x, y, code, lum)
}
const clearRect = (g: FaceGrid, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = Math.max(0, y0); y <= Math.min(FACE_H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(FACE_W - 1, x1); x++) g.cells[y * FACE_W + x] = P.OFF
}

/** a bitmap drawn from rows of '#': (x0, y0) the top left */
const stamp = (g: FaceGrid, x0: number, y0: number, rows: readonly string[], code: number) => {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') put(g, x0 + c, y0 + r, code)
}

// ------------------------------------------------------------------------------------------------------------------ eyes

/** the eye of an agent: width of the left eye's box and where it starts (the right one is its mirror) */
const EYE = [
  { w: 2, x0: 7 }, // memo: vertical bars 2 x 4
  { w: 4, x0: 6 }, // mesh: hollow squares 4 x 4
  { w: 4, x0: 6 }, // hue: circles 4 x 4
  { w: 3, x0: 6 }, // loop: blocks 3 x 4
] as const

type EyeKind = 'open' | 'wide' | 'narrow' | 'arch' | 'soft' | 'cross' | 'closed' | 'half' | 'lid' | 'flat' | 'brow'

/** the cell (cx, cy) of a w x h shape of this agent is lit: bars and blocks full, mesh hollow, hue round */
function shapeCell(agent: number, w: number, h: number, cx: number, cy: number): boolean {
  if (agent === 1) return h <= 2 || w <= 2 ? true : cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1
  if (agent === 2) {
    if (h <= 2 || w <= 2) return true
    const dx = (cx + 0.5 - w / 2) / (w / 2)
    const dy = (cy + 0.5 - h / 2) / (h / 2)
    return dx * dx + dy * dy <= 1.02 + (w >= 5 ? 0.12 : 0)
  }
  return true
}

function box(g: FaceGrid, agent: number, x0: number, y0: number, w: number, h: number, code: number, dx: number, dy: number) {
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (shapeCell(agent, w, h, cx, cy)) put(g, x0 + cx + dx, y0 + cy + dy, code)
}

/** one eye of the pair. `side` 0 = left (the viewer's), 1 = right (mirrored) */
function eye(g: FaceGrid, agent: number, kind: EyeKind, side: 0 | 1, code: number, dx: number, dy: number, raised: boolean) {
  const { w, x0 } = EYE[agent]
  // the box of a given width, left edge a (left eye); mirrored for the right
  const at = (bw: number, grow: number) => {
    const lx = x0 - grow
    return side === 0 ? lx : FACE_W - lx - bw
  }
  switch (kind) {
    case 'open':
      return box(g, agent, at(w, 0), 3, w, 4, code, dx, dy)
    case 'wide': {
      const bw = w === 2 ? 3 : w + 1
      return box(g, agent, at(bw, bw - w), 2, bw, 5, code, dx, dy)
    }
    case 'narrow': {
      box(g, agent, at(w, 0), 5, w, 2, code, dx, dy)
      // the brow slants down toward the nose: the outer end is higher
      const left = at(w, 0)
      for (let c = 0; c < w; c++) {
        const inner = side === 0 ? c >= w / 2 : c < w / 2
        put(g, left + c + dx, (inner ? 3 : 2) + dy, code)
      }
      return
    }
    case 'arch': {
      // ^ : 4 wide for everyone
      const l = side === 0 ? 6 : 14
      put(g, l + 1, 4, code)
      put(g, l + 2, 4, code)
      put(g, l, 5, code)
      put(g, l + 3, 5, code)
      return
    }
    case 'soft': {
      // a soft cup: the corners up, the middle down
      const l = side === 0 ? 6 : 14
      put(g, l, 4, code)
      put(g, l + 3, 4, code)
      put(g, l + 1, 5, code)
      put(g, l + 2, 5, code)
      return
    }
    case 'cross': {
      // > <
      const l = side === 0 ? 6 : 15
      const rows = side === 0 ? ['#..', '.#.', '..#', '.#.', '#..'] : ['..#', '.#.', '#..', '.#.', '..#']
      return stamp(g, l, 2, rows, code)
    }
    case 'closed':
      return hline(g, at(w, 0), at(w, 0) + w - 1, 5, code)
    case 'half':
      return box(g, agent, at(w, 0), 4, w, 2, code, 0, 0)
    case 'lid':
      // the lid half down: two rows at the bottom of the eye
      return box(g, agent, at(w, 0), 5, w, 2, code, dx, dy)
    case 'flat':
      return box(g, agent, at(w + 1, 1), 4, w + 1, 2, code, dx, dy)
    case 'brow': {
      // one brow up: a normal eye (the raised side one row taller) and a brow line well above
      const bx = at(w, 0)
      if (raised) {
        box(g, agent, bx, 3, w, 4, code, dx, dy)
        hline(g, bx + dx, bx + w - 1 + dx, 1 + dy, code)
      } else box(g, agent, bx, 4, w, 3, code, dx, dy)
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ mouths

const MOUTH_ROW = 9
type Mouth = 'short' | 'line' | 'side' | 'smile' | 'big' | 'wavy' | 'o' | 'long' | 'wide' | 'tiny' | 'none'

function mouth(g: FaceGrid, kind: Mouth, code: number) {
  const r = MOUTH_ROW
  switch (kind) {
    case 'short':
      return hline(g, 11, 12, r + 1, code)
    case 'tiny':
      return hline(g, 11, 12, r + 1, code)
    case 'line':
      return hline(g, 9, 14, r + 1, code)
    case 'wide':
      return hline(g, 8, 15, r + 1, code)
    case 'long':
      return hline(g, 7, 16, r + 1, code)
    case 'side':
      hline(g, 11, 14, r + 1, code)
      return put(g, 15, r, code)
    case 'smile':
      put(g, 9, r, code)
      put(g, 14, r, code)
      return hline(g, 10, 13, r + 1, code)
    case 'big':
      hline(g, 9, 14, r, code)
      hline(g, 10, 13, r + 1, code)
      return hline(g, 11, 12, r + 2, code)
    case 'wavy':
      for (let k = 0; k < 8; k++) put(g, 8 + k, k % 2 === 0 ? r + 2 : r + 1, code)
      return
    case 'o':
      hline(g, 11, 12, r, code)
      put(g, 10, r + 1, code)
      put(g, 13, r + 1, code)
      return hline(g, 11, 12, r + 2, code)
    case 'none':
      return
  }
}

// ------------------------------------------------------------------------------------------------------------------ symbols

const SYMBOL_X = 20
function symbol(g: FaceGrid, e: Expression, agent: number, p: FaceParams) {
  const still = p.anim === 0
  switch (e) {
    case 'thinking':
      // … : three dots on the bottom row of the symbol area
      clearRect(g, 19, 0, 23, 6)
      for (const x of [19, 21, 23]) put(g, x, 6, P.IVORY)
      return
    case 'surprised':
      clearRect(g, 19, 0, 23, 6)
      return stamp(g, SYMBOL_X + 1, 0, ['#', '#', '#', '#', '.', '#'], P.IVORY)
    case 'question':
      clearRect(g, 19, 0, 23, 6)
      return stamp(g, SYMBOL_X, 0, ['###', '..#', '.#.', '.#.', '...', '.#.'], P.IVORY)
    case 'embarrassed':
      clearRect(g, 19, 0, 23, 6)
      return stamp(g, SYMBOL_X, 0, ['.#.', '.#.', '###', '###', '###', '.#.'], P.SWEAT)
    case 'anxious':
      clearRect(g, 19, 0, 23, 6)
      return stamp(g, SYMBOL_X, 0, ['###', '.#.', '.#.', '#.#', '###'], P.IVORY)
    case 'asleep': {
      // zzz: three z's climbing, one more every step
      const n = still ? 3 : (p.anim % 4) + 0
      clearRect(g, 14, 0, 23, 9)
      if (n >= 1) stamp(g, 15, 7, ['###', '.#.', '###'], P.IVORY)
      if (n >= 2) stamp(g, 18, 3, ['###', '.#.', '###'], P.IVORY)
      if (n >= 3) stamp(g, 21, 0, ['##', '.#', '##'], P.IVORY)
      return
    }
    case 'yielding':
      clearRect(g, 19, 0, 23, 6)
      return stamp(g, 19, 1, ['...#.', '....#', '#####', '....#', '...#.'], P.IVORY)
    case 'proud':
    case 'joy':
      clearRect(g, 19, 0, 23, 6)
      if (agent === ECHO && e === 'joy') return stamp(g, SYMBOL_X, 0, ['.##', '.#.', '.#.', '##.', '##.'], P.IVORY)
      return stamp(g, SYMBOL_X, 1, still || p.anim % 2 === 0 ? ['.#.', '###', '.#.'] : ['#.#', '.#.', '#.#'], P.IVORY)
    default:
  }
}

// ------------------------------------------------------------------------------------------------------------------ Echo's waveform

/** a stable noise 0..1 from two integers */
const hash2 = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const CY = 7
const TAU = Math.PI * 2

/** the row of the line at column x for a waveform expression; null = no line (the bars draw themselves) */
function waveY(e: Expression, x: number, p: FaceParams): number {
  const ph = p.anim
  const dx = (x - 11.5) / 11.5
  switch (e) {
    case 'neutral':
      return CY + (1.2 + 3 * p.amp) * Math.sin(TAU * (x / 12 + ph / 12))
    case 'thinking':
      return CY + 2 * Math.sin(TAU * (x / 20 + ph / 24))
    case 'proud':
      return 9 - 5.5 * dx * dx + (ph % 2 === 0 ? 0 : 0.4)
    case 'joy':
      return 9.5 - 6 * dx * dx + 0.6 * Math.sin(TAU * (x / 6 + ph / 4))
    case 'yielding':
      return 8.5 - 2.5 * dx * dx
    case 'embarrassed':
      return CY + (hash2(x, ph) - 0.5) * 7
    case 'surprised':
      return CY - 5.5 * Math.exp(-(((x - 11.5) / 2.4) ** 2)) * Math.exp(-p.age * 2.5)
    case 'greeting':
      return CY + 3.5 * Math.sin(TAU * (x / 6 + ph / 3))
    case 'sleepy':
      return CY + 1 * Math.sin(TAU * (x / 16 + ph / 32))
    case 'anxious':
      return CY + 2 * Math.sin(TAU * (x / 5 + ph / 2)) + (hash2(x, ph) - 0.5) * 2.2
    case 'nodding':
      return CY - 3 * Math.exp(-(((x - 11.5) / 4.5) ** 2))
    default:
      return CY // asleep, bored, question: a flat line
  }
}

function echoWave(g: FaceGrid, e: Expression, p: FaceParams, code: number, lum: number) {
  if (lum <= 0) return
  if (e === 'focused') {
    // five bars of a spectrum, 3 wide, one apart, rising from the bottom
    for (let b = 0; b < 5; b++) {
      const h = 3 + Math.floor(hash2(b + 1, p.anim) * 7)
      for (let k = 0; k < 3; k++) for (let y = 0; y < h; y++) put(g, 2 + b * 4 + k, 12 - y, code, lum)
    }
    return
  }
  let prev = Math.round(waveY(e, 0, p))
  put(g, 0, prev, code, lum)
  for (let x = 1; x < FACE_W; x++) {
    const y = Math.round(waveY(e, x, p))
    const mid = Math.round((prev + y) / 2)
    const lo = Math.min(mid, y)
    const hi = Math.max(mid, y)
    for (let r = lo; r <= hi; r++) put(g, x, r, code, lum)
    prev = y
  }
}

// ------------------------------------------------------------------------------------------------------------------ the expressions

interface Look {
  eyes: EyeKind
  mouth: Mouth
  /** a look forced by the picture itself (thinking, bored) */
  gx?: number
  gy?: number
  cheeks?: boolean
}
const LOOK: Record<Expression, Look> = {
  neutral: { eyes: 'open', mouth: 'short' },
  focused: { eyes: 'narrow', mouth: 'line' },
  thinking: { eyes: 'open', mouth: 'side', gx: 1, gy: -1 },
  proud: { eyes: 'arch', mouth: 'smile' },
  embarrassed: { eyes: 'cross', mouth: 'wavy' },
  surprised: { eyes: 'wide', mouth: 'o' },
  greeting: { eyes: 'wide', mouth: 'smile', cheeks: true },
  joy: { eyes: 'arch', mouth: 'big', cheeks: true },
  sleepy: { eyes: 'lid', mouth: 'tiny' },
  asleep: { eyes: 'closed', mouth: 'none' },
  bored: { eyes: 'flat', mouth: 'long', gx: 1 },
  question: { eyes: 'brow', mouth: 'short' },
  anxious: { eyes: 'open', mouth: 'wavy' },
  nodding: { eyes: 'soft', mouth: 'short' },
  yielding: { eyes: 'arch', mouth: 'smile' },
}

/** the eyes that a blink may close: arches, crosses and the already closed ones stay as they are except by `blink` */
const OPENABLE: ReadonlySet<EyeKind> = new Set<EyeKind>(['open', 'wide', 'narrow', 'flat', 'brow', 'lid'])

export function renderFace(g: FaceGrid, p: FaceParams): void {
  g.cells.fill(P.OFF)
  g.lum.fill(0)
  const main = p.red ? P.RED : P.MAIN
  if (p.agent === ECHO) {
    if (p.from && p.blend < 1) echoWave(g, p.from, p, main, Math.round(255 * (1 - p.blend)))
    echoWave(g, p.expr, p, main, Math.round(255 * (p.from && p.blend < 1 ? p.blend : 1)))
    symbol(g, p.expr, ECHO, p)
    return
  }
  const look = LOOK[p.expr]
  const gx = look.gx ?? p.gx
  const gy = look.gy ?? p.gy
  if (p.blink === 0) {
    const kind = look.eyes
    const moves = OPENABLE.has(kind) || p.expr === 'thinking'
    for (const side of [0, 1] as const) eye(g, p.agent, kind, side, main, moves ? gx : 0, moves ? gy : 0, side === 1)
  } else {
    // a blink: every eye shrinks to two rows, then one
    const kind: EyeKind = p.blink === 1 ? 'half' : 'closed'
    for (const side of [0, 1] as const) eye(g, p.agent, kind, side, main, 0, 0, false)
  }
  if (p.agent === 2) {
    // hue's cheeks are always there; the others blush when they are glad
    hline(g, 4, 5, 8, P.PINK)
    hline(g, 18, 19, 8, P.PINK)
  } else if (look.cheeks) {
    hline(g, 4, 5, 8, P.PINK)
    hline(g, 18, 19, 8, P.PINK)
  }
  // the mouth: the talking shapes while a bubble types (not asleep); Loop's `_` cursor is the quiet mouth
  let m: Mouth = look.mouth
  if (p.mouth >= 0 && p.expr !== 'asleep' && p.expr !== 'sleepy') m = p.mouth === 0 ? 'short' : p.mouth === 1 ? 'o' : 'wide'
  if (p.agent === 3 && (m === 'short' || m === 'tiny' || m === 'wide' || m === 'o') && p.expr !== 'asleep') {
    if (p.cursor) hline(g, 10, 12, 11, main)
  } else mouth(g, m, main)
  symbol(g, p.expr, p.agent, p)
}

/** the number of pixels lit by a face (tests) */
export const litCount = (g: FaceGrid) => {
  let n = 0
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== P.OFF) n++
  return n
}
