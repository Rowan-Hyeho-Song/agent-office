// #240 "new since you last opened the approval box" (docs/design/docs-ui.md 1.6), as pure functions.
// The dot is not the `대기 N` count: the count is what is left to do, the dot is what you have not seen yet. The time of
// the last opening is kept per browser (localStorage) for the owner and visitors alike.

/** a waiting approval as the dot needs it: its id, when it was filed, and a line to read out (null = not for this viewer) */
export interface Waiting {
  id: number
  at: string
  /** owner: `메모: 5인 책상 배치`; visitors never get a title, so this is null and the announcement says `결재 서류` */
  label: string | null
}

export const SEEN_APPROVAL_KEY = 'agent-office.seen.approval'
/** how long new arrivals are gathered into one spoken announcement */
export const ANNOUNCE_GROUP_MS = 5000

const ms = (iso: string) => Date.parse(iso)

export function loadSeenAt(key: string = SEEN_APPROVAL_KEY): number | null {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
export function saveSeenAt(at: number, key: string = SEEN_APPROVAL_KEY) {
  try {
    localStorage.setItem(key, String(at))
  } catch {
    /* storage blocked: the dot just starts fresh next visit */
  }
}

/** the waiting items filed after the box was last opened; nothing stored yet = a first visit, where nothing is "new" */
export const unseenOf = (items: readonly Waiting[], seenAt: number | null): Waiting[] => (seenAt === null ? [] : items.filter((w) => ms(w.at) > seenAt))

/** what to store when the box is open and looking at these items: now, or the newest item's time if the server's clock is ahead */
export const seenNow = (items: readonly Waiting[], now: number) => items.reduce((m, w) => Math.max(m, ms(w.at) || 0), now)

/** the dot: something is waiting AND some of it is new (a count of 0 never shows a dot) */
export const showDot = (count: number | null, unseen: number) => !!count && unseen > 0

/** the button's name (the dot alone is colour, so the words carry it): `결재함, 대기 3건, 새 결재 1건` */
export function approvalName(count: number | null, unseen: number): string {
  return `결재함${count !== null ? `, 대기 ${count}건` : ''}${showDot(count, unseen) ? `, 새 결재 ${unseen}건` : ''}`
}

/** the one spoken line: a single new item names itself, several are counted */
export function announceText(items: readonly Waiting[]): string {
  if (items.length === 1) return `새 결재 1건 · ${items[0].label ?? '결재 서류'}`
  return `새 결재 ${items.length}건`
}

/**
 * Gathers what arrives within `windowMs` of the first arrival and says it once (`say` gets the whole group). A timer
 * per group, so a quiet box says nothing and a burst of three says `새 결재 3건`, not three lines.
 */
export function groupAnnouncements(say: (items: Waiting[]) => void, windowMs = ANNOUNCE_GROUP_MS) {
  let held: Waiting[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    add(items: readonly Waiting[]) {
      if (!items.length) return
      held = [...held, ...items.filter((w) => !held.some((h) => h.id === w.id))]
      timer ??= setTimeout(() => {
        const out = held
        held = []
        timer = undefined
        say(out)
      }, windowMs)
    },
    cancel() {
      clearTimeout(timer)
      timer = undefined
      held = []
    },
  }
}

/** ids that were not in the last look (`known` null = the first look of the visit, nothing is news) */
export const arrivals = (known: ReadonlySet<number> | null, items: readonly Waiting[]): Waiting[] => (known === null ? [] : items.filter((w) => !known.has(w.id)))
