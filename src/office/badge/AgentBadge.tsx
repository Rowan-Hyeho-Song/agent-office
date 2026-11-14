// The agent's badge (사원증, office-ui.md 12.1a, #4): an ivory ID card on a lanyard that drops from the top of the screen over the
// robot that was clicked (or whose ⓘ was pressed in the agent list). Front: company band, the robot's face screen as the photo, name,
// role chip, seat, the day it joined, what it is doing, a pixel barcode with its machine number; under the perforation what it did
// today. Back (뒤집기): today's recent three, the library and the day's timelapse. On a phone it is a bottom sheet without the
// lanyard, the list right under the front. Snacks, cheers and notes (12.2 · 12.3) come with the rest of #4: no buttons until then.

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { usePanelOpen } from '../../room/panels'
import { dayId } from '../../replay/days'
import { replay, useReplayPoints } from '../../replay/store'
import { openDocs } from '../docs/panel'
import { isPhone } from '../sidePanel/model'
import { statusLine } from '../status'
import { useTour } from '../tourStore'
import { AGENT_INFO, prefersReducedMotion, type OfficeWorld } from '../world'
import { badgeAnchor, closeBadge, getBadge, useBadge } from './badgeStore'
import { barcode, joinedDate, machineNo, recentToday, seatLabel, todayLine } from './badgeData'

export const BADGE = { w: 224, h: 352, gutter: 16, top: 48, followMs: 300, dropMs: 350, swingMs: 800, leaveMs: 200, fadeMs: 120 }
const PHOTO = { w: 120, h: 90 }
const STATE_DOT: Record<string, string> = { working: 'var(--color-green)', wrapping: 'var(--color-amber)', idle: 'var(--color-cyan)', off: 'var(--color-text-faint)' }

const seatOf = (agent: string) => Number(agent.split('_')[1])

function useScreenWidth() {
  return useSyncExternalStore(
    (cb) => (window.addEventListener('resize', cb), () => window.removeEventListener('resize', cb)),
    () => window.innerWidth,
  )
}

export function AgentBadge({ world }: { world: OfficeWorld }) {
  const { agent, nonce } = useBadge()
  const touring = useTour().active
  const screenW = useScreenWidth()
  const phone = isPhone(screenW)
  // the card stays for its exit (0.2 s up, or the fade) after the store has closed it
  const [shown, setShown] = useState<{ agent: string; nonce: number } | null>(null)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (agent) {
      setShown({ agent, nonce })
      setLeaving(false)
      return
    }
    if (!shown) return
    setLeaving(true)
    const t = window.setTimeout(() => setShown(null), prefersReducedMotion() ? BADGE.fadeMs : BADGE.leaveMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, nonce])
  // the tour and the timelapse take the picture: the card goes (12.1)
  const replaying = replay.getSnapshot().mode !== 'off'
  useEffect(() => {
    if (agent && (touring || replaying)) closeBadge()
  }, [agent, touring, replaying])
  usePanelOpen(!!agent, closeBadge)

  if (!shown) return null
  return <Card key={shown.nonce} world={world} agent={shown.agent} nonce={shown.nonce} phone={phone} screenW={screenW} leaving={leaving} />
}

function Card({ world, agent, nonce, phone, screenW, leaving }: { world: OfficeWorld; agent: string; nonce: number; phone: boolean; screenW: number; leaving: boolean }) {
  const info = AGENT_INFO[agent]
  const seat = seatOf(agent)
  const [nameKo, nameEn] = info.name.split(' ')
  const titleId = useId()
  const [back, setBack] = useState(false)
  const reduced = prefersReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const hang = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const backFirst = useRef<HTMLButtonElement>(null)
  const frontFirst = useRef<HTMLButtonElement>(null)

  // what it is doing: the same line as the agent list
  const status = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  const shown = useSyncExternalStore(world.director.subscribeShown, world.director.getShown)
  const s = shown[agent]?.status ?? status[agent]
  const line = statusLine(s, shown[agent]?.detail)
  const points = useReplayPoints()
  useEffect(() => void replay.load(), [])
  const now = Date.now()
  const joined = joinedDate(points, seat)
  const today = todayLine(points, seat, now)
  const recent = recentToday(points, seat, now)

  // 12.1: the first button gets the focus; Esc closes (the room's Esc registry asks it first, usePanelOpen); flipping moves the focus
  useEffect(() => closeBtn.current?.focus({ preventScroll: true }), [])
  const flip = (to: boolean) => {
    setBack(to)
    window.setTimeout(() => (to ? backFirst.current : frontFirst.current)?.focus({ preventScroll: true }), reduced ? 0 : 200)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeBadge()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  // a click outside closes it; a camera drag does not; a click on another robot moves it (BadgePick opens that one first)
  useEffect(() => {
    let down: { x: number; y: number; inside: boolean } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, inside: !!root.current?.contains(e.target as Node) })
    const onClick = (e: MouseEvent) => {
      const d = down
      down = null
      if (!d || d.inside || root.current?.contains(e.target as Node)) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 5) return
      // the click's own handler ran first (a robot in the canvas, an ⓘ in the list): it opened another badge, this one is replaced
      if (getBadge().nonce !== nonce || leaving) return
      closeBadge()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('click', onClick)
    }
  }, [leaving, nonce])

  // the photo: the robot's face screen as it is now (expression, blinks), copied when it redraws
  const photo = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const face = world.rigs[agent]?.faceScreen
      const g = photo.current?.getContext('2d')
      if (!face || !g || face.draws === last) return
      last = face.draws
      // cover: the 5:3 screen cut to the 4:3 frame (the sides are glass)
      const src = face.canvas
      const sw = (src.height * PHOTO.w) / PHOTO.h
      g.drawImage(src, (src.width - sw) / 2, 0, sw, src.height, 0, 0, PHOTO.w, PHOTO.h)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [world, agent])

  // desktop: hang over the robot's x, following it 0.3 s late; the lanyard stays caught on the top of the screen
  const [top] = useState(() => {
    const want = badgeAnchor.on ? badgeAnchor.y - BADGE.h - 24 : BADGE.top
    return Math.round(Math.max(BADGE.top, Math.min(window.innerHeight - BADGE.h - BADGE.gutter, want)))
  })
  useLayoutEffect(() => {
    if (phone) return
    const clampX = (x: number) => Math.max(BADGE.gutter, Math.min(window.innerWidth - BADGE.gutter - BADGE.w, x - BADGE.w / 2))
    let x = clampX(badgeAnchor.on ? badgeAnchor.x : window.innerWidth / 2)
    let t0 = performance.now()
    let raf = 0
    const place = () => {
      if (hang.current) hang.current.style.left = `${x}px`
    }
    place()
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (t - t0) / 1000)
      t0 = t
      if (!badgeAnchor.on) return
      // about 0.3 s to settle (95 %)
      x += (clampX(badgeAnchor.x) - x) * (1 - Math.exp(-dt / (BADGE.followMs / 3000)))
      place()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phone])

  const bars = barcode(seat)
  const front = (
    <div className="badge-face badge-front" aria-hidden={back && !phone ? true : undefined}>
      <Band titleId={titleId} name={nameKo} onClose={closeBtn} />
      <div className="badge-body">
        <canvas ref={photo} className="badge-photo" width={PHOTO.w} height={PHOTO.h} aria-label={`${nameKo}의 지금 얼굴 화면`} role="img" />
        <p className="badge-name">
          {nameKo} <span lang="en">{nameEn}</span>
        </p>
        <p className="badge-row">
          <span className="badge-role">{info.role}</span>
          <span className="badge-seat">{seatLabel(seat)}</span>
        </p>
        <p className="badge-joined">JOINED {joined ?? '—'}</p>
        <p className="badge-status">
          <i style={{ background: STATE_DOT[s?.state ?? 'off'] }} aria-hidden="true" />
          {line}
        </p>
        <p className="badge-code">
          <span className="badge-bars" aria-hidden="true">
            {bars.map((w, i) => (
              <b key={i} style={{ width: w * 2 }} />
            ))}
          </span>
          {machineNo(seat)}
        </p>
      </div>
      <div className="badge-stub">
        <p className="badge-today">{today}</p>
        {!phone && (
          <button ref={frontFirst} type="button" className="badge-flip" onClick={() => flip(true)} tabIndex={back ? -1 : undefined}>
            뒤집기 ↻
          </button>
        )}
      </div>
    </div>
  )
  const list = (
    <ul className="badge-recent">
      {recent.length ? recent.map((r) => <li key={r.key}>{r.text}</li>) : <li className="badge-none">오늘은 아직 기록이 없어요</li>}
    </ul>
  )
  const links = (first?: Ref<HTMLButtonElement>) => (
    <p className="badge-links">
      <button
        ref={first}
        type="button"
        onClick={() => {
          closeBadge()
          openDocs()
        }}
      >
        서재에서 보기 ›
      </button>
      <button
        type="button"
        onClick={() => {
          closeBadge()
          void replay.open({ day: dayId(Date.now()), mode: 'office' })
        }}
      >
        오늘 다시 보기 ›
      </button>
    </p>
  )

  if (phone)
    return (
      <div ref={root} className={`badge-sheet${leaving ? ' leaving' : ''}`} role="dialog" aria-modal="false" aria-labelledby={titleId} style={{ ['--agent' as string]: info.color }}>
        <div className="badge-card" style={{ zoom: (screenW - 64) / BADGE.w }}>
          {front}
        </div>
        <h3 className="badge-sub">오늘 한 일</h3>
        {list}
        {links()}
      </div>
    )

  return (
    <div
      ref={root}
      className={`badge-hang${leaving ? ' leaving' : ''}${reduced ? ' reduced' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ ['--agent' as string]: info.color, ['--top' as string]: `${top}px` }}
    >
      <div ref={hang} className="badge-pendant">
        <span className="badge-lanyard" aria-hidden="true" />
        <span className="badge-clip" aria-hidden="true" />
        <div className={`badge-card${back ? ' flipped' : ''}`}>
          {front}
          <div className="badge-face badge-back" aria-hidden={back ? undefined : true}>
            <Band titleId={`${titleId}-b`} name={nameKo} hiddenTitle onClose={null} tabbable={back} />
            <div className="badge-body">
              <h3 className="badge-sub">오늘 한 일</h3>
              {list}
              {links(back ? backFirst : undefined)}
              <button type="button" className="badge-flip" onClick={() => flip(false)} tabIndex={back ? undefined : -1}>
                ← 앞면
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** the company band: ▣ AGENT OFFICE and the close button, the same on both faces */
function Band({ titleId, name, onClose, hiddenTitle, tabbable = true }: { titleId: string; name: string; onClose: Ref<HTMLButtonElement> | null; hiddenTitle?: boolean; tabbable?: boolean }) {
  return (
    <div className="badge-band">
      <span aria-hidden="true">▣ AGENT OFFICE</span>
      <h2 id={hiddenTitle ? undefined : titleId} className="sr-only">
        {name} 사원증
      </h2>
      <button ref={onClose ?? undefined} type="button" className="badge-close" aria-label="사원증 닫기" onClick={closeBadge} tabIndex={tabbable ? undefined : -1}>
        ×
      </button>
    </div>
  )
}
