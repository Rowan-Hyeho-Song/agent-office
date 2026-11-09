import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { activityLabel, clip, taskOf, taskText, type AgentStatus } from './status'
import { TOUR } from './tour'
import { registerTourFade, tour, useTour } from './tourStore'
import { AGENT_INFO, type OfficeWorld } from './world'

// The tour's bar (#207, office-ui.md 10.4): bottom centre, 40 px tall, max 480 px: back, who is shown + what they are on,
// next, stop. The picture's own fade for the 0.3 s cut sits beside it.

const STATE_TEXT = { working: '작업 중', wrapping: '카드 정리 중', idle: '휴식 중', off: '퇴근' } as const
const COUNT = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟']

/** the short name ("루프") and the plain sentence of what the agent is doing ("#182 · 테스트 돌리는 중") */
export function describe(agent: string, s: AgentStatus | undefined, detail?: string): { name: string; chip: string } {
  const name = (AGENT_INFO[agent]?.name ?? agent).split(' ')[0]
  const task = taskOf(s)
  const doing = detail ?? (!s ? '' : s.state === 'working' ? activityLabel(s.activity) : s.night === 'sleep' ? '조는 중' : STATE_TEXT[s.state])
  const chip = [task ? clip(taskText(task), 28) : '', doing].filter(Boolean).join(' · ')
  return { name, chip }
}

export function TourBar({ world }: { world: OfficeWorld }) {
  const { active, cut, canBack, seq } = useTour()
  const status = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  const fade = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)
  const [said, setSaid] = useState('')
  const lastSaid = useRef(0)

  useLayoutEffect(() => {
    registerTourFade(fade.current)
    return () => registerTourFade(null)
  }, [])

  // on a narrow screen the bar may touch the dock of buttons at the bottom right: it goes up over it (>= 24 px apart)
  useLayoutEffect(() => {
    if (!active) return
    const measure = () => {
      const dock = document.querySelector('.corner-dock')?.getBoundingClientRect()
      const vw = window.innerWidth
      if (!dock || dock.width === 0 || vw <= 640) return setLift(0) // a phone: the bar already sits above the dock row
      const w = Math.min(480, vw - 32)
      const right = vw / 2 + w / 2
      setLift(dock.left - right < 24 ? Math.round(dock.height + 8) : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  const d = cut?.type === 'agent' ? describe(cut.agents[0], world.director.shown[cut.agents[0]]?.status ?? status[cut.agents[0]], world.director.shown[cut.agents[0]]?.detail) : null
  const label = !cut ? '' : cut.type === 'meeting' ? `회의 · ${COUNT[Math.min(cut.agents.length, COUNT.length - 1)]} 명` : cut.type === 'establishing' ? '사무실 전체' : (d?.name ?? '')
  const spoken = !cut ? '' : cut.type === 'agent' ? `${d?.name}${d?.chip ? `, ${d.chip}` : ''}` : label

  // screen readers: a cut that changes within 5 s of the last announcement is not read out
  useLayoutEffect(() => {
    if (!active || !cut) return setSaid('')
    const now = Date.now()
    if (now - lastSaid.current < TOUR.announceThrottleMs) return
    lastSaid.current = now
    setSaid(spoken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seq])

  const color = cut?.type === 'agent' ? AGENT_INFO[cut.agents[0]]?.color : undefined
  return (
    <>
      <div className="tour-fade" ref={fade} aria-hidden="true" />
      <div className="tour-live" role="status" aria-live="polite">
        {said}
      </div>
      {active && cut && (
        <div className="tour-bar" role="group" aria-label="둘러보기" style={lift ? { bottom: `calc(var(--space-4) + env(safe-area-inset-bottom, 0px) + ${lift}px)` } : undefined}>
          <button type="button" className="tour-btn" onClick={tour.prev} disabled={!canBack} aria-label="이전 (키 [)" title="이전 ([)">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8.5 2 3.5 6l5 4z" fill="currentColor" /></svg>
          </button>
          <p className="tour-now" title={d ? `${d.name} ${d.chip}` : label}>
            {color && <i style={{ background: color }} aria-hidden="true" />}
            <b>{label}</b>
            {d?.chip && <span className="tour-chip"> · {d.chip}</span>}
          </p>
          <button type="button" className="tour-btn" onClick={tour.next} aria-label="다음 (키 ])" title="다음 (])">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2 8.5 6l-5 4z" fill="currentColor" /></svg>
          </button>
          <button type="button" className="tour-btn tour-stop" onClick={() => tour.stop('button')} aria-label="둘러보기 멈추기 (Esc)" title="멈추기 (Esc, 이 탭에서는 다시 시작하지 않음)">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3h6v6H3z" fill="currentColor" /></svg>
          </button>
        </div>
      )}
    </>
  )
}
