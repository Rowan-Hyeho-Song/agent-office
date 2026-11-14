// #4 office-ui.md 12.4: how many are watching the office now. Realtime presence on its own channel: each page joins
// with a random key and an empty payload, so nothing about the visitor is sent or kept (no id, no IP, no name), and
// nothing is written to the database. The count is the number of keys in the channel's presence state.
//
// One channel per page, shared by whoever asks (#452: the component made a new wire on every render, so each re-render
// left and joined the channel again and both screens said "혼자"). Leaving waits a moment, so a quick leave-and-join
// (React's StrictMode in dev, a remount) keeps the same channel. The count is taken again on every sync, join and leave.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

export const VIEWERS_CHANNEL = 'office-viewers'
/** a screen reader hears the count at most this often (12.4: polite, not every change) */
export const VIEWERS_SAY_MS = 5000
/** a leave this soon after is a re-join (StrictMode, a quick remount): the channel stays */
export const VIEWERS_LINGER_MS = 1000

/** the tail of the hint line: `· 지금 3명이 보고 있어요` / `· 지금 혼자 보고 있어요`; `short` (a narrow phone line) is `👁 3` */
export function viewersText(n: number, short = false): string {
  const k = Math.max(1, Math.floor(n))
  if (short) return `👁 ${k}`
  return k === 1 ? '· 지금 혼자 보고 있어요' : `· 지금 ${k}명이 보고 있어요`
}

/** the wire, so the count logic is tested without Realtime */
export interface PresenceWire {
  join(onCount: (n: number) => void): () => void
}

/** the presence channel itself, kept apart so the sharing rules are tested with a fake */
export interface PresenceChannel {
  open(onState: () => void): void
  count(): number
  close(): void
}

/** one channel for the page, shared by every listener; it closes VIEWERS_LINGER_MS after the last one leaves */
export function sharedPresence(make: () => PresenceChannel, linger = VIEWERS_LINGER_MS): PresenceWire {
  let ch: PresenceChannel | null = null
  let closing: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<(n: number) => void>()
  let last = 0
  const tell = () => {
    last = ch?.count() ?? 0
    listeners.forEach((l) => l(last))
  }
  return {
    join(onCount) {
      listeners.add(onCount)
      if (closing) {
        clearTimeout(closing)
        closing = null
      }
      if (!ch) {
        ch = make()
        ch.open(tell)
      } else if (last) onCount(last)
      return () => {
        listeners.delete(onCount)
        if (listeners.size || closing) return
        closing = setTimeout(() => {
          closing = null
          if (listeners.size) return
          ch?.close()
          ch = null
          last = 0
        }, linger)
      }
    },
  }
}

export function supabaseViewers(supabase: SupabaseClient): PresenceWire {
  return sharedPresence(() => {
    const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)
    let ch: RealtimeChannel | null = null
    return {
      open(onState) {
        const c = supabase.channel(VIEWERS_CHANNEL, { config: { presence: { key } } })
        ch = c
        c.on('presence', { event: 'sync' }, onState)
        c.on('presence', { event: 'join' }, onState)
        c.on('presence', { event: 'leave' }, onState)
        c.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') void c.track({})
        })
      },
      count: () => (ch ? Object.keys(ch.presenceState()).length : 0),
      close() {
        if (ch) void supabase.removeChannel(ch)
        ch = null
      },
    }
  })
}

let shared: PresenceWire | null = null
/** the page's one wire (null without Supabase) */
export const pageViewers = (supabase: SupabaseClient | null): PresenceWire | null => (supabase ? (shared ??= supabaseViewers(supabase)) : null)
