/// <reference types="node" />
// The hand offsets in gripFit.data.ts come from solving the model's grip frames and contact points against the #134 hand
// (grip.ts solveContacts). This test checks that they still hold for the committed glb on every agent's hands: each contact
// fingertip within 3 mm of its point, none through the surface. After a re-bake that moves contacts:
//   FIT_WRITE=1 npx vitest run src/office/gripFit.test.ts    (rewrites gripFit.data.ts)
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { Euler, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { buildRig } from './rig'
import { GRIP_OFFSETS } from './gripFit.data'
import './loungeActs' // registers the lounge's grips (record, pillow, fridge door, door lever) in GRIPS
import { composeOffset, fitFingers, resolveTarget, solveTarget, type GripTarget } from './gripTargets'

stubCanvas()

/** the offsets are per agent: the hands differ by a few mm
 *  [object, grip kind, hand]: every held or touched object that has contact fingers */
const OBJECTS: [string, string, 'l' | 'r'][] = [
  ['prop_cup_0', 'cup', 'r'], ['prop_cup_1', 'cup', 'r'],
  ['prop_paddle_a', 'paddle', 'r'], ['prop_paddle_b', 'paddle', 'r'],
  ['prop_marker_0', 'marker', 'r'], ['prop_marker_1', 'marker', 'r'], ['prop_marker_2', 'marker', 'r'],
  ['prop_tablet_pen', 'tablet_pen', 'r'],
  ['prop_book', 'book', 'l'], ['prop_book', 'book', 'r'], ['prop_book', 'leaf', 'r'],
  // the five shelf books held open for reading (#231): the same reading grip, built from each book's own size
  ...[0, 1, 2, 3, 4].flatMap((k) => ([['prop_shelfbook_' + k, 'book', 'l'], ['prop_shelfbook_' + k, 'book', 'r'], ['prop_shelfbook_' + k, 'leaf', 'r']] as [string, string, 'l' | 'r'][])),
  ['prop_record', 'record', 'r'],
  // the loose sheet held by its long sides for reading (#374): the grip empties of the lower half
  ['prop_paper_a', 'paper_side', 'l'], ['prop_paper_a', 'paper_side', 'r'],
  ['desk_0_mouse', 'mouse', 'r'], ['desk_1_mouse', 'mouse', 'r'], ['desk_3_mouse', 'mouse', 'r'], ['desk_4_mouse', 'mouse', 'r'],
]
const LOG = process.env.FIT_LOG
/** FIT_WRITE=1 FIT_ONLY=prop_book,prop_shelfbook:leaf: recompute only the targets whose "name:kind" starts with one of these; the others keep their stored offsets */
const ONLY = process.env.FIT_ONLY?.split(',')
/** FIT_MERGE=a.json,b.json (FIT_PART files of runs that each solved a share of the targets): those offsets are taken as they are; with FIT_ONLY=- nothing else is solved */
/** FIT_AGENTS=0,1: with FIT_PART, only these agents (a share of the solving; the data file is not written) */
const AGENTS = process.env.FIT_AGENTS?.split(',').map(Number)
const MERGE: Record<string, number[]> | null = process.env.FIT_MERGE ? Object.assign({}, ...process.env.FIT_MERGE.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')))) : null

describe('grip fit against the baked model', () => {
  it('every contact fingertip lands within 3 mm and none goes through the surface', async () => {
    const { scene, nodes } = await loadOffice()
    const rigs = [0, 1, 2, 3, 4].map((i) => buildRig(scene, nodes, i))
    scene.updateMatrixWorld(true)
    const write = !!process.env.FIT_WRITE
    const out: Record<string, number[]> = ONLY ? Object.fromEntries(Object.entries(GRIP_OFFSETS).map(([k, v]) => [k, [...v]])) : {}
    if (LOG) writeFileSync(LOG, '')
    for (const [name, kind, side] of OBJECTS) {
      // a share of the solving (FIT_PART): only the targets this run owns
      if (process.env.FIT_PART && ONLY && !ONLY.some((o) => `${name}:${kind}`.startsWith(o))) continue
      const t = resolveTarget(scene, name, kind, side) as GripTarget
      expect(t, `${name} has a ${side} grip`).toBeTruthy()
      for (const [i, rig] of rigs.entries()) {
        if (AGENTS && !AGENTS.includes(i)) continue
        const key = `${t.key}:${i}`
        if (write && MERGE?.[key]) out[key] = MERGE[key]
        else if (write && (!ONLY || ONLY.some((o) => `${name}:${kind}`.startsWith(o)))) {
          const s = solveTarget(t, rig.hands[side])
          const e = new Euler().setFromRotationMatrix(s.offset, 'XYZ')
          const p = new Vector3().setFromMatrixPosition(s.offset)
          out[key] = [p.x, p.y, p.z, e.x, e.y, e.z].map((x) => +x.toFixed(8))
        }
        const v = out[key] ?? GRIP_OFFSETS[key]
        expect(v, `${key} has an offset`).toBeTruthy()
        for (const f of fitFingers(t, rig.hands[side], composeOffset(v))) {
          if (LOG) appendFileSync(LOG, `${t.key} agent_${i} ${f.finger} err ${(f.err * 1000).toFixed(2)} mm off ${(f.off * 1000).toFixed(2)} mm (joints ${f.joints.map((x) => x.toFixed(0)).join('/')})\n`)
          if (!write) expect(f.err, `${t.key} agent_${i} ${f.finger}`).toBeLessThanOrEqual(0.003)
          if (!write) expect(f.off, `${t.key} agent_${i} ${f.finger} not through the surface`).toBeGreaterThanOrEqual(-1e-4)
        }
      }
    }
    // FIT_PART=<file.json>: write only the recomputed entries there (several runs side by side, merged by hand), not the data file
    if (write && process.env.FIT_PART) {
      const mine = Object.fromEntries(Object.entries(out).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(GRIP_OFFSETS[k])))
      writeFileSync(process.env.FIT_PART, JSON.stringify(mine))
    } else if (write) {
      const body = Object.entries(out).map(([k, v]) => `  '${k}': [${v.join(', ')}],`).join('\n')
      writeFileSync(new URL('./gripFit.data.ts', import.meta.url), `// Generated by gripFit.test.ts (FIT_WRITE=1): the hand's offset from "grip frame on grip frame" for each object (x y z, Euler XYZ), in the hand's frame.\nexport const GRIP_OFFSETS: Record<string, readonly number[]> = {\n${body}\n}\n`)
    }
  }, 1800000)
})
