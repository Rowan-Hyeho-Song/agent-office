// /api/approve, minus the network (#25, plan.md 6.5–6.6): the owner decides one pending approval in the office.
// The server checks the sign-in itself (a hidden button is not a lock): the Supabase access token must belong
// to the GitHub account in OFFICE_OWNER_GITHUB_ID, otherwise 403. Then it posts the ✅ comment on the same issue
// with a token that can only write issues of this repo, and records the decision.
//
// Only approvals pass through here. Claude Code's tool-permission prompts never do (plan.md 6.5).

import type { Decision, StoredApproval } from './types.js'

export interface ApproveDeps {
  /** the GitHub user id of whoever owns this Supabase access token, or null (invalid / not a GitHub sign-in) */
  githubIdOf(accessToken: string): Promise<string | null>
  ownerGithubId: string
  approval(id: number): Promise<StoredApproval | null>
  /**
   * Take the approval for this request: pending → deciding in one conditional update. true only for the one
   * caller whose update changed the row (#48: two quick clicks must not post two ✅ comments).
   */
  lock(id: number): Promise<boolean>
  /** give it back (deciding → pending) when the comment couldn't be posted, so it can be decided again */
  unlock(id: number): Promise<void>
  /** post a comment on the issue, return its URL */
  comment(repo: string, folder: number, body: string): Promise<string>
  /** deciding → decided, with the decision */
  decide(id: number, d: Decision): Promise<void>
}

export interface Choice {
  result: string
  option: number | null
}

const MAX_OPINION = 1000

/** document publishing outcomes (plan.md 6.5) */
export const PUBLISH_RESULTS = ['공개', '고쳐서 공개', '계속 SECRET'] as const

/**
 * Which answers an approval takes (plan.md 6.5): a 결정 요청 picks one of its options or is rejected (반려);
 * 문서 공개 is 공개 / 고쳐서 공개 / 계속 SECRET; 산출물 확인 is 승인 or 반려.
 */
export function readChoice(a: Pick<StoredApproval, 'kind' | 'options'>, result: unknown): Choice | null {
  if (typeof result !== 'string') return null
  if (/공개/.test(a.kind)) return (PUBLISH_RESULTS as readonly string[]).includes(result) ? { result, option: null } : null
  if (result === '반려') return { result: '반려', option: null }
  if (/결정/.test(a.kind)) {
    const m = /^선택지 (\d+)$/.exec(result)
    const n = m ? Number(m[1]) : NaN
    return Number.isInteger(n) && n >= 1 && n <= a.options.length ? { result: `선택지 ${n}`, option: n } : null
  }
  return result === '승인' ? { result: '승인', option: null } : null
}

/** outcomes that send the agent back to work need a reason it can act on */
export const needsOpinion = (result: string) => result === '반려' || result === '고쳐서 공개' || result === '계속 SECRET'

/** one line of text: the opinion can't add headings or bold fields that the ✅ reader would pick up */
export function cleanOpinion(opinion: unknown): string {
  if (typeof opinion !== 'string') return ''
  return opinion
    .replace(/\s+/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, MAX_OPINION)
}

/** the ✅ comment, in the format the office reads back (#25 body, plan.md 6.5) */
export function resultComment(date: string, result: string, opinion: string) {
  return `### ✅ 결재 (${date})\n**결과**: ${result}\n**의견**: ${opinion || '없음'}`
}

export async function handle(request: Request, deps: ApproveDeps, now = new Date()): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // anyone who isn't the owner (signed out, another account, a bad token) gets the same answer
  const who = token ? await deps.githubIdOf(token) : null
  if (!who || !deps.ownerGithubId || who !== deps.ownerGithubId) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const id = body?.id
  if (typeof id !== 'number' || !Number.isInteger(id)) return Response.json({ error: 'bad id' }, { status: 400 })
  const approval = await deps.approval(id)
  if (!approval) return Response.json({ error: 'not found' }, { status: 404 })
  // (a row in 'deciding' is someone else's click in flight, or a crashed one: lock() below decides which)
  if (approval.status === 'decided') return Response.json({ error: 'already decided', result_url: approval.result_url }, { status: 409 })
  const choice = readChoice(approval, body.result)
  if (!choice) return Response.json({ error: 'bad result' }, { status: 400 })

  const opinion = cleanOpinion(body.opinion)
  if (needsOpinion(choice.result) && !opinion) return Response.json({ error: 'opinion required' }, { status: 400 })

  // lock before posting: of two quick clicks only one gets past this line, so only one ✅ comment (#48)
  if (!(await deps.lock(id))) return Response.json({ error: 'already decided' }, { status: 409 })
  const date = now.toISOString().slice(0, 10)
  let url: string
  try {
    url = await deps.comment(approval.repo, approval.folder, resultComment(date, choice.result, opinion))
  } catch (e) {
    await deps.unlock(id) // nothing was posted: let the owner try again
    throw e
  }
  await deps.decide(id, { ...choice, opinion: opinion || null, result_url: url, decided_at: now.toISOString() })
  return Response.json({ ok: true, result: choice.result, url })
}
