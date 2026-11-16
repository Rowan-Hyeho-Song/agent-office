// #137 ③ the visitor's paddle at the ping-pong table (play.md 3 · 4 · 5.4 · 8): whether it is flying in, open, flying back; the match itself
// (visitorPingpong.ts); the paddle where the visitor holds it; the "🏓 라켓 잡기" tag; what the scene has not shown yet. A tiny external store like
// omokVisit/store.ts: PingpongVisitRig.tsx flies the camera, steps the match and moves the paddle; PingpongVisitUi.tsx is the tag and the HUD.
// Only in this visitor's tab: nothing goes to a server, the other visitors see the agents' own rally.

import { useSyncExternalStore } from 'react'
import {
  followPaddle, serveVisitorPP, setEasy, setSpeed, spaceVisitorPP, startVisitorPP, stepVisitorPP, type Paddle, type PPEvent, type Speed, type VisitorPP,
} from '../../play/visitorPingpong'
import type { Dims } from '../../play/pingpong'
import { holdPhase, WORK_HOLD, type WorkHold } from '../../play/workHold'

export type VisitPhase = 'closed' | 'flying' | 'open' | 'leaving'

export interface PingpongVisitState {
  phase: VisitPhase
  /** the agent across the table (side 1) */
  agent: string | null
  /** the agent who was playing at the visitor's end: it steps aside to watch (null when that end was empty) */
  watcher: string | null
  match: VisitorPP | null
  /** the visitor's paddle (table-local, visitorPingpong.ts Paddle) */
  paddle: Paddle
  /** the tag's place on the screen (over the near end), and who it would play; null when nobody plays there */
  tag: { x: number; y: number; agent: string; watcher: string | null; dims?: Dims } | null
  /** the first-time help (play.md 3.3) shown in this tab already */
  helped: boolean
  /** the agent stands at the far end: the match may go on (the serve waits for it) */
  ready: boolean
  /** #601 the agent was called to work during the match: it plays it out (this tab only), up to the cap (play.md 10) */
  work: WorkHold | null
  /** #601 the cap wound the match up: the agent put its paddle down and went (the HUD's 중단 line) */
  stopped: boolean
  /** #601 where the work chip stands on the screen (over the agent's head; the rig, every frame) */
  chip: { x: number; y: number } | null
  /** #601 when the match ended for the agent (office ms; workSignalPingpong notes it): its line there, then away */
  doneAt: number | null
}

const REST: Paddle = { y: 0.2, z: 0, vz: 0 }
export const CLOSED: PingpongVisitState = { phase: 'closed', agent: null, watcher: null, match: null, paddle: REST, tag: null, helped: false, ready: false, work: null, stopped: false, chip: null, doneAt: null }

let state: PingpongVisitState = CLOSED
let pending: PPEvent[] = []
const listeners = new Set<() => void>()
const set = (next: PingpongVisitState) => {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}
const take = (r: { g: VisitorPP; events: PPEvent[] } | null): boolean => {
  if (!r) return false
  pending.push(...r.events)
  set({ ...state, match: r.g })
  return true
}

export const getPingpongVisit = () => state
/** the camera rig, the tour, the WASD keys, the other picks and the docks stand aside while the visitor plays */
export const isPingpongActive = () => state.phase !== 'closed'
export const usePingpongVisit = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), getPingpongVisit, getPingpongVisit)
export const drainPingpongEvents = (): PPEvent[] => {
  const out = pending
  pending = []
  return out
}

/** take the paddle against `agent` (`watcher` steps aside); reduced motion: easy mode and slow to start (play.md 5.4) */
export function openPingpong(agent: string, watcher: string | null, seed: number, reduced = false, dims?: Dims): boolean {
  if (state.phase !== 'closed') return false
  pending = []
  set({ ...CLOSED, helped: state.helped, tag: state.tag, phase: 'flying', agent, watcher, match: startVisitorPP(agent, seed, reduced ? 'slow' : 'normal', reduced, dims), paddle: REST })
  return true
}
export const pingpongArrived = () => state.phase === 'flying' && set({ ...state, phase: 'open' })
export const pingpongHelped = () => !state.helped && set({ ...state, helped: true })
/** leave (그만두기, Esc, called to work): the camera flies back */
export function closePingpong() {
  if (state.phase === 'closed' || state.phase === 'leaving') return
  set({ ...state, phase: 'leaving' })
}
export const pingpongLeft = () => state.phase === 'leaving' && set({ ...CLOSED, helped: state.helped, tag: state.tag })
/** a reset (the timelapse, a seek): closed at once */
export const resetPingpong = () => set({ ...CLOSED, helped: state.helped })

/** the paddle where the visitor holds it now; easy mode moves it itself (stepPingpong) */
export function setPaddle(p: Paddle) {
  const was = state.paddle
  if (was.y === p.y && was.z === p.z && was.vz === p.vz) return
  set({ ...state, paddle: p })
}
/** the frame: the match on by `dtS` real seconds (only while open) */
export function stepPingpong(dtS: number) {
  const m = state.match
  if (!m || state.phase !== 'open' || state.stopped) return
  const p = m.easy ? followPaddle(m, state.paddle) : state.paddle
  const r = stepVisitorPP(m, dtS, p)
  pending.push(...r.events)
  set({ ...state, match: r.g, paddle: p })
}
/**
 * #601 the agent's status this frame (Agents.tsx): a call to work during the match is held (the match goes on), and past its cap the match is
 * wound up (stopped: the HUD's 중단 line, the agent goes); back to rest before the end, the hold is dropped. True the frame the hold begins.
 */
export function workSignalPingpong(busy: boolean, now: number): boolean {
  if (state.match && state.doneAt === null && (state.match.phase === 'over' || state.stopped)) set({ ...state, doneAt: now })
  const m = state.match
  if (!m || m.phase === 'over' || state.stopped || state.phase === 'closed' || state.phase === 'leaving') return false
  const w = state.work
  if (!busy) {
    if (w) set({ ...state, work: null })
    return false
  }
  if (!w) {
    set({ ...state, work: { since: now, told: false } })
    return true
  }
  if (holdPhase(w, now).phase === 'over') set({ ...state, stopped: true, doneAt: now })
  return false
}
/** the moment's look and line were shown */
export const pingpongWorkTold = (now: number) => state.work && !state.work.told && set({ ...state, work: { ...state.work, told: true, toldAt: now } })
/** the chip's place (the rig) */
export function setPingpongChip(chip: PingpongVisitState['chip']) {
  const c = state.chip
  if (c === chip || (c && chip && Math.abs(c.x - chip.x) < 0.5 && Math.abs(c.y - chip.y) < 0.5)) return
  set({ ...state, chip })
}
/** the match is over for the agent (won, lost, wound up): it may go */
export const pingpongDone = () => !!state.match && (state.match.phase === 'over' || state.stopped)
/** #601 the visitor's match holds the agent at the far end: until the visitor leaves; over with a call to work held (or wound up), it goes at once */
export const pingpongHoldsAgent = (now: number) =>
  state.phase !== 'closed' &&
  state.phase !== 'leaving' &&
  !!state.match &&
  !((!!state.work || state.stopped) && pingpongDone() && now - (state.doneAt ?? now) >= WORK_HOLD.leaveMs)

/** a click or a tap on the table (the visitor's serve) */
export const servePingpong = () => !!state.match && state.phase === 'open' && state.ready && !state.stopped && take(serveVisitorPP(state.match, state.paddle))
/** Space: the serve, or (easy mode) the hit */
export const spacePingpong = () => !!state.match && state.phase === 'open' && state.ready && !state.stopped && take(spaceVisitorPP(state.match, state.paddle))
/** the rig: whether the agent stands at the far end now */
export const setPingpongReady = (ready: boolean) => state.ready !== ready && set({ ...state, ready })
export const speedPingpong = (s: Speed) => state.match && set({ ...state, match: setSpeed(state.match, s) })
export const easyPingpong = (on: boolean) => state.match && set({ ...state, match: setEasy(state.match, on) })
/** a new match, the same agent, the same speed and mode */
export function restartPingpong(seed: number) {
  const m = state.match
  if (!m || state.phase !== 'open') return
  pending = []
  set({ ...state, match: startVisitorPP(m.agent, seed, m.speed, m.easy, m.st.dims), paddle: REST, doneAt: null })
}
/** where the tag stands on the screen (the rig, every frame) */
export function setPingpongTag(tag: PingpongVisitState['tag']) {
  const t = state.tag
  if (t === tag || (t && tag && t.agent === tag.agent && t.watcher === tag.watcher && Math.abs(t.x - tag.x) < 0.5 && Math.abs(t.y - tag.y) < 0.5)) return
  set({ ...state, tag })
}
