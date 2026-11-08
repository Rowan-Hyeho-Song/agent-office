// The timelapse's pure core (#82, docs/design/timelapse.md): which points play, where each sits on the bar, how long a
// step lasts, and what the office looks like at a point. The office state at a point is a pure function of
// (points, index): the board is foldBoard over the points up to it, the shelf holds one binder per issue seen so far,
// the approval tray holds the requests not yet answered, the agent of the point works at their desk. Seeking never
// depends on how the playhead got there.

import { foldBoard, type BoardState } from '../board/state'
import { shelfLayout, type DocFile, type DocFolder, type ShelfLayout } from '../docs/library'
import type { AgentStatus, StatusMap } from '../office/status'
import type { Point, PointKind, Seat } from '../timeline/types'

// ---- time (the project's dates are Seoul time, no DST) --------------------------------------------------------------

const KST_MS = 9 * 3_600_000
const DOW = ['일', '월', '화', '수', '목', '금', '토']
const p2 = (n: number) => String(n).padStart(2, '0')

export interface Kst {
  y: number
  m: number
  d: number
  h: number
  mi: number
  w: string
}
export function kst(ms: number): Kst {
  const d = new Date(ms + KST_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), w: DOW[d.getUTCDay()] }
}
export const atMs = (p: Point) => Date.parse(p.at)
/** `11.07` */
export const dayKey = (p: Point) => {
  const k = kst(atMs(p))
  return `${p2(k.m)}.${p2(k.d)}`
}
/** `2026.11.08 일 01:51` */
export const whenText = (ms: number) => {
  const k = kst(ms)
  return `${k.y}.${p2(k.m)}.${p2(k.d)} ${k.w} ${p2(k.h)}:${p2(k.mi)}`
}
/** `11.08 일` */
export const dayLabel = (ms: number) => {
  const k = kst(ms)
  return `${p2(k.m)}.${p2(k.d)} ${k.w}`
}

// ---- which points, in which order ----------------------------------------------------------------------------------

export const ALL = 'all'
export const shortName = (repo: string) => repo.split('/').pop() ?? repo
export const byTime = (a: Point, b: Point) => atMs(a) - atMs(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** the points of one project (or all), in play order: time, then key */
export function prepare(points: readonly Point[], project: string = ALL): Point[] {
  return points.filter((p) => project === ALL || p.project === project).sort(byTime)
}

/** the index of the last point at or before `t` (ms), or 0; -1 when there are no points */
export function indexAt(points: readonly Point[], t: number): number {
  if (!points.length) return -1
  let lo = 0
  let hi = points.length - 1
  if (atMs(points[0]) > t) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (atMs(points[mid]) <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** a project name from an address: `all`, the full `owner/name`, or just `name` */
export function projectFrom(value: string | null, projects: readonly string[]): string {
  if (!value || value === ALL) return ALL
  return projects.find((p) => p === value || shortName(p) === value) ?? ALL
}

/** the points of one issue, for "이 일의 이력 재생": its first and last point as indices into `points`, or null */
export function issueRange(points: readonly Point[], repo: string, n: number): { lo: number; hi: number } | null {
  let lo = -1
  let hi = -1
  points.forEach((p, k) => {
    if (p.project === repo && p.issue === n && !p.secret) {
      if (lo < 0) lo = k
      hi = k
    }
  })
  return lo < 0 ? null : { lo, hi }
}

// ---- the bar -------------------------------------------------------------------------------------------------------

export type Lane = 'o' | 0 | 1 | 2 | 3 | 'n'
/** top to bottom (timelapse.md 2.1) */
export const LANES: readonly Lane[] = ['o', 0, 1, 2, 3, 'n']
export const LANE_NAME: Record<Lane, string> = { o: '주인', 0: '메모', 1: '메시', 2: '휴', 3: '루프', n: '이전' }
export const AGENT_NAME: Record<Lane, string> = { o: '주인', 0: '메모', 1: '메시', 2: '휴', 3: '루프', n: '역할 분담 이전' }
export const KIND_NAME: Record<PointKind, string> = { plan: '기획서', work: '작업', minutes: '회의록', approval: '결재', decision: '결정', deploy: '배포' }

/** the owner's ✅ results go on the owner's lane; points before the roles were split on the last one */
export const laneOf = (p: Point): Lane => (p.kind === 'approval' && p.result ? 'o' : (p.agent ?? 'n'))
export const kindName = (p: Point) => KIND_NAME[p.kind] + (p.kind === 'approval' ? (p.result ? ' 결과' : ' 요청') : '')
/** a commit's size class: 0 under 50 lines, 1 under 500, 2 more */
export const sizeClass = (p: Point) => {
  const n = (p.additions ?? 0) + (p.deletions ?? 0)
  return n < 50 ? 0 : n < 500 ? 1 : 2
}

/** x of every point on the bar: by order, `step` apart, `gap` extra at a day change (plus 8 px margins) */
export function layoutX(points: readonly Point[], width: number, minStep: number, gap = 10) {
  const n = points.length
  const days = new Set(points.map(dayKey)).size
  const step = Math.max(minStep, n ? (width - 16 - Math.max(0, days - 1) * gap) / n : minStep)
  const xs: number[] = []
  let x = 8
  let prev: string | null = null
  for (const p of points) {
    const k = dayKey(p)
    if (prev && k !== prev) x += gap
    xs.push(x)
    x += step
    prev = k
  }
  return { xs, step, total: x + 8 }
}

// ---- how long ------------------------------------------------------------------------------------------------------

export const SPEEDS = [1, 4, 16] as const
export type Speed = (typeof SPEEDS)[number]
export const STEP_MS = 3000
export const MINUTES_MS = 4500
export const DAYBREAK_MS = 1000
/** a day change after a gap this long is a "day flip"; a midnight inside a work session only turns the date */
export const DAYBREAK_GAP_MS = 6 * 3_600_000

export const stepMs = (p: Point, speed: Speed) => (p.kind === 'minutes' ? MINUTES_MS : STEP_MS) / speed
export const daybreakMs = (speed: Speed) => DAYBREAK_MS / speed
export const isDaybreak = (a: Point, b: Point) => dayKey(a) !== dayKey(b) && atMs(b) - atMs(a) >= DAYBREAK_GAP_MS

/** the time left from point `i` at this speed, ms */
export function remainingMs(points: readonly Point[], i: number, speed: Speed): number {
  let ms = 0
  for (let k = Math.max(0, i); k < points.length; k++) {
    ms += stepMs(points[k], speed)
    if (k + 1 < points.length && isDaybreak(points[k], points[k + 1])) ms += daybreakMs(speed)
  }
  return ms
}

/** the date shown while it flips from `a` to `b`: a character at a time, left to right (`prog` 0..1) */
export function flipText(a: string, b: string, prog: number): string {
  const n = Math.min(a.length, b.length)
  const cut = Math.floor(Math.max(0, Math.min(1, prog)) * n)
  return b.slice(0, cut) + a.slice(cut, n)
}

// ---- the office at a point -----------------------------------------------------------------------------------------

export interface DoorLine {
  kind: 'deploy' | 'terminal'
  text: string
}

export interface Scene {
  index: number
  point: Point
  board: BoardState
  layout: ShelfLayout
  /** requests waiting for the owner (the IN tray) and who asked */
  pending: number
  waitingSeats: number[]
  /** the owner just answered: the stamp falls */
  stamped: boolean
  /** statuses of the four agents */
  status: StatusMap
  /** the door screen's line (deploy mark / the terminal line of a point before roles) */
  door: DoorLine | null
  /** a minutes point: the meeting replays */
  meeting: boolean
}

const ACTIVITY: Partial<Record<PointKind, string>> = { work: 'edit', plan: 'think', decision: 'think', approval: 'think' }

/** the agent's status at a point: the point's own agent works (a SECRET point as "비공개 작업 중"), the others rest */
export function statusAt(p: Point): StatusMap {
  const since = atMs(p)
  const out: StatusMap = {}
  for (const seat of [0, 1, 2, 3]) {
    const working = p.agent === seat && !(p.kind === 'approval' && p.result) && p.kind in ACTIVITY
    out[`agent_${seat}`] = working
      ? ({ state: 'working', activity: p.secret ? 'private' : ACTIVITY[p.kind], since } satisfies AgentStatus)
      : ({ state: 'idle', since } satisfies AgentStatus)
  }
  return out
}

/** the approval tray after the points up to `i`: requests minus results, oldest answered first */
export function approvalsAt(points: readonly Point[], i: number): { pending: number; seats: number[] } {
  const waiting: Point[] = []
  for (let k = 0; k <= i; k++) {
    const p = points[k]
    if (p.kind !== 'approval') continue
    if (!p.result) waiting.push(p)
    else {
      // a result answers the oldest request of its issue (or of its project when the issue is not known)
      const at = waiting.findIndex((r) => r.project === p.project && (p.issue === null || r.issue === null || r.issue === p.issue))
      if (at >= 0) waiting.splice(at, 1)
    }
  }
  return { pending: waiting.length, seats: waiting.flatMap((r) => (r.agent === null ? [] : [r.agent])) }
}

/** the bookshelf after the points up to `i`: one binder per issue seen (SECRET points have no issue: no binder) */
export function shelfAt(points: readonly Point[], i: number): ShelfLayout {
  const folders = new Map<string, Map<number, { at: string; seat: Seat | null; title: string; kind: PointKind }>>()
  for (let k = 0; k <= i; k++) {
    const p = points[k]
    if (p.secret || p.issue === null) continue
    const files = folders.get(p.project) ?? new Map()
    folders.set(p.project, files)
    const f = files.get(p.issue)
    files.set(p.issue, { at: p.at, seat: p.agent ?? f?.seat ?? null, title: f && p.kind !== 'plan' ? f.title : p.title, kind: p.kind })
  }
  const seats = new Map<string, Seat | null>()
  const list: DocFolder[] = [...folders].map(([repo, files]) => {
    const docFiles: DocFile[] = [...files].map(([n, f]) => {
      const key = `${repo}#${n}`
      seats.set(key, f.seat)
      return { key, repo, n, docs: [], title: f.title, secret: null, seats: f.seat === null ? [] : [f.seat], date: f.at }
    })
    const latest = docFiles.reduce((m, f) => (f.date > m ? f.date : m), '')
    return { key: repo, repo, label: shortName(repo), files: docFiles, latest }
  })
  list.sort((a, b) => b.latest.localeCompare(a.latest))
  const layout = shelfLayout(list)
  return { ...layout, binders: layout.binders.map((b) => ({ ...b, seat: seats.get(b.fileKey) ?? null })) }
}

/** the door's line for the point */
export function doorFor(p: Point): DoorLine | null {
  if (p.kind === 'deploy') return { kind: 'deploy', text: p.project.endsWith('/rowansong.dev') ? 'ROWAN/OS 배포' : 'DEPLOYED ▲ main' }
  if (p.agent === null && p.kind === 'work') {
    const size = `+${p.additions ?? 0} −${p.deletions ?? 0} · 파일 ${p.files ?? 0}`
    return { kind: 'terminal', text: `> commit · ${size}${p.title ? ` · ${p.title}` : ''}` }
  }
  return null
}

/** The office at point `i` of `points` (see the top of the file). */
export function sceneAt(points: readonly Point[], i: number): Scene {
  const index = Math.max(0, Math.min(points.length - 1, i))
  const point = points[index]
  const { pending, seats } = approvalsAt(points, index)
  return {
    index,
    point,
    // foldBoard takes the points up to a time; handing it exactly the points up to `index` makes equal timestamps unambiguous
    board: foldBoard(points.slice(0, index + 1), atMs(point)),
    layout: shelfAt(points, index),
    pending,
    waitingSeats: seats,
    stamped: point.kind === 'approval' && point.result === true,
    status: statusAt(point),
    door: doorFor(point),
    meeting: point.kind === 'minutes',
  }
}

// ---- words ---------------------------------------------------------------------------------------------------------

export const SECRET_NOTE = '결재 전이라 제목을 가렸어요'

/** `+198 −8 · 파일 7` for a commit point, '' otherwise */
export const sizeText = (p: Point) => (p.kind === 'work' && p.additions !== null ? `+${p.additions} −${p.deletions ?? 0} · 파일 ${p.files ?? 0}` : '')

/** a deploy is the owner merging dev into main: no agent, not "before roles" */
export const isDeploy = (p: Point) => p.kind === 'deploy'

/** `배포 #106 · dev → main` from the merge commit's title; `배포 · dev → main` when it names no PR */
export function deployTitle(p: Point): string {
  const pr = /#(d+)/.exec(p.title)?.[1] ?? (p.pr === null ? null : String(p.pr))
  return `배포${pr ? ` #${pr}` : ''} · dev → main`
}

/** who did it: an agent's name, the owner's mark, or "▲ 배포" for a deploy (no kind word after it) */
export const whoName = (p: Point) => (isDeploy(p) ? '▲ 배포' : AGENT_NAME[laneOf(p)])
export const kindWord = (p: Point) => (isDeploy(p) ? '' : kindName(p))
/** `메모 · 작업` or `▲ 배포` */
export const whoKind = (p: Point) => (isDeploy(p) ? '▲ 배포' : `${whoName(p)} · ${kindName(p)}`)

/** the same sentence for the subtitle (screen reading uses it as the slider's text too) */
export function describe(p: Point): { who: string; kind: string; title: string; size: string; head: string } {
  return { who: whoName(p), kind: kindWord(p), head: whoKind(p), title: p.secret ? SECRET_NOTE : isDeploy(p) ? deployTitle(p) : p.title, size: sizeText(p) }
}

/** `121번째 점, 2026.11.08 일 01:51, 루프, 작업: 신호 통로 …, 줄 1406개 더함 37개 뺌, 파일 22개` */
export function valueText(points: readonly Point[], i: number): string {
  const p = points[i]
  if (!p) return ''
  const d = describe(p)
  const lines = p.kind === 'work' && p.additions !== null ? `, 줄 ${p.additions}개 더함 ${p.deletions ?? 0}개 뺌, 파일 ${p.files ?? 0}개` : ''
  return `${i + 1}번째 점, ${whenText(atMs(p))}, ${isDeploy(p) ? d.head : `${d.who}, ${d.kind}`}${d.title ? `: ${d.title}` : ''}${lines}`
}
