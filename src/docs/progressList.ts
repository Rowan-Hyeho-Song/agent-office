// The file list's filter and sort by progress (#241, docs/design/docs-ui.md 2.5), as pure functions, and the choice
// remembered in the browser. The viewer only draws.

import type { DocFile } from './library.js'
import type { Stage } from './progress.js'

export type StageFilter = 'all' | Stage
export type SortKey = 'default' | 'recent' | 'number'

export interface ListView {
  stage: StageFilter
  /** only files with a 🖊 request waiting */
  pendingOnly: boolean
  sort: SortKey
}

export const DEFAULT_VIEW: ListView = { stage: 'all', pendingOnly: false, sort: 'default' }
/** the chips in this order */
export const STAGE_FILTERS: readonly StageFilter[] = ['all', 'doing', 'review', 'waiting', 'done']
export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'default', label: '기본 (진행 중 먼저)' },
  { key: 'recent', label: '최근 갱신' },
  { key: 'number', label: '번호' },
]

export const pendingOf = (f: Pick<DocFile, 'progress'>) => f.progress?.pending ?? 0

const matches = (f: DocFile, v: Pick<ListView, 'pendingOnly'>) => !v.pendingOnly || pendingOf(f) > 0

/** how many files each chip would show (with the 결재 대기만 toggle applied); a file with no progress is only in 전체 */
export function stageCounts(files: readonly DocFile[], v: Pick<ListView, 'pendingOnly'>): Record<StageFilter, number> {
  const out: Record<StageFilter, number> = { all: 0, waiting: 0, doing: 0, review: 0, done: 0 }
  for (const f of files) {
    if (!matches(f, v)) continue
    out.all++
    if (f.progress) out[f.progress.stage]++
  }
  return out
}

/**
 * Default order: 진행 중 → 검토 → 결재 대기가 걸린 것 → 대기 → 완료, then the files with no progress (filed before it
 * existed: most likely old), each by newest first. A finished file with a pending request stays among the finished.
 */
export function defaultRank(f: Pick<DocFile, 'progress'>): number {
  const p = f.progress
  if (!p) return 5
  if (p.stage === 'doing') return 0
  if (p.stage === 'review') return 1
  if (p.stage !== 'done' && p.pending > 0) return 2
  return p.stage === 'waiting' ? 3 : 4
}

const recent = (a: DocFile, b: DocFile) => b.date.localeCompare(a.date) || (b.n ?? 0) - (a.n ?? 0)

export function viewFiles(files: readonly DocFile[], v: ListView): DocFile[] {
  const kept = files.filter((f) => matches(f, v) && (v.stage === 'all' || f.progress?.stage === v.stage))
  const by =
    v.sort === 'number'
      ? (a: DocFile, b: DocFile) => (b.n ?? -1) - (a.n ?? -1) || recent(a, b)
      : v.sort === 'recent'
        ? recent
        : (a: DocFile, b: DocFile) => defaultRank(a) - defaultRank(b) || recent(a, b)
  return [...kept].sort(by)
}

// ---- remembered ---------------------------------------------------------------------------------------------------

export const VIEW_KEY = 'agent-office.docs.list'

export function parseView(raw: unknown): ListView {
  try {
    const x = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<ListView> | null
    if (!x || typeof x !== 'object') return DEFAULT_VIEW
    return {
      stage: (STAGE_FILTERS as readonly unknown[]).includes(x.stage) ? (x.stage as StageFilter) : 'all',
      pendingOnly: x.pendingOnly === true,
      sort: SORTS.some((s) => s.key === x.sort) ? (x.sort as SortKey) : 'default',
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function loadView(): ListView {
  try {
    return parseView(localStorage.getItem(VIEW_KEY))
  } catch {
    return DEFAULT_VIEW
  }
}

export function saveView(v: ListView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v))
  } catch {
    // private window, blocked storage: the choice just is not remembered
  }
}
