import { STAGE_NAME, type Progress, type Stage } from '../docs/progress'
import { Icon, pathOf } from './ApprovalIcons'

// The progress marks of the library (#241, docs/design/docs-ui.md 2.5): the status chip (a 12 px pixel circle that fills up
// with the stage + the stage's name, no box so it never reads as a topic badge), the 결재 대기 chip (the stamp icon, amber)
// and the progress bar with its number. Always icon + text or bar + number: colour is never the only cue.

const C = 5.5 // centre of the 12 x 12 grid
const dist = (x: number, y: number) => Math.hypot(x - C, y - C)

/** the circle: an outline always, filled where `fill(x, y)` says (the inside is r <= 4.2); `cut` pixels are punched out */
function circle(fill: (x: number, y: number) => boolean, cut: ReadonlySet<string> = new Set()): string[] {
  return Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 12 }, (_, x) => {
      const d = dist(x, y)
      const on = d <= 5.95 && (d > 4.2 || fill(x, y))
      return on && !cut.has(`${x},${y}`) ? '#' : '.'
    }).join(''),
  )
}
// the check mark inside the full circle, punched out so the page shows through
const CHECK = new Set(['3,6', '4,7', '5,8', '6,7', '7,6', '8,5', '9,4', '3,5', '4,6', '5,7', '6,6', '7,5', '8,4'])

const STAGE_ICONS: Record<Stage, readonly string[]> = {
  waiting: circle(() => false),
  doing: circle((x, y) => x >= 6 && y <= 5),
  review: circle((x) => x >= 6),
  done: circle(() => true, CHECK),
}
const STAGE_PATHS = Object.fromEntries(Object.entries(STAGE_ICONS).map(([k, rows]) => [k, pathOf(rows)])) as Record<Stage, string>

export function StageIcon({ stage }: { stage: Stage }) {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={STAGE_PATHS[stage]} />
    </svg>
  )
}

/** `◔ 진행 중`: the stage as an icon and its name */
export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span className="stage" data-stage={stage}>
      <StageIcon stage={stage} />
      {STAGE_NAME[stage]}
    </span>
  )
}

/** `▣ 결재 대기`: nothing when no 🖊 request waits */
export function PendingChip({ progress }: { progress: Progress | null }) {
  if (!progress || progress.pending < 1) return null
  return (
    <span className="stage" data-stage="pending">
      <Icon name="review" />
      결재 대기{progress.pending > 1 ? ` ${progress.pending}` : ''}
    </span>
  )
}

/**
 * The 완료 기준 bar (`variant`: `row` a 48 x 4 px bar + `3/5` at the end of a list row, `wide` the full width of the cover with
 * `완료 기준 3/5`; the path line and a narrow row hide the bar by CSS and keep the number). A full bar gets a ✓ before the number, also
 * while the issue is not closed. Screen readers get one sentence, the pieces are hidden from them. Nothing without checkboxes.
 */
export function ProgressBar({ progress, variant = 'row' }: { progress: Progress | null; variant?: 'row' | 'wide' }) {
  const c = progress?.checks
  if (!progress || !c) return null
  const full = c.done === c.total
  return (
    <span className={`pbar ${variant}`} data-stage={progress.stage} data-full={full || undefined}>
      <span className="sr-only">
        완료 기준 {c.total}개 중 {c.done}개
      </span>
      <span className="pbar-track" aria-hidden="true">
        <i style={{ width: `${(c.done / c.total) * 100}%` }} />
      </span>
      <span className="pbar-num" aria-hidden="true">
        {variant === 'wide' && '완료 기준 '}
        {full && '✓ '}
        {c.done}/{c.total}
      </span>
    </span>
  )
}
