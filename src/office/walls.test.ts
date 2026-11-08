import { BoxGeometry, Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SHELF, fadeGroupOfNode, prepareView, wallOfLoose } from './walls'
import { backToOpacity, NONE_HIDDEN, VIEW } from './view'
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
    for (const n of ['shelf_r0_b0', 'shelf_r2_b9_label', 'screen_shelf_r1', 'hit_library']) expect(fadeGroupOfNode(n)).toBe(SHELF)
  })
  it('desks and their screens fade with their desk', () => {
    expect(fadeGroupOfNode('desk_2_lamp')).toBe('desk2')
    expect(fadeGroupOfNode('screen_work_1')).toBe('desk1')
  })
  it('lounge parts: floor-touching ones are furniture, only ones hanging by a wall plane go with it', () => {
    expect(wallOfLoose(box([3.9, 0, 0.9], [4.4, 1.3, 1.7]))).toBeNull()
    expect(wallOfLoose(box([-0.4, 1.0, -3.5], [0.4, 1.4, -3.4]))).toBe('n')
  })
})

describe('prepareView with the glb extras', () => {
  const scene = new Group()
  scene.add(mesh('shelf', 3.75, { backTo: 'n', atlas: 'wall_items' }), mesh('shelf_r0_b0', 3.5), mesh('desk_0', -2), mesh('wall_n', 0, { wall: 'n' }))
  const groups = prepareView(scene)
  it('furniture with extras backTo is a group that knows its wall; the shelf binders join it', () => {
    const shelf = groups.find((g) => g.id === SHELF)!
    expect(shelf.backTo).toBe('n')
    expect(shelf.meshes.map((m) => m.name).sort()).toEqual(['shelf', 'shelf_r0_b0'])
  })
  it('furniture without backTo (desks, the coffee counter) is unaffected', () => {
    expect(groups.find((g) => g.id === 'desk0')!.backTo).toBeUndefined()
  })
  it('the wall extra is used as is: nothing is re-tagged or split', () => {
    expect(scene.getObjectByName('wall_n')!.userData.wall).toBe('n')
    expect(scene.children).toHaveLength(4)
  })
})

describe('backTo fade', () => {
  it('goes to the minimum while its wall is lowered, untouched while it stands', () => {
    expect(backToOpacity(1, 'n', { ...NONE_HIDDEN, n: true })).toBe(VIEW.near.minOpacity)
    expect(backToOpacity(1, 'n', { ...NONE_HIDDEN, s: true })).toBe(1)
    expect(backToOpacity(1, 'n', NONE_HIDDEN)).toBe(1)
    expect(backToOpacity(1, undefined, { n: true, e: true, s: true, w: true })).toBe(1)
  })
  it('never raises a near-faded object', () => {
    expect(backToOpacity(0.1, 'n', { ...NONE_HIDDEN, n: true })).toBe(0.1)
  })
})

describe('room geometry (room.ts)', () => {
  it('defaults match the glb: 4.5 x 3.5, walls 2.6 m', () => {
    expect(floorRect()).toEqual({ minX: -4.5, maxX: 4.5, minZ: -3.5, maxZ: 3.5 })
    expect(VIEW.wallH).toBe(2.6)
  })
  it('reads the room extras, rejects junk', () => {
    expect(setRoomFromExtras([5, 4, 3])).toBe(true)
    expect(VIEW.floor.maxX).toBe(5)
    expect(VIEW.wallH).toBe(3)
    expect(setRoomFromExtras([5, 'x', 3])).toBe(false)
    expect(setRoomFromExtras(undefined)).toBe(false)
    setRoomFromExtras([4.5, 3.5, 2.6])
    expect(ROOM).toEqual({ hx: 4.5, hz: 3.5, wallH: 2.6 })
  })
  it('each wall cap sits just outside the floor edge', () => {
    expect(wallRect('n').cz).toBeLessThan(-3.5)
    expect(wallRect('e').cx).toBeGreaterThan(4.5)
  })
})
