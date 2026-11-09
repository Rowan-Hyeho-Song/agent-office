/// <reference types="node" />
// navSpots.fixture.ts (the nav_* empties) and footprint.data.ts (the furniture footprint) are GENERATED from public/models/office.glb,
// never edited by hand. This test rebuilds both from the glb headlessly (loadOffice + rasterFootprint, the same code the app runs) and
// fails if the committed files differ, so a re-bake that is not followed by a regeneration cannot slip through. After a model change:
//   NAV_WRITE=1 FOOT_WRITE=1 npx vitest run src/office/modelData.test.ts     (rewrites both files)
//   FIT_WRITE=1 npx vitest run src/office/gripFit.test.ts                    (gripFit.data.ts)
import { readFileSync, writeFileSync } from 'node:fs'
/** line endings aside (a Windows checkout with core.autocrlf turns the generated files CRLF; .gitattributes keeps them LF too) */
const lf = (s: string) => s.split('\r\n').join('\n')
import { describe, expect, it } from 'vitest'
import type { Object3D } from 'three'
import { loadOffice } from './glbLoad'
import { meshesOf } from './nodes'
import { rasterFootprint } from './floorMask'
import { setRoomFromExtras } from './room'
import type { NavSpot } from './nav'

const path = (f: string) => new URL(f, import.meta.url)

function navRaw(scene: Object3D): string {
  const spots: NavSpot[] = []
  scene.traverse((o) => {
    const { nav, ry } = o.userData as { nav?: NavSpot['kind']; ry?: number }
    if (!nav || !o.name.startsWith('nav_')) return
    spots.push({ id: o.name.slice(4), x: o.position.x, z: o.position.z, ry: ry ?? 0, kind: nav })
  })
  spots.sort((a, b) => (a.id < b.id ? -1 : 1))
  const r = (v: number, d: number) => String(Number(v.toFixed(d)))
  return spots.map((s) => `${s.id} ${r(s.x, 3)} ${r(s.z, 3)} ${r(s.ry, 4)} ${s.kind}`).join('; ')
}

function navFile(raw: string): string {
  return `// GENERATED from public/models/office.glb by src/office/modelData.test.ts (NAV_WRITE=1 npx vitest run src/office/modelData.test.ts). Do not edit by hand.
// The nav_* empties of the baked layout, for tests that need the real graph without the glb.
import { buildGraph, type NavKind, type NavSpot } from './nav'

const RAW = '${raw}'

export const SPOTS: NavSpot[] = RAW.split(';').map((s) => {
  const [id, x, z, ry, kind] = s.trim().split(/\\s+/)
  return { id, x: +x, z: +z, ry: +ry, kind: kind as NavKind }
})
export const GRAPH = buildGraph(SPOTS)
`
}

function footFile(f: { cell: number; minX: number; minZ: number; w: number; h: number; bits: Uint8Array }): string {
  let bin = ''
  for (let k = 0; k < f.bits.length; k += 8) {
    let v = 0
    for (let q = 0; q < 8; q++) v |= (f.bits[k + q] ?? 0) << q
    bin += String.fromCharCode(v)
  }
  const b64 = Buffer.from(bin, 'latin1').toString('base64')
  const lines = b64.match(/.{1,100}/g)!.map((l) => `  '${l}',`).join('\n')
  return `// GENERATED from public/models/office.glb by src/office/modelData.test.ts (FOOT_WRITE=1 npx vitest run src/office/modelData.test.ts). Do not edit by hand.
// The furniture footprint of office.glb on a 0.05 m grid (floorMask.ts), a bit per cell, row by row from (minX, minZ).

export const FOOTPRINT_DATA = {
  cell: ${f.cell},
  minX: ${f.minX},
  minZ: ${f.minZ},
  w: ${f.w},
  h: ${f.h},
  b64: [
${lines}
  ].join(''),
}
`
}

describe('generated model data matches office.glb', async () => {
  const { scene, nodes } = await loadOffice()
  setRoomFromExtras(scene.getObjectByName('room')?.userData.room)
  scene.updateMatrixWorld(true)

  it('navSpots.fixture.ts is the glb nav_* empties', () => {
    const text = navFile(navRaw(scene))
    if (process.env.NAV_WRITE) writeFileSync(path('./navSpots.fixture.ts'), text)
    expect(lf(readFileSync(path('./navSpots.fixture.ts'), 'utf8'))).toBe(lf(text))
  })

  it('footprint.data.ts is the glb furniture footprint', () => {
    const furniture = Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf)
    const text = footFile(rasterFootprint(furniture, 0.05, scene))
    if (process.env.FOOT_WRITE) writeFileSync(path('./footprint.data.ts'), text)
    expect(lf(readFileSync(path('./footprint.data.ts'), 'utf8'))).toBe(lf(text))
  })
})
