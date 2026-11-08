import { useEffect, useMemo } from 'react'
import { closeDocs } from '../office/docs/panel'
import { atMs, dayLabel, issueRange, prepare } from './engine'
import { replay, useReplay } from './store'

/**
 * "이 일의 이력 재생" on a file of the docs viewer (#82, timelapse.md 4): replays one issue, from its first point to
 * its last. Not offered when the issue has no public points (a review project's points carry no issue number).
 */
export function IssueReplayButton({ repo, n }: { repo: string; n: number }) {
  useReplay()
  useEffect(() => void replay.load(), [])
  const every = replay.everything
  const found = useMemo(() => {
    const base = prepare(every, repo)
    const r = issueRange(base, repo, n)
    return r ? { ...r, count: r.hi - r.lo + 1, from: atMs(base[r.lo]), to: atMs(base[r.hi]) } : null
  }, [every, repo, n])
  if (!found) return null
  const span = dayLabel(found.from).slice(0, 5) === dayLabel(found.to).slice(0, 5) ? dayLabel(found.from).slice(0, 5) : `${dayLabel(found.from).slice(0, 5)} – ${dayLabel(found.to).slice(0, 5)}`
  return (
    <button
      type="button"
      className="replay-paper-btn"
      onClick={() => {
        closeDocs()
        void replay.open({ issue: { repo, n, lo: found.lo, hi: found.hi } })
      }}
    >
      <span aria-hidden="true">◀◀</span> 이 일의 이력 재생 <small>{span} · {found.count}개 점</small>
    </button>
  )
}
