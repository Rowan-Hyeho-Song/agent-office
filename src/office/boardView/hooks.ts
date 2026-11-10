import { useEffect, useState, useSyncExternalStore } from 'react'
import { FS_L, FS_S, type Measure } from '../../board/layout'
import { font } from '../../board/draw'
import type { BoardState } from '../../board/state'
import type { OfficeWorld } from '../world'

let measureCtx: CanvasRenderingContext2D | null = null
export const measure: Measure = (text, size, bold) => {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = font(size, bold)
  return measureCtx.measureText(text).width
}

/** bumps once when the pixel font is in, so the layout is measured again */
export function useFontsReady(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    void Promise.all([document.fonts?.load(font(FS_L, true)), document.fonts?.load(font(FS_S))]).then(() => alive && setN((v) => v + 1))
    return () => void (alive = false)
  }, [])
  return n
}

export const useBoardState = (world: OfficeWorld): BoardState => useSyncExternalStore(world.board.subscribe, world.board.getSnapshot)
export const useNarrow = () => {
  const [n, setN] = useState(() => matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const m = matchMedia('(max-width: 640px)')
    const f = () => setN(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return n
}

