import { useEffect } from 'react'
import { CanvasTexture, MeshBasicMaterial, NearestFilter, SRGBColorSpace, type Object3D } from 'three'
import { afterFirstScreen } from './atlases'
import { containRect, frameOfNode, posterOf } from './framePosters'
import { meshesOf } from './nodes'

const FACE_BG = '#05080b'
/** the face canvas is this wide in px (the posters are 512 wide; nearest scales the pixel art up on screen) */
const FACE_W = 512

/**
 * The posters on the three wall frames (lounge-props.md 6): loaded after the first screen has been shown (#402: ~35 KB that the first screen does not need; the faces are dark until they arrive), painted
 * onto a canvas of the face's own aspect (letterboxed, no stretching, nearest). A poster that fails to load leaves its face dark.
 */
export function Frames({ nodes }: { nodes: Record<string, Object3D> }) {
  useEffect(() => {
    let dead = false
    const made: CanvasTexture[] = []
    const base = import.meta.env.BASE_URL ?? '/'
    const cancel = afterFirstScreen(() => {
      for (const [name, node] of Object.entries(nodes)) {
        const k = frameOfNode(name, node.userData)
        const file = k === null ? null : posterOf(k)
        if (!file) continue
        const aspect = Number(node.userData.aspect) > 0 ? Number(node.userData.aspect) : 0.75
        const img = new Image()
        img.onload = () => {
          if (dead) return
          try {
            const c = document.createElement('canvas')
            c.width = FACE_W
            c.height = Math.round(FACE_W / aspect)
            const ctx = c.getContext('2d')!
            ctx.fillStyle = FACE_BG
            ctx.fillRect(0, 0, c.width, c.height)
            ctx.imageSmoothingEnabled = false
            const r = containRect(c.width, c.height, img.naturalWidth, img.naturalHeight)
            ctx.drawImage(img, r.x, r.y, r.w, r.h)
            const texture = new CanvasTexture(c)
            texture.flipY = false // glTF UV convention (the door screen does the same)
            texture.colorSpace = SRGBColorSpace
            texture.magFilter = NearestFilter
            texture.anisotropy = 8
            made.push(texture)
            for (const m of meshesOf(node)) {
              const mat = m.material as MeshBasicMaterial
              mat.map = texture
              mat.color.set('#ffffff')
              mat.needsUpdate = true
            }
          } catch {
            /* the face stays dark */
          }
        }
        img.onerror = () => {}
        img.src = `${base}posters/${file}.png`
      }
    })
    return () => {
      dead = true
      cancel()
      for (const t of made) t.dispose()
    }
  }, [nodes])
  return null
}
