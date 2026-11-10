import { readFileSync, existsSync } from 'node:fs'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { ATLASES, DEFERRED_ATLASES, FIRST_URLS, _resetFirstScreen, afterFirstScreen, atlasLoUrl, atlasUrl, firstUrl, isDeferred, markFirstScreen, swapAtlas, upgradeAtlases } from './atlases'

describe('load order', () => {
  it('only the close-up atlases are deferred, and they are real atlases', () => {
    expect([...DEFERRED_ATLASES].sort()).toEqual(['desk_props', 'lounge', 'lounge2', 'wall_items'])
    for (const a of DEFERRED_ATLASES) expect(ATLASES).toContain(a)
  })
  it('scripts/atlas-lo.mjs makes stand-ins for exactly the deferred atlases', () => {
    const src = readFileSync(new URL('../../scripts/atlas-lo.mjs', import.meta.url), 'utf8')
    const list = /const DEFERRED = \[(.*?)\]/.exec(src)![1].split(',').map((x) => x.trim().replace(/'/g, ''))
    expect(list.sort()).toEqual([...DEFERRED_ATLASES].sort())
  })
  it('the first screen fetches full files for the rest and stand-ins for the deferred ones', () => {
    expect(FIRST_URLS).toHaveLength(ATLASES.length)
    for (const a of ATLASES) {
      expect(firstUrl(a)).toBe(isDeferred(a) ? atlasLoUrl(a) : atlasUrl(a))
      expect(firstUrl(a)).toMatch(isDeferred(a) ? /\.lo\.webp$/ : /[^o]\.webp$/)
    }
    for (const a of ['room', 'floor', 'walls_nw', 'walls_se', 'work'] as const) expect(isDeferred(a)).toBe(false)
  })
  it('every atlas has its file, every deferred one a stand-in far smaller than the full file', () => {
    const size = (f: string) => readFileSync(new URL(`../../public/models/${f}`, import.meta.url)).length
    for (const a of ATLASES) expect(existsSync(new URL(`../../public/models/${a}.webp`, import.meta.url))).toBe(true)
    for (const a of DEFERRED_ATLASES) expect(size(`${a}.lo.webp`)).toBeLessThan(size(`${a}.webp`) / 2)
  })
})

describe('first screen gate', () => {
  beforeEach(_resetFirstScreen)
  it('waits for the first screen, then runs once; a cancel keeps it from running', () => {
    let n = 0
    afterFirstScreen(() => n++)
    const cancel = afterFirstScreen(() => (n += 10))
    cancel()
    expect(n).toBe(0)
    markFirstScreen()
    markFirstScreen()
    expect(n).toBe(1)
  })
  it('runs at once when the screen is already up', () => {
    markFirstScreen()
    let n = 0
    afterFirstScreen(() => n++)
    expect(n).toBe(1)
  })
})

describe('swap to the full atlas', () => {
  const scene = (stand: Texture, other: Texture) => {
    const g = new Group()
    const a = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: stand }))
    const b = new Mesh(new BoxGeometry(), [new MeshBasicMaterial({ map: stand }), new MeshBasicMaterial({ map: other })])
    g.add(a, b)
    return { g, a, b }
  }
  it('replaces only the stand-in, in single and array materials, and disposes the stand-in', () => {
    const stand = new Texture()
    const other = new Texture()
    const full = new Texture()
    let disposed = false
    stand.addEventListener('dispose', () => (disposed = true))
    const { g, a, b } = scene(stand, other)
    expect(swapAtlas(g, stand, full)).toBe(2)
    expect((a.material as MeshBasicMaterial).map).toBe(full)
    expect((b.material as MeshBasicMaterial[])[0].map).toBe(full)
    expect((b.material as MeshBasicMaterial[])[1].map).toBe(other)
    expect(disposed).toBe(true)
  })
  it('upgradeAtlases fetches the full url of each deferred atlas only, and keeps the stand-in on a failed fetch', async () => {
    const stands = Object.fromEntries(DEFERRED_ATLASES.map((a) => [a, new Texture()]))
    const g = new Group()
    for (const t of Object.values(stands)) g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: t })))
    const asked: string[] = []
    const fails = atlasUrl('lounge2')
    const prepared: Texture[] = []
    const done = await upgradeAtlases(
      g,
      stands,
      async (url) => {
        asked.push(url)
        if (url === fails) throw new Error('offline')
        return new Texture()
      },
      (t) => prepared.push(t),
    )
    expect(asked.sort()).toEqual(DEFERRED_ATLASES.map(atlasUrl).sort())
    expect(done.sort()).toEqual(DEFERRED_ATLASES.filter((a) => a !== 'lounge2').sort())
    expect(prepared).toHaveLength(DEFERRED_ATLASES.length - 1)
    const maps = g.children.map((m) => ((m as Mesh).material as MeshBasicMaterial).map)
    expect(maps).toContain(stands.lounge2) // kept
    expect(maps).not.toContain(stands.desk_props)
    expect(maps).not.toContain(stands.wall_items)
  })
  it('a texture that arrives after the scene is gone is dropped, not swapped', async () => {
    const stands = { desk_props: new Texture() }
    const g = new Group()
    g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: stands.desk_props })))
    const full = new Texture()
    let disposed = false
    full.addEventListener('dispose', () => (disposed = true))
    const done = await upgradeAtlases(g, stands, async () => full, () => {}, () => false)
    expect(done).toEqual([])
    expect(disposed).toBe(true)
  })
})
