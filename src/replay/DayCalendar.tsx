import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { dayId, monthOf, monthTitle, monthWeeks, moveFocus, shiftMonth, type DayInfo, type YearMonth } from './days'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const sameMonth = (a: YearMonth, b: YearMonth) => a.y === b.y && a.m === b.m

/**
 * The date picker (timelapse.md 10.3): a month of days, the days that have points pressable with their count under the
 * number. WAI-ARIA date picker dialog: arrows move a day / week, PageUp / PageDown a month, Home / End the week's ends,
 * Enter / Space pick, Esc closes (the caller returns the focus to its button). `sheet` is the phone's bottom sheet.
 */
export function DayCalendar({ days, selected, sheet, onPick, onClose }: { days: readonly DayInfo[]; selected: string; sheet: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const title = useId()
  const root = useRef<HTMLDivElement>(null)
  const [month, setMonth] = useState<YearMonth>(() => monthOf(selected))
  const [focus, setFocus] = useState(selected)
  const prev = shiftMonth(days, month, -1)
  const next = shiftMonth(days, month, 1)
  const today = dayId(Date.now())
  const weeks = monthWeeks(month, days)

  // the focus goes to the chosen day when it opens, and follows the roving cell afterwards
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus({ preventScroll: true })
  }, [focus, month])

  const goMonth = (to: YearMonth | null) => {
    if (!to) return
    setMonth(to)
    // keep the focus in the month shown: the same day number, else its last day
    const d = Number(focus.slice(8, 10))
    const last = new Date(Date.UTC(to.y, to.m, 0)).getUTCDate()
    setFocus(`${to.y}-${String(to.m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // one layer at a time: this Esc is the calendar's, the replay stays
      e.preventDefault()
      e.stopPropagation()
      return onClose()
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const to = moveFocus(focus, e.key, days)
    if (to === focus && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    if (!sameMonth(monthOf(to), month)) setMonth(monthOf(to))
    setFocus(to)
  }
  // a press outside closes it (the date button toggles it itself)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t && !root.current?.contains(t) && !t.closest('[data-day-button]')) onClose()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [onClose])

  return (
    <div ref={root} className={`replay-cal${sheet ? ' sheet' : ''}`} role="dialog" aria-modal="false" aria-labelledby={title} onKeyDown={onKey}>
      <div className="cal-head">
        <h2 id={title} aria-live="polite">{monthTitle(month)}</h2>
        <button type="button" className="cal-nav" aria-label="이전 달" aria-disabled={!prev} onClick={() => goMonth(prev)}>‹</button>
        <button type="button" className="cal-nav" aria-label="다음 달" aria-disabled={!next} onClick={() => goMonth(next)}>›</button>
      </div>
      <table role="grid" aria-labelledby={title}>
        <thead>
          <tr role="row">
            {WEEK.map((w) => (
              <th key={w} role="columnheader" scope="col" abbr={`${w}요일`}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, r) => (
            <tr key={r} role="row">
              {week.map((c, k) =>
                c ? (
                  <td key={c.id} role="gridcell" aria-selected={c.id === selected}>
                    <button
                      type="button"
                      data-day={c.id}
                      className={`cal-day${c.enabled ? ' has' : ''}${c.id === selected ? ' on' : ''}${c.id === today ? ' today' : ''}`}
                      tabIndex={c.id === focus ? 0 : -1}
                      aria-disabled={!c.enabled}
                      aria-current={c.id === today ? 'date' : undefined}
                      onClick={() => c.enabled && onPick(c.id)}
                    >
                      <span className="sr-only">{c.name}</span>
                      <span className="n" aria-hidden="true">{c.day}</span>
                      {c.enabled && <span className="c" aria-hidden="true">{c.count}</span>}
                      {c.bar > 0 && <span className="bar" style={{ height: c.bar }} aria-hidden="true" />}
                    </button>
                  </td>
                ) : (
                  <td key={`${r}-${k}`} role="gridcell" aria-hidden="true" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
