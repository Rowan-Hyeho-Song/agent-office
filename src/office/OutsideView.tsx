import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AlwaysStencilFunc, CanvasTexture, Color, EqualStencilFunc, MeshBasicMaterial, ReplaceStencilOp, SRGBColorSpace, type Material, type Mesh, type Object3D } from 'three'
import { meshesOf } from './nodes'
import { outsideAt, silhouette, type OutsideLook } from './outside'
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
    const lights = stencilMat(new MeshBasicMaterial({ color: '#ffcf8a', transparent: true, depthWrite: false }))
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
    setAll(nodes.window_lights, parts.lights, CARD_ORDER)
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
    for (const l of parts.layers) l.mat.color.set(new Color(silhouette(look, l.depth)))
    parts.lights.opacity = look.lights
    parts.lights.visible = look.lights > 0
    for (const m of nodes.window_lights ? meshesOf(nodes.window_lights) : []) m.visible = look.lights > 0
  })
  return null
}
