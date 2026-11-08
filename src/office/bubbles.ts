// Speech bubbles and status tags (docs/design/office-ui.md section 3) as pure functions: the text rules, the timing, the
// placement (the design mock's fit()), the tag a status shows. src/office/bubbleLayer.ts draws; nothing here touches the DOM.

import type { AgentStatus } from './status'
import { activityLabel } from './status'

/** the values of the --bubble-* / --type-* / --hold-* tokens (src/styles/tokens.css) */
export const BUBBLE = {
  /** a replayed minutes row: its first sentence, about this long (plan.md 6.4) */
  lineChars: 40,
  perCharMs: 28,
  typeMaxMs: 1000,
  holdBaseMs: 1600,
  holdPerCharMs: 70,
  holdMaxMs: 6000,
  /** placement (tokens: --bubble-lead, --bubble-stack-gap, --bubble-stripe, --safe-top, --safe-side) */
  lead: 28,
  gap: 8,
  stripe: 3,
  safeTop: 64,
  safeSide: 16,
  /** the anchor sits 4px above the head point; a bubble that opens downward hangs from 30px below it */
  anchorUp: 4,
  anchorDown: 30,
} as const

/** the first sentence of a markdown cell, plain, at most `max` characters (the last one an ellipsis when cut) */
export function firstSentence(markdown: string, max: number = BUBBLE.lineChars): string {
  const plain = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // a sentence ends at . ! ? followed by a space or the end (not the dot in "v1.2" or "#18.")
  const end = /[.!?](?=\s|$)|[。！？]/.exec(plain)
  const first = (end ? plain.slice(0, end.index + 1) : plain).trim()
  const chars = [...first]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : first
}

/** every non-space character as a block: the same line with its words hidden (SECRET minutes) */
export const maskText = (text: string) => text.replace(/\S/g, '█')

/** ms per typed character: 28, but never more than a second in all */
const stepMs = (len: number) => Math.min(BUBBLE.perCharMs, BUBBLE.typeMaxMs / Math.max(1, len))

/** how long typing `len` characters takes (0 with reduced motion: the whole sentence at once) */
export const typeMs = (len: number, reduced = false) => (reduced || len === 0 ? 0 : stepMs(len) * len)

/** how many of `len` characters are typed `elapsed` ms after the bubble opened */
export function typedCount(len: number, elapsed: number, reduced = false): number {
  if (reduced || len === 0) return len
  return Math.max(0, Math.min(len, Math.floor(elapsed / stepMs(len))))
}

/** how long a finished sentence stays: 1.6 s + 70 ms per character, at most 6 s */
export const holdMs = (len: number) => Math.min(BUBBLE.holdMaxMs, BUBBLE.holdBaseMs + len * BUBBLE.holdPerCharMs)

/** which way a bubble opens when it talks to someone at `otherX`: away from them (outward), so it never covers them */
export const pairSide = (selfX: number, otherX: number): 'left' | 'right' => (selfX < otherX ? 'left' : 'right')

/** the screen-reader log line: `메모(기획) → 메시(3D): 원문` */
export const logLine = (from: string, to: string | null, text: string) => `${from}${to ? ` → ${to}` : ''}: ${text}`

// ---- placement -----------------------------------------------------------------------------------------------------

export interface PlaceInput {
  id: string
  /** later = on top: a bubble that overlaps an earlier one is raised by the overlap + a gap */
  order: number
  /** the head anchor in viewport px */
  x: number
  y: number
  /** the card's size in px (its laid-out size, not the animated one) */
  w: number
  h: number
  prefSide: 'left' | 'right'
  /** facing someone: keeps its outward side (pushed inward when it does not fit, never flipped toward them) */
  pair: boolean
  /** the earlier line of a conversation: hidden on a narrow screen */
  dim: boolean
}

export interface Placed {
  side: 'left' | 'right'
  dir: 'up' | 'down'
  /** extra lead length when stacked on another bubble */
  stack: number
  /** px to push the card to the right (negative = left) */
  shift: number
  /** false when the anchor is off screen (the bubble hides; the log still gets its line) */
  visible: boolean
}

export interface PlaceView {
  w: number
  h: number
  narrow: boolean
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** the card's box for a placement, as the design CSS lays it out (.ob-card inside .ob) */
export function cardRect(i: Pick<PlaceInput, 'x' | 'y' | 'w' | 'h'>, p: Pick<Placed, 'side' | 'dir' | 'stack' | 'shift'>): Rect {
  const half = BUBBLE.stripe / 2
  const left = p.side === 'right' ? i.x - half + p.shift : i.x + half + p.shift - i.w
  if (p.dir === 'up') {
    const bottom = i.y - BUBBLE.anchorUp - BUBBLE.lead - p.stack
    return { left, right: left + i.w, bottom, top: bottom - i.h }
  }
  const top = i.y + BUBBLE.anchorDown + BUBBLE.lead + p.stack
  return { left, right: left + i.w, top, bottom: top + i.h }
}

/**
 * Where every bubble goes (the mock's fit()): up unless the top edge would pass the safe line, then down; a lone
 * bubble flips to the other side at a screen edge while a facing one only slides inward; overlapping bubbles stack
 * upward, the later one raised by the overlap + 8px.
 */
export function placeBubbles(items: PlaceInput[], view: PlaceView): Record<string, Placed> {
  const out: Record<string, Placed> = {}
  const top = BUBBLE.safeTop
  const side = BUBBLE.safeSide
  const live: PlaceInput[] = []
  for (const i of items) {
    const onScreen = i.x >= 0 && i.x <= view.w && i.y >= 0 && i.y <= view.h
    const gone = !onScreen || (view.narrow && i.dim)
    out[i.id] = { side: i.prefSide, dir: 'up', stack: 0, shift: 0, visible: !gone }
    if (gone) continue
    const p = out[i.id]
    let r = cardRect(i, p)
    if (r.top < top) {
      p.dir = 'down'
      r = cardRect(i, p)
    }
    if (!i.pair) {
      if (r.right > view.w - side && p.side === 'right') p.side = 'left'
      else if (r.left < side && p.side === 'left') p.side = 'right'
      r = cardRect(i, p)
    }
    // neither side fits: push it inward
    if (r.right > view.w - side) p.shift = view.w - side - r.right
    if (r.left < side) p.shift = side - r.left
    live.push(i)
  }
  live.sort((a, b) => a.order - b.order)
  for (let k = 1; k < live.length; k++) {
    const cur = live[k]
    const p = out[cur.id]
    for (let j = 0; j < k; j++) {
      const a = cardRect(live[j], out[live[j].id])
      const b = cardRect(cur, p)
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (overlapX > 0 && overlapY > -BUBBLE.gap && p.dir === 'up') p.stack += overlapY + BUBBLE.gap
    }
  }
  return out
}

// ---- status tags ---------------------------------------------------------------------------------------------------

export interface Tag {
  icon: string
  label: string
  private: boolean
}

/** the icon of each activity the hook sends (the design's ACTIVITIES table) */
const ACTIVITY_ICON: Record<string, string> = {
  edit: 'edit',
  read: 'read',
  test: 'test',
  build: 'build',
  install: 'install',
  git: 'git',
  run: 'run',
  other: 'cmd',
  delegate: 'delegate',
  think: 'bot',
  private: 'lock',
}

/** the chip over a working agent's head ("파일 편집 중"); null when it is not working or wrapping up */
export function statusTag(status: AgentStatus | undefined): Tag | null {
  if (!status) return null
  if (status.state === 'wrapping') return { icon: 'card', label: '카드 정리 중', private: false }
  if (status.state !== 'working') return null
  const key = status.activity ?? 'other'
  return { icon: ACTIVITY_ICON[key] ?? 'cmd', label: activityLabel(status.activity), private: key === 'private' }
}

// ---- what the layer draws --------------------------------------------------------------------------------------------

export type BubbleKind = 'talk' | 'react' | 'private'

/** one agent's bubble this frame (one per agent: a new line replaces the agent's own) */
export interface BubbleItem {
  /** the agent, e.g. `agent_0`: the bubble's identity on screen */
  id: string
  /** the utterance: a different key = a new bubble (restarts typing and the entrance) */
  key: string
  /** 0..3, the colour and the tab name */
  seat: number
  kind: BubbleKind
  /** the tab's word: 대화 | 회의 | 반응 | 비공개 */
  label: string
  /** what shows (already cut to length / masked) */
  text: string
  /** characters typed so far (`text` length when done or not typed) */
  typed: number
  /** the screen-reader line, put in the log once the sentence is typed; '' = none */
  log: string
  /** the earlier line of a conversation: grey, hidden on narrow screens */
  dim: boolean
  order: number
  /** the agent it faces (two speakers open their bubbles outward) */
  pairWith: string | null
  /** "전문 보기" target: a minutes row of the library */
  open: { repo: string; n: number; row: string } | null
  /** the speaker's name for the "전문 보기" button's label */
  who: string
}
