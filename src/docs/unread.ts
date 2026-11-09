// #240 the library's "new document" dots (docs/design/docs-ui.md 1.6): the same rule as the approval box, in ivory.
// - the dock / tab dot: some document was created or updated after the library was last opened; opening clears it
// - inside the list: the files (and the folders holding them) with such documents keep a small dot until that file is
//   opened. The unread ones are remembered per browser (localStorage), so closing the library does not lose them.
// Pure functions; the viewer stores the state.

import { TOC, type DocFile, type DocFolder, type DocMeta } from './library.js'

export interface DocsSeen {
  /** when the library was last open (ms); null = never seen on this browser: a first look, nothing is new */
  openedAt: number | null
  /** document id → its updated_at (ms) when it turned up unread */
  unread: Record<string, number>
}

export const SEEN_DOCS_KEY = 'agent-office.seen.docs'
export const NEVER: DocsSeen = { openedAt: null, unread: {} }

export function loadDocsSeen(key: string = SEEN_DOCS_KEY): DocsSeen {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DocsSeen> | null
    const unread: Record<string, number> = {}
    for (const [id, t] of Object.entries(raw?.unread ?? {})) if (Number.isFinite(t)) unread[id] = t
    return { openedAt: typeof raw?.openedAt === 'number' && Number.isFinite(raw.openedAt) ? raw.openedAt : null, unread }
  } catch {
    return NEVER
  }
}
export function saveDocsSeen(s: DocsSeen, key: string = SEEN_DOCS_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(s))
  } catch {
    /* storage blocked: dots start fresh next visit */
  }
}

const shown = (metas: readonly DocMeta[]) => metas.filter((m) => TOC.some((t) => t.kind === m.kind))
const upd = (m: DocMeta) => Date.parse(m.updated_at) || Date.parse(m.created_at) || 0

/**
 * Fold what the list shows into the stored state. Closed: the dock / tab dot is on while any document is newer than
 * the last opening, and nothing is stored. Open: those documents become unread (the list marks them), and the opening
 * time moves to now. Returns the same `seen` object when nothing changed.
 */
export function reconcileDocs(seen: DocsSeen, metas: readonly DocMeta[], now: number, open: boolean): { seen: DocsSeen; dot: boolean; fresh: number } {
  const list = shown(metas)
  if (seen.openedAt === null) return { seen: { openedAt: now, unread: {} }, dot: false, fresh: 0 }
  const fresh = list.filter((m) => upd(m) > seen.openedAt!)
  if (!open) return { seen, dot: fresh.length > 0, fresh: fresh.length }
  const unread: Record<string, number> = {}
  for (const m of list) {
    const was = seen.unread[m.id]
    if (was !== undefined && was >= upd(m)) unread[m.id] = was // still the version that turned up unread
  }
  for (const m of fresh) unread[m.id] = upd(m)
  const newest = list.reduce((t, m) => Math.max(t, upd(m)), 0)
  // nothing newer than the stored opening time and the same unread ones: leave it alone (the clock is not a reason to rewrite)
  if (newest <= seen.openedAt && sameKeys(unread, seen.unread)) return { seen, dot: false, fresh: 0 }
  return { seen: { openedAt: Math.max(now, newest), unread }, dot: false, fresh: 0 }
}

const sameKeys = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k])
}

/** a file (파일철) has a dot while any of its documents is unread */
export const unreadFile = (file: Pick<DocFile, 'docs'>, seen: DocsSeen) => file.docs.some((d) => seen.unread[d.id] !== undefined)
export const unreadFolder = (folder: Pick<DocFolder, 'files'>, seen: DocsSeen) => folder.files.some((f) => unreadFile(f, seen))

/** opening a file clears its dot (and only its) */
export function clearFile(seen: DocsSeen, file: Pick<DocFile, 'docs'>): DocsSeen {
  if (!unreadFile(file, seen)) return seen
  const unread = { ...seen.unread }
  for (const d of file.docs) delete unread[d.id]
  return { ...seen, unread }
}
