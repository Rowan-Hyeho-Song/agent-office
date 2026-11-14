// Play sessions (#135): ties the clock-driven schedule (office/play.ts) to the play engines. A session is one pair game
// during one schedule block; its seed hashes (block, kind, spot, players), so the same wall time gives the same rally
// and the same stones in every browser, in timelapse and after seeking. Pure: no Date, no random.

import { BLOCK_MINUTES, PLAYS, blockOf, hash, playAt } from '../office/play'

export type SessionKind = 'pingpong' | 'boardgame'
export interface PlaySession {
  kind: SessionKind
  /** the first spot of the pair (the table) */
  spot: string
  /** [agent at the first spot, agent at the second] = [side 0 / black first game, side 1 / white] */
  players: [string, string]
  seed: number
  /** the block start (ms) */
  startMs: number
  /** #137: one agent placing a game record alone (players = [it, it]): it plays both colours, the other chair is empty */
  solo?: boolean
}

/** time for the players to walk over and sit down before the first serve / move */
export const SETTLE_MS = 15_000
export const BLOCK_MS = BLOCK_MINUTES * 60_000

/** engine-local time of an absolute time within a session: negative while the players are still settling in */
export const sessionTime = (s: PlaySession, ms: number) => ms - s.startMs - SETTLE_MS

/**
 * The pair sessions running at `ms` (absolute, ms since the epoch). Agents in `busy` are not playing, so a pair
 * missing a player has no session. Same input, same output.
 */
export function sessionsAt(ms: number, agents: string[], busy: ReadonlySet<string> = new Set()): PlaySession[] {
  const minute = Math.floor(ms / 60_000)
  const assign = playAt(minute, agents, busy)
  const block = blockOf(minute)
  const out: PlaySession[] = []
  for (const def of PLAYS) {
    if (!def.pair || (def.kind !== 'pingpong' && def.kind !== 'boardgame')) continue
    const a = Object.keys(assign).sort().find((id) => assign[id].kind === def.kind && assign[id].spot === def.spots[0])
    if (!a) continue
    const b = assign[a].partner
    if (!b || assign[b]?.spot !== def.spots[1]) continue
    out.push({ kind: def.kind, spot: def.spots[0], players: [a, b], seed: hash(`${block}|${def.kind}|${def.spots[0]}|${a}|${b}`), startMs: block * BLOCK_MS })
  }
  // a game record placed alone (#137): the board's session with the one agent on both sides
  const solo = Object.keys(assign).sort().find((id) => assign[id].kind === 'boardgame_solo')
  if (solo) out.push({ kind: 'boardgame', spot: assign[solo].spot, players: [solo, solo], solo: true, seed: hash(`${block}|boardgame_solo|${assign[solo].spot}|${solo}`), startMs: block * BLOCK_MS })
  return out
}
