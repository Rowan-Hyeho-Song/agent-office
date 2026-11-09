import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { REST_PALM, palmDown } from './rig'

// #178: the new hand (#148) is a different frame from the old glove. The palm normal is the hand node's local +z (the
// fingers bend toward it, +y is along the fingers). This reads the baked rest pose from the model itself, so a re-bake
// that turns the hands, or a sign flip in the app's "palm down", fails here instead of on screen.
type GltfNode = { name: string; rotation?: number[] }
// node:fs through a path the app's type check does not follow (the app tsconfig has no Node types)
const fsModule = 'node:fs'
async function nodes(): Promise<Record<string, GltfNode>> {
  const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (p: URL) => Uint8Array }
  const buf = readFileSync(new URL('../../public/models/office.glb', import.meta.url))
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len))) as { nodes: GltfNode[] }
  return Object.fromEntries(json.nodes.map((n) => [n.name, n]))
}
const q = (n: GltfNode | undefined) => new Quaternion(...((n?.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]))

describe('hand frame (#178)', async () => {
  const all = await nodes()
  for (const i of [0, 1, 2, 3, 4])
    for (const side of ['l', 'r'] as const) {
      const hand = all[`agent_${i}_hand_${side}`]
      it(`agent_${i} ${side}: at rest the palm faces the body's centre line, and "palm down" turns it to the floor`, () => {
        expect(hand).toBeDefined()
        // the palm in the agent's own frame (forward = −z, right = +x)
        const rest = new Vector3(0, 0, 1).applyQuaternion(q(hand)).applyQuaternion(q(all[`agent_${i}`]).invert())
        expect(rest.dot(new Vector3(...REST_PALM[side]))).toBeGreaterThan(0.9)
        expect(rest.clone().applyQuaternion(palmDown(side)).y).toBeLessThan(-0.9)
      })
    }
})
