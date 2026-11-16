// #605 alkkagi (알까기), apart from any drawing (the hologram table, #538): stones on a go board, each side flicks one of its own in turn to
// knock the other's off the board; a side with none left loses. A deterministic 2D simulation of flat discs, behind the game frame
// (boardGame.ts).
//
// Determinism: a fixed time step, the pairs in one order, and only + - * / and sqrt (correctly rounded in every browser) inside the
// simulation; no trig, no clock, no Math.random. A flick is integers (a direction vector and a power out of 1000), so it is the same
// written down and read back.
//
// Energy: friction only takes speed away, and a collision of two equal discs with restitution e <= 1 never adds kinetic energy
// (it loses (1 - e^2)/4 of the closing speed squared); pushing overlapping discs apart moves them without changing their speeds.
//
// Units: the board's line spacing is 1; the 19 lines run from -9 to 9 and the wood goes on to EDGE. A stone is off the board once its
// centre is past the edge (it tips over and falls).

import { hash, rng } from '../office/play'
import type { BoardGame, Level, Outcome, Side } from './boardGame'

export const ALK = {
  /** the wood's half width (the outer lines at 9, a margin past them) */
  edge: 9.6,
  /** a stone's radius (a go stone a little under the line spacing) */
  radius: 0.46,
  /** s per simulation step */
  dt: 1 / 240,
  /** sliding friction: the speed lost per second (lines/s²) */
  friction: 7,
  /** the speed of a full-power flick (lines/s): it would slide about 48 lines on open wood */
  maxSpeed: 26,
  /** bounce between stones (1 elastic, below loses energy) */
  restitution: 0.9,
  /** a simulation gives up after this many steps (all stones have long stopped by then) */
  maxSteps: 4000,
  /** after this many flicks the game ends: more stones on the board wins, the same count draws */
  maxTurns: 80,
  /** stones per side at the start */
  perSide: 5,
} as const

export interface Stone {
  x: number
  y: number
  side: Side
  /** knocked off the board */
  out: boolean
}

export interface AlkkagiState {
  readonly stones: readonly Stone[]
  readonly toMove: Side
  /** flicks played */
  readonly turn: number
}

/** a flick: which stone (an index into `stones`), its direction (any non-zero integer vector), its power 1..1000 */
export interface Flick {
  stone: number
  dx: number
  dy: number
  power: number
}

/** the start: each side's stones on a line across its own half (side 0 near y = -6, side 1 near y = +6) */
export function startPosition(perSide: number = ALK.perSide): AlkkagiState {
  const stones: Stone[] = []
  for (const side of [0, 1] as const) {
    for (let i = 0; i < perSide; i++) {
      const x = (i - (perSide - 1) / 2) * 2
      stones.push({ x, y: side === 0 ? -6 : 6, side, out: false })
    }
  }
  return { stones, toMove: 0, turn: 0 }
}

export const onBoard = (s: AlkkagiState, side: Side) => s.stones.filter((st) => !st.out && st.side === side).length

/** what happened on one step that the table shows or plays: two stones meeting (the closing speed), a stone going off the edge */
export type AlkEvent = { step: number; kind: 'hit'; a: number; b: number; speed: number } | { step: number; kind: 'out'; a: number }

export interface Trace {
  /** the position after the flick, all stones at rest */
  end: AlkkagiState
  /** stone positions every `every` steps (the first is the start, the last the rest) */
  frames: { x: number; y: number; out: boolean }[][]
  events: AlkEvent[]
  /** steps simulated */
  steps: number
  /** the kinetic energy (sum of v²/2, unit masses) at each frame, for the tests */
  energy: number[]
}

export function validFlick(s: AlkkagiState, f: Flick): boolean {
  const st = s.stones[f.stone]
  return (
    !!st && !st.out && st.side === s.toMove && Number.isInteger(f.dx) && Number.isInteger(f.dy) && (f.dx !== 0 || f.dy !== 0) &&
    Math.abs(f.dx) <= 1000 && Math.abs(f.dy) <= 1000 && Number.isInteger(f.power) && f.power >= 1 && f.power <= 1000
  )
}

/** run a flick to rest: the end position, and (every `every` steps) the frames and events the table draws and sounds */
export function simulate(s: AlkkagiState, f: Flick, every = 4): Trace {
  const { radius, dt, friction, restitution, edge, maxSteps } = ALK
  const n = s.stones.length
  const x = s.stones.map((st) => st.x)
  const y = s.stones.map((st) => st.y)
  const out = s.stones.map((st) => st.out)
  const vx = new Array<number>(n).fill(0)
  const vy = new Array<number>(n).fill(0)
  const len = Math.sqrt(f.dx * f.dx + f.dy * f.dy)
  const v0 = (f.power / 1000) * ALK.maxSpeed
  vx[f.stone] = (f.dx / len) * v0
  vy[f.stone] = (f.dy / len) * v0
  const events: AlkEvent[] = []
  const frames: Trace['frames'] = []
  const energy: number[] = []
  const snap = () => {
    frames.push(x.map((_, i) => ({ x: x[i], y: y[i], out: out[i] })))
    let e = 0
    for (let i = 0; i < n; i++) e += (vx[i] * vx[i] + vy[i] * vy[i]) / 2
    energy.push(e)
  }
  snap()
  const d2 = 2 * radius
  let step = 0
  for (; step < maxSteps; step++) {
    let moving = false
    // slide, losing speed to friction
    for (let i = 0; i < n; i++) {
      if (out[i]) continue
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i])
      if (sp === 0) continue
      const left = sp - friction * dt
      if (left <= 0) {
        vx[i] = 0
        vy[i] = 0
        continue
      }
      vx[i] *= left / sp
      vy[i] *= left / sp
      x[i] += vx[i] * dt
      y[i] += vy[i] * dt
      moving = true
    }
    // stones meeting: equal masses, an impulse along the line between centres, then pushed apart
    for (let i = 0; i < n; i++) {
      if (out[i]) continue
      for (let j = i + 1; j < n; j++) {
        if (out[j]) continue
        let nx = x[j] - x[i]
        let ny = y[j] - y[i]
        const d = Math.sqrt(nx * nx + ny * ny)
        if (d >= d2) continue
        if (d === 0) {
          nx = 1
          ny = 0
        } else {
          nx /= d
          ny /= d
        }
        const closing = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny
        if (closing > 0) {
          const k = ((1 + restitution) / 2) * closing
          vx[i] -= k * nx
          vy[i] -= k * ny
          vx[j] += k * nx
          vy[j] += k * ny
          events.push({ step, kind: 'hit', a: i, b: j, speed: closing })
          moving = true
        }
        const push = (d2 - d) / 2
        x[i] -= nx * push
        y[i] -= ny * push
        x[j] += nx * push
        y[j] += ny * push
      }
    }
    // over the edge: off the board
    for (let i = 0; i < n; i++) {
      if (out[i] || (Math.abs(x[i]) <= edge && Math.abs(y[i]) <= edge)) continue
      out[i] = true
      vx[i] = 0
      vy[i] = 0
      events.push({ step, kind: 'out', a: i })
    }
    if ((step + 1) % every === 0) snap()
    if (!moving) break
  }
  if (step % every !== every - 1) snap()
  const stones = s.stones.map((st, i) => ({ x: x[i], y: y[i], side: st.side, out: out[i] }))
  return { end: { stones, toMove: (1 - s.toMove) as Side, turn: s.turn + 1 }, frames, events, steps: step + 1, energy }
}

export function outcome(s: AlkkagiState): Outcome {
  const a = onBoard(s, 0)
  const b = onBoard(s, 1)
  if (a === 0 && b === 0) return { kind: 'draw', reason: 'both cleared' }
  if (a === 0) return { kind: 'win', side: 1, reason: 'cleared' }
  if (b === 0) return { kind: 'win', side: 0, reason: 'cleared' }
  if (s.turn >= ALK.maxTurns) return a === b ? { kind: 'draw', reason: 'turns' } : { kind: 'win', side: a > b ? 0 : 1, reason: 'turns' }
  return { kind: 'playing' }
}

export function play(s: AlkkagiState, f: Flick): AlkkagiState | null {
  if (outcome(s).kind !== 'playing' || !validFlick(s, f)) return null
  return simulate(s, f, 1 << 30).end
}

// ── the AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * the levels: how far the aim strays sideways (a fraction of the shot's length, seeded), how much the power wobbles, and how many powers
 * it tries per target
 */
export const ALK_AI: Record<Level, { aim: number; power: number; tries: readonly number[] }> = {
  easy: { aim: 0.22, power: 0.25, tries: [450, 750] },
  normal: { aim: 0.08, power: 0.1, tries: [350, 550, 800] },
  strong: { aim: 0.02, power: 0.03, tries: [300, 450, 600, 800, 1000] },
}

/** how good a position is for `side`: stones on the board, and those well inside the edge */
function value(s: AlkkagiState, side: Side): number {
  const end = outcome(s)
  if (end.kind === 'win') return end.side === side ? 1e6 : -1e6
  let v = 0
  for (const st of s.stones) {
    if (st.out) continue
    const margin = Math.min(3, ALK.edge - Math.max(Math.abs(st.x), Math.abs(st.y)))
    v += (st.side === side ? 1 : -1) * (100 + margin * 6)
  }
  return v
}

/** the straight shots: each own stone at each of the other side's, at the level's powers */
function candidates(s: AlkkagiState, level: Level): Flick[] {
  const out: Flick[] = []
  s.stones.forEach((me, i) => {
    if (me.out || me.side !== s.toMove) return
    for (const them of s.stones) {
      if (them.out || them.side === s.toMove) continue
      const dx = Math.round((them.x - me.x) * 100)
      const dy = Math.round((them.y - me.y) * 100)
      const k = Math.max(Math.abs(dx), Math.abs(dy))
      if (!k) continue
      const sx = Math.round((dx / k) * 1000)
      const sy = Math.round((dy / k) * 1000)
      for (const power of ALK_AI[level].tries) out.push({ stone: i, dx: sx, dy: sy, power })
    }
  })
  return out
}

/** the AI's flick: the best straight shot by its own simulation, then the level's seeded stray in aim and power */
export function aiFlick(s: AlkkagiState, level: Level, seed: number): Flick {
  const cfg = ALK_AI[level]
  const shots = candidates(s, level)
  let best: Flick | null = null
  let top = -Infinity
  for (const f of shots) {
    const v = value(simulate(s, f, 1 << 30).end, s.toMove)
    if (v > top) {
      top = v
      best = f
    }
  }
  if (!best) {
    // no target (cannot happen while the game is on): any own stone, straight ahead, gently
    const i = s.stones.findIndex((st) => !st.out && st.side === s.toMove)
    return { stone: i, dx: 0, dy: s.toMove === 0 ? 1000 : -1000, power: 200 }
  }
  const r = rng(hash(`${seed}|alk|${s.turn}`))
  const stray = (r() * 2 - 1) * cfg.aim
  // sideways: the perpendicular, so the aim turns without any angle
  const dx = Math.round(best.dx - best.dy * stray)
  const dy = Math.round(best.dy + best.dx * stray)
  const k = Math.max(Math.abs(dx), Math.abs(dy), 1) / 1000
  const power = Math.min(1000, Math.max(1, Math.round(best.power * (1 + (r() * 2 - 1) * cfg.power))))
  return { stone: best.stone, dx: Math.round(dx / k) || 0, dy: Math.round(dy / k) || 0, power }
}

// ── words and the frame ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 3:120,-990@640 — stone 3, direction (120, -990), power 640 */
export const flickText = (f: Flick) => `${f.stone}:${f.dx},${f.dy}@${f.power}`
export function parseFlick(s: AlkkagiState, text: string): Flick | null {
  const m = /^(\d+):(-?\d+),(-?\d+)@(\d+)$/.exec(text.trim())
  if (!m) return null
  const f = { stone: Number(m[1]), dx: Number(m[2]), dy: Number(m[3]), power: Number(m[4]) }
  return validFlick(s, f) ? f : null
}

export const alkkagi: BoardGame<AlkkagiState, Flick> = {
  id: 'alkkagi',
  name: '알까기',
  sides: ['흑', '백'],
  continuous: true,
  start: () => startPosition(),
  toMove: (s) => s.toMove,
  // the moves are continuous: the frame gets the AI's straight shots as the ones to choose from (any valid flick plays)
  moves: (s) => (outcome(s).kind === 'playing' ? candidates(s, 'normal') : []),
  play,
  outcome,
  ai: aiFlick,
  moveText: flickText,
  parseMove: (s, t) => (outcome(s).kind === 'playing' ? parseFlick(s, t) : null),
  save: (s) => JSON.stringify(s),
  load: (text) => {
    try {
      const o = JSON.parse(text) as Partial<AlkkagiState>
      if (!Array.isArray(o.stones) || (o.toMove !== 0 && o.toMove !== 1) || !Number.isInteger(o.turn)) return null
      const ok = o.stones.every((st) => typeof st?.x === 'number' && typeof st.y === 'number' && (st.side === 0 || st.side === 1) && typeof st.out === 'boolean')
      return ok ? { stones: o.stones.map((st) => ({ x: st.x, y: st.y, side: st.side, out: st.out })), toMove: o.toMove, turn: o.turn! } : null
    } catch {
      return null
    }
  },
}
