// The server's second filter (plan.md 6.3): hide file paths, emails, token-shaped strings and banned words.
export type RedactHit = 'path' | 'email' | 'token' | 'banned'

const MASK = '[가림]'

// characters that may end a path in prose (. , ; : ) ]) are left out of the match
const BODY = String.raw`[^\s"'\x60<>|*?]`
const END = String.raw`[^\s"'\x60<>|*?.,;:)\]]`
const TAIL = `(?:${BODY}*${END})?`
const PATH_RES = [
  /(["'])[A-Za-z]:[\\/][^"'\n]*\1/g, // quoted drive path (may contain spaces)
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${TAIL}`, 'g'),
  new RegExp(String.raw`(?<![\\\w])\\\\[\w.$-]+\\${TAIL}`, 'g'), // UNC
  // home folders by absolute path (they carry the user name); `~/…` reads the same for everyone and stays
  new RegExp(String.raw`(?<![\w.~/\\-])(?:/Users/|/home/)${BODY}*${END}`, 'g'),
]

const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g
const EMAIL_OK = (e: string) => /^noreply@anthropic\.com$/i.test(e) || /@users\.noreply\.github\.com$/i.test(e)

const TOKEN_RES = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}/g,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9])sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

export function redact(text: string, banned: string[] = []): { text: string; hits: RedactHit[] } {
  const hits = new Set<RedactHit>()
  let out = text
  const sub = (re: RegExp, hit: RedactHit, keep?: (m: string) => boolean) => {
    out = out.replace(re, (m) => {
      if (keep?.(m)) return m
      hits.add(hit)
      return MASK
    })
  }
  for (const re of PATH_RES) sub(re, 'path')
  sub(EMAIL_RE, 'email', EMAIL_OK)
  for (const re of TOKEN_RES) sub(re, 'token')
  for (const word of banned) {
    const w = word.trim()
    if (w) sub(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'banned')
  }
  const order: RedactHit[] = ['path', 'email', 'token', 'banned']
  return { text: out, hits: order.filter((h) => hits.has(h)) }
}

export function gradeFor(repo: string, publicRepos: string[], hits: unknown[]): 'public' | 'review' {
  const isPublic = publicRepos.some((r) => r.toLowerCase() === repo.toLowerCase())
  return isPublic && hits.length === 0 ? 'public' : 'review'
}
