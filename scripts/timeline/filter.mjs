// Plain-JS copy of src/docs/filter.ts `redact` (the server's title filter, plan.md 6.3): the backfill and the
// Action run with plain node, which can't import TypeScript. build.test.ts runs both on the same cases, so
// they can't drift apart. Change them together.

const MASK = '[가림]'
const BODY = String.raw`[^\s"'\x60<>|*?]`
const END = String.raw`[^\s"'\x60<>|*?.,;:)\]]`
const TAIL = `(?:${BODY}*${END})?`
const PATH_RES = [
  /(["'])[A-Za-z]:[\\/][^"'\n]*\1/g,
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${TAIL}`, 'g'),
  new RegExp(String.raw`(?<![\\\w])\\\\[\w.$-]+\\${TAIL}`, 'g'),
  new RegExp(String.raw`(?<![\w.~/\\-])(?:/Users/|/home/)${BODY}*${END}`, 'g'),
]
const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g
const EMAIL_OK = (e) => /^noreply@anthropic\.com$/i.test(e) || /@users\.noreply\.github\.com$/i.test(e)
const TOKEN_RES = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}/g,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9])sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

/** @param {string} text @param {string[]} [banned] @returns {{ text: string, hits: string[] }} */
export function redact(text, banned = []) {
  const hits = new Set()
  let out = text
  const sub = (re, hit, keep) => {
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
  return { text: out, hits: ['path', 'email', 'token', 'banned'].filter((h) => hits.has(h)) }
}
