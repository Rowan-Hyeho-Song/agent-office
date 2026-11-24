// #676: the baked atlases as KTX2 (Basis Universal), so the GPU keeps them compressed (BC7 / ETC / ASTC) instead of the RGBA8 a webp expands
// to; each one ETC1S, UASTC or left as webp (ENCODING). Reads <dir>/<name>.webp, decodes it in Chrome to a lossless PNG (no image library is installed; the same way as atlas-lo.mjs),
// then KTX-Software's `ktx create` encodes it with mipmaps (a compressed texture cannot make its own on the GPU). Writes <name>.ktx2 next to it.
//   node scripts/atlas-ktx2.mjs [dir] [--prune] [name ...]   dir defaults to public/models; names: only these (default: all ten)
// --prune (build-office.sh, after atlas-lo.mjs): once all are converted and each .ktx2 is the size of its webp, deletes the full webp of the
// deferred atlases that have a .ktx2 — the app shows their .lo.webp, then swaps in the .ktx2 (src/office/atlases.ts) — and any old .ktx2 of
// an atlas left as webp. Anything wrong (no ktx, a failed encode, a size that does not match, a missing stand-in) ends with an error and
// deletes nothing.
// Needs `ktx` (KTX-Software 4.4+): $KTX_BIN, the PATH or its default install place.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ATLASES = ['room', 'floor', 'walls_nw', 'walls_se', 'work', 'wall_items', 'lounge', 'lounge2', 'desk_props', 'fridge'] // keep in step with ATLASES in src/office/atlases.ts
const DEFERRED = ['floor', 'wall_items', 'lounge', 'lounge2', 'desk_props', 'fridge'] // keep in step with DEFERRED_ATLASES in src/office/atlases.ts
const args = process.argv.slice(2)
const prune = args.includes('--prune')
const [dir = 'public/models', ...only] = args.filter((a) => a !== '--prune')
const names = only.length ? ATLASES.filter((n) => only.includes(n)) : ATLASES
const fail = (msg) => {
  console.error(`atlas-ktx2: ${msg} (#676)`)
  process.exit(1)
}
if (prune && names.length !== ATLASES.length) fail('--prune converts all ten atlases: no names with it')

/**
 * how each atlas goes to the GPU (#676, designer #685): ETC1S — small (BasisLZ); UASTC — near-lossless, for the walls' smooth light gradients
 * where ETC1S shows 4×4 blocks (RDO 4 + zstd keeps them small); webp — no KTX2 at all. Keep the webp ones in step with WEBP_ATLASES in
 * src/office/atlases.ts (atlases.test.ts checks).
 */
const ENCODING = { room: 'etc1s', floor: 'etc1s', walls_nw: 'webp', walls_se: 'webp', work: 'etc1s', wall_items: 'etc1s', lounge: 'etc1s', lounge2: 'etc1s', desk_props: 'etc1s', fridge: 'etc1s' }
/** sRGB colour, mipmaps, then the encoder's settings as measured in #676 / #685 */
const COMMON = ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap']
const ENCODE = {
  etc1s: [...COMMON, '--encode', 'basis-lz', '--clevel', '4', '--qlevel', '192'],
  uastc: [...COMMON, '--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--uastc-rdo-l', '4', '--zstd', '18'],
}
for (const n of ATLASES) if (!(ENCODING[n] in ENCODE) && ENCODING[n] !== 'webp') fail(`no encoding for ${n}`)

/** where `ktx` is: $KTX_BIN, else on the PATH, else the installer's default place under Program Files (Windows) */
const KTX = [process.env.KTX_BIN, 'ktx', process.env.ProgramFiles && join(process.env.ProgramFiles, 'KTX-Software', 'bin', 'ktx.exe')].find((bin) => {
  if (!bin) return false
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})
if (!KTX) fail('ktx (KTX-Software 4.4+) not found: install it, put it on the PATH or set KTX_BIN')
if (process.env.KTX_BIN && KTX !== process.env.KTX_BIN) console.warn(`atlas-ktx2: KTX_BIN (${process.env.KTX_BIN}) does not run; using ${KTX}`)
for (const n of names) if (!existsSync(join(dir, `${n}.webp`))) fail(`${dir}/${n}.webp is missing: bake first (assets/blender/build-office.sh)`)
if (prune) for (const n of DEFERRED) if (!existsSync(join(dir, `${n}.lo.webp`))) fail(`${dir}/${n}.lo.webp is missing: run scripts/atlas-lo.mjs first`)

/** a .ktx2's level-0 size from its header (pixelWidth / pixelHeight at bytes 20 / 24) */
const ktx2Size = (file) => {
  const b = readFileSync(file)
  if (b.subarray(0, 12).toString('latin1') !== '«KTX 20»\r\n\x1a\n') throw new Error(`${file} is not a KTX2 file`)
  return [b.readUInt32LE(20), b.readUInt32LE(24)]
}

// every new file is written as <name>.ktx2.new first; only when all of them are made and checked do they replace the old ones (one step at the
// end), so a failure half-way leaves the previous set whole instead of a mix of old and new atlases
const made = []
const tmp = mkdtempSync(join(tmpdir(), 'atlas-ktx2-'))
const browser = await chromium.launch({ channel: 'chrome' })
let ok = false
try {
  const page = await browser.newPage()
  for (const name of names.filter((n) => ENCODING[n] !== 'webp')) {
    const src = join(dir, `${name}.webp`)
    const { png, w, h } = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/webp;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      return { png: c.toDataURL('image/png').split(',')[1], w: img.naturalWidth, h: img.naturalHeight }
    }, readFileSync(src).toString('base64'))
    const pngPath = join(tmp, `${name}.png`)
    writeFileSync(pngPath, Buffer.from(png, 'base64'))
    const out = join(dir, `${name}.ktx2.new`)
    made.push(out)
    execFileSync(KTX, ['create', ...ENCODE[ENCODING[name]], pngPath, out], { stdio: 'inherit' }) // throws (exit ≠ 0) on a failed encode
    const [kw, kh] = ktx2Size(out)
    if (kw !== w || kh !== h) throw new Error(`${out} is ${kw}×${kh}, its webp ${w}×${h}`)
    console.log(`${name}: ${w}×${h} webp ${(statSync(src).size / 1024).toFixed(0)} KB → ${ENCODING[name]} ktx2 ${(statSync(out).size / 1024).toFixed(0)} KB`)
  }
  ok = true
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
  if (!ok) for (const f of made) rmSync(f, { force: true }) // nothing replaced, nothing pruned
}

for (const f of made) renameSync(f, f.slice(0, -'.new'.length))
if (prune) {
  const gone = DEFERRED.filter((n) => ENCODING[n] !== 'webp')
  for (const n of gone) rmSync(join(dir, `${n}.webp`))
  for (const n of ATLASES) if (ENCODING[n] === 'webp') rmSync(join(dir, `${n}.ktx2`), { force: true })
  console.log(`pruned the full webp of ${gone.join(', ')} (the app uses their .lo.webp, then the .ktx2)`)
}
