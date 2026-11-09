import { useSyncExternalStore } from 'react'
import { useReplay } from '../replay/store'
import { Icon } from './ApprovalIcons'
import { activityLabel, clip, PRIVATE_TASK_LABEL, taskNumber, taskOf, taskText } from './status'
import { tour } from './tourStore'
import { AGENT_INFO, type OfficeWorld } from './world'

const STATE_LABELS = { working: '', wrapping: '카드 정리 중', idle: '휴식 중', off: '퇴근' } as const

/**
 * The plain list of who is doing what (#1): the same status the 3D scene acts out, readable at a glance and by
 * screen readers. Its look comes later from the design (#18).
 */
export function AgentList({ world }: { world: OfficeWorld }) {
  const replaying = useReplay().mode === 'office'
  const status = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  // the replay is on: the live list would mix with the record (timelapse.md 1)
  if (replaying) return null
  return (
    <section className="agent-list" aria-label="에이전트 상태">
      <ul>
        {world.director.agents.map((a) => {
          const s = status[a]
          const info = AGENT_INFO[a]
          const text = !s ? '…' : s.state === 'working' ? activityLabel(s.activity) : s.night === 'sleep' ? '조는 중' : s.night === 'duty' ? '야간 당번' : STATE_LABELS[s.state]
          const task = taskOf(s)
          // #182: "작업 중 › #170 제목 · 파일 편집 중"; the title alone is cut (the full text stays in title / aria-label)
          const state = s?.state === 'working' ? '작업 중' : STATE_LABELS[s?.state ?? 'off']
          const detail = s?.state === 'working' ? activityLabel(s.activity) : ''
          return (
            <li key={a} className={`state-${s?.state ?? 'off'}`}>
              <i style={{ background: info.color }} aria-hidden="true" />
              <button type="button" className="agent-name" onClick={() => tour.start(a)} title="이 에이전트부터 둘러보기"><b>{info.name}</b></button>{' '}
              {task && s ? (
                <span className="agent-task" title={taskText(task)} aria-label={`${info.name}, ${state} ${taskText(task)}${detail ? `, ${detail}` : ''}`}>
                  {state} ›{' '}
                  {task.private ? (
                    <span className="agent-task-private">
                      <span className="agent-task-lock" aria-hidden="true"><Icon name="lock" /></span>
                      {PRIVATE_TASK_LABEL}
                    </span>
                  ) : (
                    <>
                      <span className="agent-task-no">{taskNumber(task)}</span>
                      {task.title && <span className="agent-task-title"> {clip(task.title, 18)}</span>}
                    </>
                  )}
                  {detail && <span className="agent-task-act"> · {detail}</span>}
                </span>
              ) : (
                <span>{text}</span>
              )}
            </li>
          )
        })}
      </ul>
      {world.live?.error && <p className="agent-list-error">{world.live.error}</p>}
      {!world.live && !world.debug && <p className="agent-list-error">연습 모드: 실제 신호에 연결되지 않았어요</p>}
    </section>
  )
}
