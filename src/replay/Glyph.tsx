import { useEffect, useRef } from 'react'
import type { Point } from '../timeline/types'
import { glyph, tokens } from './barDraw'
import { laneOf } from './engine'

/** a small shape for the 2D list: the same glyph as the bar */
export function Glyph({ p }: { p: Point }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    g.setTransform(2, 0, 0, 2, 0, 0)
    g.clearRect(0, 0, 12, 12)
    const t = tokens()
    glyph(g, p, 6, 6, t.color[laneOf(p)], false, t)
  }, [p])
  return <canvas ref={ref} width={24} height={24} aria-hidden="true" />
}

