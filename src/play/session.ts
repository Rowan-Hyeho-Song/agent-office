// Play sessions (#135): ties the clock-driven schedule (office/play.ts) to the play engines. A session is one pair game
// during one stay of the day's plan (#490); its seed hashes (the stay, kind, spot, players), so the same wall time gives the same
// rally and the same stones in every browser, in timelapse and after seeking. Pure: no Date, no random.

import { PLAYS, hash, playAt, type BoardGameKind } from '../office/play'
import type { OmokView } from './omok'
import type { ChessView } from './chessTimeline'

export type SessionKind = 'pingpong' | 'boardgame'
export interface PlaySession {
  kind: SessionKind
  /** the first spot of the pair (the table) */
  spot: string
  /** [agent at the first spot, agent at the second] = [side 0 / black first game, side 1 / white] */
  players: [string, string]
  seed: number
  /** when both players are there (a pair; play.md 9.2: the first one waited), or when the record placed alone began (ms) */
  startMs: number
  /** the board game, for kind 'boardgame' (pair, solo record, and the visitor's game; hologram.md 10.2) */
  game?: BoardGameKind
  /** #137: one agent placing a game record alone (players = [it, it]): it plays both colours, the other chair is empty */
  solo?: boolean
  /** #137 ② a visitor's game against the agent (players = [agent, VISITOR], the visitor black): the view comes from the visitor's game, not the seed */
  visitor?: OmokView
  /** #604 the visitor's chess game (players = [agent, VISITOR]): the view comes from the visitor's game (visitorChess.ts chessViewOf), not the seed */
  visitorChess?: ChessView
}

/** the visitor's place in a session's players (no rig: their stones appear without a hand) */
export const VISITOR = 'visitor'

/** time for the players to walk over and sit down before the first serve / move */
export const SETTLE_MS = 15_000

/** engine-local time of an absolute time within a session: negative while the players are still settling in */
export const sessionTime = (s: PlaySession, ms: number) => ms - s.startMs - SETTLE_MS

/**
 * The pair sessions running at `ms` (absolute, ms since the epoch). Agents in `busy` are not playing, so a pair
 * missing a player has no session. Same input, same output.
 */
export function sessionsAt(ms: number, agents: string[], busy: ReadonlySet<string> = new Set()): PlaySession[] {
  const assign = playAt(ms, agents, busy)
  const out: PlaySession[] = []
  for (const def of PLAYS) {
    if (!def.pair || (def.kind !== 'pingpong' && def.kind !== 'boardgame')) continue
    const a = Object.keys(assign).sort().find((id) => assign[id].kind === def.kind && assign[id].spot === def.spots[0] && assign[id].partner)
    if (!a) continue
    const b = assign[a].partner!
    if (assign[b]?.spot !== def.spots[1]) continue
    out.push({ kind: def.kind, spot: def.spots[0], players: [a, b], seed: hash(`${assign[a].stay}|${def.kind}|${def.spots[0]}|${a}|${b}`), startMs: assign[a].pairAt ?? assign[a].since, ...(def.kind === 'boardgame' ? { game: assign[a].game ?? 'omok' } : {}) })
  }
  // a game record placed alone (#137): the board's session with the one agent on both sides
  const solo = Object.keys(assign).sort().find((id) => assign[id].kind === 'boardgame_solo')
  if (solo) out.push({ kind: 'boardgame', spot: assign[solo].spot, players: [solo, solo], solo: true, game: assign[solo].game ?? 'omok', seed: hash(`${assign[solo].stay}|boardgame_solo|${assign[solo].spot}|${solo}`), startMs: assign[solo].since })
  return out
}
