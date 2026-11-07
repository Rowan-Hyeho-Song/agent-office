import { useEffect, useReducer, useState } from 'react'
import { BLOCK_MINUTES, blockOf } from './play'
import type { AgentState } from './status'
import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'

const STATES: { state: AgentState; label: string; activity?: string }[] = [
  { state: 'working', label: '작업 중', activity: 'edit' },
  { state: 'wrapping', label: '정리 중' },
  { state: 'idle', label: '쉬게' },
  { state: 'off', label: '퇴근' },
]

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
