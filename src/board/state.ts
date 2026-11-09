// The whiteboard's data (#66, docs/design/docs-ui.md section 3) as plain values, independent of where it comes from:
// the live library (boardFromLibrary) or the timelapse (foldBoard, #82 replays the board at any moment by folding
// points up to a time). Pure: layout.ts and draw.ts only ever see a BoardState.

import { decisionView, mainSeat, type DocBody, type DocFolder } from '../docs/library'
import type { Point, Seat } from '../timeline/types'

export const COLUMNS = ['doing', 'review', 'done'] as const
export type Column = (typeof COLUMNS)[number]
export const COLUMN_LABEL: Record<Column, string> = { doing: '진행 중', review: '검토', done: '완료' }

export interface BoardCard {
  /** `repo#n`: one card per issue */
  key: string
  repo: string
  n: number
  /** null = SECRET for this viewer: drawn as a black bar */
  title: string | null
  seat: Seat | null
  /** when the card last changed column or was opened (ISO); newest first within a column */
  at: string
}

export interface BoardDecision {
  key: string
  repo: string | null
  n: number | null
  /** the decision in one line */
  title: string
  /** supplement, or null */
  note: string | null
  at: string
}

export interface BoardState {
  /** every card of the column, newest first (the layout shows the newest four and a "+N") */
  doing: BoardCard[]
  review: BoardCard[]
  done: BoardCard[]
  /** newest first (the layout shows the newest three) */
  decisions: BoardDecision[]
}

export const emptyBoard = (): BoardState => ({ doing: [], review: [], done: [], decisions: [] })

const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at)
const SEATS = [0, 1, 2, 3, 4] as const
export const asSeat = (s: number | null | undefined): Seat | null => SEATS.find((x) => x === s) ?? null

/** "결정: 보충" -> big line + supplement (first ": " only) */
export function splitDecision(title: string): { title: string; note: string | null } {
  const i = title.indexOf(': ')
  return i > 0 && i < title.length - 2 ? { title: title.slice(0, i), note: title.slice(i + 2) } : { title, note: null }
}

// ---- live data -----------------------------------------------------------------------------------------------------

/**
 * The board from the library's files (what this role may see; nothing is filtered here, see library.ts coverOf).
 * The client has no issue / PR state, only which documents exist, so:
 *   완료    the file has a report (a merged PR's report)
 *   검토    no report yet, but a document still SECRET (waiting for the owner's approval)
 *   진행 중 everything else
 * `private` files are omitted (they have no number and no title for anyone); a SECRET `review` file keeps its number
 * and agent colour and shows a black bar instead of its title (docs-ui 2.3). Decisions: decision documents the viewer
 * can read; the sentence is the decision's chosen option when its body is loaded, else the file title.
 */
export function boardFromLibrary(folders: DocFolder[], bodies: Readonly<Record<number, DocBody>> = {}): BoardState {
  const out = emptyBoard()
  const decisions: BoardDecision[] = []
  for (const folder of folders) {
    for (const file of folder.files) {
      if (file.secret === 'private' || file.repo === null || file.n === null) continue
      const col: Column = file.docs.some((d) => d.kind === 'report') ? 'done' : file.secret === 'review' ? 'review' : 'doing'
      out[col].push({ key: file.key, repo: file.repo, n: file.n, title: file.secret ? null : file.title, seat: asSeat(mainSeat(file)), at: file.date })
      for (const d of file.docs) {
        if (d.kind !== 'decision' || !d.readable || !d.title) continue
        const view = bodies[d.id] ? decisionView(bodies[d.id].data) : null
        decisions.push({ key: `decision:${d.id}`, repo: file.repo, n: file.n, title: view?.text ?? d.title, note: view ? d.title : null, at: d.created_at })
      }
    }
  }
  for (const c of COLUMNS) out[c].sort(newestFirst)
  out.decisions = decisions.sort(newestFirst)
  return out
}

/** the newest readable decision documents' ids, so the caller can fetch their bodies for the notes */
export const decisionIds = (folders: DocFolder[], count = 3): number[] =>
  folders
    .flatMap((f) => f.files.flatMap((file) => (file.secret ? [] : file.docs.filter((d) => d.kind === 'decision' && d.readable))))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, count)
    .map((d) => d.id)

// ---- timelapse -----------------------------------------------------------------------------------------------------

/**
 * The board as it was at time `t` (ms since epoch or ISO), by folding the timeline's points (src/timeline/types.ts)
 * in time order. #82 calls this with the playhead's time; `project` limits it to one "owner/name" (the replay's
 * project picker), default all. Mapping, per issue (`repo#n`):
 *   plan (issue opened)              card appears in 진행 중 (title and seat from the plan point)
 *   approval "결재 요청 ..."         card moves to 검토 (waiting for the owner)
 *   approval "결재 ..." (the result) card goes back to 진행 중 (approved; work continues)
 *   work with issue + pr (merged)    card moves to 완료 (the PR that closes the issue; created if no plan point was seen)
 *   decision                         a note (newest three show); "a: b" splits into line + supplement
 * A card's seat is the latest point's seat that has one. Points without an issue number, SECRET points (their issue
 * and title are stripped when collected) and direct commits never make cards or notes. Points after `t` are ignored.
 */
export function foldBoard(points: readonly Point[], t: number | string, opts: { project?: string } = {}): BoardState {
  const limit = typeof t === 'number' ? t : Date.parse(t)
  const sorted = points.filter((p) => Date.parse(p.at) <= limit && (!opts.project || p.project === opts.project)).sort((a, b) => a.at.localeCompare(b.at))
  const cards = new Map<string, BoardCard & { col: Column }>()
  const decisions: BoardDecision[] = []
  for (const p of sorted) {
    if (p.secret) continue
    if (p.kind === 'decision') {
      const s = splitDecision(p.title)
      decisions.push({ key: p.key, repo: p.project, n: p.issue, title: s.title, note: s.note, at: p.at })
      continue
    }
    if (p.issue === null) continue
    const key = `${p.project}#${p.issue}`
    const moveTo: Column | null =
      p.kind === 'plan' ? 'doing' : p.kind === 'work' && p.pr !== null ? 'done' : p.kind === 'approval' ? (p.title.startsWith('결재 요청') ? 'review' : 'doing') : null
    const card = cards.get(key)
    if (!card) {
      if (p.kind !== 'plan' && !(p.kind === 'work' && p.pr !== null)) continue // only a plan (or a merged PR) opens a card
      cards.set(key, { key, repo: p.project, n: p.issue, title: p.title, seat: p.agent, at: p.at, col: moveTo! })
      continue
    }
    if (p.agent !== null) card.seat = p.agent
    // a finished card stays finished (a late approval comment must not reopen it)
    if (moveTo && moveTo !== card.col && card.col !== 'done') {
      card.col = moveTo
      card.at = p.at
    }
  }
  const out = emptyBoard()
  for (const { col, ...card } of cards.values()) out[col].push(card)
  for (const c of COLUMNS) out[c].sort(newestFirst)
  out.decisions = decisions.sort(newestFirst)
  return out
}
