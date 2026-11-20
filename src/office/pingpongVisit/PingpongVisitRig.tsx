import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Matrix4, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three'
import { cue } from '../../audio/cues'
import { landing, paddlePoint, VISITOR_PP, type Paddle } from '../../play/visitorPingpong'
import { chipShown, WORK_HOLD, WORK_LINES } from '../../play/workHold'
import { replay } from '../../replay/store'
import { isBoardOpen } from '../boardView/store'
import { isOmokActive } from '../omokVisit/store'
import type { PlayStage } from '../playStage'
import { isTouring, tour } from '../tourStore'
import { overSpot, spotBox, trackMouse } from '../playHover'
import { officeNow, prefersReducedMotion, type OfficeWorld } from '../world'
import {
  drainPingpongEvents, getPingpongVisit, pingpongArrived, pingpongDone, pingpongLeft, pingpongWorkTold, servePingpong, setPaddle, setPingpongChip, setPingpongReady,
  setPingpongTag, stepPingpong,
} from './store'

// The 3D side of the visitor's paddle (#137 ③, play.md 3 · 5.4 · 8): the "🏓 라켓 잡기" tag over the near end while agents play there, the camera
// flown to 2.2 m behind the near end line, 1.6 m up, looking down the table (0.9 s; a cut with reduced motion), the visitor's floating red paddle,
// the pointer (a mouse: the paddle where it points; a finger: dragged from anywhere in the lower half, relative), the landing ring, the match's
// clock, the hit's sound and the agent's reactions. The HUD is PingpongVisitUi.tsx.

interface Orbit {
  target: Vector3
  enabled: boolean
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  update: () => unknown
}
type V3 = [number, number, number]

export const PP_VIEW = {
  /** the camera: behind the near end line, up from the floor (play.md 3.2) */
  backM: 2.2,
  heightM: 1.6,
  flightMs: 900,
  /** the tag over the near end */
  tagAboveM: 1.25,
  /** the paddle's blade middle above its pivot (as the agents' paddles, playStage BLADE_Y) */
  bladeY: 0.175,
  /** a finger's drag: the paddle moves this many metres per screen width */
  touchGain: 1.1,
  /** a tall screen (a phone) sees too little across at 2.2 m: higher, looking down the table (its length takes the screen's height), and wider, so the
   * paddle's whole reach and the far end show */
  narrowBackM: 2.3,
  narrowHeightM: 2.4,
  narrowLookAhead: -0.3,
  /** the paddle's reach across, with a margin, fits the screen's width (m either side of the middle) */
  fitHalfM: 0.95,
  maxFov: 80,
} as const

/**
 * the visitor's view (play.md 3.2): 2.2 m behind the near end line, 1.6 m up; on a tall screen further back and with a wider field (so the paddle's
 * reach across fits); returns the camera's place, what it looks at and its field (null: keep the office's)
 */
export function ppView(o: { x: number; y: number; z: number }, L: number, reach: number, aspect: number, fov: number): { pos: V3; target: V3; fov: number | null } {
  const nearX = o.x - L / 2
  const target: V3 = [o.x + L * 0.25, o.y, o.z]
  const half = (fov * Math.PI) / 360
  if (aspect >= 1 && Math.tan(half) * aspect * (PP_VIEW.backM - reach) >= PP_VIEW.fitHalfM * 0.9) return { pos: [nearX - PP_VIEW.backM, PP_VIEW.heightM, o.z], target, fov: null }
  const back = PP_VIEW.narrowBackM
  const pos: V3 = [nearX - back, PP_VIEW.narrowHeightM, o.z]
  const look: V3 = [o.x + L * PP_VIEW.narrowLookAhead, o.y, o.z]
  // the paddle's plane middle, as far from the camera as the view sees it: the reach across fits there
  const d = Math.hypot(back - reach, PP_VIEW.narrowHeightM - o.y - 0.2)
  const need = (2 * Math.atan(PP_VIEW.fitHalfM / (d * aspect)) * 180) / Math.PI
  return { pos, target: look, fov: Math.min(PP_VIEW.maxFov, Math.max(fov, need)) }
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)
const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

/** who would play the visitor, and who steps aside: the agent at the far end (or the one alone at the near end), playing (not working) */
export function opponentAt(goals: Record<string, { spot: string; pose: string }>, arrived: (a: string) => string | null, idle: (a: string) => boolean) {
  const at = (spot: string) => Object.keys(goals).find((a) => goals[a].pose === 'pingpong' && goals[a].spot === spot && arrived(a) === spot && idle(a)) ?? null
  const far = at('pingpong_b')
  const near = at('pingpong_a')
  if (far) return { agent: far, watcher: near }
  if (near) return { agent: near, watcher: null }
  return null
}

export function PingpongVisitRig({ world }: { world: OfficeWorld }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const live = useRef({ controls, size })
  live.current = { controls, size }
  const run = useRef<{ kind: 'in' | 'out'; t0: number; dur: number; fromP: V3; fromT: V3; toP: V3; toT: V3 } | null>(null)
  const saved = useRef<{ fov: number; pos: V3; target: V3; limits: { minD: number; maxD: number; minP: number; maxP: number; enabled: boolean } } | null>(null)
  const found = useRef<PlayStage | null>(null)
  const stage = (): PlayStage | undefined => {
    if (!found.current) scene.traverse((o) => void (found.current ??= (o.userData.playStage as PlayStage | undefined) ?? null))
    return found.current ?? undefined
  }
  // the pointer: a mouse's last point, a finger's drag start
  const ptr = useRef({ x: 0.5, y: 0.5, mouse: false, drag: null as { id: number; x: number; y: number; p: Paddle } | null, lastZ: 0, lastT: 0, vz: 0 })

  // the visitor's paddle: the near end's paddle model, its own copy, the faces red; and the landing ring (cyan, 0.12 m)
  const marks = useMemo(() => {
    const ring = new Mesh(new RingGeometry(0.05, 0.06, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#4df3ff', transparent: true, depthWrite: false }))
    ring.visible = false
    ring.renderOrder = 5
    return { ring, paddle: null as Object3D | null }
  }, [])
  useEffect(() => {
    const src = scene.getObjectByName('prop_paddle_a')
    if (src) {
      const p = src.clone(true)
      p.name = 'visitor_paddle'
      p.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh) return
        const mat = (m.material as Material).clone() as MeshBasicMaterial
        // the rubber faces (the darker or redder ones) red; the wooden handle as it is
        const c = mat.color
        if (c && (c.r > c.g * 1.4 || c.r + c.g + c.b < 0.6)) c.set('#d8433a')
        m.material = mat
      })
      p.visible = false
      p.matrixAutoUpdate = false
      scene.add(p)
      marks.paddle = p
    }
    scene.add(marks.ring)
    return () => {
      if (marks.paddle) scene.remove(marks.paddle)
      marks.paddle = null
      scene.remove(marks.ring)
    }
  }, [scene, marks])

  const restore = useRef<() => void>(() => {})
  restore.current = () => {
    const c = live.current.controls
    const s = saved.current
    if (!c || !s) return
    camera.position.set(...s.pos)
    camera.fov = s.fov
    camera.updateProjectionMatrix()
    c.target.set(...s.target)
    c.minDistance = s.limits.minD
    c.maxDistance = s.limits.maxD
    c.minPolarAngle = s.limits.minP
    c.maxPolarAngle = s.limits.maxP
    c.enabled = s.limits.enabled
    c.update()
    saved.current = null
  }
  useEffect(() => () => restore.current(), [])

  // the paddle's reach: across the table's width and 0.3 m either side; 0.8–1.2 m above the floor (play.md 3.2)
  const range = () => {
    const t = stage()?.pingpongTable
    if (!t) return null
    const W = t.dims.W
    return { z: [-W / 2 - VISITOR_PP.sideM, W / 2 + VISITOR_PP.sideM] as const, y: [VISITOR_PP.heightM[0] - t.o.y, VISITOR_PP.heightM[1] - t.o.y] as const }
  }
  const put = (z: number, y: number) => {
    const r = range()
    if (!r) return
    const now = performance.now() / 1000
    const p = ptr.current
    const zz = clamp(z, r.z[0], r.z[1])
    const dt = now - p.lastT
    if (dt > 0 && dt < 0.2) p.vz = p.vz * 0.5 + ((zz - p.lastZ) / dt) * 0.5
    p.lastZ = zz
    p.lastT = now
    setPaddle({ z: zz, y: clamp(y, r.y[0], r.y[1]), vz: p.vz })
  }

  // the pointer: a mouse points the paddle (across = the table's width, up = 0.8–1.2 m); a finger drags it from anywhere in the lower half
  useEffect(() => {
    const el = gl.domElement
    const frac = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height }
    }
    const onMove = (e: PointerEvent) => {
      const v = getPingpongVisit()
      if (v.phase !== 'open' || v.match?.easy) return
      const r = range()
      if (!r) return
      const f = frac(e)
      if (e.pointerType === 'mouse') {
        put(r.z[0] + f.x * (r.z[1] - r.z[0]), r.y[1] - f.y * (r.y[1] - r.y[0]))
        return
      }
      const d = ptr.current.drag
      if (!d || d.id !== e.pointerId) return
      const gain = PP_VIEW.touchGain * (r.z[1] - r.z[0])
      put(d.p.z + ((e.clientX - d.x) / f.w) * gain, d.p.y - ((e.clientY - d.y) / f.h) * gain)
    }
    const onDown = (e: PointerEvent) => {
      const v = getPingpongVisit()
      if (v.phase !== 'open') return
      if (e.pointerType !== 'mouse' && frac(e).y >= 0.5) ptr.current.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, p: v.paddle }
    }
    const onUp = (e: PointerEvent) => {
      const v = getPingpongVisit()
      if (ptr.current.drag?.id === e.pointerId) {
        const d = ptr.current.drag
        ptr.current.drag = null
        // a tap (not a drag) serves
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return
      }
      if (v.phase === 'open' && v.match?.phase === 'serve') servePingpong()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  // #670 (play.md 2.1.1) the mouse over the table shows the tag
  useEffect(() => trackMouse(gl.domElement), [gl])

  const tmpM = useMemo(() => new Matrix4(), [])
  /** #601 the cap's line said for this wound-up match */
  const stopSaid = useRef(false)
  useFrame((state, dt) => {
    const st = stage()
    const table = st?.pingpongTable
    const v = getPingpongVisit()
    const c = live.current.controls
    if (!table) return
    const { o, dims } = table
    const nearX = o.x - dims.L / 2

    // the tag: agents play at the table (both, or one alone at either end); not during another visit, the tour, the board view or the replay
    let tag: ReturnType<typeof getPingpongVisit>['tag'] = null
    if (v.phase === 'closed' && !isOmokActive() && !isTouring() && !isBoardOpen() && replay.getSnapshot().mode === 'off') {
      const who = opponentAt(world.goals, (a) => world.rigs[a]?.arrived ?? null, (a) => world.source.getSnapshot()[a]?.state === 'idle')
      if (who) {
        camera.updateMatrixWorld(true)
        const p = new Vector3(nearX, PP_VIEW.tagAboveM, o.z).project(camera)
        const { width: w, height: h } = live.current.size
        // the table, from the floor up to the tag's place over its near end
        const hot = overSpot('pingpong', spotBox([{ x: o.x, z: o.z, hx: dims.L / 2, hz: dims.W / 2 }], PP_VIEW.tagAboveM), camera, w, h)
        if (p.z < 1) tag = { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, ...who, dims, hot }
      }
    }
    setPingpongTag(tag)

    // the camera: flown in from wherever it was, back to it when the visitor leaves
    if (c) {
      if (v.phase === 'closed' && saved.current) {
        run.current = null
        restore.current()
      }
      if (v.phase === 'flying' && !run.current && !saved.current) {
        tour.stop('board')
        saved.current = { fov: camera.fov, pos: v3(camera.position), target: v3(c.target), limits: { minD: c.minDistance, maxD: c.maxDistance, minP: c.minPolarAngle, maxP: c.maxPolarAngle, enabled: c.enabled } }
        c.enabled = false
        c.minDistance = 0.05
        c.maxDistance = 100
        c.minPolarAngle = 0
        c.maxPolarAngle = Math.PI
        const view = ppView(o, dims.L, dims.reach ?? 0.25, camera.aspect, camera.fov)
        const toP = view.pos
        const toT = view.target
        if (view.fov !== null) {
          camera.fov = view.fov
          camera.updateProjectionMatrix()
        }
        run.current = { kind: 'in', t0: performance.now(), dur: prefersReducedMotion() ? 0 : PP_VIEW.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP, toT }
      }
      if (v.phase === 'leaving' && run.current?.kind !== 'out') {
        const s = saved.current
        if (!s) pingpongLeft()
        else run.current = { kind: 'out', t0: performance.now(), dur: prefersReducedMotion() ? 0 : PP_VIEW.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP: s.pos, toT: s.target }
      }
      const r = run.current
      if (r) {
        const k = r.dur ? Math.min(1, (performance.now() - r.t0) / r.dur) : 1
        const e = ease(k)
        camera.position.set(...lerp3(r.fromP, r.toP, e))
        c.target.set(...lerp3(r.fromT, r.toT, e))
        c.update()
        if (k >= 1) {
          run.current = null
          if (r.kind === 'in') pingpongArrived()
          else {
            restore.current()
            pingpongLeft()
          }
        }
      }
    }

    // the match's clock once the agent stands at the far end; its sounds and the agent's reactions (play.md 3.3)
    const agent = v.agent ? world.rigs[v.agent] : undefined
    // at its end and standing there (the traffic's "arrived" alone has been seen while the body stood elsewhere)
    const spot = world.graph?.spots.pingpong_b
    const ready = v.phase === 'open' && agent?.arrived === 'pingpong_b' && !!spot && Math.hypot(agent.x - spot.x, agent.z - spot.z) < 0.3
    setPingpongReady(!!ready)
    if (ready) {
      stepPingpong(Math.min(dt, 0.1))
      for (const ev of drainPingpongEvents()) {
        const t = state.clock.elapsedTime
        if (ev.kind === 'hit' && ev.side === 0) cue('pingpong.hit', { pos: { x: o.x + ev.at[0], y: o.y + ev.at[1], z: o.z + ev.at[2] } })
        else if (ev.kind === 'point') {
          // the agent won the point: a small fist; lost it: the head down and up again
          if (ev.winner === 1) agent.reaction = prefersReducedMotion() ? null : { kind: 'fist', t0: t, dur: 0.6 }
          else agent.paperReaction('nod', t, prefersReducedMotion())
        } else if (ev.kind === 'over') {
          // match.win once, at the winner's side: the visitor's paddle, or the agent (sound.md, #593); no sound for each point
          const pp = paddlePoint(v.paddle, dims)
          cue('match.win', { pos: ev.winner === 0 ? { x: o.x + pp[0], y: o.y + pp[1], z: o.z + pp[2] } : { x: agent.x, y: 1, z: agent.z } })
          // #601 called to work during the match: the line says it goes to work, no asking for another (play.md 10.3)
          const work = !!getPingpongVisit().work
          const text = ev.winner === 1 ? (work ? WORK_LINES.agentWon.pingpong : '좋은 경기였어요!') : work ? WORK_LINES.visitorWon : '한 번 더 할래요?'
          world.bubbles.say(v.agent!, { kind: 'react', text, ms: 3500, whole: true }, Date.now())
        }
      }
    }
    if (v.phase === 'leaving' || v.phase === 'closed') drainPingpongEvents()

    // #601 called to work during the match (play.md 10.2 · 10.3): the moment once the ball is dead (between points, a serve waiting), the chip
    // over the agent's head, and the cap's line when it winds the match up
    const wv = getPingpongVisit()
    const mm = wv.match
    if (agent && v.agent && mm && v.phase === 'open') {
      const dead = mm.decided !== null || mm.phase === 'serve' || mm.phase === 'toss' || mm.phase === 'over'
      if (wv.work && !wv.work.told && dead) {
        const desk = world.graph?.spots[`work_${v.agent.split('_')[1]}`]
        if (!prefersReducedMotion() && desk) agent.propLook = { at: new Vector3(desk.x, 1, desk.z), nod: true, t0: null, s: WORK_HOLD.lookS, maxYaw: (WORK_HOLD.lookDeg * Math.PI) / 180 }
        agent.faceEvent('surprised', state.clock.elapsedTime)
        world.bubbles.say(v.agent, { kind: 'react', text: WORK_LINES.moment.pingpong, ms: WORK_HOLD.momentMs, whole: true }, Date.now())
        pingpongWorkTold(officeNow(world))
      }
      if (wv.stopped && !stopSaid.current) {
        stopSaid.current = true
        world.bubbles.say(v.agent, { kind: 'react', text: WORK_LINES.cap, ms: WORK_HOLD.capLineMs, whole: true }, Date.now())
      }
    }
    if (!wv.stopped) stopSaid.current = false
    let chip: { x: number; y: number } | null = null
    if (agent && chipShown(wv.work, officeNow(world)) && v.phase === 'open' && !pingpongDone()) {
      const head = agent.parts.head.getWorldPosition(new Vector3())
      head.y += 0.35
      head.project(camera)
      if (head.z < 1) chip = { x: ((head.x + 1) / 2) * live.current.size.width, y: ((1 - head.y) / 2) * live.current.size.height }
    }
    setPingpongChip(chip)

    // the paddle and the ring
    const pd = marks.paddle
    const m = v.match
    const show = v.phase !== 'closed' && !!m
    if (pd) {
      pd.visible = show
      if (show) {
        const p = v.paddle
        const at = paddlePoint(p, dims)
        // the blade faces down the table (+x), tilted with the sideways speed (±25°), its pivot under the blade's middle
        const tilt = clamp(-p.vz * 0.35, -1, 1) * (VISITOR_PP.tiltDeg * Math.PI) / 180
        tmpM.makeRotationX(tilt).premultiply(new Matrix4().makeRotationY(Math.PI / 2))
        const pos = new Vector3(o.x + at[0], o.y + at[1], o.z + at[2]).sub(new Vector3(0, PP_VIEW.bladeY, 0).applyMatrix4(new Matrix4().extractRotation(tmpM)))
        tmpM.setPosition(pos)
        pd.matrix.copy(tmpM)
        pd.matrixWorldNeedsUpdate = true
      }
    }
    const l = show && m ? landing(m) : null
    const lead = m ? VISITOR_PP.ringLeadS[m.speed] : 0
    marks.ring.visible = !!l && l.inS <= lead
    if (l) marks.ring.position.set(o.x + l.at[0], o.y + 0.003, o.z + l.at[2])
  })
  return null
}
