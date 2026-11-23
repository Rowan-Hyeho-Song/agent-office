// #676 3단계 (trial, Draft): the baked atlases as KTX2 (Basis Universal), so the GPU keeps them compressed (BC7 / ASTC / ETC) instead of the
// RGBA8 a webp expands to. Reads public/models/<name>.webp, decodes it in Chrome to a lossless PNG (no image library is installed; the same way
// as atlas-lo.mjs), then KTX-Software's `ktx create` encodes it with mipmaps (a compressed texture cannot make its own on the GPU):
//   node scripts/atlas-ktx2.mjs [uastc|etc1s] [dir] [name ...]   default uastc, dir public/models, names: all ten atlases
// Writes <name>.ktx2 next to the webp. Needs `ktx` (KTX-Software 4.4+) on the PATH. The app loads them only with ?ktx2 (src/office/atlases.ts).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ATLASES = ['room', 'floor', 'walls_nw', 'walls_se', 'work', 'wall_items', 'lounge', 'lounge2', 'desk_props', 'fridge'] // keep in step with ATLASES in src/office/atlases.ts
const mode = process.argv[2] === 'etc1s' ? 'etc1s' : 'uastc'
const dir = process.argv[3] ?? 'public/models'
const only = process.argv.slice(4)

/** the encoder's settings: UASTC near-lossless (RDO keeps zstd effective), ETC1S small and lossier; sRGB colour, mipmaps, zstd supercompression */
const ENCODE = {
  uastc: ['--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--uastc-rdo-l', '1.0', '--zstd', '18'],
  etc1s: ['--encode', 'basis-lz', '--clevel', '4', '--qlevel', '192'],
}[mode]

try {
  execFileSync('ktx', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('ktx (KTX-Software 4.4+) is not on the PATH: install it first (#676 결재)')
  process.exit(1)
}

const tmp = mkdtempSync(join(tmpdir(), 'atlas-ktx2-'))
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage()
  for (const name of only.length ? ATLASES.filter((n) => only.includes(n)) : ATLASES) {
    const src = join(dir, `${name}.webp`)
    const b64 = readFileSync(src).toString('base64')
    const png = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/webp;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      return c.toDataURL('image/png').split(',')[1]
    }, b64)
    const pngPath = join(tmp, `${name}.png`)
    writeFileSync(pngPath, Buffer.from(png, 'base64'))
    const out = join(dir, `${name}.ktx2`)
    execFileSync('ktx', ['create', '--format', 'R8G8B8A8_SRGB', '--assign-oetf', 'srgb', '--generate-mipmap', ...ENCODE, pngPath, out], { stdio: 'inherit' })
    console.log(`${name}: webp ${(statSync(src).size / 1024).toFixed(0)} KB → ${mode} ktx2 ${(statSync(out).size / 1024).toFixed(0)} KB`)
  }
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}
