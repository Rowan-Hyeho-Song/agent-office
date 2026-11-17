// HoloBoard (#538 hologram.md): geometry, grid pixels, stone meshes, on/off timing, snap, reduced motion, materials. No WebGL.
import { describe, expect, it } from 'vitest'
import { AdditiveBlending, Euler, Group, NormalBlending, Object3D, Vector3, type BufferGeometry } from 'three'
import { CELL, GRID_PX, HoloBoard, MASK, N, buildVoxelGeometry, gridPixels, type HoloInput } from './holoBoard'

function make(rot?: Euler) {
  const scene = new Group()
  const surface = new Object3D()
  surface.position.set(1.5, 0.74, -2)
  if (rot) surface.rotation.copy(rot)
  surface.userData = { lift: 0.02, size: 0.4, field: 0.44 }
  scene.add(surface)
  scene.updateMatrixWorld(true)
  return { scene, surface, holo: new HoloBoard(scene, surface) }
}
const seat = (x: number, z: number) => new Vector3(1.5 + x, 0.5, -2 + z)
const base = (o: Partial<HoloInput> = {}): HoloInput => ({
  t: 0,
  reduced: false,
  on: true,
  board: null,
  lastMove: -1,
  win: null,
  turn: null,
  players: [
    { seat: seat(0, 0.7), color: 1 },
    { seat: seat(0, -0.7), color: 2 },
  ],
  held: null,
  ...o,
})
const boardWith = (cells: Record<number, 1 | 2>) => {
  const b = new Uint8Array(N * N)
  for (const [c, v] of Object.entries(cells)) b[+c] = v
  return b
}
/** Open the board fully and return the clock after. */
function opened(holo: HoloBoard, reduced = false) {
  holo.update(base({ t: 0, reduced }))
  holo.update(base({ t: 0.5, reduced }))
  return 0.5
}

describe('cells', () => {
  it('cellPos and cellAt round trip, also on a rotated surface', () => {
    for (const rot of [undefined, new Euler(0, 0.7, 0)]) {
      const { holo } = make(rot)
      const e = rot ?? new Euler()
      for (const c of [0, 7 * N + 7, 14, 14 * N, 224, 3 * N + 11]) {
        const p = holo.cellPos(c)
        expect(holo.cellAt(p)).toBe(c)
        expect(holo.cellAt(p.clone().add(new Vector3(0.003, 0.05, 0.003).applyEuler(e)))).toBe(c)
      }
      expect(holo.cellPos(7 * N + 7).y).toBeCloseTo(0.76)
      expect(holo.planeY).toBeCloseTo(0.76)
      expect(holo.cellAt(holo.cellPos(0).add(new Vector3(-0.1, 0, 0).applyEuler(e)))).toBe(-1)
    }
  })
  it('spacing is 0.026', () => {
    const { holo } = make()
    expect(holo.cellPos(1).distanceTo(holo.cellPos(0))).toBeCloseTo(CELL)
    expect(holo.cellPos(N).distanceTo(holo.cellPos(0))).toBeCloseTo(CELL)
  })
})

describe('grid texture', () => {
  const px = gridPixels()
  const at = (x: number, y: number) => px[y * GRID_PX + x]
  it('draws lines, border, star points, empty cells', () => {
    expect(px.length).toBe(91 * 91)
    expect(at(9, 20)).toBe(191) // inner vertical line
    expect(at(20, 9)).toBe(191) // inner horizontal line
    expect(at(3, 20)).toBe(255) // left border
    expect(at(87, 20)).toBe(255)
    expect(at(20, 3)).toBe(255)
    expect(at(46, 46)).toBe(255) // H8 star corner
    expect(at(44, 44)).toBe(255)
    expect(at(22, 20)).toBe(255) // D4 star corner
    expect(at(6, 6)).toBe(0) // empty cell interior
    expect(at(0, 0)).toBe(0)
    expect(at(46, 12)).toBe(0)
  })
})

function quads(g: BufferGeometry) {
  const p = g.getAttribute('position')
  const sh = g.getAttribute('aShade')
  const ly = g.getAttribute('aLayer')
  const out: { n: Vector3; c: Vector3; shade: number; layer: number }[] = []
  for (let i = 0; i < p.count; i += 4) {
    const v = [0, 1, 2, 3].map((k) => new Vector3(p.getX(i + k), p.getY(i + k), p.getZ(i + k)))
    const n = v[1].clone().sub(v[0]).cross(v[3].clone().sub(v[0])).normalize()
    const c = v.reduce((a, b) => a.add(b), new Vector3()).multiplyScalar(0.25)
    out.push({ n, c, shade: sh.getX(i), layer: ly.getX(i) })
  }
  return out
}

describe('stone geometry', () => {
  const q = quads(buildVoxelGeometry(2, false))
  const set = new Set<string>()
  MASK.forEach((row, z) => [...row].forEach((ch, x) => ch === '#' && set.add(`${x},${z}`)))
  it('has the 52 pixel footprint on the top layer and cap', () => {
    expect(set.size).toBe(52)
    const tops = q.filter((f) => Math.abs(f.n.y) > 0.9)
    expect(tops.filter((f) => f.layer === 1).length).toBe(52)
    expect(tops.filter((f) => f.layer === -1).length).toBe(52)
    expect(tops.filter((f) => f.layer === 1).every((f) => f.shade === 1)).toBe(true)
  })
  it('has no face between neighbouring voxels, and brightness by direction', () => {
    const sides = q.filter((f) => Math.abs(f.n.y) < 0.1)
    for (const f of sides) {
      const x = Math.round(f.c.x / 0.0028 + 3.5)
      const z = Math.round(f.c.z / 0.0028 + 3.5)
      const nx = Math.abs(f.n.x) > 0.9 ? Math.sign(f.c.x - (x - 3.5) * 0.0028) : 0
      const nz = Math.abs(f.n.z) > 0.9 ? Math.sign(f.c.z - (z - 3.5) * 0.0028) : 0
      expect(set.has(`${x},${z}`)).toBe(true)
      expect(set.has(`${x + nx},${z + nz}`)).toBe(false)
      expect(f.shade).toBeCloseTo(nx ? 0.5 : 0.7)
    }
    let edges = 0
    for (const k of set) {
      const [x, z] = k.split(',').map(Number)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has(`${x + dx},${z + dz}`)) edges++
    }
    expect(sides.length).toBe(edges * 2)
  })
  it('founts are a one-layer ring of edge pixels', () => {
    const r = quads(buildVoxelGeometry(1, true)).filter((f) => Math.abs(f.n.y) > 0.9)
    expect(r.length).toBeLessThan(52)
    expect(r.length).toBe(20)
  })
})

describe('update', () => {
  it('instance counts follow the board and landed is reported once', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = boardWith({ 112: 1, 113: 2 })
    expect(holo.update(base({ t: t + 0.1, board: b })).landed).toEqual([112, 113])
    expect(holo.stones[1].count).toBe(1)
    expect(holo.stones[2].count).toBe(1)
    expect(holo.glow.count).toBe(2)
    expect(holo.update(base({ t: t + 0.2, board: b })).landed).toEqual([])
    expect(holo.update(base({ t: t + 0.3, board: boardWith({ 112: 1, 113: 2, 5: 1 }) })).landed).toEqual([5])
    expect(holo.stones[1].count).toBe(2)
  })
  it('on/off timing', () => {
    const { holo } = make()
    expect(holo.update(base({ t: 0 })).boardOnStart).toBe(true)
    expect(holo.update(base({ t: 0.1 })).boardOnStart).toBe(false)
    expect(holo.state).toBe('open')
    holo.update(base({ t: 0.31 }))
    expect(holo.state).toBe('on')
    holo.update(base({ t: 0.4, board: boardWith({ 112: 1 }) }))
    expect(holo.stones[1].count).toBe(1)
    const off = (t: number) => holo.update(base({ t, on: false, board: null }))
    expect(off(1).boardOffStart).toBe(false)
    expect(holo.state).toBe('wait')
    expect(holo.stones[1].count).toBe(1)
    expect(off(1.1).boardOffStart).toBe(false)
    expect(off(1.16).boardOffStart).toBe(true)
    expect(holo.stones[1].count).toBe(0)
    expect(holo.state).toBe('fold')
    expect(off(1.2).boardOffStart).toBe(false)
    off(1.37)
    expect(holo.state).toBe('line')
    expect(off(1.5).boardOn).toBe(false)
    expect(holo.state).toBe('off')
  })
  it('off with no stones folds at once', () => {
    const { holo } = make()
    opened(holo)
    expect(holo.update(base({ t: 1, on: false })).boardOffStart).toBe(true)
  })
  it('snap draws the end state without events', () => {
    const { holo } = make()
    const r = holo.update(base({ t: 5, snap: true, board: boardWith({ 112: 1, 0: 2 }), lastMove: 112 }))
    expect(r.boardOnStart).toBe(false)
    expect(r.landed).toEqual([])
    expect(r.boardOn).toBe(true)
    expect(holo.state).toBe('on')
    expect(holo.stones[1].count + holo.stones[2].count).toBe(2)
    expect(holo.dots.count).toBe(1)
    expect(holo.marks.count).toBe(0)
    holo.update(base({ t: 6, snap: true, on: false }))
    expect(holo.state).toBe('off')
  })
  it('ripple on landing, none in reduced motion', () => {
    const a = make()
    let t = opened(a.holo)
    a.holo.update(base({ t: t + 0.1, board: boardWith({ 112: 1 }) }))
    expect(a.holo.marks.count).toBe(4)
    a.holo.update(base({ t: t + 0.5, board: boardWith({ 112: 1 }) }))
    expect(a.holo.marks.count).toBe(0)
    const b = make()
    t = opened(b.holo, true)
    b.holo.update(base({ t: t + 0.1, reduced: true, board: boardWith({ 112: 1 }) }))
    b.holo.update(base({ t: t + 0.15, reduced: true, board: boardWith({ 112: 1 }) }))
    expect(b.holo.stones[1].count).toBe(1)
    expect(b.holo.marks.count).toBe(0)
  })
  it('new game wipes stones row by row', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = boardWith({ 0: 1, 224: 2 })
    holo.update(base({ t: t + 0.1, board: b }))
    holo.update(base({ t: t + 1, board: b }))
    holo.update(base({ t: t + 2, board: null, newGame: true }))
    expect(holo.stones[1].count + holo.stones[2].count).toBe(2)
    holo.update(base({ t: t + 2.6, board: null }))
    expect(holo.stones[1].count + holo.stones[2].count).toBe(0)
    expect(holo.state).toBe('on')
  })
  it('turn line, founts, win line, held stone', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = boardWith({ 110: 1, 111: 1, 112: 1, 113: 1, 114: 1 })
    holo.update(base({ t: t + 1, board: b, turn: 2 }))
    expect(holo.marks.count).toBe(1 + 4 * 5) // turn line + five ripples
    holo.update(base({ t: t + 2, board: b, turn: 2, held: { pos: holo.cellPos(0).add(new Vector3(0, 0.03, 0)), color: 2, since: t + 1.9 } }))
    expect(holo.marks.count).toBe(1)
    expect(holo.founts.count).toBe(2)
    expect(holo.stones[2].count).toBe(1)
    const win = { line: [110, 111, 112, 113, 114], color: 1 as const }
    holo.update(base({ t: t + 3, board: b, turn: null, win }))
    holo.update(base({ t: t + 3.2, board: b, turn: null, win }))
    expect(holo.marks.count).toBe(1) // win line only
    expect(holo.stones[1].count).toBe(5)
  })
})

describe('materials', () => {
  it('lights are additive, unlit, no depth write; only the dot is normal blended', () => {
    const { holo } = make()
    for (const k of ['grid', 'stone', 'glow', 'fount', 'marks'] as const) {
      const m = holo.materials[k]
      expect(m.blending).toBe(AdditiveBlending)
      expect(m.depthWrite).toBe(false)
      expect(m.toneMapped).toBe(false)
    }
    expect(holo.materials.dot.blending).toBe(NormalBlending)
    expect(holo.materials.dot.toneMapped).toBe(false)
    expect(holo.materials.film.toneMapped).toBe(false)
    expect(holo.film.renderOrder).toBe(-1)
    expect(holo.dots.renderOrder).toBeGreaterThan(holo.stones[1].renderOrder)
    // the film 1 mm under the light plane, which is lift over the surface; the grid on the plane
    expect(holo.film.position.y).toBeCloseTo(0.02 - 0.001, 6)
    expect(holo.grid.position.y).toBeCloseTo(0.02, 6)
  })
})
