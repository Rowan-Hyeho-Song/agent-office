// #601 (play.md 10): a game with the visitor (omok, ping-pong) goes on to its end when the agent is called to work, in that visitor's tab only:
// the moment it comes (a look to the desk, a line), a small chip and a HUD word until the game ends, the last 30 s counted, and at 4 min the game
// is wound up and the agent goes. Pure: what the stores, the rigs and the HUDs show, from when the call came and the office clock.

export type GameKind = 'omok' | 'pingpong'

export const WORK_HOLD = {
  /** the longest a call to work waits for the game (play.md 10.3) */
  capMs: 240_000,
  /** the chip and the HUD count the last this long */
  lastMs: 30_000,
  /** the moment's line stays this long */
  momentMs: 3000,
  /** the cap's line */
  capLineMs: 2500,
  /** the game over with a call to work held: the agent says its line at the board this long, then goes (play.md 10.1: after the result's line) */
  leaveMs: 2500,
  /** the head turned toward the desk at the moment (s), and how far (deg) */
  lookS: 0.6,
  lookDeg: 25,
} as const

export const WORK_LINES = {
  moment: { omok: '일이 들어왔어요 · 이 판 끝나고 갈게요', pingpong: '일이 들어왔어요 · 이 경기 끝나고 갈게요' },
  cap: '미안해요, 일하러 가야 해요 · 다음에 또 둬요!',
  /** the result's line with the way to the desk added (play.md 10.3); the visitor leaving: no words */
  visitorWon: '졌어요! 이제 일하러 갈게요',
  agentWon: { omok: '제가 이겼네요 :) 일하러 갈게요', pingpong: '좋은 경기였어요! 일하러 갈게요' },
} as const

/** a call to work during the game: since when (office ms), and whether its moment has been shown */
export interface WorkHold {
  since: number
  told: boolean
  /** when the moment was shown (office ms): the chip follows once its line is over (play.md 10.2: 그 뒤 계속) */
  toldAt?: number
}

/** the chip shows after the moment's line (they would stand on each other beside the face screen) */
export const chipShown = (h: WorkHold | null, now: number) => !!h && h.toldAt !== undefined && now - h.toldAt >= WORK_HOLD.momentMs

/** where the hold is now: holding, in its last 30 s (with the seconds left), or past the cap */
export function holdPhase(h: WorkHold, now: number): { phase: 'hold' | 'last' | 'over'; leftMs: number } {
  const left = WORK_HOLD.capMs - (now - h.since)
  if (left <= 0) return { phase: 'over', leftMs: 0 }
  return { phase: left <= WORK_HOLD.lastMs ? 'last' : 'hold', leftMs: left }
}

/** m:ss, the seconds rounded up (0:30 … 0:01) */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** the chip's words (after the working dot) */
export function chipText(kind: GameKind, h: WorkHold, now: number): string {
  const p = holdPhase(h, now)
  if (p.phase !== 'hold') return `일하러 가요 · ${clock(p.leftMs)}`
  return kind === 'omok' ? '일 들어옴 · 이 판까지' : '일 들어옴 · 이 경기까지'
}

/** the HUD status line's added word */
export function hudBit(kind: GameKind, h: WorkHold, now: number): string {
  const p = holdPhase(h, now)
  if (p.phase !== 'hold') return `${clock(p.leftMs)} 뒤 일하러`
  return kind === 'omok' ? '이 판까지' : '이 경기까지'
}

/** 이/가 after a name (the last syllable's final consonant) */
export const iga = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return `${w}${c >= 0 && c < 11172 && c % 28 !== 0 ? '이' : '가'}`
}
/** 에게 for a screen reader's words at the moment */
export const momentSaid = (name: string) => `${name}에게 일이 들어왔어요. 이 판이 끝나면 책상으로 가요.`
/** the result line when the cap wound the game up */
export const capResult = (name: string) => `중단 · ${iga(name)} 일하러 감`
