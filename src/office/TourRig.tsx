import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera, Vector3 } from 'three'
import { HOME_POS, HOME_TARGET, useCameraBusy } from '../room/Door'
import { replay } from '../replay/store'
import { clearBoxes, furnitureBoxes, headBox, leafBoxes, robotBox } from './clearance'
import type { ClearBox } from './view'
import { observe } from './tourAdapter'
import { noteTourEvent } from './tourEvents'
import { getSideLayout } from './sidePanel/store'
import {
  ARC,
  DEG,
  TOUR,
  TourPlan,
  arcAt,
  buildViews,
  driftRange,
  driftSightClear,
  driftYaw,
  isParked,
  lastPick,
  establishingCut,
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
  type Frame,
  type Pose,
  type Shot,
  type V3,
} from './tour'
import { NO_MOUSE, mouseStep, type MouseEv, type MouseState } from './tourInput'
import { cutInLimits, freeSpot, stopEaseAt, stopEaseDone, type CutLimits } from './tourLimits'
import { getTourState, registerTour, setTourFade, setTourState, tourTick, type TourStop } from './tourStore'
import { VIEW, focusAllowsCameraKeys, keepClear } from './view'
import { prefersReducedMotion, type OfficeWorld } from './world'

// The tour's camera (#207, office-ui.md 10): started by the visitor only (the dock's view toggle, an agent's name, `]`; #427: never by itself) it flies from agent to agent (tour.ts decides
// the order, the framing and the way), any input ends it where the camera stands. CameraRig stands aside while it runs
// (tourStore.isTouring); OrbitControls keeps the camera and the target, so nothing jumps when it ends.
// The controls are DISABLED while it runs (their update() would clamp the tour's poses to the free-view limits, and the
// tour has its own limits, tourLimits.ts, so the free limits are never loosened). When it ends the camera eases into the
// free-view limits over 0.4 s (a snap under reduced motion); the controls get open limits only for that ease.

interface Orbit {
  target: Vector3
  enabled: boolean
  minDistance: number
  maxDistance: number
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
  const scene = useThree((s) => s.scene)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const busy = useCameraBusy()
  const live = useRef({ controls, busy })
  live.current = { controls, busy }
  const frame = useRef<((dt: number) => void) | null>(null)

  useEffect(() => {
    if (!limits) return
    const plan = new TourPlan()
    let run: Run | null = null
    let saved: { minD: number; maxD: number; maxP: number; minP: number } | null = null
    let ease: { from: V3; to: V3; t0: number } | null = null
    let gesture: { id: number; x: number; y: number; t: number } | null = null
    let mouse: MouseState = NO_MOUSE
    // the side panel at the clock's last tick: the tour gives way when one OPENS, not to one that was open already (#440)
    let panelWas = getSideLayout().open
    // why the last tour ended (#440), for ?debug's tour.state()
    let lastStop: { reason: TourStop; at: number; cut: string | null } | null = null

    const speed = () => (replay.getSnapshot().mode === 'office' ? replay.getSnapshot().speed : 1)
    const views = () => buildViews(observe(world, replay.getSnapshot().mode === 'office'), Date.now())
    // the line of sight also keeps out of the leafy plants' crowns (#397); measured once, the plants do not move
    let leaves: ClearBox[] | null = null
    const clearance = (): Clearance => ({ boxes: clearBoxes(Object.values(world.rigs)), margin: VIEW.clear.margin, sight: [...furnitureBoxes(), ...(leaves ??= leafBoxes(scene))] })
    const spot = (id: string) => world.graph?.spots[id]
    const homeNow = (): V3 => [HOME_POS.x, HOME_POS.y, HOME_POS.z] // the default view follows the viewport (portrait phone)

    // ---- where a cut is shot from -------------------------------------------------------------------------------
    // null = no camera that is clear and sees the subject: the cut is skipped (#253)
    // the camera spot each subject was last shot from: a subject shown again is composed differently (#277)
    const lastShot = new Map<string, V3>()
    function plant(cut: Cut): { base: Pose; follow: Run['follow'] } | null {
      // the plan names the composition (cut.variant); when the place's clearance made that pose the same spot as last time, the next composition
      type Pick = { planted: { base: Pose; follow: Run['follow'] }; variant: number }
      let chosen: Pick | null = null
      let fallback: Pick | null = null
      const prev = lastShot.get(cut.subject)
      for (let k = 0; k < TOUR.variants && !chosen; k++) {
        const variant = (cut.variant + k) % TOUR.variants
        const planted = plantWith(cut, variant)
        if (!planted) continue
        fallback ??= { planted, variant }
        if (!prev || Math.hypot(planted.base.pos[0] - prev[0], planted.base.pos[1] - prev[1], planted.base.pos[2] - prev[2]) >= 0.5) chosen = { planted, variant }
      }
      const pick = chosen ?? fallback
      if (!pick) return null
      cut.variant = pick.variant
      lastShot.set(cut.subject, pick.planted.base.pos)
      return pick.planted
    }
    function plantWith(cut: Cut, variant: number): { base: Pose; follow: Run['follow'] } | null {
      const c = clearance()
      // the robots parked at a place (work, sofa, circle, play; not the ones walking past) may cover the subject only a little (#270)
      const parked = Object.entries(world.rigs).filter(([id, r]) => isParked(r, world.goals[id]?.spot))
      const shotOf = (subjects: string[], work?: Frame): Shot => {
        const heads = subjects.flatMap((id) => (world.rigs[id]?.visible ? [headBox(robotBox(world.rigs[id].group))] : []))
        const blockers = parked.filter(([id]) => !subjects.includes(id)).map(([, r]) => robotBox(r.group))
        return { heads, blockers, fovY: ((camera as PerspectiveCamera).fov || 32) * DEG, aspect: (camera as PerspectiveCamera).aspect || 1.6, work }
      }
      const cam = camera as PerspectiveCamera
      const aspect = cam.aspect || 1.6
      const fovY = (cam.fov || 32) * DEG
      const limitsFor = (shot: Shot): CutLimits => ({ aspect, fovY, subjectH: Math.max(0, ...shot.heads.map((h) => h.max[1] - h.min[1])) })
      if (cut.type === 'establishing') return { base: { pos: homeNow(), target: [HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z] }, follow: null }
      let base: Pose | null
      let follow: Run['follow'] = null
      if (cut.type === 'meeting') {
        const rigs = cut.agents.map((a) => world.rigs[a]).filter(Boolean)
        const n = Math.max(1, rigs.length)
        const centre = { x: rigs.reduce((s, r) => s + r.x, 0) / n, z: rigs.reduce((s, r) => s + r.z, 0) / n }
        c.shot = shotOf(cut.agents)
        c.limits = limitsFor(c.shot)
        base = meetingPose(centre, c, homeNow(), 4.0, 2.6, variant)
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
        // a table cut shows both players: whoever is parked at its two spots is the subject, not a blocker
        const players = (x?: { id: string }, y?: { id: string }) => [id, ...parked.filter(([, r]) => r.arrived === x?.id || r.arrived === y?.id).map(([k]) => k)]
        if (doing === 'pingpong' && a && b) c.shot = shotOf(players(a, b))
        else if (doing === 'boardgame' && ga && gb) c.shot = shotOf(players(ga, gb))
        else if (seat && (rig?.arrived === seat.id || cut.why === 'working')) c.shot = shotOf([id], seat)
        else c.shot = shotOf([id])
        c.limits = limitsFor(c.shot)
        if (doing === 'pingpong' && a && b) base = tablePose(a, b, c, homeNow(), { dist: 3.8, y: 2.2, targetY: 0.76 }, variant)
        else if (doing === 'boardgame' && ga && gb) base = tablePose(ga, gb, c, homeNow(), { dist: 2.0, y: 1.8, targetY: 0.6 }, variant)
        else if (seat && (rig?.arrived === seat.id || cut.why === 'working')) base = workPose(seat, c, variant)
        else if (rig) {
          base = standPose({ x: rig.x, z: rig.z, ry: rig.heading }, c, 2.2, 1.7, 1.0, variant)
          if (base) follow = { id, off: [base.target[0] - rig.x, base.target[1], base.target[2] - rig.z] }
        } else base = { pos: homeNow(), target: [HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z] }
      }
      if (!base) return null
      // every cut's camera goes through the same clearance as the free camera (#208)
      base = { pos: keepClear(base.pos, base.target, c.boxes, c.margin), target: base.target }
      // keepClear may have pushed it out of the tour's limits: then this composition cannot frame the subject (the cut is skipped)
      if (c.limits && !cutInLimits(base.pos, base.target, c.limits)) return null
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
    function begin(cut: Cut, skipped = 0) {
      const ctl = live.current.controls
      if (!ctl) return
      const reduced = prefersReducedMotion()
      const planted = plant(cut)
      if (!planted) {
        // no usable camera for this cut: the next one; after a few in a row the establishing shot (always plantable)
        console.info('[tour] cut skipped (no clear line of sight)', cut.id)
        if (skipped >= 5) return begin(establishingCut(), 0)
        return begin(plan.next(Date.now(), views(), speed()), skipped + 1)
      }
      const { base, follow } = planted
      let range = driftRange(cut, reduced)
      if (cut.type !== 'establishing' && (range[0] !== 0 || range[1] !== 0)) {
        // the sideways drift must stay clear too (the camera and the line of sight), else the cut stands still
        const c = clearance()
        const ok = range.every((y) => {
          const p = orbitYaw(base.pos, base.target, y)
          const k = keepClear(p, base.target, c.boxes, c.margin)
          return Math.hypot(k[0] - p[0], k[1] - p[1], k[2] - p[2]) < 0.01 && inRoom(p[0], p[2])
        })
        if (!ok || !driftSightClear(base, range, c)) range = [0, 0]
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
        endEase(false)
        saved = { minD: ctl.minDistance, maxD: ctl.maxDistance, maxP: ctl.maxPolarAngle, minP: ctl.minPolarAngle }
        ctl.enabled = false // the tour has its own limits; the controls would clamp its poses to the free view's
        setTourState({ active: true })
        panelWas = getSideLayout().open // a panel already open is the visitor's choice, not a reason to end (#440)
      }
      lastShot.clear()
      begin(plan.startAt(Date.now(), agent, views(), speed()))
    }

    function stopTour(reason: TourStop) {
      if (!getTourState().active) return
      lastStop = { reason, at: Date.now(), cut: getTourState().cut?.id ?? null }
      if (world.debug) console.info('[tour] stopped:', reason)
      run = null
      gesture = null
      setTourFade(0)
      const ctl = live.current.controls
      if (ctl) {
        ctl.enabled = true
        if (saved) {
          // the camera stays where it is, then eases into the free-view limits (0.4 s; a snap under reduced motion)
          const from = v3(camera.position)
          const to = freeSpot(from, v3(ctl.target), { polar: [saved.minP, saved.maxP], distance: [saved.minD, saved.maxD] })
          if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > 1e-3) {
            if (prefersReducedMotion()) {
              camera.position.set(to[0], to[1], to[2])
              camera.lookAt(ctl.target)
            } else {
              // open limits for the ease only: OrbitControls would clamp the camera at once
              ctl.minDistance = 0.3
              ctl.minPolarAngle = 0
              ctl.maxPolarAngle = Math.PI
              ease = { from, to, t0: performance.now() }
            }
          }
        }
      }
      setTourState({ active: false, cut: null, canBack: false })
    }

    /** the ease into the free view is over (or cut short): the free limits come back */
    function endEase(snap: boolean) {
      const ctl = live.current.controls
      if (ease && ctl) {
        if (snap) {
          camera.position.set(ease.to[0], ease.to[1], ease.to[2])
          camera.lookAt(ctl.target)
        }
        if (saved) {
          ctl.minDistance = saved.minD
          ctl.maxPolarAngle = saved.maxP
          ctl.minPolarAngle = saved.minP
        }
      }
      ease = null
    }

    const advance = () => begin(plan.next(Date.now(), views(), speed()))
    const stepBack = () => {
      const c = plan.prev()
      if (c) begin(c)
    }

    // ---- per frame -------------------------------------------------------------------------------------------------
    frame.current = (dt) => {
      const ctl = live.current.controls
      if (ease && ctl) {
        const el = performance.now() - ease.t0
        if (stopEaseDone(el)) endEase(true)
        else {
          const p = stopEaseAt(ease.from, ease.to, el)
          camera.position.set(p[0], p[1], p[2])
          camera.lookAt(ctl.target)
        }
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
    const onBar = (e: Event) => !!(e.target as Element | null)?.closest?.('.tour-bar, .agent-list, .view-toggle')
    const setControls = (b: boolean) => {
      const ctl = live.current.controls
      if (ctl) ctl.enabled = b
    }
    const touch = (e: PointerEvent) => e.pointerType === 'touch'

    // the mouse rule (tourInput.ts): a press ends it, a move only while a button is held and 30 px from the press; a plain move never
    const mouseEv = (kind: MouseEv['kind'], e: PointerEvent): MouseEv => ({ kind, x: e.clientX, y: e.clientY, buttons: e.buttons, onBar: onBar(e), active: getTourState().active })
    const mouseDo = (kind: MouseEv['kind'], e: PointerEvent) => {
      const r = mouseStep(mouse, mouseEv(kind, e))
      mouse = r.state
      if (r.stop) stopTour('drag')
    }

    const onDown = (e: PointerEvent) => {
      if (!touch(e)) return mouseDo('down', e)
      if (!getTourState().active || onBar(e)) return
      if (touch(e)) {
        if (gesture) {
          // a second finger: the free view
          gesture = null
          return stopTour('touch')
        }
        // a swipe is decided when it ends; until then the finger must not turn the camera
        gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
        setControls(false)
        return
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!touch(e)) return mouseDo('move', e)
      if (!getTourState().active || onBar(e)) return
      if (touch(e)) {
        // not a quick sideways swipe (slow or vertical): the free view
        if (gesture && gesture.id === e.pointerId && performance.now() - gesture.t > TOUR.swipe.ms) {
          gesture = null
          stopTour('touch')
        }
        return
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!touch(e)) return mouseDo('up', e)
      if (!gesture || gesture.id !== e.pointerId) return
      const g = gesture
      gesture = null
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      const quick = performance.now() - g.t <= TOUR.swipe.ms
      if (quick && Math.abs(dx) >= TOUR.swipe.px && Math.abs(dx) > Math.abs(dy)) {
        return dx < 0 ? advance() : stepBack()
      }
      stopTour('touch')
    }
    const onWheel = (e: Event) => {
      if (getTourState().active && !onBar(e)) stopTour('wheel')
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const active = getTourState().active
      const usable = focusAllowsCameraKeys(document.activeElement, document.body, document.documentElement) || (active && onBar(e))
      if (e.code === 'BracketRight' || e.key === ']') {
        if (!usable || e.repeat) return
        return active ? advance() : startTour()
      }
      if (!active) return
      if (e.code === 'BracketLeft' || e.key === '[') return usable && !e.repeat ? stepBack() : undefined
      if (e.key === 'Escape') return stopTour('key')
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab') return
      if (onBar(e) && (e.key === 'Enter' || e.key === ' ')) return // the button's own press
      stopTour('key') // any other key (WASD, arrows, R, ...) is free-view input: the camera stays and the key goes on to do its job
    }
    const onHidden = () => document.hidden && stopTour('hidden')

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('visibilitychange', onHidden)

    // what makes a running tour give way (a panel, the door); it never starts one (#427: only the dock's view toggle and an agent's name do)
    const timer = window.setInterval(() => {
      const panel = getSideLayout().open
      const tick = tourTick({ active: getTourState().active, controls: !!live.current.controls, busy: live.current.busy, panel, panelBefore: panelWas })
      panelWas = panel
      if (tick) stopTour(tick)
    }, 400)

    // a paper plane (#51) is an event at both desks
    const off = world.source.onMessage((m) => {
      if (m.kind !== 'handoff') return
      noteTourEvent(m.from, 3500)
      noteTourEvent(m.to, 6000)
    })

    registerTour({ start: startTour, next: advance, prev: stepBack, stop: (reason = 'button') => stopTour(reason) })
    if (world.debug) {
      ;(world as unknown as { tour: unknown }).tour = {
        start: startTour,
        next: advance,
        prev: stepBack,
        stop: () => stopTour('button'),
        /** the designer's check (#223): an event at an agent now, e.g. tour.event('agent_3') */
        event: (agent: string, ms = 6000) => noteTourEvent(agent, ms),
        state: () => ({ ...getTourState(), lastStop, pick: lastPick.work, phase: run?.phase ?? null, history: plan.history.map((c) => `${c.id}:${c.why}:v${c.variant}`), views: views() }),
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
      stopTour('unmount')
      endEase(true)
      frame.current = null
    }
  }, [limits, world, camera, scene])

  useFrame((_, dt) => frame.current?.(Math.min(dt, 0.1)))
  return null
}
