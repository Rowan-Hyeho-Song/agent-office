// The lounge's acts (#280, docs/design/lounge-props.md 2 · 3, sound.md 4.4): the fridge, the water dispenser and the turntable, as pure data and maths.
// Where the agent stands, how long each beat lasts, which cue fires when, what area the fridge door sweeps. No three.js, no scene: PlayStage /
// LoungeActs (loungeActs.ts) draw it, the Director (director.ts) schedules it, the TrafficPlanner (traffic.ts) keeps the others out of the door's way.

import type { Reservation } from './traffic'

export type ActKind = 'fridge' | 'dispenser' | 'record'
export const ACT_KINDS: readonly ActKind[] = ['fridge', 'dispenser', 'record']
export const isAct = (k: string): k is ActKind => (ACT_KINDS as readonly string[]).includes(k)

/**
 * The mini fridge's door (office.glb fridge_door: extras pivot_at (the south hinge), open {axis y, sign +1, deg 100, open_s 0.6, close_s 0.4}). It is 0.48 m wide, so
 * opened it sweeps a quarter-plus disc of that radius round the hinge, from the closed door (pointing north, -z) round to the room (west, -x) and a little past it.
 * `stand`: where the agent takes a drink, found on the walkable grid (lounge.test.ts): 0.5 m off the swept area (distance from the stand to the nearest swept point),
 * which is as near as an arm reaches the closed handle (0.71 m, water.ts REACH 0.75).
 */
export const FRIDGE = {
  hinge: { x: 4.335, z: -0.492 },
  width: 0.48,
  openDeg: 100,
  openS: 0.6,
  closeS: 0.4,
  stand: { x: 3.6, z: -1.15 },
  /** the middle of the opening the agent looks into */
  inside: { x: 4.55, z: -0.73 },
  /** the distance the designer asks for between the waiting body and the swept area */
  offM: 0.5,
  /**
   * #457 (lounge-props.md 5.5): the one step in, 0.30 m from the stand toward the opening, to take a drink from the shelf. A walkable cell, 0.15 m
   * or more off the swept area (lounge.test.ts), and both drinks' grips within an arm of it.
   */
  step: { x: 3.86, z: -1.0 },
  /** the least room between the stepping body and the door's swing (designer, 5.5) */
  stepOffM: 0.15,
} as const

/** #457: what an agent takes out of the fridge (lounge-props.md 5.3): a can from the top shelf, a small milk from the middle one */
export type DrinkKind = 'can' | 'milk'
export const DRINK_KINDS: readonly DrinkKind[] = ['can', 'milk']
/**
 * The two live drinks of office.glb: the prop node, its prop kind (extras.prop, the grip table's row), and its left-hand grip empty in the world
 * (`<prop>_grip_l`: 40% up its side, toward the agent; lounge.test.ts reads them off the model). The middle shelf is lower, so the body bends to it
 * (`dip`, m: the body sinks that much while the hand is in).
 */
export const DRINKS: Record<DrinkKind, { prop: string; kind: string; grip: { x: number; y: number; z: number }; dip: number }> = {
  can: { prop: 'prop_fridge_can', kind: 'fridge_can', grip: { x: 4.418, y: 0.669, z: -0.885 }, dip: 0.04 },
  milk: { prop: 'prop_fridge_milk', kind: 'fridge_milk', grip: { x: 4.423, y: 0.48, z: -0.853 }, dip: 0.1 },
}
/** the prop kinds of the drinks → which drink */
export const DRINK_PROP_KINDS: Readonly<Record<string, DrinkKind>> = { fridge_can: 'can', fridge_milk: 'milk' }

/** the angle (rad, about the hinge, from the closed door towards the room) at which a floor point lies, or null on the hinge */
function swingAngle(x: number, z: number): number | null {
  const dx = x - FRIDGE.hinge.x
  const dz = z - FRIDGE.hinge.z
  if (Math.hypot(dx, dz) < 1e-9) return null
  // closed: (0, -1); opened by θ about y: (-sin θ, -cos θ). So θ = atan2(-dx, -dz)
  return Math.atan2(-dx, -dz)
}

/** how far (m) a floor point is from the area the door sweeps (0 inside it): the disc sector of radius `width` round the hinge over 0 … openDeg */
export function sweptDistance(x: number, z: number, deg: number = FRIDGE.openDeg): number {
  const r = Math.hypot(x - FRIDGE.hinge.x, z - FRIDGE.hinge.z)
  const th = swingAngle(x, z)
  const max = (deg * Math.PI) / 180
  if (th !== null && th >= 0 && th <= max) return Math.max(0, r - FRIDGE.width)
  // outside the angular range: the nearer of the two straight edges (the closed door's line, the open door's line)
  const edge = (a: number) => {
    const ex = -Math.sin(a)
    const ez = -Math.cos(a)
    const px = x - FRIDGE.hinge.x
    const pz = z - FRIDGE.hinge.z
    const s = Math.max(0, Math.min(FRIDGE.width, px * ex + pz * ez))
    return Math.hypot(px - ex * s, pz - ez * s)
  }
  return Math.min(edge(0), edge(max))
}

/** a floor point inside the area the door sweeps, padded by `pad` m */
export const inSwept = (x: number, z: number, pad = 0) => sweptDistance(x, z) <= pad

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k))
  return c * c * (3 - 2 * c)
}

/** the fridge act's beats, s from arriving at the stand (lounge-props.md 3: opening 0.6, closing 0.4; 5.5 (#457): a step in to take a drink) */
export const FRIDGE_T = {
  /** the hand takes the handle (it is on it when the door starts), then the door opens (cue fridge.open) */
  open: 0.45,
  /** the agent leans in to look for a drink; with one to take, the step in starts here (FRIDGE.step, `stepS` long) */
  peek: 0.9,
  stepS: 0.35,
  /** the left hand sets off for the drink (the grip's approach and closing: grip.ts GRIP_S 0.3 + 0.12) … */
  reach: 1.25,
  /** … and has it (cue fridge.can / fridge.milk); it is lifted 2 cm and drawn out */
  grab: 1.67,
  /** the step back to the stand starts (`stepS` long), the drink before the chest */
  back: 1.75,
  /** the hand takes the handle again on the way and the door closes */
  close: 2.1,
  /** the door shut (cue fridge.close) */
  shut: 2.5,
  /** the hand has let go and the agent is free */
  total: 3.0,
  /** the hand lets go of the handle part-way while it opens (the open door's handle is out of the arm's reach): at this angle (deg) */
  letGoDeg: 70,
} as const

/** how far along the step in the body is at act time `u` (0 at the stand, 1 at FRIDGE.step) */
export const fridgeStepK = (u: number) => ease((u - FRIDGE_T.peek) / FRIDGE_T.stepS) - ease((u - FRIDGE_T.back) / FRIDGE_T.stepS)

/**
 * The inside light (lounge-props.md 5.4): on above 8° of opening, off again below 4° (it stays on until the door is nearly shut). The app's point
 * light at office.glb fridge_light (#eaf2ff, 1 m, decay 2), no brighter than `intensity` (#469 designer: 0.5 at most); the LED strip lit with it;
 * the floor spill 0.16 × how far open. On in 0.12 s, off in 0.08 s; at once with reduced motion.
 */
export const FRIDGE_LIGHT = { onDeg: 8, offDeg: 4, onS: 0.12, offS: 0.08, intensity: 0.5, color: '#eaf2ff', distance: 1, decay: 2, spill: 0.16 } as const
export const fridgeLightOn = (deg: number, wasOn: boolean) => deg > FRIDGE_LIGHT.onDeg || (wasOn && deg >= FRIDGE_LIGHT.offDeg)

/** the door's angle (deg) at act time `u`: 0 closed, FRIDGE.openDeg open */
export function doorDeg(u: number): number {
  return FRIDGE.openDeg * (ease((u - FRIDGE_T.open) / FRIDGE.openS) - ease((u - FRIDGE_T.close) / FRIDGE.closeS))
}

/**
 * when the drink is the left hand's (act time): at FRIDGE_T.grab, or with reduced motion as the door passes 70° (no step, no reach: it is simply
 * in the hand, lounge-props.md 5.5)
 */
export const grabAt = (reduced: boolean) => (reduced ? openTimeAt(FRIDGE_T.letGoDeg) : FRIDGE_T.grab)

/** the time the opening door reaches `deg` (it only rises on its way open) */
export function openTimeAt(deg: number): number {
  let lo: number = FRIDGE_T.open
  let hi: number = FRIDGE_T.open + FRIDGE.openS
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (doorDeg(mid) < deg) lo = mid
    else hi = mid
  }
  return hi
}

/** the water dispenser: a stand beside its two taps (water_tap_0 / _1 at x 4.48, z -1.195 / -1.105), the index finger presses one */
export const DISPENSER = {
  stand: { x: 3.95, z: -1.15 },
  /** the middle of the taps, the way to face */
  face: { x: 4.48, z: -1.15 },
  /** the pour (cue dispenser.pour `dur`, sound.md: 0.4–2 s, 1 s in the spec) */
  pourS: 1,
} as const
/** s from arriving: the finger reaches the tap and presses (cue dispenser.pour), the water runs `pourS`, the finger lifts and is free */
export const DISPENSER_T = { press: 0.5, release: 0.5 + DISPENSER.pourS, total: 0.5 + DISPENSER.pourS + 0.4 } as const

/** the turntable on the record shelf: where the agent stands and what it faces */
export const RECORD = {
  stand: { x: 0.6, z: 3.3 },
  face: { x: 0.6, z: 3.85 },
} as const
/**
 * Putting a record on (lounge-props.md 3: the jacket 0.6, the disc out 0.4, onto the platter 0.4, the arm over to the groove 0.5 and down 0.3), s from arriving.
 * With a record already on the platter the first stretch is not needed. Lifting the arm: up 0.5, back to its rest 0.3.
 */
export const RECORD_T = { take: 0.6, out: 1.0, place: 1.4, armOver: 0.5, armDown: 0.3, after: 0.4, /** the jacket goes back to its shelf (to 1.8) and the hand is free of it by */ free: 2.3, /** the right hand takes hold of the arm this long before the arm moves (its own approach and closing) */ grab: 0.42 } as const
export type RecordMode = 'put' | 'lift'

export interface RecordBeats {
  /** the right hand has the record (from 0 to `place`) */
  record: boolean
  /** the hand starts for the headshell here; the arm swings from `swing0` until `over`, is set down by `down`: record.needle / record.lift at `down` */
  arm0: number
  swing0: number
  over: number
  down: number
  total: number
}

export function recordBeats(mode: RecordMode, recordOn: boolean): RecordBeats {
  const swing = mode === 'lift' ? 0.5 : RECORD_T.armOver
  const set = mode === 'lift' ? 0.3 : RECORD_T.armDown
  const arm0 = mode === 'put' && !recordOn ? RECORD_T.free : 0.1
  const swing0 = arm0 + RECORD_T.grab
  return { record: mode === 'put' && !recordOn, arm0, swing0, over: swing0 + swing, down: swing0 + swing + set, total: swing0 + swing + set + RECORD_T.after }
}

/** how long an act lasts from arriving (the Director frees the agent after this) */
export function actTotal(kind: ActKind, mode?: RecordMode, recordOn = false): number {
  if (kind === 'fridge') return FRIDGE_T.total
  if (kind === 'dispenser') return DISPENSER_T.total
  return recordBeats(mode ?? 'put', recordOn).total
}

/** the nav spot an act's goal is labelled with (the planner reports the agent as `arrived` there), where it stands and what it faces */
export const ACT_PLACE: Record<ActKind, { spot: string; stand: { x: number; z: number }; face: { x: number; z: number } }> = {
  // the fridge and the dispenser share a spot label: the schedule gives a spot to one agent at a time, so they are never at the bar together
  fridge: { spot: 'hall_ne', stand: FRIDGE.stand, face: FRIDGE.inside },
  dispenser: { spot: 'hall_ne', stand: DISPENSER.stand, face: DISPENSER.face },
  record: { spot: 'hall_front', stand: RECORD.stand, face: RECORD.face },
}

/** what the schedule's labels say for each act */
export const ACT_LABEL: Record<ActKind, string> = { fridge: '냉장고에서 음료', dispenser: '정수기에서 물', record: '턴테이블에 음악' }

/**
 * The planner's hold on the fridge door's swing (#280): while an agent has the door in use (from the moment it is sent to it, until it is done) nobody else's
 * centre comes within a body radius of the area the door sweeps. Local and principled: one named area, owned by the agent at the door, released when it is done.
 * `state` is the caller's own memory of who holds it (so the same agent keeps its start time); call it each frame with the Director's fridgeUser().
 */
export function syncFridgeHold(planner: { reserve(r: Reservation): void; release(id: string): void }, state: { user: string | null; from: number }, user: string | null, t: number, bodyR = 0.3) {
  if (user === state.user) return
  state.user = user
  state.from = t
  if (user) planner.reserve({ id: 'fridge', owner: user, distance: (x, z) => sweptDistance(x, z), near: bodyR, from: t, to: Infinity })
  else planner.release('fridge')
}
