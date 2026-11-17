// Hologram chess layer (#604 stage 1a, hologram.md 11): board and coordinate pixels, glyphs, squares, instances, capture / castling /
// promotion / check / end looks, held piece, determinism, reduced motion. No WebGL.
import { describe, expect, it } from 'vitest'
import { Euler, Group, Object3D, Vector3, type InstancedBufferAttribute, type InstancedMesh } from 'three'
import { HoloBoard, type HoloInput } from './holoBoard'
import {
  BOARD_PX,
  CVOX,
  FILM_PX,
  GLYPHS,
  SHADE,
  SQ,
  TILT_S,
  boardPixels,
  buildPieceGeometry,
  coordPixels,
  glyphVoxels,
  type ChessInput,
} from './holoChess'
import { startPosition } from '../play/chess'

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
const players = [
  { seat: seat(0, 0.7), color: 2 as const }, // white at +z
  { seat: seat(0, -0.7), color: 1 as const },
]
const sq = (name: string) => (name.charCodeAt(0) - 97) + (Number(name[1]) - 1) * 8
const mk = (pieces: Record<string, number>): Int8Array => {
  const b = new Int8Array(64)
  for (const [k, v] of Object.entries(pieces)) b[sq(k)] = v
  return b
}
const ci = (o: Partial<ChessInput> & { board: Int8Array | null }): ChessInput => ({ lastMove: null, check: null, ...o })
const frame = (t: number, chess: ChessInput, o: Partial<HoloInput> = {}): HoloInput => ({
  t,
  reduced: false,
  on: true,
  board: null,
  lastMove: -1,
  win: null,
  turn: null,
  players,
  held: null,
  game: 'chess',
  chess,
  ...o,
})
/** open the board (chess) and return a clock after it is fully on */
function opened(holo: HoloBoard, reduced = false) {
  holo.update(frame(0, ci({ board: null }), { reduced }))
  holo.update(frame(0.5, ci({ board: null }), { reduced }))
  return 0.5
}
const kings = mk({ e1: 6, e8: -6, a2: 1 })
const arr = (m: InstancedMesh, name: string) => (m.geometry.getAttribute(name) as InstancedBufferAttribute).array as Float32Array
const pm = (h: HoloBoard, kind: number, colour: 1 | 2) => h.chessLayer!.pieces[colour][kind]
const total = (h: HoloBoard) => {
  let n = 0
  for (const c of [1, 2] as const) for (let k = 1; k <= 6; k++) n += pm(h, k, c).count
  return n
}

describe('board pixels', () => {
  const px = boardPixels()
  const at = (x: number, y: number) => px[y * BOARD_PX + x]
  it('draws lines, border, light-square dither with a1 dark', () => {
    expect(px.length).toBe(89 * 89)
    expect(at(0, 40)).toBe(255) // border
    expect(at(88, 40)).toBe(255)
    expect(at(40, 0)).toBe(255)
    expect(at(40, 88)).toBe(255)
    expect(at(11, 40)).toBe(128) // inner line 0.5
    expect(at(40, 22)).toBe(128)
    // a1 (file 0, rank 0) is dark: nothing inside
    for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) expect(at(x, y)).toBe(0)
    // b1 is light: every other pixel lit at 0.25
    expect(at(12, 2)).toBe(64)
    expect(at(13, 2)).toBe(0)
    expect(at(13, 3)).toBe(64)
    let lit = 0
    for (let y = 1; y <= 10; y++) for (let x = 12; x <= 21; x++) if (at(x, y) === 64) lit++
    expect(lit).toBe(50)
    // a2 is light too, h8 is dark
    expect(at(2, 14)).toBe(64)
    for (let y = 78; y <= 87; y++) for (let x = 78; x <= 87; x++) expect(at(x, y)).toBe(0)
  })
  it('draws coordinates a-h under the near edge and 1-8 left, mirrored when flipped', () => {
    const c = coordPixels(false)
    const g = (x: number, y: number) => c[y * FILM_PX + x]
    expect(c.length).toBe(121 * 121)
    // 'a': top row ".#." at y 13, bottom row "#.#" at y 9, x from 21
    expect(g(22, 13)).toBe(128)
    expect(g(21, 13)).toBe(0)
    expect(g(21, 9)).toBe(128)
    expect(g(22, 9)).toBe(0)
    // '1' left of the board: top row ".#." at y 23, x from 11
    expect(g(12, 23)).toBe(128)
    expect(g(11, 23)).toBe(0)
    // nothing inside the board
    expect(g(60, 60)).toBe(0)
    const f = coordPixels(true)
    expect(f[13 * FILM_PX + 21]).toBe(128) // 'h' ("#.#") first when flipped
    expect(f[13 * FILM_PX + 22]).toBe(0)
    // digits flip: '8' (###, #.#) is nearest the near edge
    expect(f[23 * FILM_PX + 11]).toBe(128) // top row of '8' is "###"
    expect(f[23 * FILM_PX + 12]).toBe(128)
    expect(c[23 * FILM_PX + 11]).toBe(0)
  })
})

describe('glyphs', () => {
  it('have the specified sizes and voxel counts', () => {
    const sizes: Record<number, [number, number]> = { 6: [10, 14], 5: [10, 13], 3: [10, 12], 2: [10, 12], 4: [10, 10], 1: [10, 8] }
    for (const [k, [w, h]] of Object.entries(sizes)) {
      expect(GLYPHS[+k].length).toBe(h)
      for (const r of GLYPHS[+k]) expect(r.length).toBe(w)
    }
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (let k = 1; k <= 6; k++) counts[k] = GLYPHS[k].join('').replace(/\./g, '').length
    for (let k = 1; k <= 6; k++) expect(glyphVoxels(k)).toBe(counts[k])
    expect(glyphVoxels(1)).toBe(38)
    expect(glyphVoxels(4)).toBe(72)
    expect(glyphVoxels(6)).toBe(80)
  })
  it('merge to visible faces, two layers deep, standing', () => {
    for (let k = 1; k <= 6; k++) {
      const g = buildPieceGeometry(k)
      const pos = g.getAttribute('position')
      let top = 0
      let maxY = 0
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < pos.count; i++) {
        maxY = Math.max(maxY, pos.getY(i))
        minZ = Math.min(minZ, pos.getZ(i))
        maxZ = Math.max(maxZ, pos.getZ(i))
      }
      const sh = g.getAttribute('aShade')
      const cap = g.getAttribute('aCap')
      for (let i = 0; i < pos.count; i += 4) if (Math.abs(sh.getX(i) - SHADE.top) < 1e-6 && cap.getX(i) === 0) top++
      expect(maxY).toBeLessThanOrEqual(GLYPHS[k].length * CVOX + 1e-9)
      expect(maxY).toBeGreaterThan((GLYPHS[k].length - 1) * CVOX)
      expect(maxZ - minZ).toBeCloseTo(CVOX * 1.92 - CVOX * 0.92 + CVOX * 0.92 + 0, 4) // 2 layers (gap 8% inside a voxel)
      // exposed tops per layer: the voxels with nothing above
      let exposed = 0
      const rows = GLYPHS[k]
      rows.forEach((r, y) => [...r].forEach((ch, x) => ch === '#' && (y === 0 || rows[y - 1][x] !== '#') && exposed++))
      expect(top).toBe(exposed * 2)
    }
    // face shades only (#655, hologram.md 11.2): front/back 1.0, top 0.6, sides 0.5; the front the brightest
    const sh = buildPieceGeometry(2).getAttribute('aShade')
    for (let i = 0; i < sh.count; i++) expect([1, 0.6, 0.5].some((v) => Math.abs(v - sh.getX(i)) < 1e-6)).toBe(true)
    expect(SHADE).toEqual({ front: 1, side: 0.5, top: 0.6 })
  })
})

describe('squares', () => {
  it('squarePos and squareAt round trip, also turned, rotated and flipped', () => {
    for (const rot of [undefined, new Euler(0, 0.7, 0)]) {
      for (const flip of [false, true]) {
        const { holo } = make(rot)
        const e = rot ?? new Euler()
        // seats rotate with the surface
        const ps = players.map((p) => ({ ...p, seat: p.seat.clone().sub(new Vector3(1.5, 0.74, -2)).applyEuler(e).add(new Vector3(1.5, 0.74, -2)) }))
        holo.update(frame(0, ci({ board: null, flip }), { players: ps }))
        for (let s = 0; s < 64; s++) {
          const p = holo.squarePos(s)
          expect(holo.squareAt(p)).toBe(s)
          expect(holo.squareAt(p.clone().add(new Vector3(0.012, 0.05, -0.012).applyEuler(e)))).toBe(s)
        }
        expect(holo.squarePos(0).distanceTo(holo.squarePos(1))).toBeCloseTo(SQ)
        expect(holo.squarePos(0).distanceTo(holo.squarePos(8))).toBeCloseTo(SQ)
        expect(holo.squarePos(27).y).toBeCloseTo(0.76)
        expect(holo.squareAt(holo.squarePos(0).add(new Vector3(-0.03, 0, 0).applyEuler(e)))).toBe(-1)
      }
    }
  })
  it('puts rank 1 on the white seat side; flip turns black near', () => {
    const { holo } = make()
    holo.update(frame(0, ci({ board: null })))
    // white at +z: rank 1 has the larger z, file a is at the viewer's left (-x)
    expect(holo.squarePos(sq('e1')).z).toBeGreaterThan(holo.squarePos(sq('e8')).z)
    expect(holo.squarePos(sq('a1')).x).toBeLessThan(holo.squarePos(sq('h1')).x)
    holo.update(frame(0.1, ci({ board: null, flip: true })))
    // black near: its seat is at -z, rank 8 is there, file a is at black's right (world -x)
    expect(holo.squarePos(sq('e8')).z).toBeLessThan(holo.squarePos(sq('e1')).z)
    expect(holo.squarePos(sq('a8')).x).toBeLessThan(holo.squarePos(sq('h8')).x)
    // white seat on +x: rank 1 is at +x
    const { holo: h2 } = make()
    h2.update(frame(0, ci({ board: null }), { players: [{ seat: seat(0.7, 0), color: 2 }, { seat: seat(-0.7, 0), color: 1 }] }))
    expect(h2.squarePos(sq('e1')).x).toBeGreaterThan(h2.squarePos(sq('e8')).x)
  })
})

describe('pieces', () => {
  it('instance counts follow the board; landed on a move; glow per piece', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = startPosition().board
    holo.update(frame(t + 0.1, ci({ board: b })))
    expect(total(holo)).toBe(32)
    expect(pm(holo, 1, 2).count).toBe(8)
    expect(pm(holo, 1, 1).count).toBe(8)
    expect(pm(holo, 6, 2).count).toBe(1)
    expect(pm(holo, 4, 1).count).toBe(2)
    expect(holo.glow.count).toBe(32)
    expect(holo.stones[1].count + holo.stones[2].count).toBe(0)
    expect(holo.founts.count).toBe(0)
    const b2 = b.slice()
    b2[sq('e4')] = 1
    b2[sq('e2')] = 0
    const ev = { id: 1, from: sq('e2'), to: sq('e4'), at: t + 0.5 }
    expect(holo.update(frame(t + 0.5, ci({ board: b2, move: ev, lastMove: { from: ev.from, to: ev.to } }))).landed).toEqual([sq('e4')])
    expect(holo.update(frame(t + 0.6, ci({ board: b2, move: ev, lastMove: { from: ev.from, to: ev.to } }))).landed).toEqual([])
    expect(total(holo)).toBe(32)
    // last move: L corners (2 cells x 4 corners x 2 arms), no check border
    expect(holo.dots.count).toBe(16)
    // ripple at the drop, gone after 0.3 s
    holo.update(frame(t + 0.6, ci({ board: b2, move: ev })))
    expect(holo.marks.count).toBe(4)
    holo.update(frame(t + 0.9, ci({ board: b2, move: ev })))
    expect(holo.marks.count).toBe(0)
  })
  it('turn to face the camera', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = mk({ e1: 6 })
    holo.update(frame(t + 0.1, ci({ board: b, camera: new Vector3(1.5, 1.5, -2 + 2) })))
    const m = pm(holo, 6, 2)
    // piece at e1: local (0.02, ., 0.14); camera straight over +z at x=0 -> yaw slightly negative
    const x = arr(m, 'iPos')[0]
    const z = arr(m, 'iPos')[2]
    expect(arr(m, 'iSt')[3]).toBeCloseTo(Math.atan2(0 - x, 2 - z), 5)
    holo.update(frame(t + 0.2, ci({ board: b, camera: new Vector3(1.5 + 5, 1.5, -2) })))
    expect(arr(m, 'iSt')[3]).toBeGreaterThan(1.4)
  })
  it('a held piece is drawn at its position at 1.3, hides its cell, and keeps its facing', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = mk({ e2: 1, d2: 1 })
    holo.update(frame(t + 0.1, ci({ board: b, camera: new Vector3(1.5, 1.5, 0) })))
    expect(pm(holo, 1, 2).count).toBe(2)
    const pos = holo.squarePos(sq('e4')).add(new Vector3(0, 0.05, 0))
    const held = { pos, kind: 1, color: 2 as const, since: t + 0.2, from: sq('e2') }
    holo.update(frame(t + 0.3, ci({ board: b, camera: new Vector3(1.5, 1.5, 0) }), { held }))
    const m = pm(holo, 1, 2)
    expect(m.count).toBe(2) // d2 + the held one, e2 hidden
    const heldIdx = 1 // drawn after the board cells
    expect(arr(m, 'iSt')[heldIdx * 4 + 1]).toBeCloseTo(1.3)
    expect(arr(m, 'iPos')[heldIdx * 3 + 1]).toBeCloseTo(0.05 + 0.02 - 0.74 + 0.74 - 0.02 + 0.02, 3)
    const yaw0 = arr(m, 'iSt')[heldIdx * 4 + 3]
    holo.update(frame(t + 0.4, ci({ board: b, camera: new Vector3(4, 1.5, 0) }), { held }))
    expect(arr(m, 'iSt')[heldIdx * 4 + 3]).toBeCloseTo(yaw0, 6)
  })
})

describe('moves', () => {
  it('a capture vanishes by rows over 0.3 s, then stands in the capturing side row', () => {
    const { holo } = make()
    const t = opened(holo)
    const before = mk({ e4: 1, d5: -1 })
    holo.update(frame(t + 0.1, ci({ board: before })))
    expect(pm(holo, 1, 1).count).toBe(1)
    const after = mk({ d5: 1 })
    const T = t + 1
    const ev = { id: 7, from: sq('e4'), to: sq('d5'), at: T, capture: { sq: sq('d5'), kind: 1, color: 1 as const } }
    const cap = { 1: [], 2: [{ kind: 1, color: 1 as const }] }
    const run = (dt: number) => holo.update(frame(T + dt, ci({ board: after, move: ev, captured: cap })))
    expect(run(0).landed).toEqual([sq('d5')])
    const black = pm(holo, 1, 1)
    expect(black.count).toBe(1)
    expect(arr(black, 'iRows')[1]).toBe(8) // still whole at the drop
    run(0.15)
    expect(black.count).toBe(1)
    expect(arr(black, 'iRows')[1]).toBeLessThan(8)
    expect(arr(black, 'iRows')[1]).toBeGreaterThan(0)
    expect(arr(black, 'iRows')[3]).toBe(1) // stair sideways flag
    run(0.29)
    expect(arr(black, 'iRows')[1]).toBeLessThanOrEqual(1)
    expect(arr(black, 'iSt')[0]).toBe(1) // not yet in the row
    run(0.31)
    expect(black.count).toBe(1)
    expect(arr(black, 'iSt')[0]).toBeCloseTo(0.5)
    expect(arr(black, 'iSt')[1]).toBeCloseTo(0.5)
    expect(arr(black, 'iRows')[1]).toBe(8)
    // right of white (white at +z): outside the board edge by 2 cm, near white's end
    const px = arr(black, 'iPos')[0]
    const pz = arr(black, 'iPos')[2]
    expect(px).toBeGreaterThan(0.18) // instance positions are in the surface frame
    expect(px).toBeLessThan(0.2)
    expect(pz).toBeGreaterThan(0.1)
    run(0.5)
    expect(holo.update(frame(T + 0.6, ci({ board: after, move: ev, captured: cap }))).landed).toEqual([])
    expect(pm(holo, 1, 2).count).toBe(1) // the capturer stays
  })
  it('en passant: the pawn vanishes from its own cell', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: mk({ e5: 1, d5: -1 }) })))
    const T = t + 1
    const ev = { id: 2, from: sq('e5'), to: sq('d6'), at: T, capture: { sq: sq('d5'), kind: 1, color: 1 as const } }
    const after = mk({ d6: 1 })
    holo.update(frame(T + 0.15, ci({ board: after, move: ev, captured: { 1: [], 2: [{ kind: 1, color: 1 as const }] } })))
    const black = pm(holo, 1, 1)
    expect(black.count).toBe(1)
    const l = holo.squarePos(sq('d5'))
    // local x of d5 is -0.02 (file d)
    expect(arr(black, 'iPos')[0]).toBeCloseTo(l.x - 1.5, 4)
    expect(arr(black, 'iPos')[2]).toBeCloseTo(l.z + 2, 4)
  })
  it('castling: the rook slides 0.1 s per square', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: mk({ e1: 6, h1: 4 }) })))
    const T = t + 1
    const ev = { id: 3, from: sq('e1'), to: sq('g1'), at: T, castle: { from: sq('h1'), to: sq('f1') } }
    const after = mk({ g1: 6, f1: 4 })
    const run = (dt: number) => holo.update(frame(T + dt, ci({ board: after, move: ev })))
    const rook = pm(holo, 4, 2)
    const x = () => arr(rook, 'iPos')[0]
    const xAt = (name: string) => holo.squarePos(sq(name)).x - 1.5
    run(0)
    expect(x()).toBeCloseTo(xAt('h1'), 5)
    run(0.05)
    expect(x()).toBeCloseTo(xAt('h1'), 5)
    run(0.11)
    expect(x()).toBeCloseTo((xAt('h1') + xAt('f1')) / 2, 5) // one square done
    run(0.19)
    expect(x()).toBeCloseTo((xAt('h1') + xAt('f1')) / 2, 5)
    run(0.21)
    expect(x()).toBeCloseTo(xAt('f1'), 5)
    expect(rook.count).toBe(1)
    expect(pm(holo, 6, 2).count).toBe(1)
    // reduced: the rook is already at its cell
    const r = make()
    const t2 = opened(r.holo, true)
    r.holo.update(frame(t2 + 0.1, ci({ board: mk({ e1: 6, h1: 4 }) }), { reduced: true }))
    r.holo.update(frame(t2 + 1.05, ci({ board: after, move: ev }), { reduced: true }))
    expect(arr(pm(r.holo, 4, 2), 'iPos')[0]).toBeCloseTo(xAt('h1') + (xAt('f1') - xAt('h1')), 5)
  })
  it('promotion: the glyph is redrawn from the bottom 0.2 s after the drop over 0.3 s', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: mk({ e7: 1 }) })))
    const T = t + 1
    const ev = { id: 4, from: sq('e7'), to: sq('e8'), at: T, promotion: 5 }
    const after = mk({ e8: 5 })
    const run = (dt: number) => holo.update(frame(T + dt, ci({ board: after, move: ev })))
    const pawn = pm(holo, 1, 2)
    const queen = pm(holo, 5, 2)
    run(0)
    run(0.1)
    expect(pawn.count).toBe(1)
    expect(queen.count).toBe(0)
    run(0.2 + 0.15) // half way: floor(0.5 * 13) = 6 rows of the queen, the pawn above them
    expect(queen.count).toBe(1)
    expect(arr(queen, 'iRows')[0]).toBe(0)
    expect(arr(queen, 'iRows')[1]).toBe(6)
    expect(pawn.count).toBe(1)
    expect(arr(pawn, 'iRows')[0]).toBe(6)
    expect(arr(pawn, 'iRows')[1]).toBe(8)
    run(0.2 + 0.2) // k = 2/3: 8 rows of queen, the pawn is gone
    expect(arr(queen, 'iRows')[1]).toBe(8)
    expect(pawn.count).toBe(0)
    run(0.6)
    expect(pawn.count).toBe(0)
    expect(queen.count).toBe(1)
    expect(arr(queen, 'iRows')[1]).toBe(13)
    expect(arr(queen, 'iRows')[0]).toBe(0)
  })
})

describe('marks and ends', () => {
  it('check: red border round the king until it is lifted, one stair shake at the start', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: kings })))
    expect(holo.dots.count).toBe(0)
    const king = pm(holo, 6, 1)
    const idx = () => {
      // the black king is the only one in its mesh
      expect(king.count).toBe(1)
      return 0
    }
    const T = t + 1
    const run = (dt: number) => holo.update(frame(T + dt, ci({ board: kings, check: sq('e8') })))
    expect(run(0).checkStart).toBe(true)
    expect(holo.dots.count).toBe(4)
    expect(arr(king, 'iRows')[idx() * 4 + 2]).toBeCloseTo(CVOX)
    expect(run(0.05).checkStart).toBeFalsy()
    expect(arr(king, 'iRows')[2]).toBeCloseTo(CVOX)
    run(0.15)
    expect(arr(king, 'iRows')[2]).toBeCloseTo(-CVOX)
    run(0.25)
    expect(arr(king, 'iRows')[2]).toBeCloseTo(CVOX)
    run(0.35)
    expect(arr(king, 'iRows')[2]).toBe(0)
    expect(holo.dots.count).toBe(4)
    expect(run(0.8).checkStart).toBeFalsy()
    expect(arr(king, 'iRows')[2]).toBe(0) // once
    holo.update(frame(T + 1, ci({ board: kings })))
    expect(holo.dots.count).toBe(0)
  })
  it('checkmate: the mated king vanishes, the winner pieces are 1.3 for 2 s', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: kings })))
    const T = t + 1
    const end = { result: 'mate' as const, loser: 1 as const, since: T }
    const run = (dt: number) => holo.update(frame(T + dt, ci({ board: kings, end })))
    run(0)
    expect(pm(holo, 6, 1).count).toBe(1)
    run(0.15)
    expect(pm(holo, 6, 1).count).toBe(1)
    expect(arr(pm(holo, 6, 1), 'iRows')[1]).toBeLessThan(14)
    run(0.35)
    expect(pm(holo, 6, 1).count).toBe(0)
    expect(arr(pm(holo, 6, 2), 'iSt')[1]).toBeCloseTo(1.3)
    expect(arr(pm(holo, 1, 2), 'iSt')[1]).toBeCloseTo(1.3)
    run(1.9)
    expect(arr(pm(holo, 6, 2), 'iSt')[1]).toBeCloseTo(1.3)
    run(2.1)
    expect(arr(pm(holo, 6, 2), 'iSt')[1]).toBeCloseTo(1)
    expect(pm(holo, 6, 1).count).toBe(0)
  })
  it('draw: every piece 0.6 for 1 s, then back', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: kings })))
    const T = t + 1
    const end = { result: 'draw' as const, since: T }
    holo.update(frame(T + 0.5, ci({ board: kings, end })))
    expect(arr(pm(holo, 6, 1), 'iSt')[1]).toBeCloseTo(0.6)
    expect(arr(pm(holo, 6, 2), 'iSt')[1]).toBeCloseTo(0.6)
    expect(pm(holo, 6, 1).count).toBe(1)
    holo.update(frame(T + 1.1, ci({ board: kings, end })))
    expect(arr(pm(holo, 6, 1), 'iSt')[1]).toBeCloseTo(1)
  })
})

describe('stage', () => {
  it('on / off fold with pieces first, game switch, omok untouched', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: startPosition().board })))
    expect(holo.chessLayer!.grid.visible).toBe(true)
    expect(holo.grid.visible).toBe(false)
    const off = (x: number) => holo.update(frame(x, ci({ board: null }), { on: false }))
    expect(off(2).boardOffStart).toBe(false)
    expect(holo.state).toBe('wait')
    expect(total(holo)).toBe(32)
    expect(off(2.1).boardOffStart).toBe(false)
    expect(off(2.16).boardOffStart).toBe(true)
    expect(total(holo)).toBe(0)
    expect(holo.state).toBe('fold')
    off(2.4)
    off(2.6)
    expect(holo.state).toBe('off')
    expect(holo.chessLayer!.grid.visible).toBe(false)
    // omok again
    holo.update({ ...frame(5, ci({ board: null })), game: 'omok', chess: undefined })
    holo.update({ ...frame(5.5, ci({ board: null })), game: 'omok', chess: undefined })
    expect(holo.grid.visible).toBe(true)
    expect(holo.chessLayer!.grid.visible).toBe(false)
  })
  it('off with no pieces folds at once; snap draws the end state without events', () => {
    const { holo } = make()
    opened(holo)
    expect(holo.update(frame(1, ci({ board: null }), { on: false })).boardOffStart).toBe(true)
    const b = make()
    const r = b.holo.update(frame(5, ci({ board: kings, check: sq('e8'), move: { id: 1, from: 0, to: 1, at: 5 } }), { snap: true }))
    expect(r.landed).toEqual([])
    expect(r.boardOnStart).toBe(false)
    expect(r.checkStart).toBeFalsy()
    expect(total(b.holo)).toBe(3)
    expect(arr(pm(b.holo, 6, 1), 'iRows')[2]).toBe(0)
    expect(b.holo.marks.count).toBe(0)
  })
  it('new game vanishes the pieces by rows, far rank first', () => {
    const { holo } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: startPosition().board })))
    holo.update(frame(t + 1, ci({ board: null }), { newGame: true }))
    expect(total(holo)).toBe(32)
    holo.update(frame(t + 1.8, ci({ board: null })))
    expect(total(holo)).toBe(0)
    expect(holo.state).toBe('on')
  })
  it('is deterministic for the same input sequence', () => {
    const run = () => {
      const { holo } = make()
      const t = opened(holo)
      const b = startPosition().board
      const b2 = b.slice()
      b2[sq('e4')] = 1
      b2[sq('e2')] = 0
      const ev = { id: 1, from: sq('e2'), to: sq('e4'), at: t + 0.5 }
      const out: number[] = []
      for (const dt of [0.1, 0.5, 0.55, 0.7, 0.9]) {
        holo.update(frame(t + dt, ci({ board: dt < 0.5 ? b : b2, move: dt < 0.5 ? null : ev, camera: new Vector3(2, 2, 1) })))
        for (const c of [1, 2] as const) for (let k = 1; k <= 6; k++) out.push(...arr(pm(holo, k, c), 'iPos').slice(0, 3 * 16), ...arr(pm(holo, k, c), 'iSt').slice(0, 4 * 16))
        out.push(holo.marks.count, holo.dots.count, holo.glow.count)
      }
      return out
    }
    expect(run()).toEqual(run())
  })
})

describe('reduced motion', () => {
  it('no ripple, no shake, fades instead of stairs, rook already home', () => {
    const { holo } = make()
    const t = opened(holo, true)
    const f = (x: number, c: ChessInput) => holo.update(frame(x, c, { reduced: true }))
    f(t + 0.1, ci({ board: mk({ e4: 1, d5: -1, e1: 6, e8: -6 }) }))
    const T = t + 1
    const ev = { id: 9, from: sq('e4'), to: sq('d5'), at: T, capture: { sq: sq('d5'), kind: 1, color: 1 as const } }
    const after = mk({ d5: 1, e1: 6, e8: -6 })
    const c = (check: number | null) => ci({ board: after, move: ev, check, captured: { 1: [], 2: [{ kind: 1, color: 1 as const }] } })
    f(T, c(sq('e8')))
    expect(holo.marks.count).toBe(0) // no ripple
    const black = pm(holo, 1, 1)
    f(T + 0.05, c(sq('e8')))
    expect(black.count).toBe(1)
    expect(arr(black, 'iRows')[1]).toBe(8) // no rows, a fade
    expect(arr(black, 'iRows')[3]).toBe(0)
    expect(arr(black, 'iSt')[2]).toBeCloseTo(0.5)
    expect(arr(pm(holo, 6, 1), 'iRows')[2]).toBe(0) // no shake
    f(T + 0.15, c(sq('e8')))
    expect(black.count).toBe(1) // in the row now, half size
    expect(arr(black, 'iSt')[0]).toBeCloseTo(0.5)
  })
})

describe('visitor marks (#604 stage 2)', () => {
  const pos = mk({ e1: 6, e8: -6, e4: 1, d5: -1 })
  const setup = () => {
    const { holo, surface } = make()
    const t = opened(holo)
    holo.update(frame(t + 0.1, ci({ board: pos }))) // pieces grown in
    return { holo, surface, T: t + 1 }
  }
  const sqLocal = (holo: HoloBoard, s: number) => holo.chessLayer!.squareLocal(s, new Vector3())
  const inst = (m: InstancedMesh, name: string, n: number) => {
    const size = name === 'iCol' ? 4 : name === 'iSize' ? 2 : name === 'iRot' ? 1 : 3
    return Array.from(arr(m, name).slice(n * size, n * size + size))
  }
  const near = (p: Vector3, x: number, z: number) => Math.abs(p.x - x) < SQ / 2 && Math.abs(p.z - z) < SQ / 2
  const visitor = (o: Partial<NonNullable<ChessInput['visitor']>> = {}) => ({ selected: null, targets: [], cursor: null, drag: null, ...o })

  it('draws nothing extra without visitor', () => {
    const { holo, T } = setup()
    holo.update(frame(T, ci({ board: pos })))
    expect(holo.marks.count).toBe(0)
    expect(holo.dots.count).toBe(0)
  })

  it('a 2x2 px dot at each legal square, a cyan ring at the cursor', () => {
    const { holo, T } = setup()
    holo.update(frame(T, ci({ board: pos, visitor: visitor({ selected: sq('e4'), targets: [{ sq: sq('e5'), capture: false }, { sq: sq('e6'), capture: false }], cursor: sq('e5') }) })))
    expect(holo.marks.count).toBe(2 + 4)
    const e5 = sqLocal(holo, sq('e5'))
    const d0 = inst(holo.marks, 'iPos', 0)
    expect(d0[0]).toBeCloseTo(e5.x)
    expect(d0[2]).toBeCloseTo(e5.z)
    const sz = inst(holo.marks, 'iSize', 0)
    expect(sz[0]).toBeCloseTo((2 * SQ) / 11)
    expect(sz[1]).toBeCloseTo((2 * SQ) / 11)
    expect(inst(holo.marks, 'iCol', 0)[2]).toBeGreaterThan(inst(holo.marks, 'iCol', 0)[0]) // cyan: blue > red
    // ring: four edge bars round e5
    for (let i = 2; i < 6; i++) {
      const p = inst(holo.marks, 'iPos', i)
      expect(near(new Vector3(p[0], 0, p[2]), e5.x, e5.z)).toBe(true)
    }
    expect(holo.dots.count).toBe(0)
  })

  it('capture squares get cyan corners drawn after (over) the red last-move corners', () => {
    const { holo, T } = setup()
    holo.update(frame(T, ci({ board: pos, lastMove: { from: sq('e2'), to: sq('d5') }, visitor: visitor({ selected: sq('e4'), targets: [{ sq: sq('d5'), capture: true }] }) })))
    expect(holo.marks.count).toBe(0) // no centre dot on a capture square
    expect(holo.dots.count).toBe(16 + 8) // two red corner sets, one cyan
    const col = (i: number) => inst(holo.dots, 'iCol', i)
    const isRed = (i: number) => col(i)[0] > col(i)[2]
    // d5 corners: red come before cyan in the buffer (cyan over red)
    const red = Array.from({ length: 24 }, (_, i) => i).filter(isRed)
    const cyan = Array.from({ length: 24 }, (_, i) => i).filter((i) => !isRed(i))
    expect(red.length).toBe(16)
    expect(cyan.length).toBe(8)
    expect(Math.min(...cyan)).toBeGreaterThan(Math.max(...red))
    // cyan corners sit exactly where the red ones of d5 are
    const d5 = sqLocal(holo, sq('d5'))
    for (const i of cyan) {
      const p = inst(holo.dots, 'iPos', i)
      expect(near(new Vector3(p[0], 0, p[2]), d5.x, d5.z)).toBe(true)
    }
  })

  it('the selected piece is 1.3 bright and 1 cm up; others stay at 1 and rest', () => {
    const { holo, T } = setup()
    holo.update(frame(T, ci({ board: pos })))
    const rest = inst(pm(holo, 1, 2), 'iPos', 0)[1]
    expect(inst(pm(holo, 1, 2), 'iSt', 0)[1]).toBe(1)
    holo.update(frame(T + 0.01, ci({ board: pos, visitor: visitor({ selected: sq('e4') }) })))
    expect(inst(pm(holo, 1, 2), 'iSt', 0)[1]).toBeCloseTo(1.3)
    expect(inst(pm(holo, 1, 2), 'iPos', 0)[1]).toBeCloseTo(rest + 0.01) // immediate, also for reduced
    expect(inst(pm(holo, 1, 1), 'iSt', 0)[1]).toBe(1)
    holo.update(frame(T + 0.02, ci({ board: pos, visitor: visitor({ selected: sq('e4') }) }), { reduced: true }))
    expect(inst(pm(holo, 1, 2), 'iPos', 0)[1]).toBeCloseTo(rest + 0.01)
    expect(inst(pm(holo, 1, 2), 'iSt', 0)[1]).toBeCloseTo(1.3)
  })

  it('a dragged piece leaves its cell and floats 2 cm over the pointer', () => {
    const { holo, surface, T } = setup()
    const w = new Vector3(1.5 + 0.03, 0.74 + 0.5, -2 - 0.05) // world point over the board
    holo.update(frame(T, ci({ board: pos, visitor: visitor({ selected: sq('e4'), drag: { pos: w } }) })))
    const white = pm(holo, 1, 2)
    expect(white.count).toBe(1)
    const q = surface.worldToLocal(w.clone())
    const p = inst(white, 'iPos', 0)
    expect(p[0]).toBeCloseTo(q.x)
    expect(p[2]).toBeCloseTo(q.z)
    expect(p[1]).toBeCloseTo(0.02 + 0.02) // light plane lift 2 cm + 2 cm
    expect(inst(white, 'iSt', 0)[1]).toBeCloseTo(1.3)
  })
})

describe('the pieces face the visitor full on in their game view (#655, hologram.md 11.2)', () => {
  const visitor = { selected: null, targets: [], cursor: null, drag: null }
  const tilt = (holo: HoloBoard) => holo.chessLayer!.materials.piece.uniforms.uTilt.value as number
  it('stand (yaw only) for the agents and the free camera; lean in over 0.3 s for the visitor, back out the same; the camera handed to the shader', () => {
    const { holo } = make()
    const t = opened(holo)
    const b = startPosition().board
    const cam = new Vector3(1.5, 1.6, -2 + 0.9)
    holo.update(frame(t, ci({ board: b, camera: cam })))
    expect(tilt(holo)).toBe(0)
    holo.update(frame(t + 0.1, ci({ board: b, camera: cam, visitor })))
    expect(tilt(holo)).toBe(0)
    holo.update(frame(t + 0.1 + TILT_S / 2, ci({ board: b, camera: cam, visitor })))
    expect(tilt(holo)).toBeCloseTo(0.5, 5)
    holo.update(frame(t + 0.1 + TILT_S, ci({ board: b, camera: cam, visitor })))
    expect(tilt(holo)).toBe(1)
    // the shader's camera is in the board's frame (the surface at 1.5, 0.74, -2)
    const u = holo.chessLayer!.materials.piece.uniforms.uCam.value as Vector3
    expect([u.x, u.y, u.z].map((x) => +x.toFixed(6))).toEqual([0, +(1.6 - 0.74).toFixed(6), 0.9])
    // the visitor leaves: back to standing over 0.3 s
    holo.update(frame(t + 1, ci({ board: b, camera: cam })))
    expect(tilt(holo)).toBe(1)
    holo.update(frame(t + 1 + TILT_S, ci({ board: b, camera: cam })))
    expect(tilt(holo)).toBe(0)
  })
  it('at once with reduced motion', () => {
    const { holo } = make()
    const t = opened(holo, true)
    const b = startPosition().board
    const cam = new Vector3(1.5, 1.6, -1.1)
    holo.update(frame(t, ci({ board: b, camera: cam, visitor }), { reduced: true }))
    expect(tilt(holo)).toBe(1)
    holo.update(frame(t + 0.01, ci({ board: b, camera: cam }), { reduced: true }))
    expect(tilt(holo)).toBe(0)
  })
  it('the pieces scanline is the weaker 0.85 (the board keeps 0.55)', () => {
    const { holo } = make()
    opened(holo)
    expect(holo.chessLayer!.materials.piece.fragmentShader).toContain('? 0.85 : 1.0')
    expect(holo.chessLayer!.materials.grid.fragmentShader).toContain('0.55')
  })
})
