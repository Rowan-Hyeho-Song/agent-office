import { useSyncExternalStore } from 'react'
import { activityLabel } from './status'
import { AGENT_INFO, type OfficeWorld } from './world'

const STATE_LABELS = { working: '', wrapping: '카드 정리 중', idle: '휴식 중', off: '퇴근' } as const

/**
 * The plain list of who is doing what (#1): the same status the 3D scene acts out, readable at a glance and by
 * screen readers. Its look comes later from the design (#18).
 */
export function AgentList({ world }: { world: OfficeWorld }) {
  const status = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  return (
    <section className="agent-list" aria-label="에이전트 상태">
      <ul>
        {world.director.agents.map((a) => {
          const s = status[a]
          const info = AGENT_INFO[a]
          const text = !s ? '…' : s.state === 'working' ? activityLabel(s.activity) : STATE_LABELS[s.state]
          return (
            <li key={a} className={`state-${s?.state ?? 'off'}`}>
              <i style={{ background: info.color }} aria-hidden="true" />
              <b>{info.name}</b> <span>{text}</span>
            </li>
          )
        })}
      </ul>
      {world.live?.error && <p className="agent-list-error">{world.live.error}</p>}
      {!world.live && !world.debug && <p className="agent-list-error">연습 모드: 실제 신호에 연결되지 않았어요</p>}
    </section>
  )
}
