// What the hands, the head and the body do in each piece of the wrap-up (docs/design/wrapup.md 2, 3, #229), as plain numbers in the agent's
// own frame (x right, y up, z forward = negative; metres, radians) so they are tested without a rig. rig.ts turns them into hand poses.

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
export function wrapHand(side: 'l' | 'r', pose: 'write' | 'cardpost', b: WrapBeat | undefined, t: number, o: { rest: [number, number, number]; read: [number, number, number]; sit: number; m: number; reduced: boolean }): HandSpec {
  const u = b?.u ?? 0
  const row = b?.v ?? 0
  const r = side === 'r'
  const { rest, sit, m } = o
  if (pose === 'write') {
    const left: HandSpec = { pos: LEFT_ON_CARD, palm: 'down', curl: 'support' }
    const penAt = (x: number, y: number, z: number): HandSpec => ({ pos: [x, y, z], palm: 'down', curl: 'pen' })
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
        return { pos: mix(LEFT_ON_CARD, o.read, k), palm: k > 0.5 ? 'up' : 'down', curl: 'support' }
      }
      case 'next': {
        // pushes the done card to the left (0.3 s) and draws a new one (0.3 s)
        const out = Math.sin(Math.min(1, u * 2) * Math.PI) * 0.1
        return r ? penAt(NIB_X0, NIB_Y, lineZ(0)) : { pos: [LEFT_ON_CARD[0] - out, LEFT_ON_CARD[1], LEFT_ON_CARD[2]], palm: 'down', curl: 'support' }
      }
      default:
        return r ? stroke(NIB_X0, lineZ(row)) : left
    }
  }
  // at the board
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
