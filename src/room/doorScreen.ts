// The door screen (screen_door, 820 x 1823 canvas), docs/design/office-ui.md section 5: a mirror of the desk's
// OFFICE.LNK. Colors come from the tokens (read through getComputedStyle, see tokens.css).

import { DOOR_FX } from './doorFx'

export const DOOR_W = 820
export const DOOR_H = 1823

export interface DoorView {
  hover: boolean
  /** ms since the press, or null when not pressed */
  pressed: number | null
  reduced: boolean
  /** ms clock for the hover animation */
  t: number
  /** the owner's line of a meeting replay (#97): a ROWAN message under the hover hint */
  message?: { text: string; masked: boolean } | null
}

const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
const num = (name: string, fallback: number) => parseFloat(token(name, '')) || fallback

// 12 x 9 pixel arrow, pointing left
const ARROW = ['000011000000', '000111000000', '001111000000', '011111111111', '111111111111', '011111111111', '001111000000', '000111000000', '000011000000']
const FONT = 'Galmuri11, ui-monospace, monospace'

/** how the animated parts step: the arrow nudges every 400 ms, the cursor blinks every 500 ms */
export const hoverTick = (t: number) => `${Math.floor(t / 400) % 2}${Math.floor(t / 500) % 2}`

export function drawDoor(ctx: CanvasRenderingContext2D, v: DoorView) {
  const bg = token('--door-bg', '#0a0704')
  const amber = token('--door-phosphor', '#ffb347')
  const dim = token('--door-phosphor-dim', '#b98236')
  const cyan = token('--door-hover', '#4df3ff')
  const fsS = num('--door-fs-s', 48)
  const fsL = num('--door-fs-l', 120)
  const cell = num('--door-icon', 288) / 12
  const lit = v.hover || v.pressed !== null
  const col = lit ? cyan : amber
  const W = DOOR_W
  const H = DOOR_H

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // double frame + inverted title bar
  ctx.strokeStyle = col
  ctx.lineWidth = 6
  ctx.strokeRect(24, 24, W - 48, H - 48)
  ctx.strokeRect(46, 46, W - 92, H - 92)
  ctx.fillStyle = col
  ctx.fillRect(46, 46, W - 92, 96)
  ctx.fillStyle = bg
  ctx.font = `bold ${fsS}px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('DESK.LNK', 78, 95)
  ctx.textAlign = 'right'
  ctx.fillText('■ □', W - 78, 95)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  if (v.reduced && v.pressed !== null) {
    // reduced motion: dim, then a plain message
    ctx.fillStyle = dim
    ctx.font = `bold ${fsS}px ${FONT}`
    ctx.fillText('이동 중…', W / 2, H / 2)
    if (v.pressed < DOOR_FX.reducedDimMs) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, W, H)
    }
    return
  }
  const nudge = v.hover && Math.floor(v.t / 400) % 2 ? -24 : 0
  ctx.fillStyle = col
  ARROW.forEach((row, j) => [...row].forEach((c, i) => c === '1' && ctx.fillRect(W / 2 - 6 * cell + i * cell + nudge, 520 + j * cell, cell, cell)))
  ctx.fillStyle = amber
  ctx.font = `bold ${fsL}px ${FONT}`
  ctx.fillText('책상으로', W / 2, 900)
  ctx.fillStyle = dim
  ctx.font = `${fsS}px ${FONT}`
  ctx.fillText('ROWAN/OS · 허브', W / 2, 1000)
  if (lit) {
    ctx.fillStyle = cyan
    ctx.fillText(`클릭해서 돌아가기${Math.floor(v.t / 500) % 2 ? '_' : ' '}`, W / 2, 1160)
  }
  if (v.message) drawMessage(ctx, v.message, { amber, dim, bg, fsS })
  ctx.fillStyle = dim
  ctx.fillText('rowansong.dev', W / 2, H - 130)
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2)
  if (v.pressed !== null && v.pressed < DOOR_FX.pressFlashMs) {
    ctx.fillStyle = `rgba(255,179,71,${DOOR_FX.pressFlashAlpha})`
    ctx.fillRect(0, 0, W, H)
  }
}

/** how many characters of a line fit the message box (full-width glyphs at the small size) */
const MESSAGE_COLS = 12
const MESSAGE_ROWS = 4

/** wrap on characters (Korean has no spaces to break on): the same cut for the words and for the bars */
export function wrapMessage(text: string, cols = MESSAGE_COLS, rows = MESSAGE_ROWS): string[] {
  const out: string[] = []
  for (const word of text.split(' ')) {
    const chars = [...word]
    const last = out[out.length - 1]
    if (last !== undefined && [...last].length + 1 + chars.length <= cols) out[out.length - 1] = last + ' ' + word
    else for (let i = 0; i < chars.length || (i === 0 && chars.length === 0); i += cols) out.push(chars.slice(i, i + cols).join(''))
  }
  return out.slice(0, rows)
}

function drawMessage(ctx: CanvasRenderingContext2D, m: { text: string; masked: boolean }, c: { amber: string; dim: string; bg: string; fsS: number }) {
  const x0 = 90
  const y0 = 1250
  const w = 640
  const step = c.fsS + 16
  // header: inverted ROWAN tag, then the lines under it in a framed box
  ctx.fillStyle = c.amber
  ctx.fillRect(x0, y0, 220, 56)
  ctx.fillStyle = c.bg
  ctx.font = `bold ${c.fsS}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('ROWAN', x0 + 16, y0 + 29)
  const lines = wrapMessage(m.text)
  ctx.strokeStyle = c.dim
  ctx.lineWidth = 4
  ctx.strokeRect(x0, y0 + 56, w, MESSAGE_ROWS * step + 24)
  ctx.fillStyle = c.amber
  lines.forEach((line, i) => {
    const y = y0 + 56 + 12 + i * step + step / 2
    if (m.masked) {
      // black bars: the words never reach the canvas
      let x = x0 + 20
      for (const ch of line) {
        if (ch !== ' ') ctx.fillRect(x, y - c.fsS / 2 + 4, c.fsS - 8, c.fsS - 8)
        x += c.fsS
      }
    } else ctx.fillText(line, x0 + 20, y)
  })
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
}
