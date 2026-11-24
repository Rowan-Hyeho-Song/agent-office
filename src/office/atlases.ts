// Load order of the baked atlases (#280 9.4): the first screen needs only office.glb and the atlases that fill the
// default view. The close-up atlases are fetched after the first frame; until they arrive their materials show a
// 512 px version (<name>.lo.webp, made from the full file by scripts/atlas-lo.mjs). Nothing here knows an atlas size.
import { Mesh, type Material, type Object3D, type Texture } from 'three'
import { assetUrl } from '../room/base'

export const ATLASES = ['room', 'floor', 'walls_nw', 'walls_se', 'work', 'wall_items', 'lounge', 'lounge2', 'desk_props', 'fridge'] as const
export type AtlasName = (typeof ATLASES)[number]

/** fetched after the first screen is shown (a 512 px stand-in is used until then) */
// #402 the floor too: the widest thing on the first screen, 145 KB before it; its 512 px stand-in first, the full one after
export const DEFERRED_ATLASES: readonly AtlasName[] = ['floor', 'wall_items', 'lounge', 'lounge2', 'desk_props', 'fridge']
export const isDeferred = (a: AtlasName) => DEFERRED_ATLASES.includes(a)

/**
 * #676 KTX2: a webp atlas expands to RGBA8 on the GPU (~233 MB for the ten); a KTX2 one (scripts/atlas-ktx2.mjs) stays compressed (BC7 /
 * ETC / ASTC, a quarter to an eighth of that). The first screen is unchanged: the full webp of the first-screen four and the 512 px stand-ins
 * of the deferred six, so it fetches nothing more. After it, the KTX2 loader and its transcoder come, every atlas with a KTX2 is fetched again
 * as .ktx2 and swapped in (the old texture disposed before the new one is drawn, so the GPU never holds both). A failed fetch keeps what is
 * shown. The deferred six have no full webp (the bake prunes them), so ?ktx2=off (for comparing) leaves them at 512 px.
 */
export const KTX2_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ktx2') === 'off'
/**
 * the atlases with no KTX2, kept as webp (designer #685: the walls' smooth light gradients show ETC1S's 4×4 blocks). Keep in step with
 * ENCODING in scripts/atlas-ktx2.mjs (atlases.test.ts checks).
 */
export const WEBP_ATLASES: readonly AtlasName[] = ['walls_nw', 'walls_se']
export const usesKtx2 = (a: AtlasName, off = KTX2_OFF) => !off && !WEBP_ATLASES.includes(a)
export const atlasKtx2Url = (a: AtlasName) => assetUrl(`models/${a}.ktx2`)
const atlasWebpUrl = (a: AtlasName) => assetUrl(`models/${a}.webp`)
/** the full file of atlas `a` once the first screen is up */
export const atlasUrl = (a: AtlasName, off = KTX2_OFF) => (usesKtx2(a, off) ? atlasKtx2Url(a) : atlasWebpUrl(a))
export const atlasLoUrl = (a: AtlasName) => assetUrl(`models/${a}.lo.webp`)

/** what the first screen downloads for each atlas: the full webp, or the small stand-in for a deferred one */
export const firstUrl = (a: AtlasName) => (isDeferred(a) ? atlasLoUrl(a) : atlasWebpUrl(a))
export const FIRST_URLS = ATLASES.map(firstUrl)
/** the atlases fetched again after the first screen: the deferred ones, and every one with a KTX2 (?ktx2=off: the deferred ones, as before #676) */
export const upgradedAtlases = (off = KTX2_OFF): readonly AtlasName[] => ATLASES.filter((a) => isDeferred(a) || usesKtx2(a, off))

/** the first rendered frame with the room visible: set by ReadyPing; `window.__officeFirstScreen` is the time (ms) for measuring */
let firstScreen = false
const waiting: (() => void)[] = []
export function markFirstScreen() {
  if (firstScreen) return
  firstScreen = true
  if (typeof window !== 'undefined') (window as unknown as { __officeFirstScreen: number }).__officeFirstScreen = performance.now()
  for (const w of waiting.splice(0)) w()
}
/** runs `fn` once the first screen has been shown (at once if it already has); returns a cancel */
export function afterFirstScreen(fn: () => void) {
  if (firstScreen) {
    fn()
    return () => {}
  }
  waiting.push(fn)
  return () => {
    const i = waiting.indexOf(fn)
    if (i >= 0) waiting.splice(i, 1)
  }
}
export const _resetFirstScreen = () => {
  firstScreen = false
  waiting.length = 0
}

const materialsOf = (m: Material | Material[]) => (Array.isArray(m) ? m : [m])

/**
 * Puts `full` where `stand` (the 512 px stand-in) was: every material under `root` whose map is `stand` takes `full`
 * (same UVs, so nothing moves). The stand-in is disposed. Returns how many materials changed.
 */
export function swapAtlas(root: Object3D, stand: Texture, full: Texture): number {
  let n = 0
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    for (const m of materialsOf(o.material)) {
      const mm = m as Material & { map?: Texture | null }
      if (mm.map === stand) {
        mm.map = full
        mm.needsUpdate = true
        n++
      }
    }
  })
  stand.dispose()
  return n
}

/**
 * Fetches the full version of each atlas in `stands` (the deferred ones; with ?ktx2=swap all of them: upgradedAtlases) — one after the other
 * would only slow it: all at once — and swaps it in as it arrives. `prepareTexture` sets the texture's flags; `load` is injectable for tests.
 * A failed fetch keeps the stand-in.
 */
export async function upgradeAtlases(
  root: Object3D,
  stands: Partial<Record<AtlasName, Texture>>,
  load: (url: string) => Promise<Texture>,
  prepareTexture: (t: Texture) => void,
  isAlive: () => boolean = () => true,
): Promise<AtlasName[]> {
  const done: AtlasName[] = []
  await Promise.all(
    ATLASES.map(async (a) => {
      const stand = stands[a]
      if (!stand) return
      try {
        const full = await load(atlasUrl(a))
        if (!isAlive()) {
          full.dispose()
          return
        }
        prepareTexture(full)
        swapAtlas(root, stand, full)
        done.push(a)
      } catch {
        /* keep the 512 px one */
      }
    }),
  )
  return done
}
