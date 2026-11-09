// ② sound events from the deterministic play engines and the live props (docs/design/sound.md 4.1, coder's hook list).
// Each engine is a pure function of time, so a sound is "an event between last frame and this frame": a paddle's swing
// passing contact, the ball turning upward at the table, a new stone on the board, the stamp reaching paper, the signal
// light changing. A jump (seek, a long frame, a new session) plays nothing: skipped events stay silent (sound.md 6).

import type { Rally } from '../play/pingpong'
import { cue } from './cues'
import type { Vec } from './engine'

/** frames further apart than this are a jump, not playback (ms of play time) */
export const JUMP_MS = 250

export type PingpongEvent = 'hit' | 'bounce' | 'floor'

/** what the ping-pong tracker remembers of the last frame */
export type PingpongPrev = { seed: number; tMs: number; swingSide: number | null; swingT: number; y: number | null; vy: number; phase?: Rally['phase'] }

/**
 * Events between two frames of the same rally (pure, tested).
 * - hit: the same side's swing passes contact (t01 0.5; a miss swings late and still sounds like air, not a ball)
 * - bounce: the ball turns upward within 8 cm of the table top (at 60 fps it moves ~5 cm a frame, so the lowest sample
 *   can sit above the surface; table-local y = ball radius at contact)
 * - floor: it turns upward below the table, or the point ends (a miss into the net or long: the ball is gone before
 *   it reaches the floor, so the end of the point is where the dull "툭" goes)
 */
export function pingpongEvents(prev: PingpongPrev | null, seed: number, tMs: number, r: Rally, ballR: number): { events: PingpongEvent[]; next: PingpongPrev } {
  const y = r.ballPos ? r.ballPos[1] : null
  const dt = prev ? tMs - prev.tMs : 0
  const vy = prev && prev.y !== null && y !== null && dt > 0 ? (y - prev.y) / dt : 0
  const next: PingpongPrev = { seed, tMs, swingSide: r.swing?.side ?? null, swingT: r.swing?.t01 ?? 0, y, vy, phase: r.phase }
  if (!prev || prev.seed !== seed || dt <= 0 || dt > JUMP_MS) return { events: [], next }
  const events: PingpongEvent[] = []
  if (r.swing && prev.swingSide === r.swing.side && prev.swingT < 0.5 && r.swing.t01 >= 0.5) events.push('hit')
  // the turning point is last frame's height (the lowest one)
  if (y !== null && prev.y !== null && prev.vy < 0 && vy >= 0) {
    if (prev.y < ballR + 0.08 && prev.y > -0.05) events.push('bounce')
    else if (prev.y < -0.3) events.push('floor')
  }
  if (prev.phase && prev.phase !== 'dead' && r.phase === 'dead' && !events.includes('floor')) events.push('floor')
  return { events, next }
}

/** the stamp's press (playStage: a 1.2 s cycle, lifted 0–450 ms, down by 550 ms): did t cross a press? (pure) */
export const STAMP_CYCLE_MS = 1200
export const STAMP_PRESS_MS = 550
export function stampPressed(prevT: number | null, t: number): boolean {
  if (prevT === null || t <= prevT || t - prevT > JUMP_MS / 1000) return false
  const n = (x: number) => Math.floor((x * 1000 - STAMP_PRESS_MS) / STAMP_CYCLE_MS)
  return n(t) > n(prevT)
}

/** sounds for one PlayStage (one per office). Call sites are one line each. */
export class PlaySounds {
  private pp: PingpongPrev | null = null
  private omok: { seed: number; game: number; moves: number } | null = null
  private stampT: number | null = null
  private pourUntil = 0
  private signal: string | undefined
  private signalSeen = false

  /** ping-pong: after rallyAt, with the ball's world position */
  pingpong(seed: number, tMs: number, r: Rally, ballR: number, ballWorld: Vec | null) {
    const { events, next } = pingpongEvents(this.pp, seed, tMs, r, ballR)
    this.pp = next
    const pos = ballWorld ? { x: ballWorld.x, y: ballWorld.y, z: ballWorld.z } : undefined
    for (const e of events) {
      const key = `pingpong:${seed}:${r.game}:${Math.round(tMs / 10)}`
      if (e === 'hit') cue('pingpong.hit', { pos, key })
      else if (e === 'bounce') cue('pingpong.bounce', { pos, key })
      else cue('pingpong.dull', { pos, key })
    }
  }

  /** omok: a new stone on the board is the "딱" (gameAt adds it at the hand's PLACE_AT) */
  omokStone(seed: number, game: number, moves: number, at: Vec | null) {
    const prev = this.omok
    this.omok = { seed, game, moves }
    if (!prev || prev.seed !== seed || prev.game !== game || moves !== prev.moves + 1 || !at) return
    cue('omok.place', { pos: { x: at.x, y: at.y, z: at.z }, key: `omok:${seed}:${game}:${moves}` })
  }

  /** the planner's stamp: one thud per press while stamping (null when not stamping) */
  stamp(t: number | null, at: Vec | null) {
    const prev = this.stampT
    this.stampT = t
    if (t !== null && at && stampPressed(prev, t)) cue('stamp', { pos: { x: at.x, y: at.y, z: at.z } })
  }

  /** the watering can's stream: a 3 s trickle, renewed while it keeps pouring */
  water(on: boolean, t: number, at: Vec | null) {
    if (!on || !at) {
      this.pourUntil = 0
      return
    }
    if (t < this.pourUntil - 0.2) return
    this.pourUntil = t + 2.8
    cue('water', { pos: { x: at.x, y: at.y, z: at.z }, dur: 3 })
  }

  /** 루프's signal tower: green = pass, red = fail; the first frame (page load) stays quiet */
  signalLight(state: string | undefined, at: Vec | null) {
    const prev = this.signal
    const seen = this.signalSeen
    this.signal = state
    this.signalSeen = true
    if (!seen || prev === state || !at) return
    const pos = { x: at.x, y: at.y, z: at.z }
    if (state === 'green') cue('test.pass', { pos })
    else if (state === 'red') cue('test.fail', { pos })
  }
}
