// Mouse sounds (#225): the agents' mouse at the desk, from the input bus (office/inputEvents.ts `mouse` events).
// Synthesised (sound.md 1: the keyboard is the only recording). A mouse button is a microswitch: a 3–5 ms snap round
// 3.5 kHz with a little ring at 2.6 kHz and a dull shell knock under it; the release is the same switch, higher and
// softer. A wheel notch is a tiny ratchet tick. All sit under a keystroke (sound.md 4.1 마우스 표).

import { noise, tone, type Out } from './synth'

export type MouseKind = 'down' | 'up' | 'wheel'

/** level of the click (down); up and wheel are scaled from it. Measured against a 'char' stroke of the recording
 *  (energy over 300 ms, median of 200): down −7.5 dB, up −10.5 dB, wheel −15 dB (sound.md 4.1 마우스 표). */
export const MOUSE_GAIN = 0.015
export const MOUSE_SCALE: Record<MouseKind, number> = { down: 1, up: 0.6, wheel: 0.32 }

/** one mouse event, on any context (live or offline); `pitch` is the seat's small offset */
export function mouseVoice(o: Out, kind: MouseKind, pitch = 1) {
  const a = MOUSE_GAIN * MOUSE_SCALE[kind]
  const p = pitch * (0.97 + Math.random() * 0.06)
  if (kind === 'wheel') {
    noise(o, 0.003, { freq: 2300 * p, q: 2, level: a, attack: 0.0003 })
    tone(o, 1700 * p, 0.004, { type: 'sine', level: a * 0.25, attack: 0.0003 })
    return
  }
  const k = kind === 'up' ? 1.15 : 1
  noise(o, 0.004, { freq: 3600 * p * k, q: 1.4, level: a, attack: 0.0003 })
  tone(o, 2600 * p * k, 0.006, { type: 'sine', level: a * 0.3, attack: 0.0003 })
  noise(o, 0.012, { freq: 900 * p, q: 3, level: a * (kind === 'up' ? 0.15 : 0.3), attack: 0.0006 })
}
