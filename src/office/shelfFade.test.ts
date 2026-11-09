import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, type Material } from 'three'
import { describe, expect, it } from 'vitest'
import { fadeMesh } from './fade'
import { loadOffice } from './glbLoad'
import { PropBank } from './rig'
import { SHELF, prepareView } from './walls'

// The bookshelf fades as ONE group (#253): back panel, shelves, binders, the books on it and what stands on / in it.
const box = (name: string, pos: [number, number, number], size: [number, number, number], userData: Record<string, unknown> = {}, mat: Material = new MeshStandardMaterial()) => {
  const m = new Mesh(new BoxGeometry(...size), mat)
  m.name = name
  m.position.set(...pos)
  m.userData = userData
  return m
}

describe('shelf group membership, from the model', async () => {
  const { scene } = await loadOffice()
  const groups = prepareView(scene)
  const shelf = groups.find((g) => g.id === SHELF)!
  const names = new Set(shelf.meshes.map((m) => m.name))
  const ownerName = (n: string) => scene.getObjectByName(n)!
  const under = (root: string) => {
    const out: Mesh[] = []
    ownerName(root).traverse((o) => o instanceof Mesh && out.push(o))
    return out
  }
  it('has the shelf body, binders, plates and every shelf book with its halves and page', () => {
    for (const n of ['shelf', 'shelf_r0_b0', 'screen_shelf_r1']) expect([...names].some((x) => x === n || x.startsWith(n + '_')), n).toBe(true)
    for (let i = 0; i < 5; i++) {
      for (const root of [`prop_shelfbook_${i}`, `prop_shelfbook_${i}_l`, `prop_shelfbook_${i}_r`, `prop_shelfbook_${i}_page`]) {
        const ms = under(root)
        expect(ms.length).toBeGreaterThan(0)
        for (const m of ms) expect(shelf.meshes.includes(m), `${root} / ${m.name}`).toBe(true)
      }
    }
  })
  it('has nothing else: no agent, wall, room, desk or lounge mesh, no desk book', () => {
    for (const m of shelf.meshes) {
      expect(m.name).not.toMatch(/^(agent_|room|wall_|desk_|lounge)/)
      expect(m.userData.wall).toBeUndefined()
    }
    for (const m of under('prop_book')) expect(shelf.meshes.includes(m)).toBe(false)
    expect(shelf.meshes.every((m) => m.userData.fadeGroup === SHELF)).toBe(true)
  })
  it('books know their prop, the shelf body does not', () => {
    const l = under('prop_shelfbook_2_l')[0]
    expect(shelf.props!.get(l)?.name).toBe('prop_shelfbook_2')
    expect(shelf.props!.get(under('prop_shelfbook_2_page')[0])?.name).toBe('prop_shelfbook_2')
    expect(shelf.props!.get(under('shelf')[0])).toBeUndefined()
  })
  it('every member has a material of its own (an exported lit material is shared by many meshes)', () => {
    expect(new Set(shelf.meshes).size).toBe(shelf.meshes.length)
    const seen = new Set<unknown>()
    for (const g of groups) for (const m of g.meshes) {
      expect(seen.has(m.material)).toBe(false)
      seen.add(m.material)
    }
  })
  it('the whole group at one opacity, restored exactly', () => {
    const before = shelf.meshes.map((m) => [(m.material as MeshStandardMaterial).alphaHash, (m.material as MeshStandardMaterial).transparent, (m.material as MeshStandardMaterial).opacity])
    for (const m of shelf.meshes) fadeMesh(m, 0.25)
    for (const m of shelf.meshes) {
      const mat = m.material as MeshStandardMaterial
      if (!before[shelf.meshes.indexOf(m)][1]) expect([mat.alphaHash, mat.opacity, mat.transparent]).toEqual([true, 0.25, false])
    }
    for (const m of shelf.meshes) fadeMesh(m, 1)
    expect(shelf.meshes.map((m) => [(m.material as MeshStandardMaterial).alphaHash, (m.material as MeshStandardMaterial).transparent, (m.material as MeshStandardMaterial).opacity])).toEqual(before)
  })
})

describe('shelf group rules (synthetic)', () => {
  const build = () => {
    const shared = new MeshBasicMaterial()
    const scene = new Group()
    const shelf = box('shelf', [3.75, 1, -3.26], [1.1, 2, 0.4], { backTo: 'n' }, shared)
    scene.add(shelf)
    return { scene, shared, shelf }
  }
  it('a node inside the shelf volume or on top of it joins, with no name or extras', () => {
    const { scene } = build()
    const inside = box('vase', [3.6, 0.5, -3.26], [0.1, 0.1, 0.1])
    const onTop = box('trophy', [3.9, 2.2, -3.26], [0.1, 0.3, 0.1])
    const beside = box('bin', [2.4, 0.5, -3.26], [0.1, 0.1, 0.1])
    const agent = box('agent_1_body', [3.6, 0.5, -3.26], [0.1, 0.1, 0.1])
    scene.add(inside, onTop, beside, agent)
    const g = prepareView(scene).find((x) => x.id === SHELF)!
    const ns = g.meshes.map((m) => m.name)
    expect(ns).toContain('vase')
    expect(ns).toContain('trophy')
    expect(ns).not.toContain('bin')
    expect(ns).not.toContain('agent_1_body')
  })
  it('the model marker fade_group joins a node wherever it is', () => {
    const { scene } = build()
    scene.add(box('far_thing', [-3, 0.5, 0], [0.1, 0.1, 0.1], { fade_group: SHELF }))
    expect(prepareView(scene).find((x) => x.id === SHELF)!.meshes.map((m) => m.name)).toContain('far_thing')
  })
  it('furniture sharing the shelf atlas material is unaffected by the fade', () => {
    const { scene, shared } = build()
    const other = box('table', [0, 0.5, 0], [1, 1, 1], {}, shared)
    scene.add(other)
    const g = prepareView(scene).find((x) => x.id === SHELF)!
    expect(g.meshes[0].material).not.toBe(shared)
    fadeMesh(g.meshes[0], 0.25)
    expect(other.material).toBe(shared)
    expect((other.material as MeshBasicMaterial).alphaHash).toBe(false)
    expect((other.material as MeshBasicMaterial).opacity).toBe(1)
  })
  it('a material that is already transparent keeps its blending and only scales opacity', () => {
    const m = box('x', [0, 0, 0], [1, 1, 1], {}, new MeshBasicMaterial({ transparent: true, opacity: 0.5 }))
    fadeMesh(m, 0.5)
    expect([(m.material as MeshBasicMaterial).alphaHash, (m.material as MeshBasicMaterial).opacity]).toEqual([false, 0.25])
    fadeMesh(m, 1)
    expect((m.material as MeshBasicMaterial).opacity).toBe(0.5)
  })
})

describe('a book taken out leaves the group', () => {
  it('PropBank.isAway: held, forced or borrowed = away; home = in', () => {
    const scene = new Group()
    const book = new Object3D()
    book.name = 'prop_shelfbook_0'
    book.userData = { prop: 'book' }
    book.position.set(4.2, 0.6, -3.1)
    scene.add(book)
    const holder = new Object3D()
    const bank = new PropBank(scene, { prop_shelfbook_0: book })
    expect(bank.isAway(book)).toBe(false)
    book.position.x += 0.3 // flying home
    expect(bank.isAway(book)).toBe(true)
    book.position.x -= 0.3
    expect(bank.isAway(book)).toBe(false)
    bank.borrowed.add(book)
    expect(bank.isAway(book)).toBe(true)
    bank.borrowed.delete(book)
    bank.force(book, null)
    expect(holder).toBeDefined()
    expect(bank.isAway(book)).toBe(false)
  })
})
