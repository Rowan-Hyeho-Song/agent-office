import { useSyncExternalStore } from 'react'
import { useReplay } from '../replay/store'
import { Icon } from './ApprovalIcons'
import { activityLabel, clip, PRIVATE_TASK_LABEL, STATE_LABELS, statusLine, taskNumber, taskOf, taskText } from './status'
import { openBadge } from './badge/badgeStore'
import { tour } from './tourStore'
import { AGENT_INFO, type OfficeWorld } from './world'

/**
 * The plain list of who is doing what (#1): the same status the 3D scene acts out, readable at a glance and by
 * screen readers. Its look comes later from the design (#18).
 */
export function AgentList({ world }: { world: OfficeWorld }) {
  const replaying = useReplay().mode === 'office'
  const status = useSyncExternalStore(world.source.subscribe, world.source.getSnapshot)
  // what each agent is doing right now, decided by the director (#186): the raw status only names what it was told
  const shown = useSyncExternalStore(world.director.subscribeShown, world.director.getShown)
  // the replay is on: the live list would mix with the record (timelapse.md 1)
  if (replaying) return null
  return (
    <section className="agent-list" aria-label="에이전트 상태">
      <ul>
        {world.director.agents.map((a) => {
          const s = shown[a]?.status ?? status[a]
          const detail = shown[a]?.detail
          const info = AGENT_INFO[a]
          const text = statusLine(s, detail)
          const task = taskOf(s)
          // #182: "작업 중 › #170 제목 · 파일 편집 중"; the title alone is cut (the full text stays in title / aria-label)
          const state = s?.state === 'working' ? '작업 중' : STATE_LABELS[s?.state ?? 'off']
          const more = detail ?? (s?.state === 'working' ? activityLabel(s.activity) : '')
          return (
            <li key={a} className={`state-${s?.state ?? 'off'}`}>
              <i style={{ background: info.color }} aria-hidden="true" />
              <button type="button" className="agent-name" onClick={() => tour.start(a)} title="이 에이전트부터 둘러보기"><b>{info.name}</b></button>
              {/* #4 12.1: the badge for keyboards and screen readers (the robot itself is clicked with a pointer) */}
              <button type="button" className="agent-card-btn" aria-label={`${info.name.split(' ')[0]} 카드 열기`} title="사원증 보기" onClick={(e) => openBadge(a, e.currentTarget)}>ⓘ</button>{' '}
              {task && s ? (
                <span className="agent-task" title={taskText(task)} aria-label={`${info.name}, ${state} ${taskText(task)}${more ? `, ${more}` : ''}`}>
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
                  {more && <span className="agent-task-act"> · {more}</span>}
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
