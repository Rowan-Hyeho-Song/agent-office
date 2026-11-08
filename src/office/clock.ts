// The wall clock (#82): hands show Asia/Seoul time; the timelapse can override the time (setClockTime).

const TAU = Math.PI * 2

/** hand angles about the dial normal, radians; clockwise = negative. Zone-explicit, never the machine's. */
export function clockAngles(date: Date, timeZone = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const h = get('hour') % 12
  const m = get('minute') + get('second') / 60
  return { hour: -((h + m / 60) / 12) * TAU, minute: -(m / 60) * TAU }
}

let override: Date | null = null
const listeners = new Set<() => void>()

/** drive the clock with another instant (replay time); null = back to now */
export function setClockTime(date: Date | null) {
  override = date
  listeners.forEach((l) => l())
}
/** the instant shown: the override, else now */
export const clockTime = () => override ?? new Date()
export const onClockOverride = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

/** debug: 'HH:MM[:SS]' (Seoul time, today's date) -> override; anything else clears it */
export function setClockFromText(text: string | null) {
  const m = text?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return setClockTime(null)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  setClockTime(new Date(`${day}T${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}+09:00`))
}

/** the timelapse (#82) sets what a click on the clock does */
let clickHandler: (() => void) | null = null
export const setClockClick = (h: (() => void) | null) => void (clickHandler = h)
export const onClockClick = () => clickHandler?.()
