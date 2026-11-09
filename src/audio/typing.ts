// Typing sound (docs/design/sound.md 4.1 #1): the hands animate every finger at 4 Hz (rig.ts typing), which would be
// 30+ clicks a second for one agent. A person types in bursts, so the sound is its own rhythm: 6–9 keys a second for
// 1.5–4 s, then a 0.6–2.5 s pause. Only agents at their desk, typing, on screen, with the ambient motion on.

export type TypeState = { next: number; burstEnd: number }

/** the keys that fall in (prevT, t] for one agent, and the next state (pure; `rand` is injected for tests) */
export function keysBetween(s: TypeState | null, t: number, rand: () => number = Math.random): { keys: number[]; next: TypeState } {
  // a fresh start (or a jump of more than a second) begins with a short pause, never a burst of catch-up clicks
  if (!s || t - s.next > 1) return { keys: [], next: { next: t + 0.2 + rand() * 0.6, burstEnd: t + 0.2 + 1.5 + rand() * 2.5 } }
  const keys: number[] = []
  let { next, burstEnd } = s
  while (next <= t) {
    keys.push(next)
    if (next >= burstEnd) {
      // pause, then a new burst
      next += 0.6 + rand() * 1.9
      burstEnd = next + 1.5 + rand() * 2.5
    } else next += 1 / (6 + rand() * 3) // 6–9 keys a second, uneven
  }
  return { keys, next: { next, burstEnd } }
}
