// What the hands, the head and the body do in each piece of the wrap-up (docs/design/wrapup.md 2, 3, #229), as plain numbers in the agent's
// own frame (x right, y up, z forward = negative; metres, radians) so they are tested without a rig. rig.ts turns them into hand poses.

import type { BeatKind, PieceKind } from './wrap'
import { WRAP, cellOf } from './wrap'
import { DEFAULT_CAMERA } from './room'
import { angleFromFront, rightOf } from './tour'

/**
 * Where the writing happens (#229 designer): on a desk that faces the default camera (office-ui.md 10.3: the seat's facing direction and the direction to the
 * camera have a positive dot product) the card and the pen in front of the body hide behind the monitor, so the card lies on the empty desk top beside the monitor
 * on the side the default camera is on (the designer said the aisle side; that is the far side on two of the three facing desks, hidden by the monitor): seat-local x +-0.32, z -0.36. `side` is +1 for the body's right, -1 for its left; the hand on that
 * side holds the pen, the other presses the card, and the body turns 24 degrees toward it (#461). null: the card stays in front (the desks with their back to the camera).
 */
// #461 (the designer, plan A): the whole body turns 24° toward the card and moves 4 cm toward it in 0.4 s (power2.inOut), stays turned while the card is
// written on and touched, and turns back when the writing is over; reduced motion turns at once (the body's direction carries meaning)
export const WRITE_ASIDE = { x: 0.32, z: -0.36, turnDeg: 24, shiftM: 0.04, turnS: 0.4 } as const
export type WritePlace = { side: 1 | -1 } | null
export function writePlace(spots: Record<string, { x: number; z: number; ry: number }>, spot: string, camera: readonly number[] = DEFAULT_CAMERA): WritePlace {
  const seat = spots[spot]
  if (!seat) return null
  if (angleFromFront(seat, [camera[0], camera[1], camera[2]]) >= 90) return null
  // the side the camera is on: from there the end of the monitor is seen past, so the pen is not behind it. (The aisle side, the side of the seat's
  // desk_side spot, is the far side on two of the three facing desks: there the monitor hides the pen from the default camera.)
  const [rx, rz] = rightOf(seat.ry)
  const d = (camera[0] - seat.x) * rx + (camera[2] - seat.z) * rz
  return { side: d >= 0 ? 1 : -1 }
}

export interface WrapBeat {
  kind: BeatKind
  u: number
  k: number
  piece?: PieceKind
  v?: number
  /** point: the last of its run */
  end?: boolean
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

/** where card k hangs on the board, relative to the body standing at the board (x sideways, y height above the seat offset, z forward) */
export const CARD_AT = (k: number, sit: number): [number, number, number] => {
  const { col, row } = cellOf(k)
  return [0.1 + (col - 1) * 0.18, 1.34 + sit - row * 0.14, -0.6]
}
/** the cell card k goes to when it is moved: the other row of its column */
export const MOVE_TO = (k: number) => (k < 3 ? k + 3 : k - 3)

/** the writing hand's place on the card: line `row`, `x` across (m from the left end) */
const NIB_X0 = 0.115
const NIB_Y = 0.83
const lineZ = (row: number) => -0.43 + 0.008 * Math.min(row, 6)
const LEFT_ON_CARD: [number, number, number] = [-0.13, 0.82, -0.42]

/** #481 (wrapup.md 9.1): the card on the desk, the same 10 x 13 cm card the stack and the board carry (#499: the size of the hands); laid square to the seat */
export const WRITE_CARD = {
  w: 0.1,
  d: 0.13,
  t: 0.0004,
  paper: '#f3ead8',
  /** the line's left end this far in from the card's left edge, the first line this far in from its far edge */
  inLeft: 0.012,
  inFar: 0.015,
  /** the pressing hand holds the card's near corner with its fingertips (#497, #499): the palm's centre this far outside the short edge nearest the body and this far
   * from the card's centre toward the pressing side; the palm is off the card, about 2 cm of the fingers (they reach 9.5 cm from the knuckles) lie on it */
  pressOut: 0.075,
  pressSide: 0.055,
  /** above the desk top under the card's centre */
  lift: 0.0005,
} as const

/** #481 (wrapup.md 9.2 · 9.3): the pen and its ink */
export const PEN = {
  len: 0.13,
  r: 0.0045,
  tipLen: 0.012,
  capLen: 0.01,
  dark: '#2b2f3a',
  /** grips.md: grip.pos 3 cm from the tip (prop_tablet_pen_grip_r: z -0.04 from the centre, the tip at -0.07) */
  gripZ: -0.04,
  tipZ: -0.07,
  /** 45° to the desk; its back end toward the body and out toward the pen hand, 70° out (#499: the pen hand's palm away from the pressing hand) */
  elevDeg: 45,
  outDeg: 70,
  /** ink: where the tip passes within this height of the card, 1.5 mm wide */
  touchM: 0.002,
  inkM: 0.0015,
  ink: '#3b3f4a',
  fadeInS: 0.2,
} as const

/** the card's centre in front of the body (the desks with their back to the camera) */
const FRONT_CARD = { x: 0, z: -0.41 } as const

/** the card's centre on the desk in the seat's frame, the pen side (+1 right), and where the pressing palm goes (wrapup.md 9.1, #495: the card is the writing place itself) */
export function writeCard(place: WritePlace | undefined): { x: number; z: number; s: 1 | -1; pressX: number; pressZ: number } {
  const s = place?.side ?? 1
  const x = place ? WRITE_ASIDE.x * s : FRONT_CARD.x
  const z = place ? WRITE_ASIDE.z : FRONT_CARD.z
  // the body is toward +z: the near short edge is at z + d/2
  return { x, z, s, pressX: x - s * WRITE_CARD.pressSide, pressZ: z + WRITE_CARD.d / 2 + WRITE_CARD.pressOut }
}

/** the line's left end (seat frame x) on the card: 1.2 cm in from its left edge; `dz` moves the rows (lineZ) so the first is 1.5 cm in from its far edge */
const lineStart = (place: WritePlace | undefined) => {
  const c = writeCard(place)
  const z = c.z - WRITE_CARD.d / 2 + WRITE_CARD.inFar
  return { s: c.s, x: c.x - WRITE_CARD.w / 2 + WRITE_CARD.inLeft, z, dz: z - lineZ(0) }
}

/**
 * Where the pen's tip is in a beat (wrapup.md 2 · 9.2 · 9.3), in the seat's frame: x, the height ABOVE THE CARD's top, z. On the card while it writes a line or
 * strikes one out (the ink is its trace), a centimetre up on the new line, 1.6 cm up between the taps, standing on the card while the card is read.
 */
export function nibAt(b: WrapBeat | undefined, t: number, o: { place?: WritePlace; reduced: boolean; m: number }): [number, number, number] {
  const L = lineStart(o.place)
  const u = b?.u ?? 0
  const row = b?.v ?? 0
  const at = (x: number, lift: number, z: number): [number, number, number] => [L.x + (x - NIB_X0), lift, z + L.dz]
  // handwriting: a small loop as it goes along (letters)
  const hand = (x: number, z: number) => at(x + 0.0012 * Math.sin(t * 31) * o.m, 0, z + 0.0016 * Math.sin(t * 23 + 1) * o.m)
  const kind = o.reduced ? 'line' : b?.kind
  switch (kind) {
    case 'line':
      return hand(NIB_X0 + 0.05 * (o.reduced ? 0.5 : u), lineZ(row))
    case 'newline':
      return at(lerp(NIB_X0 + 0.05, NIB_X0, smooth(u)), 0.01 * Math.sin(u * Math.PI), lineZ(row) + 0.008 * smooth(u))
    case 'tapPen':
      return at(NIB_X0 + 0.05, 0.016 * (0.5 - 0.5 * Math.cos(u * 4 * Math.PI)), lineZ(row))
    case 'strike': {
      const cut = 0.3 / WRAP.strike
      if (u < cut) return at(NIB_X0 + 0.025 + 0.025 * Math.sin((u / cut) * Math.PI * 3), 0, lineZ(row))
      return hand(NIB_X0 + 0.02 + 0.03 * ((u - cut) / (1 - cut)), lineZ(row))
    }
    case 'readUp':
      return at(NIB_X0 + 0.05, 0, lineZ(row))
    case 'next':
      // off the card while it goes to the stack, down at the new card's first line
      return at(lerp(NIB_X0 + 0.05, NIB_X0, smooth(u)), 0.012 * Math.sin(u * Math.PI), lineZ(0))
    default:
      return at(NIB_X0, 0, lineZ(row))
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
 * One hand in a beat. `rest` is the hand's resting place (the rig's), `read` where a held card is read (0.25 m in front of the face),
 * `sit` the seat height offset, `m` the ambient motion (0.3 in reduced motion, which keeps the writing posture and nothing else).
 */
export function wrapHand(side: 'l' | 'r', pose: 'write' | 'cardpost', b: WrapBeat | undefined, t: number, o: { rest: [number, number, number]; read: [number, number, number]; sit: number; m: number; reduced: boolean; place?: WritePlace }): HandSpec {
  const u = b?.u ?? 0
  const row = b?.v ?? 0
  const { rest, sit, m } = o
  if (pose === 'write') {
    // the card's place: in front (default) or beside the monitor on the aisle side; the pen hand is the one on that side, the other presses the card
    const s = o.place?.side ?? 1
    const L = lineStart(o.place)
    const r = o.place ? side === (s > 0 ? 'r' : 'l') : side === 'r'
    // the other hand holds the card's near corner on its side with its fingertips, the palm off the card (#481, #497, #499)
    const card = writeCard(o.place)
    const left: HandSpec = { pos: [card.pressX, LEFT_ON_CARD[1], card.pressZ], palm: 'down', curl: 'support' }
    // the pen hand over the pen's tip on the card (the stage puts the hand exactly on the pen it draws, #481)
    const penAt = (x: number, y: number, z: number): HandSpec => ({ pos: [L.x + (x - NIB_X0), y, z + L.dz], palm: 'down', curl: 'pen' })
    const kind = o.reduced ? 'line' : b?.kind
    // the pen in small steady strokes: the wrist moves within 1 cm, a small up and down every 0.12 s
    const stroke = (x: number, z: number) => penAt(x + 0.012 * Math.sin(t * 9) * m * 0.3, NIB_Y + 0.004 * Math.sin((t * Math.PI * 2) / 0.12) * m, z + 0.01 * Math.sin(t * 6.5 + 1) * m)
    switch (kind) {
      case 'line':
        // 4–6 cm from the left to the right along the line
        return r ? stroke(NIB_X0 + 0.05 * (o.reduced ? 0.5 : u), lineZ(row)) : left
      case 'newline':
        // lifts a centimetre and goes back to the left end, a line (8 mm) down
        return r ? penAt(lerp(NIB_X0 + 0.05, NIB_X0, smooth(u)), NIB_Y + 0.01 * Math.sin(u * Math.PI), lineZ(row) + 0.008 * smooth(u)) : left
      case 'tapPen':
        // taps the card twice (0.15 s each in 0.8 s: the pen lifts and comes down, twice)
        return r ? penAt(NIB_X0 + 0.05, NIB_Y + 0.016 * (0.5 - 0.5 * Math.cos(u * 4 * Math.PI)), lineZ(row)) : left
      case 'strike': {
        // crosses part of the last line quickly (0.3 s of 1.4), then writes over it (1.1 s)
        const cut = 0.3 / WRAP.strike
        if (!r) return left
        if (u < cut) return penAt(NIB_X0 + 0.025 + 0.025 * Math.sin((u / cut) * Math.PI * 3), NIB_Y + 0.004, lineZ(row))
        return stroke(NIB_X0 + 0.02 + 0.03 * ((u - cut) / (1 - cut)), lineZ(row))
      }
      case 'readUp': {
        // the left hand lifts the card to 0.25 m in front of the face and lowers it; the pen hand rests on the desk
        if (r) return penAt(NIB_X0 + 0.05, NIB_Y, lineZ(row))
        const k = bump(u, 0.25)
        return { pos: mix(left.pos, o.read, k), palm: k > 0.5 ? 'up' : 'down', curl: 'support' }
      }
      case 'next': {
        // pushes the done card to the left (0.3 s) and draws a new one (0.3 s)
        const out = Math.sin(Math.min(1, u * 2) * Math.PI) * 0.1
        return r ? penAt(NIB_X0, NIB_Y, lineZ(0)) : { pos: [left.pos[0] - s * out, left.pos[1], left.pos[2]], palm: 'down', curl: 'support' }
      }
      default:
        return r ? stroke(NIB_X0, lineZ(row)) : left
    }
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
  const DEG = Math.PI / 180
  if (pose === 'write') {
    const nod = Math.max(0, Math.sin((t / 0.6) * Math.PI * 2)) * 0.035
    const base = { pitch: -0.14 + nod, yaw: 0, roll: 0 }
    if (reduced) return { ...base, pitch: -0.14 }
    switch (b?.kind) {
      case 'line':
        // 2° along with the pen
        return { ...base, yaw: (u - 0.5) * 2 * DEG }
      case 'tapPen':
        // 3° tilt of the head
        return { pitch: -0.12, yaw: 0, roll: Math.sin(u * Math.PI) * 3 * DEG }
      case 'readUp': {
        const k = bump(u, 0.25)
        // up to read, 2° down twice
        return { pitch: lerp(-0.14, -0.02, k) + Math.sin(u * 4 * Math.PI) * 2 * DEG * k, yaw: 0, roll: 0 }
      }
      case 'strike':
        return { pitch: -0.1, yaw: 0, roll: 0 }
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
