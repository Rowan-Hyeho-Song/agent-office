// Typing sound rhythm (docs/design/sound.md 4.1 #1), until #225's real key events replace it: the hands animate every
// finger at 4 Hz (rig.ts typing), which would be 30+ clicks a second for one agent. A person types in bursts, so the
// sound is its own rhythm: 6–9 keys a second for 1.5–4 s, then a 0.6–2.5 s pause. Words of 2–7 keys end in a space;
// a burst ends in enter about a third of the time; now and then two backspaces fix a word.
// Only agents at their desk, typing, on screen, with the ambient motion on.

import type { KeyKind } from './keys'

export type TypeState = { next: number; burstEnd: number; word: number; fix: number }

const newWord = (rand: () => number) => 2 + Math.floor(rand() * 6)

/** the keys that fall in (prevT, t] for one agent, their kinds, and the next state (pure; `rand` injected for tests) */
export function keysBetween(s: TypeState | null, t: number, rand: () => number = Math.random): { keys: number[]; kinds: KeyKind[]; next: TypeState } {
  // a fresh start (or a jump of more than a second) begins with a short pause, never a burst of catch-up clicks
  if (!s || t - s.next > 1)
    return { keys: [], kinds: [], next: { next: t + 0.2 + rand() * 0.6, burstEnd: t + 0.2 + 1.5 + rand() * 2.5, word: newWord(rand), fix: 0 } }
  const keys: number[] = []
  const kinds: KeyKind[] = []
  let { next, burstEnd, word, fix } = s
  while (next <= t) {
    keys.push(next)
    const endOfBurst = next >= burstEnd
    let kind: KeyKind
    if (fix > 0) {
      kind = 'backspace'
      fix--
    } else if (endOfBurst) {
      kind = rand() < 0.35 ? 'enter' : 'space'
      word = newWord(rand)
    } else if (word <= 0) {
      kind = 'space'
      word = newWord(rand)
      if (rand() < 0.08) fix = 2 // a typo: two backspaces after the space, then retype
    } else {
      kind = 'char'
      word--
    }
    kinds.push(kind)
    if (endOfBurst && fix === 0) {
      // pause, then a new burst
      next += 0.6 + rand() * 1.9
      burstEnd = next + 1.5 + rand() * 2.5
    } else next += kind === 'space' || kind === 'backspace' ? 1 / (5 + rand() * 2) : 1 / (6 + rand() * 3) // 6–9 keys a second
  }
  return { keys, kinds, next: { next, burstEnd, word, fix } }
}
