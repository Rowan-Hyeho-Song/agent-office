import { HIDDEN_DAYS, kstDayOf } from '../../docs/library'
import { Icon } from '../ApprovalIcons'

// #710 (C안, docs-ui.md 2.1): the private folder opened. No files, numbers or names: that it does not share its contents, when it was last worked on,
// and the last HIDDEN_DAYS as cells, the days with work hatched like the seat's "비공개 작업 중". How long or how often is never shown.

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const dayParts = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return { m, d, w: WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }
}
const p2 = (n: number) => String(n).padStart(2, '0')

export function HiddenPanel({ hidden, now = Date.now() }: { hidden: { days: string[]; last: string }; now?: number }) {
  const cells = Array.from({ length: HIDDEN_DAYS }, (_, i) => kstDayOf(now - (HIDDEN_DAYS - 1 - i) * 86_400_000))
  const worked = new Set(hidden.days)
  const last = dayParts(kstDayOf(Date.parse(hidden.last)))
  const first = dayParts(cells[0])
  const today = dayParts(cells[cells.length - 1])
  return (
    <section className="doc-hidden" aria-label="비공개 프로젝트">
      <p className="doc-hidden-lead">
        <Icon name="lock" />
        이 프로젝트는 내용을 공개하지 않아요.
      </p>
      <p className="doc-hidden-last">
        최근 활동 {p2(last.m)}.{p2(last.d)} ({last.w})
      </p>
      <ol className="doc-hidden-cal" aria-label={`최근 ${HIDDEN_DAYS}일 활동`}>
        {cells.map((key) => {
          const { m, d } = dayParts(key)
          const on = worked.has(key)
          return <li key={key} data-on={on || undefined} aria-label={`${m}월 ${d}일, ${on ? '활동 있음' : '활동 없음'}`} />
        })}
      </ol>
      <div className="doc-hidden-ends" aria-hidden="true">
        <span>
          {p2(first.m)}.{p2(first.d)}
        </span>
        <span>
          {p2(today.m)}.{p2(today.d)}
        </span>
      </div>
    </section>
  )
}
