// #451 (lounge-props.md 7): twice a day one agent walks to the door and presses its lever: at 09:00 KST it opens the office (메모, or the first one
// resting if 메모 works; nobody if all work), at 23:00 it locks up (the night-duty agent, else 메모). The door itself does not open (its leaf is the door
// screen): the lever goes down and up and the mat is stepped on. Pure: the director runs it; loungeActs.ts draws the lever and the mat.

import { hash } from './play'

export type DoorKind = 'morning' | 'night'

export const DOOR_ROUND = {
  /** KST minutes of the day, plus a seed of 0–seedS seconds (the same for every visitor) */
  startMin: { morning: 9 * 60, night: 23 * 60 } as Record<DoorKind, number>,
  seedS: 90,
  /** a round not started by this long after its time is not started (a page opened later) */
  windowS: 120,
  /** the lever held down: 1.2 s in the morning (looking at the door's screen), 1 s at night */
  holdS: { morning: 1.2, night: 1.0 } as Record<DoorKind, number>,
  /** at night a 2° nod to the door after letting go, this long */
  nodS: 0.8,
  /** in the morning "반가움" for this long, from the press */
  smileS: 2,
  /** given up when not at the door this long after it began (a blocked way) */
  giveUpS: 90,
  /** the stand in front of the lever (nav_door, on the mat) */
  spot: 'door',
} as const

export const DOOR_LABEL: Record<DoorKind, string> = { morning: '아침 · 문 여는 중', night: '문단속 중' }

/** the lever's press in s from arriving: taken, down (press_s), held, up (release_s): loungeActs.ts LEVER_T + the lever's extras */
export const LEVER = { grab: 0.42, pressS: 0.3, releaseS: 0.3 } as const
/** how long the act at the door lasts from arriving, s: the press, the hold, the release, and the night's nod */
export const atDoorS = (kind: DoorKind) => LEVER.grab + LEVER.pressS + DOOR_ROUND.holdS[kind] + LEVER.releaseS + (kind === 'night' ? DOOR_ROUND.nodS : 0.2)

const DAY = 86_400_000
const KST = 9 * 3_600_000
/** the round's start (ms) on the KST day of `now` */
export function doorStartAt(kind: DoorKind, now: number): number {
  // Seoul has no summer time: its midnight is a fixed 9 h before UTC's
  const day = Math.floor((now + KST) / DAY)
  const dayStart = day * DAY - KST
  const seed = ((hash(`door|${kind}|${day}`) % 1000) / 999) * DOOR_ROUND.seedS * 1000
  return dayStart + DOOR_ROUND.startMin[kind] * 60_000 + Math.round(seed)
}

/** the round due at `now` (its start passed less than windowS ago), or null */
export function doorDue(now: number): { kind: DoorKind; at: number } | null {
  for (const kind of ['morning', 'night'] as const) {
    const at = doorStartAt(kind, now)
    if (now >= at && now - at < DOOR_ROUND.windowS * 1000) return { kind, at }
  }
  return null
}

/**
 * Who goes: in the morning 메모 (agent_0), or the first in the roster not working; nobody if all work. At night the night-duty agent, else 메모; not one
 * who works.
 */
export function doorAgent(kind: DoorKind, agents: string[], working: (a: string) => boolean, duty: string | null): string | null {
  if (kind === 'night') {
    for (const a of [duty, 'agent_0']) if (a && agents.includes(a) && !working(a)) return a
    return null
  }
  const order = ['agent_0', ...agents.filter((a) => a !== 'agent_0')].filter((a) => agents.includes(a))
  return order.find((a) => !working(a)) ?? null
}

export interface DoorRun {
  agent: string
  kind: DoorKind
  /** the round's start (ms) */
  at: number
  /** when it got to the door (ms), or null on the way */
  arrived: number | null
}

/** seconds at the door (-1 on the way) */
export const doorU = (r: DoorRun, now: number) => (r.arrived === null ? -1 : (now - r.arrived) / 1000)

export function stepDoor(r: DoorRun, o: { now: number; arrived: boolean }): { run: DoorRun; done: boolean; giveUp: boolean } {
  const run = r.arrived === null && o.arrived ? { ...r, arrived: o.now } : r
  if (run.arrived === null) return { run, done: false, giveUp: o.now - run.at > DOOR_ROUND.giveUpS * 1000 }
  return { run, done: (o.now - run.arrived) / 1000 >= atDoorS(run.kind), giveUp: false }
}
