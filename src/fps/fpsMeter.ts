/**
 * #693 `?fps`: a small frame readout for measuring on a real phone (#370). main.tsx imports this module only when the address
 * has `fps`, so without it none of this is loaded or run. Plain DOM, no React: it measures the page's frames (requestAnimationFrame,
 * the same clock the 3D renders on) and writes the readout twice a second, so the readout itself barely moves what it measures.
 */

/** how far back the average and the longest frame look, ms */
export const WINDOW_MS = 10_000
/** how often the readout is rewritten, ms */
export const PAINT_MS = 500

export interface FpsStats {
  /** frames in the last second */
  fps1: number
  /** average frames per second over the window (or since the start, when that is shorter) */
  avg: number
  /** the longest frame in the window, ms */
  worst: number
}

/** stats from the frame timestamps of the window (oldest first, ms) at `now` */
export function fpsStats(times: readonly number[], now: number): FpsStats {
  let fps1 = 0
  let worst = 0
  for (let i = 0; i < times.length; i++) {
    if (times[i] > now - 1000) fps1++
    if (i > 0) worst = Math.max(worst, times[i] - times[i - 1])
  }
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0
  return { fps1, avg: span > 0 ? ((times.length - 1) * 1000) / span : 0, worst }
}

/** the drawing buffer the 3D renders to: the biggest canvas on the page (the room's) */
function roomCanvas(): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null
  for (const c of document.querySelectorAll('canvas')) if (!best || c.width * c.height > best.width * best.height) best = c
  return best
}

const CSS = `
.fps-meter {
  position: fixed; z-index: 29; top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(8px + env(safe-area-inset-right, 0px));
  margin: 0; padding: 4px 6px; pointer-events: none; user-select: none; white-space: pre;
  background: var(--color-surface-alpha); box-shadow: 0 0 0 1px var(--color-halo);
  color: var(--color-text-muted); font: 12px/16px var(--font-pixel); font-variant-numeric: tabular-nums;
}
.fps-meter b { color: var(--color-text); font-weight: 400; }
`

const f1 = (n: number) => n.toFixed(1)

/** start the readout; returns a stop function (tests, hot reload) */
export function startFpsMeter(): () => void {
  const style = document.createElement('style')
  style.textContent = CSS
  const el = document.createElement('p')
  el.className = 'fps-meter'
  el.setAttribute('aria-hidden', 'true')
  document.head.append(style)
  document.body.append(el)

  let times: number[] = []
  let head = 0
  let painted = 0
  let raf = 0
  const frame = (now: number) => {
    times.push(now)
    while (times[head] <= now - WINDOW_MS) head++
    if (head > 512) {
      times = times.slice(head)
      head = 0
    }
    if (now - painted >= PAINT_MS) {
      painted = now
      const s = fpsStats(head ? times.slice(head) : times, now)
      const c = roomCanvas()
      const dpr = window.devicePixelRatio
      const ratio = c && c.clientWidth ? c.width / c.clientWidth : 0
      el.innerHTML =
        `<b>${s.fps1}</b> fps · 10s <b>${f1(s.avg)}</b>\n` +
        `max <b>${f1(s.worst)}</b> ms\n` +
        `dpr ${+dpr.toFixed(2)} · ${c ? `${+ratio.toFixed(2)}x ${c.width}×${c.height}` : '-'}`
    }
    raf = requestAnimationFrame(frame)
  }
  // a hidden tab stops the frames: start over when it comes back, so the gap is not counted as one long frame
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    times = []
    head = 0
  }
  document.addEventListener('visibilitychange', onVisible)
  raf = requestAnimationFrame(frame)
  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVisible)
    el.remove()
    style.remove()
  }
}
