// Load order of the baked atlases (#280 9.4): the first screen needs only office.glb and the atlases that fill the
// default view. The close-up atlases are fetched after the first frame; until they arrive their materials show a
// 512 px version (<name>.lo.webp, made from the full file by scripts/atlas-lo.mjs). Nothing here knows an atlas size.
import { Mesh, type Material, type Object3D, type Texture } from 'three'
import { assetUrl } from '../room/base'

export const ATLASES = ['room', 'floor', 'walls_nw', 'walls_se', 'work', 'wall_items', 'lounge', 'lounge2', 'desk_props'] as const
export type AtlasName = (typeof ATLASES)[number]

/** fetched after the first screen is shown (a 512 px stand-in is used until then) */
export const DEFERRED_ATLASES: readonly AtlasName[] = ['wall_items', 'lounge2', 'desk_props']
export const isDeferred = (a: AtlasName) => DEFERRED_ATLASES.includes(a)

export const atlasUrl = (a: AtlasName) => assetUrl(`models/${a}.webp`)
export const atlasLoUrl = (a: AtlasName) => assetUrl(`models/${a}.lo.webp`)

/** what the first screen downloads for each atlas: the full file, or the small stand-in for a deferred one */
export const firstUrl = (a: AtlasName) => (isDeferred(a) ? atlasLoUrl(a) : atlasUrl(a))
export const FIRST_URLS = ATLASES.map(firstUrl)

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
 * Fetches the full version of each deferred atlas (one after the other would only slow it: all at once) and swaps it in
 * as it arrives. `prepareTexture` sets the texture's flags; `load` is injectable for tests. A failed fetch keeps the stand-in.
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
    DEFERRED_ATLASES.map(async (a) => {
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
