import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3, type BoxGeometry, type Mesh, type Object3D } from 'three'
import { DESK_URL, leaveOffice } from '../room/link'
import { AGENT_OFFICE_REPO_URL, FRAME_LINKS, linkOf } from './framePosters'
import { hitBox, useCanvasPick } from './pick'

// The three wall frames as links (docs/design/lounge-props.md 6, office-ui.md 11.4's hover): hover = cyan outline + the project's name, a click opens its page. The model's
// `hit_frame_<k>` empties (extras {hit: 'frame', size, frame: k}) are the press boxes; a model without them has nothing to press and nothing is drawn.

const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)))

/** the page a frame opens */
export function openFrame(k: number) {
  const link = linkOf(k)
  if (!link) return
  if (link.go === 'desk') leaveOffice('door')
  else window.open(link.go === 'site' ? DESK_URL : AGENT_OFFICE_REPO_URL, '_blank', 'noopener,noreferrer')
}

/** the frames' press boxes (the wall's own fade rule applies: a frame on a faded wall cannot be pressed) */
export function frameBoxes(scene: Object3D): Mesh[] {
  const out: Mesh[] = []
  FRAME_LINKS.forEach((_, k) => {
    const box = hitBox(scene, 'frame', `hit_frame_${k}`)
    if (!box) return
    box.userData.frame = k
    box.userData.wall = 'w'
    out.push(box)
  })
  return out
}

export function FramePick({ scene }: { scene: Object3D }) {
  const { gl, camera } = useThree()
  const boxes = useMemo(() => frameBoxes(scene), [scene])
  const ui = useRef<{ el: HTMLDivElement; tag: HTMLSpanElement } | null>(null)
  const hover = useRef<number | null>(null)
  const tmp = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'tt-outline'
    el.setAttribute('aria-hidden', 'true')
    const tag = document.createElement('span')
    tag.className = 'tt-tag'
    el.append(tag)
    document.body.appendChild(el)
    ui.current = { el, tag }
    return () => {
      el.remove()
      ui.current = null
    }
  }, [])

  useCanvasPick(
    () => boxes,
    (hits) => {
      const k = hits[0]?.object.userData.frame
      if (typeof k !== 'number') return
      const o = ui.current?.el
      if (o) {
        o.dataset.press = '1'
        setTimeout(() => delete o.dataset.press, 80)
      }
      openFrame(k)
    },
    (over, hits) => (hover.current = over ? ((hits?.[0]?.object.userData.frame as number | undefined) ?? null) : null),
  )

  useFrame(() => {
    const u = ui.current
    const k = hover.current
    if (!u) return
    const box = k === null ? null : boxes.find((b) => b.userData.frame === k)
    if (!box || k === null) {
      u.el.dataset.show = '0'
      return
    }
    const r = gl.domElement.getBoundingClientRect()
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    let front = true
    const { width, height, depth } = (box.geometry as BoxGeometry).parameters
    for (const [x, y, z] of corners) {
      tmp.set((x * width) / 2, (y * height) / 2, (z * depth) / 2).applyMatrix4(box.matrixWorld).project(camera)
      if (tmp.z >= 1) front = false
      const sx = r.left + ((tmp.x + 1) / 2) * r.width
      const sy = r.top + ((1 - tmp.y) / 2) * r.height
      left = Math.min(left, sx)
      right = Math.max(right, sx)
      top = Math.min(top, sy)
      bottom = Math.max(bottom, sy)
    }
    if (!front) {
      u.el.dataset.show = '0'
      return
    }
    u.tag.textContent = FRAME_LINKS[k].name
    u.el.dataset.show = '1'
    u.el.dataset.hover = '1'
    u.el.style.transform = `translate(${left}px, ${top}px)`
    u.el.style.width = `${right - left}px`
    u.el.style.height = `${bottom - top}px`
  })
  return null
}
