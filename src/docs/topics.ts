// The topic badges of the library (#236, docs/design/docs-ui.md 3.6): what an issue is about, read from its GitHub
// labels first and, for the slots left, from the title's leading bracket prefix. Pure; the components only draw.

export const TOPIC_IDS = ['feature', 'bug', 'design', 'asset', 'plan', 'docs', 'perf', 'ui', 'a11y', 'sound'] as const
export type TopicId = (typeof TOPIC_IDS)[number]

export interface Topic {
  id: TopicId
  /** the badge text */
  name: string
  /** GitHub labels that mean this topic (lower case) */
  labels: readonly string[]
  /** title prefix parts that mean this topic, e.g. `[3D 에셋]` or the `3D` of `[디자인·3D]` (lower case) */
  prefixes: readonly string[]
}

export const TOPICS: readonly Topic[] = [
  { id: 'feature', name: '기능', labels: ['feature', 'enhancement'], prefixes: ['기능'] },
  { id: 'bug', name: '버그', labels: ['bug'], prefixes: ['버그', '오류'] },
  { id: 'design', name: '디자인', labels: ['design'], prefixes: ['디자인'] },
  { id: 'asset', name: '3D', labels: ['asset'], prefixes: ['3d 에셋', '3d'] },
  { id: 'plan', name: '기획', labels: [], prefixes: ['기획'] },
  { id: 'docs', name: '문서', labels: ['docs', 'documentation'], prefixes: ['문서'] },
  { id: 'perf', name: '성능', labels: [], prefixes: ['성능'] },
  { id: 'ui', name: 'UI', labels: [], prefixes: ['ui'] },
  { id: 'a11y', name: '접근성', labels: ['accessibility'], prefixes: ['접근성'] },
  { id: 'sound', name: '소리', labels: [], prefixes: ['소리', '사운드'] },
]

export const MAX_TOPICS = 2

const byId = new Map(TOPICS.map((t) => [t.id, t]))
export const topicName = (id: TopicId) => byId.get(id)!.name

const byLabel = new Map(TOPICS.flatMap((t) => t.labels.map((l) => [l, t.id] as const)))
const byPrefix = new Map(TOPICS.flatMap((t) => t.prefixes.map((p) => [p, t.id] as const)))

/** the parts of the title's leading `[a·b·c]`, lower case; none when the title has no such prefix */
export function prefixParts(title: string | null): string[] {
  const m = /^\s*\[([^\]]*)\]/.exec(title ?? '')
  return m ? m[1].split(/[·,/]/).map((p) => p.trim().toLowerCase()).filter(Boolean) : []
}

/**
 * Up to two topics: the labels first, in the order GitHub lists them; the slots left are filled from the title's
 * prefix, front to back. A repeated topic counts once; anything not in the table (`question`, `[잡담]`) is ignored.
 * `title` is null while it is hidden from this viewer (SECRET), then only the labels speak (and a hidden document
 * carries none, see library.ts).
 */
export function topicsOf(labels: readonly unknown[], title: string | null): TopicId[] {
  const out: TopicId[] = []
  const add = (id: TopicId | undefined) => {
    if (id && !out.includes(id) && out.length < MAX_TOPICS) out.push(id)
  }
  for (const l of labels) if (typeof l === 'string') add(byLabel.get(l.trim().toLowerCase()))
  for (const p of prefixParts(title)) add(byPrefix.get(p))
  return out
}
