// #4 notes 2b (office-ui.md 12.3 '에이전트 반응'): a robot that got a note walks to the cork board the next time it rests, looks at
// the note for 2 s (standing, no hand on it), nods and says '쪽지 고마워요'. Working, it puts it off; an hour after the note is
// pinned it lets it go without a reaction. Pure: the Director keeps the queue and the run, the scene draws the nod and the bubble.

export const NOTE_READ = {
  /** the cork board's stand (nav 'bulletin'), and the board on the north wall it turns to (office.glb surface_bulletin) */
  spot: 'bulletin',
  face: { x: 2.25, z: -4.06 },
  /** looking at it, s from arriving; then the nod and the words */
  lookS: 2,
  /** the nod and the bubble, then it is free again */
  thankS: 1.5,
  /** the bubble (the visitor's tab, as a snack's thanks) */
  line: '쪽지 고마워요',
  sayMs: 2500,
  /** a note not read within this long of being pinned passes without a reaction (ms) */
  waitMs: 60 * 60_000,
  /** the board's stand is taken and the walk does not end: give up after this long and try again later (ms) */
  walkMs: 60_000,
} as const

export const NOTE_LABEL = { walk: '쪽지 보러 가는 중', read: '쪽지 읽는 중' } as const

/** a note waiting for its robot: the note's id and when it was pinned (ms) */
export interface NoteWait {
  id: number
  at: number
}

/** one walk to the board: the notes it reads (all of this robot's waiting ones), when it set off, when it arrived (null on the way) */
export interface NoteRun {
  ids: number[]
  since: number
  t0: number | null
}

/** the waiting notes still worth a reaction at `now` */
export const stillWaiting = (q: readonly NoteWait[], now: number) => q.filter((n) => now - n.at <= NOTE_READ.waitMs)

/** s since arriving at the board, -1 on the way */
export const noteU = (r: NoteRun, now: number) => (r.t0 === null ? -1 : (now - r.t0) / 1000)

/** one step: the clock starts on arriving; done after the look and the thanks; a walk that never arrives is given up (to try again) */
export function stepNote(r: NoteRun, o: { now: number; arrived: boolean }): { run: NoteRun; done: boolean; giveUp: boolean } {
  const t0 = r.t0 ?? (o.arrived ? o.now : null)
  const run = t0 === r.t0 ? r : { ...r, t0 }
  if (t0 === null) return { run, done: false, giveUp: o.now - r.since >= NOTE_READ.walkMs }
  return { run, done: (o.now - t0) / 1000 >= NOTE_READ.lookS + NOTE_READ.thankS, giveUp: false }
}

/** the moment the thanks come (the nod, the bubble): crossing lookS */
export const thanksNow = (prevU: number, u: number) => prevU < NOTE_READ.lookS && u >= NOTE_READ.lookS
