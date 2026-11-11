// A minutes point of the timelapse as a script (timelapse.md 11): every row of the 협의 기록 table, in table order, timed for
// the speed it plays at. Pure functions, no three.js: the replay stage plays the script with the meeting runner (meetingRun.ts).
//
//   3+ agents      they gather at the meeting circle; a talk bubble over the sender of each row, tag `→ 받는 쪽`
//   exactly 2      nobody walks; the sender hands the receiver a paper from desk to desk (paper-pass.md), the caption reads it
//   1 + the owner  nobody walks; bubbles at the seat, the owner's rows typed on the door screen
//
// Timing (11.4), in replay ms (the replay clock runs speed x faster than the wall clock, so a wall-clock figure at x4 is x4 here):
//   x1   bubble typing + dwell (1.6 s + 70 ms a character, 6 s at most); a pass row = the pass + 1.5 s of reading; 0.4 s between rows
//   x4   no typing, dwell / 4 but 0.8 s at least (wall clock); a pass row is the same pass; 0.1 s between rows
//   x16  the caption line only, 0.3 s a row, no passes
// One minutes point lasts at most MINUTES_CAP_MS: the dwell shrinks proportionally (1.2 s a row at least), then only the first 8 and the
// last 4 rows play with one grey bubble `· · · N줄` between.

import { holdMs, typeMs } from './bubbles'
import { doorLine, type MeetingScript, type MinutesMode, type RowBase, type ScriptLine } from './meeting'
import { whoOf } from '../docs/library'

/** a minutes point never holds the next point longer than this (replay ms): 45 s for everything else (HOLD_CAP_MS) */
export const MINUTES_CAP_MS = 60_000
/** a gathering meeting also walks in and out inside the cap: the rows get this much less */
export const GATHER_RESERVE_MS = 10_000
export const KEEP_HEAD = 8
export const KEEP_TAIL = 4
export const GAP_SHOWN_MS = 1000
/** a paper pass and the receiver's reading of it (paper-pass.md 2: 2 - 3 s, 5: 1.5 s) */
export const PASS_MS = 2500
export const READ_MS = 1500
/** the shortest dwell a shrinking row keeps, ms (x1; x4: 0.8 s of wall clock) */
export const MIN_DWELL_MS = 1200
export const MIN_DWELL_X4_MS = 3200
/** x16: a row is this long on the caption line (0.3 s of wall clock) */
export const ROW_X16_MS = 4800
const GAP_MS = { 1: 400, 4: 400, 16: 0 } as const

type Tier = 1 | 4 | 16
export const tierOf = (speed: number): Tier => (speed >= 16 ? 16 : speed > 1 ? 4 : 1)

const chars = (s: string) => [...s].length

/** the agents of the rows (sender and receivers; the owner is not an agent), in order of first appearance */
export function participants(rows: readonly Pick<RowBase, 'from' | 'to'>[]): number[] {
  const out: number[] = []
  for (const r of rows) for (const s of [r.from, ...r.to]) if (typeof s === 'number' && !out.includes(s)) out.push(s)
  return out
}

/** 3+ agents gather; exactly 2 with several rows: the sender walks to the receiver (12.3); one row: a paper passed from the desk; fewer stay where they are (11.1) */
export const modeOf = (rows: readonly Pick<RowBase, 'from' | 'to'>[]): MinutesMode => {
  const n = participants(rows).length
  return n >= 3 ? 'gather' : n === 2 ? (rows.length >= 2 ? 'walk' : 'pair') : 'seat'
}

interface Planned {
  base: RowBase
  type: number
  dwell: number
  min: number
  gap: number
  pass: boolean
}

const plain = (b: RowBase, pass: boolean, tier: Tier, reduced: boolean): Planned => {
  const len = chars(b.from === 'owner' ? doorLine(b) : b.text)
  const gap = GAP_MS[tier]
  if (pass) {
    const type = tier === 1 ? typeMs(len, reduced) : 0
    return { base: b, type, dwell: PASS_MS + READ_MS - type, min: PASS_MS + READ_MS - type, gap, pass }
  }
  if (tier === 16) return { base: b, type: 0, dwell: ROW_X16_MS, min: MIN_DWELL_MS, gap, pass }
  if (tier === 4) return { base: b, type: 0, dwell: Math.max(MIN_DWELL_X4_MS, holdMs(len)), min: MIN_DWELL_X4_MS, gap, pass }
  return { base: b, type: typeMs(len, reduced), dwell: holdMs(len), min: MIN_DWELL_MS, gap, pass }
}

const total = (rows: Planned[], f = 1) => rows.reduce((a, r) => a + r.type + Math.max(r.min, r.dwell * f) + r.gap, 0)

/** the dwell factor that makes the rows fit `budget` (their dwell shrinks proportionally, never under a row's minimum), or null when they cannot */
function shrinkTo(rows: Planned[], budget: number): number | null {
  if (total(rows) <= budget) return 1
  if (total(rows, 0) > budget) return null
  let lo = 0
  let hi = 1
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (total(rows, mid) <= budget) lo = mid
    else hi = mid
  }
  return lo
}

const gapRow = (n: number, seat: number): Planned => ({
  base: { key: 'gap', from: seat, to: [], toOwner: false, text: `· · · ${n}줄`, full: '', masked: false, private: false },
  type: 0,
  dwell: GAP_SHOWN_MS,
  min: GAP_SHOWN_MS,
  gap: 0,
  pass: false,
})

export interface PlanOptions {
  speed?: number
  reduced?: boolean
}

/**
 * Time the rows of a minutes script for a speed. `script.minutes.rows` is the table, untimed; the result has its lines, `linesMs` and `seats`
 * filled in (the rest of the script is kept). With reduced motion nobody gathers or passes: the rows are bubbles at the seats, typed at once.
 */
export function planScript(script: MeetingScript, opts: PlanOptions = {}): MeetingScript {
  const info = script.minutes
  if (!info) return script
  const reduced = opts.reduced ?? script.reduced
  const speed = opts.speed ?? info.speed
  const tier: Tier = reduced ? 1 : tierOf(speed)
  const mode: MinutesMode = reduced ? 'seat' : modeOf(info.rows)
  const seats = participants(info.rows)
  // a one-row 1:1 passes its paper from the desk; a walking 1:1 hands the paper over with its last row only (12.3); x16 has no passes
  const passable = (b: RowBase) => typeof b.from === 'number' && b.to.some((s) => s !== b.from)
  const passRow = tier < 16 ? (mode === 'pair' ? -2 : mode === 'walk' ? info.rows.reduce((k, b, i) => (passable(b) ? i : k), -1) : -1) : -1
  const all = info.rows.map((b, i) => ({ ...plain(b, passable(b) && (passRow === -2 || passRow === i), tier, reduced), n: i + 1 }))
  const budget = MINUTES_CAP_MS - (mode === 'gather' || mode === 'walk' ? GATHER_RESERVE_MS : 0)
  let rows: (Planned & { n?: number })[] = all
  let f = shrinkTo(all, budget)
  if (f === null) {
    // still too long at the shortest: the first 8 and the last 4 rows, one grey bubble between
    const head = all.slice(0, KEEP_HEAD)
    const tail = all.slice(all.length - KEEP_TAIL)
    const speaker = head.map((r) => r.base.from).filter((s): s is number => typeof s === 'number').pop() ?? seats[0] ?? 0
    rows = [...head, gapRow(all.length - KEEP_HEAD - KEEP_TAIL, speaker), ...tail]
    // what is left always fits (12 rows of the longest kind + 1 s is under the budget); the factor only trims a dwell that does not
    f = shrinkTo(rows, budget) ?? 0
  }
  let t = 0
  const lines: ScriptLine[] = rows.map((r) => {
    const dwell = Math.max(r.min, r.dwell * f!)
    const line: ScriptLine = {
      ...r.base,
      startMs: t,
      typeMs: r.type,
      holdMs: dwell + r.gap,
      ...(r.pass ? { pass: true, readAt: PASS_MS } : {}),
      ...(r.base.key === 'gap' ? { gap: Number(/\d+/.exec(r.base.text)?.[0]) } : { row: r.n }),
    }
    t += line.typeMs + line.holdMs
    return line
  })
  return { ...script, lines, linesMs: t, seats, reduced, minutes: { ...info, mode, speed } }
}

/** who is actually in the office: the rows of absent agents drop out, the rest is timed again */
export function trimMinutes(script: MeetingScript, present: number[]): MeetingScript {
  const info = script.minutes
  if (!info) return script
  const rows = info.rows.filter((l) => l.from === 'owner' || present.includes(l.from)).map((l) => ({ ...l, to: l.to.filter((s) => present.includes(s)) }))
  return planScript({ ...script, minutes: { ...info, rows } })
}

/** a paper to hand over now: the row being played, when it is a pass and has a receiver */
export function passOf(script: MeetingScript, index: number): { key: string; from: number; to: number } | null {
  const l = script.lines[index]
  if (!l?.pass || typeof l.from !== 'number' || l.to[0] === undefined) return null
  return { key: `${script.id}:${l.key}`, from: l.from, to: l.to.find((s) => s !== l.from) ?? l.to[0] }
}

const name = (seat: number) => whoOf({ seat: seat as 0 | 1 | 2 | 3 | 4 }).ko

/** the caption line of a row: `메시 → 휴` and `— the words`; seat = whose colour. Null for the elision marker */
export function captionOf(line: ScriptLine): { seat: number; who: string; text: string } | null {
  if (line.gap !== undefined) return null
  const to = line.toOwner ? '주인' : line.to[0] !== undefined ? name(line.to[0]) : null
  const from = line.from === 'owner' ? '주인' : name(line.from)
  const seat = typeof line.from === 'number' ? line.from : (line.to[0] ?? 0)
  const text = line.private ? '(비공개)' : line.text
  return { seat, who: to ? `${from} → ${to}` : from, text: to ? `— ${text}` : text }
}
