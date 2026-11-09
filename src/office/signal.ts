// #240 how the page hears that something changed, so the 결재함 and 서재 can show a new item without a reload.
//
// - Everyone (visitors too) joins the public broadcast channel `office-signal`. The server (api/docs.ts, api/approve.ts)
//   sends `{ table, at }` after a write and nothing else (src/server/signal.ts). The payload is only a hint of WHICH list
//   to re-read; what is read is what this viewer is allowed to read (the cover views for visitors). Anything else in
//   the payload is ignored, and a message that makes no sense just re-reads everything.
// - The owner can also hear the tables themselves (postgres_changes, RLS lets only the owner through).
// - Not joined (offline, the channel failed): re-read every 15 s, and whenever the tab becomes visible again. Joined,
//   a slow poll (60 s) still catches a signal that was lost on its way.
// - Several messages close together are one re-read per table (the owner hears both the table and the broadcast).

import type { SupabaseClient } from '@supabase/supabase-js'

export type SignalTable = 'approvals' | 'docs'
const TABLES: SignalTable[] = ['approvals', 'docs']

/** the channel and event the server sends on (src/server/signal.ts has the same names; that file is Node-only) */
export const SIGNAL_CHANNEL = 'office-signal'
export const SIGNAL_EVENT = 'changed'

export const POLL_UNJOINED_MS = 15_000
export const POLL_JOINED_MS = 60_000
export const COALESCE_MS = 250

/** the connection to Realtime, behind a small interface so the rules can be tested without a network */
export interface SignalWire {
  /** join the broadcast channel; `status(true)` when joined, `status(false)` when it fails or closes. Returns leave */
  broadcast(onMessage: (payload: unknown) => void, status: (joined: boolean) => void): () => void
  /** owner only: the tables' own change events; the payload is never read. Returns leave */
  changes(onChange: (table: SignalTable) => void): () => void
}

export interface SignalHub {
  /** be told to re-read `table`'s list; returns the unsubscribe. The channel opens with the first one and leaves with the last */
  on(table: SignalTable, cb: () => void): () => void
  /** the owner also listens to the tables themselves */
  watchOwner(owner: boolean): void
  /** a message arrived (also the debug fakes' way of saying something changed) */
  receive(payload: unknown): void
  /** whether the broadcast channel is joined (false = polling every 15 s) */
  joined(): boolean
}

/** which list a message points at: the table if it is a known one, otherwise everything */
export function tablesOf(payload: unknown): SignalTable[] {
  const t = payload && typeof payload === 'object' ? (payload as { table?: unknown }).table : undefined
  return TABLES.includes(t as SignalTable) ? [t as SignalTable] : TABLES
}

/** `wire` null = no Realtime (the debug fakes): only `receive` and the slow poll */
export function createSignalHub(wire: SignalWire | null): SignalHub {
  const listeners: Record<SignalTable, Set<() => void>> = { approvals: new Set(), docs: new Set() }
  const pending: Partial<Record<SignalTable, ReturnType<typeof setTimeout>>> = {}
  let leave: (() => void) | null = null
  let leaveOwner: (() => void) | null = null
  let owner = false
  let isJoined = wire === null // without a wire there is nothing to be joined to: the slow poll is enough
  let poll: ReturnType<typeof setInterval> | undefined
  let removeVisibility: (() => void) | null = null
  const count = () => listeners.approvals.size + listeners.docs.size

  const fire = (table: SignalTable) => {
    if (pending[table]) return // a re-read for this table is already about to run
    pending[table] = setTimeout(() => {
      delete pending[table]
      listeners[table].forEach((cb) => cb())
    }, COALESCE_MS)
  }
  const fireAll = () => TABLES.forEach(fire)

  const restartPoll = () => {
    clearInterval(poll)
    poll = undefined
    if (!count()) return
    poll = setInterval(() => !document.hidden && fireAll(), isJoined ? POLL_JOINED_MS : POLL_UNJOINED_MS)
  }
  const onStatus = (joined: boolean) => {
    const was = isJoined
    isJoined = joined
    if (was !== joined) restartPoll()
    if (joined && !was) fireAll() // whatever happened while the channel was down
  }
  const syncOwner = () => {
    if (owner && count() && wire && !leaveOwner) leaveOwner = wire.changes((t) => fire(t))
    if ((!owner || !count()) && leaveOwner) {
      leaveOwner()
      leaveOwner = null
    }
  }

  const start = () => {
    if (wire) leave = wire.broadcast((p) => tablesOf(p).forEach(fire), onStatus)
    const onVisible = () => !document.hidden && fireAll()
    document.addEventListener('visibilitychange', onVisible)
    removeVisibility = () => document.removeEventListener('visibilitychange', onVisible)
    restartPoll()
    syncOwner()
  }
  const stop = () => {
    leave?.()
    leave = null
    removeVisibility?.()
    removeVisibility = null
    clearInterval(poll)
    poll = undefined
    syncOwner()
    isJoined = wire === null
    TABLES.forEach((t) => {
      clearTimeout(pending[t])
      delete pending[t]
    })
  }

  return {
    on(table, cb) {
      const first = count() === 0
      listeners[table].add(cb)
      if (first) start()
      return () => {
        listeners[table].delete(cb)
        if (count() === 0) stop()
      }
    },
    watchOwner(v) {
      owner = v
      syncOwner()
    },
    receive: (p) => tablesOf(p).forEach(fire),
    joined: () => isJoined,
  }
}

/** the real wire: one broadcast channel for everyone, one more for the owner's table changes */
export function supabaseSignalWire(supabase: SupabaseClient): SignalWire {
  return {
    broadcast(onMessage, status) {
      const ch = supabase
        .channel(SIGNAL_CHANNEL)
        .on('broadcast', { event: SIGNAL_EVENT }, (m: { payload?: unknown }) => onMessage(m.payload))
        .subscribe((s: string) => status(s === 'SUBSCRIBED'))
      return () => void supabase.removeChannel(ch)
    },
    changes(onChange) {
      const ch = supabase.channel('office-owner-changes')
      for (const table of TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange(table))
      ch.subscribe()
      return () => void supabase.removeChannel(ch)
    },
  }
}
