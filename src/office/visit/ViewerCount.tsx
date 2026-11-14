// #4 12.4: `· 지금 3명이 보고 있어요` at the end of the hint line. Nothing without Supabase (the practice mode has no one
// else to count). The number changes at once; a screen reader hears it at most every 5 s.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { supabaseViewers, viewersText, VIEWERS_SAY_MS, type PresenceWire } from './viewers'

export function ViewerCount({ wire = supabase ? supabaseViewers(supabase) : null }: { wire?: PresenceWire | null }) {
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
      <span className="hud-viewers" aria-hidden="true">
        <span className="hud-viewers-long">{viewersText(n)}</span>
        <span className="hud-viewers-short">{viewersText(n, true)}</span>
      </span>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </>
  )
}
