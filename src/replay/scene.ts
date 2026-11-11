// What the office does at the playhead (#82), as plain values the 3D scene reads each frame.

import type { Goal } from '../office/director'
import { replay } from './store'

/** a deploy's mark stays on the door this long; the terminal line types at one character per this */
export const DEPLOY_MARK_MS = 2000
export const TYPE_MS = 40

/**
 * The goals of the replayed office (timelapse.md 12.1): the day's own (the working ones at their desks typing, the others on the play / rest / night
 * schedule at the replay time: `life`, from a Director of the replay's own) with `spots` putting a plan point's agent on the whiteboard to post a card.
 */
export function replayGoals(life: Record<string, Goal>, spots: Record<string, string> = {}): Record<string, Goal> {
  const out: Record<string, Goal> = { ...life }
  for (const id of Object.keys(life)) if (spots[id] === 'whiteboard') out[id] = { spot: 'whiteboard', pose: 'post', label: '작업 카드 붙이는 중' }
  return out
}

/** the door screen's line for the current point at replay clock `now` (ms), or null */
export function replayDoorLine(now: number): { text: string; masked: boolean } | null {
  const door = replay.scene()?.door
  if (!door) return null
  const age = now - replay.landedClock
  if (door.kind === 'deploy') return age < DEPLOY_MARK_MS ? { text: door.text, masked: false } : null
  return { text: [...door.text].slice(0, Math.floor(age / TYPE_MS) + 1).join(''), masked: false }
}

// ---- a minutes point plays a short meeting --------------------------------------------------------------------------

import type { DocMeta } from '../docs/library'
import { buildScript, type MeetingScript, type RowBase } from '../office/meeting'
import { modeOf, planScript } from '../office/minutes'
import type { Point } from '../timeline/types'

/** every row of the minutes table, untimed (timelapse.md 11.1) */
export function rowsOf(script: MeetingScript): RowBase[] {
  return script.lines.map(({ startMs: _s, typeMs: _t, holdMs: _h, pass: _p, gap: _g, readAt: _r, ...l }) => l)
}

/**
 * The library's document of a minutes point (#414): the minutes of that issue filed from the same comment, which the library dates
 * with the comment's time, as the point is. An issue with several minutes comments has one document each: matching by the issue
 * alone played the first one's rows for every point. undefined when the library has none (a point with no issue, or not loaded).
 */
export function minutesDocOf(metas: readonly DocMeta[] | null | undefined, p: Point): DocMeta | undefined {
  if (p.issue === null || !metas) return undefined
  const at = Date.parse(p.at)
  return metas.find((m) => m.kind === 'minutes' && m.repo === p.project && m.folder === p.issue && Math.abs(Date.parse(m.created_at) - at) < 1000)
}

/** the cover of a minutes point when the library has no such document: an invented scene, the words as bars */
export function coverMeta(p: Point): DocMeta {
  let id = 0
  for (const c of p.key) id = (id * 31 + c.charCodeAt(0)) >>> 0
  return {
    id: id % 1_000_000_007, kind: 'minutes', repo: p.secret ? null : p.project, folder: p.issue, title: null,
    agents: p.agent === null ? [] : [p.agent], labels: [], grade: 'review', approved: false, readable: false, created_at: p.at, updated_at: p.at,
  }
}

/**
 * The script to play for a minutes point (timelapse.md 11): EVERY row of its table in table order, timed for `speed`; `meta` is the
 * library's document of that issue when there is one. No decision pin and no follow-ups: a point is its rows, not a whole meeting.
 */
export function scriptFor(p: Point, meta: DocMeta | undefined, convs: Parameters<typeof buildScript>[1], reduced: boolean, speed = 1): MeetingScript {
  const full = buildScript(meta ?? coverMeta(p), meta ? convs : null, { reduced, maxLines: Infinity })
  const rows = rowsOf(full)
  return planScript({ ...full, decision: null, followUps: [], minutes: { mode: modeOf(rows), speed, rows } }, { speed, reduced })
}
