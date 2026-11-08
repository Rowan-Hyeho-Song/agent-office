import { Html } from '@react-three/drei'
import { setDoorMessage } from '../room/doorMessage'
import { BubbleLayer, type Anchor, type TagItem } from './bubbleLayer'
import { statusTag, type BubbleItem } from './bubbles'
import { openDocs } from './docs/panel'
import { seatName } from './meeting'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Color, Vector3, Float32BufferAttribute, Line, LineBasicMaterial, LineSegments, type Mesh } from 'three'
import { buildGraph, dist, pathLength, patchSpots, shortestPath, type NavGraph } from './nav'
import { checkNav, edgeKey } from './navcheck'
import { meshesOf, useOffice } from './nodes'
import { DeskLive } from './deskLive'
import { PaperPlanes } from './plane'
import { ScreenLive } from './screenLive'
import { deskProps } from './props'
import { AgentRig, PropBank, buildRig } from './rig'
import { replay } from '../replay/store'
import { atMs, stepMs } from '../replay/engine'
import { boardDistance, REPLAY_PACE, shouldWalk, stageSpot, walkHold, WALK_HOLD_MS } from '../replay/walk'
import { replayDoorLine, replayGoals } from '../replay/scene'
import { STAMP_MS } from './props'
import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'
import type { RootState } from '@react-three/fiber'

/**
 * Same rule as the design tokens (src/styles/tokens.css): html[data-motion="reduce"|"full"] (the setting shared
 * with the desk room) wins, otherwise the OS prefers-reduced-motion.
 */
function useReducedMotion() {
  const read = () => {
    const forced = document.documentElement.dataset.motion
    if (forced === 'reduce' || forced === 'full') return forced === 'reduce'
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  const [reduced, setReduced] = useState(read)
  useEffect(() => {
    const on = () => setReduced(read())
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    m.addEventListener('change', on)
    const attr = new MutationObserver(on)
    attr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
    return () => {
      m.removeEventListener('change', on)
      attr.disconnect()
    }
  }, [])
  return reduced
}

/** The agents: each frame the director picks goals from the status source and the clock, the rigs move. */
export function Agents({ world }: { world: OfficeWorld }) {
  const { scene, nodes, spots } = useOffice()
  const graph = useMemo(() => {
    // ?debug=1&nav=… tries spots before they are re-baked into the model
    const tryout = world.debug ? (new URLSearchParams(location.search).get('nav') ?? '') : ''
    return buildGraph(patchSpots(spots, tryout))
  }, [world, spots])
  const rigs = useMemo(
    () =>
      Object.fromEntries(
        world.director.agents.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), AGENT_COLORS[id])]),
      ),
    [world, scene, nodes],
  )
  // the props agents pick up while playing (#20, #27); once per loaded scene
  const props = useMemo(() => (scene.userData.props ??= new PropBank(scene, nodes)) as PropBank, [scene, nodes])
  // the LIVE desk props (#44): what each desk shows about its agent
  const desks = useMemo(() => new DeskLive(nodes), [nodes])
  // the work monitors (#75); ?debug=1&screens=off leaves them blank (the frame-cost baseline)
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const screens = useMemo(
    () => (world.debug && new URLSearchParams(location.search).get('screens') === 'off' ? null : new ScreenLive(nodes, maxAniso)),
    [world, nodes, maxAniso],
  )
  world.screens.counters = () => ({ uploads: screens?.uploads ?? 0, fullDraws: screens?.fullDraws ?? 0, stripDraws: screens?.stripDraws ?? 0, ms: screens?.ms ?? 0 })
  world.screens.centers = () => screens?.monitors.map((m) => m.sphere.center.toArray()) ?? []
  // handoffs between agents fly as a paper plane (#51)
  const planes = useMemo(() => (scene.userData.planes ??= new PaperPlanes(props, nodes)) as PaperPlanes, [scene, props, nodes])
  world.planes = planes
  const reduced = useReducedMotion()
  const layer = useRef<BubbleLayer | null>(null)
  const walkPlan = useRef<{ key: string; spots: Record<string, string>; walk: Record<string, boolean> }>({ key: '', spots: {}, walk: {} })
  const narrow = useMemo(() => matchMedia('(max-width: 640px)'), [])
  const head = useMemo(() => new Vector3(), [])
  useEffect(() => {
    const l = new BubbleLayer((t) => openDocs({ repo: t.repo, n: t.n, kind: 'minutes', row: t.row }))
    l.mount()
    layer.current = l
    return () => {
      l.dispose()
      layer.current = null
      setDoorMessage(null)
    }
  }, [])
  world.rigs = rigs
  for (const id in rigs) {
    const seat = Number(id.split('_')[1])
    const path = graph.spots.whiteboard ? shortestPath(graph, `work_${seat}`, 'whiteboard') : null
    if (path) boardDistance[seat] = pathLength(graph, path)
  }
  world.graph = graph

  useEffect(
    () =>
      world.source.onMessage((m) => {
        world.director.receive(m)
        planes.receive(m)
      }),
    [world, planes],
  )

  useFrame((state, dt) => {
    const now = officeNow(world)
    const t = state.clock.elapsedTime
    // the timelapse (#82): the record's statuses and desk goals stand in for the live ones (and the director's play)
    const scene = replay.getSnapshot().mode === 'office' ? replay.scene() : null
    const status = scene ? scene.status : world.source.getSnapshot()
    let stage: Record<string, string> = {}
    if (scene) {
      // walking is presentation only (#117): decided once per landing / speed, never part of the scene
      const rs = replay.getSnapshot()
      const key = `${scene.index}:${replay.landedAt}:${rs.speed}:${reduced}`
      if (walkPlan.current.key !== key) {
        const spots: Record<string, string> = {}
        const walk: Record<string, boolean> = {}
        for (const id in rigs) {
          const seat = Number(id.split('_')[1])
          const want = stageSpot(scene.point, seat)
          const rig = rigs[id]
          const from = rig.arrived
          const to = graph.spots[want]
          const path = from && to ? shortestPath(graph, from, want) : null
          const distanceM = from === want ? 0 : from ? (path ? pathLength(graph, path) : Infinity) : to ? dist(rig, to) : Infinity
          walk[id] = shouldWalk({ speed: rs.speed, via: replay.landedVia, reduced, distanceM, budgetMs: stepMs(scene.point, rs.speed) + WALK_HOLD_MS })
          spots[id] = walk[id] ? want : `work_${seat}`
        }
        walkPlan.current = { key, spots, walk }
      }
      stage = walkPlan.current.spots
    }
    const goals = scene ? replayGoals(status, stage) : world.director.goals(now, Math.floor(now / 60000), status, (a) => rigs[a].arrived)
    // a replayed meeting calls its agents in (plan 6.4); the director's goals are the fallback for everyone else
    world.replay?.tick()
    const door = graph.spots.door
    world.meeting.apply(now, (a) => rigs[a].arrived, goals, door ? { x: door.x, z: door.z } : undefined)
    world.goals = goals
    const desk = scene
      ? deskProps({
          ...world.props.getSnapshot(),
          pending: scene.pending,
          waitingSeats: scene.waitingSeats,
          decidedAt: scene.stamped && performance.now() - replay.landedAt < STAMP_MS ? atMs(scene.point) : null,
          handoffsToday: 0,
          status,
          now: atMs(scene.point),
        })
      : deskProps({ ...world.props.getSnapshot(), status, now })
    // the coder looks at its rubber duck when a test fails (set before the rigs move)
    if (rigs.agent_3) rigs.agent_3.watch = desk.duckLook && rigs.agent_3.arrived === `work_3` ? desks.duckPoint() : null
    for (const id in rigs) {
      rigs[id].pace = scene ? REPLAY_PACE : 1
      rigs[id].setGoal(goals[id], graph)
    }
    walkHold.busy = !!scene && Object.keys(rigs).some((id) => walkPlan.current.walk[id] && rigs[id].arrived !== goals[id].spot)
    for (const id in rigs) rigs[id].update(dt, t, graph, rigs, reduced, status[id])
    // the planner picks up its stamp the moment the owner decides something
    if (desk.stamp && rigs.agent_0?.visible) rigs.agent_0.want = { kind: 'stamp', side: 'r' }
    props.hold(new Map(Object.values(rigs).map((r) => [r, r.want])))
    planes.update(state.clock.elapsedTime, graph, rigs, reduced)
    props.update(Math.min(dt, 0.1))
    desks.update(desk, t, Math.min(dt, 0.1), reduced)
    screens?.update({ t, now, status, reduced, camera: state.camera, forced: world.debug ? world.screens.force : undefined })
    drawBubbles(state, now)
  })

  const drawBubbles = (state: RootState, now: number) => {
    const l = layer.current
    if (!l) return
    // a meeting's bubbles win over a staged talk's; one per agent
    const byId = new Map<string, BubbleItem>()
    const replaying = replay.getSnapshot().mode === 'office'
    if (!replaying) {
      for (const id in rigs) world.bubbles.goal(id, world.goals[id]?.bubble, now, world.goals[id]?.lookAt)
      for (const b of world.bubbles.items(now, reduced)) byId.set(b.id, b)
    }
    const meet = world.meeting.view(now)
    if (meet) {
      for (const b of meet.frame.bubbles) {
        const id = `agent_${b.seat}`
        byId.set(id, {
          id,
          key: b.key,
          seat: b.seat,
          kind: b.kind,
          label: b.kind === 'private' ? '비공개' : '회의',
          text: b.text,
          typed: b.typed,
          log: b.log,
          dim: b.dim,
          order: b.order,
          pairWith: b.pairWith === null ? null : `agent_${b.pairWith}`,
          open: b.row && meet.script.repo && meet.script.n ? { repo: meet.script.repo, n: meet.script.n, row: b.row } : null,
          who: seatName(b.seat),
        })
      }
    }
    const d = meet?.frame.door
    const chars = d ? [...d.text] : []
    setDoorMessage(d ? { text: chars.slice(0, d.typed).join(''), masked: d.masked } : replaying ? replayDoorLine(performance.now()) : null)
    if (d && d.typed >= chars.length) l.note(d.key, d.log)
    const rect = state.gl.domElement.getBoundingClientRect()
    const anchors: Record<string, Anchor> = {}
    const tags: TagItem[] = []
    // the replay shows the past: no live night / duty state (sleepers' z, status tags) reaches the bubble layer
    const status = replaying ? {} : world.source.getSnapshot()
    for (const id in rigs) {
      const rig = rigs[id]
      head.set(rig.group.position.x, rig.parts.head.position.y + 0.3, rig.group.position.z).project(state.camera)
      anchors[id] = { x: rect.left + ((head.x + 1) / 2) * rect.width, y: rect.top + ((1 - head.y) / 2) * rect.height, visible: head.z < 1 && !rig.hidden }
      const tag = replaying ? null : statusTag(status[id])
      if (tag) tags.push({ id, seat: Number(id.split('_')[1]), ...tag })
    }
    l.update([...byId.values()], tags, anchors, { w: window.innerWidth, h: window.innerHeight, narrow: narrow.matches })
    l.updateZ(
      Object.keys(rigs).filter((id) => status[id]?.night === 'sleep' && rigs[id].arrived === world.goals[id]?.spot && world.goals[id]?.pose === 'doze').map((id) => ({ id, seat: Number(id.split('_')[1]) })),
      anchors,
      state.clock.elapsedTime,
      reduced,
    )
  }

  return (
    <>
      {world.debug && <NavDebug world={world} graph={graph} meshes={Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf)} />}
    </>
  )
}

const MAX_ROUTE = 32

/** ?debug=1: the nav graph (red = an edge that hits furniture), spot names, and each agent's remaining route */
function NavDebug({ world, graph, meshes }: { world: OfficeWorld; graph: NavGraph; meshes: Mesh[] }) {
  const check = useMemo(() => checkNav(graph, meshes), [graph, meshes])
  world.check = check

  const edges = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    const ok = new Color('#5c6b80')
    const bad = new Color('#ff3030')
    for (const key in check.edges) {
      const [a, b] = key.split('|').map((id) => graph.spots[id])
      pos.push(a.x, 0.03, a.z, b.x, 0.03, b.z)
      const c = check.edges[edgeKey(a.id, b.id)] ? ok : bad
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new Float32BufferAttribute(col, 3))
    return new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
  }, [check, graph])

  const routes = useMemo(
    () =>
      Object.keys(world.rigs).map((id) => {
        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_ROUTE * 3), 3))
        const line = new Line(geo, new LineBasicMaterial({ color: AGENT_COLORS[id], depthTest: false, transparent: true }))
        line.renderOrder = 2
        return { id, line }
      }),
    [world.rigs],
  )

  useFrame(() => {
    for (const { id, line } of routes) {
      const pts = world.rigs[id].route(graph).slice(0, MAX_ROUTE)
      const attr = line.geometry.getAttribute('position') as Float32BufferAttribute
      pts.forEach((p, i) => attr.setXYZ(i, p.x, 0.06, p.z))
      attr.needsUpdate = true
      line.geometry.setDrawRange(0, pts.length)
      line.geometry.computeBoundingSphere()
    }
  })

  return (
    <>
      <primitive object={edges} renderOrder={1} />
      {routes.map(({ id, line }) => (
        <primitive key={id} object={line} />
      ))}
      {Object.values(graph.spots).map((s) => (
        <Html key={s.id} position={[s.x, 0.05, s.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <span className="nav-label">{s.id}</span>
        </Html>
      ))}
    </>
  )
}
