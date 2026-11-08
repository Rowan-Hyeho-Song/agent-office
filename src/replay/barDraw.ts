// The timeline bar's canvas (#82, docs/design/timelapse.md 2): lanes, point shapes, day ticks, project band, deploy
// lines, minimap, playhead. One canvas for hundreds of points; the slider element above it takes the input.
// Ported from the design mock's Timeline(): same shapes, sizes and token names.

import type { Point } from '../timeline/types'
import { LANES, atMs, dayKey, dayLabel, laneOf, layoutX, sizeClass, type Lane } from './engine'

export interface Tokens {
  color: Record<Lane, string>
  text: string
  muted: string
  faint: string
  line: string
  cyan: string
  void: string
  manila: string
  playhead: string
  futureAlpha: number
  office: string
  hub: string
  laneH: number
  laneHCompact: number
  step: number
}

let cached: Tokens | null = null
export function tokens(): Tokens {
  if (cached) return cached
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string, d = '') => cs.getPropertyValue(n).trim() || d
  const num = (n: string, d: number) => parseFloat(v(n)) || d
  cached = {
    color: { 0: v('--agent-0', '#ffb347'), 1: v('--agent-1', '#8f9bff'), 2: v('--agent-2', '#ff3ea5'), 3: v('--agent-3', '#4df3ff'), o: v('--color-text', '#f3ead8'), n: v('--color-text-muted', '#a39d90') },
    text: v('--color-text', '#f3ead8'),
    muted: v('--color-text-muted', '#a39d90'),
    faint: v('--color-text-faint', '#6f6a60'),
    line: v('--color-line', '#2a2f38'),
    cyan: v('--color-cyan', '#4df3ff'),
    void: v('--color-void', '#07090c'),
    manila: v('--manila', '#d9b877'),
    playhead: v('--replay-playhead', '#f3ead8'),
    futureAlpha: num('--replay-future-alpha', 0.35),
    office: v('--replay-project-office', '#3a4250'),
    hub: v('--replay-project-hub', 'rgb(255 179 71 / 0.45)'),
    laneH: num('--replay-lane-h', 14),
    laneHCompact: num('--replay-lane-h-compact', 6),
    step: num('--replay-pt-step', 8),
  }
  return cached
}

/** a point's shape on a 12 px cell; `scale` shrinks it (phone) */
export function glyph(ctx: CanvasRenderingContext2D, p: Pick<Point, 'kind' | 'secret' | 'additions' | 'deletions' | 'result'>, x: number, y: number, col: string, future: boolean, t: Tokens, scale = 1) {
  ctx.save()
  ctx.globalAlpha = future ? t.futureAlpha : 1
  ctx.translate(Math.round(x), Math.round(y))
  ctx.scale(scale, scale)
  ctx.fillStyle = p.secret ? t.manila : col
  ctx.strokeStyle = col
  ctx.lineWidth = 1.5
  const R = [3, 4.5, 6][sizeClass(p as Point)]
  ctx.beginPath()
  switch (p.kind) {
    case 'work':
      ctx.arc(0, 0, R, 0, Math.PI * 2)
      break
    case 'plan':
      ctx.rect(-4, -4, 8, 8)
      break
    case 'minutes':
      ctx.moveTo(-5, -4); ctx.lineTo(5, -4); ctx.lineTo(5, 2); ctx.lineTo(0, 2); ctx.lineTo(-3, 5); ctx.lineTo(-3, 2); ctx.lineTo(-5, 2); ctx.closePath()
      break
    case 'decision':
      ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0); ctx.closePath()
      break
    case 'deploy':
      ctx.moveTo(0, -5); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath()
      break
    case 'approval':
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.beginPath()
      if (p.result) {
        ctx.arc(0, 0, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      return
  }
  ctx.fill()
  if (p.secret) ctx.stroke()
  ctx.restore()
}

export interface BarView {
  points: readonly Point[]
  /** index of the playhead */
  i: number
  /** 0..1 progress within the current step while playing */
  prog: number
  playing: boolean
  hover: number
  compact: boolean
  width: number
  height: number
}

export interface BarLayout {
  xs: number[]
  step: number
  total: number
  scroll: number
  lanesY: number
  laneH: number
}

export function drawBar(ctx: CanvasRenderingContext2D, v: BarView): BarLayout {
  const t = tokens()
  const { points, width: w, height: h, compact } = v
  ctx.clearRect(0, 0, w, h)
  const LH = compact ? t.laneHCompact : t.laneH
  const L = layoutX(points, w, compact ? 5 : t.step)
  const scrolls = L.total > w
  const cur = v.i >= 0 && v.i < points.length ? L.xs[v.i] + (v.playing ? v.prog * L.step : 0) : 0
  const scroll = scrolls ? Math.max(0, Math.min(L.total - w, cur - w * 0.5)) : 0
  const mmH = compact ? 6 : 8
  const lanesY = compact ? 11 : 12
  const lanesH = LANES.length * LH
  const bandY = lanesY + lanesH + 3
  const axisY = bandY + 8

  // minimap: the whole history, a point = a bar, the visible stretch framed
  points.forEach((p, k) => {
    ctx.fillStyle = t.color[laneOf(p)]
    ctx.globalAlpha = k <= v.i ? 0.9 : 0.3
    ctx.fillRect(Math.round((k / points.length) * w), 1, Math.max(1, w / points.length - 0.5), mmH - 2)
  })
  ctx.globalAlpha = 1
  if (scrolls) {
    ctx.strokeStyle = t.text
    ctx.lineWidth = 1
    ctx.strokeRect((scroll / L.total) * w + 0.5, 0.5, (w / L.total) * w - 1, mmH - 1)
  }

  ctx.save()
  ctx.translate(-scroll, 0)
  ctx.strokeStyle = t.line
  ctx.lineWidth = 1
  for (let l = 0; l <= LANES.length; l++) {
    ctx.beginPath()
    ctx.moveTo(scroll, lanesY + l * LH + 0.5)
    ctx.lineTo(scroll + w, lanesY + l * LH + 0.5)
    ctx.stroke()
  }
  // day ticks (dotted); the label is left out when ticks are closer than 60 px
  ctx.font = '11px Galmuri11, monospace'
  ctx.textBaseline = 'top'
  let prev: string | null = null
  // the first day's label is drawn at the left edge below, so the next one needs room after it
  let lastLabel = 8
  points.forEach((p, k) => {
    const key = dayKey(p)
    if (key === prev) return
    prev = key
    if (k === 0) return
    const x = L.xs[k] - 5
    ctx.strokeStyle = t.faint
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(x + 0.5, lanesY)
    ctx.lineTo(x + 0.5, axisY + 2)
    ctx.stroke()
    ctx.setLineDash([])
    if (x - lastLabel > 60) {
      ctx.fillStyle = t.muted
      ctx.fillText(dayLabel(atMs(p)), x + 3, axisY)
      lastLabel = x
    }
  })
  // the first day's label at the left, and the visible day pinned at the left edge when scrolled
  if (points.length) {
    const lbl = dayLabel(atMs(points[scroll > 0 ? Math.max(0, L.xs.findIndex((x) => x >= scroll + 4)) : 0]))
    ctx.fillStyle = t.void
    ctx.fillRect(scroll, axisY - 1, ctx.measureText(lbl).width + 8, 14)
    ctx.fillStyle = t.muted
    ctx.fillText(lbl, scroll + 4, axisY)
  }
  // project band: office plain, the desk room striped (readable without colour)
  points.forEach((p, k) => {
    const hub = p.project.endsWith('/rowansong.dev')
    const x0 = L.xs[k] - L.step / 2
    const x1 = (L.xs[k + 1] ?? L.xs[k] + L.step) - L.step / 2
    ctx.fillStyle = hub ? t.hub : t.office
    ctx.fillRect(x0, bandY, x1 - x0, 4)
    if (hub) {
      ctx.fillStyle = 'rgba(0,0,0,.45)'
      for (let x = Math.ceil(x0); x < x1; x += 3) ctx.fillRect(x, bandY, 1, 4)
    }
  })
  // deploy: a line through every lane
  points.forEach((p, k) => {
    if (p.kind !== 'deploy') return
    ctx.strokeStyle = t.text
    ctx.globalAlpha = k <= v.i ? 0.5 : 0.2
    ctx.beginPath()
    ctx.moveTo(L.xs[k] + 0.5, lanesY)
    ctx.lineTo(L.xs[k] + 0.5, lanesY + lanesH)
    ctx.stroke()
    ctx.globalAlpha = 1
  })
  // points: played ones full, the rest at 35%
  points.forEach((p, k) => {
    const x = L.xs[k]
    if (x < scroll - 12 || x > scroll + w + 12) return
    const lane = laneOf(p)
    glyph(ctx, p, x, lanesY + LANES.indexOf(lane) * LH + LH / 2, t.color[lane], k > v.i, t, compact ? 0.55 : 1)
  })
  if (v.hover >= 0 && v.hover < points.length) {
    ctx.strokeStyle = t.cyan
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(L.xs[v.hover], lanesY + LANES.indexOf(laneOf(points[v.hover])) * LH + LH / 2, 8, 0, Math.PI * 2)
    ctx.stroke()
  }
  // playhead: ivory line and a five-sided handle (cyan is for focus only)
  if (points.length) {
    ctx.fillStyle = t.playhead
    ctx.fillRect(Math.round(cur) - 1, lanesY - 2, 2, lanesH + 8)
    ctx.beginPath()
    ctx.moveTo(cur - 5, lanesY - 7); ctx.lineTo(cur + 5, lanesY - 7); ctx.lineTo(cur + 5, lanesY - 3); ctx.lineTo(cur, lanesY + 1); ctx.lineTo(cur - 5, lanesY - 3); ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  return { xs: L.xs, step: L.step, total: L.total, scroll, lanesY, laneH: LH }
}

/** the point nearest to x (canvas pixels), and how far it is */
export function nearest(layout: BarLayout, x: number): { k: number; d: number } {
  const at = x + layout.scroll
  let best = 0
  let bd = Infinity
  layout.xs.forEach((v, k) => {
    const d = Math.abs(v - at)
    if (d < bd) {
      bd = d
      best = k
    }
  })
  return { k: best, d: bd }
}

