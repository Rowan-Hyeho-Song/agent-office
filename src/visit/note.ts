// /api/note, minus the database (#4, office-ui.md 12.3): a visitor leaves a robot a short note, pinned on the cork board. The
// same rules as rowansong.dev's guestbook: the word filter (profanity.ts, the same list), no links, a 30 s cooldown per visitor,
// no repeats. Two more (#4 planning): the name and the note may not look like an email address or a phone number, so no
// contact details end up on a public board. The page checks as the visitor types; this is the check that counts.
//
// Nothing about the visitor is kept: the cooldown is a row in visit_cooldown (the keyed, daily IP hash of treat.ts, two minutes),
// a repeat is a note the same as one on the board (no hash needed). Pure apart from the store, so it is unit tested.

import { hasBadWord, hasLink } from './profanity.js'
import { clientIp, COOLDOWN_KEEP_MS, isVisitAgent, visitorHash } from './treat.js'

export const NOTE_MAX = 80
export const NOTE_NAME_MAX = 20
/** between two notes from the same visitor */
export const NOTE_COOLDOWN_MS = 30_000
/** the board shows the latest this many; a note the same as one of them is a repeat */
export const NOTE_BOARD = 12
export const NOTE_ANON = '익명'

export interface Note {
  id: number
  agent: string
  text: string
  /** '' = anonymous */
  name: string
  created_at: string
}

/** whitespace collapsed, control characters dropped (as the guestbook) */
export const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** an email address: something@something.tld (also with spaces around @ or "골뱅이" left to the visitor's honesty) */
const EMAIL = /[^\s@]+\s*@\s*[^\s@]+\.[a-z]{2,}/i
/** a phone number: nine or more digits, maybe split by spaces, dots, dashes or brackets (010-1234-5678, +82 10 1234 5678) */
const PHONE = /(?:\+?\d[\s.\-()]*){9,}/
export const looksLikeContact = (s: string) => EMAIL.test(s) || PHONE.test(s)

/** the reason a note can't be pinned, in the visitor's words, or null when it's fine */
export function checkNote(name: string, text: string): string | null {
  const n = tidy(name)
  const t = tidy(text)
  if (!t) return '한마디를 적어 주세요.'
  if ([...n].length > NOTE_NAME_MAX) return `이름은 ${NOTE_NAME_MAX}자까지예요.`
  if ([...t].length > NOTE_MAX) return `쪽지는 ${NOTE_MAX}자까지예요.`
  if (hasBadWord(n) || hasBadWord(t)) return '욕설이나 음란한 표현은 남길 수 없어요. 고운 말로 부탁해요.'
  // an email address also looks like a link: the more useful reason first
  if (looksLikeContact(n) || looksLikeContact(t)) return '이메일 주소나 전화번호는 남길 수 없어요. 게시판은 모두에게 보여요.'
  if (hasLink(n) || hasLink(t)) return '링크는 남길 수 없어요.'
  return null
}

export interface NoteStore {
  /** the newest cooldown row of this hash (any robot), ms since the epoch; null without one */
  lastCooldown(hash: string): Promise<number | null>
  putCooldown(hash: string, agent: string, at: Date, before: Date): Promise<void>
  /** the texts of the latest NOTE_BOARD notes on the board */
  recentTexts(): Promise<string[]>
  add(row: { agent: string; text: string; name: string; at: Date }): Promise<Note>
}

export interface NoteConfig {
  secret: string
  now?: () => Date
  signal?: () => Promise<unknown>
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * POST {agent, text, name?}. Answers 200 {note} (pinned and signalled), 400 {error} with the reason in the visitor's words,
 * 429 {retryS} (30 s since this visitor's last note), 409 {error} (the same note is on the board already).
 */
export async function handleNote(req: Request, store: NoteStore, cfg: NoteConfig): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const { agent, text, name } = (body ?? {}) as { agent?: unknown; text?: unknown; name?: unknown }
  if (!isVisitAgent(agent) || typeof text !== 'string' || (name !== undefined && typeof name !== 'string')) return json({ error: 'bad request' }, 400)
  const why = checkNote(name ?? '', text)
  if (why) return json({ error: why }, 400)
  const now = cfg.now?.() ?? new Date()
  const hash = await visitorHash(cfg.secret, clientIp(req), 'note', now)
  const last = await store.lastCooldown(hash)
  if (last !== null && now.getTime() - last < NOTE_COOLDOWN_MS) return json({ retryS: Math.ceil((NOTE_COOLDOWN_MS - (now.getTime() - last)) / 1000) }, 429)
  const t = tidy(text)
  if ((await store.recentTexts()).some((x) => tidy(x) === t)) return json({ error: '같은 쪽지가 이미 붙어 있어요.' }, 409)
  await store.putCooldown(hash, agent, now, new Date(now.getTime() - COOLDOWN_KEEP_MS))
  const note = await store.add({ agent, text: t, name: tidy(name ?? ''), at: now })
  await cfg.signal?.()
  return json({ note })
}
