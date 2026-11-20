import { useEffect, useRef, useState } from 'react'
import { SPEEDS, SPEED_NAME, type Speed, type VisitorPP } from '../../play/visitorPingpong'
import { tagOnScreen } from '../omokVisit/pose'
import { AGENT_INFO, officeNow, prefersReducedMotion, type OfficeWorld } from '../world'
import { capResult, chipText, hudBit, momentSaid } from '../../play/workHold'
import { WorkChip } from '../WorkChip'
import {
  closePingpong, easyPingpong, getPingpongVisit, openPingpong, pingpongHelped, restartPingpong, spacePingpong, speedPingpong, usePingpongVisit,
} from './store'
import { setTagEl, useTagAway } from '../playHover'

// The page side of the visitor's paddle (#137 ③, play.md 3.1 · 3.3 · 4 · 5.4): the "🏓 라켓 잡기" tag over the near end, the score at the top
// (`당신 1 : 2 루프`, 24 px), the HUD at the bottom (what to do now, speed, 자동 따라가기, 다시 하기, 그만두기), the first-time help (4 s), Space
// and Esc. While the visitor plays, the docks and the agent list are hidden (html[data-pingpong], styles.css). The camera and the paddle: PingpongVisitRig.

const shortName = (a: string) => AGENT_INFO[a]?.name.split(' ')[0] ?? a
/** 이/가, 와/과 after a name (the last syllable's final consonant) */
const final = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 !== 0
}
const wa = (w: string) => `${w}${final(w) ? '과' : '와'}`
const HELP_MS = 4000

/** what the HUD says now (play.md 3.2 · 3.3) */
export function ppStatus(m: VisitorPP, name: string, touch: boolean, ready = true, work?: string, stopped = false): string {
  // #601 wound up past the call to work's cap; called to work, one more word (play.md 10.2 · 10.3)
  if (stopped) return capResult(name)
  const line = ppLine(m, name, touch, ready)
  return work && m.phase !== 'over' ? `${line} · ${work}` : line
}

function ppLine(m: VisitorPP, name: string, touch: boolean, ready: boolean): string {
  if (!ready && m.phase !== 'over') return `${name}${final(name) ? '이' : '가'} 자리로 가는 중…`
  if (m.phase === 'over') return m.score[0] > m.score[1] ? `당신 승 · ${m.score[0]} : ${m.score[1]}` : `${name} 승 · ${m.score[0]} : ${m.score[1]}`
  if (m.decided !== null) return m.decided === 0 ? '당신 득점' : `${name} 득점`
  if (m.phase === 'serve') return touch ? '당신 서브 · 탭' : m.easy ? '당신 서브 · Space' : '당신 서브 · 클릭 · Space'
  if (m.phase === 'toss') return `${name} 서브`
  return m.easy ? '공이 오면 Space' : '받아치세요'
}

export function PingpongVisitUi({ world }: { world: OfficeWorld }) {
  const v = usePingpongVisit()
  const tagEl = useRef<HTMLButtonElement>(null)
  // #670 (play.md 2.1.1) a mouse sees the tag only while it points at the play spot or the tag (styles.css: a touch screen and a focus always do)
  const tagAway = useTagAway(!!v.tag?.hot)
  const [help, setHelp] = useState(false)
  const open = v.phase !== 'closed'
  const name = v.agent ? shortName(v.agent) : ''
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

  // the docks hidden while at the table
  useEffect(() => {
    const root = document.documentElement
    if (open) root.dataset.pingpong = ''
    else delete root.dataset.pingpong
    return () => {
      delete root.dataset.pingpong
    }
  }, [open])

  // the first time in this tab: how to play, 4 s (play.md 3.3)
  useEffect(() => {
    if (v.phase !== 'open' || getPingpongVisit().helped) return
    pingpongHelped()
    setHelp(true)
    const id = setTimeout(() => setHelp(false), HELP_MS)
    return () => clearTimeout(id)
  }, [v.phase])

  // Space: the serve, or (easy mode) the hit; Esc leaves. Capture phase: the camera keys never see them while at the table
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closePingpong()
        return
      }
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        spacePingpong()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open])

  const take = () => {
    const t = getPingpongVisit().tag
    if (t) openPingpong(t.agent, t.watcher, Date.now() % 1_000_000, prefersReducedMotion(), t.dims)
  }

  const m = v.match
  return (
    <>
      {v.work && !v.stopped && v.chip && v.agent && m?.phase !== 'over' && <WorkChip agent={v.agent} at={v.chip} anchor="over" text={chipText('pingpong', v.work, officeNow(world))} />}
      {v.tag && !open && (
        <button
          type="button"
          className="omok-tag pp-tag-btn"
          ref={(el) => {
            tagEl.current = el
            setTagEl('pingpong', el)
          }}
          data-away={tagAway || undefined}
          style={tagOnScreen(v.tag.x, v.tag.y, tagEl.current?.offsetWidth ?? 110, tagEl.current?.offsetHeight ?? 28, window.innerWidth)}
          aria-label={`라켓 잡기 · ${wa(shortName(v.tag.agent))} 탁구`}
          onClick={take}
        >
          <span aria-hidden="true">🏓</span> 라켓 잡기
        </button>
      )}
      {open && m && (
        <>
          <p className="pp-score" aria-hidden="true">
            당신 {m.score[0]} : {m.score[1]} {name}
          </p>
          {help && (
            <p className="pp-help" role="status">
              {touch ? '아래를 끌어 라켓을 움직이세요' : '마우스로 라켓을 움직여 받아치세요 · 공 그림자와 고리를 보세요'}
            </p>
          )}
          <section className="omok-hud pp-hud" aria-label="탁구 경기">
            <p className="omok-status" aria-live="polite">
              {ppStatus(m, name, touch, v.ready, v.work && !v.stopped ? hudBit('pingpong', v.work, officeNow(world)) : undefined, v.stopped)}
              <span className="sr-only"> · 당신 {m.score[0]} : {m.score[1]} {name}</span>
            </p>
            <p className="sr-only" aria-live="polite">{v.work ? momentSaid(name) : ''}</p>
            <div className="omok-strength" role="radiogroup" aria-label="공 속도">
              {SPEEDS.map((s: Speed) => (
                <button key={s} type="button" role="radio" aria-checked={m.speed === s} onClick={() => speedPingpong(s)}>
                  {SPEED_NAME[s]}
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={m.easy} className={m.easy ? 'omok-here' : undefined} onClick={() => easyPingpong(!m.easy)}>
              자동 따라가기
            </button>
            {m.phase === 'over' && !v.work && (
              <button type="button" onClick={() => restartPingpong(Date.now() % 1_000_000)}>
                다시 하기
              </button>
            )}
            <button type="button" onClick={() => closePingpong()}>
              그만두기 <kbd>Esc</kbd>
            </button>
          </section>
        </>
      )}
    </>
  )
}
