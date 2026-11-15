// What the hands, the head and the body do in each piece of the wrap-up (docs/design/wrapup.md 2, 3, 9, #229, #532), as plain numbers in the agent's
// own frame (x right, y up, z forward = negative; metres, radians) so they are tested without a rig. rig.ts turns them into hand poses; writeDesk.ts
// draws the held cards and the pen and drives both hands onto them.

import type { BeatKind, PieceKind } from './wrap'
import { WRAP, cellOf } from './wrap'

export interface WrapBeat {
  kind: BeatKind
  u: number
  k: number
  piece?: PieceKind
  v?: number
  /** point: the last of its run */
  end?: boolean
  /** #532 the cards written at the desk this sitting: the bundle held while writing is this many */
  n?: number
  /** #532 waiting at the desk for the board, s since the writing was done (the held cards are lowered after HELD.waitS) */
  wait?: number
}

export type Curl = 'pen' | 'support' | 'pinch' | 'point' | 'fist' | 'rest' | 'loose' | 'stamp'
export interface HandSpec {
  pos: [number, number, number]
  /** palm: down (on the desk), up (holding paper), none (the rig's rest orientation), reach (turned to what it touches) */
  palm: 'down' | 'up' | 'none' | 'reach'
  curl: Curl
  /** a small extra: the hand's roll about the forearm (rad) */
  roll?: number
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const mix = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
/** a 0 -> 1 -> 0 bump over u: up in the first `a`, held, down in the last `a` */
const bump = (u: number, a: number) => Math.min(smooth(u / a), smooth((1 - u) / a))
const DEG = Math.PI / 180

/** where card k hangs on the board, relative to the body standing at the board (x sideways, y height above the seat offset, z forward) */
export const CARD_AT = (k: number, sit: number): [number, number, number] => {
  const { col, row } = cellOf(k)
  return [0.1 + (col - 1) * 0.18, 1.34 + sit - row * 0.14, -0.6]
}
/** the cell card k goes to when it is moved: the other row of its column */
export const MOVE_TO = (k: number) => (k < 3 ? k + 3 : k - 3)

/** a card holds five lines (0-4, #501) */
export const LINES_MAX = 4

/** #481 · #532 (wrapup.md 9.1): the 10 x 13 cm card the bundle and the board carry (#499: the size of the hands), upright on its long side */
export const WRITE_CARD = {
  w: 0.1,
  d: 0.13,
  t: 0.0004,
  paper: '#f3ead8',
  /** the line's left end this far in from the card's left edge, the first line this far down from its top edge; 5 cm lines 8 mm apart */
  inLeft: 0.012,
  inFar: 0.015,
  lineLen: 0.05,
  lineGap: 0.008,
} as const

/**
 * #532 (wrapup.md 9.1 · 9.4): the bundle held in the hand that does not hold the pen (the left), in front of the chest above the desk. The front card's centre
 * is `fwd` ahead of the head's centre, `down` below it and `side` toward the holding hand; its face stands `tiltDeg` up from level, toward the face. The palm is
 * `palmGap` behind the last card; a card is drawn `step` thick (thicker than paper, so the bundle shows); each written card behind is turned ±`turnDeg`.
 * Reading: up to `readFwd` in front of the face (`readDown` below its centre), the face `readTiltDeg` up. Waiting at the desk for the board (6) over
 * `waitS`: the hand `waitDown` lower and the face `waitTiltDeg` up.
 */
export const HELD = {
  fwd: 0.3,
  down: 0.22,
  side: 0.05,
  tiltDeg: 40,
  palmGap: 0.003,
  step: 0.0012,
  turnDeg: 3,
  readFwd: 0.22,
  readDown: 0.06,
  readTiltDeg: 72,
  waitS: 20,
  waitDown: 0.05,
  waitTiltDeg: 20,
  /** the palm under the bundle: its centre this far toward the holding hand's side and down the card from the front card's centre (m); the fingers turned this far in from straight up the card */
  palmOut: 0.02,
  palmDown: 0.02,
  fingersInDeg: 45,
} as const

/** #481 · #532 (wrapup.md 9.2 · 9.3): the pen and its ink */
export const PEN = {
  /** #532 (designer): 18 cm, 5 mm round, for the 18 cm robot hand (a hand : a ballpoint as 18 : 14), 11.5 cm of it out behind the grip */
  len: 0.18,
  r: 0.005,
  tipLen: 0.012,
  capLen: 0.01,
  dark: '#2b2f3a',
  /**
   * #532: the hand takes the pen 6.5 cm from the tip (z -0.025 from the centre, the tip at -0.09), not grips.md's 3 cm: the robot hand (18 x 14 x 7 cm)
   * held 3 cm from the tip at 50° to the card had its fingers 21 mm through the card at every roll; 6.5 cm keeps them 2.5 mm off it (writeDesk.test.ts)
   */
  gripZ: -0.025,
  tipZ: -0.09,
  /** the roll about the pen's axis that keeps the pen hand's fingers off the card and 2 cm from the holding hand (measured over every 15°, then 5°) */
  rollDeg: 220,
  /** 50° to the card's face; its back end toward the body (down the card) and out toward the pen hand, 60° out */
  elevDeg: 50,
  outDeg: 60,
  /** ink: where the tip passes within this of the front card, 1.5 mm wide */
  touchM: 0.002,
  inkM: 0.0015,
  ink: '#3b3f4a',
  fadeInS: 0.2,
  fadeOutS: 0.2,
} as const

/** #532 'next' (wrapup.md 9.4, 0.6 s): 0–0.15 s the pen hand's forefinger to the front card's top corner, 0.15–0.45 s the card over the top to the back, 0.45–0.6 s back */
export const NEXT_FLIP = { from: 0.15, to: 0.45 } as const
/** how far the front card has gone over to the back in 'next' (0 in front, 1 at the back); reduced motion: no turning over */
export function flipOf(b: WrapBeat | undefined, reduced = false): number {
  if (b?.kind !== 'next' || reduced) return 0
  const s = b.u * WRAP.next
  return Math.min(1, Math.max(0, (s - NEXT_FLIP.from) / (NEXT_FLIP.to - NEXT_FLIP.from)))
}

/** the written cards behind the front one at a beat: card k is on the front; in 'next' it is at the back once it has gone over (reduced motion: at once) */
export function doneBehind(b: WrapBeat | undefined, reduced = false): number {
  if (!b) return 0
  if (b.kind === 'next') return b.k + (reduced || flipOf(b) >= 1 ? 1 : 0)
  return b.k
}

/**
 * The front card's centre (relative to the head's centre, in the agent's frame) and its face's tilt up from level (rad), in a beat: held in front of the chest,
 * up in front of the face while it is read (not in reduced motion: the head bows instead), a little lower and flatter while it waits long at the desk.
 */
export function heldCard(b: WrapBeat | undefined, o: { reduced: boolean; waitS?: number }): { c: [number, number, number]; tilt: number } {
  let c: [number, number, number] = [-HELD.side, -HELD.down, -HELD.fwd]
  let tilt = HELD.tiltDeg * DEG
  const wait = smooth(((o.waitS ?? b?.wait ?? 0) - HELD.waitS) / 1.5)
  if (wait > 0) {
    c = [c[0], c[1] - HELD.waitDown * wait, c[2]]
    tilt = lerp(tilt, HELD.waitTiltDeg * DEG, wait)
  }
  if (b?.kind === 'readUp' && !o.reduced) {
    const k = bump(b.u, 0.25)
    c = mix(c, [0, -HELD.readDown, -HELD.readFwd], k)
    tilt = lerp(tilt, HELD.readTiltDeg * DEG, k)
  }
  return { c, tilt }
}

/** where line `row` is on the card `along` from its left end, in the card's frame (x across from its centre, z down the card from its centre) */
const lineAt = (row: number, along: number): [number, number] => [-WRITE_CARD.w / 2 + WRITE_CARD.inLeft + along, -WRITE_CARD.d / 2 + WRITE_CARD.inFar + WRITE_CARD.lineGap * Math.min(row, LINES_MAX)]

/**
 * Where the pen's tip is in a beat (wrapup.md 9.2 · 9.3), in the front card's frame: x across from its centre, the height above its face, z down the card from
 * its centre. On the card while it writes a line or strikes one out (the ink is its trace), a centimetre off on the new line, 1.6 cm off between the taps,
 * off the card while it is read, to the top corner and up while the card goes over in 'next'.
 */
export function nibAt(b: WrapBeat | undefined, t: number, o: { reduced: boolean; m: number }): [number, number, number] {
  const u = b?.u ?? 0
  const row = b?.v ?? 0
  const L = WRITE_CARD.lineLen
  const at = (along: number, lift: number, r: number, dz = 0): [number, number, number] => {
    const [x, z] = lineAt(r, along)
    return [x, lift, z + dz]
  }
  // handwriting: a small loop as it goes along (letters)
  const hand = (along: number, r: number): [number, number, number] => {
    const p = at(along + 0.0012 * Math.sin(t * 31) * o.m, 0, r)
    return [p[0], p[1], p[2] + 0.0016 * Math.sin(t * 23 + 1) * o.m]
  }
  const kind = o.reduced && b?.kind !== 'next' && b?.kind !== 'collect' && b?.kind !== 'readUp' ? 'line' : b?.kind
  switch (kind) {
    case 'line':
      return hand(L * (o.reduced ? 0.5 : u), row)
    case 'newline':
      return at(lerp(L, 0, smooth(u)), 0.01 * Math.sin(u * Math.PI), row, WRITE_CARD.lineGap * smooth(u))
    case 'tapPen':
      return at(L, 0.016 * (0.5 - 0.5 * Math.cos(u * 4 * Math.PI)), row)
    case 'strike': {
      const cut = 0.3 / WRAP.strike
      if (u < cut) return at(L / 2 + (L / 2) * Math.sin((u / cut) * Math.PI * 3), 0, row)
      return hand(0.02 + 0.03 * ((u - cut) / (1 - cut)), row)
    }
    case 'readUp':
      // off the card while it is held up to be read (writeDesk.ts rests the pen hand in front of the chest)
      return at(L, 0.03, row)
    case 'next': {
      // to the top corner on the pen side (the forefinger beside it), up 3 cm with the card going over, back down at the new card's first line
      if (o.reduced) return at(0, 0, 0)
      const s = u * WRAP.next
      const corner: [number, number, number] = [WRITE_CARD.w / 2 - 0.01, 0.012, -WRITE_CARD.d / 2 + 0.008]
      const end = at(L, 0, row)
      if (s < NEXT_FLIP.from) return mix(end, corner, smooth(s / NEXT_FLIP.from))
      if (s < NEXT_FLIP.to) {
        const k = (s - NEXT_FLIP.from) / (NEXT_FLIP.to - NEXT_FLIP.from)
        return [corner[0], corner[1] + 0.03 * Math.sin(k * Math.PI), corner[2]]
      }
      return mix(corner, at(0, 0, 0), smooth((s - NEXT_FLIP.to) / (WRAP.next - NEXT_FLIP.to)))
    }
    case 'collect':
      return at(L, 0.01, row)
    default:
      return at(0, 0, row)
  }
}

type Route = { u: number; pos: readonly number[]; curl: Curl }[]
/** a hand along waypoints (u ascending): positions are blended between neighbours, the curl is the earlier one's */
function along(route: Route, u: number): { pos: [number, number, number]; curl: Curl } {
  if (u <= route[0].u) return { pos: [...route[0].pos] as [number, number, number], curl: route[0].curl }
  for (let i = 1; i < route.length; i++) {
    if (u <= route[i].u) {
      const a = route[i - 1]
      const b = route[i]
      return { pos: mix(a.pos, b.pos, smooth((u - a.u) / (b.u - a.u))), curl: u - a.u < (b.u - a.u) * 0.5 ? a.curl : b.curl }
    }
  }
  const last = route[route.length - 1]
  return { pos: [...last.pos] as [number, number, number], curl: last.curl }
}

/**
 * One hand in a beat. `rest` is the hand's resting place (the rig's), `head` the head's centre at rest (the held bundle is placed from it), `sit` the seat
 * height offset, `m` the ambient motion. While writing the stage (writeDesk.ts) drives both hands onto the bundle and the pen exactly: these are the places
 * under that drive (near them, so its weight fades in and out with no jump), and the carrying hold the bundle goes to when the writing is done.
 */
export function wrapHand(side: 'l' | 'r', pose: 'write' | 'cardpost', b: WrapBeat | undefined, t: number, o: { rest: [number, number, number]; head?: [number, number, number]; sit: number; m: number; reduced: boolean; waitS?: number }): HandSpec {
  const u = b?.u ?? 0
  const { rest, sit } = o
  if (pose === 'write') {
    const head = o.head ?? [0, 1.25 + sit, 0]
    const held = heldCard(b, o)
    const centre: [number, number, number] = [head[0] + held.c[0], head[1] + held.c[1], head[2] + held.c[2]]
    if (side === 'l') {
      // the holding hand a little behind the bundle; once the writing is done it takes the bundle to the carrying hold (palm up at chest height, wrapup.md 9.4)
      const behind: [number, number, number] = [centre[0] - HELD.palmOut, centre[1] - 0.03 * Math.cos(held.tilt), centre[2] - 0.03 * Math.sin(held.tilt)]
      if (b?.kind === 'collect') return { pos: mix(behind, [-0.13, 1.0 + sit, -0.3], smooth(u)), palm: 'up', curl: 'support' }
      return { pos: behind, palm: 'up', curl: 'support' }
    }
    // the pen hand above the tip, the grip up the pen (out and toward the body)
    const nib = nibAt(b, t, o)
    const pos: [number, number, number] = [centre[0] + nib[0] + 0.03, centre[1] + 0.05, centre[2] + 0.03]
    if (b?.kind === 'collect') return u * WRAP.collect < PEN.fadeOutS && !o.reduced ? { pos, palm: 'down', curl: 'pen' } : { pos: rest, palm: 'none', curl: 'rest' }
    return { pos, palm: 'down', curl: 'pen' }
  }
  // at the board
  const r = side === 'r'
  const k = b?.k ?? 0
  const card = CARD_AT(k, sit)
  const restSpec = (): HandSpec => ({ pos: rest, palm: 'none', curl: 'rest' })
  const stack: [number, number, number] = [-0.06, 1.04 + sit, -0.3]
  const lSupport: [number, number, number] = [-0.13, 1.0 + sit, -0.3]
  switch (b?.kind) {
    case 'pick':
      // the first from the resting hand, the later ones from the stack the hand waited at in the gap
      return r ? { pos: mix(k > 0 ? stack : rest, stack, u), palm: 'none', curl: 'pinch' } : restSpec()
    case 'place': {
      const to = CARD_AT(k, sit)
      return r ? { pos: mix(stack, to, u), palm: 'none', curl: 'pinch' } : restSpec()
    }
    case 'press':
      return r ? { pos: [card[0], card[1], card[2] - 0.02 * Math.sin(u * Math.PI)], palm: 'none', curl: 'stamp' } : restSpec()
    case 'release':
      return r ? { pos: mix(card, rest, u), palm: 'none', curl: 'rest' } : restSpec()
    case 'gap':
      return r ? { pos: mix(rest, stack, u), palm: 'none', curl: 'rest' } : restSpec()
    case 'back':
    case 'think':
    case 'forth': {
      // the habit: 0 chin (right fist under the chin, the left hand under that elbow), 1 arms crossed in front, 2 head tilted, the hands at rest
      const h = b.v ?? 0
      const into = b.kind === 'back' ? smooth(u) : b.kind === 'forth' ? 1 - smooth(u) : 1
      if (h === 0)
        return r ? { pos: mix(rest, [0.06, 1.2 + sit, -0.14], into), palm: 'none', curl: 'fist' } : { pos: mix(rest, [0.0, 1.0 + sit, -0.18], into), palm: 'up', curl: 'loose' }
      if (h === 1) return { pos: mix(rest, [r ? -0.1 : 0.1, 1.02 + sit, -0.2], into), palm: 'none', curl: 'loose' }
      return restSpec()
    }
    case 'move': {
      // takes the card (0.3 s of 1.4), carries it to the other row, presses it there, lets go
      const to = CARD_AT(MOVE_TO(k), sit)
      if (!r) return restSpec()
      const route: Route = [
        { u: 0, pos: rest, curl: 'pinch' },
        { u: 0.14, pos: card, curl: 'pinch' },
        { u: 0.22, pos: [card[0], card[1], card[2] - 0.02], curl: 'pinch' },
        { u: 0.7, pos: [to[0], to[1], to[2] + 0.02], curl: 'pinch' },
        { u: 0.85, pos: [to[0], to[1], to[2] - 0.02], curl: 'stamp' },
        { u: 1, pos: rest, curl: 'rest' },
      ]
      return { ...along(route, u), palm: 'none' }
    }
    case 'swap': {
      // takes A to the left hand, puts B in A's place, then A in B's: the left hand holds what is taken off
      const a = card
      const bb = CARD_AT(b.v ?? k, sit)
      const hold = lSupport
      if (!r) {
        const k1 = u < 0.15 ? smooth(u / 0.15) : u < 0.85 ? 1 : 1 - smooth((u - 0.85) / 0.15)
        return { pos: mix(rest, hold, k1), palm: 'up', curl: 'support' }
      }
      const route: Route = [
        { u: 0, pos: rest, curl: 'pinch' },
        { u: 0.12, pos: a, curl: 'pinch' },
        { u: 0.24, pos: hold, curl: 'pinch' },
        { u: 0.38, pos: bb, curl: 'pinch' },
        { u: 0.55, pos: a, curl: 'pinch' },
        { u: 0.62, pos: [a[0], a[1], a[2] - 0.02], curl: 'stamp' },
        { u: 0.74, pos: hold, curl: 'pinch' },
        { u: 0.9, pos: bb, curl: 'pinch' },
        { u: 0.95, pos: [bb[0], bb[1], bb[2] - 0.02], curl: 'stamp' },
        { u: 1, pos: rest, curl: 'rest' },
      ]
      return { ...along(route, u), palm: 'none' }
    }
    case 'straighten': {
      // the forefinger pushes a crooked card's corner square
      if (!r) return restSpec()
      const corner: [number, number, number] = [card[0] + 0.06, card[1] - 0.05, card[2] - 0.01]
      const route: Route = [
        { u: 0, pos: rest, curl: 'point' },
        { u: 0.3, pos: [corner[0] + 0.02, corner[1] + 0.03, corner[2]], curl: 'point' },
        { u: 0.65, pos: [corner[0] - 0.03, corner[1] - 0.01, corner[2]], curl: 'point' },
        { u: 1, pos: rest, curl: 'rest' },
      ]
      return { ...along(route, u), palm: 'reach' }
    }
    case 'point': {
      // the forefinger on each card in turn, top to bottom
      if (!r) return restSpec()
      // from where the hand was (rest for the first, the card before for the others) onto this card in the first half, then back to rest after the last
      const from = (b.v ?? 0) === 0 ? rest : CARD_AT(Math.max(0, k - 1), sit)
      const on: [number, number, number] = [card[0], card[1] + 0.02 * Math.sin(u * Math.PI), card[2] - 0.02 * Math.sin(u * Math.PI)]
      const pos = mix(from, on, smooth(u / 0.5))
      return { pos: b.end ? mix(pos, rest, smooth((u - 0.6) / 0.4)) : pos, palm: 'reach', curl: 'point' }
    }
    case 'final':
    default:
      return restSpec()
  }
}

/** the head in a beat, on top of what the rig gives the pose: pitch (+ down), yaw, roll */
export function wrapHead(pose: 'write' | 'cardpost', b: WrapBeat | undefined, t: number, reduced: boolean): { pitch: number; yaw: number; roll: number } {
  const u = b?.u ?? 0
  if (pose === 'write') {
    // bowed 18° toward the held card (wrapup.md 9.1, #532), a 2° nod every 0.6 s
    const bow = -18 * DEG
    const nod = Math.max(0, Math.sin((t / 0.6) * Math.PI * 2)) * 0.035
    const base = { pitch: bow + nod, yaw: 0, roll: 0 }
    if (reduced) return { ...base, pitch: b?.kind === 'readUp' ? bow - bump(u, 0.25) * 4 * DEG : bow }
    switch (b?.kind) {
      case 'line':
        // 2° along with the pen
        return { ...base, yaw: (u - 0.5) * 2 * DEG }
      case 'tapPen':
        // 3° tilt of the head
        return { pitch: bow + 0.02, yaw: 0, roll: Math.sin(u * Math.PI) * 3 * DEG }
      case 'readUp': {
        const k = bump(u, 0.25)
        // up to the card held before the face, 2° down twice
        return { pitch: lerp(bow, -0.02, k) + Math.sin(u * 4 * Math.PI) * 2 * DEG * k, yaw: 0, roll: 0 }
      }
      case 'strike':
        return { pitch: bow + 0.04, yaw: 0, roll: 0 }
      default:
        return base
    }
  }
  switch (b?.kind) {
    case 'back':
    case 'think':
    case 'forth': {
      const h = b.v ?? 0
      const into = b.kind === 'back' ? smooth(u) : b.kind === 'forth' ? 1 - smooth(u) : 1
      // looks at the board from where it stands: a little up, the head following the habit
      if (h === 2) return { pitch: 0.02, yaw: 0, roll: 8 * DEG * into }
      return { pitch: lerp(0.06, h === 0 ? 0.1 : 0.04, into), yaw: b.kind === 'think' && !reduced ? Math.sin(t * 0.8) * 0.04 : 0, roll: 0 }
    }
    case 'final':
      // a step back for a last look, a 2° nod
      return { pitch: 0.04 + Math.sin(u * Math.PI) * 2 * DEG, yaw: 0, roll: 0 }
    case 'point':
      return { pitch: 0.12 + Math.sin(u * Math.PI) * 2 * DEG, yaw: 0, roll: 0 }
    case 'move':
    case 'swap':
    case 'straighten':
      return { pitch: 0.1, yaw: 0, roll: 0 }
    case 'release':
      return { pitch: 0.06, yaw: 0, roll: 0 }
    default:
      return { pitch: 0.06, yaw: 0, roll: 0 }
  }
}

/** how far the body stands back from the board in a beat, 0..1 (the rig draws it WRAP.backM and slews to it) */
export const wrapBack = (b: WrapBeat | undefined): number => (b && (b.kind === 'back' || b.kind === 'think' || b.kind === 'final' ? 1 : 0)) || 0
