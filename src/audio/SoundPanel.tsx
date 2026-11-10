import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { previewClick } from './cues'
import { DEFAULT_LEVELS, getSetting, resetLevels, setSetting, subscribe } from './settings'
import {
  LEVELS,
  PANEL_W,
  closePanel,
  fromPct,
  previewsOnRelease,
  getPanel,
  getTurntableBox,
  outsideClosesPanel,
  placePopover,
  subscribePanel,
  subscribeTurntableBox,
  toPct,
  valueText,
  type LevelKey,
} from './panelState'

// The sound settings panel (docs/design/office-ui.md section 11, #353): a popover by the turntable (or the HUD's 세부
// button), a bottom sheet on phones. The values are the shared sound setting, so the HUD button shows the same ones.

const useSetting = () => useSyncExternalStore(subscribe, getSetting)
const usePanel = () => useSyncExternalStore(subscribePanel, getPanel)
const useNarrow = () => {
  const [n, setN] = useState(() => matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const m = matchMedia('(max-width: 640px)')
    const f = () => setN(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return n
}

export const SpeakerIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path d="M2 6 L5 6 L9 2.5 L9 13.5 L5 10 L2 10 Z" fill="currentColor" />
    {on ? (
      <path d="M11 5.5 Q13 8 11 10.5 M12.5 3.8 Q15.8 8 12.5 12.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    ) : (
      <path d="M11 5.5 L15 10.5 M15 5.5 L11 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    )}
  </svg>
)

/** give focus back to where the panel was opened from (the HUD button, or the canvas) */
const giveBack = (el: HTMLElement | null) => {
  if (!el) return
  if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|A)$/.test(el.tagName)) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

export function SoundPanel() {
  const { open } = usePanel()
  const s = useSetting()
  const narrow = useNarrow()
  const ref = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [reset, setReset] = useState(false)
  const timers = useRef<{ reset?: ReturnType<typeof setTimeout>; key?: ReturnType<typeof setTimeout> }>({})
  const close = useCallback(() => giveBack(closePanel()), [])

  // focus goes to 전체 on open
  useEffect(() => {
    if (open) firstRef.current?.focus({ preventScroll: true })
    else setReset(false)
  }, [open])
  useEffect(
    () => () => {
      clearTimeout(timers.current.reset)
      clearTimeout(timers.current.key)
    },
    [],
  )

  // close rules: Esc, a click (not a camera drag) outside. The turntable and the HUD button toggle themselves.
  useEffect(() => {
    if (!open) return
    let down: [number, number] | null = null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
    const onClick = (e: MouseEvent) => {
      const moved = down ? Math.hypot(e.clientX - down[0], e.clientY - down[1]) : 0
      const t = e.target as Element | null
      const inside = !!ref.current && !!t && ref.current.contains(t)
      const onOpener = !!t?.closest?.('[data-sound-opener]') || document.documentElement.dataset.turntablePick === '1'
      if (outsideClosesPanel(moved, inside, onOpener)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('click', onClick)
    }
  }, [open, close])

  // where it sits: next to the turntable (follows the camera, written to the style without a React render), or the HUD button
  const place = useCallback(() => {
    const el = ref.current
    if (!el || narrow) return
    let target = getTurntableBox()
    let prefer: 'right' | 'left' = 'right'
    if (getPanel().from === 'hud') {
      const b = document.querySelector('[data-sound-opener="hud"]')?.getBoundingClientRect()
      target = b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null
      prefer = 'left'
    }
    if (!target) return
    const p = placePopover(target, window.innerWidth, window.innerHeight, el.offsetHeight, prefer)
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
    el.dataset.side = p.side
    el.dataset.tail = p.tail ? '1' : '0'
    el.style.setProperty('--tail-y', `${Math.round(p.tailY)}px`)
    el.style.visibility = 'visible'
  }, [narrow])
  useLayoutEffect(() => {
    if (open) place()
  }, [open, narrow, place, s.muted, reset])
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', place)
    const off = subscribeTurntableBox(place)
    return () => {
      window.removeEventListener('resize', place)
      off()
    }
  }, [open, place])

  if (!open) return null

  const atDefault = (Object.keys(DEFAULT_LEVELS) as LevelKey[]).every((k) => s[k] === DEFAULT_LEVELS[k])
  const doReset = () => {
    if (atDefault) return
    resetLevels()
    setReset(true)
    clearTimeout(timers.current.reset)
    timers.current.reset = setTimeout(() => setReset(false), 1500)
  }
  // 전체 and 효과음 let go: one click at the new level (배경음악 has none: the music itself is the preview).
  // Keys: 150 ms after the last one.
  const preview = (k: LevelKey, how: 'now' | 'later') => {
    if (!previewsOnRelease(k)) return
    clearTimeout(timers.current.key)
    if (how === 'now') previewClick()
    else timers.current.key = setTimeout(() => previewClick(), 150)
  }

  return (
    <>
      {narrow && <div className="sound-dim" onClick={close} aria-hidden="true" />}
      <div
        ref={ref}
        className={`sound-panel${narrow ? ' sheet' : ''}${s.muted ? ' muted' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="sound-panel-title"
        style={narrow ? undefined : { width: PANEL_W, visibility: 'hidden' }}
      >
        {narrow && <span className="sound-grip" aria-hidden="true" />}
        <div className="sound-head">
          <h2 id="sound-panel-title">소리</h2>
          {s.muted && <span className="sound-off">꺼짐</span>}
          <button
            type="button"
            className="sound-ib sound-mute"
            aria-pressed={!s.muted}
            aria-label={s.muted ? '소리 켜기' : '소리 끄기'}
            onClick={() => setSetting(s.muted ? { muted: false, volume: s.volume <= 0.001 ? 1 : s.volume } : { muted: true })}
          >
            <SpeakerIcon on={!s.muted} />
          </button>
          <button type="button" className="sound-ib" aria-label="소리 설정 닫기" onClick={close}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
        {LEVELS.map((l, i) => {
          const pct = toPct(s[l.key])
          return (
            <div className="sound-row" key={l.key}>
              <div className="sound-top">
                <label className="sound-name" htmlFor={`sound-${l.key}`}>{l.label}</label>
                <small id={`sound-${l.key}-d`}>{l.hint}</small>
                <output className="sound-val" aria-hidden="true">
                {pct}%
              </output>
              </div>
              <input
                id={`sound-${l.key}`}
                ref={i === 0 ? firstRef : undefined}
                type="range"
                min={0}
                max={100}
                step={5}
                value={pct}
                style={{ '--fill': `${pct}%` } as CSSProperties}
                aria-valuetext={valueText(l.label, s[l.key])}
                aria-describedby={`sound-${l.key}-d`}
                onChange={(e) => setSetting({ [l.key]: fromPct(Number(e.target.value)), muted: false })}
                onPointerUp={() => preview(l.key, 'now')}
                onKeyUp={(e) => /^(Arrow|Page|Home$|End$)/.test(e.key) && preview(l.key, 'later')}
              />
            </div>
          )
        })}
        <div className="sound-foot">
          <button type="button" className="sound-reset" aria-disabled={atDefault} onClick={doReset}>
            기본값으로
          </button>
          <span className="sound-done" role="status">
            {reset ? '되돌렸어요' : ''}
          </span>
        </div>
      </div>
    </>
  )
}
