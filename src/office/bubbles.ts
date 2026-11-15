// Speech bubbles and status tags (docs/design/office-ui.md section 3) as pure functions: the text rules, the timing, the
// placement (the design mock's fit()), the tag a status shows. src/office/bubbleLayer.ts draws; nothing here touches the DOM.

import type { AgentStatus } from './status'
import { activityLabel, taskNumber, taskOf } from './status'

/** the values of the --bubble-* / --type-* / --hold-* tokens (src/styles/tokens.css) */
export const BUBBLE = {
  /** a replayed minutes row: its first sentence, at most this long = --bubble-max-chars (fits 248px in two lines) */
  lineChars: 36,
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
  /** #137 ② C a bubble over a face screen (the phone at the omok board): kept this far inside the screen's sides, and this far from the screen top and the things it must not cover */
  faceEdge: 8,
} as const

/** the first sentence of a markdown cell, plain, at most `max` characters (the last one an ellipsis when cut) */
/** the --bubble-max-chars token when there is a page to read it from, else the default */
export function lineChars(): number {
  if (typeof document === 'undefined') return BUBBLE.lineChars
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bubble-max-chars'), 10) || BUBBLE.lineChars
}

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
  /** hangs below the head (a meeting before the whiteboard: the board stays visible) */
  down?: boolean
  /**
   * #137 ② C (at the omok board, where the head point is off the screen): a bubble by the face screen, not held to the office's safe line.
   * Over it (a phone): (x, y) is the face's top middle; the card stands over it, centred. Beside it (`beside`, a wide screen): (x, y) is
   * the face's lower right corner; the card opens up and right from there. Either way kept BUBBLE.faceEdge inside the screen's sides; only
   * when it would come within faceEdge of the screen top or of an `avoid` box (the HUD, '← 책상으로') does it hang below the face
   * (`below`: the face's lower edge) instead.
   */
  face?: { below: number; avoid: readonly Rect[]; beside?: boolean }
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
  /** the anchor's y when it is not the input's (a face bubble hanging below the face) */
  y?: number
}

export interface PlaceView {
  w: number
  h: number
  narrow: boolean
}

export interface Rect {
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

const near = (a: Rect, b: Rect, gap: number) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap

/** a bubble by a face screen (PlaceInput.face): over its top edge centred, or beside it; inside the sides; below the face when the top has no room */
function placeOverFace(i: PlaceInput, f: NonNullable<PlaceInput['face']>, p: Placed, view: PlaceView) {
  const e = BUBBLE.faceEdge
  p.side = 'right'
  p.dir = 'up'
  // over: centred on the anchor (side 'right' starts the card at x - stripe / 2); beside: from the anchor; then pushed inside the sides
  p.shift = f.beside ? 0 : BUBBLE.stripe / 2 - i.w / 2
  let r = cardRect(i, p)
  if (r.left < e) p.shift += e - r.left
  else if (r.right > view.w - e) p.shift -= r.right - (view.w - e)
  r = cardRect(i, p)
  if (r.top < e || f.avoid.some((a) => near(r, a, e))) {
    p.dir = 'down'
    p.y = f.below - BUBBLE.anchorDown
  }
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
    if (i.face) {
      placeOverFace(i, i.face, p, view)
      continue
    }
    if (i.down) p.dir = 'down'
    let r = cardRect(i, p)
    if (r.top < top && p.dir === 'up') {
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
    // raise it until it clears every earlier bubble it overlaps (a few passes: clearing one can run into another)
    for (let pass = 0; pass < 4 && (p.dir === 'up' || cur.down); pass++) {
      let moved = false
      for (let j = 0; j < k; j++) {
        const a = cardRect(live[j], out[live[j].id])
        const b = cardRect(cur, p)
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapX > 0 && overlapY > -BUBBLE.gap) {
          // its bottom edge to the other's top edge, plus the gap (a hanging one moves down past the other's bottom)
          p.stack += (p.dir === 'up' ? b.bottom - a.top : a.bottom - b.top) + BUBBLE.gap
          moved = true
        }
      }
      if (!moved) break
    }
    // stacked past the safe line by more than the stacking gap (designer, #107): hang it below the head instead
    if (p.dir === 'up' && !cur.down && cardRect(cur, p).top < top - BUBBLE.gap) {
      p.dir = 'down'
      p.stack = 0
    }
  }
  return out
}

// ---- status tags ---------------------------------------------------------------------------------------------------

export interface Tag {
  icon: string
  label: string
  private: boolean
  /** #182, another repository's issue: drawn as parts so the repo name shrinks first and the activity stays readable */
  other?: { repo: string; num: string; activity: string }
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

/** the chip over a working agent's head ("파일 편집 중"), or a night shift's (#110); null otherwise */
export function statusTag(status: AgentStatus | undefined, detail?: string): Tag | null {
  if (!status) return null
  const task = taskOf(status)
  // #182: "#170 · 파일 편집 중" (other repo: "rowansong.dev#12 · …", private: "🔒 · …"); no title on the 3D chip
  const withTask = (label: string) => (task ? `${task.private ? '🔒' : taskNumber(task)} · ${label}` : label)
  const other = (label: string) => (task && !task.private && !taskNumber(task).startsWith('#') ? { repo: task.repo, num: `#${task.issue}`, activity: label } : undefined)
  if (status.state === 'wrapping') return { icon: 'card', label: withTask(detail ?? '카드 정리 중'), private: false, other: other(detail ?? '카드 정리 중') }
  if (status.state === 'off' && status.night === 'sleep') return { icon: 'sleep', label: detail ?? '조는 중', private: false }
  if (status.state === 'idle' && status.night === 'duty') return { icon: 'coffee', label: '야간 당번', private: false }
  if (status.state !== 'working') return null
  const key = status.activity ?? 'other'
  const words = detail ?? activityLabel(status.activity)
  return { icon: ACTIVITY_ICON[key] ?? 'cmd', label: withTask(words), private: key === 'private', other: other(words) }
}

// ---- what the layer draws --------------------------------------------------------------------------------------------

export type BubbleKind = 'talk' | 'react' | 'private'

/** one agent's bubble this frame (one per agent: a new line replaces the agent's own) */
export interface BubbleItem {
  /** the agent, e.g. `agent_0`: the bubble's identity on screen */
  id: string
  /** the utterance: a different key = a new bubble (restarts typing and the entrance) */
  key: string
  /** 0..4, the colour and the tab name */
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
  /** hangs below the head: a meeting in the board circle keeps the whiteboard visible */
  down?: boolean
  order: number
  /** the agent it faces (two speakers open their bubbles outward) */
  pairWith: string | null
  /** "전문 보기" target: a minutes row of the library */
  open: { repo: string; n: number; row: string } | null
  /** the speaker's name for the "전문 보기" button's label */
  who: string
}
