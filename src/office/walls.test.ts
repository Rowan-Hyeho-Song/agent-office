import { BoxGeometry, Box3, Group, Mesh, MeshStandardMaterial, Vector3, type Intersection, type Material } from 'three'
import { describe, expect, it } from 'vitest'
import { SHELF, WALL_HIDDEN, fadeGroupOfNode, hitAllowed, prepareView, setWallCut, wallOfLoose } from './walls'
import { NONE_HIDDEN, VIEW, WALLS } from './view'
import { ROOM, floorRect, setRoomFromExtras, wallRect } from './room'

const box = (min: [number, number, number], max: [number, number, number]) => new Box3(new Vector3(...min), new Vector3(...max))
const mesh = (name: string, x: number, userData: Record<string, unknown> = {}) => {
  const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
  m.name = name
  m.position.x = x
  m.userData = userData
  return m
}

describe('fade groups', () => {
  it('the bookshelf (binders, plates, hit box) is one fade group', () => {
    for (const n of ['shelf_r0_b0', 'shelf_r0_b20_label', 'screen_shelf_r2', 'hit_library']) expect(fadeGroupOfNode(n)).toBe(SHELF)
  })
  it('desks and their screens fade with their desk', () => {
    expect(fadeGroupOfNode('desk_2_lamp')).toBe('desk2')
    // the lounge's shelf_records / shelf_wall* are not the bookshelf (a box 9 m wide kept every camera out, #277)
    for (const n of ['shelf_records', 'shelf_wall', 'shelf_wall_trophy_band']) expect(fadeGroupOfNode(n)).toBe(n)
    expect(fadeGroupOfNode('screen_work_1')).toBe('desk1')
  })
  it('lounge parts: floor-touching ones are furniture, only ones hanging by a wall plane go with it', () => {
    expect(wallOfLoose(box([3.9, 0, 0.9], [4.4, 1.3, 1.7]))).toBeNull()
    expect(wallOfLoose(box([-0.4, 1.0, -4.1], [0.4, 1.4, -4.0]))).toBe('n')
  })
})

describe('prepareView with the glb extras', () => {
  const scene = new Group()
  scene.add(mesh('shelf', 3.75, { backTo: 'n', atlas: 'wall_items' }), mesh('shelf_r0_b0', 3.5), mesh('desk_0', -2), mesh('wall_n', 0, { wall: 'n' }))
  const groups = prepareView(scene)
  it('furniture with extras backTo is one group; the shelf binders join it', () => {
    const shelf = groups.find((g) => g.id === SHELF)!
    expect(shelf.meshes.map((m) => m.name).sort()).toEqual(['shelf', 'shelf_r0_b0'])
  })
  it('the wall extra is used as is: nothing is re-tagged or split', () => {
    expect(scene.getObjectByName('wall_n')!.userData.wall).toBe('n')
    expect(scene.children).toHaveLength(4)
  })
})

describe('furniture never fades (#253)', () => {
  const scene = new Group()
  scene.add(mesh('shelf', 3.75, { backTo: 'n', atlas: 'wall_items' }), mesh('desk_0', -2), mesh('wall_n', 0, { wall: 'n' }))
  const groups = prepareView(scene)
  it('furniture keeps full opacity and no transparency, and takes clicks, with every wall lowered', () => {
    for (const w of WALLS) setWallCut(w, 0.15)
    Object.assign(WALL_HIDDEN, { n: true, e: true, s: true, w: true })
    for (const g of groups)
      for (const m of g.meshes) {
        const mat = m.material as Material
        expect(mat.opacity).toBe(1)
        expect(mat.transparent).toBe(false)
        expect(mat.alphaHash).toBe(false)
        expect(hitAllowed({ object: m, point: new Vector3(0, 1, 0) } as unknown as Intersection)).toBe(true)
      }
    // the wall itself still goes: above its lowered top a hit does not count
    const wall = scene.getObjectByName('wall_n')!
    expect(hitAllowed({ object: wall, point: new Vector3(0, 1, 0) } as unknown as Intersection)).toBe(false)
    for (const w of WALLS) setWallCut(w, VIEW.wallH)
    Object.assign(WALL_HIDDEN, NONE_HIDDEN)
  })
})

describe('room geometry (room.ts)', () => {
  it('defaults match the glb: 4.8 x 4.1, walls 2.6 m', () => {
    expect(floorRect()).toEqual({ minX: -4.8, maxX: 4.8, minZ: -4.1, maxZ: 4.1 })
    expect(VIEW.wallH).toBe(2.6)
  })
  it('reads the room extras, rejects junk', () => {
    expect(setRoomFromExtras([5, 4, 3])).toBe(true)
    expect(VIEW.floor.maxX).toBe(5)
    expect(VIEW.wallH).toBe(3)
    expect(setRoomFromExtras([5, 'x', 3])).toBe(false)
    expect(setRoomFromExtras(undefined)).toBe(false)
    setRoomFromExtras([4.8, 4.1, 2.6])
    expect(ROOM).toEqual({ hx: 4.8, hz: 4.1, wallH: 2.6 })
  })
  it('each wall cap sits just outside the floor edge', () => {
    expect(wallRect('n').cz).toBeLessThan(-4.1)
    expect(wallRect('e').cx).toBeGreaterThan(4.8)
  })
})
