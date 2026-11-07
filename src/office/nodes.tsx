import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
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
import type { NavKind, NavSpot } from './nav'

// The office from assets/blender/office_bake.py: one glb + four baked atlases (same contract as the
// rowansong.dev desk). Node extras -> userData:
//   atlas: "<name>"  baked: MeshBasicMaterial + that atlas, no runtime lighting
//   live:  "<kind>"  bot: agent parts, real-time lit (they hover and move), keep their PBR material
//                    screen / face / neon / door: emitters the app drives
//   nav:   "<kind>"  empties: where agents go and which way they face (navigation graph: nav.ts)

export const MODEL_URL = '/models/office.glb'
export const ATLASES = ['room', 'work', 'wall_items', 'lounge'] as const
const ATLAS_URLS = ATLASES.map((a) => `/models/${a}.webp`)

/** runtime glow per live kind (the bake used its own strengths for the light the emitters cast) */
const GLOW: Record<string, number> = { screen: 1.1, face: 1.4, neon: 2.6, door: 1.0 }

export type OfficeNodes = Record<string, Object3D>

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
 * meshes, or its pivot (extras pivot_at + the node's rotation) for parts that will move (agents, heads).
 *
 * A node is not always one Mesh: a multi-material node loads as a Group of primitive meshes, and a node with
 * glTF children (an arm with its hand empty) gets its mesh moved into an unnamed child by meshopt. So every
 * mesh under the node is baked straight into the node's frame and hung directly under it; named empties
 * (hands) are re-hung keeping their world pose; unnamed in-between nodes are dropped.
 * Normals are kept only where light is computed at runtime (the agents).
 *
 * The pivot is read from `pivot_at`: three's GLTFLoader treats a plain `pivot` extra on a node with children
 * as a GLTFExporter pivot container and rewrites it. `pivot` is still read for models exported before that.
 */
function rebase(node: Object3D, lit: boolean) {
  const pivot = (node.userData.pivot_at ?? node.userData.pivot) as [number, number, number] | undefined
  node.updateWorldMatrix(true, true)
  const frame = new Matrix4()
  if (pivot) frame.compose(new Vector3(...pivot), node.getWorldQuaternion(new Quaternion()), new Vector3(1, 1, 1))
  const inv = frame.clone().invert()
  const bake = (m: Mesh, world: Matrix4) => {
    const g = m.geometry.clone()
    g.setAttribute('position', toFloats(g.getAttribute('position')))
    if (lit && g.getAttribute('normal')) g.setAttribute('normal', toFloats(g.getAttribute('normal')))
    else g.deleteAttribute('normal') // baked and emissive materials are unlit
    g.applyMatrix4(inv.clone().multiply(world))
    g.computeBoundingSphere()
    m.geometry = g
  }
  const below: [Object3D, Matrix4][] = []
  node.traverse((o) => {
    if (o !== node) below.push([o, o.matrixWorld.clone()])
  })
  if (node instanceof Mesh) bake(node, node.matrixWorld.clone())
  for (const [o] of below) o.removeFromParent()
  const parentInv = node.parent ? node.parent.matrixWorld.clone().invert() : new Matrix4()
  parentInv.multiply(frame).decompose(node.position, node.quaternion, node.scale)
  for (const [o, world] of below) {
    if (o instanceof Mesh) {
      bake(o, world)
      o.position.set(0, 0, 0)
      o.quaternion.identity()
      o.scale.set(1, 1, 1)
    } else if (o.name) {
      inv.clone().multiply(world).decompose(o.position, o.quaternion, o.scale)
    } else continue
    node.add(o)
  }
}

/** the meshes that make up a node (itself, or the primitives hung under it) */
export const meshesOf = (node: Object3D) => {
  const out: Mesh[] = []
  node.traverse((o) => {
    if (o instanceof Mesh) out.push(o)
  })
  return out
}

function prepare(scene: Object3D, atlases: Texture[]): OfficeNodes {
  // once per loaded scene: React StrictMode runs memos twice in development, and a second pass would find
  // the materials already swapped (no emissive left to read)
  if (scene.userData.nodes) return scene.userData.nodes as OfficeNodes
  const nodes: OfficeNodes = {}
  scene.userData.nodes = nodes
  const byName = Object.fromEntries(ATLASES.map((a, i) => [a, atlases[i]]))
  // the glb is flat: every exported node sits at the top level (nav empties carry no atlas / live)
  const top = scene.children.filter((o) => o.userData.atlas || o.userData.live)
  for (const node of top) {
    const { atlas, live } = node.userData as { atlas?: string; live?: string }
    // agents and the props they hold (#20, #27) move, so they keep their PBR material and real-time light
    const lit = live === 'bot' || live === 'prop'
    rebase(node, lit)
    for (const o of meshesOf(node)) {
      const src = o.material as MeshStandardMaterial
      let material: Material = src
      if (lit) {
        // keep the exported PBR material: agents and props take the scene's real-time lights
      } else if (atlas) {
        material = new MeshBasicMaterial({ map: byName[atlas] })
      } else if (live) {
        const color = src.emissive.clone().multiplyScalar(GLOW[live] ?? 2)
        o.userData.baseColor = color.clone()
        material = new MeshBasicMaterial({ color, toneMapped: false })
      }
      if (material !== src) src.dispose()
      o.material = material
    }
    node.traverse((o) => {
      if (o.name && !nodes[o.name]) nodes[o.name] = o // a primitive may repeat its node's name
    })
  }
  return nodes
}

/** the nav_* empties as plain data (id without the prefix) */
function navSpots(scene: Object3D): NavSpot[] {
  const spots: NavSpot[] = []
  scene.traverse((o) => {
    const { nav, ry } = o.userData as { nav?: NavKind; ry?: number }
    if (!nav || !o.name.startsWith('nav_')) return
    spots.push({ id: o.name.slice(4), x: o.position.x, z: o.position.z, ry: ry ?? 0, kind: nav })
  })
  return spots
}

/** the loaded office: the glb scene with baked / live materials applied, its meshes by name, its nav spots */
export function useOffice() {
  const { scene } = useLoader(GLTFLoader, MODEL_URL, withMeshopt)
  const atlases = useLoader(TextureLoader, ATLAS_URLS)
  return useMemo(() => {
    for (const t of atlases) {
      t.flipY = false // glTF UV convention
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 8
    }
    return { scene, nodes: prepare(scene, atlases), spots: navSpots(scene) }
  }, [scene, atlases])
}

useLoader.preload(GLTFLoader, MODEL_URL, withMeshopt)
