import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The bottom-right dock (#167, designer): the launchers that used to each sit at a hand-set `bottom` (and hid one
// another) stand in one column here, bottom up: 결재함 (shows a state, nearest the hand) · 서재 · 타임랩스 (changes
// the mode, on top). Each launcher stays in its own component and portals into its slot, so the order on screen and
// the Tab order are the slots' DOM order whatever renders first. The dock hides (CSS) while a panel or the replay
// covers the right side.

export type DockSlotName = 'approval' | 'docs' | 'replay' | 'sound'
/** bottom up; the sound button sits on top (docs/design/sound.md 2.5) */
const SLOTS: DockSlotName[] = ['approval', 'docs', 'replay', 'sound']
const slotId = (s: DockSlotName) => `dock-${s}`

export function CornerDock() {
  return (
    <nav className="corner-dock" aria-label="바로 가기">
      {SLOTS.map((s) => (
        <div key={s} id={slotId(s)} className="dock-slot" />
      ))}
    </nav>
  )
}

/** render a launcher into its dock slot (nothing until the dock is on the page) */
export function DockSlot({ slot, children }: { slot: DockSlotName; children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setEl(document.getElementById(slotId(slot))), [slot])
  return el ? createPortal(children, el) : null
}
