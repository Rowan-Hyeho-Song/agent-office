// The meeting replay (docs/plan.md 6.4) as pure functions: a minutes document -> a script (who speaks, to whom, what
// shows, for how long), the script at a moment in time -> what is on screen, which past minutes to replay when nothing
// is new. The scene (meetingRun.ts) walks the agents; the layer (bubbleLayer.ts) draws the frames.
//
// Privacy: a script is built from what THIS viewer may read. A SECRET document (not readable for a visitor) gets an
// invented scene from its cover only (who attended), the words as black bars; a private one a lock instead of words.
// The text of a document that is not approved is masked even where the viewer can read it.

import { whoOf, type Conversation, type DocMeta } from '../docs/library'
import { firstSentence, lineChars, holdMs, logLine, maskText, typeMs, typedCount } from './bubbles'

export const ROLE = ['기획', '3D', '디자인', '코더', '사운드']
/** `메모(기획)`: the name the screen-reader log uses */
export const seatName = (seat: number) => `${whoOf({ seat: seat as 0 | 1 | 2 | 3 | 4 }).ko}(${ROLE[seat]})`
const MAX_LINES = 8

export interface ScriptLine {
  /** the minutes row's address (`1-3`), or `s1`.. for an invented SECRET line */
  key: string
  from: number | 'owner'
  /** the agents it is said to (the planner's mock "to" cell); the owner is not an agent */
  to: number[]
  toOwner: boolean
  /** what shows: the sentence cut to 36 characters, or blocks, or the lock's words */
  text: string
  /** the original sentence, '' when masked or private (never leaves the viewer's own data) */
  full: string
  masked: boolean
  private: boolean
  /** ms from the first line */
  startMs: number
  typeMs: number
  holdMs: number
  /** a 1:1 row of the timelapse (timelapse.md 11.2): the sender hands the receiver a paper while it shows */
  pass?: boolean
  /** the elision marker of a long minutes point (11.4): how many rows it stands for; its text is `· · · N줄` */
  gap?: number
  /** the row's place in the table, 1-based (the day view's `회의 4/9줄`) */
  row?: number
  /** a pass row: ms into the line when the receiver starts to read (the caption line shows the words from then) */
  readAt?: number
}

/** gather = 3+ at the circle; walk = a 1:1 of several rows, the sender walks to the receiver; pair = a 1:1 of one row, passed from the desk; seat = one agent and the owner */
export type MinutesMode = 'gather' | 'walk' | 'pair' | 'seat'
export type RowBase = Omit<ScriptLine, 'startMs' | 'typeMs' | 'holdMs' | 'pass' | 'gap' | 'readAt'>

/** what a timelapse minutes script is made of (src/office/minutes.ts plans it): every table row, untimed, and how it plays */
export interface MinutesInfo {
  mode: MinutesMode
  /** the speed it is timed for (1, 4, 16) */
  speed: number
  rows: RowBase[]
}

export interface MeetingScript {
  /** `<doc id>` (stable across viewers: the same document is the same scene) */
  id: string
  docId: number
  repo: string | null
  n: number | null
  /** SECRET for this viewer's eyes (blocks), or private (lock) */
  secret: boolean
  private: boolean
  /** the agents at the meeting, in order of first appearance (formation seat 0, 1, 2, 3, formation.ts) */
  seats: number[]
  lines: ScriptLine[]
  /** when the last hold ends */
  linesMs: number
  /** the **결정** line: the planner pins it on the whiteboard */
  decision: string | null
  /** the **후속** line's owners: they walk to their seats */
  followUps: number[]
  masked: boolean
  /** typed in full at once (reduced motion) */
  reduced: boolean
  /** a timelapse minutes point (timelapse.md 11): all the rows, timed for a speed */
  minutes?: MinutesInfo
}

const nameOf = (seat: number) => whoOf({ seat: seat as 0 | 1 | 2 | 3 | 4 }).ko
/** `→ 휴` / `→ 주인`: who a row is said to (the bubble's tab), null when to nobody */
export const tagOf = (l: Pick<ScriptLine, 'to' | 'toOwner'>) => (l.toOwner ? '→ 주인' : l.to[0] !== undefined ? `→ ${nameOf(l.to[0])}` : null)
/** the owner's row as the terminal line on the door screen: `> 주인 → 휴: 내용` */
export const doorLine = (l: Pick<ScriptLine, 'to' | 'text'>) => `> 주인${l.to[0] !== undefined ? ` → ${nameOf(l.to[0])}` : ''}: ${l.text}`

const seatOf = (who: { seat: string }) => (/^[0-4]$/.test(who.seat) ? Number(who.seat) : null)

/** which agents a free-text line names ("루프가 …", "기획", "3D"), in order of appearance */
export function namedSeats(text: string): number[] {
  const out: number[] = []
  const re = /(?<![가-힣])(메모|메시|휴|루프)(?:가|는|은|를|을|에게|의|와|과|한테|이)?(?![가-힣])|(기획|3D|디자인|코더)/g
  for (const m of text.matchAll(re)) {
    const seat = m[1] ? ['메모', '메시', '휴', '루프'].indexOf(m[1]) : ['기획', '3D', '디자인', '코더', '사운드'].indexOf(m[2])
    if (seat >= 0 && !out.includes(seat)) out.push(seat)
  }
  return out
}

/** timing: lines one after another, each typed and then held (a second speaker waits for the first's hold) */
export function retime(lines: Omit<ScriptLine, 'startMs' | 'typeMs' | 'holdMs'>[], reduced = false): { lines: ScriptLine[]; linesMs: number } {
  let t = 0
  const out = lines.map((l) => {
    const len = [...l.text].length
    const line: ScriptLine = { ...l, startMs: t, typeMs: typeMs(len, reduced), holdMs: holdMs(len) }
    t += line.typeMs + line.holdMs
    return line
  })
  return { lines: out, linesMs: t }
}

const ordered = (seats: (number | 'owner')[]) => seats.filter((s, i): s is number => s !== 'owner' && seats.indexOf(s) === i)

/** a small deterministic generator, so an invented scene is the same for every viewer */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** blocks in words of 2..5, about `len` characters (the look of a sentence, no content) */
function bars(rand: () => number, len: number): string {
  const words: string[] = []
  let n = 0
  while (n < len) {
    const w = Math.min(len - n, 2 + Math.floor(rand() * 4))
    words.push('█'.repeat(w))
    n += w + 1
  }
  return words.join(' ')
}

/** a scene for a document the viewer cannot read: who attended (the cover) takes turns, the words hidden */
function inventedLines(meta: DocMeta, isPrivate: boolean): Omit<ScriptLine, 'startMs' | 'typeMs' | 'holdMs'>[] {
  const rand = mulberry32(meta.id * 7919 + 17)
  let seats = ordered(meta.agents.filter((s) => s >= 0 && s <= 4))
  // a meeting needs two: fill up deterministically from the document's id
  for (let k = 0; seats.length < 2 && k < 5; k++) {
    const s = (meta.id + k) % 5
    if (!seats.includes(s)) seats = [...seats, s]
  }
  const count = 3 + Math.floor(rand() * 3)
  return Array.from({ length: count }, (_, i) => {
    const from = seats[i % seats.length]
    const to = seats[(i + 1) % seats.length]
    return {
      key: `s${i + 1}`,
      from,
      to: [to],
      toOwner: false,
      text: isPrivate ? '비공개 대화' : bars(rand, 14 + Math.floor(rand() * 20)),
      full: '',
      masked: true,
      private: isPrivate,
    }
  })
}

/** the real lines of a readable document: each 협의 기록 row = one line (first sentence, 36 characters) */
function realLines(convs: Conversation[], mask: boolean, max: number): Omit<ScriptLine, 'startMs' | 'typeMs' | 'holdMs'>[] {
  const out: Omit<ScriptLine, 'startMs' | 'typeMs' | 'holdMs'>[] = []
  for (const c of convs) {
    for (const u of c.lines) {
      const from = u.owner ? 'owner' : seatOf(u.from)
      if (from === null) continue // a name that is not one of the five: nobody to stand there
      const shown = firstSentence(u.text, lineChars())
      if (!shown) continue
      out.push({
        key: u.key,
        from,
        to: u.to.map(seatOf).filter((s): s is number => s !== null),
        toOwner: u.to.some((w) => w.seat === 'owner'),
        text: mask ? maskText(shown) : shown,
        full: mask ? '' : u.text,
        masked: mask,
        private: false,
      })
    }
  }
  return out.slice(0, max)
}

export interface BuildOptions {
  reduced?: boolean
  /** how many rows at most (the live meeting plays 8; the timelapse plays them all) */
  maxLines?: number
}

/**
 * The script of one minutes document for this viewer. `convs` is the parsed body (conversations(data.minutes)) when
 * the viewer may read it; for a SECRET / private one pass null (its body must never have been fetched).
 */
export function buildScript(meta: DocMeta, convs: Conversation[] | null, opts: BuildOptions = {}): MeetingScript {
  const isPrivate = meta.grade === 'private'
  const readable = meta.readable && !isPrivate && convs !== null
  // readable but not approved (the owner's view of a SECRET one): the same scene a visitor would see, words hidden
  const masked = !readable || !meta.approved
  const raw = readable ? realLines(convs, masked, opts.maxLines ?? MAX_LINES) : inventedLines(meta, isPrivate)
  const { lines, linesMs } = retime(raw, opts.reduced)
  const all = ordered(lines.flatMap((l) => [l.from, ...l.to]))
  const last = readable ? [...convs].reverse() : []
  const decision = last.find((c) => c.decision)?.decision ?? null
  const followUp = last.find((c) => c.followUp)?.followUp ?? null
  const lastSpeaker = [...lines].reverse().find((l) => l.from !== 'owner')?.from
  const owners = followUp ? namedSeats(followUp) : []
  return {
    id: String(meta.id),
    docId: meta.id,
    repo: meta.repo,
    n: meta.folder,
    secret: !readable && !isPrivate,
    private: isPrivate,
    seats: all,
    lines,
    linesMs,
    decision: decision ? (masked ? maskText(firstSentence(decision, lineChars())) : firstSentence(decision, lineChars())) : null,
    followUps: followUp ? (owners.length ? owners : typeof lastSpeaker === 'number' ? [lastSpeaker] : []) : [],
    masked,
    reduced: !!opts.reduced,
  }
}

/** who is actually in the office: drop the lines of absent agents and re-time (the rest of the scene is unchanged) */
export function trimScript(script: MeetingScript, present: number[]): MeetingScript {
  const keep = (l: ScriptLine) => l.from === 'owner' || present.includes(l.from)
  const { lines, linesMs } = retime(script.lines.filter(keep).map(({ startMs: _s, typeMs: _t, holdMs: _h, ...l }) => ({ ...l, to: l.to.filter((s) => present.includes(s)) })), script.reduced)
  return { ...script, lines, linesMs, seats: script.seats.filter((s) => present.includes(s)), followUps: script.followUps.filter((s) => present.includes(s)) }
}

// ---- the script at a moment ----------------------------------------------------------------------------------------

export interface MeetingBubble {
  seat: number
  /** the line's address: a new key = a new bubble */
  key: string
  kind: 'talk' | 'private'
  text: string
  typed: number
  full: string
  masked: boolean
  /** an earlier line (a later one by someone else is on screen) */
  dim: boolean
  order: number
  /** the agent this line is said to */
  pairWith: number | null
  /** the screen-reader line (never the words of a masked line) */
  log: string
  /** the row to open with "전문 보기": null when masked */
  row: string | null
  /** the tab's words: `→ 휴` (timelapse minutes), else the plain `회의` */
  tag: string | null
}

export interface MeetingFrame {
  /** index of the line being spoken; -1 before the first, lines.length after the last */
  index: number
  ended: boolean
  speaker: number | null
  addressee: number | null
  bubbles: MeetingBubble[]
  /** the owner's line: shown on the door screen (typed so far) */
  door: { key: string; text: string; typed: number; masked: boolean; log: string } | null
}

/** the logged sentence of a line: the words when readable, else only that a (secret) meeting is going on */
function logOf(l: ScriptLine): string {
  const from = l.from === 'owner' ? '사용자' : seatName(l.from)
  const to = l.toOwner ? '사용자' : l.to[0] !== undefined ? seatName(l.to[0]) : null
  if (l.private) return logLine(from, null, '비공개 대화')
  return logLine(from, to, l.masked ? '(SECRET 회의록, 내용 가림)' : l.full)
}

/** everything on screen `t` ms after the first line begins: a pure function of time, so it can be scrubbed */
export function frameAt(script: MeetingScript, t: number): MeetingFrame {
  const { lines } = script
  const empty: MeetingFrame = { index: lines.length, ended: true, speaker: null, addressee: null, bubbles: [], door: null }
  if (!lines.length || t >= script.linesMs) return empty
  let index = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= t) index = i
  if (index < 0) return { ...empty, index: -1, ended: false }
  const cur = lines[index]
  const typedOf = (l: ScriptLine, i: number) => (i === index ? typedCount([...l.text].length, t - l.startMs, script.reduced) : [...l.text].length)
  const bubbles: MeetingBubble[] = []
  const seats = [...new Set(lines.slice(0, index + 1).map((l) => l.from))]
  for (const seat of seats) {
    if (seat === 'owner') continue
    let j = -1
    for (let i = 0; i <= index; i++) if (lines[i].from === seat) j = i
    const l = lines[j]
    bubbles.push({
      seat,
      key: `${script.id}:${l.key}`,
      kind: l.private ? 'private' : 'talk',
      text: l.text,
      typed: typedOf(l, j),
      full: l.full,
      masked: l.masked,
      dim: j !== index || l.gap !== undefined,
      order: j,
      pairWith: l.to[0] ?? null,
      log: logOf(l),
      row: l.masked || l.private || !script.repo || !script.n || l.gap !== undefined ? null : l.key,
      tag: l.gap !== undefined ? '생략' : script.minutes ? tagOf(l) : null,
    })
  }
  const doorText = cur.from === 'owner' ? doorLine(cur) : ''
  const door = cur.from === 'owner' ? { key: `${script.id}:${cur.key}`, text: script.minutes ? doorText : cur.text, typed: script.minutes ? typedCount([...doorText].length, t - cur.startMs, script.reduced) : typedOf(cur, index), masked: cur.masked, log: logOf(cur) } : null
  return {
    index,
    ended: false,
    speaker: typeof cur.from === 'number' ? cur.from : null,
    addressee: cur.to[0] ?? null,
    bubbles,
    door,
  }
}

// ---- which minutes to replay when nothing is new ----------------------------------------------------------------------

const HOUR = 3600_000
/** the idle replay starts in this minute of the hour (UTC-based, like the play schedule: every visitor sees the same scene) */
export const REPLAY_FROM_MINUTE = 20
export const REPLAY_WINDOW_MINUTES = 5

export const hourOf = (now: number) => Math.floor(now / HOUR)

/** every minutes document, oldest first; the pick of an hour is a fixed function of the hour */
export function pickReplay(metas: DocMeta[], now: number): DocMeta | null {
  const minutes = metas.filter((m) => m.kind === 'minutes').sort((a, b) => a.id - b.id)
  if (!minutes.length) return null
  const hour = hourOf(now)
  return minutes[Math.floor(mulberry32(hour * 2654435761)() * minutes.length)]
}

/** it is time for the idle replay of this hour (once per hour, in its first minutes) */
export function replayDue(now: number, lastHour: number | null): boolean {
  const minute = Math.floor((now % HOUR) / 60_000)
  return minute >= REPLAY_FROM_MINUTE && minute < REPLAY_FROM_MINUTE + REPLAY_WINDOW_MINUTES && lastHour !== hourOf(now)
}

/** minutes documents that were not in the previous list (or changed since): a new meeting happened */
export function newMinutes(prev: DocMeta[] | null, next: DocMeta[]): DocMeta[] {
  if (!prev) return [] // the first answer is the baseline, not news
  return next.filter((m) => m.kind === 'minutes' && !prev.some((p) => p.id === m.id && p.updated_at === m.updated_at))
}

