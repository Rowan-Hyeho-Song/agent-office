import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, renderMarkdown, safeHref } from './markdown'

const html = (s: string) => renderToStaticMarkup(<>{renderMarkdown(s)}</>)

describe('safeHref', () => {
  it('keeps http and https only', () => {
    expect(safeHref('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x', ' JavaScript:alert(1)', '']) expect(safeHref(bad)).toBeNull()
  })
})

describe('parseInline', () => {
  it('reads code, bold and links', () => {
    expect(parseInline('a `b` **c** [d](https://x.dev)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'b' },
      { t: 'text', v: ' ' },
      { t: 'bold', v: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.dev/', v: [{ t: 'text', v: 'd' }] },
    ])
  })
  it('leaves an unsafe link as plain text', () => {
    const out = parseInline('[x](javascript:alert(1))')
    expect(out.every((n) => n.t === 'text')).toBe(true)
  })
})

describe('parseMarkdown', () => {
  it('splits paragraphs, lists and tables', () => {
    const b = parseMarkdown('one\ntwo\n\n- a\n- b\n\n| h1 | h2 |\n|---|---|\n| x | y |')
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'table'])
    const t = b[2]
    expect(t.t === 'table' && t.rows).toHaveLength(1)
  })
  it('is empty for empty text', () => {
    expect(parseMarkdown('  \n ')).toEqual([])
  })
})

describe('renderMarkdown', () => {
  it('escapes markup instead of passing it through', () => {
    const out = html('<img src=x onerror=alert(1)> and <script>x</script>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;img')
  })
  it('opens links in a new tab without a referrer, and drops unsafe ones', () => {
    expect(html('[go](https://github.com/x)')).toContain('<a href="https://github.com/x" target="_blank" rel="noreferrer">go</a>')
    expect(html('[bad](javascript:alert(1))')).not.toContain('<a ')
  })
  it('wraps a table in a focusable scroll region', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('class="md-table" tabindex="0" role="region"')
    expect(out).toContain('<th>a</th>')
    expect(out).toContain('<td>2</td>')
  })
  it('is pure: same text, same output', () => {
    expect(html('**a** `b`')).toBe(html('**a** `b`'))
  })
})
