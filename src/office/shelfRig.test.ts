import { BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupLibrary, shelfLayout, DONE_DARKEN, darken, type CoverSource, coverOf } from '../docs/library'
import { TOPIC_COLORS } from '../docs/topics'
import { PULL_M, ShelfRig, TAG, plateText } from './shelfRig'

// the rig only needs a canvas that takes drawing calls: record the plates' text
const drawn: string[] = []
const fakeCtx = () => ({ fillRect() {}, fillText: (t: string) => drawn.push(t), set fillStyle(_: string) {}, set font(_: string) {}, set textAlign(_: string) {}, set textBaseline(_: string) {} })

beforeEach(() => {
  drawn.length = 0
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: fakeCtx }), fonts: undefined })
})
afterEach(() => vi.unstubAllGlobals())

function mesh(name: string, mat: MeshStandardMaterial | MeshBasicMaterial, userData: Record<string, unknown> = {}, x = 0): Mesh {
  const m = new Mesh(new BoxGeometry(0.045, 0.15, 0.2), mat)
  m.name = name
  m.position.set(x, 1, -3.76)
  m.userData = userData
  return m
}

/** a glb like the baked one: 3 rows x 21 binders (extras shelf = row, slot, label cell [k, r]), three row plates; `bare` leaves the extras out (the names say the same) */
function nodes63(bare = false): Record<string, Object3D> {
  const out: Record<string, Object3D> = {}
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 21; k++) {
      const stem = `shelf_r${r}_b${k}`
      const cover = new MeshStandardMaterial({ color: '#1c2a44' })
      cover.name = 'binder_cover'
      const x = 2.9455 + k * 0.049
      out[stem] = mesh(stem, cover, bare ? {} : { shelf: r, slot: k }, x)
      out[`${stem}_band`] = mesh(`${stem}_band`, new MeshStandardMaterial({ color: '#888888' }), {}, x)
      out[`${stem}_label`] = mesh(`${stem}_label`, new MeshStandardMaterial(), bare ? {} : { canvas: 'spines', grid: [21, 3], px: [1344, 384], cell: [k, r] }, x)
      out[`${stem}_secret`] = mesh(`${stem}_secret`, new MeshStandardMaterial(), {}, x)
    }
    out[`screen_shelf_r${r}`] = mesh(`screen_shelf_r${r}`, new MeshBasicMaterial(), bare ? {} : { aspect: 8.5714 })
  }
  return out
}

const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}T00:00:00Z`
const row = (id: number, o: Partial<CoverSource> = {}): CoverSource => ({ id, kind: 'plan', repo: 'o/agent-office', folder: id, title: 't', agents: [1], grade: 'public', approved: true, created_at: day(id), updated_at: day(id), ...o })
const layoutOf = (rows: CoverSource[]) => shelfLayout(groupLibrary(rows.map(coverOf)))

describe('ShelfRig reads the glb', () => {
  it('three rows of 21 places, from the extras (and from the names when the extras are missing)', () => {
    expect(new ShelfRig(nodes63()).shape).toEqual([21, 21, 21])
    expect(new ShelfRig(nodes63(true)).shape).toEqual([21, 21, 21])
    expect(new ShelfRig(nodes63()).stemOf(1, 7)).toBe('shelf_r1_b7')
    expect(new ShelfRig(nodes63()).stemOf(2, 20)).toBe('shelf_r2_b20')
    expect(new ShelfRig(nodes63()).stemOf(0, 21)).toBeUndefined()
    expect(new ShelfRig(nodes63()).stemOf(3, 0)).toBeUndefined()
  })
  it('the extras win over the names: a binder whose extras say row 2 slot 5 stands there', () => {
    const n = nodes63()
    for (const s of ['', '_band', '_label', '_secret']) delete n[`shelf_r2_b5${s}`]
    n.shelf_r0_b0.userData = { shelf: 2, slot: 5 }
    const rig = new ShelfRig(n)
    expect(rig.stemOf(2, 5)).toBe('shelf_r0_b0')
  })
  it('a model with fewer binders (or none) still builds and clips the layout to its places', () => {
    const n = nodes63()
    for (const k of [5, 6, 20]) for (const s of ['', '_band', '_label', '_secret']) delete n[`shelf_r1_b${k}${s}`]
    const rig = new ShelfRig(n)
    expect(rig.shape).toEqual([21, 18, 21])
    rig.apply(layoutOf(Array.from({ length: 7 }, (_, i) => row(i + 1))))
    expect((n.shelf_r1_b4 as Mesh).visible).toBe(true)
    expect(() => new ShelfRig({}).apply(layoutOf([row(1)]))).not.toThrow()
  })
})

describe('ShelfRig shows the state', () => {
  const progress = (stage: string, pending = 0) => ({ stage, checks: null, pending })
  const rows = [
    row(1, { progress: progress('doing'), labels: ['feature'] }),
    row(2, { progress: progress('review', 1), labels: ['bug'] }),
    row(3, { progress: progress('done'), labels: ['feature'] }),
    row(4, { progress: progress('waiting') }),
  ]
  const hexOf = (n: Object3D) => ((n as Mesh).material as MeshStandardMaterial).color.getHexString()

  it('in progress: pulled 3 cm toward the room; the others stay in line', () => {
    const n = nodes63()
    const z0 = n.shelf_r1_b0.position.z
    new ShelfRig(n).apply(layoutOf(rows))
    expect(n.shelf_r1_b0.position.z - z0).toBeCloseTo(PULL_M, 6)
    expect(n.shelf_r1_b0_band.position.z - z0).toBeCloseTo(PULL_M, 6)
    for (const k of [1, 2, 3]) expect(n[`shelf_r1_b${k}`].position.z).toBeCloseTo(z0, 6)
  })
  it('awaiting approval: the amber tag stands on the spine (1.5 x 2.5 cm); nobody else has one', () => {
    const n = nodes63()
    new ShelfRig(n).apply(layoutOf(rows))
    const tag = (k: number) => n[`shelf_r1_b${k}_band`].children[0] as Mesh
    expect(tag(1).visible).toBe(true)
    expect(tag(1).name).toBe('shelf_r1_b1_tag')
    expect((tag(1).material as MeshBasicMaterial).color.getHexString()).toBe(TAG.color.slice(1))
    for (const k of [0, 2, 3]) expect(tag(k).visible).toBe(false)
    // the tag is a child of the band: a pulled binder takes it along
    expect(n.shelf_r1_b0_band.children[0]).toBe(tag(0))
  })
  it('spine colour is the first topic badge colour, done is 15% darker, no topic is ivory; the cover darkens when done', () => {
    const n = nodes63()
    new ShelfRig(n).apply(layoutOf(rows))
    expect(`#${hexOf(n.shelf_r1_b0_band)}`).toBe(TOPIC_COLORS.feature)
    expect(`#${hexOf(n.shelf_r1_b1_band)}`).toBe(TOPIC_COLORS.bug)
    expect(`#${hexOf(n.shelf_r1_b2_band)}`).toBe(darken(TOPIC_COLORS.feature, DONE_DARKEN))
    expect(`#${hexOf(n.shelf_r1_b3_band)}`).toBe('#e9e4d8')
    const cover = (k: number) => ((n[`shelf_r1_b${k}`] as Mesh).material as MeshStandardMaterial).color
    expect(cover(2).r).toBeCloseTo(cover(3).r * 0.85, 4)
    expect(cover(2).b).toBeLessThan(cover(3).b)
  })
  it('a binder goes to its row: the newest project on r1, the next on r2, the third on r0; the unused places stay hidden', () => {
    const n = nodes63()
    new ShelfRig(n).apply(layoutOf([row(1, { repo: 'o/c', created_at: day(1) }), row(2, { repo: 'o/b', created_at: day(2) }), row(3, { repo: 'o/a', created_at: day(3) })]))
    expect(n.shelf_r1_b0.visible).toBe(true)
    expect(n.shelf_r2_b0.visible).toBe(true)
    expect(n.shelf_r0_b0.visible).toBe(true)
    expect(n.shelf_r1_b1.visible).toBe(false)
    expect(n.shelf_r0_b14.visible).toBe(false)
  })
  it('the plates carry the project names (r0 bottom); a carried-on row says (이어서); a project with more files than its rows hold gets +N', () => {
    drawn.length = 0
    new ShelfRig(nodes63()).apply(layoutOf([...Array.from({ length: 70 }, (_, i) => row(i + 1)), row(100, { repo: 'o/rowansong.dev', created_at: day(25), folder: 1 })]))
    // rowansong.dev is newest -> r1; agent-office (70 files) -> r2, carried on to r0 (21 + 21, 28 left)
    expect(drawn).toEqual(expect.arrayContaining(['rowansong.dev', 'agent-office', 'agent-office (이어서) +28']))
    expect(plateText('a', 0)).toBe('a')
    expect(plateText('a', 4)).toBe('a +4')
    expect(plateText('', 4)).toBe('')
  })
  it('labels: a binder draws its number in the cell [k, r] of the shared canvas', () => {
    const n = nodes63()
    const rig = new ShelfRig(n)
    expect(n.shelf_r2_b3_label.userData.cell).toEqual([3, 2])
    rig.apply(layoutOf([row(1, { repo: 'o/a', created_at: day(1) }), row(2, { repo: 'o/b', created_at: day(2) }), row(3, { repo: 'o/c', created_at: day(3) })]))
    expect(drawn).toEqual(expect.arrayContaining(['#1', '#2', '#3']))
  })
  it('clicking: a shown binder is found from its body mesh, the data is the layout binder', () => {
    const n = nodes63()
    const rig = new ShelfRig(n)
    rig.apply(layoutOf(rows))
    expect(rig.binderOf(n.shelf_r1_b2)).toMatchObject({ n: 3, repo: 'o/agent-office' })
    expect(rig.binderOf(n.shelf_r1_b9)).toBeNull()
    expect(rig.binderOf(n.shelf_r0_b2)).toBeNull()
    expect(rig.visibleBodies()).toHaveLength(4)
  })
})
