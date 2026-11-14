// #4 12.2 (the designer's grids, #454 comment 6871477839): the snack, cheer and heart icons as pixel art. 12 × 12 (the heart 7 × 7),
// drawn at twice the size (24 px, 14 px) with crisp edges; the same icons on the badge's buttons and in flight. The ink outline
// reads both on the ivory badge and over the dark office. Pure: an SVG string, used by the DOM layer and by React alike.

import type { TreatKind } from '../../visit/treat'

const PALETTE: Record<string, string> = {
  k: '#0b0e13', // outline (ink)
  w: '#cfd6e0', // steam
  W: '#f3ead8', // mug
  b: '#6b3f22', // coffee
  A: '#f2b33d', // amber (the mug's band, the sparkle)
  Y: '#fff1b8', // the sparkle's core
  T: '#d9a05b', // cookie
  d: '#5a3418', // chocolate chip
  R: '#e0483e', // apple
  h: '#ffb3a7', // the apple's light (the heart's light is its own, below)
  G: '#4fb06a', // leaf
  M: 'var(--color-magenta)', // heart
}

export type PixelIconName = TreatKind | 'heart'

export const ICON_GRIDS: Record<PixelIconName, string[]> = {
  coffee: [
    '...w.w......',
    '..w.w.......',
    '...w.w......',
    '.kkkkkkk....',
    '.kbbbbbk....',
    '.kWWWWWkkk..',
    '.kWWWWWk.k..',
    '.kAAAAAk.k..',
    '.kWWWWWkkk..',
    '.kWWWWWk....',
    '..kkkkk.....',
    '............',
  ],
  cookie: [
    '............',
    '...kkkkkk...',
    '..kTTTTTTk..',
    '.kTTdTTTTTk.',
    '.kTTTTTdTTk.',
    '.kTdTTTTTTk.',
    '.kTTTTdTTTk.',
    '.kTTdTTTTdk.',
    '.kTTTTTTTTk.',
    '..kTTTdTTk..',
    '...kkkkkk...',
    '............',
  ],
  apple: [
    '......k.....',
    '.....kGG....',
    '......kGG...',
    '..kkk.k.kk..',
    '.kRRRkkRRRk.',
    '.kRhRRRRRRk.',
    '.kRhRRRRRRk.',
    '.kRRRRRRRRk.',
    '.kRRRRRRRRk.',
    '..kRRRRRRk..',
    '...kkkkkk...',
    '............',
  ],
  cheer: [
    '..........A.',
    '.........AYA',
    '....k.....A.',
    '...kAk......',
    '...kAk......',
    '..kAYAk.....',
    'kAAYYYAAk...',
    '..kAYAk.....',
    '...kAk......',
    '...kAk......',
    '....k.......',
    '............',
  ],
  heart: ['.kk.kk.', 'kMMkMMk', 'kMhMMMk', 'kMMMMMk', '.kMMMk.', '..kMk..', '...k...'],
}

/** the heart's light is pinker than the apple's */
const HEART_LIGHT = '#ffd1ec'

/** the icon as an SVG string at `scale` px per cell (2: 24 px for the 12 × 12, 14 px for the heart); runs of a colour are one rect */
export function pixelSvg(name: PixelIconName, scale = 2): string {
  const grid = ICON_GRIDS[name]
  const n = grid[0].length
  const rects: string[] = []
  grid.forEach((row, y) => {
    let x = 0
    while (x < n) {
      const c = row[x]
      let end = x + 1
      while (end < n && row[end] === c) end++
      if (c !== '.') {
        const fill = name === 'heart' && c === 'h' ? HEART_LIGHT : PALETTE[c]
        rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`)
      }
      x = end
    }
  })
  const px = n * scale
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${grid.length * scale}" viewBox="0 0 ${n} ${grid.length}" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`
}
