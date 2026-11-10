// Paints a BoardLayout on the 1536 x 1024 canvas (#66): transparent background (the baked board shows through),
// marker headings, cards with an agent colour strip, yellow decision notes. Same drawing as the mock's drawBoard.

import { BH, BW, FS_L, FS_S, type BoardLayout } from './layout'

const FONT = 'Galmuri11, ui-monospace, monospace'
const AGENT_NAMES = ['메모', '메시', '휴', '루프', '에코']
/** the agent's name on a card (임시 = a session the office does not know) */
export const agentName = (seat: number | null): string => (seat === null ? '임시' : (AGENT_NAMES[seat] ?? '임시'))
/** tokens.css --board-* and --agent-N, read from the page when there is one (fallbacks match the tokens) */
const FALLBACK = { marker: '#1f2a44', card: '#fbf8f1', ink: '#1f1b14', note: '#ffe27a', agents: ['#ffb347', '#8f9bff', '#ff3ea5', '#4df3ff', '#f2ffc4'], unknown: '#a39d90' }

export function boardColors() {
  if (typeof document === 'undefined') return FALLBACK
  const css = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d
  return {
    marker: css('--board-marker', FALLBACK.marker),
    card: css('--board-card', FALLBACK.card),
    ink: css('--board-card-ink', FALLBACK.ink),
    note: css('--board-note', FALLBACK.note),
    agents: FALLBACK.agents.map((d, i) => css(`--agent-${i}`, d)),
    unknown: css('--agent-x', FALLBACK.unknown),
  }
}

export const font = (size: number, bold = false) => `${bold ? 700 : 400} ${size}px ${FONT}`

export interface DrawOptions {
  colors?: ReturnType<typeof boardColors>
  /** 0..1 per card / note key (a new card fades in); default 1 */
  alpha?: (key: string) => number
}

export function drawBoard(ctx: CanvasRenderingContext2D, layout: BoardLayout, opts: DrawOptions = {}) {
  const c = opts.colors ?? boardColors()
  const alpha = opts.alpha ?? (() => 1)
  const { pad } = layout
  ctx.clearRect(0, 0, BW, BH)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  layout.columns.forEach((col, ci) => {
    ctx.fillStyle = c.marker
    ctx.font = font(FS_L, true)
    ctx.fillText(col.title, col.x, pad)
    ctx.font = font(FS_S)
    ctx.fillText(String(col.count), col.x + col.w - 40, pad + 14)
    ctx.fillRect(col.x, pad + FS_L + 10, col.w, 4) // marker underline
    if (ci) ctx.fillRect(col.x - 14, pad, 3, BH - 2 * pad) // marker line between columns
    for (const k of col.cards) {
      ctx.save()
      ctx.globalAlpha = alpha(k.card.key)
      rotate(ctx, k, k.tilt)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(k.x + 4, k.y + 6, k.w, k.h)
      ctx.fillStyle = c.card
      ctx.fillRect(k.x, k.y, k.w, k.h)
      ctx.fillStyle = k.card.seat === null ? c.unknown : c.agents[k.card.seat]
      ctx.fillRect(k.x, k.y, k.w, 14)
      ctx.fillStyle = c.ink
      ctx.font = font(FS_S)
      ctx.fillText(`#${k.card.n} · ${k.card.seat === null ? '임시' : AGENT_NAMES[k.card.seat]}`, k.x + 18, k.y + 28)
      if (k.card.title === null) {
        // SECRET: the title is black bars (docs-ui 2.3)
        ctx.fillRect(k.x + 18, k.y + 72, k.w - 36 - 70, FS_L - 8)
        ctx.fillRect(k.x + 18, k.y + 72 + FS_L + 6, k.w - 36 - 150, FS_L - 8)
      } else {
        ctx.font = font(FS_L, true)
        k.lines.forEach((l, i) => ctx.fillText(l, k.x + 18, k.y + 64 + i * (FS_L + 6)))
      }
      ctx.restore()
    }
    if (col.more) {
      ctx.fillStyle = c.marker
      ctx.font = font(FS_L)
      ctx.fillText(`+${col.more}`, col.moreAt.x, col.moreAt.y)
    }
  })
  const { x: nx, w: nw } = layout.notesHeading
  ctx.fillStyle = c.marker
  ctx.font = font(FS_L, true)
  ctx.fillText('최근 결정', nx, pad)
  ctx.fillRect(nx, pad + FS_L + 10, nw, 4)
  for (const n of layout.notes) {
    ctx.save()
    ctx.globalAlpha = alpha(n.decision.key)
    rotate(ctx, n, n.tilt)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.fillRect(n.x + 5, n.y + 7, n.w, n.h)
    ctx.fillStyle = c.note
    ctx.fillRect(n.x, n.y, n.w, n.h)
    ctx.fillStyle = c.ink
    ctx.font = font(FS_L, true)
    n.titleLines.forEach((l, i) => ctx.fillText(l, n.x + 22, n.y + 26 + i * (FS_L + 6)))
    ctx.font = font(FS_S)
    n.noteLines.forEach((l, i) => ctx.fillText(l, n.x + 22, n.y + 26 + 2 * (FS_L + 6) + 8 + i * (FS_S + 6)))
    if (n.decision.n !== null) ctx.fillText(`#${n.decision.n}`, n.x + 22, n.y + n.h - FS_S - 18)
    ctx.restore()
  }
}

function rotate(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, deg: number) {
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2))
}
