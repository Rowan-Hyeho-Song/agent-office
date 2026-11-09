import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupLibrary, type DocMeta } from './library'
import { NEVER, clearFile, loadDocsSeen, reconcileDocs, saveDocsSeen, unreadFile, unreadFolder, type DocsSeen } from './unread'

const T = (s: string) => Date.parse(s)
const doc = (id: number, folder: number, updated: string, over: Partial<DocMeta> = {}): DocMeta => ({
  id, kind: 'plan', repo: 'o/r', folder, title: `T${folder}`, agents: [], grade: 'public', approved: true, readable: true, created_at: updated, updated_at: updated, ...over,
})
const OPENED = T('2026-11-10T00:00:00Z')
const seen = (unread: DocsSeen['unread'] = {}): DocsSeen => ({ openedAt: OPENED, unread })
const NOW = T('2026-11-10T12:00:00Z')
const filesOf = (metas: DocMeta[]) => groupLibrary(metas).flatMap((f) => f.files)

describe('the dock / tab dot', () => {
  const metas = [doc(1, 1, '2026-11-09T00:00:00Z'), doc(2, 2, '2026-11-10T06:00:00Z')]

  it('a document updated after the last opening turns it on (closed), and nothing is stored', () => {
    const s = seen()
    const r = reconcileDocs(s, metas, NOW, false)
    expect(r.dot).toBe(true)
    expect(r.fresh).toBe(1)
    expect(r.seen).toBe(s)
  })
  it('nothing newer: off', () => {
    expect(reconcileDocs(seen(), [metas[0]], NOW, false).dot).toBe(false)
  })
  it('a first visit has nothing new, and the opening time starts now', () => {
    const r = reconcileDocs(NEVER, metas, NOW, false)
    expect(r.dot).toBe(false)
    expect(r.seen.openedAt).toBe(NOW)
  })
  it('opening clears the dot and moves the opening time forward', () => {
    const r = reconcileDocs(seen(), metas, NOW, true)
    expect(r.dot).toBe(false)
    expect(r.seen.openedAt).toBe(NOW)
    expect(reconcileDocs(r.seen, metas, NOW + 1000, false).dot).toBe(false)
  })
  it('worklogs (not shown in the library) never light it', () => {
    expect(reconcileDocs(seen(), [doc(3, 3, '2026-11-10T06:00:00Z', { kind: 'worklog' })], NOW, false).dot).toBe(false)
  })
  it('nothing changed: the same object back (no write loop)', () => {
    const open = reconcileDocs(seen(), metas, NOW, true).seen
    expect(reconcileDocs(open, metas, NOW, true).seen).toBe(open)
  })
})

describe('dots inside the list', () => {
  const metas = [doc(1, 1, '2026-11-09T00:00:00Z'), doc(2, 2, '2026-11-10T06:00:00Z'), doc(3, 2, '2026-11-10T07:00:00Z', { kind: 'minutes' })]

  it('opening the library marks the new documents unread; the file and its folder get the dot', () => {
    const s = reconcileDocs(seen(), metas, NOW, true).seen
    expect(filesOf(metas).map((f) => [f.n, unreadFile(f, s)])).toEqual(expect.arrayContaining([[1, false], [2, true]]))
    expect(groupLibrary(metas).map((fo) => unreadFolder(fo, s))).toContain(true)
  })
  it('opening one file clears only its dot', () => {
    const more = [...metas, doc(4, 5, '2026-11-10T08:00:00Z')]
    const s = reconcileDocs(seen(), more, NOW, true).seen
    const f2 = filesOf(more).find((f) => f.n === 2)!
    const f5 = filesOf(more).find((f) => f.n === 5)!
    const after = clearFile(s, f2)
    expect(unreadFile(f2, after)).toBe(false)
    expect(unreadFile(f5, after)).toBe(true)
  })
  it('the dots outlast closing and reopening (stored), until the file is opened', () => {
    const s = reconcileDocs(seen(), metas, NOW, true).seen
    const closed = reconcileDocs(s, metas, NOW + 5000, false)
    expect(closed.dot).toBe(false) // the dock dot is for "since you last opened"
    expect(unreadFile(filesOf(metas).find((f) => f.n === 2)!, closed.seen)).toBe(true)
  })
  it('a document updated again after it was read turns up unread again', () => {
    const one = [doc(2, 2, '2026-11-10T06:00:00Z')]
    let s = reconcileDocs(seen(), one, NOW, true).seen
    s = clearFile(s, filesOf(one)[0])
    expect(unreadFile(filesOf(one)[0], s)).toBe(false)
    expect(reconcileDocs(s, [doc(2, 2, '2026-11-10T14:00:00Z')], NOW + 3 * 3600_000, false).dot).toBe(true)
  })
  it('a document that is gone is forgotten', () => {
    const s = reconcileDocs(seen(), metas, NOW, true).seen
    const r = reconcileDocs(s, [metas[0]], NOW + 1, true).seen
    expect(Object.keys(r.unread)).toEqual([])
  })
})

describe('the stored state', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('round-trips and survives junk', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
    expect(loadDocsSeen()).toEqual(NEVER)
    saveDocsSeen({ openedAt: 5, unread: { 1: 9 } })
    expect(loadDocsSeen()).toEqual({ openedAt: 5, unread: { 1: 9 } })
    mem.set('agent-office.seen.docs', '{nope')
    expect(loadDocsSeen()).toEqual(NEVER)
  })
  it('blocked storage does not throw', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(loadDocsSeen()).toEqual(NEVER)
    expect(() => saveDocsSeen(NEVER)).not.toThrow()
  })
})
