// The head's screen as a canvas texture (#193 2/2, robots.md 3): 24 x 14 LED pixels on a 300 x 180 canvas. A pixel is 11.5 px with a 1 px
// gap; the unlit ones show as grey at 7 %. Drawn only when faceMind says something changed; allocates nothing per draw.

import { CanvasTexture, SRGBColorSpace } from 'three'
import { dimOf, FACE_H, FACE_W, newGrid, newParams, P, PALETTE_HEX, renderFace, type FaceGrid, type FaceParams } from './faceModel'

export const FACE_CANVAS = { w: 300, h: 180 }
const PITCH_X = FACE_CANVAS.w / FACE_W // 12.5: 11.5 + 1
const PITCH_Y = FACE_CANVAS.h / FACE_H
const PIXEL = 11.5
const OFF_ALPHA = 0.07
const GLASS = '#05080b'

export class FaceScreen {
  private ctx: CanvasRenderingContext2D
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture
  readonly grid: FaceGrid = newGrid()
  readonly params: FaceParams = newParams()
  private color: string
  /** canvas redraws since the start, and the time of the last one, ms (debug counters) */
  draws = 0
  lastMs = 0
  totalMs = 0

  constructor(color: string, agent: number) {
    const c = document.createElement('canvas')
    c.width = FACE_CANVAS.w
    c.height = FACE_CANVAS.h
    this.canvas = c
    this.ctx = c.getContext('2d')!
    this.color = color
    this.params.agent = agent
    this.texture = new CanvasTexture(c)
    this.texture.flipY = false // glTF UVs (v = 0 at the top of the image)
    this.texture.colorSpace = SRGBColorSpace
    this.paint()
  }

  /** draw the parameters (already filled in `params`) */
  draw() {
    const t0 = performance.now()
    renderFace(this.grid, this.params)
    this.paint()
    this.texture.needsUpdate = true
    this.lastMs = performance.now() - t0
    this.totalMs += this.lastMs
    this.draws++
  }

  private css(code: number) {
    return code === P.MAIN ? this.color : code === P.IVORY ? PALETTE_HEX.ivory : code === P.SWEAT ? PALETTE_HEX.sweat : code === P.PINK ? PALETTE_HEX.pink : PALETTE_HEX.red
  }

  private paint() {
    const g = this.ctx
    const { cells, lum } = this.grid
    const dim = dimOf(this.params.expr)
    g.globalAlpha = 1
    g.fillStyle = GLASS
    g.fillRect(0, 0, FACE_CANVAS.w, FACE_CANVAS.h)
    // the unlit pixels first, as one path
    g.globalAlpha = OFF_ALPHA
    g.fillStyle = '#ffffff'
    g.beginPath()
    for (let i = 0; i < cells.length; i++) if (cells[i] === P.OFF) this.cell(g, i)
    g.fill()
    // the lit ones, one path per colour and brightness step
    for (let code = 1; code <= 5; code++) {
      for (const step of LUM_STEPS) {
        let any = false
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] !== code || LUM_STEPS[stepOf(lum[i])] !== step) continue
          if (!any) {
            g.beginPath()
            any = true
          }
          this.cell(g, i)
        }
        if (!any) continue
        g.globalAlpha = dim * step
        g.fillStyle = this.css(code)
        g.fill()
      }
    }
    g.globalAlpha = 1
  }

  private cell(g: CanvasRenderingContext2D, i: number) {
    const x = (i % FACE_W) * PITCH_X + (PITCH_X - PIXEL) / 2
    const y = Math.floor(i / FACE_W) * PITCH_Y + (PITCH_Y - PIXEL) / 2
    g.rect(x, y, PIXEL, PIXEL)
  }
}

/** Echo's blend draws at a few brightness steps; everything else is full */
const LUM_STEPS = [1, 0.75, 0.5, 0.25] as const
const stepOf = (lum: number) => (lum >= 224 ? 0 : lum >= 160 ? 1 : lum >= 80 ? 2 : 3)
