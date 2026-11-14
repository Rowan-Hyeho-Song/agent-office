// The finished files of a project folder, grouped by the deploy that shipped them (#462, docs/design/docs-ui.md 2.6). The
// deploys are the timelapse's `deploy` points (a merge into main, titled by its PR: 'release: v1.1.0 — 요약' or the older
// 'deploy: dev → main (2026-11-10 3차) — 요약'). This time a file goes by time: the first deploy at or after it was done
// (progress.doneAt: the issue's close, else its closing PR's merge); none yet = 다음 배포 대기. A project with no deploy at all
// is grouped by the month it was done. Pure, so it is unit tested; the viewer only draws, and remembers what was folded.

import type { DocFile } from './library.js'
import { viewFiles, type ListView } from './progressList.js'

export interface Deploy {
  /** the point's key (unique across projects: the commit's address) */
  key: string
  project: string
  /** the merge into main, ISO */
  at: string
  pr: number | null
  /** '1.1.0' from the title (the release's tag: deploy.md, #465); null before v1.0.0 */
  version: string | null
  /** what the title's brackets add after the date: '2차', '핫픽스'; '' without */
  suffix: string
  /** the title after its ' — ': one line under the header; '' without */
  summary: string
}

/** a deploy point as the timeline table / the bundled copies have it (a SECRET point has no title) */
export interface DeployPoint {
  key: string
  project: string
  at: string
  title: string
  pr: number | null
  secret?: boolean
}

const VERSION = /(?:^|[\s:(])v(\d+\.\d+\.\d+)(?![\w.])/
const SUFFIX = /\(\s*\d{4}-\d{2}-\d{2}\s+([^)]*?)\s*\)/

export function parseDeploy(p: DeployPoint): Deploy {
  const title = p.secret ? '' : String(p.title ?? '')
  const cut = title.indexOf(' — ')
  const head = cut < 0 ? title : title.slice(0, cut)
  return {
    key: p.key,
    project: p.project,
    at: p.at,
    pr: p.secret ? null : (p.pr ?? null),
    version: VERSION.exec(head)?.[1] ?? null,
    suffix: SUFFIX.exec(head)?.[1] ?? '',
    summary: cut < 0 ? '' : title.slice(cut + 3).trim(),
  }
}

// ---- dates (Seoul, as the deploy titles) ----------------------------------------------------------------------------

const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000)
const p2 = (n: number) => String(n).padStart(2, '0')
/** '11.15' */
export const kstDot = (iso: string) => `${p2(kst(iso).getUTCMonth() + 1)}.${p2(kst(iso).getUTCDate())}`
/** '11월 15일' (for screen readers) */
export const kstSpoken = (iso: string) => `${kst(iso).getUTCMonth() + 1}월 ${kst(iso).getUTCDate()}일`
/** '2026-11' */
export const kstMonth = (iso: string) => `${kst(iso).getUTCFullYear()}-${p2(kst(iso).getUTCMonth() + 1)}`

// ---- the groups -----------------------------------------------------------------------------------------------------

export type DoneGroup =
  | { kind: 'next'; key: string; files: DocFile[] }
  | { kind: 'deploy'; key: string; deploy: Deploy; files: DocFile[] }
  | { kind: 'month'; key: string; month: string; files: DocFile[] }

export interface Grouped {
  /** 지금 하는 일: everything not done (2.5's order); empty under the 완료 filter */
  now: DocFile[]
  /** 다음 배포 대기, then the deploys (or months), newest first; empty groups left out */
  done: DoneGroup[]
}

/** when the file was done: the pipeline's doneAt, else (sent before #462, or guessed) its newest document */
export const doneAtOf = (f: Pick<DocFile, 'progress' | 'date'>) => f.progress.doneAt ?? f.date

const ms = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}
const newer = (a: DocFile, b: DocFile) => ms(doneAtOf(b)) - ms(doneAtOf(a)) || (b.n ?? 0) - (a.n ?? 0)
const recent = (a: DocFile, b: DocFile) => b.date.localeCompare(a.date) || (b.n ?? 0) - (a.n ?? 0)
const byNumber = (a: DocFile, b: DocFile) => (b.n ?? -1) - (a.n ?? -1) || recent(a, b)

/** inside a group: the newest done first, or the sort the viewer picked */
const sortDone = (files: DocFile[], sort: ListView['sort']) => files.sort(sort === 'number' ? byNumber : sort === 'recent' ? recent : newer)

/**
 * The folder's files in groups, or null when the view is a flat list (진행 중 · 검토 · 대기 · 결재 대기만: no finished files to
 * group). `deploys` may hold other projects' and come in any order; `repo` picks this folder's (null: the private folder,
 * which has none, so months).
 */
export function groupFiles(files: readonly DocFile[], deploys: readonly Deploy[], repo: string | null, v: ListView): Grouped | null {
  if (v.pendingOnly || (v.stage !== 'all' && v.stage !== 'done')) return null
  const now = v.stage === 'all' ? viewFiles(files.filter((f) => f.progress.stage !== 'done'), v) : []
  const done = files.filter((f) => f.progress.stage === 'done')
  const mine = repo === null ? [] : deploys.filter((d) => d.project.toLowerCase() === repo.toLowerCase()).sort((a, b) => ms(a.at) - ms(b.at))
  const key = repo ?? 'private'
  const out: DoneGroup[] = []
  if (mine.length) {
    const next: DocFile[] = []
    const by = new Map<Deploy, DocFile[]>()
    for (const f of done) {
      const t = ms(doneAtOf(f))
      const d = mine.find((x) => ms(x.at) >= t)
      if (!d) next.push(f)
      else by.set(d, [...(by.get(d) ?? []), f])
    }
    if (next.length) out.push({ kind: 'next', key: `next:${key}`, files: sortDone(next, v.sort) })
    for (const d of [...mine].reverse()) {
      const list = by.get(d)
      if (list) out.push({ kind: 'deploy', key: d.key, deploy: d, files: sortDone(list, v.sort) })
    }
  } else {
    const by = new Map<string, DocFile[]>()
    for (const f of done) {
      const m = kstMonth(doneAtOf(f))
      by.set(m, [...(by.get(m) ?? []), f])
    }
    for (const m of [...by.keys()].sort().reverse()) out.push({ kind: 'month', key: `month:${key}:${m}`, month: m, files: sortDone(by.get(m)!, v.sort) })
  }
  return { now, done: out }
}

// ---- the header line ------------------------------------------------------------------------------------------------

export interface GroupHead {
  /** the bold part: 'v1.1.0', '11.14 배포 핫픽스', '2026년 11월', '다음 배포 대기' */
  lead: string
  /** after the lead, secondary: '11.15' (only next to a version) */
  date: string
  pr: number | null
  /** right: '5건' */
  count: string
  /** the second line; '' = none */
  summary: string
  /** the button's name for screen readers */
  spoken: string
}

export function groupHead(g: DoneGroup): GroupHead {
  const n = g.files.length
  if (g.kind === 'next') return { lead: '다음 배포 대기', date: '', pr: null, count: `완료 ${n}건`, summary: '', spoken: `다음 배포 대기, 완료 ${n}건` }
  if (g.kind === 'month') {
    const [y, m] = g.month.split('-').map(Number)
    return { lead: `${y}년 ${m}월`, date: '', pr: null, count: `완료 ${n}건`, summary: '', spoken: `${y}년 ${m}월, 완료 ${n}건` }
  }
  const d = g.deploy
  const named = `배포${d.suffix ? ` ${d.suffix}` : ''}`
  const tail = `${d.pr ? `, PR ${d.pr}` : ''}, 완료 ${n}건${d.summary ? `, ${d.summary}` : ''}`
  return d.version
    ? { lead: `v${d.version}`, date: kstDot(d.at), pr: d.pr, count: `${n}건`, summary: d.summary, spoken: `버전 ${d.version}, ${kstSpoken(d.at)} ${named}${tail}` }
    : { lead: `${kstDot(d.at)} ${named}`, date: '', pr: d.pr, count: `${n}건`, summary: d.summary, spoken: `${kstSpoken(d.at)} ${named}${tail}` }
}

// ---- folded or not, remembered --------------------------------------------------------------------------------------

/** group key → open; only what the viewer changed (a group not in it takes its default) */
export type Folds = Record<string, boolean>

/** 다음 배포 대기 and the newest deploy (or month) start open; the rest folded. A new deploy is the newest, so it alone opens */
export function isOpen(g: DoneGroup, groups: readonly DoneGroup[], folds: Folds): boolean {
  if (Object.prototype.hasOwnProperty.call(folds, g.key)) return folds[g.key]
  if (g.kind === 'next') return true
  return groups.find((x) => x.kind !== 'next') === g
}

export const FOLDS_KEY = 'agent-office.docs.folds'
const FOLDS_MAX = 200

export function parseFolds(raw: unknown): Folds {
  try {
    const x = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!x || typeof x !== 'object' || Array.isArray(x)) return {}
    const out: Folds = {}
    for (const [k, v] of Object.entries(x as Record<string, unknown>).slice(-FOLDS_MAX)) if (typeof v === 'boolean' && k.length <= 300) out[k] = v
    return out
  } catch {
    return {}
  }
}

export function loadFolds(): Folds {
  try {
    return parseFolds(localStorage.getItem(FOLDS_KEY))
  } catch {
    return {}
  }
}

export function saveFolds(f: Folds) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(f))
  } catch {
    // private window, blocked storage: the folds just are not remembered
  }
}

/** the group a file is in (to open it when the file is opened from a dot or a replay), or null */
export const groupOf = (g: Grouped | null, fileKey: string | null) => (g && fileKey ? (g.done.find((x) => x.files.some((f) => f.key === fileKey)) ?? null) : null)
