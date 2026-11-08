import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AlwaysStencilFunc, BufferAttribute, CanvasTexture, Color, EqualStencilFunc, MeshBasicMaterial, ReplaceStencilOp, SRGBColorSpace, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three'
import { meshesOf } from './nodes'
import { LIGHT_COOL, LIGHT_LEVEL, LIGHT_WARM, litWindows, outsideAt, silhouette, type OutsideLook } from './outside'
import { kstMinutes } from './kst'
import { officeNow, type OfficeWorld } from './world'

// The window's view (#111): layered cards behind the north wall (sky 40 m, skyline 25, mid 12, near 6) drawn ONLY
// through the window, with the stencil buffer. The `window_portal` quad is the window hole: it writes stencil 1 (no
// colour, no depth); the cards draw only where stencil = 1. The portal belongs to the wall (clipped with it), so a
// lowered north wall takes the view with it. Needs Canvas gl.stencil and an EffectComposer with stencilBuffer.
// Time of day comes from the office clock (real KST, or the ?debug kst override); a timelapse replay keeps it too.

const CARD_ORDER = 2
const LAYERS: { node: string; depth: 'far' | 'mid' | 'near' }[] = [
  { node: 'window_skyline', depth: 'far' },
  { node: 'window_mid', depth: 'mid' },
  { node: 'window_near', depth: 'near' },
]

function stencilMat(m: MeshBasicMaterial) {
  m.stencilWrite = true
  m.stencilRef = 1
  m.stencilFunc = EqualStencilFunc
  m.toneMapped = false
  return m
}

function setAll(node: Object3D | undefined, mat: Material, order: number) {
  if (!node) return
  for (const m of meshesOf(node) as Mesh[]) {
    m.material = mat
    m.renderOrder = order
  }
}

/** the window cells of the lights card (connected quads; the card has no UVs), found once per geometry */
function cellsOf(g: BufferGeometry): { tris: number[][] } {
  const cached = g.userData.cells as { tris: number[][] } | undefined
  if (cached) return cached
  const p = g.getAttribute('position')
  const ix = g.index
  const n = (ix ? ix.count : p.count) / 3
  const key = (i: number) => `${Math.round(p.getX(i) * 2000)},${Math.round(p.getY(i) * 2000)},${Math.round(p.getZ(i) * 2000)}`
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)!)!)
      k = parent.get(k)!
    }
    return k
  }
  const ids: string[][] = []
  for (let t = 0; t < n; t++) {
    const k = [0, 1, 2].map((j) => key(ix ? ix.getX(t * 3 + j) : t * 3 + j))
    for (const x of k) if (!parent.has(x)) parent.set(x, x)
    parent.set(find(k[0]), find(k[1]))
    parent.set(find(k[1]), find(k[2]))
    ids.push(k)
  }
  const by = new Map<string, number[]>()
  ids.forEach((k, t) => by.set(find(k[0]), [...(by.get(find(k[0])) ?? []), t]))
  const cells = { tris: [...by.values()] }
  g.userData.cells = cells
  g.userData.fullIndex = ix ? Array.from(ix.array) : Array.from({ length: p.count }, (_, i) => i)
  return cells
}

/** the window-light cards (#123): the 12 m buildings, and the 25 m skyline at half the lit share (designer) */
interface LightLayer {
  node: string
  share: number
  seed: number
}
export const LIGHT_LAYERS: readonly LightLayer[] = [
  { node: 'window_lights', share: 1, seed: 0 },
  { node: 'window_lights_far', share: 0.5, seed: 1009 },
]

/** light the cells chosen for this KST hour: only the lit ones are drawn (index subset), warm or cool by vertex colour */
function paintLights(m: Mesh, look: OutsideLook, layer: LightLayer) {
  const g = m.geometry
  const { tris } = cellsOf(g)
  const full = g.userData.fullIndex as number[]
  // the far skyline lights half as many windows; its own seed offset keeps the two patterns from lining up
  const { lit, cool } = litWindows(tris.length, look.lights * layer.share, Number(look.key.split(':').pop()) + layer.seed)
  const count = g.getAttribute('position').count
  const col = new Float32Array(count * 3)
  const warm = new Color(LIGHT_WARM).multiplyScalar(LIGHT_LEVEL)
  const cold = new Color(LIGHT_COOL).multiplyScalar(LIGHT_LEVEL)
  const index: number[] = []
  tris.forEach((ts, c) => {
    if (!lit[c]) return
    const color = cool[c] ? cold : warm
    for (const t of ts)
      for (let j = 0; j < 3; j++) {
        const v = full[t * 3 + j]
        index.push(v)
        col.set([color.r, color.g, color.b], v * 3)
      }
  })
  g.setAttribute('color', new BufferAttribute(col, 3))
  g.setIndex(index)
  m.visible = index.length > 0
}

export function Outside({ nodes, world }: { nodes: Record<string, Object3D>; world: OfficeWorld }) {
  const parts = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const tex = new CanvasTexture(canvas)
    tex.flipY = false // glTF UV: v = 0 is the top row, the sky's top
    tex.colorSpace = SRGBColorSpace
    const sky = stencilMat(new MeshBasicMaterial({ map: tex }))
    const layers = LAYERS.map((l) => ({ ...l, mat: stencilMat(new MeshBasicMaterial()) }))
    // always opaque: how many windows are lit changes, not how bright (outside.ts litWindows)
    const lights = stencilMat(new MeshBasicMaterial({ vertexColors: true }))
    const portal = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    portal.stencilWrite = true
    portal.stencilRef = 1
    portal.stencilFunc = AlwaysStencilFunc
    portal.stencilZPass = ReplaceStencilOp
    return { canvas, tex, sky, layers, lights, portal }
  }, [])

  useEffect(() => {
    setAll(nodes.window_sky, parts.sky, CARD_ORDER)
    for (const l of parts.layers) setAll(nodes[l.node], l.mat, CARD_ORDER)
    // every light card gets the stencil material, or it would float over the room as a plain neon plane
    for (const l of LIGHT_LAYERS) setAll(nodes[l.node], parts.lights, CARD_ORDER)
    setAll(nodes.window_portal, parts.portal, 1)
    return () => {
      parts.tex.dispose()
    }
  }, [nodes, parts])

  const key = useRef('')
  const frames = useRef(0)
  useFrame(() => {
    // the look only changes by the minute: check twice a second, repaint on a new key
    if (frames.current++ % 30 !== 0) return
    const look: OutsideLook = outsideAt(kstMinutes(officeNow(world)))
    if (look.key === key.current) return
    key.current = look.key
    const ctx = parts.canvas.getContext('2d')
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, parts.canvas.height)
      g.addColorStop(0, look.top)
      g.addColorStop(1, look.bottom)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, parts.canvas.width, parts.canvas.height)
      parts.tex.needsUpdate = true
    }
    for (const l of parts.layers) l.mat.color.set(silhouette(look, l.depth))
    for (const l of LIGHT_LAYERS) for (const m of nodes[l.node] ? meshesOf(nodes[l.node]) : []) paintLights(m, look, l)
  })
  return null
}
