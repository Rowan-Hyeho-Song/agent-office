// The paddle's way through one exchange (#416 ③, play.md 7): read where the ball will be, take the paddle there while it
// flies, wait drawn back, swing in the last 0.25 s so the face's centre meets the ball, follow through, come back. Pure,
// table-local metres and rally milliseconds (rallyAt's clock), so it is the same for every visitor and unit tested.

import type { V3 } from './pingpong'

/** one contact of one side: a hit, or a whiff at a ball that wins the point (`miss`) */
export interface Contact {
  side: 0 | 1
  /** contact time (ms, rally clock) */
  t: number
  /** the ball centre at contact (table-local) */
  at: V3
  miss: boolean
  /** from when this side may move for it: the opponent's hit it answers, or the start of the serve's toss */
  from: number
}

export const STROKE = {
  /** only the head follows the ball at first */
  reactMs: 150,
  /** the paddle is at the ready place this long before contact (it then waits) */
  readyLeadMs: 300,
  swingMs: 250,
  /** a ball faster than this: the move runs straight into the swing */
  fastMs: 550,
  followMs: 250,
  backMs: 400,
  /** the ready place: from the contact point toward the body, and down */
  backM: 0.25,
  downM: 0.05,
  /** the follow-through goes on this far along the swing */
  followM: 0.15,
  /** a ball that wins the point is swung at this far beside it */
  whiffM: 0.25,
  /** the waiting paddle breathes ±1 cm */
  breathM: 0.01,
  /** the wrist: drawn back while ready, forward at contact (rad, about the vertical) */
  wristBack: (30 * Math.PI) / 180,
  wristThrough: (45 * Math.PI) / 180,
} as const

export type StrokePhase = 'rest' | 'react' | 'move' | 'wait' | 'swing' | 'follow' | 'back'

export interface StrokePose {
  /** the blade's centre, table-local */
  pos: V3
  /** wrist turn about the vertical: + forward (through the ball), − drawn back */
  wrist: number
  /** the backhand side (the contact is on the side away from the paddle hand): the blade turned over */
  backhand: boolean
  phase: StrokePhase
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))
const lerp = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** where the blade's centre is at contact: on the ball's near side by `gap` (ball radius + half the blade); a whiff beside it */
export function faceAt(c: Contact, dir: 1 | -1, gap: number): V3 {
  const side = c.at[2] >= 0 ? -1 : 1 // a whiff passes on the table's middle side of the ball
  return [c.at[0] - dir * gap, c.at[1], c.at[2] + (c.miss ? side * STROKE.whiffM : 0)]
}

/** the forehand side of a player: its right hand is on +z when it faces +x (dir +1), on −z when it faces −x */
export const isBackhand = (c: Contact, dir: 1 | -1) => c.at[2] * dir < -0.05

/** after a contact: follow through along the swing, then back to the ready place */
function after(c: Contact, tMs: number, dir: 1 | -1, gap: number, home: V3): StrokePose | null {
  const dt = tMs - c.t
  if (dt < 0 || dt >= STROKE.followMs + STROKE.backMs) return null
  const face = faceAt(c, dir, gap)
  const end: V3 = [face[0] + dir * STROKE.followM, face[1] + 0.04, face[2]]
  const backhand = isBackhand(c, dir)
  if (dt < STROKE.followMs) {
    const k = 1 - (1 - dt / STROKE.followMs) ** 2
    return { pos: lerp(face, end, k), wrist: STROKE.wristThrough, backhand, phase: 'follow' }
  }
  const k = ease((dt - STROKE.followMs) / STROKE.backMs)
  return { pos: lerp(end, home, k), wrist: STROKE.wristThrough * (1 - k), backhand: backhand && k < 0.5, phase: 'back' }
}

/**
 * The blade at rally time `tMs` for one side.
 * @param contacts this side's contacts around now (any order)
 * @param home the ready place at the end line (table-local)
 * @param dir +1 for the side that hits toward +x
 * @param gap ball centre to the blade's centre at contact
 */
export function strokeAt(contacts: readonly Contact[], tMs: number, home: V3, dir: 1 | -1, gap: number): StrokePose {
  const cs = [...contacts].sort((a, b) => a.t - b.t)
  const next = cs.find((c) => c.t >= tMs)
  const last = [...cs].reverse().find((c) => c.t < tMs)
  const rest = (): StrokePose => (last && after(last, tMs, dir, gap, home)) || { pos: home, wrist: 0, backhand: false, phase: 'rest' }
  if (!next || tMs < next.from) return rest()

  const T = next.t - next.from
  const u = tMs - next.from
  const face = faceAt(next, dir, gap)
  const ready: V3 = [face[0] - dir * STROKE.backM, face[1] - STROKE.downM, face[2]]
  const backhand = isBackhand(next, dir)
  // where the move starts: wherever the last stroke had got to when this one's reaction ended (or the ready place)
  const swingAt = T - STROKE.swingMs
  const moveEnd = Math.max(0, T < STROKE.fastMs ? swingAt : T - STROKE.readyLeadMs)
  const moveStart = Math.min(STROKE.reactMs, moveEnd)
  const start = (last && after(last, next.from + moveStart, dir, gap, home)?.pos) || home

  if (u < moveStart) return { ...(rest()), phase: 'react' }
  if (u < moveEnd) {
    const k = ease((u - moveStart) / (moveEnd - moveStart))
    return { pos: lerp(start, ready, k), wrist: -STROKE.wristBack * k, backhand, phase: 'move' }
  }
  if (u < swingAt) {
    const b = Math.sin(((u - moveEnd) / 1000) * Math.PI * 2 * 0.8) * STROKE.breathM
    return { pos: [ready[0], ready[1] + b, ready[2]], wrist: -STROKE.wristBack, backhand, phase: 'wait' }
  }
  // the swing: from the ready place to the face (a ball faster than the swing itself: straight from where the paddle was)
  const from = moveEnd > swingAt ? start : ready
  const k = Math.min(1, (u - Math.max(swingAt, 0)) / Math.min(STROKE.swingMs, T))
  const kk = k * k // speeding up into the ball
  return { pos: lerp(from, face, kk), wrist: -STROKE.wristBack + (STROKE.wristBack + STROKE.wristThrough) * kk, backhand, phase: 'swing' }
}
