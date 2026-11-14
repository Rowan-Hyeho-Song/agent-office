// The library's file list in groups (#462, docs/design/docs-ui.md 2.6): 지금 하는 일 on top (a heading, never folded), then
// 다음 배포 대기 and the deploys (or the months) as an accordion. A header is a button (aria-expanded) inside a heading; the
// deploy PR is its own link next to it, reached by Tab after the button. A folded group's rows are out of the Tab order
// (visibility: hidden once the 180 ms close is over). The groups are worked out in src/docs/deployGroups.ts.

import { useId, useRef, type ReactNode } from 'react'
import type { DocFile } from '../../docs/library'
import { groupHead, isOpen, type DoneGroup, type Folds, type Grouped } from '../../docs/deployGroups'

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches

export function FileGroups({
  grouped,
  folds,
  repo,
  onFold,
  row,
  unread,
}: {
  grouped: Grouped
  folds: Folds
  /** owner/name, for the deploy PR's address; null = the private folder */
  repo: string | null
  onFold: (key: string, open: boolean) => void
  row: (f: DocFile) => ReactNode
  unread: (f: DocFile) => boolean
}) {
  return (
    <>
      {grouped.now.length > 0 && (
        <section className="doc-group now" aria-labelledby="doc-group-now">
          <h5 className="dg-now" id="doc-group-now">
            지금 하는 일 <span className="dg-count">{grouped.now.length}</span>
          </h5>
          {grouped.now.map(row)}
        </section>
      )}
      {grouped.done.map((g) => (
        <Group key={g.key} g={g} open={isOpen(g, grouped.done, folds)} repo={repo} onFold={onFold} row={row} fresh={g.files.some(unread)} />
      ))}
    </>
  )
}

function Group({ g, open, repo, onFold, row, fresh }: { g: DoneGroup; open: boolean; repo: string | null; onFold: (key: string, open: boolean) => void; row: (f: DocFile) => ReactNode; fresh: boolean }) {
  const id = useId()
  const head = groupHead(g)
  const btn = useRef<HTMLButtonElement>(null)
  const prUrl = repo && head.pr ? `https://github.com/${repo}/pull/${head.pr}` : null
  const toggle = () => {
    onFold(g.key, !open)
    // the phone: the opened group's header goes to the top of the sheet, so what opened is not pushed out of sight
    // below the list's sticky head (tabs · path · filter chips), not under it (#462 designer)
    if (!open && narrow())
      requestAnimationFrame(() => {
        const h = btn.current?.closest('h5')
        if (!h) return
        const sticky = h.closest('.doc-nav')?.querySelector<HTMLElement>('.doc-head')
        h.style.scrollMarginTop = `${(sticky?.offsetHeight ?? 0) + 8}px`
        h.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
  }
  return (
    <section className="doc-group" data-open={open || undefined} data-kind={g.kind}>
      <h5 className="dg-head">
        <button ref={btn} type="button" className="dg-toggle" id={`${id}-h`} aria-expanded={open} aria-controls={`${id}-b`} aria-label={head.spoken} onClick={toggle} />
        <span className="dg-face">
          <span className="dg-l1">
            <i className="dg-tri" aria-hidden="true" />
            {fresh && !open && <i className="doc-dot" aria-hidden="true" />}
            <b className="dg-lead" aria-hidden="true">
              {head.lead}
            </b>
            {head.date && (
              <span className="dg-date" aria-hidden="true">
                · {head.date}
              </span>
            )}
            {prUrl && (
              <a className="dg-pr" href={prUrl} target="_blank" rel="noopener noreferrer" aria-label={`배포 PR ${head.pr}, 새 창`}>
                · #{head.pr}
              </a>
            )}
            <span className="dg-count" aria-hidden="true">
              {head.count}
            </span>
          </span>
          {head.summary && (
            <span className="dg-sum" aria-hidden="true">
              {head.summary}
            </span>
          )}
        </span>
      </h5>
      <div className="dg-body" id={`${id}-b`} role="region" aria-labelledby={`${id}-h`}>
        <div className="dg-inner">
          {prUrl && (
            <a className="dg-pr-line" href={prUrl} target="_blank" rel="noopener noreferrer">
              배포 PR #{head.pr} ↗
            </a>
          )}
          {g.files.map(row)}
        </div>
      </div>
    </section>
  )
}
