// What the window shows by KST time of day (#111, designer values): sky gradient top -> horizon and the strength of
// the share of the city's windows that are lit. Only these change; the baked interior stays. Pure.

export type Rgb = readonly [number, number, number]

interface Period {
  /** start, minutes since KST midnight */
  from: number
  top: string
  bottom: string
  /** share of the window cells that are lit (0..1) */
  lights: number
}

/** day 07-17, evening 17-20, night 20-05, dawn 05-07 (sorted by `from`; night wraps midnight) */
export const PERIODS: readonly Period[] = [
  { from: 5 * 60, top: '#2a3358', bottom: '#8a8fb0', lights: 0.06 }, // dawn
  { from: 7 * 60, top: '#7f93ab', bottom: '#a9b8c9', lights: 0 }, // day
  { from: 17 * 60, top: '#3b3f6b', bottom: '#c98a6b', lights: 0.14 }, // evening
  { from: 20 * 60, top: '#0d1430', bottom: '#1d2650', lights: 0.2 }, // night
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
  /** changes only when the look changes (period, blend minute, KST hour): the caller redraws on a new key */
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
  if (k >= 1) return { top: cur.top, bottom: cur.bottom, lights: cur.lights, key: `${i}:${Math.floor(m / 60)}` }
  return {
    top: rgbHex(mix(hexRgb(prev.top), hexRgb(cur.top), k)),
    bottom: rgbHex(mix(hexRgb(prev.bottom), hexRgb(cur.bottom), k)),
    lights: prev.lights + (cur.lights - prev.lights) * k,
    key: `${i}:${since}:${Math.floor(m / 60)}`,
  }
}

/** aerial perspective: a layer is the horizon colour pulled towards a dark blue-grey, the nearer the more */
export const SILHOUETTE_BASE = '#151a24'
export const SILHOUETTE_T = { far: 0.35, mid: 0.6, near: 0.85 } as const
export function silhouette(look: OutsideLook, depth: 'far' | 'mid' | 'near'): string {
  return rgbHex(mix(hexRgb(look.bottom), hexRgb(SILHOUETTE_BASE), SILHOUETTE_T[depth]))
}

/** the lit windows' colours (roughly five warm to one cool) and their top brightness */
export const LIGHT_WARM = '#ffd27a'
export const LIGHT_COOL = '#cfe3ff'
export const LIGHT_LEVEL = 0.9

/** mulberry32: a small seeded generator */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Which of `n` window cells are lit, and which of those are cool: seeded by the KST hour, so everyone sees the same
 * pattern for the whole hour. Each cell has a fixed rank per hour, so more light only adds windows.
 */
export function litWindows(n: number, fraction: number, hour: number): { lit: boolean[]; cool: boolean[] } {
  const r = rng(hour * 7919 + 17)
  const lit: boolean[] = []
  const cool: boolean[] = []
  for (let i = 0; i < n; i++) {
    lit.push(r() < fraction)
    cool.push(r() < 1 / 6)
  }
  return { lit, cool }
}
