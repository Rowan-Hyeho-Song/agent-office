// What the window shows by KST time of day (#111, designer values): sky gradient top -> horizon and the strength of
// the city's lit windows. Only these change; the baked interior stays. Pure.

export type Rgb = readonly [number, number, number]

interface Period {
  /** start, minutes since KST midnight */
  from: number
  top: string
  bottom: string
  lights: number
}

/** day 07-17, evening 17-20, night 20-05, dawn 05-07 (sorted by `from`; night wraps midnight) */
export const PERIODS: readonly Period[] = [
  { from: 5 * 60, top: '#2a3358', bottom: '#8a8fb0', lights: 0.15 }, // dawn
  { from: 7 * 60, top: '#7f93ab', bottom: '#a9b8c9', lights: 0 }, // day
  { from: 17 * 60, top: '#3b3f6b', bottom: '#c98a6b', lights: 0.3 }, // evening
  { from: 20 * 60, top: '#0d1430', bottom: '#1d2650', lights: 0.45 }, // night
]

/** the colours blend over this many minutes from the start of a period */
export const BLEND_MIN = 10

export const hexRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
export const rgbHex = (c: Rgb) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

export interface OutsideLook {
  top: string
  bottom: string
  lights: number
  /** changes only when the look changes: the caller redraws on a new key */
  key: string
}

/** the look at `minutes` since KST midnight (0..1439): the period's own values, blended from the previous period for BLEND_MIN */
export function outsideAt(minutes: number): OutsideLook {
  const m = ((minutes % 1440) + 1440) % 1440
  let i = PERIODS.length - 1
  for (let k = 0; k < PERIODS.length; k++) if (m >= PERIODS[k].from) i = k
  const cur = PERIODS[i]
  const prev = PERIODS[(i + PERIODS.length - 1) % PERIODS.length]
  const since = (m - cur.from + 1440) % 1440
  const k = since >= BLEND_MIN ? 1 : since / BLEND_MIN
  if (k >= 1) return { top: cur.top, bottom: cur.bottom, lights: cur.lights, key: `${i}` }
  return {
    top: rgbHex(mix(hexRgb(prev.top), hexRgb(cur.top), k)),
    bottom: rgbHex(mix(hexRgb(prev.bottom), hexRgb(cur.bottom), k)),
    lights: prev.lights + (cur.lights - prev.lights) * k,
    key: `${i}:${since}`,
  }
}

/** a silhouette layer's colour: the horizon colour pulled towards black (farther layers are lighter, hazier) */
export function silhouette(look: OutsideLook, depth: 'far' | 'mid' | 'near'): string {
  const dark = { far: 0.55, mid: 0.38, near: 0.22 }[depth]
  return rgbHex(mix(hexRgb(look.bottom), [0, 0, 0], 1 - dark))
}
