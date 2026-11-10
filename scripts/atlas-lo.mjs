// Makes the 512 px stand-ins (<name>.lo.webp) of the close-up atlases from their full-size webp (#280 9.4).
// The first screen shows these until the full atlas has been fetched (src/office/atlases.ts). It reads the full files
// in public/models/, so it never needs to know their size; run it after every bake (build-office.sh does):
//   node scripts/atlas-lo.mjs [dir]        dir defaults to public/models
// No image library is installed, so Chrome (already needed by smoke / a11y; playwright-core drives the system
// browser) does the resize and the webp encode.
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const DEFERRED = ['wall_items', 'lounge', 'lounge2', 'desk_props'] // keep in step with DEFERRED_ATLASES in src/office/atlases.ts
const SIZE = 512
const QUALITY = 0.9
const dir = process.argv[2] ?? 'public/models'

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage()
  for (const name of DEFERRED) {
    const src = join(dir, `${name}.webp`)
    const b64 = readFileSync(src).toString('base64')
    const out = await page.evaluate(
      async ({ b64, size, quality }) => {
        const img = new Image()
        img.src = `data:image/webp;base64,${b64}`
        await img.decode()
        const w = Math.max(1, Math.round((img.naturalWidth * size) / Math.max(img.naturalWidth, img.naturalHeight)))
        const h = Math.max(1, Math.round((img.naturalHeight * size) / Math.max(img.naturalWidth, img.naturalHeight)))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, w, h)
        return { url: c.toDataURL('image/webp', quality), from: [img.naturalWidth, img.naturalHeight], w, h }
      },
      { b64, size: SIZE, quality: QUALITY },
    )
    const dst = join(dir, `${name}.lo.webp`)
    writeFileSync(dst, Buffer.from(out.url.split(',')[1], 'base64'))
    console.log(`${name}: ${out.from.join('x')} -> ${out.w}x${out.h}, ${statSync(dst).size} bytes`)
  }
} finally {
  await browser.close()
}
