// Hologram alkkagi layer (#605 stage 1b, hologram.md 12): board pixels, stone geometry, engine <-> world, instances, hits, falling off, the aim dotted
// line, end looks, reduced motion, determinism. No WebGL.
import { describe, expect, it } from 'vitest'
import { Color, Euler, Group, Object3D, Vector3, type InstancedBufferAttribute, type InstancedMesh } from 'three'
import { HoloBoard, type HoloInput } from './holoBoard'
import {
  ABOX,
  ALK_EDGE,
  ALK_FOOTPRINT,
  ALK_MAX_SPEED,
  ALK_PX,
  ALK_RADIUS,
  AVOX,
  LINE,
  PXA,
  alkPixels,
  buildStoneGeometry,
  type AlkAim,
  type AlkInput,
  type AlkStone,
} from './holoAlkkagi'
import { ALK, startPosition } from '../play/alkkagi'

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
// side 0 = cyan = colour 1 sits at -z, so engine y < 0 is toward -z
const players = [
  { seat: seat(0, -0.7), color: 1 as const },
  { seat: seat(0, 0.7), color: 2 as const },
]
const stones = (): AlkStone[] => startPosition().stones.map((s) => ({ ...s }))
const ai = (o: Partial<AlkInput> = {}): AlkInput => ({ stones: stones(), hits: [], outs: [], aim: null, end: null, ...o })
const frame = (t: number, a: AlkInput | undefined, o: Partial<HoloInput> = {}): HoloInput => ({
  t,
  reduced: false,
  on: true,
  board: null,
  lastMove: -1,
  win: null,
  turn: null,
  players,
  held: null,
  game: 'alkkagi',
  alkkagi: a,
  ...o,
})
/** open the board and return a clock after it is fully on */
function opened(holo: HoloBoard, a = ai(), reduced = false) {
  holo.update(frame(0, a, { reduced }))
  holo.update(frame(0.5, a, { reduced }))
  return 0.5
}
const arr = (m: InstancedMesh, name: string) => (m.geometry.getAttribute(name) as InstancedBufferAttribute).array as Float32Array
const sm = (h: HoloBoard) => h.alkLayer!.stones
const bright = (h: HoloBoard, i: number) => arr(sm(h), 'iSt')[i * 4 + 1]
const rows = (h: HoloBoard, i: number) => arr(sm(h), 'iSt')[i * 4 + 3]
const alphaOf = (h: HoloBoard, i: number) => arr(sm(h), 'iSt')[i * 4 + 2]
const layersOf = (h: HoloBoard, i: number) => arr(sm(h), 'iSt')[i * 4]

describe('constants', () => {
  it('match the engine', () => {
    expect(ALK_EDGE).toBe(ALK.edge)
    expect(ALK_RADIUS).toBe(ALK.radius)
    expect(ALK_MAX_SPEED).toBe(ALK.maxSpeed)
  })
})

describe('board pixels', () => {
  const px = alkPixels()
  const at = (x: number, y: number) => px[y * ALK_PX + x]
  it('draws the edge border at 1.0, outer lines 0.6, inner lines 0.35, no star points', () => {
    expect(px.length).toBe(ALK_PX * ALK_PX)
    expect(ALK_PX).toBe(117)
    expect(ALK_PX * PXA).toBeCloseTo(0.39)
    for (let k = 0; k < ALK_PX; k++) {
      expect(at(0, k)).toBe(255)
      expect(at(ALK_PX - 1, k)).toBe(255)
      expect(at(k, 0)).toBe(255)
      expect(at(k, ALK_PX - 1)).toBe(255)
    }
    // lines every 6 px from 4 to 112, centre line at 58
    expect(at(4, 61)).toBe(153) // outer line, between crossings
    expect(at(112, 61)).toBe(153)
    expect(at(61, 4)).toBe(153)
    expect(at(10, 61)).toBe(89) // inner line 0.35
    expect(at(58, 61)).toBe(89)
    expect(at(61, 58)).toBe(89)
    // the board edge is the border, 0.192 m, within a pixel
    expect(Math.abs(58 * PXA - 0.192)).toBeLessThan(PXA)
    // between lines, and no star point: the 3x3 around the centre crossing is just the line
    expect(at(61, 61)).toBe(0)
    expect(at(57, 57)).toBe(0)
    expect(at(59, 57)).toBe(0)
    expect(at(2, 61)).toBe(0) // between the border and the outer line
    const lit = px.filter((v) => v > 0).length
    // 19 + 19 lines of 109 px minus the 361 crossings counted twice, plus the border minus its overlap with nothing else
    expect(lit).toBe(2 * 19 * 109 - 361 + (4 * 117 - 4))
  })
})

describe('stone geometry', () => {
  it('is the 8x8 disc, 52 voxels x 2 layers, 2.3 mm voxels', () => {
    expect(ALK_FOOTPRINT).toBe(52)
    expect(AVOX).toBe(0.0023)
    const g = buildStoneGeometry()
    const pos = g.getAttribute('position')
    const sh = g.getAttribute('aShade')
    const layer = g.getAttribute('aLayer')
    let tops = 0
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      minX = Math.min(minX, pos.getX(i))
      maxX = Math.max(maxX, pos.getX(i))
      minY = Math.min(minY, pos.getY(i))
      maxY = Math.max(maxY, pos.getY(i))
      if (i % 4 === 0 && sh.getX(i) === 1) tops++
    }
    expect(tops).toBe(52 * 2) // one top per voxel per layer
    // the lower layer's tops are the hidden-while-two-layers caps
    let caps = 0
    for (let i = 0; i < pos.count; i += 4) if (sh.getX(i) === 1 && layer.getX(i) < 0) caps++
    expect(caps).toBe(52)
    // diameter 8 voxels (1.84 cm), thickness 2 voxels (4.6 mm)
    expect(maxX - minX).toBeCloseTo(7 * AVOX + ABOX * AVOX, 6)
    expect(maxY - minY).toBeCloseTo(AVOX + ABOX * AVOX, 6)
    expect(8 * AVOX).toBeCloseTo(2 * ALK_RADIUS * LINE, 4)
    for (let i = 0; i < sh.count; i++) expect([1, 0.7, 0.5].some((v) => Math.abs(v - sh.getX(i)) < 1e-6)).toBe(true)
  })
})

describe('engine <-> world', () => {
  it('alkPos and alkAt round trip, also rotated', () => {
    for (const rot of [undefined, new Euler(0, 0.7, 0)]) {
      for (const [sx, sz] of [[0, -0.7], [0, 0.7], [0.7, 0], [-0.7, 0]]) {
        const { holo } = make(rot)
        const e = rot ?? new Euler()
        const o = new Vector3(1.5, 0.74, -2)
        const ps = [{ seat: seat(sx, sz).sub(o).applyEuler(e).add(o), color: 1 as const }, { seat: seat(-sx, -sz).sub(o).applyEuler(e).add(o), color: 2 as const }]
        holo.update(frame(0, ai(), { players: ps }))
        for (const [x, y] of [[0, 0], [3, -6], [-9.6, 9.6], [2.5, 7.25]]) {
          const w = holo.alkPos(x, y)
          const b = holo.alkAt(w)
          expect(b.x).toBeCloseTo(x, 6)
          expect(b.y).toBeCloseTo(y, 6)
          expect(holo.alkAt(w.clone().add(new Vector3(0, 0.05, 0)))).toEqual(b)
        }
        expect(holo.alkPos(0, 0).distanceTo(holo.alkPos(1, 0))).toBeCloseTo(LINE)
        expect(holo.alkPos(0, 0).distanceTo(holo.alkPos(0, 1))).toBeCloseTo(LINE)
        expect(holo.alkPos(0, 0).y).toBeCloseTo(0.76)
        // side 0's seat (cyan, colour 1) is on engine y < 0: the stones of side 0 are nearer to it than the other side's
        expect(holo.alkPos(0, -6).distanceTo(ps[0].seat)).toBeLessThan(holo.alkPos(0, 6).distanceTo(ps[0].seat))
      }
    }
  })
  it('puts engine y < 0 on the cyan seat side; the other seat alone is used negated', () => {
    const { holo } = make()
    holo.update(frame(0, ai()))
    expect(holo.alkPos(0, -6).z).toBeLessThan(holo.alkPos(0, 6).z) // cyan at -z
    // x is to the player's right: at -z looking +z, right is -x
    expect(holo.alkPos(1, 0).x).toBeLessThan(holo.alkPos(-1, 0).x)
    holo.update(frame(0.1, ai(), { players: [players[1]] }))
    expect(holo.alkPos(0, -6).z).toBeLessThan(holo.alkPos(0, 6).z)
    const { holo: h2 } = make()
    h2.update(frame(0, ai(), { players: [] }))
    expect(h2.alkPos(0, -6).z).toBeGreaterThan(h2.alkPos(0, 6).z) // no seat: side 0 near +z
  })
})

describe('stones', () => {
  it('draw one instance per stone that is not out, 2 layers, side colours, glow', () => {
    const { holo } = make()
    opened(holo)
    expect(sm(holo).count).toBe(10)
    expect(layersOf(holo, 0)).toBe(2)
    expect(bright(holo, 0)).toBeCloseTo(0.9)
    const col = arr(sm(holo), 'iCol')
    expect(col[0]).toBeCloseTo(new Color('#4df3ff').r, 4) // side 0 cyan (linear)
    expect(col[5 * 3]).toBeCloseTo(new Color('#f3ead8').r, 4) // side 1 ivory
    expect(holo.glow.count).toBe(10)
    const pos = arr(sm(holo), 'iPos')
    const w = holo.alkPos(-4, -6)
    expect(pos[0]).toBeCloseTo(w.x - 1.5, 5) // surface frame
    expect(pos[2]).toBeCloseTo(w.z + 2, 5)
    expect(pos[1]).toBeCloseTo(0.0205, 6)
    const a = ai()
    a.stones[3].out = true
    a.stones[7].out = true
    holo.update(frame(0.6, a))
    expect(sm(holo).count).toBe(8)
    expect(holo.glow.count).toBe(8)
    expect(holo.marks.count).toBe(0) // no turn, no ripple
    expect(holo.founts.count).toBe(0)
    expect(holo.dots.count).toBe(0)
  })
  it('swaps the board mesh with the game and leaves the omok meshes empty', () => {
    const { holo } = make()
    opened(holo)
    expect(holo.grid.visible).toBe(false)
    expect(holo.alkLayer!.grid.visible).toBe(true)
    expect(holo.stones[1].count + holo.stones[2].count).toBe(0)
    holo.update(frame(0.6, undefined, { game: 'omok', alkkagi: undefined }))
    expect(holo.grid.visible).toBe(true)
    expect(holo.alkLayer!.grid.visible).toBe(false)
    expect(sm(holo).count).toBe(0)
  })
  it('draws the turn line on the side whose turn it is', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(0.6, ai(), { turn: 1 }))
    expect(holo.marks.count).toBe(1)
    const z0 = arr(holo.marks, 'iPos')[2]
    holo.update(frame(0.7, ai(), { turn: 2 }))
    expect(holo.marks.count).toBe(1)
    expect(arr(holo.marks, 'iPos')[2]).toBeCloseTo(-z0)
  })
})

describe('hits', () => {
  const hit = (speed: number, at = 1) => ai({ hits: [{ a: 0, b: 5, speed, at }] })
  it('brighten both stones with the speed (1.4 at max) and return over 0.12 s', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(1, hit(ALK.maxSpeed)))
    expect(bright(holo, 0)).toBeCloseTo(1.4)
    expect(bright(holo, 5)).toBeCloseTo(1.4)
    expect(bright(holo, 1)).toBeCloseTo(0.9)
    holo.update(frame(1.06, hit(ALK.maxSpeed)))
    expect(bright(holo, 0)).toBeCloseTo(1.15)
    holo.update(frame(1.12, hit(ALK.maxSpeed)))
    expect(bright(holo, 0)).toBeCloseTo(0.9)
    holo.update(frame(0.99, hit(ALK.maxSpeed))) // before the hit
    expect(bright(holo, 0)).toBeCloseTo(0.9)
    holo.update(frame(1, hit(ALK.maxSpeed / 2)))
    expect(bright(holo, 0)).toBeCloseTo(1.15)
    holo.update(frame(1, hit(100)))
    expect(bright(holo, 0)).toBeCloseTo(1.4) // clamped
  })
  it('takes the strongest of several hits and ignores repeats of the same one', () => {
    const { holo } = make()
    opened(holo)
    const a = ai({ hits: [{ a: 0, b: 5, speed: 5, at: 1 }, { a: 0, b: 5, speed: 5, at: 1 }, { a: 0, b: 1, speed: 26, at: 1.05 }] })
    holo.update(frame(1.06, a))
    expect(bright(holo, 0)).toBeGreaterThan(1.3)
    expect(bright(holo, 5)).toBeLessThan(1.2)
    expect(sm(holo).count).toBe(10)
  })
  it('does not flash in reduced motion', () => {
    const { holo } = make()
    opened(holo, ai(), true)
    holo.update(frame(1, hit(ALK.maxSpeed), { reduced: true }))
    expect(bright(holo, 0)).toBeCloseTo(0.9)
  })
})

describe('falling off', () => {
  const fall = (dir = { x: 0, y: 1 }) => {
    const a = ai({ outs: [{ a: 7, at: 1, dir }] })
    a.stones[7] = { ...a.stones[7], x: 1, y: 9.6, out: true }
    return a
  }
  it('scatters in stair steps over 0.3 s, then is gone', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(1, fall()))
    expect(sm(holo).count).toBe(10) // 9 on the board and the falling one
    const i = 9
    expect(rows(holo, i)).toBe(8)
    expect(arr(sm(holo), 'iDir')[i * 3 + 2]).toBe(0) // whole at the crossing frame
    holo.update(frame(1.1, fall()))
    expect(rows(holo, i)).toBe(6)
    expect(arr(sm(holo), 'iDir')[i * 3 + 2]).toBe(1)
    // the shift runs along the direction of travel on the surface (engine +y)
    const w = holo.alkPos(0, 1).sub(holo.alkPos(0, 0))
    const d = arr(sm(holo), 'iDir')
    expect(d[i * 3]).toBeCloseTo(w.x / LINE, 5)
    expect(d[i * 3 + 1]).toBeCloseTo(w.z / LINE, 5)
    holo.update(frame(1.2, fall()))
    expect(rows(holo, i)).toBe(3)
    holo.update(frame(1.29, fall()))
    expect(rows(holo, i)).toBe(1)
    expect(holo.glow.count).toBe(10)
    holo.update(frame(1.3, fall()))
    expect(sm(holo).count).toBe(9)
    holo.update(frame(2, fall()))
    expect(sm(holo).count).toBe(9)
    expect(holo.glow.count).toBe(9)
    // the stone sat where it crossed: its centre is kept even if the caller moves it afterwards
    const a = fall()
    a.outs[0].at = 3
    holo.update(frame(3.05, a))
    const px = arr(sm(holo), 'iPos')[9 * 3]
    a.stones[7].x = 5
    holo.update(frame(3.06, a))
    expect(arr(sm(holo), 'iPos')[9 * 3]).toBeCloseTo(px, 9)
  })
  it('is only a 0.1 s fade in reduced motion', () => {
    const { holo } = make()
    opened(holo, ai(), true)
    holo.update(frame(1, fall(), { reduced: true }))
    expect(alphaOf(holo, 9)).toBeCloseTo(1)
    expect(rows(holo, 9)).toBe(8)
    holo.update(frame(1.05, fall(), { reduced: true }))
    expect(alphaOf(holo, 9)).toBeCloseTo(0.5)
    expect(rows(holo, 9)).toBe(8)
    expect(arr(sm(holo), 'iDir')[9 * 3 + 2]).toBe(0)
    holo.update(frame(1.1, fall(), { reduced: true }))
    expect(sm(holo).count).toBe(9)
  })
  it('an out stone with no event is not drawn at all', () => {
    const { holo } = make()
    opened(holo)
    const a = ai()
    a.stones[2].out = true
    holo.update(frame(0.6, a))
    expect(sm(holo).count).toBe(9)
  })
})

describe('aim line', () => {
  const aim = (power: number, grow = 1, o: Partial<AlkAim> = {}): AlkAim => ({ stone: 0, dx: 0, dy: 1, power, grow, ...o })
  const dots = (h: HoloBoard) => h.marks.count
  it('draws one 2 px dot per line, 6 lines at 1000 and one dot at 1', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(0.6, ai({ aim: aim(1000) })))
    expect(dots(holo)).toBe(6)
    const m = arr(holo.marks, 'iPos')
    const sz = arr(holo.marks, 'iSize')
    expect(sz[0]).toBeCloseTo(2 * PXA)
    expect(sz[1]).toBeCloseTo(2 * PXA)
    const col = arr(holo.marks, 'iCol')
    expect(col[0]).toBeCloseTo(new Color('#4df3ff').r * 0.6, 4) // side 0 cyan at 0.6
    // one line apart (snapped to texture pixels, so within a pixel), starting one line from the stone
    for (let k = 1; k < 6; k++) expect(Math.abs(Math.abs(m[k * 3 + 2] - m[(k - 1) * 3 + 2]) - LINE)).toBeLessThanOrEqual(PXA)
    const w0 = holo.alkPos(-4, -6)
    // cyan at -z: engine +y runs toward +z
    expect(Math.abs(m[2] - (w0.z + 2 + LINE))).toBeLessThanOrEqual(PXA)
    holo.update(frame(0.7, ai({ aim: aim(1) })))
    expect(dots(holo)).toBe(1)
    holo.update(frame(0.8, ai({ aim: aim(500) })))
    expect(dots(holo)).toBe(3)
    holo.update(frame(0.9, ai({ aim: aim(1000, 1, { dx: 3, dy: 4 }) })))
    expect(dots(holo)).toBe(6)
    holo.update(frame(1, ai({ aim: null })))
    expect(dots(holo)).toBe(0)
  })
  it('grows while aiming, and is drawn in full at once in reduced motion', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(0.6, ai({ aim: aim(1000, 0) })))
    expect(dots(holo)).toBe(0)
    holo.update(frame(0.6, ai({ aim: aim(1000, 0.4) })))
    expect(dots(holo)).toBe(3)
    holo.update(frame(0.6, ai({ aim: aim(1000, 1) })))
    expect(dots(holo)).toBe(6)
    holo.update(frame(0.7, ai({ aim: aim(1000, 0.2) }), { reduced: true }))
    expect(dots(holo)).toBe(6)
  })
  it('takes the colour of the stone and ignores a missing or zero-direction aim', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(0.6, ai({ aim: aim(1000, 1, { stone: 5 }) })))
    expect(arr(holo.marks, 'iCol')[0]).toBeCloseTo(new Color('#f3ead8').r * 0.6, 4)
    holo.update(frame(0.7, ai({ aim: aim(1000, 1, { stone: 99 }) })))
    expect(dots(holo)).toBe(0)
    holo.update(frame(0.7, ai({ aim: aim(1000, 1, { dx: 0, dy: 0 }) })))
    expect(dots(holo)).toBe(0)
  })
})

describe('end looks', () => {
  it('lights the winner side 1.3 for 2 s, only its remaining stones', () => {
    const { holo } = make()
    opened(holo)
    const a = ai({ end: { winner: 1, since: 2 } })
    a.stones[0].out = true
    a.stones[5].out = true
    holo.update(frame(1.9, a))
    expect(bright(holo, 0)).toBeCloseTo(0.9)
    holo.update(frame(2, a))
    expect(sm(holo).count).toBe(8)
    expect(bright(holo, 0)).toBeCloseTo(0.9) // side 0
    expect(bright(holo, 4)).toBeCloseTo(1.3) // side 1 (first of the 4 left)
    expect(bright(holo, 7)).toBeCloseTo(1.3)
    holo.update(frame(3.99, a))
    expect(bright(holo, 7)).toBeCloseTo(1.3)
    holo.update(frame(4, a))
    expect(bright(holo, 7)).toBeCloseTo(0.9)
  })
  it('dims every stone to 0.6 for 1 s on a draw', () => {
    const { holo } = make()
    opened(holo)
    const a = ai({ end: { winner: null, since: 2 } })
    holo.update(frame(2.5, a))
    for (let i = 0; i < 10; i++) expect(bright(holo, i)).toBeCloseTo(0.6)
    holo.update(frame(3, a))
    for (let i = 0; i < 10; i++) expect(bright(holo, i)).toBeCloseTo(0.9)
  })
  it('wins over a hit flash while it lasts', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(2.01, ai({ end: { winner: 0, since: 2 }, hits: [{ a: 0, b: 1, speed: 26, at: 2 }] })))
    expect(bright(holo, 0)).toBeCloseTo(1.3)
  })
})

describe('board on and off', () => {
  it('stones appear with the board and vanish layer by layer when it folds', () => {
    const { holo } = make()
    const r0 = holo.update(frame(0, ai()))
    expect(r0.boardOnStart).toBe(true)
    holo.update(frame(0.1, ai()))
    expect(sm(holo).count).toBe(0) // the film opens first
    holo.update(frame(0.5, ai()))
    expect(sm(holo).count).toBe(10)
    holo.update(frame(1, ai(), { on: false }))
    expect(layersOf(holo, 0)).toBe(2)
    holo.update(frame(1.08, ai(), { on: false }))
    expect(layersOf(holo, 0)).toBe(1)
    holo.update(frame(1.2, ai(), { on: false }))
    expect(sm(holo).count).toBe(0)
    holo.update(frame(2, ai(), { on: false }))
    expect(holo.state).toBe('off')
  })
  it('fades 0.1 s when reduced', () => {
    const { holo } = make()
    opened(holo, ai(), true)
    holo.update(frame(1, ai(), { on: false, reduced: true }))
    holo.update(frame(1.05, ai(), { on: false, reduced: true }))
    expect(alphaOf(holo, 0)).toBeCloseTo(0.5)
    expect(layersOf(holo, 0)).toBe(2)
    holo.update(frame(1.1, ai(), { on: false, reduced: true }))
    expect(sm(holo).count).toBe(0)
  })
  it('switching the game clears the layer', () => {
    const { holo } = make()
    opened(holo)
    holo.update(frame(0.6, ai({ aim: { stone: 0, dx: 0, dy: 1, power: 1000, grow: 1 } })))
    expect(holo.marks.count).toBe(6)
    holo.update(frame(0.7, undefined, { game: 'omok', alkkagi: undefined }))
    expect(sm(holo).count).toBe(0)
    expect(holo.marks.count).toBe(0)
  })
})

describe('determinism', () => {
  it('draws the same from the same inputs', () => {
    const run = () => {
      const { holo } = make(new Euler(0, 0.3, 0))
      const a = ai({
        hits: [{ a: 1, b: 6, speed: 12, at: 1 }],
        outs: [{ a: 2, at: 1.05, dir: { x: 1, y: 0.5 } }],
        aim: { stone: 0, dx: 2, dy: 3, power: 700, grow: 1 },
        end: { winner: 0, since: 1 },
      })
      a.stones[2] = { ...a.stones[2], x: 9.6, y: -6, out: true }
      opened(holo, a)
      const out: number[] = []
      for (const t of [1, 1.03, 1.1, 1.2, 1.4]) {
        holo.update(frame(t, a))
        out.push(sm(holo).count, holo.marks.count, ...arr(sm(holo), 'iSt').slice(0, 40), ...arr(sm(holo), 'iPos').slice(0, 30), ...arr(holo.marks, 'iPos').slice(0, 18))
      }
      return out
    }
    expect(run()).toEqual(run())
  })
})

