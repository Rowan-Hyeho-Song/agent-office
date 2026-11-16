import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Group, Matrix4, CylinderGeometry, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Raycaster, RingGeometry, Vector2, Vector3, type PerspectiveCamera } from 'three'
import { cue } from '../../audio/cues'
import type { Expression } from '../faceModel'
import type { PlayStage } from '../playStage'
import { isTouring, tour } from '../tourStore'
import { officeNow, prefersReducedMotion, type OfficeWorld } from '../world'
import { replay } from '../../replay/store'
import { OMOK_LINES, visitorStone, visitorWon, type Face } from '../../play/visitorOmok'
import { chipShown, WORK_HOLD, WORK_LINES } from '../../play/workHold'
import { faceScreenRect } from './bubbleAnchor'
import { isBoardOpen } from '../boardView/store'
import { isPingpongActive } from '../pingpongVisit/store'
import {
  armOmok, closeOmok, drainOmokEvents, getOmokVisit, omokArrived, omokForbidAt, omokLeft, omokWorkTold, placeOmok, setOmokBoardBox, setOmokChip, setOmokPreview, setOmokTag,
  stepOmok, visitorMayPlace,
} from './store'
import { OMOK_VIEW, fitView, v3, visitPose, type V3 } from './pose'

// The 3D side of the visitor's omok (#137 ②, play.md 2 · 4 · 8): where the "같이 두기" tag stands (over the empty chair while an agent places a
// record alone), the camera flown to behind the visitor's chair (55° down onto the board, about 60% of the screen's height, the agent's head and
// hands across it), the game's clock and what the agent says and shows, the pointer over the board (a preview stone; a click places it, a touch
// arms it first), the keyboard's cursor ring and the last move's red dot. The UI (tag, HUD, keyboard grid) is OmokVisitUi.tsx.

interface Orbit {
  target: Vector3
  enabled: boolean
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  update: () => unknown
}

/** play.md 2.5: a game the visitor did not finish (quiet, called to work) closes this long after the agent's last word */
const END_CLOSE_MS = 2500
const FACE: Record<Face, Expression> = { think: 'thinking', surprised: 'surprised', joy: 'joy', embarrassed: 'embarrassed', nod: 'nodding' }

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)
const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

export function OmokVisitRig({ world }: { world: OfficeWorld }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const live = useRef({ controls, size })
  live.current = { controls, size }
  const run = useRef<{ kind: 'in' | 'out'; t0: number; dur: number; fromP: V3; fromT: V3; toP: V3; toT: V3 } | null>(null)
  const saved = useRef<{ pos: V3; target: V3; limits: { minD: number; maxD: number; minP: number; maxP: number; enabled: boolean } } | null>(null)
  const endAt = useRef<number | null>(null)
  /** the won game the match.win cue was played for (once per game) */
  const wonKey = useRef<string | null>(null)
  // the stage lives on the office model's scene (Agents.tsx), under the root: found once
  const found = useRef<PlayStage | null>(null)
  const stage = (): PlayStage | undefined => {
    if (!found.current) scene.traverse((o) => void (found.current ??= (o.userData.playStage as PlayStage | undefined) ?? null))
    return found.current ?? undefined
  }

  // the marks on the board: the preview stone, the cursor ring, the last move's dot
  const marks = useMemo(() => {
    const preview = new Mesh(new CylinderGeometry(0.0105, 0.0105, 0.006, 20), new MeshBasicMaterial({ color: '#111318', transparent: true, opacity: 0.5, depthWrite: false }))
    const cursor = new Mesh(new RingGeometry(0.0115, 0.0145, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#5fd6c8', transparent: true, depthWrite: false }))
    const last = new Mesh(new CircleGeometry(0.002, 16).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#e05a4f', depthWrite: false }))
    for (const m of [preview, cursor, last]) {
      m.visible = false
      m.renderOrder = 5
    }
    // #603 (play.md 11.4) a forbidden point: ✕ on the board's plane in a unit cell (scaled by the grid step): two strokes at 45°, 0.6 long, 0.10
    // thick, square ends, red over an ink outline (60%, 0.02) so it reads on the wood; painted as it is (no tone mapping: it went dark brown, #617)
    const forbid = new Group()
    // both strokes in the transparent pass, the red after the ink (an opaque red was drawn first and the ink outline went over it)
    const stroke = (len: number, wid: number, color: string, opacity: number, ry: number, y: number, order: number) => {
      const m = new Mesh(new PlaneGeometry(len, wid).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }))
      m.rotation.y = ry
      m.position.y = y
      m.renderOrder = order
      return m
    }
    for (const ry of [Math.PI / 4, -Math.PI / 4]) forbid.add(stroke(0.6 + 0.04, 0.1 + 0.04, '#111318', 0.6, ry, 0, 6))
    for (const ry of [Math.PI / 4, -Math.PI / 4]) forbid.add(stroke(0.6, 0.1, '#ff5a5f', 1, ry, 0.0005, 7))
    forbid.visible = false
    return { preview, cursor, last, forbid }
  }, [])
  useEffect(() => {
    scene.add(marks.preview, marks.cursor, marks.last, marks.forbid)
    return () => {
      scene.remove(marks.preview, marks.cursor, marks.last, marks.forbid)
    }
  }, [scene, marks])

  const restore = useRef<() => void>(() => {})
  restore.current = () => {
    const c = live.current.controls
    const s = saved.current
    if (!c || !s) return
    camera.position.set(...s.pos)
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

  // the pointer over the board: a preview for a mouse, an armed point for a touch (the same point again places it)
  useEffect(() => {
    const el = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const at = (e: PointerEvent): number | null => {
      const st = stage()
      const g = st?.omokGrid
      if (!st || !g) return null
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -g.o.y), new Vector3())
      return hit ? st.omokCellAt(hit) : null
    }
    const move = (e: PointerEvent) => {
      if (getOmokVisit().phase !== 'open' || e.pointerType !== 'mouse') return
      setOmokPreview(visitorMayPlace() ? at(e) : null)
    }
    const up = (e: PointerEvent) => {
      const v = getOmokVisit()
      if (v.phase !== 'open' || !visitorMayPlace()) return
      const cell = at(e)
      if (cell === null) return
      const now = officeNow(world)
      if (e.pointerType === 'mouse') placeOmok(cell, now)
      else if (v.armed === cell) placeOmok(cell, now)
      else armOmok(cell)
    }
    const leave = () => setOmokPreview(null)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', leave)
    }
  }, [gl, camera, world])

  /**
   * #137 B (designer): the wide screen's view fitted to this screen: the agent's face screen and the board's near edge measured from a trial camera
   * (pose.ts fitView); a phone keeps its own (OMOK_VIEW.fillNarrow)
   */
  const fit = (agent: string | null) => {
    const st = stage()
    const g = st?.omokGrid
    const seat = world.graph?.spots.game_b
    const face = agent ? scene.getObjectByName(`${agent}_face`) : undefined
    if (!g || !seat || !face || camera.aspect < 1) return undefined
    const center = new Vector3(g.o.x + ((g.n - 1) / 2) * g.cell, g.o.y, g.o.z + ((g.n - 1) / 2) * g.cell)
    // the face screen's corners with the head upright at its rest (it bows over the board and looks up at the visitor by turns: fitted upright, the
    // face screen is never cut, and sits lower while the head is bowed)
    const rig = agent ? world.rigs[agent] : undefined
    const pos = (face as Mesh).geometry?.getAttribute('position')
    if (!rig || !pos) return undefined
    const head = rig.parts.head
    rig.parts.root.updateMatrixWorld(true)
    const faceInHead = new Matrix4().copy(head.matrixWorld).invert().multiply(face.matrixWorld)
    const restHead = new Matrix4().copy(rig.parts.root.matrixWorld).multiply(new Matrix4().makeTranslation(head.position.x, rig.parts.headRestY + rig.seatLift, head.position.z))
    const toWorld = restHead.multiply(faceInHead)
    const corners = Array.from({ length: pos.count }, (_, i) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(toWorld))
    const d = new Vector3(seat.x - center.x, 0, seat.z - center.z).normalize()
    const half = ((g.n - 1) / 2 + 1.3) * g.cell
    // the board's near edge: a cell and a bit past the grid's near row, at the board's foot
    const near = new Vector3(center.x + d.x * half, g.o.y - 0.025, center.z + d.z * half)
    const trial = camera.clone()
    const h = live.current.size.height
    const sy = (p: Vector3) => ((1 - p.clone().project(trial).y) / 2) * h
    return fitView((view) => {
      const p = visitPose(center, seat, g.n * g.cell, camera.fov, camera.aspect, view)
      trial.position.set(...p.position)
      trial.lookAt(...p.target)
      trial.updateMatrixWorld(true)
      return { faceTop: Math.min(...corners.map(sy)), nearEdge: sy(near) }
    }, h)
  }

  useFrame((state) => {
    const st = stage()
    const g = st?.omokGrid
    const v = getOmokVisit()
    const now = officeNow(world)
    const center = g ? new Vector3(g.o.x + ((g.n - 1) / 2) * g.cell, g.o.y, g.o.z + ((g.n - 1) / 2) * g.cell) : null
    const seat = world.graph?.spots.game_b
    const c = live.current.controls

    // the tag: an agent alone at the board placing a record (play.md 2.1, 5.5); not during the game, the tour, the board view or the replay
    let tag: ReturnType<typeof getOmokVisit>['tag'] = null
    if (v.phase === 'closed' && center && seat && !isPingpongActive() && !isTouring() && !isBoardOpen() && replay.getSnapshot().mode === 'off') {
      const goals = world.goals
      const alone = Object.keys(goals).find((a) => goals[a].pose === 'boardgame' && goals[a].spot === 'game_a' && world.rigs[a]?.arrived === 'game_a')
      const opposite = Object.values(goals).some((x) => x.spot === 'game_b')
      if (alone && !opposite && world.source.getSnapshot()[alone]?.state === 'idle') {
        camera.updateMatrixWorld(true)
        const p = new Vector3(seat.x, OMOK_VIEW.tagAboveM, seat.z).project(camera)
        if (p.z < 1) tag = { x: ((p.x + 1) / 2) * live.current.size.width, y: ((1 - p.y) / 2) * live.current.size.height, agent: alone, orient: visitPose(center, seat, g!.n * g!.cell, camera.fov, camera.aspect).orient }
      }
    }
    setOmokTag(tag)

    // the camera: flown in from wherever it was, back to it when the visitor leaves
    if (c && center && seat) {
      if (v.phase === 'closed' && saved.current) {
        run.current = null
        restore.current()
      }
      if (v.phase === 'flying' && !run.current && !saved.current) {
        tour.stop('board')
        saved.current = { pos: v3(camera.position), target: v3(c.target), limits: { minD: c.minDistance, maxD: c.maxDistance, minP: c.minPolarAngle, maxP: c.maxPolarAngle, enabled: c.enabled } }
        c.enabled = false
        c.minDistance = 0.05
        c.maxDistance = 100
        c.minPolarAngle = 0
        c.maxPolarAngle = Math.PI
        const pose = visitPose(center, seat, g!.n * g!.cell, camera.fov, camera.aspect, fit(v.agent))
        run.current = { kind: 'in', t0: performance.now(), dur: prefersReducedMotion() ? 0 : OMOK_VIEW.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP: pose.position, toT: pose.target }
      }
      if (v.phase === 'leaving' && run.current?.kind !== 'out') {
        const s = saved.current
        if (!s) omokLeft()
        else run.current = { kind: 'out', t0: performance.now(), dur: prefersReducedMotion() ? 0 : OMOK_VIEW.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP: s.pos, toT: s.target }
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
          if (r.kind === 'in') omokArrived()
          else {
            restore.current()
            omokLeft()
          }
        }
      }
    }

    // the game's clock; what the agent says and shows (play.md 2.4 · 2.5)
    if (v.phase !== 'closed' && v.agent) {
      stepOmok(now)
      // #601 called to work during the game: the result's line also says it goes to work (play.md 10.3)
      const held = !!getOmokVisit().work
      for (const ev of drainOmokEvents()) {
        if (ev.kind === 'say') {
          const text = held && ev.text === OMOK_LINES.visitorWon ? WORK_LINES.visitorWon : held && ev.text === OMOK_LINES.agentWon ? WORK_LINES.agentWon.omok : ev.text
          world.bubbles.say(v.agent, { kind: 'react', text, ms: ev.text === OMOK_LINES.work ? WORK_HOLD.capLineMs : 3500, whole: true }, now)
        } else world.rigs[v.agent]?.faceEvent(FACE[ev.face], state.clock.elapsedTime)
      }
      // #601 the moment the call came (once, once a stone in the hand is down): a look 25° toward the desk for 0.6 s, surprised then a nod, the line
      const wv = getOmokVisit()
      const gm = wv.game
      const rigA = world.rigs[v.agent]
      const midMove = !!gm && (!!gm.pending || (!!gm.landed && now < gm.landed.at + gm.landed.thinkMs + 1000))
      if (wv.work && !wv.work.told && !gm?.end && !midMove && rigA) {
        const desk = world.graph?.spots[`work_${v.agent.split('_')[1]}`]
        const t = state.clock.elapsedTime
        if (!prefersReducedMotion() && desk) rigA.propLook = { at: new Vector3(desk.x, 1, desk.z), nod: true, t0: null, s: WORK_HOLD.lookS, maxYaw: (WORK_HOLD.lookDeg * Math.PI) / 180 }
        rigA.faceEvent('surprised', t)
        world.bubbles.say(v.agent, { kind: 'react', text: WORK_LINES.moment.omok, ms: WORK_HOLD.momentMs, whole: true }, now)
        omokWorkTold(now)
      }
      // the work chip beside the face screen, its top aligned, 8 px off (play.md 10.2: the face screen has 12 px over it in this view)
      const face = scene.getObjectByName(`${v.agent}_face`) as Mesh | undefined
      const fr = chipShown(wv.work, now) && !gm?.end && v.phase === 'open' && face ? faceScreenRect(face, camera, { left: 0, top: 0, width: live.current.size.width, height: live.current.size.height }) : null
      setOmokChip(fr ? { x: fr.right + 8, y: fr.top } : null)
      // the game won (a five, or the agent resigned and the visitor played on): match.win once, at the winner's side (sound.md, #593)
      const gw = getOmokVisit().game
      const res = gw?.end?.result
      const key = gw?.end && (res === 'black' || res === 'resign' || res === 'white') ? `${gw.seed}|${gw.game}|${gw.end.at}` : null
      if (key && wonKey.current !== key) {
        wonKey.current = key
        const r = world.rigs[v.agent]
        // #603 the visitor may hold white after a swap: who won, not which colour
        const at = gw && visitorWon(gw) ? (seat ? { x: seat.x, y: 0.9, z: seat.z } : undefined) : r ? { x: r.x, y: 1, z: r.z } : undefined
        cue('match.win', { pos: at })
      }
      if (!gw?.end) wonKey.current = null
      // a game it let go (quiet) closes by itself after the agent's word; #601 one wound up for work stays until the visitor leaves (play.md 10.3)
      const game = getOmokVisit().game
      const over = game?.end && game.end.result === 'idle'
      if (over && endAt.current === null) endAt.current = now
      if (!over) endAt.current = null
      if (over && endAt.current !== null && now - endAt.current >= END_CLOSE_MS && getOmokVisit().phase === 'open') closeOmok(now)
    }

    // #603 (designer, #617) the board's right edge and middle on the screen: the chooser stands beside it on a wide screen
    if (g && v.picker) {
      const r = gl.domElement.getBoundingClientRect()
      const sx = (p: Vector3) => r.left + ((p.x + 1) / 2) * r.width
      const sy = (p: Vector3) => r.top + ((1 - p.y) / 2) * r.height
      let right = -Infinity
      let top = Infinity
      let bottom = -Infinity
      for (const [i, j] of [[-1, -1], [g.n, -1], [-1, g.n], [g.n, g.n]]) {
        const p = new Vector3(g.o.x + i * g.cell, g.o.y, g.o.z + j * g.cell).project(camera)
        right = Math.max(right, sx(p))
        top = Math.min(top, sy(p))
        bottom = Math.max(bottom, sy(p))
      }
      setOmokBoardBox({ right, middle: (top + bottom) / 2 })
    }

    // the marks
    const show = v.phase === 'open' && !!g && !!st
    const put = (m: Mesh, cell: number | null, lift: number) => {
      m.visible = show && cell !== null && cell >= 0
      if (m.visible) {
        st!.omokPoint(cell!, m.position)
        m.position.y += lift
      }
    }
    const game = v.game
    const empty = (cell: number) => !!game && game.s.board[cell] === 0
    const hover = v.preview ?? v.armed
    // #603 the ✕ instead of the preview stone where the visitor may not stand (the pointer's point, a first tap, else the keyboard's cursor)
    const xAt = hover !== null && omokForbidAt(hover) ? hover : v.preview === null && omokForbidAt(v.cursor) ? v.cursor : null
    put(marks.preview, hover !== null && empty(hover) && visitorMayPlace() && hover !== xAt ? hover : null, 0.003)
    // #603 the preview stone in the colour the visitor places now (swap: their opening alternates, or white after the choice)
    if (game) (marks.preview.material as MeshBasicMaterial).color.set(visitorStone(game) === 1 ? '#111318' : '#f3f0e8')
    marks.forbid.visible = show && xAt !== null
    if (marks.forbid.visible && g) {
      st!.omokPoint(xAt!, marks.forbid.position)
      marks.forbid.position.y += 0.0014
      marks.forbid.scale.setScalar(g.cell)
      // pressed: two shakes side to side, ±2 px, 0.25 s (not with reduced motion)
      const f = v.forbid
      const k = f && f.cell === xAt && !prefersReducedMotion() ? (now - f.at) / 250 : 1
      if (k >= 0 && k < 1) marks.forbid.position.x += Math.sin(k * Math.PI * 4) * g.cell * 0.08
    }
    put(marks.cursor, v.preview === null ? v.cursor : null, 0.0012)
    put(marks.last, game && game.s.lastMove >= 0 ? game.s.lastMove : null, 0.0062)
  })
  return null
}
