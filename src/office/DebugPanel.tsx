import { useEffect, useReducer, useState } from 'react'
import { BLOCK_MINUTES, blockOf } from './play'
import { deskProps } from './props'
import type { AgentState } from './status'
import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'

const STATES: { state: AgentState; label: string; activity?: string }[] = [
  { state: 'working', label: '작업 중', activity: 'edit' },
  { state: 'wrapping', label: '정리 중' },
  { state: 'idle', label: '쉬게' },
  { state: 'off', label: '퇴근' },
]

const SIGNAL_LABEL = { off: '꺼짐', yellow: '노랑(실행 중)', green: '초록(통과)', red: '빨강(실패)' } as const
const RING_LABEL = { off: '꺼짐', on: '켜짐', blink: '깜빡' } as const
const onOff = (b: boolean) => (b ? '켜짐' : '꺼짐')

/**
 * The LIVE desk props (#44): each prop's state as the 3D props will show it, and buttons that drive every
 * input (the fake status source and the fake props feed). Until Blender's prop nodes land (#43) this is the
 * only place to see them.
 */
function PropsDebug({ world, now }: { world: OfficeWorld; now: number }) {
  const p = deskProps({ ...world.props.getSnapshot(), status: world.source.getSnapshot(), now })
  const fake = world.fake
  const fp = world.fakeProps
  const extra = world.props.getSnapshot()
  const rows: [string, string, string][] = [
    ['메모', 'IN 서류함', `${p.inbox}장`],
    ['메모', 'OUT 서류함', `${p.outbox}장`],
    ['메모', '탁상 달력', `${p.calendar.month}/${p.calendar.day}(${p.calendar.weekday})`],
    ['메모', '모래시계', p.hourglass ? '흐름' : '멈춤'],
    ['메모', '결재 도장', p.stamp ? '쾅' : '내려놓음'],
    ['메시', '턴테이블', p.turntable ? '돎' : '멈춤'],
    ['메시', '링 조명', RING_LABEL[p.ringlight]],
    ['휴', '펜 태블릿', onOff(p.tablet)],
    ['휴', '램프', onOff(p.lamp)],
    ['루프', '신호등', SIGNAL_LABEL[p.signal] + (p.duckLook ? ' · 오리를 봄' : '')],
  ]
  return (
    <section className="props-debug">
      <div className="who">
        <b>LIVE 소품</b> <small>{fp ? '조작판' : '실제 데이터'}</small>
      </div>
      <table>
        <tbody>
          {rows.map(([who, what, state]) => (
            <tr key={what}>
              <td>{who}</td>
              <td>{what}</td>
              <td>{state}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fake && fp && (
        <>
          <div className="row">
            결재 대기
            <button onClick={() => fp.set({ pending: Math.max(0, extra.pending - 1), decidedAt: now })}>−1(결재)</button>
            <button onClick={() => fp.set({ pending: extra.pending + 1 })}>+1</button>
            <button
              className={extra.waitingSeats.includes(0) ? 'on' : ''}
              onClick={() =>
                fp.set({ waitingSeats: extra.waitingSeats.includes(0) ? extra.waitingSeats.filter((s) => s !== 0) : [...extra.waitingSeats, 0] })
              }
            >
              메모가 기다림
            </button>
            넘긴 일
            <button onClick={() => fp.set({ handoffsToday: extra.handoffsToday + 1 })}>+1</button>
          </div>
          <div className="row">
            메시
            <button onClick={() => fake.set('agent_1', 'working', 'build')}>굽기 시작</button>
            <button
              onClick={() => {
                fake.setResult('agent_1', 'build', true)
                fake.set('agent_1', 'idle')
              }}
            >
              굽기 끝
            </button>
            휴
            <button onClick={() => fake.set('agent_2', 'working', 'edit')}>편집</button>
            <button onClick={() => fake.set('agent_2', 'off')}>퇴근</button>
            <button onClick={() => fake.set('agent_2', 'idle')}>출근</button>
          </div>
          <div className="row">
            루프
            <button onClick={() => fake.set('agent_3', 'working', 'test')}>테스트 실행</button>
            <button
              onClick={() => {
                fake.setResult('agent_3', 'test', true)
                fake.set('agent_3', 'working', 'edit')
              }}
            >
              통과
            </button>
            <button
              onClick={() => {
                fake.setResult('agent_3', 'test', false)
                fake.set('agent_3', 'working', 'edit')
              }}
            >
              실패
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** ?debug=1: drive the fake status source by hand and watch what the director decided */
export function DebugPanel({ world }: { world: OfficeWorld }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [])
  const agents = world.director.agents
  const [from, setFrom] = useState(agents[0])
  const [to, setTo] = useState(agents[1])
  const fake = world.fake
  const status = world.source.getSnapshot()
  const now = officeNow(world)
  const minute = Math.floor(now / 60000)
  const nextChange = (blockOf(minute) + 1) * BLOCK_MINUTES * 60000 - now
  const shift = (min: number) => {
    world.timeOffsetMs = min === 0 ? 0 : world.timeOffsetMs + min * 60000
    tick()
  }

  return (
    <aside className="debug-panel">
      <header>
        <b>DEBUG</b> 놀이 블록 {blockOf(minute)} · 다음 변경 {Math.floor(nextChange / 60000)}:
        {String(Math.floor((nextChange % 60000) / 1000)).padStart(2, '0')}
        {world.timeOffsetMs !== 0 && <> · 시계 +{Math.round(world.timeOffsetMs / 60000)}분</>}
      </header>
      <div className="row">
        <button onClick={() => shift(BLOCK_MINUTES)}>+{BLOCK_MINUTES}분</button>
        <button onClick={() => shift(30)}>+30분</button>
        <button onClick={() => shift(0)}>지금</button>
      </div>
      {agents.map((a) => (
        <section key={a}>
          <div className="who">
            <i style={{ background: AGENT_COLORS[a] }} />
            {a} <small>{status[a]?.state}</small> <span>{world.goals[a]?.label}</span>
          </div>
          {fake && (
            <div className="row">
              {STATES.map((s) => (
                <button
                  key={s.state}
                  className={status[a]?.state === s.state ? 'on' : ''}
                  onClick={() => fake.set(a, s.state, s.activity)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
      {fake && (
        <div className="row">
          메시지
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {agents.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          →
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {agents.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <button onClick={() => fake.send(from, to)} disabled={from === to}>
            보내기
          </button>
        </div>
      )}
      <PropsDebug world={world} now={now} />
      <footer>
        {world.director.pending.talks.join(', ')}
        {world.check && (
          <div className={world.check.blocked.length ? 'bad' : 'ok'}>
            동선 검사: {world.check.blocked.length ? `막힘 ${world.check.blocked.length}` : '가구 통과 없음'}
            {world.check.blocked.map((b) => (
              <div key={b.where}>
                {b.where}: {b.hits.join(', ')}
              </div>
            ))}
          </div>
        )}
      </footer>
    </aside>
  )
}
