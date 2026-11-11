import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { isApprovalBoxOpen } from '../office/approval/panel'
import { isDocsOpen } from '../office/docs/panel'
import { AGENT_INFO, type OfficeWorld } from '../office/world'
import type { Point } from '../timeline/types'
import { drawBar, nearest, type BarLayout } from './barDraw'
import { boardDistance, pointWaitMs } from './walk'
import { ALL, LANES, LANE_NAME, SECRET_NOTE, SPEEDS, atMs, describe, dayLabel, laneOf, remainingMs, shortName, stepMs, valueText, whenText, kst, type Lane } from './engine'
import { replay, useReplay } from './store'
import { useLineSub } from './lineSub'
import { minutesExtraMs, progressText, useMinutesProgress, useMinutesVersion } from './minutesInfo'
import { ReplayList } from './ReplayList'
import { DayCalendar } from './DayCalendar'
import { announceText, dayText, endText, navLabel } from './days'
import './replay.css'

/** the last input was the keyboard (so the bar may take a visible focus on entering) */
let usedKeyboard = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (usedKeyboard = true), true)
  window.addEventListener('pointerdown', () => (usedKeyboard = false), true)
}
const narrowQuery = () => matchMedia('(max-width: 640px)')
const p2 = (n: number) => String(n).padStart(2, '0')

/** the replay itself while it is on (its entry button is ReplayEntry, in the main bundle) */
export function ReplayHud({ world }: { world: OfficeWorld }) {
  const s = useReplay()
  // Esc closes the replay; a panel that was open at the key press takes that Esc itself (one layer at a time)
  useEffect(() => {
    if (s.mode === 'off') return
    let panel = false
    const down = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') panel = isDocsOpen() || isApprovalBoxOpen()
    }
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !panel && !e.defaultPrevented) replay.close()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keydown', up)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keydown', up)
    }
  }, [s.mode])
  return (
    <>
      {s.mode === 'office' && <OfficeBars world={world} />}
      {s.mode === 'list' && <ReplayList />}
    </>
  )
}

function OfficeBars({ world }: { world: OfficeWorld }) {
  const s = useReplay()
  const points = replay.points
  const p = points[s.i] ?? null
  const [compact, setCompact] = useState(() => narrowQuery().matches)
  useEffect(() => {
    const m = narrowQuery()
    const on = () => setCompact(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const line = useLineSub()
  const rows = progressText(useMinutesProgress())
  useMinutesVersion()
  const [hover, setHover] = useState(-1)
  const [copied, setCopied] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layout = useRef<BarLayout | null>(null)
  const slider = useRef<HTMLDivElement>(null)

  // the frame loop: the clock of the replay, and the bar's repaint
  const view = useRef({ hover, compact })
  view.current = { hover, compact }
  useEffect(() => {
    let raf = 0
    let key = ''
    const loop = () => {
      const c = canvas.current
      const w = wrap.current
      if (c && w) {
        const st = replay.getSnapshot()
        const cw = w.clientWidth
        const ch = w.clientHeight
        const k = `${st.i}|${st.count}|${st.project}|${replay.prog.toFixed(3)}|${st.playing}|${view.current.hover}|${cw}x${ch}|${view.current.compact}`
        if (k !== key && cw > 0) {
          key = k
          const dpr = Math.min(2, window.devicePixelRatio || 1)
          if (c.width !== cw * dpr || c.height !== ch * dpr) {
            c.width = cw * dpr
            c.height = ch * dpr
          }
          const ctx = c.getContext('2d')!
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          layout.current = drawBar(ctx, { points: replay.points, i: st.i, prog: replay.prog, playing: st.playing, hover: view.current.hover, compact: view.current.compact, width: cw, height: ch })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    // the first paint waits for the pixel font (the day labels are drawn in it)
    void document.fonts?.load('11px Galmuri11').catch(() => {})
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  // focus goes to the bar for keyboard users only; a mouse entry (the wall clock) leaves no focus ring behind
  useEffect(() => slider.current?.focus({ preventScroll: true, focusVisible: usedKeyboard }), [])

  const pick = useCallback((clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    return layout.current ? nearest(layout.current, clientX - r.left) : { k: 0, d: 0 }
  }, [])
  const dragging = useRef(false)
  const onDown = (e: RPointerEvent) => {
    dragging.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    replay.seek(pick(e.clientX).k)
    slider.current?.focus({ preventScroll: true, focusVisible: false })
  }
  const onMove = (e: RPointerEvent) => {
    if (dragging.current) return replay.seek(pick(e.clientX).k)
    const n = pick(e.clientX)
    const r = wrap.current!.getBoundingClientRect()
    const lane = layout.current ? Math.floor((e.clientY - r.top - layout.current.lanesY) / layout.current.laneH) : -1
    const near = n.d < 6 && lane >= 0 && lane < LANES.length && LANES[lane] === laneOf(replay.points[n.k])
    setHover(near ? n.k : -1)
  }
  // WASD / R belong to the camera (#111), which acts only while focus is on the 3D view: hand the focus back to it
  // Shift + arrows: the previous / next day (a day's view), or the previous / next day's first point inside an issue's span
  const changeDay = (dir: 1 | -1) => (replay.getSnapshot().day !== null ? replay.goDay(dir) : replay.dayStep(dir))
  const replayKey = (e: { key: string; shiftKey: boolean; preventDefault(): void }) => {
    const k = e.key
    if (k === ' ') replay.toggle()
    else if (k === 'ArrowRight') e.shiftKey ? changeDay(1) : replay.step(1)
    else if (k === 'ArrowLeft') e.shiftKey ? changeDay(-1) : replay.step(-1)
    else if (k === 'Home') replay.seek(0)
    else if (k === 'End') replay.seek(points.length - 1)
    else if ('123'.includes(k) && k.length === 1) replay.setSpeed(SPEEDS['123'.indexOf(k)])
    else return
    e.preventDefault()
  }
  const onKey = (e: KeyboardEvent) => {
    if (/^Key[WASDR]$/.test(e.code)) return slider.current?.blur()
    replayKey(e)
  }
  // after WASD the focus is on the 3D view: the replay's own keys still work there (not over a button or a field)
  const keyRef = useRef(replayKey)
  keyRef.current = replayKey
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      const a = document.activeElement
      if ((a === document.body || a?.tagName === 'CANVAS') && !e.ctrlKey && !e.metaKey && !e.altKey) keyRef.current(e)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  // a live signal arriving while the record plays: say so, never interrupt (plan 6.7)
  const live = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  const worker = world.director.agents.find((a) => live[a]?.state === 'working')

  // the date announced when the day changes while playing (every point would never stop talking)
  const day = p ? dayLabel(atMs(p)) : ''
  const [announce, setAnnounce] = useState('')
  const lastDay = useRef(s.day ?? day)
  useEffect(() => {
    // a day's view: once after the day changed ("11.08 일, 점 210개"); an issue's span: when its date turns over while playing
    const key = s.day ?? day
    if (key !== lastDay.current && (s.day !== null || s.playing)) setAnnounce(s.day !== null ? announceText({ id: s.day, count: s.count }) : day)
    lastDay.current = key
  }, [day, s.day, s.count, s.playing])

  const grain = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const g = grain.current
    if (!g || !(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--replay-grain')) > 0)) return
    // one 256 px noise tile; 12 times a second it only jumps to a random offset
    const tile = document.createElement('canvas')
    tile.width = tile.height = 256
    const c = tile.getContext('2d')!
    const img = c.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.random() * 255
      img.data[i + 3] = 255
    }
    c.putImageData(img, 0, 0)
    g.style.backgroundImage = `url(${tile.toDataURL()})`
    const id = setInterval(() => (g.style.backgroundPosition = `${(Math.random() * 256) | 0}px ${(Math.random() * 256) | 0}px`), 1000 / 12)
    return () => clearInterval(id)
  }, [])

  if (!p) return null
  const d = describe(p)
  const lane = laneOf(p)
  const when = whenText(atMs(p))
  const left = remainingMs(points, s.i, s.speed, (k, first) => pointWaitMs(points, k, (p) => stepMs(p, 1), boardDistance, first) + (points[k].kind === 'minutes' ? minutesExtraMs(points[k], s.speed) : 0), s.ended) / 1000
  const hp = hover >= 0 ? points[hover] : null
  const share = () => {
    const url = replay.shareUrl()
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const speedBtn = (v: (typeof SPEEDS)[number]) => (
    <button key={v} type="button" role="radio" aria-checked={s.speed === v} onClick={() => replay.setSpeed(v)}>
      ×{v}
    </button>
  )

  return (
    <div className={`replay${compact ? ' compact' : ''}`} data-seat={String(lane)} role="region" aria-label="타임랩스 재생">
      <div className="replay-grain" ref={grain} aria-hidden="true" />
      <div className="replay-vignette" aria-hidden="true" />
      {p.kind === 'deploy' && <div className="replay-flash" key={`${s.i}-${replay.landings}`} aria-hidden="true" />}
      <div className="replay-top">
        {!compact && <span className="replay-title">◀◀ 타임랩스</span>}
        {!compact && (
          <div className="replay-seg" role="radiogroup" aria-label="프로젝트">
            {[ALL, ...s.projects].map((pr) => (
              <button key={pr} type="button" role="radio" aria-checked={s.project === pr && !s.issue} onClick={() => void replay.setProject(pr)}>
                {pr === ALL ? '전체' : shortName(pr)}
              </button>
            ))}
          </div>
        )}
        {s.issue ? <IssueChip n={s.issue.n} points={points} /> : <DayPicker compact={compact} when={when} flip={s.flip} />}
        <button type="button" className="replay-btn" onClick={() => replay.close()}>
          지금으로 <span aria-hidden="true">⏭</span>
        </button>
      </div>
      {worker && (
        <div className="replay-live" role="status">
          <span className="replay-live-dot" aria-hidden="true" />
          <span className="replay-live-lbl">LIVE</span>
          <span>
            지금 <b>{AGENT_INFO[worker].name.split(' ')[0]}</b>가 일하는 중
          </span>
          <button type="button" className="replay-btn" onClick={() => replay.close()}>
            실시간으로 →
          </button>
        </div>
      )}
      <div className={`replay-fade${s.fade ? ' on' : ''}`} aria-hidden="true" />
      {s.ended ? (
        <EndCard />
      ) : line && !hp ? (
        <div className="replay-subtitle" data-seat={String(line.seat)} data-line="" aria-hidden="true">
          <span className="who">{line.who}</span>
          {line.text}
        </div>
      ) : (
        <div className={`replay-subtitle${hp ? ' tipping' : ''}`} data-seat={String(lane)} aria-hidden="true">
          <span className="who">{d.head}</span>
          {p.secret ? <><span className="replay-redact" /><span className="replay-secret-chip">SECRET · 결재 전</span></> : d.title}
          {d.size && <span className="meta">{d.size}</span>}
        </div>
      )}
      <div className="replay-bottom">
        <div className="replay-controls">
          <button type="button" className="ib" aria-label="이전 점" onClick={() => replay.step(-1)}>⏮</button>
          <button type="button" className="ib play" aria-label={s.playing ? '멈춤' : '재생'} onClick={() => replay.toggle()}>{s.playing ? '❚❚' : '▶'}</button>
          <button type="button" className="ib" aria-label="다음 점" onClick={() => replay.step(1)}>⏭</button>
          <div className="replay-seg" role="radiogroup" aria-label="속도">{SPEEDS.map(speedBtn)}</div>
          <span className="replay-pos"><b>{s.i + 1}</b> / {points.length}{rows ? ` · ${rows}` : ''}{compact ? '' : ` · 남은 ${Math.floor(left / 60)}:${p2(Math.round(left % 60) % 60)}`}</span>
          <span className="spacer" />
          {!compact && (
            <>
              <button type="button" className="replay-btn" onClick={() => replay.setMode('list')}>☰ 목록으로 보기</button>
              <button type="button" className="replay-btn" onClick={share}>{copied ? '복사했어요' : '🔗 이 시점 링크'}</button>
            </>
          )}
        </div>
        <div className="replay-track">
          <div className="replay-lanes" aria-hidden="true">
            {LANES.map((l) => (
              <span key={String(l)} data-seat={String(l)}>{LANE_NAME[l]}</span>
            ))}
          </div>
          <div className="replay-canvas" ref={wrap}>
            <canvas ref={canvas} />
            <div
              ref={slider}
              className="replay-slider"
              role="slider"
              tabIndex={0}
              aria-label="타임라인"
              aria-valuemin={1}
              aria-valuemax={points.length}
              aria-valuenow={s.i + 1}
              aria-valuetext={valueText(points, s.i)}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => (dragging.current = false)}
              onPointerCancel={() => (dragging.current = false)}
              onPointerLeave={() => setHover(-1)}
              onKeyDown={onKey}
            />
          </div>
        </div>
      </div>
      {hp && layout.current && <Tip point={hp} x={layout.current.xs[hover] - layout.current.scroll} wrap={wrap.current} />}
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  )
}

/** the tag over a point (timelapse.md 2.3): tab = who · kind, body = title or a black bar, foot = when and size */
function Tip({ point: p, x, wrap }: { point: Point; x: number; wrap: HTMLDivElement | null }) {
  const lane: Lane = laneOf(p)
  const d = describe(p)
  const r = wrap?.getBoundingClientRect()
  const k = kst(atMs(p))
  const left = r ? Math.max(8, Math.min(window.innerWidth - 288, r.left + x - 20)) : 8
  return (
    <div className="replay-tip" data-seat={String(lane)} style={{ left, bottom: r ? window.innerHeight - r.top + 14 : 0 }} aria-hidden="true">
      <span className={`tab${p.secret ? ' secret' : ''}`}>{d.head}{p.secret ? ' · SECRET' : ''}</span>
      <div className="body">
        {p.secret ? <span className="replay-redact wide" /> : d.title || '(제목 없음)'}
        <span className="meta">
          {`${p2(k.m)}.${p2(k.d)} ${k.w} ${p2(k.h)}:${p2(k.mi)}`}
          {d.size ? ` · ${d.size}` : ''}
          {p.issue !== null && !p.secret ? ` · #${p.issue}` : ''}
        </span>
        {p.secret && <span className="meta">{SECRET_NOTE}</span>}
      </div>
    </div>
  )
}

/** the middle of the top strip (timelapse.md 10.2): [‹] 11.07 토 ▾ [›] 14:32 — the day, the previous / next day that has points, the calendar */
function DayPicker({ compact, when, flip }: { compact: boolean; when: string; flip: string | null }) {
  const s = useReplay()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const prev = replay.adjacent(-1)
  const next = replay.adjacent(1)
  const shown = flip ?? when
  const label = shown.slice(5, 12)
  const time = shown.slice(13)
  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
  }, [])
  const nav = (dir: 1 | -1, to: typeof prev) => (
    <button
      type="button"
      className="day-nav"
      aria-label={to ? navLabel(dir, to) : dir < 0 ? '이전 날 없음' : '다음 날 없음'}
      aria-disabled={!to}
      onClick={() => {
        setOpen(false)
        if (to) replay.goDay(dir)
      }}
    >
      <span aria-hidden="true">{dir < 0 ? '‹' : '›'}</span>
    </button>
  )
  return (
    <div className="replay-day">
      {nav(-1, prev)}
      <div className="day-mid">
        <button
          ref={button}
          type="button"
          className="day-btn"
          data-day-button=""
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`날짜 고르기, 지금 ${dayText(s.day ?? '0000-00-00')}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="replay-date" aria-hidden="true">{label}</span> <span aria-hidden="true">▾</span>
        </button>
        <span className="day-time" aria-hidden="true">{time}</span>
      </div>
      {nav(1, next)}
      {!compact && <span className="replay-rec">▶ 기록 재생 중</span>}
      {open && s.day && (
        <DayCalendar
          days={replay.days}
          selected={s.day}
          sheet={compact}
          onPick={(id) => {
            setOpen(false)
            button.current?.focus({ preventScroll: true })
            replay.selectDay(id)
          }}
          onClose={close}
        />
      )}
    </div>
  )
}

/** an issue's span instead of the day picker (timelapse.md 10.6): `#67 · 11.07 – 11.08 · 점 9개 [×]` */
function IssueChip({ n, points }: { n: number; points: readonly Point[] }) {
  const a = points.length ? dayLabel(atMs(points[0])).slice(0, 5) : ''
  const b = points.length ? dayLabel(atMs(points[points.length - 1])).slice(0, 5) : ''
  return (
    <div className="replay-day">
      <span className="replay-rec">▶ 기록 재생 중</span>
      <span className="issue-chip">
        #{n} · {a === b ? a : `${a} – ${b}`} · 점 {points.length}개
        <button type="button" aria-label="이슈만 보기 끝내기" onClick={() => replay.endIssue()}>×</button>
      </span>
    </div>
  )
}

/** the card at the end of a day or an issue (timelapse.md 10.7): it stops here, the viewer decides */
function EndCard() {
  const s = useReplay()
  const first = useRef<HTMLButtonElement>(null)
  // a keyboard user lands on the first button (Enter = the next day); a mouse user's focus stays where it was
  useEffect(() => {
    if (usedKeyboard) first.current?.focus({ preventScroll: true, focusVisible: true })
  }, [])
  const info = replay.days.find((d) => d.id === s.day)
  const next = replay.adjacent(1)
  const live = (ref?: React.Ref<HTMLButtonElement>) => (
    <button type="button" ref={ref} className="replay-btn" onClick={() => replay.close()}>
      지금으로 <span aria-hidden="true">⏭</span>
    </button>
  )
  return (
    <div className="replay-subtitle replay-end" role="group" aria-label="끝">
      <span className="end-text">{s.issue ? `#${s.issue.n} 끝 · 점 ${s.count}개` : info ? endText(info) : ''}</span>
      <span className="end-btns">
        {s.issue ? (
          <>
            <button type="button" ref={first} className="replay-btn" onClick={() => replay.play()}>이슈 처음부터</button>
            {live()}
          </>
        ) : (
          <>
            {next ? (
              <button type="button" ref={first} className="replay-btn" onClick={() => replay.goDay(1, { play: true })}>
                다음 날 {dayText(next.id)} <span aria-hidden="true">→</span>
              </button>
            ) : (
              live(first)
            )}
            <button type="button" className="replay-btn" onClick={() => replay.play()}>처음부터 다시</button>
          </>
        )}
      </span>
    </div>
  )
}
