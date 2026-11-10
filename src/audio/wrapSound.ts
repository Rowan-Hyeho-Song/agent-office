// The wrap-up's card sound (#229, docs/design/wrapup.md 5: "카드 누름만 작은 '톡'(종이)"): a card pressed onto the
// board. The hands follow the director's beats (wrap.ts, wrapPose.ts); the press moments sit at fixed points of them,
// so the sound listens to the beat each frame (world.goals) and nothing in the office code has to call it.
//  - `press` (posting): the thumb base meets the card as the beat starts
//  - `move`: the card is pressed in its new cell at 0.85 of the beat
//  - `swap`: A pressed in B's place at 0.62, B in A's at 0.95
// Pen scratching is left out on purpose (wrapup.md 5: too frequent).

export type BeatLike = { kind: string; u: number; k: number }

/** where in each beat a card meets the board (u, 0..1) */
export const PRESS_AT: Record<string, readonly number[]> = { press: [0], move: [0.85], swap: [0.62, 0.95] }

/**
 * the press points crossed between the last frame's beat and this one (pure, tested): indexes into PRESS_AT[kind].
 * A new beat (another kind or card) starts from before its 0, so a press at its very start is not missed; a frame that
 * jumps backwards (a seek) sounds nothing.
 */
export function pressesBetween(prev: BeatLike | null | undefined, cur: BeatLike | null | undefined): number[] {
  if (!cur) return []
  const at = PRESS_AT[cur.kind]
  if (!at) return []
  const same = !!prev && prev.kind === cur.kind && prev.k === cur.k
  const from = same ? prev!.u : -1
  if (same && cur.u < from) return []
  return at.flatMap((p, i) => (from < p && cur.u >= p ? [i] : []))
}
