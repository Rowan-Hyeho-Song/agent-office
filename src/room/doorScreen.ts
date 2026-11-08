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
