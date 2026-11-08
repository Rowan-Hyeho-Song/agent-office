/// <reference types="node" />
// Loads public/models/office.glb in Node (tests, measurements): the same prepare() the app runs, without textures.
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Object3D } from 'three'
import { prepare, type OfficeNodes } from './nodes'

export async function loadOffice(): Promise<{ scene: Object3D; nodes: OfficeNodes }> {
  const buf = readFileSync(new URL('../../public/models/office.glb', import.meta.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await new Promise<{ scene: Object3D }>((res, rej) => loader.parse(ab, '', res, rej))
  const nodes = prepare(gltf.scene, [])
  return { scene: gltf.scene, nodes }
}

/** buildRig draws a radial alpha on a canvas; Node has none, so this stands in (the pixels are never read) */
export function stubCanvas() {
  const g = globalThis as { document?: unknown }
  if (g.document) return
  const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' }
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
}
