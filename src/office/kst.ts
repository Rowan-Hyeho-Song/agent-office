// Seoul wall time for the office's day / night (#110). Zone-explicit through Intl, never the machine's zone
// (same approach as the wall clock in clock.ts). Pure.

const ZONE = 'Asia/Seoul'
const HOUR_MS = 3_600_000

/** the night: lights go off from 23:00 and the office wakes at 09:00 (KST) */
export const NIGHT_START_MIN = 23 * 60
export const NIGHT_END_MIN = 9 * 60

// made once: building a DateTimeFormat costs far more than formatting with it, and the Director asks for the time several times a frame
// (the day simulation spent two thirds of its time making these)
const HM = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' })
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE })

/** minutes since KST midnight (0..1439) */
export function kstMinutes(ms: number): number {
  const parts = HM.formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return (get('hour') % 24) * 60 + get('minute')
}

/** KST 23:00 - 09:00 */
export function isNight(ms: number): boolean {
  const m = kstMinutes(ms)
  return m >= NIGHT_START_MIN || m < NIGHT_END_MIN
}

/** 'YYYY-MM-DD' (KST) of the evening the current night began: 01:00 on the 9th is still the night of the 8th */
export function nightDate(ms: number): string {
  return DAY.format(new Date(ms - 9 * HOUR_MS))
}

/** minutes since the night began (23:00); 0 or more at night, meaningless by day */
export function minutesIntoNight(ms: number): number {
  const m = kstMinutes(ms)
  return m >= NIGHT_START_MIN ? m - NIGHT_START_MIN : m + 24 * 60 - NIGHT_START_MIN
}

/** the instant of 'HH:MM' (KST) on the KST day of `now`; null when the text isn't a time */
export function kstTimeToMs(text: string, now = Date.now()): number | null {
  const m = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  const day = DAY.format(new Date(now))
  return Date.parse(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00+09:00`)
}
