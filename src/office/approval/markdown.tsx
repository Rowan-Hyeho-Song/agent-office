// The limited markdown the approval box shows (docs/design/docs-ui.md 1.2): paragraphs, lists, bold, inline code,
// links, tables. Built as React elements, never as an HTML string, so nothing in a request's text can inject markup.
// Links are kept only for http(s); everything else shows as plain text.

import { Fragment, type ReactNode } from 'react'

export type Inline = { t: 'text'; v: string } | { t: 'code'; v: string } | { t: 'bold'; v: Inline[] } | { t: 'link'; href: string; v: Inline[] }
export type Block =
  | { t: 'p'; v: Inline[][] } // lines of one paragraph
  | { t: 'ul'; v: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/** only http(s) links; anything else (javascript:, data:, relative) is not a link */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'bold', v: parseInline(m[2]) })
    else {
      const href = safeHref(m[4])
      if (href) out.push({ t: 'link', href, v: parseInline(m[3]) })
      else out.push({ t: 'text', v: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) })
  return out
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function parseMarkdown(src: string): Block[] {
  return src
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map((block): Block => {
      const lines = block.split('\n')
      if (lines.length > 1 && /^\s*\|.*\|\s*$/.test(lines[0]) && /^\s*\|[-:| ]+\|\s*$/.test(lines[1])) {
        return {
          t: 'table',
          head: cells(lines[0]).map(parseInline),
          rows: lines.slice(2).filter((l) => l.trim()).map((l) => cells(l).map(parseInline)),
        }
      }
      if (lines.every((l) => /^\s*[-*] /.test(l))) return { t: 'ul', v: lines.map((l) => parseInline(l.replace(/^\s*[-*] /, ''))) }
      return { t: 'p', v: lines.map(parseInline) }
    })
}

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.v
    if (n.t === 'code') return <code key={i}>{n.v}</code>
    if (n.t === 'bold') return <strong key={i}>{inline(n.v)}</strong>
    return (
      <a key={i} href={n.href} target="_blank" rel="noreferrer">
        {inline(n.v)}
      </a>
    )
  })
}

/** pure: the same text always gives the same elements */
export function renderMarkdown(src: string): ReactNode {
  return parseMarkdown(src).map((b, i) => {
    if (b.t === 'ul') {
      return (
        <ul key={i}>
          {b.v.map((li, j) => (
            <li key={j}>{inline(li)}</li>
          ))}
        </ul>
      )
    }
    if (b.t === 'table') {
      return (
        <div key={i} className="md-table" tabIndex={0} role="region" aria-label="표">
          <table>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return (
      <p key={i}>
        {b.v.map((line, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
      </p>
    )
  })
}
