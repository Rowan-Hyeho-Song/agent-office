import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Quaternion, Vector3, type BoxGeometry, type Material, type Object3D } from 'three'
import { isReplayActive } from '../replay/store'
import { useCameraBusy } from '../room/Door'
import { useRole } from './ApprovalBox'
import { KEY_RACK, KEY_RACK_LABEL, grow, keyAppear, keyRackTarget, keySwing, press, rackNormal, rackTag, tagPlace, type Rect } from './keyRackRules'
import { meshesOf } from './nodes'
import { useCanvasPick } from './pick'
import { isTouring } from './tourStore'
import { WALL_CUT, wallOf } from './walls'
import { prefersReducedMotion, type OfficeWorld } from './world'

// The key rack by the entrance door as the owner's sign-in (#475, office-ui.md 13.3–13.6). The model's hit_keyrack is the press
// box (1.5x on touch); a real 44 px button sits on the rack for the keyboard, screen readers and fingers. Hover or focus: cyan
// outline, a tag, and (signed out) the key swings once. Signed in, the key (live keyrack_key) is off the hook on this screen only.

const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)))
const X = new Vector3(1, 0, 0)

/** the HUD's OWNER tag: blink it twice (not with reduced motion) and put the focus on its 나가기 button */
function toOwnerTag() {
  const tag = document.querySelector<HTMLElement>('.owner-tag')
  if (!tag) return
  if (!prefersReducedMotion()) {
    delete tag.dataset.blink
    void tag.offsetWidth // restart the animation
    tag.dataset.blink = '1'
    setTimeout(() => delete tag.dataset.blink, KEY_RACK.blinkMs)
  }
  tag.querySelector('button')?.focus()
}

export function KeyRack({ world, scene, nodes }: { world: OfficeWorld; scene: Object3D; nodes: Record<string, Object3D> }) {
  const src = world.approvals!
  const role = useRole(src)
  const busy = useCameraBusy()
  const { gl, camera } = useThree()
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, [])
  const box = useMemo(() => keyRackTarget(scene, touch), [scene, touch])
  const normal = useMemo(() => (box ? rackNormal(box) : null), [box])
  const wall = useMemo(() => wallOf(scene.getObjectByName('hit_keyrack') ?? null), [scene])
  const key = nodes.keyrack_key as Object3D | undefined
  const keyMats = useMemo(() => {
    // the key's own materials (once per mesh: StrictMode runs memos twice), so the fade never touches a shared one
    const out: Material[] = []
    for (const m of key ? meshesOf(key) : []) {
      if (!m.userData.keyRackMat) {
        m.material = (m.material as Material).clone()
        m.userData.keyRackMat = true
      }
      out.push(m.material as Material)
    }
    return out
  }, [key])
  const base = useMemo(() => key?.quaternion.clone() ?? new Quaternion(), [key])

  const st = useRef({
    over: false, // the pointer on the press box (canvas)
    btnOver: false, // the pointer on the button
    focus: false, // the button has the keyboard's focus
    armedAt: null as number | null,
    swingAt: -Infinity, // s (the frame clock)
    appearAt: -Infinity,
    shown: true, // the rack is in view and may be pressed
    rect: null as Rect | null,
    picked: false, // this click was ours (the outside-click rule skips it)
  })
  const ui = useRef<{ el: HTMLDivElement; tag: HTMLSpanElement } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const roleRef = useRef(role)
  const clock = useThree((s) => s.clock)
  const tmp = useMemo(() => new Vector3(), [])
  const turn = useMemo(() => new Quaternion(), [])

  const blocked = () => busy || isTouring() || isReplayActive()
  const swing = () => {
    if (roleRef.current === 'visitor' && !prefersReducedMotion() && clock.elapsedTime - st.current.swingAt >= KEY_RACK.swingS) st.current.swingAt = clock.elapsedTime
  }
  const disarm = () => {
    st.current.armedAt = null
    if (ui.current) ui.current.el.dataset.armed = '0'
  }

  const onPress = () => {
    st.current.picked = true
    const r = press(roleRef.current, touch, st.current.armedAt, Date.now())
    st.current.armedAt = r.armedAt
    const o = ui.current?.el
    if (r.act === 'arm') {
      if (o) o.dataset.armed = '1'
      swing()
      setTimeout(() => {
        if (st.current.armedAt !== null && Date.now() - st.current.armedAt >= KEY_RACK.armMs) disarm()
      }, KEY_RACK.armMs + 50)
      return
    }
    disarm()
    if (o) {
      o.dataset.press = '1'
      setTimeout(() => delete o.dataset.press, KEY_RACK.pressMs)
    }
    if (r.act === 'signIn') src.signIn()
    else toOwnerTag()
  }
  const pressRef = useRef(onPress)
  pressRef.current = onPress

  // the outline and its tag, over the canvas (as the turntable's)
  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'kr-outline'
    el.setAttribute('aria-hidden', 'true')
    const tag = document.createElement('span')
    tag.className = 'kr-tag'
    // touch: the second tap may land on the tag
    tag.addEventListener('click', () => pressRef.current())
    el.append(tag)
    document.body.appendChild(el)
    ui.current = { el, tag }
    // a tap or click anywhere else closes the armed tag
    const outside = () => {
      if (st.current.picked) st.current.picked = false
      else if (st.current.armedAt !== null) disarm()
    }
    window.addEventListener('click', outside)
    return () => {
      window.removeEventListener('click', outside)
      el.remove()
      ui.current = null
    }
  }, [])

  // signed out on this page: the key is hung back (fades in and swings); signed in: off the hook at once
  useEffect(() => {
    const was = roleRef.current
    roleRef.current = role
    if (was === 'owner' && role === 'visitor' && !prefersReducedMotion()) {
      st.current.appearAt = clock.elapsedTime
      st.current.swingAt = clock.elapsedTime
    }
    if (role === 'owner') disarm()
  }, [role, clock])

  useCanvasPick(
    () => (box && st.current.shown ? [box] : []),
    () => pressRef.current(),
    (over) => {
      if (over && !st.current.over) swing()
      st.current.over = over
    },
  )

  useFrame(() => {
    const s = st.current
    const t = clock.elapsedTime
    // the key: hidden while signed in; fading in and swinging after it is hung back
    if (key) {
      key.visible = roleRef.current !== 'owner'
      const a = keyAppear(t - s.appearAt)
      for (const m of keyMats) {
        const fading = a < 1
        if (m.transparent !== fading) {
          m.transparent = fading
          m.needsUpdate = true
        }
        m.opacity = a
      }
      key.quaternion.copy(base).premultiply(turn.setFromAxisAngle(X, keySwing(t - s.swingAt)))
    }

    const u = ui.current
    if (!u || !box || !normal) return
    // in view: the rack faces the camera, its wall is not lowered below it, and nothing else holds the camera
    tmp.copy(camera.position).sub(box.position)
    const up = !wall || box.position.y < WALL_CUT[wall]
    s.shown = up && tmp.dot(normal) > 0 && !blocked()
    if (wrap.current) wrap.current.style.visibility = s.shown ? 'visible' : 'hidden'
    if (!s.shown) {
      if (s.armedAt !== null) disarm()
      u.el.dataset.show = '0'
      s.rect = null
      return
    }
    // the box on the screen
    const r = gl.domElement.getBoundingClientRect()
    let b: Rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    const { width, height, depth } = (box.geometry as BoxGeometry).parameters
    for (const [x, y, z] of corners) {
      tmp.set((x * width) / 2, (y * height) / 2, (z * depth) / 2).applyMatrix4(box.matrixWorld).project(camera)
      const sx = r.left + ((tmp.x + 1) / 2) * r.width
      const sy = r.top + ((1 - tmp.y) / 2) * r.height
      b = { left: Math.min(b.left, sx), right: Math.max(b.right, sx), top: Math.min(b.top, sy), bottom: Math.max(b.bottom, sy) }
    }
    if (touch) b = grow(b, KEY_RACK.minPx)
    s.rect = b
    const armed = s.armedAt !== null
    const show = s.over || s.btnOver || s.focus || armed
    u.el.dataset.show = show ? '1' : '0'
    u.el.dataset.armed = armed ? '1' : '0'
    const text = rackTag(roleRef.current, armed)
    if (u.tag.textContent !== text) u.tag.textContent = text
    u.el.style.transform = `translate(${b.left}px, ${b.top}px)`
    u.el.style.width = `${b.right - b.left}px`
    u.el.style.height = `${b.bottom - b.top}px`
    // the tag stays on the screen (#480): measured, then placed against the outline's inside corner (inside its border)
    if (show) {
      const at = tagPlace(b, u.tag.offsetWidth, u.tag.offsetHeight, window.innerWidth)
      u.tag.style.left = `${at.left - b.left - u.el.clientLeft}px`
      u.tag.style.top = `${at.top - b.top - u.el.clientTop}px`
    }
  })

  // ?debug: where the rack is on the screen and what it shows (the smoke test and the designer's check)
  useEffect(() => {
    if (!world.debug) return
    ;(world as unknown as { keyRack: unknown }).keyRack = () => {
      const s = st.current
      const b = s.rect
      return {
        shown: s.shown,
        x: b ? (b.left + b.right) / 2 : null,
        y: b ? (b.top + b.bottom) / 2 : null,
        rect: b ? { ...b } : null,
        armed: s.armedAt !== null,
        key: key ? key.visible : null,
        tag: ui.current?.el.dataset.show === '1' ? ui.current.tag.textContent : null,
      }
    }
  }, [world, key])

  if (!box) return null
  return (
    <Html position={box.position} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={wrap}>
        <button
          type="button"
          className="key-rack-btn"
          aria-label={role === 'owner' ? KEY_RACK_LABEL.owner : KEY_RACK_LABEL.visitor}
          onClick={(e) => {
            // the canvas's own pick never sees this click (the button is over it); a keyboard Enter comes here too.
            // It stops here, so the outside-click rule never sees it either.
            e.stopPropagation()
            onPress()
            st.current.picked = false
          }}
          onPointerEnter={() => {
            if (!st.current.btnOver) swing()
            st.current.btnOver = true
          }}
          onPointerLeave={() => (st.current.btnOver = false)}
          onFocus={(e) => {
            st.current.focus = e.currentTarget.matches(':focus-visible')
            if (st.current.focus) swing()
          }}
          onBlur={() => (st.current.focus = false)}
        />
      </div>
    </Html>
  )
}
