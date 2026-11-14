// #4 12.4: `· 지금 3명이 보고 있어요` at the end of the hint line. Nothing without Supabase (the practice mode has no one
// else to count). The line itself always reads what it shows; a change is announced (polite) at most every 5 s.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { pageViewers, viewersText, VIEWERS_SAY_MS, type PresenceWire } from './viewers'

/** `wire` for tests; the page's one shared channel otherwise (a new wire per render made every render leave and join, #452) */
export function ViewerCount({ wire = pageViewers(supabase) }: { wire?: PresenceWire | null }) {
  const [n, setN] = useState<number | null>(null)
  const [said, setSaid] = useState('')
  const last = useRef(0)
  useEffect(() => (wire ? wire.join(setN) : undefined), [wire])
  useEffect(() => {
    if (n === null) return
    const wait = Math.max(0, last.current + VIEWERS_SAY_MS - Date.now())
    const t = window.setTimeout(() => {
      last.current = Date.now()
      setSaid(viewersText(n).replace(/^· /, ''))
    }, wait)
    return () => window.clearTimeout(t)
  }, [n])
  if (n === null) return null
  return (
    <>
      {' '}
      <span className="hud-viewers">
        <span className="hud-viewers-long">{viewersText(n)}</span>
        <span className="hud-viewers-short" aria-hidden="true">
          {viewersText(n, true)}
        </span>
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {said}
      </span>
    </>
  )
}
