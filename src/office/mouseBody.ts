// The mouse as a live body (#305, #280): the baked desk has the pad but no mouse; the glb's `desk_<i>_mouse` is a node whose pivot is the
// body's bottom centre, with its buttons, wheel, finger contacts, hand place and contact shadow re-hung under it once at load, so that
// moving the body moves them all. Its extras: `pad` {center [x, z], half [x, z]} (the room the body may roam, in the body's REST frame
// x / z, centre-relative to the pivot at rest) and `size`. Pure maths (the slides of the schedule, the clamp) plus the one-time rig.

import { DataTexture, LinearFilter, MeshBasicMaterial, Mesh, NoColorSpace, RGBAFormat, UnsignedByteType, type Material, type Object3D } from 'three'

export interface MousePad {
  /** centre of the pad in the body's rest frame (x right, z toward the typist), m */
  cx: number
  cz: number
  /** half extents */
  hx: number
  hz: number
}
/** the glb's pad when the extras are missing (the baked desk: 25 x 21 cm, 3 cm toward the typist) */
export const DEFAULT_PAD: MousePad = { cx: 0, cz: 0.03, hx: 0.125, hz: 0.105 }

export function padOf(extras: unknown): MousePad {
  const p = extras as { center?: unknown; half?: unknown } | undefined
  const c = p?.center as number[] | undefined
  const h = p?.half as number[] | undefined
  if (!Array.isArray(c) || !Array.isArray(h) || c.length < 2 || h.length < 2) return DEFAULT_PAD
  const v = [c[0], c[1], h[0], h[1]].map(Number)
  if (!v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) return DEFAULT_PAD
  return { cx: v[0], cz: v[1], hx: v[2], hz: v[3] }
}

/** a body offset (rest frame x, z) kept inside the pad rectangle */
export function clampToPad(x: number, z: number, pad: MousePad): { x: number; z: number } {
  return {
    x: Math.min(pad.cx + pad.hx, Math.max(pad.cx - pad.hx, x)),
    z: Math.min(pad.cz + pad.hz, Math.max(pad.cz - pad.hz, z)),
  }
}

/** one slide of the body in the rest frame (typingSchedule.ts MouseSlide): by (dx, dz) from where it is, or `home` back to rest */
export interface SlideLike {
  t0: number
  t1: number
  dx: number
  dz: number
  home?: boolean
}

/** where each slide ends, integrated from rest and clamped to the pad (x, z pairs) */
export function slideTargets(slides: readonly SlideLike[], pad: MousePad): Float64Array {
  const out = new Float64Array(slides.length * 2)
  let x = 0
  let z = 0
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    if (s.home) {
      x = 0
      z = 0
    } else {
      const c = clampToPad(x + s.dx, z + s.dz, pad)
      x = c.x
      z = c.z
    }
    out[i * 2] = x
    out[i * 2 + 1] = z
  }
  return out
}

const smooth = (k: number) => {
  const c = k < 0 ? 0 : k > 1 ? 1 : k
  return c * c * (3 - 2 * c)
}

/** the body's offset at time t: at rest before the first slide, eased from one end to the next during a slide, held between (a function of t alone) */
export function offsetAt(slides: readonly SlideLike[], targets: Float64Array, t: number, out: { x: number; z: number }) {
  let px = 0
  let pz = 0
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    if (t < s.t0) break
    const tx = targets[i * 2]
    const tz = targets[i * 2 + 1]
    if (t < s.t1) {
      const k = smooth((t - s.t0) / Math.max(1e-6, s.t1 - s.t0))
      out.x = px + (tx - px) * k
      out.z = pz + (tz - pz) * k
      return out
    }
    px = tx
    pz = tz
  }
  out.x = px
  out.z = pz
  return out
}

// ---------------------------------------------------------------------------------------------------------------- the rig

/** what hangs under a mouse body, by name suffix */
const PARTS = ['_l', '_r', '_wheel', '_contact_index', '_contact_middle', '_grip_r', '_shadow'] as const

/**
 * The contact shadow's soft blob: black, alpha falling from `centre` in the middle to 0 at the edge. A data texture (no canvas), so tests
 * and the app build the same one.
 */
export function shadowTexture(size = 32, centre = 0.35): DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1
      const v = ((j + 0.5) / size) * 2 - 1
      const r = Math.hypot(u, v)
      const k = 1 - smooth((r - 0.25) / 0.75) // flat in the middle quarter, soft to the edge
      data[(j * size + i) * 4 + 3] = Math.round(255 * centre * k)
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  tex.colorSpace = NoColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/** unlit, alpha-blended, no depth write, nudged toward the camera so it never z-fights the desk top */
export function shadowMaterial(map: DataTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: '#000000', map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false })
}

/**
 * Once per loaded scene: every `desk_<i>_mouse` takes its buttons, wheel, finger contacts, hand place and shadow as children, keeping their
 * world transforms, and the shadow plate gets its soft material. Idempotent.
 */
export function rigMouseBodies(scene: Object3D, nodes: Record<string, Object3D>): number {
  let n = 0
  let tex: DataTexture | null = null
  for (let i = 0; i < 8; i++) {
    const body = nodes[`desk_${i}_mouse`]
    if (!body || body.userData.mouseRigged) continue
    body.userData.mouseRigged = true
    scene.updateMatrixWorld(true)
    for (const part of PARTS) {
      const o = scene.getObjectByName(`desk_${i}_mouse${part}`)
      if (o && o.parent !== body) body.attach(o)
    }
    const shadow = nodes[`desk_${i}_mouse_shadow`]
    if (shadow) {
      tex ??= shadowTexture()
      shadow.traverse((o) => {
        if (!(o instanceof Mesh)) return
        ;(o.material as Material).dispose()
        o.material = shadowMaterial(tex!)
        o.renderOrder = 1
        o.castShadow = false
        o.receiveShadow = false
      })
    }
    n++
  }
  return n
}
