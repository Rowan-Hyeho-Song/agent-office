// The input bus (#225): every key and mouse action an agent makes at its desk, at the moment the 3D hand makes it. Sound (and anything else
// that wants to know) listens here; nothing in this file plays a sound or draws anything.
//
//   const off = onInput((e) => ...)      // off() to stop
//
//   { type: 'key' | 'keyUp', agent, kind: 'char' | 'space' | 'enter' | 'backspace' | 'mod', t, pos, key? }
//   { type: 'mouse', agent, kind: 'down' | 'up' | 'wheel', ticks?, t, pos }
//
//  - `agent`  the id ('agent_0' ...).
//  - `t`      the scene clock in seconds: the clock of the typing schedule, which is the replay's tau while the timelapse plays. A `key` is
//             sent at the moment the keycap passes its actuation point (the 2 mm of 4, the sound moment); `keyUp` when it is let go. They
//             arrive when the frame reaches them, so `t` is at most one frame old, never ahead of the scene clock.
//  - `pos`    a fresh Vector3 (the listener may keep it): the keycap's top in world space, or the mouse button / wheel it is on.
//  - `key`    the physical key ('KeyF', 'Space' ...), for the debug panel only. Sound must not depend on it.
//  - `ticks`  a wheel event is one notch (ticks = 1), the next one follows 120-170 ms later.
//  - A shortcut is two `key` events: the modifier (kind 'mod'), then the letter 120-200 ms later, the modifier let go after the letter.
//  - Sent for every agent at its desk, on screen or not. Not sent at the x16 timelapse (ambient 0), nor while a seek jumps the clock.
import type { Vector3 } from 'three'

export type InputKeyKind = 'char' | 'space' | 'enter' | 'backspace' | 'mod'

export interface KeyInput {
  type: 'key' | 'keyUp'
  agent: string
  kind: InputKeyKind
  t: number
  pos: Vector3
  /** debug only */
  key?: string
}
export interface MouseInput {
  type: 'mouse'
  agent: string
  kind: 'down' | 'up' | 'wheel'
  ticks?: number
  t: number
  pos: Vector3
}
export type InputEvent = KeyInput | MouseInput

const listeners = new Set<(e: InputEvent) => void>()

/** listen to every input event; returns the function that stops listening */
export function onInput(fn: (e: InputEvent) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** whether anyone listens (the sender skips building events when nobody does) */
export const hasInputListeners = () => listeners.size > 0

export function emitInput(e: InputEvent) {
  // a listener that throws must not stop the others, or the frame
  for (const fn of [...listeners]) {
    try {
      fn(e)
    } catch (err) {
      console.error('input listener', err)
    }
  }
}
