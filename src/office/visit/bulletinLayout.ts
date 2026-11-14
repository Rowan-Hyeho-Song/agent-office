// #4 12.3 the cork board's layout, pure (no three.js, no stores): where each note sits, its paper, and how its words are cut.
// Shared by the board's canvas (Bulletin.tsx), the close view's cards (NotesView.tsx) and the tests.

export const NOTE_GRID = { cols: 3, rows: 4, pad: 36, gap: 22 }

/** where the k-th note (0 = newest) sits on a board of w × h px: left to right, top to bottom */
export function noteSlot(k: number, w: number, h: number) {
  const { cols, rows, pad, gap } = NOTE_GRID
  const cw = (w - pad * 2 - gap * (cols - 1)) / cols
  const ch = (h - pad * 2 - gap * (rows - 1)) / rows
  const col = k % cols
  const row = Math.floor(k / cols)
  return { x: pad + col * (cw + gap), y: pad + row * (ch + gap), w: cw, h: ch }
}

/** the paper, the same every time for a note (the designer, #460): canary 60 %, apricot 25 %, light green 15 % */
export const PAPERS = [
  { color: '#fff1a8', share: 60 },
  { color: '#ffd9b8', share: 25 },
  { color: '#e2f0c4', share: 15 },
] as const
export function paperOf(id: number): string {
  let r = ((id * 2246822519) >>> 0) % 100
  for (const p of PAPERS) {
    if (r < p.share) return p.color
    r -= p.share
  }
  return PAPERS[0].color
}

/** the text in lines of at most `width` px, at most `max` lines; when it does not fit, the last line ends in … (and still fits) */
export function wrap(g: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, width: number, max: number): string[] {
  const out: string[] = []
  let line = ''
  let cut = false
  for (const ch of [...text]) {
    if (g.measureText(line + ch).width > width) {
      out.push(line)
      line = ch.trim() ? ch : ''
      if (out.length === max) {
        cut = true
        break
      }
    } else line += ch
  }
  if (!cut && line) out.push(line)
  if (cut) {
    let last = out[max - 1]
    while (last && g.measureText(last + '…').width > width) last = [...last].slice(0, -1).join('')
    out[max - 1] = last + '…'
  }
  return out.slice(0, max)
}
