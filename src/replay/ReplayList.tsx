import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, PointKind } from '../timeline/types'
import { ALL, AGENT_NAME, KIND_NAME, SECRET_NOTE, atMs, dayKey, kindName, kst, laneOf, prepare, shortName, sizeText, type Lane } from './engine'
import { Glyph } from './Glyph'
import { replay, useReplay } from './store'
import { tokens } from './barDraw'

const PER_DAY = 14
const p2 = (n: number) => String(n).padStart(2, '0')
const KINDS = Object.keys(KIND_NAME) as PointKind[]

/**
 * The 2D list (#82, timelapse.md 5): the same points by day, newest on top. For the keyboard and screen readers, and
 * the phone's default. A SECRET point shows date, agent and size only; the title is a black bar.
 */
export function ReplayList() {
  const s = useReplay()
  const everything = replay.everything
  const [project, setProject] = useState(s.project)
  const [kinds, setKinds] = useState<ReadonlySet<PointKind>>(new Set())
  const [agents, setAgents] = useState<ReadonlySet<Lane>>(new Set())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const root = useRef<HTMLElement>(null)
  useEffect(() => root.current?.focus({ preventScroll: true }), [])

  const inProject = useMemo(() => prepare(everything, project), [everything, project])
  const shown = useMemo(() => inProject.filter((p) => (!kinds.size || kinds.has(p.kind)) && (!agents.size || agents.has(laneOf(p)))), [inProject, kinds, agents])
  const days = useMemo(() => {
    const map = new Map<string, Point[]>()
    for (const p of shown) map.set(dayKey(p), [...(map.get(dayKey(p)) ?? []), p])
    return [...map].reverse()
  }, [shown])
  const perDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of inProject) map.set(dayKey(p), (map.get(dayKey(p)) ?? 0) + 1)
    return [...map]
  }, [inProject])

  const toggle = <T,>(set: ReadonlySet<T>, v: T, put: (s: Set<T>) => void) => {
    const n = new Set(set)
    if (!n.delete(v)) n.add(v)
    put(n)
  }
  const watch = async () => {
    await replay.setProject(project)
    replay.setMode('office')
  }
  const first = inProject[0]
  const last = inProject.at(-1)
  const range = first && last ? `${dayKey(first)} – ${dayKey(last)}` : ''
  const lanes: Lane[] = [0, 1, 2, 3, 'n']

  return (
    <section className="replay-list" aria-label="타임랩스 목록" tabIndex={-1} ref={root}>
      <header>
        <div className="replay-list-title">
          <h2>타임랩스</h2>
          <button type="button" className="replay-btn" onClick={() => replay.close()}>닫기</button>
        </div>
        <div className="chips" role="group" aria-label="프로젝트">
          {[ALL, ...s.projects].map((pr) => (
            <button key={pr} type="button" className="chip" aria-pressed={project === pr} onClick={() => setProject(pr)}>
              {pr === ALL ? '전체' : shortName(pr)} {prepare(everything, pr).length}
            </button>
          ))}
        </div>
        <Spark days={perDay} />
        <div className="sum">{range} · 점 {shown.length}개 · 최근이 위</div>
        <div className="chips">
          <button type="button" className="chip" onClick={() => void watch()}>▶ 사무실에서 보기</button>
        </div>
        <div className="chips" role="group" aria-label="종류 거르기">
          {KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kinds.has(k)} onClick={() => toggle(kinds, k, setKinds)}>{KIND_NAME[k]}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="에이전트 거르기">
          {lanes.map((l) => (
            <button key={String(l)} type="button" className="chip" aria-pressed={agents.has(l)} onClick={() => toggle(agents, l, setAgents)}>{AGENT_NAME[l]}</button>
          ))}
        </div>
      </header>
      {days.map(([day, list]) => {
        const k = kst(atMs(list[0]))
        const rows = [...list].reverse()
        const all = open.has(day)
        return (
          <section key={day} className="day" aria-label={`${k.m}월 ${k.d}일 ${k.w}요일`}>
            <h3>{k.m}월 {k.d}일 {k.w}요일 · {list.length}개</h3>
            <ol>
              {(all ? rows : rows.slice(0, PER_DAY)).map((p) => (
                <Row key={p.key} p={p} />
              ))}
            </ol>
            {!all && rows.length > PER_DAY && (
              <button type="button" className="chip more" onClick={() => setOpen(new Set(open).add(day))}>{rows.length - PER_DAY}개 더 보기</button>
            )}
          </section>
        )
      })}
      {!days.length && <p className="empty">고른 조건에 맞는 점이 없어요.</p>}
    </section>
  )
}

function Row({ p }: { p: Point }) {
  const k = kst(atMs(p))
  const lane = laneOf(p)
  const size = sizeText(p)
  return (
    <li className="row" data-seat={String(lane)}>
      <time dateTime={p.at}>{p2(k.h)}:{p2(k.mi)}</time>
      <div className="top">
        <Glyph p={p} />
        <span className="who">{AGENT_NAME[lane]}</span>
        <span className="kind">{kindName(p)}</span>
      </div>
      <div className="ttl">
        {p.secret ? (
          <>
            <span className="replay-redact wide" role="img" aria-label={SECRET_NOTE} />
            <span className="replay-secret-chip">SECRET</span>
          </>
        ) : (
          p.title
        )}
      </div>
      {(size || p.issue !== null) && (
        <div className="num">
          {size && <><span className="add">+{p.additions}</span> <span className="del">−{p.deletions ?? 0}</span> · 파일 {p.files ?? 0}</>}
          {!p.secret && p.issue !== null && `${size ? ' · ' : ''}#${p.issue}`}
        </div>
      )}
    </li>
  )
}

/** a bar per day (role=img, the numbers in the label) */
function Spark({ days }: { days: [string, number][] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !days.length) return
    const g = c.getContext('2d')!
    const t = tokens()
    g.clearRect(0, 0, c.width, c.height)
    const max = Math.max(...days.map((d) => d[1]))
    const bw = c.width / days.length
    g.fillStyle = t.muted
    days.forEach(([, n], i) => {
      const h = Math.max(2, (n / max) * (c.height - 4))
      g.fillRect(i * bw + 3, c.height - h, Math.max(1, bw - 6), h)
    })
  }, [days])
  return <canvas ref={ref} className="spark" width={732} height={56} role="img" aria-label={`날짜별 점 수: ${days.map(([d, n]) => `${d} ${n}개`).join(', ')}`} />
}
