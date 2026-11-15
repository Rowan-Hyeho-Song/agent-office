import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3, type BoxGeometry, type Object3D } from 'three'
import { cue, PROP_CLICK_DB } from '../audio/cues'
import { getMusicState } from '../audio/music'
import { getSetting } from '../audio/settings'
import { speakerForMe, toggleSpeakerForMe } from '../audio/speaker'
import { isReplayActive } from '../replay/store'
import { useCameraBusy } from '../room/Door'
import { grow, tagPlace, type Rect } from './keyRackRules'
import { isVisitPlaying } from './visitPlay'
import { deskProps } from './props'
import { PROP_BY_ID, PROP_PRESS, PROPS, gestureFor, pickNearest, propLabel, propTargets, secondLine, type PropId, type PropNow } from './propPressRules'
import { claimPicks } from './pick'
import { isTouring } from './tourStore'
import { officeNow, prefersReducedMotion, type OfficeWorld } from './world'

// #370 D the visitor presses a desk thing (desk-props.md 7): eight boxes in the scene (1.5x on touch, never under 44 px on the screen),
// a transparent 44 px button on each for the keyboard and screen readers, one cyan outline with its tag. Hover / focus: the outline and
// the first line; a press: both lines for 3 s (hover and focus keep it), the owner's gesture, ui.click at -6 dB. The speaker's press
// still turns the music on or off for this visitor (#194) with its own sound; its old toast under the HUD is this tag now.

const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)))

/** what the things show now (desk-props.md 7.1) */
function propNow(world: OfficeWorld): PropNow {
  const status = world.source.getSnapshot()
  const feed = world.props.getSnapshot()
  const desk = deskProps({ ...feed, status, now: officeNow(world) })
  const s = getSetting()
  return {
    desk,
    pending: feed.pending,
    speaker: s.muted || s.volume <= 0.001 ? 'muted' : speakerForMe() ? 'on' : 'off',
    music: getMusicState(),
    private: (seat) => !!status[`agent_${seat}`]?.task?.private,
  }
}

export function PropPress({ world, nodes }: { world: OfficeWorld; nodes: Record<string, Object3D> }) {
  const busy = useCameraBusy()
  const { gl, camera } = useThree()
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, [])
  const targets = useMemo(() => propTargets(nodes, touch), [nodes, touch])
  const centre = useMemo(() => {
    const out = new Map<PropId, Vector3>()
    for (const [id, ms] of targets) out.set(id, ms.reduce((a, m) => a.add(m.position), new Vector3()).divideScalar(ms.length))
    return out
  }, [targets])

  const st = useRef({
    hover: null as PropId | null, // the pointer on a thing (canvas)
    focus: null as PropId | null, // a button has the keyboard's focus
    open: null as { id: PropId; until: number } | null, // pressed: both lines until `until` (ms)
    last: {} as Partial<Record<PropId, number>>, // the last press of each (ms)
    picked: false, // this click was ours (the outside-click rule skips it)
    shown: false, // nothing else holds the camera
  })
  const ui = useRef<{ el: HTMLDivElement; tag: HTMLSpanElement; first: HTMLSpanElement; second: HTMLSpanElement } | null>(null)
  const btns = useRef(new Map<PropId, HTMLButtonElement>())
  const wraps = useRef(new Map<PropId, HTMLDivElement>())
  const tmp = useMemo(() => new Vector3(), [])

  /** a thing's boxes on the screen (px; at least 44 px on touch), or null when it is behind the camera */
  const rectOf = (id: PropId): Rect | null => {
    const r = gl.domElement.getBoundingClientRect()
    let b: Rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    for (const m of targets.get(id)!) {
      const { width, height, depth } = (m.geometry as BoxGeometry).parameters
      for (const [x, y, z] of corners) {
        tmp.set((x * width) / 2, (y * height) / 2, (z * depth) / 2).applyMatrix4(m.matrixWorld).project(camera)
        if (tmp.z >= 1) return null
        const sx = r.left + ((tmp.x + 1) / 2) * r.width
        const sy = r.top + ((1 - tmp.y) / 2) * r.height
        b = { left: Math.min(b.left, sx), right: Math.max(b.right, sx), top: Math.min(b.top, sy), bottom: Math.max(b.bottom, sy) }
      }
    }
    return touch ? grow(b, PROP_PRESS.minPx) : b
  }
  const pickAt = (x: number, y: number): PropId | null => {
    if (!st.current.shown || isVisitPlaying()) return null
    const boxes: [PropId, Rect][] = []
    for (const id of targets.keys()) {
      const b = rectOf(id)
      if (b) boxes.push([id, b])
    }
    return pickNearest(boxes, x, y)
  }
  const pickRef = useRef(pickAt)
  pickRef.current = pickAt

  const close = () => (st.current.open = null)
  const press = (id: PropId) => {
    const s = st.current
    s.picked = true
    const now = Date.now()
    // a second tap on the same thing closes its tag (desk-props.md 7.2); the speaker's tap is its switch, every time
    if (touch && id !== 'speaker' && s.open?.id === id) {
      close()
      return
    }
    if (id === 'speaker') toggleSpeakerForMe()
    else cue('ui.click', { db: PROP_CLICK_DB })
    const def = PROP_BY_ID[id]
    const aid = `agent_${def.seat}`
    const rig = world.rigs[aid]
    const pose = world.goals[aid]?.pose
    const g = gestureFor(
      {
        atDesk: !!rig?.visible && rig.arrived === `work_${def.seat}`,
        working: world.source.getSnapshot()[aid]?.state === 'working',
        busy: pose === 'doze' || pose === 'tidy' || pose === 'talk' || pose === 'listen',
      },
      prefersReducedMotion(),
      now - (s.last[id] ?? -Infinity),
    )
    s.last[id] = now
    if (g && rig) rig.propLook = { at: centre.get(id)!.clone(), nod: g === 'lookNod', t0: null }
    s.open = { id, until: now + PROP_PRESS.tagMs }
    const o = ui.current?.el
    if (o) {
      o.dataset.press = '1'
      setTimeout(() => delete o.dataset.press, 80)
    }
  }
  const pressRef = useRef(press)
  pressRef.current = press

  // the outline and its tag over the canvas (as the key rack's); Esc and a click elsewhere close it
  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'pp-outline'
    el.setAttribute('aria-hidden', 'true')
    const tag = document.createElement('span')
    tag.className = 'pp-tag'
    const first = document.createElement('span')
    const second = document.createElement('small')
    tag.append(first, second)
    el.append(tag)
    document.body.appendChild(el)
    ui.current = { el, tag, first, second }
    const outside = () => {
      if (st.current.picked) st.current.picked = false
      else close()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && st.current.open) close()
    }
    window.addEventListener('click', outside)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', outside)
      window.removeEventListener('keydown', esc)
      el.remove()
      ui.current = null
    }
  }, [])

  // the pointer and the finger on the canvas: the nearest thing under it (pickNearest), a click that is not a camera drag presses it.
  // The cursor is written only when this picker's own state changes, so it never undoes another picker's (as pick.ts).
  useEffect(() => {
    const el = gl.domElement
    let down: [number, number] | null = null
    const onMove = (e: PointerEvent) => {
      if (e.buttons || e.pointerType === 'touch') return
      const id = pickRef.current(e.clientX, e.clientY)
      const was = st.current.hover
      if (id === was) return
      st.current.hover = id
      if (!id !== !was) el.style.cursor = id ? 'pointer' : ''
    }
    const onLeave = () => {
      if (!st.current.hover) return
      st.current.hover = null
      el.style.cursor = ''
    }
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
    const onClick = (e: MouseEvent) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) >= 5) return
      const id = pickRef.current(e.clientX, e.clientY)
      if (id) pressRef.current(id)
    }
    claimPicks((x, y) => pickRef.current(x, y) !== null)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    return () => {
      claimPicks(null)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
    }
  }, [gl])

  useFrame(() => {
    const s = st.current
    const u = ui.current
    if (!u) return
    s.shown = !busy && !isTouring() && !isReplayActive() && !isVisitPlaying()
    const w = s.shown ? propNow(world) : null
    // each button on its thing, hidden when the thing is off the screen
    for (const id of targets.keys()) {
      const wrap = wraps.current.get(id)
      tmp.copy(centre.get(id)!).project(camera)
      const inView = s.shown && tmp.z < 1 && Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1
      if (wrap) wrap.style.visibility = inView ? 'visible' : 'hidden'
      const b = btns.current.get(id)
      if (b && w) {
        const label = propLabel(id, w)
        if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label)
      }
    }
    const now = Date.now()
    if (s.open && now > s.open.until && s.hover !== s.open.id && s.focus !== s.open.id) s.open = null
    const id = s.shown ? (s.open?.id ?? s.hover ?? s.focus) : null
    if (!s.shown) s.open = null
    if (!id || !w) {
      u.el.dataset.show = '0'
      return
    }
    const b = rectOf(id)
    if (!b) {
      u.el.dataset.show = '0'
      return
    }
    const open = s.open?.id === id
    const first = PROP_BY_ID[id].first
    const second = open ? secondLine(id, w) : null
    if (u.first.textContent !== first) u.first.textContent = first
    if (u.second.textContent !== (second ?? '')) u.second.textContent = second ?? ''
    u.second.hidden = !second
    u.el.dataset.show = '1'
    u.el.dataset.open = open ? '1' : '0'
    u.el.style.transform = `translate(${b.left}px, ${b.top}px)`
    u.el.style.width = `${b.right - b.left}px`
    u.el.style.height = `${b.bottom - b.top}px`
    // the tag stays on the screen (#480): over the outline, kept 8 px inside
    const at = tagPlace(b, u.tag.offsetWidth, u.tag.offsetHeight, window.innerWidth)
    u.tag.style.left = `${at.left - b.left - u.el.clientLeft}px`
    u.tag.style.top = `${at.top - b.top - u.el.clientTop}px`
  })

  // ?debug: what the tag shows and where each thing is on the screen (the capture and the designer's check)
  useEffect(() => {
    if (!world.debug) return
    ;(world as unknown as { propPress: unknown }).propPress = () => {
      const r = gl.domElement.getBoundingClientRect()
      const at: Partial<Record<PropId, { x: number; y: number }>> = {}
      for (const [id, c] of centre) {
        const p = c.clone().project(camera)
        if (p.z < 1) at[id] = { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
      }
      const u = ui.current
      return {
        at,
        open: st.current.open?.id ?? null,
        tag: u?.el.dataset.show === '1' ? [u.first.textContent, u.second.hidden ? null : u.second.textContent] : null,
        look: Object.fromEntries(Object.entries(world.rigs).map(([k, rig]) => [k, !!rig.propLook])),
      }
    }
  }, [world, gl, camera, centre])

  return (
    <>
      {PROPS.filter((p) => targets.has(p.id)).map((p) => (
        <Html key={p.id} position={centre.get(p.id)!} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={(el) => void (el ? wraps.current.set(p.id, el) : wraps.current.delete(p.id))}>
            <button
              ref={(el) => void (el ? btns.current.set(p.id, el) : btns.current.delete(p.id))}
              type="button"
              className="prop-press-btn"
              aria-label={p.first}
              onClick={(e) => {
                // the canvas's own pick never sees this click (the button is over it); a keyboard Enter comes here too
                e.stopPropagation()
                press(p.id)
                st.current.picked = false
              }}
              onFocus={(e) => (st.current.focus = e.currentTarget.matches(':focus-visible') ? p.id : null)}
              onBlur={() => st.current.focus === p.id && (st.current.focus = null)}
            />
          </div>
        </Html>
      ))}
    </>
  )
}
