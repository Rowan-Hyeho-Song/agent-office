// Parsers for the agents' structured GitHub comments (plan.md 6.2, 6.5). Pure functions: markdown in, structure out.
import type { ApprovalRequest, ApprovalResult, Minutes, MinutesRow, Speaker } from './types'

type Seat = 0 | 1 | 2 | 3

// role words -> seat. ASCII words match case-insensitively on word edges (agentsIn); Korean words match as written.
const SEAT_WORDS: [Seat, string[]][] = [
  [0, ['기획', '메모', 'MEMO']],
  [1, ['Blender', '3D', '메시', 'MESH']],
  [2, ['디자이너', '디자인', '휴', 'HUE']],
  [3, ['코더', '루프', 'LOOP']],
]
const OWNER_WORDS = ['사용자', '사람', '주인', 'rowan']

const WORD_TO_SEAT = new Map<string, Seat>()
for (const [seat, words] of SEAT_WORDS) for (const w of words) WORD_TO_SEAT.set(w.toLowerCase(), seat)

export function speakerFor(name: string): Speaker {
  const raw = name.trim()
  const key = raw
    .replace(/[`*_]/g, '')
    .replace(/\s*(세션|에이전트)$/, '')
    .trim()
    .toLowerCase()
  const seat = WORD_TO_SEAT.get(key)
  if (seat !== undefined) return { seat }
  if (OWNER_WORDS.includes(key)) return { owner: true }
  return { name: raw }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const AGENT_WORD_RES: [Seat, RegExp][] = SEAT_WORDS.map(([seat, words]) => [
  seat,
  new RegExp(
    words.map((w) => (/^[\x00-\x7f]+$/.test(w) ? `(?<![A-Za-z0-9])${escapeRe(w)}(?![A-Za-z0-9])` : escapeRe(w))).join('|'),
    'i',
  ),
])

/** sorted unique seats whose role words appear anywhere in the text */
export function agentsIn(text: string): number[] {
  return AGENT_WORD_RES.filter(([, re]) => re.test(text)).map(([seat]) => seat)
}

const norm = (s: string) => s.replace(/\r\n?/g, '\n')

export function section(markdown: string, heading: string): string | null {
  const lines = norm(markdown).split('\n')
  const want = heading.trim()
  const start = lines.findIndex((l) => /^## (?!#)/.test(l) && l.replace(/^##\s+/, '').trim() === want)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

// ---- minutes -------------------------------------------------------------------------------------------------------

const MINUTES_HEADING = /^###\s*🗂\s*에이전트 간 협의 기록(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*$/
const ANY_HEADING = /^#{1,3}\s/

function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

function receivers(cell: string): Speaker[] {
  return cell
    .split(/\s*[·,/、&]\s*|\s+및\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(speakerFor)
}

// only the table whose header is `순서 | 보낸 쪽 → 받는 쪽 | 내용` (other tables in the comment are ignored)
function parseRows(lines: string[]): MinutesRow[] {
  const rows: MinutesRow[] = []
  let i = lines.findIndex((l) => {
    if (!l.trim().startsWith('|')) return false
    const c = splitCells(l)
    return c[0] === '순서' && (c[1] ?? '').includes('→')
  })
  if (i < 0) return rows
  i++
  if (i < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i])) i++
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = splitCells(lines[i])
    const order = Number.parseInt(c[0], 10)
    if (!Number.isFinite(order) || c.length < 3) continue
    const [fromCell, ...toParts] = c[1].split(/→|->/)
    rows.push({ order, from: speakerFor(fromCell), to: receivers(toParts.join('→')), text: c.slice(2).join(' | ').trim() })
  }
  return rows
}

const DECISION_RE = /^\*\*결정(?:\s*\([^)]*\))?\*\*\s*[:：]?\s*(.*)$/
const FOLLOWUP_RE = /^\*\*후속(?:\s*\([^)]*\))?\*\*\s*[:：]?\s*(.*)$/

export function parseMinutes(markdown: string): Minutes[] {
  const lines = norm(markdown).split('\n')
  const out: Minutes[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = MINUTES_HEADING.exec(lines[i].trim())
    if (!h) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (ANY_HEADING.test(lines[j])) {
        end = j
        break
      }
    }
    const block = lines.slice(i + 1, end)
    const parts = { decision: [] as string[], followUp: [] as string[] }
    let cur: 'decision' | 'followUp' | null = null
    for (const line of block) {
      const t = line.trim()
      const d = DECISION_RE.exec(t)
      const f = FOLLOWUP_RE.exec(t)
      if (d) {
        cur = 'decision'
        parts.decision.push(d[1])
      } else if (f) {
        cur = 'followUp'
        parts.followUp.push(f[1])
      } else if (cur) {
        parts[cur].push(line)
      }
    }
    const join = (a: string[]) => a.join('\n').trim() || null
    out.push({ date: h[1] ?? null, rows: parseRows(block), decision: join(parts.decision), followUp: join(parts.followUp) })
    i = end - 1
  }
  return out
}

// ---- approvals -----------------------------------------------------------------------------------------------------

const APPROVAL_REQUEST_HEADING = /^###\s*🖊\s*결재 요청(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*$/
const APPROVAL_RESULT_HEADING = /^###\s*✅\s*결재(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*$/
const FIELD_RE = /^\*\*([^*]+)\*\*\s*[:：]?\s*(.*)$/

/** the lines from the heading to the next heading, plus the heading's date */
function headingBlock(markdown: string, re: RegExp): { date: string | null; lines: string[] } | null {
  const lines = norm(markdown).split('\n')
  const i = lines.findIndex((l) => re.test(l.trim()))
  if (i < 0) return null
  const m = re.exec(lines[i].trim())!
  let end = lines.length
  for (let j = i + 1; j < lines.length; j++) {
    if (ANY_HEADING.test(lines[j])) {
      end = j
      break
    }
  }
  return { date: m[1] ?? null, lines: lines.slice(i + 1, end) }
}

/** field name -> raw text lines (the inline value first, then the following lines up to the next field) */
function fieldsOf(lines: string[], names: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let cur: string[] | null = null
  for (const line of lines) {
    const m = FIELD_RE.exec(line.trim())
    if (m && names.includes(m[1].trim())) {
      cur = [m[2]]
      map.set(m[1].trim(), cur)
    } else if (cur) cur.push(line)
  }
  return map
}

const clean = (a: string[] | undefined) => (a ? a.join('\n').trim() : '')

/** a paragraph-level field: the inline value plus the following lines until the first blank line */
function untilBlank(a: string[] | undefined): string | null {
  if (!a) return null
  const out: string[] = [a[0]]
  for (const l of a.slice(1)) {
    if (!l.trim()) break
    out.push(l)
  }
  return out.join('\n').trim() || null
}

export function parseApprovalRequest(markdown: string): ApprovalRequest | null {
  const b = headingBlock(markdown, APPROVAL_REQUEST_HEADING)
  if (!b) return null
  const f = fieldsOf(b.lines, ['종류', '요청', '내용', '선택지', '추천 이유'])
  const kind = clean(f.get('종류'))
  if (!kind) return null
  const requester = clean(f.get('요청')).split('\n')[0].trim()
  const who = speakerFor(requester.split('(')[0])
  const options: string[] = []
  let recommended: number | null = null
  for (const line of f.get('선택지') ?? []) {
    const m = /^\s*(\d+)\.\s+(.*)$/.exec(line)
    if (!m) continue
    if (/\(추천\)/.test(m[2]) && recommended === null) recommended = options.length + 1
    options.push(m[2].replace(/\s*\(추천\)/g, '').trim())
  }
  return {
    date: b.date,
    kind,
    requester,
    requesterSeat: 'seat' in who ? who.seat : null,
    content: clean(f.get('내용')),
    options,
    recommended,
    reason: untilBlank(f.get('추천 이유')),
  }
}

export function parseApprovalResult(markdown: string): ApprovalResult | null {
  const b = headingBlock(markdown, APPROVAL_RESULT_HEADING)
  if (!b) return null
  const f = fieldsOf(b.lines, ['결과', '의견'])
  const result = clean(f.get('결과')).split('\n')[0].trim()
  if (!result) return null
  const n = /선택지\s*(\d+)/.exec(result)
  return { date: b.date, result, option: n ? Number(n[1]) : null, opinion: clean(f.get('의견')) || null }
}

// ---- summaries -----------------------------------------------------------------------------------------------------

function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*(?:[-*>]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(md: string): string {
  for (const p of md.split(/\n\s*\n/)) {
    const t = p.trim()
    if (t && !/^#{1,6}\s/.test(t) && !t.startsWith('|')) return t
  }
  return ''
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, Math.max(0, max - 1))
  const sp = head.lastIndexOf(' ')
  return (sp > max / 2 ? head.slice(0, sp) : head).replace(/[\s,.;:]+$/, '') + '…'
}

export function summarize(kind: 'plan' | 'minutes' | 'decision' | 'report', markdown: string, max = 140): string {
  const md = norm(markdown).replace(/<!--[\s\S]*?-->/g, '')
  let src = ''
  if (kind === 'plan') {
    src = firstParagraph(section(md, '배경과 목표') ?? md)
  } else if (kind === 'report') {
    src = firstParagraph(section(md, '무엇을, 왜') ?? md)
  } else if (kind === 'minutes') {
    const m = parseMinutes(md)[0]
    src = m ? (m.decision ?? m.rows[0]?.text ?? '') : firstParagraph(md)
  } else {
    src = parseApprovalResult(md)?.opinion ?? firstParagraph(md)
  }
  return cut(plain(src), max)
}
