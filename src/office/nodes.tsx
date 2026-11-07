import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// The office from assets/blender/office_bake.py: one glb + four baked atlases (same contract as the
// rowansong.dev desk). Node extras -> userData:
//   atlas: "<name>"  baked: MeshBasicMaterial + that atlas, no runtime lighting
//   live:  "<kind>"  bot: agent parts, real-time lit (they hover and move), keep their PBR material
//                    screen / face / neon / door: emitters the app drives
//   nav:   "<kind>"  empties: where agents go and which way they face (navigation graph, later)

export const MODEL_URL = '/models/office.glb'
export const ATLASES = ['room', 'work', 'wall_items', 'lounge'] as const
const ATLAS_URLS = ATLASES.map((a) => `/models/${a}.webp`)

/** runtime glow per live kind (the bake used its own strengths for the light the emitters cast) */
const GLOW: Record<string, number> = { screen: 1.1, face: 1.4, neon: 2.6, door: 1.0 }

export type OfficeNodes = Record<string, Mesh>

const withMeshopt = (loader: GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder)
}

const toFloats = (a: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }) => {
  const out = new Float32Array(a.count * 3)
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i)
    out[i * 3 + 1] = a.getY(i)
    out[i * 3 + 2] = a.getZ(i)
  }
  return new BufferAttribute(out, 3)
}

/**
 * meshopt quantization stores positions as normalized int16 and folds the dequantize scale/offset into the
 * node transform. Bake that back into float vertices so each node is a clean frame: identity for static
 * meshes, or its pivot (userData.pivot + the node's rotation) for parts that will move (agents, heads).
 * Normals are kept only where light is computed at runtime (the agents).
 */
function rebase(o: Mesh, lit: boolean) {
  const pivot = o.userData.pivot as [number, number, number] | undefined
  o.updateMatrix()
  const frame = new Matrix4()
  if (pivot) frame.compose(new Vector3(...pivot), o.quaternion.clone(), new Vector3(1, 1, 1))
  const g = o.geometry.clone()
  g.setAttribute('position', toFloats(g.getAttribute('position')))
  if (lit && g.getAttribute('normal')) g.setAttribute('normal', toFloats(g.getAttribute('normal')))
  else g.deleteAttribute('normal') // baked and emissive materials are unlit
  g.applyMatrix4(frame.clone().invert().multiply(o.matrix))
  g.computeBoundingSphere()
  o.geometry = g
  frame.decompose(o.position, o.quaternion, o.scale)
}

function prepare(scene: Object3D, atlases: Texture[]): OfficeNodes {
  // once per loaded scene: React StrictMode runs memos twice in development, and a second pass would find
  // the materials already swapped (no emissive left to read)
  if (scene.userData.nodes) return scene.userData.nodes as OfficeNodes
  const nodes: OfficeNodes = {}
  scene.userData.nodes = nodes
  const byName = Object.fromEntries(ATLASES.map((a, i) => [a, atlases[i]]))
  const meshes: Mesh[] = []
  scene.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o)
  })
  for (const o of meshes) {
    const { atlas, live } = o.userData as { atlas?: string; live?: string }
    rebase(o, live === 'bot')
    const src = o.material as MeshStandardMaterial
    let material: Material = src
    if (live === 'bot') {
      // keep the exported PBR material: agents take the scene's real-time lights
    } else if (atlas) {
      material = new MeshBasicMaterial({ map: byName[atlas] })
    } else if (live) {
      const color = src.emissive.clone().multiplyScalar(GLOW[live] ?? 2)
      o.userData.baseColor = color.clone()
      material = new MeshBasicMaterial({ color, toneMapped: false })
    }
    if (material !== src) src.dispose()
    o.material = material
    nodes[o.name] = o
  }
  return nodes
}

/** the loaded office: the glb scene with baked / live materials applied, and its meshes by name */
export function useOffice() {
  const { scene } = useLoader(GLTFLoader, MODEL_URL, withMeshopt)
  const atlases = useLoader(TextureLoader, ATLAS_URLS)
  return useMemo(() => {
    for (const t of atlases) {
      t.flipY = false // glTF UV convention
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 8
    }
    return { scene, nodes: prepare(scene, atlases) }
  }, [scene, atlases])
}

useLoader.preload(GLTFLoader, MODEL_URL, withMeshopt)
