// The library's shared state: the document list for the current role (the viewer and the bookshelf read it) and the
// bodies fetched so far. A tiny external store like the approval panel's; React reads it with useSyncExternalStore.

import type { Role } from '../approvals/source'
import { groupLibrary, shelfLayout, type DocBody, type DocFolder, type DocMeta, type ShelfLayout } from './library'
import type { DocsSource } from './source'

export interface Library {
  /** null until the first answer */
  metas: DocMeta[] | null
  folders: DocFolder[]
  layout: ShelfLayout
  bodies: Readonly<Record<number, DocBody>>
  error: boolean
}

const EMPTY: Library = { metas: null, folders: [], layout: shelfLayout([]), bodies: {}, error: false }

export class LibraryStore {
  private snap: Library = EMPTY
  private listeners = new Set<() => void>()
  private publishers = new Set<(ids: number[]) => void>()
  private seq = 0
  private fetching = new Set<number>()
  private lastRole: Role | null = null

  constructor(
    private src: DocsSource,
    private role: () => Role,
  ) {}

  getSnapshot = () => this.snap
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  /** documents that just went from SECRET to approved (the stamp falls) */
  onPublish(cb: (ids: number[]) => void) {
    this.publishers.add(cb)
    return () => void this.publishers.delete(cb)
  }

  private set(patch: Partial<Library>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async refresh() {
    const seq = ++this.seq
    const role = this.role()
    try {
      const metas = await this.src.list(role)
      if (seq !== this.seq) return
      const prev = this.snap.metas
      const sameRole = this.lastRole === role
      this.lastRole = role
      const published = prev && sameRole ? metas.filter((m) => m.approved && prev.some((p) => p.id === m.id && !p.approved)).map((m) => m.id) : []
      // a body stays only while its document is the same, readable one
      const bodies: Record<number, DocBody> = {}
      if (sameRole) {
        for (const m of metas) {
          const had = this.snap.bodies[m.id]
          const old = prev?.find((p) => p.id === m.id)
          if (had && m.readable && old && old.updated_at === m.updated_at) bodies[m.id] = had
        }
      }
      const folders = groupLibrary(metas)
      this.set({ metas, folders, layout: shelfLayout(folders), bodies, error: false })
      if (published.length) this.publishers.forEach((p) => p(published))
    } catch {
      if (seq === this.seq) this.set({ error: true })
    }
  }

  /** fetch the bodies of these documents (readable ones not read yet) */
  async ensure(ids: number[]) {
    const want = ids.filter((id) => !this.snap.bodies[id] && !this.fetching.has(id) && this.snap.metas?.some((m) => m.id === id && m.readable))
    if (!want.length) return
    want.forEach((id) => this.fetching.add(id))
    const seq = this.seq
    try {
      const got = await this.src.read(want, this.role())
      if (seq !== this.seq) return
      this.set({ bodies: { ...this.snap.bodies, ...Object.fromEntries(got.map((b) => [b.id, b])) } })
    } catch {
      this.set({ error: true })
    } finally {
      want.forEach((id) => this.fetching.delete(id))
    }
  }
}
