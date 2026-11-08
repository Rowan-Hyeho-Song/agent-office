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
