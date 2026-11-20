// #663 (hologram.md 1.2) the hologram board is left out of the office bloom: it registers its root, and the bloom draws it only when it shows.
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { bloomExcluded } from './bloomExclude'
import { drawsSomething } from './holoBloom'
import { HoloBoard } from './holoBoard'

describe('the hologram left out of the bloom (#663)', () => {
  it('the board registers its root while it lives', () => {
    const scene = new Group()
    const surface = new Object3D()
    surface.userData = { lift: 0.02, size: 0.4, field: 0.44 }
    scene.add(surface)
    scene.updateMatrixWorld(true)
    const holo = new HoloBoard(scene, surface)
    expect(bloomExcluded.has(holo.root)).toBe(true)
    holo.dispose()
    expect(bloomExcluded.has(holo.root)).toBe(false)
  })
  it('a root is drawn for the subtraction only when something in it shows', () => {
    const root = new Group()
    const g = new BoxGeometry()
    const m = new MeshBasicMaterial()
    const inst = new InstancedMesh(g, m, 4)
    inst.count = 0
    root.add(inst)
    expect(drawsSomething(root)).toBe(false) // instances, none drawn
    inst.count = 2
    expect(drawsSomething(root)).toBe(true)
    inst.visible = false
    const plain = new Mesh(g, m)
    plain.visible = false
    root.add(plain)
    expect(drawsSomething(root)).toBe(false) // hidden
    plain.visible = true
    expect(drawsSomething(root)).toBe(true)
    root.visible = false
    expect(drawsSomething(root)).toBe(false)
  })
})
