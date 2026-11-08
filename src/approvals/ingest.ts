// Filing 🖊 requests and ✅ results that arrive with /api/docs (#25). Only the owner's comments count (#38):
// a stranger's ✅ must never close a request or reach an agent through the approval hook.

import { redact } from '../docs/filter.js'
import { parseApprovalRequest, parseApprovalResult } from '../docs/parse.js'
import type { ApprovalInput, ApprovalRow, Decision } from './types.js'

export interface ApprovalStore {
  upsertApprovals(rows: ApprovalRow[]): Promise<void>
  /** close the request filed under `requestUrl` (no-op if there is none) */
  decide(requestUrl: string, d: Decision): Promise<void>
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const MAX_BODY = 20_000
const isDate = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s))

export function parseApprovalInput(a: unknown, approvers: string[]): ApprovalInput | null {
  if (!a || typeof a !== 'object') return null
  const x = a as Record<string, unknown>
  if (x.type !== 'request' && x.type !== 'result') return null
  if (typeof x.repo !== 'string' || !REPO.test(x.repo)) return null
  if (typeof x.folder !== 'number' || !Number.isInteger(x.folder) || x.folder < 1) return null
  const own = (u: unknown) => typeof u === 'string' && u.toLowerCase().startsWith(`https://github.com/${(x.repo as string).toLowerCase()}/`)
  if (!own(x.url)) return null
  if (x.answers !== undefined && x.answers !== null && !own(x.answers)) return null
  if (typeof x.body !== 'string' || x.body.length > MAX_BODY) return null
  if (x.title !== undefined && typeof x.title !== 'string') return null
  if (!isDate(x.created_at) || !isDate(x.updated_at)) return null
  const author = x.author as Record<string, unknown> | undefined
  if (!author || typeof author.login !== 'string' || typeof author.association !== 'string') return null
  // the owner's 🖊 / ✅ only
  if (!approvers.includes(author.association.toUpperCase())) return null
  return x as unknown as ApprovalInput
}

/** a 🖊 comment → the row to store (null when it doesn't parse) */
export function requestRow(a: ApprovalInput, banned: string[]): ApprovalRow | null {
  const r = parseApprovalRequest(redact(a.body, banned).text)
  if (!r) return null
  return {
    repo: a.repo,
    folder: a.folder,
    title: redact(String(a.title ?? '').slice(0, 300), banned).text,
    source_url: a.url,
    kind: r.kind,
    requester: r.requester,
    requester_seat: r.requesterSeat,
    content: r.content,
    options: r.options,
    recommended: r.recommended,
    reason: r.reason,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

/** a ✅ comment → the decision for the request it answers (null when it doesn't parse or answers nothing) */
export function resultDecision(a: ApprovalInput, banned: string[]): { requestUrl: string; decision: Decision } | null {
  if (!a.answers) return null
  const r = parseApprovalResult(redact(a.body, banned).text)
  if (!r) return null
  // /api/approve writes "없음" for an empty opinion; read back, that is no opinion
  const opinion = r.opinion && r.opinion !== '없음' ? r.opinion : null
  return {
    requestUrl: a.answers,
    decision: { result: r.result, option: r.option, opinion, result_url: a.url, decided_at: a.created_at },
  }
}

/**
 * File a batch: requests first (a result in the same batch may answer one of them), then results.
 * Returns what was done; strangers' and unreadable items are counted as skipped.
 */
export async function ingestApprovals(items: unknown[], store: ApprovalStore, cfg: { banned: string[]; approvers: string[] }) {
  const parsed = items.map((i) => parseApprovalInput(i, cfg.approvers))
  const requests = parsed.flatMap((a) => (a?.type === 'request' ? [requestRow(a, cfg.banned)] : [])).filter((r): r is ApprovalRow => !!r)
  const results = parsed.flatMap((a) => (a?.type === 'result' ? [resultDecision(a, cfg.banned)] : [])).filter((r) => !!r)
  if (requests.length) await store.upsertApprovals(requests)
  for (const r of results) await store.decide(r.requestUrl, r.decision)
  return { requests: requests.length, results: results.length, skipped: items.length - requests.length - results.length }
}
