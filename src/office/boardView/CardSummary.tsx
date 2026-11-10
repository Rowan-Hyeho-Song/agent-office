import { agentName } from '../../board/draw'
import { COLUMN_LABEL, type BoardCard, type Column } from '../../board/state'
import { shownTitle, topicsOf } from '../../docs/topics'
import { TopicBadges } from '../TopicBadges'
import { cardRef } from './view'

/** "11-10 14:32" in Seoul time (the office's clock), or '' when the date does not parse */
export function stamp(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** the agent's colour as a CSS variable (`--agent-N`), the unknown-session grey for a null seat */
export const agentVar = (seat: number | null) => (seat === null ? 'var(--agent-x)' : `var(--agent-${seat})`)

/** the public link of a card's issue (GitHub sends an issue number that is a PR to the PR); none for a private card (title hidden) */
export const cardUrl = (card: BoardCard): string | null => (card.title === null ? null : `https://github.com/${card.repo}/issues/${card.n}`)

/**
 * What a card says (docs-ui 3.5): who, which issue, its title, its stage, when it changed, and where to read more. A private
 * card (title null = SECRET for this viewer) shows only its head, "비공개" and the date; no title, topics or link (#182).
 */
export function CardSummary({ card, column, mainRepo, library, onLibrary }: { card: BoardCard; column: Column; mainRepo: string; library: boolean; onLibrary: () => void }) {
  const ref = cardRef(card.repo, card.n, mainRepo)
  const topics = card.title === null ? [] : topicsOf([], card.title)
  const url = cardUrl(card)
  return (
    <>
      <p className="bv-pop-head">
        <i className="bv-dot" style={{ background: agentVar(card.seat) }} aria-hidden="true" />
        <span>
          {agentName(card.seat)} · {ref}
        </span>
      </p>
      <h3 className="bv-pop-title">{card.title === null ? '책상 방 작업(비공개)' : shownTitle(card.title, topics)}</h3>
      <TopicBadges topics={topics} />
      <p className="bv-pop-meta">
        <span className="bv-chip" data-private={card.title === null ? '' : undefined}>
          {card.title === null ? '비공개' : COLUMN_LABEL[column]}
        </span>
        {stamp(card.at) && <span>마지막 갱신 {stamp(card.at)}</span>}
      </p>
      {url && (
        <p className="bv-pop-links">
          <a href={url} target="_blank" rel="noopener noreferrer">
            GitHub에서 보기 ↗<span className="sr-only"> (새 탭)</span>
          </a>
          {library && (
            <button type="button" onClick={onLibrary}>
              서재에서 열기
            </button>
          )}
        </p>
      )}
    </>
  )
}
