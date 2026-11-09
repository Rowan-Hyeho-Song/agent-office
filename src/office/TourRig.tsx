import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Vector3 } from 'three'
import { HOME_POS, HOME_TARGET, useCameraBusy } from '../room/Door'
import { replay } from '../replay/store'
import { clearBoxes } from './clearance'
import { observe } from './tourAdapter'
import { noteTourEvent } from './tourEvents'
import { getSideLayout } from './sidePanel/store'
import {
  ARC,
  TOUR,
  TourPlan,
  arcAt,
  buildViews,
  driftRange,
  driftYaw,
  dwellMs,
  inRoom,
  lag,
  leaveEarly,
  meetingPose,
  orbitYaw,
  shouldFly,
  standPose,
  tablePose,
  workPose,
  type Clearance,
  type Cut,
  type Pose,
  type V3,
} from './tour'
import { getTourState, registerTour, setTourAutoOff, setTourFade, setTourState, tourAutoOff } from './tourStore'
import { VIEW, focusAllowsCameraKeys, keepClear } from './view'
import { prefersReducedMotion, type OfficeWorld } from './world'

// The tour's camera (#207, office-ui.md 10): after 45 s without input on the 3D it flies from agent to agent (tour.ts decides
// the order, the framing and the way), any input ends it where the camera stands. CameraRig stands aside while it runs
// (tourStore.isTouring); OrbitControls keeps the camera and the target, so nothing jumps when it ends.

interface Orbit {
  target: Vector3
  enabled: boolean
  minDistance: number
  maxPolarAngle: number
  minPolarAngle: number
}

interface Run {
  cut: Cut
  base: Pose
  /** the look-at follows this agent (the base target + offset), 0.5 s late */
  follow: { id: string; off: V3 } | null
  range: [number, number]
  phase: 'fly' | 'out' | 'dwell'
  t0: number
  from: Pose
  dwell: number
  /** wall clock (Date.now) the cut began: an event newer than this may cut in */
  cutStart: number
  /** the fade in after a cut has started (performance.now), or null */
  fadeIn: number | null
  tgt: V3
  lastCheck: number
}

const FADE_HALF_MS = ARC.fadeMs / 2
const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]

export function TourRig({ world, limits }: { world: OfficeWorld; limits: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const busy = useCameraBusy()
  const live = useRef({ controls, busy })
  live.current = { controls, busy }
  const frame = useRef<((dt: number) => void) | null>(null)

  useEffect(() => {
    if (!limits) return
    const q = new URLSearchParams(location.search)
    // ?debug=1&tourIdle=3: the idle wait in seconds (and the automatic start under ?debug=1, which is otherwise off so
    // screenshot scripts stay still)
    const idleOverride = world.debug && q.has('tourIdle') ? Math.max(0.5, Number(q.get('tourIdle'))) * 1000 : null
    const idleMs = idleOverride ?? TOUR.idleMs
    const auto = !world.debug || idleOverride !== null
    const plan = new TourPlan()
    let run: Run | null = null
    let lastInput = Date.now()
    let saved: { minD: number; maxP: number; minP: number } | null = null
    let relax = false
    let gesture: { id: number; x: number; y: number; t: number } | null = null
    let drag = { x: 0, y: 0, t: 0, sum: 0 }

    const speed = () => (replay.getSnapshot().mode === 'office' ? replay.getSnapshot().speed : 1)
    const views = () => buildViews(observe(world, replay.getSnapshot().mode === 'office'), Date.now())
    const clearance = (): Clearance => ({ boxes: clearBoxes(Object.values(world.rigs)), margin: VIEW.clear.margin })
    const spot = (id: string) => world.graph?.spots[id]
    const home: V3 = [HOME_POS.x, HOME_POS.y, HOME_POS.z]

    // ---- where a cut is shot from -------------------------------------------------------------------------------
    function plant(cut: Cut): { base: Pose; follow: Run['follow'] } {
      const c = clearance()
      if (cut.type === 'establishing') return { base: { pos: home, target: [HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z] }, follow: null }
      let base: Pose
      let follow: Run['follow'] = null
      if (cut.type === 'meeting') {
        const rigs = cut.agents.map((a) => world.rigs[a]).filter(Boolean)
        const n = Math.max(1, rigs.length)
        const centre = { x: rigs.reduce((s, r) => s + r.x, 0) / n, z: rigs.reduce((s, r) => s + r.z, 0) / n }
        base = meetingPose(centre, c, home)
      } else {
        const id = cut.agents[0]
        const rig = world.rigs[id]
        const goal = world.goals[id]
        const seat = spot(`work_${Number(id.split('_')[1])}`)
        const doing = rig && goal && rig.arrived === goal.spot ? goal.pose : undefined
        const a = spot('pingpong_a')
        const b = spot('pingpong_b')
        const ga = spot('game_a')
        const gb = spot('game_b')
        if (doing === 'pingpong' && a && b) base = tablePose(a, b, c, home, { dist: 3.8, y: 2.2, targetY: 0.76 })
        else if (doing === 'boardgame' && ga && gb) base = tablePose(ga, gb, c, home, { dist: 2.0, y: 1.8, targetY: 0.6 })
        else if (seat && (rig?.arrived === seat.id || cut.why === 'working')) base = workPose(seat, c)
        else if (rig) {
          base = standPose({ x: rig.x, z: rig.z, ry: rig.heading }, c)
          follow = { id, off: [base.target[0] - rig.x, base.target[1], base.target[2] - rig.z] }
        } else base = { pos: home, target: [HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z] }
      }
      // every cut's camera goes through the same clearance as the free camera (#208)
      base = { pos: keepClear(base.pos, base.target, c.boxes, c.margin), target: base.target }
      return { base, follow }
    }

    const liveTarget = (r: Run): V3 => {
      const rig = r.follow ? world.rigs[r.follow.id] : null
      return rig && r.follow ? [rig.x + r.follow.off[0], r.follow.off[1], rig.z + r.follow.off[2]] : r.base.target
    }
    const apply = (pos: V3, target: V3) => {
      const ctl = live.current.controls
      if (!ctl) return
      camera.position.set(pos[0], pos[1], pos[2])
      ctl.target.set(target[0], target[1], target[2])
      camera.lookAt(ctl.target)
    }

    // ---- cuts ------------------------------------------------------------------------------------------------------
    function begin(cut: Cut) {
      const ctl = live.current.controls
      if (!ctl) return
      const reduced = prefersReducedMotion()
      const { base, follow } = plant(cut)
      let range = driftRange(cut, reduced)
      if (cut.type !== 'establishing' && (range[0] !== 0 || range[1] !== 0)) {
        // the sideways drift must stay clear too, else the cut stands still
        const c = clearance()
        const ok = range.every((y) => {
          const p = orbitYaw(base.pos, base.target, y)
          const k = keepClear(p, base.target, c.boxes, c.margin)
          return Math.hypot(k[0] - p[0], k[1] - p[1], k[2] - p[2]) < 0.01 && inRoom(p[0], p[2])
        })
        if (!ok) range = [0, 0]
      }
      const from: Pose = { pos: v3(camera.position), target: v3(ctl.target) }
      const end: Pose = { pos: orbitYaw(base.pos, base.target, range[0]), target: base.target }
      const fly = shouldFly(from, end, clearance(), reduced)
      const now = performance.now()
      run = { cut, base, follow, range, phase: fly ? 'fly' : 'out', t0: now, from, dwell: dwellMs(cut, Date.now(), speed()), cutStart: Date.now(), fadeIn: null, tgt: from.target, lastCheck: now }
      setTourState({ cut, canBack: plan.canGoBack, seq: getTourState().seq + 1 })
    }

    function startTour(agent?: string) {
      const ctl = live.current.controls
      if (!ctl || live.current.busy || document.hidden) return
      if (!getTourState().active) {
        saved = { minD: ctl.minDistance, maxP: ctl.maxPolarAngle, minP: ctl.minPolarAngle }
        // the tour's poses are closer / flatter than the free camera's limits; it hands them back when it ends
        ctl.minDistance = 0.3
        ctl.maxPolarAngle = Math.PI
        ctl.minPolarAngle = 0
        relax = false
        setTourState({ active: true })
      }
      begin(plan.startAt(Date.now(), agent, views(), speed()))
    }

    function stopTour(why: 'button' | 'input' = 'input') {
      if (!getTourState().active) return
      run = null
      gesture = null
      setTourFade(0)
      const ctl = live.current.controls
      if (ctl) {
        ctl.enabled = true
        if (saved) {
          // keep the camera where it is: the limits come back as soon as the view is inside them again
          const d = camera.position.distanceTo(ctl.target)
          const polar = Math.acos(Math.min(1, Math.max(-1, (camera.position.y - ctl.target.y) / Math.max(d, 1e-6))))
          ctl.minDistance = Math.min(saved.minD, d)
          ctl.maxPolarAngle = Math.max(saved.maxP, polar)
          ctl.minPolarAngle = Math.min(saved.minP, polar)
          relax = true
        }
      }
      if (why === 'button') setTourAutoOff(true)
      lastInput = Date.now()
      setTourState({ active: false, cut: null, canBack: false })
    }

    const advance = () => begin(plan.next(Date.now(), views(), speed()))
    const stepBack = () => {
      const c = plan.prev()
      if (c) begin(c)
    }

    // ---- per frame -------------------------------------------------------------------------------------------------
    frame.current = (dt) => {
      const ctl = live.current.controls
      if (relax && ctl && saved) {
        const d = camera.position.distanceTo(ctl.target)
        const polar = Math.acos(Math.min(1, Math.max(-1, (camera.position.y - ctl.target.y) / Math.max(d, 1e-6))))
        if (d >= saved.minD) ctl.minDistance = saved.minD
        if (polar <= saved.maxP) ctl.maxPolarAngle = saved.maxP
        if (polar >= saved.minP) ctl.minPolarAngle = saved.minP
        if (ctl.minDistance === saved.minD && ctl.maxPolarAngle === saved.maxP && ctl.minPolarAngle === saved.minP) relax = false
      }
      const r = run
      if (!r || !ctl) return
      const now = performance.now()
      const want = liveTarget(r)
      const end: Pose = { pos: orbitYaw(r.base.pos, r.base.target, r.range[0]), target: want }
      if (r.phase === 'fly') {
        const k = (now - r.t0) / ARC.ms
        const p = arcAt(r.from, end, k)
        apply(p.pos, p.target)
        r.tgt = p.target
        if (k >= 1) {
          r.phase = 'dwell'
          r.t0 = now
        }
        return
      }
      if (r.phase === 'out') {
        const k = Math.min(1, (now - r.t0) / FADE_HALF_MS)
        setTourFade(k)
        if (k >= 1) {
          apply(end.pos, end.target)
          r.tgt = end.target
          r.phase = 'dwell'
          r.t0 = now
          r.fadeIn = now
        }
        return
      }
      // dwelling: drift sideways, the look-at follows 0.5 s late
      if (r.fadeIn !== null) {
        const k = Math.min(1, (now - r.fadeIn) / FADE_HALF_MS)
        setTourFade(1 - k)
        if (k >= 1) r.fadeIn = null
      }
      const k = (now - r.t0) / r.dwell
      const pos = orbitYaw(r.base.pos, r.base.target, driftYaw(r.range, k))
      r.tgt = [lag(r.tgt[0], want[0], dt), lag(r.tgt[1], want[1], dt), lag(r.tgt[2], want[2], dt)]
      apply(pos, r.tgt)
      if (now - r.lastCheck > 250) {
        r.lastCheck = now
        const vs = views()
        const cut = plan.interrupt(Date.now(), vs, r.cutStart)
        if (cut) return begin(cut)
        if (leaveEarly(r.cut, vs, now - r.t0)) return advance()
      }
      if (now - r.t0 >= r.dwell) advance()
    }

    // ---- input -------------------------------------------------------------------------------------------------------
    const onBar = (e: Event) => !!(e.target as Element | null)?.closest?.('.tour-bar, .agent-list')
    const setControls = (b: boolean) => {
      const ctl = live.current.controls
      if (ctl) ctl.enabled = b
    }
    const touch = (e: PointerEvent) => e.pointerType === 'touch'

    const onDown = (e: PointerEvent) => {
      lastInput = Date.now()
      if (!getTourState().active || onBar(e)) return
      if (touch(e)) {
        if (gesture) {
          // a second finger: the free view
          gesture = null
          return stopTour()
        }
        // a swipe is decided when it ends; until then the finger must not turn the camera
        gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
        setControls(false)
        return
      }
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), sum: 0 }
      stopTour()
    }
    const onMove = (e: PointerEvent) => {
      lastInput = Date.now()
      if (!getTourState().active || onBar(e)) return
      if (touch(e)) {
        // not a quick sideways swipe (slow or vertical): the free view
        if (gesture && gesture.id === e.pointerId && performance.now() - gesture.t > TOUR.swipe.ms) {
          gesture = null
          stopTour()
        }
        return
      }
      // a mouse that only passes over the picture does not end it; a real move does (30 px within 0.6 s)
      const now = performance.now()
      if (now - drag.t > 600) drag = { x: e.clientX, y: e.clientY, t: now, sum: 0 }
      drag.sum = Math.hypot(e.clientX - drag.x, e.clientY - drag.y)
      if (drag.sum > 30) stopTour()
    }
    const onUp = (e: PointerEvent) => {
      if (!gesture || gesture.id !== e.pointerId) return
      const g = gesture
      gesture = null
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      const quick = performance.now() - g.t <= TOUR.swipe.ms
      if (quick && Math.abs(dx) >= TOUR.swipe.px && Math.abs(dx) > Math.abs(dy)) {
        setControls(true)
        return dx < 0 ? advance() : stepBack()
      }
      stopTour()
    }
    const onWheel = (e: Event) => {
      lastInput = Date.now()
      if (getTourState().active && !onBar(e)) stopTour()
    }
    const onKey = (e: KeyboardEvent) => {
      lastInput = Date.now()
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const active = getTourState().active
      const usable = focusAllowsCameraKeys(document.activeElement, document.body, document.documentElement) || (active && onBar(e))
      if (e.code === 'BracketRight' || e.key === ']') {
        if (!usable || e.repeat) return
        return active ? advance() : startTour()
      }
      if (!active) return
      if (e.code === 'BracketLeft' || e.key === '[') return usable && !e.repeat ? stepBack() : undefined
      if (e.key === 'Escape') return stopTour()
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab') return
      if (onBar(e) && (e.key === 'Enter' || e.key === ' ')) return // the button's own press
      stopTour() // any other key (WASD, arrows, R, ...) is free-view input: the camera stays and the key goes on to do its job
    }
    const onHidden = () => document.hidden && stopTour()

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('visibilitychange', onHidden)

    // the idle clock, and what makes the tour give way (a panel, the door, a hidden tab)
    const timer = window.setInterval(() => {
      const st = getTourState()
      const ctl = live.current.controls
      if (st.active && (!ctl || live.current.busy || getSideLayout().open)) return stopTour()
      if (st.active || !auto || tourAutoOff() || !ctl || live.current.busy || document.hidden || getSideLayout().open) return
      if (replay.getSnapshot().mode === 'list') return
      if (Date.now() - lastInput >= idleMs) startTour()
    }, 400)

    // a paper plane (#51) is an event at both desks
    const off = world.source.onMessage((m) => {
      if (m.kind !== 'handoff') return
      noteTourEvent(m.from, 3500)
      noteTourEvent(m.to, 6000)
    })

    registerTour({ start: startTour, next: advance, prev: stepBack, stop: stopTour })
    if (world.debug) {
      ;(world as unknown as { tour: unknown }).tour = {
        start: startTour,
        next: advance,
        prev: stepBack,
        stop: stopTour,
        state: () => ({ ...getTourState(), phase: run?.phase ?? null, history: plan.history.map((c) => `${c.id}:${c.why}`), views: views() }),
      }
    }
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('visibilitychange', onHidden)
      window.clearInterval(timer)
      off()
      registerTour(null)
      stopTour()
      frame.current = null
    }
  }, [limits, world, camera])

  useFrame((_, dt) => frame.current?.(Math.min(dt, 0.1)))
  return null
}
