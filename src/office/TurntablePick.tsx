import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3, type BoxGeometry, type Mesh, type Object3D } from 'three'
import { getPanel, setTurntableBox, togglePanel, type Box } from '../audio/panelState'
import { hitBox, useCanvasPick } from './pick'

// The turntable as the sound settings' door (#353, docs/design/office-ui.md 11.4): hover = cyan outline + the tag
// '소리 설정', a click opens the panel (a second one closes it). The model's `hit_turntable` empty is the press box
// (about 0.46 x 0.16 x 0.36). The baked model does not have it yet (the lounge turntable is still to be baked): until it
// does there is nothing to press and nothing is drawn. The panel never touches the record: nothing here spins or stops it.

export const TURNTABLE_BOX = [0.46, 0.16, 0.36] as const
/** a finger is bigger than a cursor: the box grows 1.5 times on touch (the turntable is small in the default view) */
export const TOUCH_SCALE = 1.5

/** the press box: the model's hit_turntable, 1.5x on touch; null while the model has none */
export function turntableTarget(scene: Object3D, touch: boolean): Mesh | null {
  const box = hitBox(scene, 'turntable')
  if (box && touch) {
    box.scale.setScalar(TOUCH_SCALE)
    box.updateMatrixWorld(true)
  }
  return box
}

const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)))

export function TurntablePick({ scene }: { scene: Object3D }) {
  const { gl, camera } = useThree()
  const box = useMemo(() => turntableTarget(scene, matchMedia('(pointer: coarse)').matches), [scene])
  const ui = useRef<{ el: HTMLDivElement; tag: HTMLSpanElement } | null>(null)
  const hover = useRef(false)
  const tmp = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'tt-outline'
    el.setAttribute('aria-hidden', 'true')
    const tag = document.createElement('span')
    tag.className = 'tt-tag'
    tag.textContent = '소리 설정'
    el.append(tag)
    document.body.appendChild(el)
    ui.current = { el, tag }
    return () => {
      el.remove()
      ui.current = null
      setTurntableBox(null)
    }
  }, [])

  useCanvasPick(
    () => (box ? [box] : []),
    () => {
      // the outside-click rule in SoundPanel skips a click that is this pick's own (it toggles)
      const root = document.documentElement
      root.dataset.turntablePick = '1'
      setTimeout(() => delete root.dataset.turntablePick, 0)
      const back = togglePanel('turntable', gl.domElement)
      if (back) {
        back.setAttribute('tabindex', '-1')
        back.focus({ preventScroll: true })
      }
      const o = ui.current?.el
      if (o) {
        o.dataset.press = '1'
        setTimeout(() => delete o.dataset.press, 80)
      }
    },
    (over) => (hover.current = over),
  )

  // every frame: the box on the screen (the panel follows it, the outline sits on it)
  useFrame(() => {
    const u = ui.current
    if (!u || !box) return
    const open = getPanel().open && getPanel().from === 'turntable'
    const r = gl.domElement.getBoundingClientRect()
    const b: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    let front = true
    const { width, height, depth } = (box.geometry as BoxGeometry).parameters
    for (const [x, y, z] of corners) {
      tmp.set((x * width) / 2, (y * height) / 2, (z * depth) / 2).applyMatrix4(box.matrixWorld).project(camera)
      if (tmp.z >= 1) front = false
      const sx = r.left + ((tmp.x + 1) / 2) * r.width
      const sy = r.top + ((1 - tmp.y) / 2) * r.height
      b.left = Math.min(b.left, sx)
      b.right = Math.max(b.right, sx)
      b.top = Math.min(b.top, sy)
      b.bottom = Math.max(b.bottom, sy)
    }
    if (!front) {
      setTurntableBox(null)
      u.el.dataset.show = '0'
      return
    }
    setTurntableBox(b)
    const show = hover.current || open
    u.el.dataset.show = show ? '1' : '0'
    u.el.dataset.open = open ? '1' : '0'
    u.el.dataset.hover = hover.current ? '1' : '0'
    u.el.style.transform = `translate(${b.left}px, ${b.top}px)`
    u.el.style.width = `${b.right - b.left}px`
    u.el.style.height = `${b.bottom - b.top}px`
  })
  return null
}
