// What the office does at the playhead (#82), as plain values the 3D scene reads each frame.

import type { Goal } from '../office/director'
import type { StatusMap } from '../office/status'
import { activityLabel } from '../office/status'
import { replay } from './store'

/** a deploy's mark stays on the door this long; the terminal line types at one character per this */
export const DEPLOY_MARK_MS = 2000
export const TYPE_MS = 40

/** every agent at their own desk: the one working types, the others sit (no play while replaying); `spots` puts one on the whiteboard to post a card */
export function replayGoals(status: StatusMap, spots: Record<string, string> = {}): Record<string, Goal> {
  const out: Record<string, Goal> = {}
  for (const [id, s] of Object.entries(status)) {
    const seat = Number(id.split('_')[1])
    if (spots[id] === 'whiteboard') {
      out[id] = { spot: 'whiteboard', pose: 'post', label: '작업 카드 붙이는 중' }
      continue
    }
    out[id] = s.state === 'working' ? { spot: `work_${seat}`, pose: 'type', label: activityLabel(s.activity) } : { spot: `work_${seat}`, pose: 'idle', label: '자리에서 기록을 보는 중' }
  }
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
