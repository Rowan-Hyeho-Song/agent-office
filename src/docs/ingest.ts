// /api/docs, minus the database (#24): check the Action's token and payload, then turn each GitHub item into a
// stored document: filter (paths, emails, keys, banned words), grade, parse the structure, summarize.
// Pure apart from the store, so it's unit tested.

import { gradeFor, redact } from './filter'
import { agentsIn, parseApprovalRequest, parseApprovalResult, parseMinutes, section, summarize } from './parse'
import { DOC_KINDS, type DocInput, type DocRow, type Speaker } from './types'

export interface DocStore {
  upsert(rows: DocRow[]): Promise<void>
  setOpenIssues(repo: string, open: number, at: string): Promise<void>
}

export interface IngestConfig {
  token: string
  /** repos whose documents are public (plan.md 6.3); everything else is review = SECRET until approved */
  publicRepos: string[]
  /** extra words to hide (company names …), from server config, never from the repo */
  banned: string[]
}

export interface Payload {
  docs: DocInput[]
  /** the repo's open issue count, sent with issue events */
  project?: { repo: string; open_issues: number }
}

const MAX_DOCS = 100
const MAX_BODY = 100_000
const REPO = /^[\w.-]+\/[\w.-]+$/
/** the Action only files these; worklogs come from the Stop hook later */
const ACCEPTED = DOC_KINDS.filter((k) => k !== 'worklog')

const isDate = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s))

export function parseDoc(d: unknown): DocInput | null {
  if (!d || typeof d !== 'object') return null
  const x = d as Record<string, unknown>
  const source = x.source as Record<string, unknown> | undefined
  if (!(ACCEPTED as readonly unknown[]).includes(x.kind)) return null
  if (typeof x.repo !== 'string' || !REPO.test(x.repo)) return null
  if (typeof x.folder !== 'number' || !Number.isInteger(x.folder) || x.folder < 1) return null
  if (typeof x.title !== 'string' || x.title.length > 300) return null
  if (typeof x.body !== 'string' || x.body.length > MAX_BODY) return null
  if (!source || !['issue', 'comment', 'pr'].includes(source.kind as string) || typeof source.url !== 'string') return null
  // a document must point at its own repo on GitHub: a leaked token still can't file arbitrary pages
  if (!source.url.toLowerCase().startsWith(`https://github.com/${x.repo.toLowerCase()}/`)) return null
  if (!isDate(x.created_at) || !isDate(x.updated_at)) return null
  if (x.meta !== undefined && (typeof x.meta !== 'object' || x.meta === null || Array.isArray(x.meta))) return null
  return x as unknown as DocInput
}

const seatOf = (s: Speaker) => ('seat' in s ? [s.seat] : [])
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b)

/** one GitHub item → the row to store */
export function toRow(input: DocInput, cfg: Pick<IngestConfig, 'publicRepos' | 'banned'>): DocRow {
  const title = redact(input.title, cfg.banned)
  const body = redact(input.body, cfg.banned)
  const grade = gradeFor(input.repo, cfg.publicRepos, [...title.hits, ...body.hits])
  const meta = (input.meta ?? {}) as Record<string, unknown>
  let data: Record<string, unknown> = { ...meta }
  let agents: number[] = []
  let summary: string

  switch (input.kind) {
    case 'minutes': {
      const minutes = parseMinutes(body.text)
      data = { ...data, minutes }
      agents = minutes.flatMap((m) => m.rows.flatMap((r) => [...seatOf(r.from), ...r.to.flatMap(seatOf)]))
      summary = summarize('minutes', body.text)
      break
    }
    case 'decision': {
      // the Action sends the matching 🖊 request's body in meta.request, so the decision knows what was asked
      const request = typeof meta.request === 'string' ? parseApprovalRequest(redact(meta.request, cfg.banned).text) : null
      data = { result: parseApprovalResult(body.text), request }
      agents = request?.requesterSeat != null ? [request.requesterSeat] : []
      summary = summarize('decision', body.text)
      break
    }
    case 'plan':
      agents = agentsIn(section(body.text, '누가 하나') ?? '')
      summary = summarize('plan', body.text)
      break
    default:
      agents = agentsIn(section(body.text, 'AI 작성') ?? '')
      summary = summarize('report', body.text)
  }

  return {
    kind: input.kind,
    repo: input.repo,
    folder: input.folder,
    title: title.text,
    summary,
    body: body.text,
    agents: uniq(agents),
    source_kind: input.source.kind,
    source_url: input.source.url,
    grade,
    approved: grade === 'public',
    data,
    created_at: input.created_at,
    updated_at: input.updated_at,
  }
}

/** constant-time string compare */
export function sameToken(a: string, b: string) {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function handle(request: Request, store: DocStore, cfg: IngestConfig, now = new Date()): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const auth = request.headers.get('authorization') ?? ''
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), cfg.token)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const p = body as Partial<Payload> | null
  if (!p || !Array.isArray(p.docs) || p.docs.length > MAX_DOCS) return Response.json({ error: 'bad payload' }, { status: 400 })
  const docs = p.docs.map(parseDoc)
  const bad = docs.findIndex((d) => !d)
  if (bad >= 0) return Response.json({ error: `bad doc ${bad}` }, { status: 400 })

  const rows = (docs as DocInput[]).map((d) => toRow(d, cfg))
  if (rows.length) await store.upsert(rows)
  const project = p.project
  if (project && typeof project.repo === 'string' && REPO.test(project.repo) && Number.isInteger(project.open_issues) && project.open_issues >= 0) {
    await store.setOpenIssues(project.repo, project.open_issues, now.toISOString())
  }
  return Response.json({ ok: true, stored: rows.length, grades: rows.map((r) => r.grade) })
}
