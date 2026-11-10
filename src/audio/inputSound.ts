// The agents' real key presses and mouse clicks (#225) as cues. office/inputEvents.ts sends every event when the frame
// reaches its time; SoundListener keeps the ones of a frame and hands them here once per frame.
//
//  - `key` → 'type' with its kind (STROKE_RULE in keys.ts picks the stroke), `keyUp` → nothing (the recording's strokes
//    already hold the key's release), `mouse` down / up / wheel → 'mouse.down' / 'mouse.up' / 'mouse.wheel'.
//  - A late frame brings several events at once, each with its own scene time t (ascending, never ahead of now). They
//    are spread by their t difference over the replay speed, so the rhythm survives; an event more than 250 ms behind
//    the frame's newest (real seconds) is dropped, never played as a catch-up burst.
//
// The event shape is copied here structurally so this file doesn't depend on the office code (the coder owns it).

import type { Vec } from './engine'
import type { KeyKind } from './keys'
import type { MouseKind } from './mouse'

export type InputLike =
  | { type: 'key' | 'keyUp'; agent: string; kind: KeyKind; t: number; pos: Vec }
  | { type: 'mouse'; agent: string; kind: MouseKind; ticks?: number; t: number; pos: Vec }

export type InputCueName = 'type' | 'mouse.down' | 'mouse.up' | 'mouse.wheel'
export type InputCue = { name: InputCueName; pos: Vec; agent: string; at: number; keyKind?: KeyKind; key: string }

/** most real seconds an event may be behind the newest of its frame */
export const LATE_S = 0.25

/** a frame's events → cues with their offsets (pure, tested). `speed` is the replay speed (1, 4; 16 sends nothing). */
export function inputCues(events: InputLike[], speed = 1): InputCue[] {
  const s = Math.max(1, speed)
  const sounding = events.filter((e) => e.type !== 'keyUp')
  if (!sounding.length) return []
  const newest = Math.max(...sounding.map((e) => e.t))
  const kept = sounding.filter((e) => (newest - e.t) / s <= LATE_S)
  const first = Math.min(...kept.map((e) => e.t))
  const out: InputCue[] = []
  for (const e of kept) {
    const at = (e.t - first) / s
    // the event's agent, kind and scene time make a stable key: ×4 keeps or drops the same keys on every replay
    const key = `in:${e.agent}:${e.type}:${e.kind}:${e.t.toFixed(3)}`
    if (e.type === 'key') out.push({ name: 'type', pos: e.pos, agent: e.agent, at, keyKind: e.kind, key })
    else if (e.type === 'mouse') {
      const n = e.kind === 'wheel' ? Math.max(1, Math.min(4, e.ticks ?? 1)) : 1
      // a wheel event is one notch (ticks 1); if one ever carries more, they tick 40 ms apart
      for (let i = 0; i < n; i++) out.push({ name: `mouse.${e.kind}`, pos: e.pos, agent: e.agent, at: at + i * 0.04, key: `${key}:${i}` })
    }
  }
  return out
}
