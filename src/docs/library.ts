// What the library viewer shows (#65, docs/design/docs-ui.md section 2), as pure functions: what a visitor / the owner
// is allowed to see of a document (the same rules as supabase/docs.sql docs_cover), the folders and files, the
// minutes as a conversation, the stable address of a minutes row and the bookshelf's binders. The components only draw.

import { topicsOf, type TopicId } from './topics.js'
import type { ApprovalRequest, ApprovalResult, DocKind, Grade, Minutes, Speaker } from './types.js'

/** a document as the viewer lists it: no body (read on demand). Redacted for who is asking, see coverOf / ownerMeta */
export interface DocMeta {
  id: number
  kind: DocKind
  /** null for `private`: not even the project name */
  repo: string | null
  /** the issue number; null for `private` */
  folder: number | null
  /** null while SECRET for this viewer, and always null for `private` */
  title: string | null
  agents: number[]
  /** the issue's GitHub labels (#236); [] while the title is hidden, like the title: topic info is not for a SECRET */
  labels: string[]
  grade: Grade
  approved: boolean
  /** this viewer gets the body (visitors: public + approved; the owner: everything but private) */
  readable: boolean
  created_at: string
  updated_at: string
}

/** the body of a readable document (what /api/docs stored) */
export interface DocBody {
  id: number
  body: string
  /** parsed structure: Minutes[] for minutes (data.minutes), ApprovalResult (+ request) for decisions */
  data: Record<string, unknown>
  source_url: string
}

/** the stored row's columns that decide what is visible (supabase/docs.sql) */
export type CoverSource = Pick<DocMeta, 'id' | 'kind' | 'repo' | 'folder' | 'title' | 'agents' | 'grade' | 'approved' | 'created_at' | 'updated_at'> & {
  /** the plan's GitHub labels (docs.data.labels); absent on rows that have none */
  labels?: unknown
}

const HIDDEN = { repo: null, folder: null, title: null } as const

/** whatever the server sent as labels (jsonb) -> only the strings */
export const stringsOnly = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * What a visitor may know of any document: the docs_cover view. A SECRET one shows no title, a `private` one not even
 * its project or file. Mirrors the SQL view (the server is the lock; this keeps the debug fake honest and is tested).
 */
export function coverOf(row: CoverSource): DocMeta {
  const priv = row.grade === 'private'
  const readable = row.grade === 'public' && row.approved
  return {
    id: row.id,
    kind: row.kind,
    ...(priv ? HIDDEN : { repo: row.repo, folder: row.folder, title: readable ? row.title : null }),
    agents: row.agents,
    labels: readable ? stringsOnly(row.labels) : [],
    grade: row.grade,
    approved: row.approved,
    readable,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** the owner reads the table (RLS: is_owner): review documents in full, `private` still only as a cover */
export function ownerMeta(row: CoverSource): DocMeta {
  if (row.grade === 'private') return coverOf(row)
  return { ...coverOf(row), repo: row.repo, folder: row.folder, title: row.title, labels: stringsOnly(row.labels), readable: true }
}

// ---- table of contents ---------------------------------------------------------------------------------------------

/** 기획서 → 회의록 → 결정 → 보고서; worklogs are not shown here */
export const TOC: { kind: DocKind; label: string }[] = [
  { kind: 'plan', label: '기획서' },
  { kind: 'minutes', label: '회의록' },
  { kind: 'decision', label: '결정' },
  { kind: 'report', label: '보고서' },
]
export const KIND_NAME: Partial<Record<DocKind, string>> = Object.fromEntries(TOC.map((t) => [t.kind, t.label]))
const tocIndex = (k: DocKind) => TOC.findIndex((t) => t.kind === k)

// ---- folders and files ---------------------------------------------------------------------------------------------

export const PRIVATE_LABEL = '비공개 프로젝트'
export const PRIVATE_KEY = 'private'

export interface DocFile {
  /** `repo#n`, or `private:<id>` (every private document is its own file) */
  key: string
  repo: string | null
  n: number | null
  /** in table-of-contents order (a kind may repeat: several decisions), then oldest first */
  docs: DocMeta[]
  /** the first readable title (plan first); null = hidden from this viewer */
  title: string | null
  /** SECRET for everyone's eyes: some document is not approved yet (the binder keeps its stamp until then) */
  secret: 'review' | 'private' | null
  seats: number[]
  /** up to two topics for the badges: from the plan (the issue) when it has any, else the first document that does */
  topics: TopicId[]
  /** newest document's time */
  date: string
}

export interface DocFolder {
  /** repo, or PRIVATE_KEY */
  key: string
  repo: string | null
  label: string
  files: DocFile[]
  /** newest file's time */
  latest: string
}

const shortRepo = (repo: string) => repo.split('/').pop() ?? repo
const byTocThenTime = (a: DocMeta, b: DocMeta) => tocIndex(a.kind) - tocIndex(b.kind) || a.created_at.localeCompare(b.created_at) || a.id - b.id
const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b)

/** `sorted` is in table-of-contents order, so the plan (the issue, which carries the labels) speaks first. A document whose title and labels are hidden from this viewer has nothing to read. */
function fileTopics(sorted: DocMeta[]): TopicId[] {
  for (const d of sorted) {
    const t = topicsOf(d.labels, d.title)
    if (t.length) return t
  }
  return []
}

function makeFile(key: string, docs: DocMeta[]): DocFile {
  const sorted = [...docs].sort(byTocThenTime)
  const priv = sorted.some((d) => d.grade === 'private')
  return {
    key,
    repo: sorted[0].repo,
    n: sorted[0].folder,
    docs: sorted,
    title: sorted.find((d) => d.title)?.title ?? null,
    secret: priv ? 'private' : sorted.some((d) => !d.approved) ? 'review' : null,
    seats: uniqSorted(sorted.flatMap((d) => d.agents)),
    topics: fileTopics(sorted),
    date: sorted.reduce((m, d) => (d.created_at > m ? d.created_at : m), ''),
  }
}

/**
 * Folders (a repo each; every `private` document collapses into one "비공개 프로젝트" folder) → files (an issue each) →
 * documents. Folders newest first; files newest first within a folder.
 */
export function groupLibrary(metas: DocMeta[]): DocFolder[] {
  const files = new Map<string, DocMeta[]>()
  for (const d of metas) {
    if (!TOC.some((t) => t.kind === d.kind)) continue // worklogs are not shown here
    const key = d.grade === 'private' || d.repo === null || d.folder === null ? `${PRIVATE_KEY}:${d.id}` : `${d.repo}#${d.folder}`
    files.set(key, [...(files.get(key) ?? []), d])
  }
  const folders = new Map<string, DocFolder>()
  for (const [key, docs] of files) {
    const file = makeFile(key, docs)
    const fk = file.repo === null ? PRIVATE_KEY : file.repo
    const folder = folders.get(fk) ?? { key: fk, repo: file.repo, label: file.repo === null ? PRIVATE_LABEL : shortRepo(file.repo), files: [], latest: '' }
    folder.files.push(file)
    if (file.date > folder.latest) folder.latest = file.date
    folders.set(fk, folder)
  }
  for (const f of folders.values()) f.files.sort((a, b) => b.date.localeCompare(a.date) || (b.n ?? 0) - (a.n ?? 0))
  return [...folders.values()].sort((a, b) => b.latest.localeCompare(a.latest))
}

// ---- the bookshelf (Blender #67 node table) -------------------------------------------------------------------------

export const SHELVES = 3
export const SLOTS = 10
/** the last binder of a shelf leans toward the empty side, about the world z axis */
export const LEAN_DEG = -8

export interface Binder {
  /** node name of the binder body; `_band`, `_label`, `_secret` share the stem */
  node: string
  r: number
  k: number
  fileKey: string
  repo: string | null
  n: number | null
  secret: boolean
  /** the folder's main agent seat, null = no agents known */
  seat: number | null
  /** what the label shows */
  label: string
  lean: boolean
}

export interface ShelfLayout {
  binders: Binder[]
  /** the folder name plate of each shelf (index = r); '' = empty shelf */
  plates: string[]
  /** shown in the viewer when the shelf could not hold everything */
  note: string | null
}

/** the seat that appears most among the file's agents (ties → the lower seat), null if none */
export function mainSeat(file: Pick<DocFile, 'docs'>): number | null {
  const count = new Map<number, number>()
  for (const d of file.docs) for (const s of d.agents) count.set(s, (count.get(s) ?? 0) + 1)
  let best: number | null = null
  for (const [s, c] of count) if (best === null || c > count.get(best)! || (c === count.get(best) && s < best)) best = s
  return best
}

/**
 * Folders → shelves (the newest three folders, newest on the bottom shelf r0), files → binders left to right
 * (the newest ten of a folder, oldest first, so the newest is the last one and leans).
 */
export function shelfLayout(folders: DocFolder[]): ShelfLayout {
  const binders: Binder[] = []
  const plates = Array.from({ length: SHELVES }, () => '')
  let cut = false
  // private projects never stand on the shelf (#67): not their count, not their agents' band colours
  const shelved = folders.filter((f) => f.repo !== null)
  shelved.slice(0, SHELVES).forEach((folder, r) => {
    plates[r] = folder.label
    const files = [...folder.files].sort((a, b) => a.date.localeCompare(b.date) || (a.n ?? 0) - (b.n ?? 0))
    if (files.length > SLOTS) cut = true
    const shown = files.slice(-SLOTS)
    shown.forEach((file, k) => {
      binders.push({
        node: `shelf_r${r}_b${k}`,
        r,
        k,
        fileKey: file.key,
        repo: file.repo,
        n: file.n,
        secret: file.secret !== null,
        seat: mainSeat(file),
        label: file.n === null ? '' : `#${file.n}`,
        lean: k === shown.length - 1,
      })
    })
  })
  if (shelved.length > SHELVES) cut = true
  return { binders, plates, note: cut ? `책장엔 최근 폴더 ${SHELVES}개, 폴더마다 최근 ${SLOTS}권만 꽂혀요. 나머지는 이 목록에서 볼 수 있어요.` : null }
}

export const LABEL_GRID = { cols: 10, rows: 3, w: 640, h: 384 }

/** the label's cell in the shared canvas: pixels, and the UV range (flipY = false, canvas row 0 = top = r0) */
export function labelCell(k: number, r: number) {
  const { cols, rows, w, h } = LABEL_GRID
  const cw = w / cols
  const ch = h / rows
  return { x: k * cw, y: r * ch, w: cw, h: ch, u0: k / cols, u1: (k + 1) / cols, v0: r / rows, v1: (r + 1) / rows }
}

// ---- reading a document ---------------------------------------------------------------------------------------------

export interface Section {
  heading: string | null
  text: string
}

/** an issue form / PR template body → its `## ` sections (text before the first heading has no heading) */
export function sections(markdown: string): Section[] {
  const out: Section[] = []
  let cur: Section = { heading: null, text: '' }
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^## (?!#)\s*(.*?)\s*$/.exec(line)
    if (m) {
      out.push(cur)
      cur = { heading: m[1], text: '' }
    } else cur.text += `${line}\n`
  }
  out.push(cur)
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.heading !== null || s.text)
}

/** the paper's markdown: checked / open boxes as ✓ / ☐, image lines dropped (the paper has no pictures) */
export function paperText(src: string): string {
  return src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^(\s*)[-*] \[[xX]\] /gm, '$1- ✓ ')
    .replace(/^(\s*)[-*] \[ \] /gm, '$1- ☐ ')
}

const SEAT_NAME: Record<number, [ko: string, tag: string]> = { 0: ['메모', 'MEMO'], 1: ['메시', 'MESH'], 2: ['휴', 'HUE'], 3: ['루프', 'LOOP'], 4: ['에코', 'ECHO'] } // world.ts AGENT_INFO

export interface Who {
  /** the CSS data-seat: '0'..'3', 'x' (unknown name) or 'owner' */
  seat: string
  /** the name tag, e.g. HUE, ROWAN */
  tag: string
  /** the plain Korean name for "→ 휴" and screen readers */
  ko: string
}

export function whoOf(s: Speaker): Who {
  if ('owner' in s) return { seat: 'owner', tag: 'ROWAN', ko: '사용자' }
  if ('seat' in s) return { seat: String(s.seat), tag: SEAT_NAME[s.seat][1], ko: SEAT_NAME[s.seat][0] }
  return { seat: 'x', tag: s.name, ko: s.name }
}

export interface Utterance {
  /** the row's stable address inside the document: `<block>-<순서>`, block counted from 1 */
  key: string
  from: Who
  to: Who[]
  text: string
  owner: boolean
}
export interface Conversation {
  date: string | null
  lines: Utterance[]
  decision: string | null
  followUp: string | null
}

/** the stored `data.minutes` → conversations; one 협의 기록 table row = one utterance. Anything malformed is skipped */
export function conversations(data: Record<string, unknown>): Conversation[] {
  const blocks = Array.isArray(data.minutes) ? (data.minutes as Minutes[]) : []
  return blocks.map((m, b) => ({
    date: m.date ?? null,
    decision: m.decision ?? null,
    followUp: m.followUp ?? null,
    lines: (Array.isArray(m.rows) ? m.rows : []).map((row) => ({
      key: `${b + 1}-${row.order}`,
      from: whoOf(row.from),
      to: row.to.map(whoOf),
      text: row.text,
      owner: 'owner' in row.from,
    })),
  }))
}

export interface DecisionView {
  /** the decision, in one sentence: the chosen option, else what was asked */
  text: string
  why: string | null
  /** 승인 | 반려 | 선택지 N … as written */
  result: string
  date: string | null
}

export function decisionView(data: Record<string, unknown>): DecisionView | null {
  const r = data.result as ApprovalResult | undefined
  if (!r || typeof r.result !== 'string') return null
  const q = (data.request ?? null) as ApprovalRequest | null
  const chosen = r.option !== null && q ? q.options[r.option - 1] : undefined
  const asked = q?.content.split('\n').find((l) => l.trim()) ?? ''
  return { text: chosen ?? (asked || r.result), why: r.opinion ?? q?.reason ?? null, result: r.result, date: r.date }
}

// ---- addresses ------------------------------------------------------------------------------------------------------

/** where the viewer is: a file (repo + issue number) or a private document (id), a document kind, a minutes row */
export interface Ref {
  repo?: string
  n?: number
  id?: number
  kind?: DocKind
  row?: string
}

const ROW = /^\d+-\d+$/

/** `#library/owner/name/28/minutes/1-3`; null for a private document (it has no address of its own) */
export function formatRef(ref: Ref): string | null {
  if (!ref.repo || !ref.n) return null
  return `#library/${ref.repo}/${ref.n}${ref.kind ? `/${ref.kind}${ref.row ? `/${ref.row}` : ''}` : ''}`
}

export function parseRef(hash: string): Ref | null {
  const m = /^#?library\/(\w[\w.-]*\/\w[\w.-]*)\/(\d+)(?:\/(plan|minutes|decision|report)(?:\/(\d+-\d+))?)?$/.exec(hash)
  if (!m) return null
  const n = Number(m[2])
  if (!Number.isSafeInteger(n) || n < 1) return null
  return { repo: m[1], n, ...(m[3] ? { kind: m[3] as DocKind } : {}), ...(m[4] && ROW.test(m[4]) ? { row: m[4] } : {}) }
}

// ---- where the viewer stands ------------------------------------------------------------------------------------------

export interface Sel {
  fileKey: string | null
  kind: DocKind | null
  row: string | null
}

/** where an address lands in the current folders: its file (or the newest), its document kind and minutes row */
export function landOn(folders: DocFolder[], ref: Ref | null): Sel {
  const files = folders.flatMap((f) => f.files)
  const file =
    (ref?.id !== undefined ? files.find((f) => f.docs.some((d) => d.id === ref.id)) : undefined) ??
    (ref?.n !== undefined ? files.find((f) => f.n === ref.n && (!ref.repo || f.repo === ref.repo)) : undefined) ??
    folders[0]?.files[0] ??
    null
  const kind = (ref?.id !== undefined ? file?.docs.find((d) => d.id === ref.id)?.kind : ref?.kind) ?? null
  return { fileKey: file?.key ?? null, kind: kind && file?.docs.some((d) => d.kind === kind) ? kind : null, row: ref?.row ?? null }
}
