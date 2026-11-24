import { readFileSync, existsSync } from 'node:fs'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { ATLASES, DEFERRED_ATLASES, FIRST_URLS, KTX2_OFF, WEBP_ATLASES, _resetFirstScreen, afterFirstScreen, atlasLoUrl, atlasUrl, firstUrl, isDeferred, markFirstScreen, swapAtlas, upgradeAtlases, upgradedAtlases } from './atlases'

describe('load order', () => {
  it('the close-up atlases and the floor (#402: the widest on the first screen) are deferred, and they are real atlases', () => {
    expect([...DEFERRED_ATLASES].sort()).toEqual(['desk_props', 'floor', 'fridge', 'lounge', 'lounge2', 'wall_items'])
    for (const a of DEFERRED_ATLASES) expect(ATLASES).toContain(a)
  })
  it('the bake scripts (atlas-lo.mjs, atlas-ktx2.mjs) list the same atlases as the app', () => {
    const list = (file: string, name: string) => {
      const src = readFileSync(new URL(`../../scripts/${file}`, import.meta.url), 'utf8')
      return new RegExp(`const ${name} = \\[(.*?)\\]`).exec(src)![1].split(',').map((x) => x.trim().replace(/'/g, '')).sort()
    }
    expect(list('atlas-lo.mjs', 'DEFERRED')).toEqual([...DEFERRED_ATLASES].sort())
    expect(list('atlas-ktx2.mjs', 'DEFERRED')).toEqual([...DEFERRED_ATLASES].sort())
    expect(list('atlas-ktx2.mjs', 'ATLASES')).toEqual([...ATLASES].sort())
    // the encoding table: one entry per atlas, and the webp ones are the app's WEBP_ATLASES
    const src = readFileSync(new URL('../../scripts/atlas-ktx2.mjs', import.meta.url), 'utf8')
    const enc = Object.fromEntries([...(/const ENCODING = \{(.*?)\}/.exec(src)![1].matchAll(/(\w+): '(etc1s|uastc|webp)'/g))].map((m) => [m[1], m[2]]))
    expect(Object.keys(enc).sort()).toEqual([...ATLASES].sort())
    expect(ATLASES.filter((a) => enc[a] === 'webp')).toEqual([...WEBP_ATLASES])
  })
  it('the first screen fetches the full webp of the rest and stand-ins for the deferred ones (no KTX2 before it, #676)', () => {
    expect(FIRST_URLS).toHaveLength(ATLASES.length)
    for (const a of ATLASES) expect(firstUrl(a)).toMatch(isDeferred(a) ? /\.lo\.webp$/ : /[^o]\.webp$/)
    for (const a of DEFERRED_ATLASES) expect(firstUrl(a)).toBe(atlasLoUrl(a))
    for (const a of ['room', 'walls_nw', 'walls_se', 'work'] as const) expect(isDeferred(a)).toBe(false)
  })
  it('#676 after the first screen every atlas with a KTX2 is fetched again as one; ?ktx2=off: only the deferred ones, as webp', () => {
    expect(KTX2_OFF).toBe(false)
    expect(upgradedAtlases()).toEqual(ATLASES.filter((a) => isDeferred(a) || !WEBP_ATLASES.includes(a)))
    for (const a of ATLASES) expect(atlasUrl(a)).toMatch(WEBP_ATLASES.includes(a) ? /[^o]\.webp$/ : /\.ktx2$/)
    expect(upgradedAtlases(true)).toEqual(DEFERRED_ATLASES)
    for (const a of ATLASES) expect(atlasUrl(a, true)).toMatch(/[^o]\.webp$/)
  })
  it('the files: a KTX2 of its size for each atlas but the webp ones; full webp for the first screen, stand-ins for the deferred (their webp pruned)', () => {
    const file = (f: string) => new URL(`../../public/models/${f}`, import.meta.url)
    const bytes = (f: string) => readFileSync(file(f))
    // level-0 size from the headers: KTX2 pixelWidth / pixelHeight at 20 / 24; webp from its VP8 / VP8L / VP8X chunk
    const ktx2Size = (f: string) => {
      const b = bytes(f)
      expect(b.subarray(0, 12).toString('latin1')).toBe('«KTX 20»\r\n\x1a\n')
      return [b.readUInt32LE(20), b.readUInt32LE(24)]
    }
    const webpSize = (f: string) => {
      const b = bytes(f)
      const kind = b.subarray(12, 16).toString('latin1')
      if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
      if (kind === 'VP8L') {
        const v = b.readUInt32LE(21)
        return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1]
      }
      return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    }
    for (const a of ATLASES) {
      if (WEBP_ATLASES.includes(a)) {
        expect(existsSync(file(`${a}.ktx2`))).toBe(false) // no stale one left
        expect(existsSync(file(`${a}.webp`))).toBe(true)
        continue
      }
      const [w, h] = ktx2Size(`${a}.ktx2`)
      if (!isDeferred(a)) {
        expect(webpSize(`${a}.webp`)).toEqual([w, h])
        continue
      }
      // the stand-in was made from the same full atlas: 512 px on its long side (scripts/atlas-lo.mjs)
      const s = 512 / Math.max(w, h)
      expect(webpSize(`${a}.lo.webp`)).toEqual([Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))])
      expect(bytes(`${a}.lo.webp`).length).toBeLessThan(bytes(`${a}.ktx2`).length / 2)
      expect(existsSync(file(`${a}.webp`))).toBe(false)
    }
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
    expect(asked.sort()).toEqual(DEFERRED_ATLASES.map((a) => atlasUrl(a)).sort())
    expect(done.sort()).toEqual(DEFERRED_ATLASES.filter((a) => a !== 'lounge2').sort())
    expect(prepared).toHaveLength(DEFERRED_ATLASES.length - 1)
    const maps = g.children.map((m) => ((m as Mesh).material as MeshBasicMaterial).map)
    expect(maps).toContain(stands.lounge2) // kept
    expect(maps).not.toContain(stands.desk_props)
    expect(maps).not.toContain(stands.wall_items)
  })
  it('#676 given every atlas, it fetches and swaps every one (the first-screen ones too, their old texture disposed)', async () => {
    const stands = Object.fromEntries(ATLASES.map((a) => [a, new Texture()]))
    let disposed = 0
    for (const t of Object.values(stands)) t.addEventListener('dispose', () => disposed++)
    const g = new Group()
    for (const t of Object.values(stands)) g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: t })))
    const asked: string[] = []
    const done = await upgradeAtlases(g, stands, async (url) => (asked.push(url), new Texture()), () => {})
    expect(asked.sort()).toEqual(ATLASES.map((a) => atlasUrl(a)).sort())
    expect(done.sort()).toEqual([...ATLASES].sort())
    expect(disposed).toBe(ATLASES.length)
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
