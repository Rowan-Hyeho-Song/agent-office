// The LIVE desk props (#44, docs/design/desks.md 4): what each agent's desk shows about what it is doing.
// Pure: statuses + approval counts + the clock in, the ten props' states out. The 3D props (Blender #43) and the
// debug panel both read this, so a prop never decides anything by itself.

import type { StatusMap } from './status'

/** what the props need besides the agents' statuses */
export interface PropsInput {
  status: StatusMap
  /** approvals waiting for the owner (#25 approvals_pending) */
  pending: number
  /** seats with a request still waiting (approvals_cover.requester_seat) */
  waitingSeats: number[]
  /** when the owner last decided something (the pending count went down), ms */
  decidedAt: number | null
  /** work the planner handed out today (its delegate activity starts, #1 agent_events) */
  handoffsToday: number
  now: number
}

export type Signal = 'off' | 'yellow' | 'green' | 'red'
export type Ring = 'off' | 'on' | 'blink'

export interface DeskProps {
  /** desk_0_in: sheets in the IN tray, 0..5 = pending approvals */
  inbox: number
  /** desk_0_out: sheets in the OUT tray, 0..5 = work handed out today */
  outbox: number
  /** screen_cal_0: today's date on the desk calendar (the visitor's clock) */
  calendar: { year: number; month: number; day: number; weekday: string }
  /** desk_0_hourglass: sand runs while the planner waits for an approval */
  hourglass: boolean
  /** prop_stamp: the planner stamps for a moment after a decision */
  stamp: boolean
  /** desk_1_turntable: spins while the 3D agent bakes (build) */
  turntable: boolean
  /** desk_1_ringlight: on while baking, blinks for a while after a bake finishes */
  ringlight: Ring
  /** desk_2_tablet: the active area glows while the designer edits */
  tablet: boolean
  /** desk_2_lamp: on while the designer is in (not gone home) */
  lamp: boolean
  /** desk_3_signal_g/_y/_r: test / build running = yellow, then the outcome green / red; nothing yet = off */
  signal: Signal
  /** desk_3_duck_look: the coder turns to the duck when a test fails */
  duckLook: boolean
}

export const MAX_SHEETS = 5
/** how long the stamp stays in the planner's hand after a decision */
export const STAMP_MS = 2_000
/** how long the ring light blinks after a bake */
export const BLINK_MS = 10_000

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const sheets = (n: number) => Math.max(0, Math.min(MAX_SHEETS, Math.floor(n) || 0))

export function deskProps(i: PropsInput): DeskProps {
  const s = (seat: number) => i.status[`agent_${seat}`]
  const doing = (seat: number, ...activities: string[]) => s(seat)?.state === 'working' && activities.includes(s(seat)?.activity ?? '')
  const date = new Date(i.now)

  // the coder's light: running beats the last outcome; an outcome stays until the next run
  const coder = s(3)
  const running = doing(3, 'test', 'build')
  const signal: Signal = running ? 'yellow' : coder?.lastResult ? (coder.lastResult.ok ? 'green' : 'red') : 'off'

  // the 3D agent's bake: the turntable spins while it builds, the ring light blinks once it's done
  const baking = doing(1, 'build')
  const lastBake = s(1)?.lastResult
  const justBaked = !!lastBake && lastBake.activity === 'build' && i.now - lastBake.at < BLINK_MS
  const ringlight: Ring = baking ? 'on' : justBaked ? 'blink' : 'off'

  return {
    inbox: sheets(i.pending),
    outbox: sheets(i.handoffsToday),
    calendar: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), weekday: WEEKDAYS[date.getDay()] },
    hourglass: i.waitingSeats.includes(0),
    stamp: i.decidedAt !== null && i.now - i.decidedAt >= 0 && i.now - i.decidedAt < STAMP_MS,
    turntable: baking,
    ringlight,
    tablet: doing(2, 'edit'),
    lamp: !!s(2) && s(2).state !== 'off',
    signal,
    duckLook: signal === 'red',
  }
}
