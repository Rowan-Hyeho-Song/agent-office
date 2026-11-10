import { useEffect, useState, useSyncExternalStore } from 'react'
import { DockSlot } from '../office/CornerDock'
import { ROOM_MODE } from '../room/link'
import { getPanel, subscribePanel, togglePanel } from './panelState'
import { getSetting, hintSeen, isKnown, markHintSeen, setSetting, subscribe } from './settings'

// The HUD sound button (docs/design/sound.md 2.5, designer spec): top of the dock, a 34 px icon with the desk room's
// SoundToggle drawing and aria. Desktop: hovering or focusing it opens a 120 px volume slider to its left. Phones: the
// toggle only. Opened on its own (not inside the desk), sound starts off and a 4 s bubble says so on the first visit.

const useSetting = () => useSyncExternalStore(subscribe, getSetting)
const usePanel = () => useSyncExternalStore(subscribePanel, getPanel)

/** ask the button to blink (the speaker was pressed while muted, sound.md 5) */
export const flashSoundButton = () => window.dispatchEvent(new Event('office-sound-flash'))

const HINT_MS = 4000

export function SoundButton() {
  const s = useSetting()
  const panel = usePanel()
  const detailOpen = panel.open && panel.from === 'hud'
  const on = !s.muted
  const [hint, setHint] = useState(false)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (ROOM_MODE || isKnown() || hintSeen()) return
    setHint(true)
    markHintSeen()
    const id = setTimeout(() => setHint(false), HINT_MS)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined
    const onFlash = () => {
      setFlash(false)
      requestAnimationFrame(() => setFlash(true))
      clearTimeout(id)
      id = setTimeout(() => setFlash(false), 900)
    }
    window.addEventListener('office-sound-flash', onFlash)
    return () => {
      window.removeEventListener('office-sound-flash', onFlash)
      clearTimeout(id)
    }
  }, [])

  const label = on ? '소리 끄기' : '소리 켜기'
  return (
    <DockSlot slot="sound">
      <div className={`sound-dock${panel.open ? ' panel-open' : ''}`}>
        <div className="sound-volume">
          <input
            type="range"
            aria-label="음량"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.volume * 100)}
            aria-valuetext={`${Math.round(s.volume * 100)}%`}
            onChange={(e) => setSetting({ volume: Number(e.target.value) / 100, muted: false })}
          />
          <output className="sound-volume-num" aria-hidden="true">
            {Math.round(s.volume * 100)}%
          </output>
          <button
            type="button"
            className="sound-detail"
            data-sound-opener="hud"
            aria-label="소리 세부 설정"
            title="소리 세부 설정"
            aria-haspopup="dialog"
            aria-expanded={detailOpen}
            onClick={(e) => togglePanel('hud', e.currentTarget)?.focus()}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M2 3.5 H14 M2 8 H14 M2 12.5 H14" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="10.5" cy="3.5" r="1.7" fill="currentColor" />
              <circle cx="5" cy="8" r="1.7" fill="currentColor" />
              <circle cx="9.5" cy="12.5" r="1.7" fill="currentColor" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className={`dock-btn sound-toggle${on ? '' : ' off'}${flash ? ' flash' : ''}`}
          aria-pressed={on}
          aria-label={label}
          title={label}
          onClick={() => {
            // turning it on with a stored volume of 0 would stay silent: bring the volume back (#194 audible fix)
            setSetting(on ? { muted: true } : { muted: false, volume: s.volume <= 0.001 ? 1 : s.volume })
            setHint(false)
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M2 6 L5 6 L9 2.5 L9 13.5 L5 10 L2 10 Z" fill="currentColor" />
            {on ? (
              <path d="M11 5.5 Q13 8 11 10.5 M12.5 3.8 Q15.8 8 12.5 12.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            ) : (
              <path d="M11 5.5 L15 10.5 M15 5.5 L11 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            )}
          </svg>
        </button>
        {hint && (
          <p className="sound-hint" role="status">
            소리를 켜려면 누르세요
          </p>
        )}
      </div>
    </DockSlot>
  )
}
