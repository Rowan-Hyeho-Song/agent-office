// What the approval box shows, as pure functions (the component only draws it): kinds, the answers each kind
// takes (same rules as the server's readChoice), the opinion rule and the dates.

import { PUBLISH_RESULTS } from './approve.js'
import type { StoredApproval } from './types.js'

export type Kind = 'decision' | 'publish' | 'review'
export const KIND_LABEL: Record<Kind, string> = { decision: '결정 요청', publish: '문서 공개', review: '산출물 확인' }

/** same matching as the server (approve.ts readChoice) */
export function kindOf(kind: string): Kind {
  if (/공개/.test(kind)) return 'publish'
  if (/결정/.test(kind)) return 'decision'
  return 'review'
}

export interface Answer {
  /** what /api/approve takes as `result` */
  value: string
  /** the card's number, or ✕ */
  num: string
  label: string
  recommended: boolean
  /** dimmed like a refusal (반려, 계속 SECRET); 고쳐서 공개 needs an opinion but is not dimmed */
  reject: boolean
}

const isRefusal = (result: string) => result === '반려' || result === '계속 SECRET'

export function answersFor(a: Pick<StoredApproval, 'kind' | 'options' | 'recommended'>): Answer[] {
  const k = kindOf(a.kind)
  const mk = (value: string, i: number, label = value): Answer => ({
    value,
    num: String(i + 1),
    label,
    recommended: false,
    reject: isRefusal(value),
  })
  if (k === 'publish') return PUBLISH_RESULTS.map((r, i) => mk(r, i))
  if (k === 'decision') {
    return [
      ...a.options.map((o, i): Answer => ({ value: `선택지 ${i + 1}`, num: String(i + 1), label: o, recommended: a.recommended === i + 1, reject: false })),
      { value: '반려', num: '✕', label: '반려 (의견으로 다시 요청)', recommended: false, reject: true },
    ]
  }
  return [mk('승인', 0), mk('반려', 1)]
}

/**
 * The opinion field for the chosen answer, in one place: the label's hint, whether an opinion is required (the
 * 결재 button stays disabled while it is empty; aria-invalid after an attempt). Required = the server's needsOpinion.
 */
export function noteHint(result: string | null): { required: boolean; hint: string } {
  if (result === '반려') return { required: true, hint: '* 반려에는 이유가 필요해요' }
  if (result === '고쳐서 공개') return { required: true, hint: '* 무엇을 고칠지 적어 주세요' }
  if (result === '계속 SECRET') return { required: true, hint: '* 공개하지 않는 이유를 적어 주세요' }
  return { required: false, hint: '(선택)' }
}

/** the live-region sentence after deciding */
export const decidedText = (a: Pick<StoredApproval, 'title' | 'repo' | 'folder'>, result: string) =>
  `결재했어요: ${a.title} — ${result}. ${shortRepo(a.repo)} #${a.folder}에 댓글을 남겼어요.`

export const shortRepo = (repo: string) => repo.split('/').pop() ?? repo

const two = (n: number) => String(n).padStart(2, '0')
/** "11.08 01:55" in the viewer's clock */
export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}
/** "11.08" */
export const fmtDay = (iso: string) => fmtDate(iso).split(' ')[0]

/** pending first-come first-served: the oldest waits longest */
export const oldestFirst = <T extends { created_at: string }>(items: T[]) => [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))

// ---- a decided approval (#222): the result stamp, the times, the row's spoken label ----

/** the stamp's word: 승인 · 반려 · 안 N (선택지 N); the document outcomes (공개 · 고쳐서 공개 · 계속 SECRET) as they are */
export function stampText(result: string | null): string {
  const r = (result ?? '').trim()
  const m = /^선택지 (\d+)$/.exec(r)
  return m ? `안 ${m[1]}` : r
}

/** the chosen option's number (1-based) of a decided 결정 요청, or null */
export const chosenOption = (a: Pick<StoredApproval, 'option' | 'result'>): number | null => {
  if (a.option) return a.option
  const m = /^선택지 (\d+)$/.exec(a.result ?? '')
  return m ? Number(m[1]) : null
}

/** "11-09 23:58" in the viewer's clock (the detail's time line) */
export function fmtStamp(iso: string | null): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** "걸린 시간 1시간 22분": from the request to the decision; null when either time is missing or the order is wrong */
export function elapsedText(fromIso: string, toIso: string | null): string | null {
  if (!toIso) return null
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.floor(ms / 60_000)
  const part = (big: number, bigUnit: string, small: number, smallUnit: string) => (small ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`)
  if (min < 1) return '걸린 시간 1분 미만'
  if (min < 60) return `걸린 시간 ${min}분`
  if (min < 24 * 60) return `걸린 시간 ${part(Math.floor(min / 60), '시간', min % 60, '분')}`
  return `걸린 시간 ${part(Math.floor(min / 1440), '일', Math.floor((min % 1440) / 60), '시간')}`
}

/** "11월 9일 23시 58분", for screen readers */
export function spokenDate(iso: string | null): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 ${d.getMinutes()}분`
}

/** the owner's decided row: "메모 결재: 5인 책상 배치 — 승인, 11월 9일 23시 58분" */
export const decidedLabel = (who: string, title: string, result: string | null, decidedAt: string | null) =>
  `${who} 결재: ${title} — ${stampText(result)}, ${spokenDate(decidedAt)}`

/** the visitor's decided row: the title is not theirs to read */
export const decidedCoverLabel = (who: string, result: string | null, decidedAt: string | null) => `${who} 결재 서류 — ${stampText(result)}, ${spokenDate(decidedAt)}`
