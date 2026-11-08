// The bubbles that are not part of a meeting replay: a talk the director staged (two agents face to face), and the
// short ones something else sets (a visitor's reaction, a private talk, ?debug=1). Pure: time comes in as an argument.
// Meeting bubbles come from meeting.ts frameAt; the scene merges both, one bubble per agent (a meeting wins).

import { firstSentence, lineChars, logLine, typedCount, type BubbleItem, type BubbleKind } from './bubbles'
import { seatName } from './meeting'

const LABEL: Record<BubbleKind, string> = { talk: '대화', react: '반응', private: '비공개' }

export interface Say {
  kind?: BubbleKind
  text?: string
  /** how long it stays, ms (default: until replaced for a talk the director owns, 5 s for the rest) */
  ms?: number
  /** the agent it faces (opens outward) */
  to?: string
}

interface Live {
  key: string
  agent: string
  kind: BubbleKind
  text: string
  from: number
  until: number
  to: string | null
  n: number
}

export const seatOfAgent = (agent: string) => Number(agent.split('_')[1])

export class BubbleCenter {
  private live = new Map<string, Live>()
  private goalLive = new Map<string, Live>()
  private seq = 0

  /** a bubble over an agent: 'react' pops at once, 'talk' types, 'private' shows the lock's words and no content */
  say(agent: string, s: Say = {}, now = Date.now()) {
    const kind = s.kind ?? 'talk'
    const text = kind === 'private' ? '비공개 대화' : firstSentence(s.text ?? '', lineChars())
    this.live.set(agent, { key: `say${++this.seq}`, agent, kind, text, from: now, until: now + (s.ms ?? 5000), to: s.to ?? null, n: this.seq })
  }

  clear(agent?: string) {
    if (agent) this.live.delete(agent)
    else this.live.clear()
  }

  /** the director's staged talk line (Goal.bubble) for this agent this frame; undefined = none (types again next time) */
  goal(agent: string, text: string | undefined, now: number, to?: string) {
    const had = this.goalLive.get(agent)
    if (!text) {
      this.goalLive.delete(agent)
      return
    }
    if (had && had.text === text) return
    this.goalLive.set(agent, { key: `goal${++this.seq}`, agent, kind: 'talk', text, from: now, until: Infinity, to: to ?? null, n: this.seq })
  }

  /** this frame's bubbles, at most one per agent */
  items(now: number, reduced: boolean): BubbleItem[] {
    const out: BubbleItem[] = []
    for (const [agent, l] of this.live) if (now >= l.until) this.live.delete(agent)
    for (const agent of new Set([...this.live.keys(), ...this.goalLive.keys()])) {
      const l = this.live.get(agent) ?? this.goalLive.get(agent)!
      const len = [...l.text].length
      const seat = seatOfAgent(agent)
      const typed = l.kind === 'talk' ? typedCount(len, now - l.from, reduced) : len
      out.push({
        id: agent,
        key: l.key,
        seat,
        kind: l.kind,
        label: LABEL[l.kind],
        text: l.text,
        typed,
        log: l.kind === 'private' ? logLine(seatName(seat), null, '비공개 대화') : logLine(seatName(seat), l.to ? seatName(seatOfAgent(l.to)) : null, l.text),
        dim: false,
        order: 1000 + l.n,
        pairWith: l.to,
        open: null,
        who: seatName(seat),
      })
    }
    return out
  }
}
