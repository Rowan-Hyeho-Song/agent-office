// #4 office-ui.md 12.3, the page's side of the notes: pin one (through /api/note, never to the table), keep this tab's 30 s, and
// keep the board's latest twelve (read from visitor_notes, RLS: the ones not hidden) up to date when a note is pinned anywhere
// (the content-free signal on `office-visit`, treats.ts). A note new since the board was first read flutters as it is pinned.

import type { SupabaseClient } from '@supabase/supabase-js'
import { assetUrl } from '../../room/base'
import { checkNote, NOTE_BOARD, NOTE_COOLDOWN_MS, tidy, type Note } from '../../visit/note'
import { onNoteSignal } from './treats'

export interface NotesState {
  /** the board, newest first */
  notes: Note[]
  /** ids pinned since the board was first read (they flutter in once) */
  fresh: number[]
}

let state: NotesState = { notes: [], fresh: [] }
let loaded = false
const listeners = new Set<() => void>()
const set = (next: NotesState) => {
  state = next
  listeners.forEach((l) => l())
}
export const notesStore = {
  subscribe: (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb)),
  getSnapshot: () => state,
}

/** a new board from the table: the latest NOTE_BOARD; the ones not on the board before are fresh (none on the first read) */
export function mergeBoard(prev: NotesState, rows: readonly Note[], first: boolean): NotesState {
  const notes = [...rows].sort((a, b) => b.id - a.id).slice(0, NOTE_BOARD)
  const had = new Set(prev.notes.map((n) => n.id))
  const fresh = first ? [] : notes.filter((n) => !had.has(n.id)).map((n) => n.id)
  return { notes, fresh: [...prev.fresh.filter((id) => notes.some((n) => n.id === id)), ...fresh] }
}

/** the flutter has played: not fresh any more */
export const settled = (id: number) => state.fresh.includes(id) && set({ ...state, fresh: state.fresh.filter((x) => x !== id) })

/** read the board now, and again on every note signal. Returns leave */
export function listenNotes(supabase: SupabaseClient): () => void {
  const read = async () => {
    const { data } = await supabase.from('visitor_notes').select('id,agent,text,name,created_at').order('id', { ascending: false }).limit(NOTE_BOARD)
    if (!data) return
    set(mergeBoard(state, data as Note[], !loaded))
    loaded = true
  }
  void read()
  return onNoteSignal(() => void read())
}

let until = 0
/** seconds before this tab may pin another note; 0 = now */
export const noteWaitLeft = (now = Date.now()) => Math.max(0, Math.ceil((until - now) / 1000))

/**
 * Pin a note for `agent`. The page checks first (the same rules as the server, so the visitor hears the reason at once); the
 * server's answer decides. On success the note goes on this board at once (fresh); the others get it by the signal.
 */
export async function pinNote(agent: string, text: string, name: string, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { error: string } | { wait: number }> {
  const why = checkNote(name, text)
  if (why) return { error: why }
  if (noteWaitLeft()) return { wait: noteWaitLeft() }
  try {
    const res = await fetcher(assetUrl('api/note'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, text: tidy(text), name: tidy(name) }) })
    const body = (await res.json().catch(() => ({}))) as { note?: Note; error?: string; retryS?: number }
    if (res.status === 429 && body.retryS) {
      until = Date.now() + body.retryS * 1000
      return { wait: body.retryS }
    }
    if (!res.ok || !body.note) return { error: body.error && res.status < 500 ? body.error : '지금은 붙일 수 없어요. 잠시 뒤에 다시 해 주세요.' }
    until = Date.now() + NOTE_COOLDOWN_MS
    set(mergeBoard(state, [body.note, ...state.notes], false))
    return { ok: true }
  } catch {
    return { error: '지금은 붙일 수 없어요. 잠시 뒤에 다시 해 주세요.' }
  }
}

/** ?debug=1 and tests: pin a note on this board only (no server) */
export function pinLocal(note: Note) {
  set(mergeBoard(state, [note, ...state.notes], false))
}

export const resetNotesForTest = () => {
  state = { notes: [], fresh: [] }
  loaded = false
  until = 0
  listeners.clear()
}
