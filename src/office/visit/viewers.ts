// #4 office-ui.md 12.4: how many are watching the office now. Realtime presence on its own channel: each tab joins
// with a random key and an empty payload, so nothing about the visitor is sent or kept (no id, no IP, no name), and
// nothing is written to the database. The count is the number of keys in the channel's presence state.

import type { SupabaseClient } from '@supabase/supabase-js'

export const VIEWERS_CHANNEL = 'office-viewers'
/** a screen reader hears the count at most this often (12.4: polite, not every change) */
export const VIEWERS_SAY_MS = 5000

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

export function supabaseViewers(supabase: SupabaseClient): PresenceWire {
  return {
    join(onCount) {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)
      const ch = supabase.channel(VIEWERS_CHANNEL, { config: { presence: { key } } })
      ch.on('presence', { event: 'sync' }, () => onCount(Object.keys(ch.presenceState()).length))
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') void ch.track({})
      })
      return () => void supabase.removeChannel(ch)
    },
  }
}
