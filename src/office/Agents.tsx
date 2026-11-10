import { Html } from '@react-three/drei'
import { setDoorMessage } from '../room/doorMessage'
import { BubbleLayer, type Anchor, type TagItem } from './bubbleLayer'
import { statusTag, type BubbleItem } from './bubbles'
import { openDocs } from './docs/panel'
import { seatName } from './meeting'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { buildGraph, pathLength, patchSpots, shortestPath, type NavGraph } from './nav'
import { buildGrid, cellAt, centre } from './grid'
import { sideArea } from './sidePanel/store'
import { requestOf, type Goal } from './director'
import { TrafficPlanner, type Request, type Sample } from './traffic'
import { syncFridgeHold } from './lounge'
import { musicWantsBreak, recordComing } from '../audio/speaker'
import { demoRequest } from './trafficDemo'
import { checkNav, edgeKey } from './navcheck'
import { rasterFootprint } from './floorMask'
import { meshesOf, useOffice } from './nodes'
import { DeskLive } from './deskLive'
import { PaperPlanes } from './plane'
import { ScreenLive } from './screenLive'
import { deskProps } from './props'
import { AgentRig, PropBank, buildRig } from './rig'
import { PlayStage } from './playStage'
import { makeTypingTools } from './debugPlay'
import { replay } from '../replay/store'
import { atMs } from '../replay/engine'
import { boardDistance, REPLAY_PACE } from '../replay/walk'
import { replayDoorLine } from '../replay/scene'
import { DrawnTrack, lineMode, Stage } from '../replay/stage'
import { setLineSub, type LineSub } from '../replay/lineSub'
import { STAMP_MS } from './props'
import { ANXIOUS_AFTER_MS, ownerConnected } from './faceMind'
import { isLateHour } from './duty'
import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'
import { groundAt, readRugs, type Rug } from './ground'
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

/** where a rig stands now, as a planner request (a spot it rests on, else a slot at its feet) */
function standingAt(r: AgentRig, g: NavGraph): Request {
  if (r.arrived && g.spots[r.arrived]) return { spot: r.arrived, pace: 1 }
  return { spot: `stand_${r.id}`, slot: { x: r.x, z: r.z, ry: r.heading }, pace: 1 }
}

/** The agents: each frame the director picks goals from the status source and the clock, the rigs move. */
export function Agents({ world }: { world: OfficeWorld }) {
  const { scene, nodes, spots } = useOffice()
  const graph = useMemo(() => {
    // ?debug=1&nav=… tries spots before they are re-baked into the model
    const tryout = world.debug ? (new URLSearchParams(location.search).get('nav') ?? '') : ''
    const g = buildGraph(patchSpots(spots, tryout))
    // a lying-down seat (nav extras `lie` + `head`, #280): the head's floor point rides on the spot
    for (const id in g.spots) {
      const ud = scene.getObjectByName(`nav_${id}`)?.userData as { lie?: boolean; head?: number[] } | undefined
      if (ud?.lie && ud.head) g.spots[id].head = { x: ud.head[0], z: ud.head[1] }
    }
    return g
  }, [world, spots, scene])
  // the walkable floor and the traffic plan (#138): built once from the model's furniture and the nav spots
  const furniture = useMemo(() => Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf), [nodes])
  const planner = useMemo(() => new TrafficPlanner(buildGrid(rasterFootprint(furniture, 0.05, scene), graph), graph), [furniture, graph, scene])
  const sim = useRef(0)
  // who holds the fridge door's swing in the planner (lounge.ts syncFridgeHold), and whether the speakers were told a record is on its way (speaker.ts recordComing)
  const fridgeHold = useRef({ user: null as string | null, from: 0 })
  const comingSent = useRef(false)
  // a meeting departure (office ms) as planner seconds, fixed once per goal: the planner treats a drifting value as a new request (#141)
  const departs = useRef(new Map<string, number>())
  const rigs = useMemo(
    () =>
      Object.fromEntries(
        world.director.agents.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), AGENT_COLORS[id])]),
      ),
    [world, scene, nodes],
  )
  // the hover light follows the floor's top under each agent: a rug's top over a rug (#316); once per loaded scene
  useMemo(() => {
    const rugs = (scene.userData.rugs ??= readRugs(scene)) as Rug[]
    for (const r of Object.values(rigs)) r.ground = (x, z) => groundAt(rugs, x, z)
  }, [scene, rigs])
  // the props agents pick up while playing (#20, #27); once per loaded scene
  const props = useMemo(() => (scene.userData.props ??= new PropBank(scene, nodes)) as PropBank, [scene, nodes])
  // what the hands do with things: play in 3D, grips (#135, #164); once per loaded scene
  const playStage = useMemo(() => (scene.userData.playStage ??= new PlayStage(scene, nodes, props)) as PlayStage, [scene, nodes, props])
  if (world.debug && !world.typing) world.typing = makeTypingTools(world, playStage.typist)
  const tagEl = useRef<HTMLDivElement | null>(null)
  const tagAt = useRef<[number, number, number]>([0, 0, 0])
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
  // ?debug=1: window.__office.paper.pass(from, to, method?) forces a pass ('hand' | 'slide' | 'toss' | 'plane'; none: paper-pass.md 1's choice)
  world.paper = world.debug
    ? {
        pass: (from: string, to: string, method?: 'hand' | 'slide' | 'toss' | 'plane') => {
          planes.pass(from, to, method)
          const tour = (world as unknown as { tour?: { event: (a: string, ms?: number) => void } }).tour
          tour?.event(from, 3500)
          tour?.event(to, 6000)
        },
        log: () => planes.passes.log.slice(),
        choose: (from: string, to: string) => {
          const c = planes.passes.choose(world.rigs[from], world.rigs[to], world.rigs)
          return { method: c.method, rule: c.rule, d: c.d, lane: c.lane?.offset ?? null }
        },
      }
    : null
  const reduced = useReducedMotion()
  const layer = useRef<BubbleLayer | null>(null)
  // the timelapse (#158): its own planner, clocked by the replay clock, while the replay is open in the office
  const stage = useRef<Stage | null>(null)
  const replayNow = useRef<number | null>(null)
  const rigTau = useRef(0)
  const drawn = useMemo(() => new DrawnTrack(), [])
  const drawnSeen = useRef(0)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
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
  // the scene clock of the last frame: the faces' events (messages, decisions) start on it
  const sceneT = useRef(0)
  const lateAt = useRef(-1)
  for (const id in rigs) {
    const seat = Number(id.split('_')[1])
    const path = graph.spots.whiteboard ? shortestPath(graph, `work_${seat}`, 'whiteboard') : null
    if (path) boardDistance[seat] = pathLength(graph, path)
  }
  world.graph = graph
  world.traffic = planner

  useEffect(
    () =>
      world.source.onMessage((m) => {
        world.director.receive(m)
        planes.receive(m)
        // a talk asked of someone who is busy at work: the one who asked stands there puzzled (robots.md 4, 의문)
        if (m.kind === 'talk' && world.source.getSnapshot()[m.to]?.state === 'working') rigs[m.from]?.faceEvent('question', sceneT.current)
      }),
    [world, planes, rigs],
  )
  // a decision pinned on the board: the meeting's agents are glad (기쁨)
  useEffect(
    () =>
      world.meeting.onDecisionPinned(({ script }) => {
        for (const seat of script.seats) rigs[`agent_${seat}`]?.faceEvent('joy', sceneT.current)
      }),
    [world, rigs],
  )
  // the owner connects (the approvals role becomes 'owner'): every robot is glad to see them (반가움, 2 s)
  useEffect(() => {
    const src = world.approvals
    if (!src) return
    let prev: string | null = src.role()
    return src.subscribe(() => {
      const next = src.role()
      if (ownerConnected(prev, next)) for (const id in rigs) rigs[id].faceEvent('greeting', sceneT.current)
      prev = next
    })
  }, [world, rigs])
  // the owner decided an approval: its requester is proud (뿌듯); the seats that stopped waiting
  const waitingBefore = useRef<number[]>([])

  useFrame((state, dt) => {
    sim.current += Math.min(dt, 0.1)
    world.simTime = sim.current
    const now = officeNow(world)
    const t = state.clock.elapsedTime
    sceneT.current = t
    // the timelapse (#82, #158): the record's statuses and desk goals stand in for the live ones (and the director's play).
    // Everything of it runs on the replay clock (stage.ts): the speed only sets how fast that clock advances.
    const wantReplay = replay.getSnapshot().mode === 'office' && replay.scene() !== null
    if (wantReplay && !stage.current) {
      const door = graph.spots.door
      const replayPlanner = new TrafficPlanner(planner.grid, graph)
      const st = new Stage({ store: replay, planner: replayPlanner, meeting: world.meeting, ids: Object.keys(rigs), door: door ? { x: door.x, z: door.z } : undefined, reduced: () => reducedRef.current, spot: (id) => graph.spots[id] ?? null })
      const from: Record<string, Request> = {}
      for (const id in rigs) if (rigs[id].visible) from[id] = standingAt(rigs[id], graph)
      st.begin(from)
      stage.current = st
      rigTau.current = st.now
      drawn.reset()
      drawnSeen.current = replay.landings
    } else if (!wantReplay && stage.current) {
      // back to live: everyone stands where the replay left them and walks to their live goal from there
      stage.current.dispose()
      stage.current = null
      for (const id in rigs) if (rigs[id].visible) planner.place(id, standingAt(rigs[id], graph), sim.current, Number(id.split('_')[1]))
    }
    const st = stage.current
    // the rig steps of this frame in replay: [tau, dt, goals, tracks] sampled while the planner held that moment's plan
    const steps: { anim: number; dt: number; goals: Record<string, Goal>; tracks: Record<string, Sample | null> }[] = []
    const track = (s: Stage, goals: Record<string, Goal>, tau: number) =>
      Object.fromEntries(Object.keys(rigs).map((id) => [id, goals[id].pose !== 'leave' && s.planner.has(id) ? s.planner.sample(id, tau) : null]))
    let goals: Record<string, Goal>
    if (st) {
      // ticks of at most 50 ms of replay time (the speed only sets how many a frame spends); the rigs follow in steps of
      // about 100 ms (their own dt clamp) at the tick's tau, then a last step up to the shown time
      const rdt = Math.min(dt, 0.1)
      let acc = 0
      st.frame(rdt * 1000, Infinity, (clock, len) => {
        acc += len
        if (acc < 60) return
        steps.push({ anim: clock / 1000, dt: acc / 1000, goals: st.goals, tracks: track(st, st.goals, clock / 1000) })
        rigTau.current = clock
        acc = 0
      })
      const vis = st.now - rigTau.current
      const flowing = replay.getSnapshot().playing && vis > 0
      steps.push({ anim: flowing ? st.now / 1000 : t, dt: flowing ? vis / 1000 : rdt, goals: st.goals, tracks: track(st, st.goals, st.now / 1000) })
      rigTau.current = st.now
      replayNow.current = st.now
      goals = st.goals
    } else {
      replayNow.current = null
      goals = world.director.goals(now, Math.floor(now / 60000), world.source.getSnapshot(), (a) => rigs[a].arrived, { reduced, wantsBreak: musicWantsBreak() })
      // the break music waits for the record that is on its way (sound.md 4.4)
      const coming = world.director.recordComing()
      if (coming !== comingSent.current) {
        comingSent.current = coming
        recordComing(coming)
      }
      // a replayed meeting calls its agents in (plan 6.4); the director's goals are the fallback for everyone else
      world.replay?.tick()
      const door = graph.spots.door
      // an agent carrying the watering can finishes bringing it back before a meeting takes it (#228: nothing flies home)
      const carrying = Object.fromEntries(world.director.agents.filter((a) => world.director.carries(a)).map((a) => [a, goals[a]]))
      world.meeting.apply(now, (a) => rigs[a].arrived, goals, door ? { x: door.x, z: door.z } : undefined, { at: (a) => rigs[a] ?? null, spot: (s) => graph.spots[s] ?? null })
      Object.assign(goals, carrying)
      // the list, the tags and the monitors say the meeting's words for the whole meeting (#354); a carrier keeps its errand's words
      world.director.setMeeting(Object.fromEntries(Object.entries(world.meeting.words).filter(([a]) => !carrying[a])))
    }
    const scene = st ? replay.scene() : null
    const status = scene ? scene.status : world.source.getSnapshot()
    // ?debug=1: window.__office.forceSpots = { agent_0: 'whiteboard', ... } sends agents to spots (head-on tests, screenshots)
    if (world.debug && world.forceSpots) for (const id in world.forceSpots) if (goals[id]) goals[id] = { ...goals[id], spot: world.forceSpots[id], pose: 'idle', label: 'debug' }
    if (world.debug && world.forceGoal) for (const id in world.forceGoal) if (goals[id]) goals[id] = { ...goals[id], ...world.forceGoal[id], label: 'debug' }
    if (!st) {
      // forget the departures no goal holds any more (a held one keeps its planner time: recomputed each frame it would drift and replan every frame,
      // #228). After the debug overrides: a forced spot keys the departure it is requested with; judged on the director's own spot, the forced one's
      // was dropped and recomputed every frame, and the agent stood unlabelled at the play spot, facing the way it walked in (#333)
      const held = new Set(Object.entries(goals).filter(([, g]) => g.depart !== undefined).map(([id, g]) => `${id}|${g.spot}|${g.depart}`))
      for (const k of [...departs.current.keys()]) if (!held.has(k) && !world.meeting.busy) departs.current.delete(k)
    }
    // ?debug=1: window.__office.trafficDemo('narrow' | 'wide') stands agent_0 and agent_1 at the two ends, then swaps them
    const demo = world.debug ? world.demo : null
    const fresh = !!demo && demo.at === null
    if (demo && fresh) demo.at = sim.current
    const demoReq: Record<string, Request> = {}
    if (demo)
      for (const id in goals) {
        const r = demoRequest(demo, id, sim.current)
        if (!r?.req.slot) continue
        const { x, z, ry } = r.req.slot
        demoReq[id] = r.req
        goals[id] = { ...goals[id], spot: r.req.spot, pose: 'idle', label: 'demo', face: { x: x - Math.sin(ry), z: z - Math.cos(ry) } }
        if (fresh) planner.place(id, r.req, sim.current, Number(id.split('_')[1]))
      }
    world.goals = goals
    // the late hour (KST, the debug clock counts): worked out twice a second, not per frame
    const lateKey = Math.floor(now / 500)
    if (lateKey !== lateAt.current) {
      lateAt.current = lateKey
      for (const id in rigs) rigs[id].lateHour = isLateHour(now, Number(id.split('_')[1]))
    }
    // approvals (#64): a request waiting over 30 minutes worries its agent; one that is gone makes the requester proud
    if (!st) {
      const extra = world.props.getSnapshot()
      for (const id in rigs) {
        const since = extra.waitingSince?.[Number(id.split('_')[1])]
        rigs[id].anxious = since !== undefined && now - since > ANXIOUS_AFTER_MS
      }
      for (const seat of waitingBefore.current) if (!extra.waitingSeats.includes(seat)) rigs[`agent_${seat}`]?.faceEvent('proud', t)
      waitingBefore.current = extra.waitingSeats
    } else for (const id in rigs) rigs[id].anxious = false
    const desk = scene
      ? deskProps({
          ...world.props.getSnapshot(),
          pending: scene.pending,
          waitingSeats: scene.waitingSeats,
          decidedAt: scene.stamped && (st?.now ?? 0) - replay.landedClock < STAMP_MS ? atMs(scene.point) : null,
          handoffsToday: 0,
          status,
          now: atMs(scene.point),
        })
      : deskProps({ ...world.props.getSnapshot(), status, now })
    // the coder looks at its rubber duck when a test fails (set before the rigs move)
    if (rigs.agent_3) rigs.agent_3.watch = desk.duckLook && rigs.agent_3.arrived === `work_3` ? desks.duckPoint() : null
    if (st) {
      // a seek is a jump: the drawn bodies snap with it
      if (drawnSeen.current !== replay.landings) {
        drawnSeen.current = replay.landings
        if (replay.landedVia === 'seek') drawn.reset()
      }
      const speed = replay.getSnapshot().speed
      const tauTotal = steps.reduce((a, s) => a + s.dt, 0)
      const realDt = Math.min(dt, 0.1)
      for (const step of steps)
        for (const id in rigs) {
          const r = rigs[id]
          r.gestureMin = speed > 1 ? 0.15 * speed : 0
          r.ambient = speed >= 16 ? 0 : 1
          const tk = step.tracks[id]
          // the screen speed cap: the body is drawn following its plan position at no more than SCREEN_MPS of real time
          r.drawAt = tk ? drawn.follow(id, tk.x, tk.z, replay.getSnapshot().playing && tauTotal > 0 ? (realDt * step.dt) / tauTotal : realDt) : null
          r.pace = REPLAY_PACE
          r.traffic = step.goals[id].pose !== 'leave'
          r.setGoal(step.goals[id], graph)
          r.track = step.tracks[id]
          r.update(step.dt, step.anim, graph, rigs, reduced, status[id])
        }
    } else {
      // the fridge door's swing is held for the one at the fridge: the others' plans keep clear of it (traffic.ts reserve)
      syncFridgeHold(planner, fridgeHold.current, world.director.fridgeUser(), sim.current)
      for (const id in rigs) {
        rigs[id].pace = 1
        rigs[id].gestureMin = 0
        rigs[id].ambient = 1
        rigs[id].drawAt = null
        rigs[id].traffic = goals[id].pose !== 'leave'
        if (rigs[id].traffic) {
          const g = goals[id]
          let notBefore: number | undefined
          if (g.depart !== undefined) {
            const key = `${id}|${g.spot}|${g.depart}`
            notBefore = departs.current.get(key) ?? sim.current + Math.max(0, (g.depart - now) / 1000)
            departs.current.set(key, notBefore)
          }
          planner.request(id, demoReq[id] ?? requestOf(g, rigs[id].pace, notBefore), sim.current, Number(id.split('_')[1]))
        }
        rigs[id].setGoal(goals[id], graph)
      }
      planner.update(sim.current)
      for (const id in rigs) rigs[id].track = rigs[id].traffic && planner.has(id) ? planner.sample(id, sim.current) : null
      for (const id in rigs) rigs[id].update(dt, t, graph, rigs, reduced, status[id])
    }
    // the hands: play from the office clock (nothing of it in the timelapse), grips on everything that is held or touched
    playStage.update({
      now,
      t: st ? st.now / 1000 : t,
      dt: Math.min(dt, 0.1),
      reduced,
      replaying: !!st,
      rigs,
      goals,
      status,
      tablet: desk.tablet,
      stamp: desk.stamp,
      colors: AGENT_COLORS,
      forcedSessions: world.debug ? world.forcedSessions : undefined,
      gripDemo: world.debug ? world.gripDemo : null,
    })
    const tag = playStage.tag
    if (tagEl.current) {
      tagEl.current.style.opacity = tag ? '1' : '0'
      if (tag) {
        tagEl.current.textContent = tag.text
        tagAt.current = [tag.at.x, tag.at.y, tag.at.z]
      }
    }
    // a paper handed / slid / tossed (#262) sets who holds it (rig.want) after the stage reset it, before the bank reads it
    planes.update(state.clock.elapsedTime, graph, rigs, reduced)
    props.hold(new Map(Object.values(rigs).map((r) => [r, r.want])))
    props.update(Math.min(dt, 0.1))
    desks.update(desk, t, Math.min(dt, 0.1), reduced)
    // the monitors show what the director says each agent is doing now (#186); the timelapse shows its record's statuses
    const shownStatus = st ? status : world.director.shownStatus
    screens?.update({ t, now, status: shownStatus, reduced, camera: state.camera, forced: world.debug ? world.screens.force : undefined })
    drawBubbles(state, now)
  })

  const drawBubbles = (state: RootState, now: number) => {
    const l = layer.current
    if (!l) return
    // a meeting's bubbles win over a staged talk's; one per agent
    const byId = new Map<string, BubbleItem>()
    const replaying = replayNow.current !== null
    if (!replaying) {
      for (const id in rigs) world.bubbles.goal(id, world.goals[id]?.bubble, now, world.goals[id]?.lookAt)
      for (const b of world.bubbles.items(now, reduced)) byId.set(b.id, b)
    }
    const meet = world.meeting.view(replayNow.current ?? now)
    // the timelapse (timelapse.md): at x4 a line is in full at once, and a line that would not stay 0.6 s real, or any line
    // at x16, is the subtitle instead of a bubble
    let mode: 'bubble' | 'full' | 'subtitle' = 'bubble'
    let sub: LineSub | null = null
    if (replaying && meet) {
      const k = meet.frame.index
      const lines = meet.script.lines
      const line = lines[k]
      if (line) {
        mode = lineMode(replay.getSnapshot().speed, (lines[k + 1]?.startMs ?? meet.script.linesMs) - line.startMs)
        if (mode === 'subtitle' && typeof line.from === 'number') sub = { seat: line.from, who: seatName(line.from), text: line.private ? '(비공개)' : line.text }
      }
    }
    setLineSub(sub)
    if (meet && mode !== 'subtitle') {
      for (const b of meet.frame.bubbles) {
        const id = `agent_${b.seat}`
        byId.set(id, {
          id,
          key: b.key,
          seat: b.seat,
          kind: b.kind,
          label: b.kind === 'private' ? '비공개' : '회의',
          text: b.text,
          typed: mode === 'full' ? [...b.text].length : b.typed,
          log: b.log,
          dim: b.dim,
          down: !!meet.script.decision,
          order: b.order,
          pairWith: b.pairWith === null ? null : `agent_${b.pairWith}`,
          open: b.row && meet.script.repo && meet.script.n ? { repo: meet.script.repo, n: meet.script.n, row: b.row } : null,
          who: seatName(b.seat),
        })
      }
    }
    // the faces: who is typing a line (the mouth moves), who listens to one (the nod while the speaker is typing)
    for (const id in rigs) {
      const b = byId.get(id)
      rigs[id].faceTalk.speaking = !!b && b.kind === 'talk' && b.typed < [...b.text].length
    }
    for (const id in rigs) {
      const g = world.goals[id]
      const who = g && (g.pose === 'talk' || g.pose === 'listen') ? (g.gaze ?? g.lookAt) : undefined
      rigs[id].faceTalk.listening = !!who && !rigs[id].faceTalk.speaking && !!rigs[who]?.faceTalk.speaking
    }
    const d = meet?.frame.door
    const chars = d ? [...d.text] : []
    setDoorMessage(d ? { text: chars.slice(0, d.typed).join(''), masked: d.masked } : replaying ? replayDoorLine(replayNow.current!) : null)
    if (d && d.typed >= chars.length) l.note(d.key, d.log)
    const rect = state.gl.domElement.getBoundingClientRect()
    // the side panel covers part of the canvas (#170): bubbles, tags and z's work inside the area that is still 3D
    const area = sideArea()
    const anchors: Record<string, Anchor> = {}
    const tags: TagItem[] = []
    // the replay shows the past: no live night / duty state (sleepers' z, status tags) reaches the bubble layer
    const status = replaying ? {} : world.source.getSnapshot()
    for (const id in rigs) {
      const rig = rigs[id]
      head.set(rig.group.position.x, rig.parts.head.position.y + 0.3, rig.group.position.z).project(state.camera)
      anchors[id] = { x: rect.left + ((head.x + 1) / 2) * rect.width, y: rect.top + ((1 - head.y) / 2) * rect.height, visible: head.z < 1 && !rig.hidden }
      if (anchors[id].x > area.w || anchors[id].y > area.h) anchors[id].visible = false
      const tag = replaying ? null : statusTag(world.director.shown[id]?.status ?? status[id], world.director.shown[id]?.detail)
      if (tag) tags.push({ id, seat: Number(id.split('_')[1]), ...tag })
    }
    l.update([...byId.values()], tags, anchors, { w: area.w, h: area.h, narrow: narrow.matches })
    l.updateZ(
      Object.keys(rigs).filter((id) => status[id]?.night === 'sleep' && rigs[id].arrived === world.goals[id]?.spot && world.goals[id]?.pose === 'doze').map((id) => ({ id, seat: Number(id.split('_')[1]) })),
      anchors,
      state.clock.elapsedTime,
      reduced,
    )
  }

  return (
    <>
      {world.debug && <NavDebug world={world} graph={graph} meshes={furniture} planner={planner} />}
      <TagLabel el={tagEl} at={tagAt} />
    </>
  )
}

const MAX_ROUTE = 32

/** ?debug=1: the nav graph (red = an edge that hits furniture), spot names, and each agent's remaining route */
function NavDebug({ world, graph, meshes, planner }: { world: OfficeWorld; graph: NavGraph; meshes: Mesh[]; planner: TrafficPlanner }) {
  const { scene } = useOffice()
  const check = useMemo(() => checkNav(graph, meshes), [graph, meshes])
  world.check = check
  ;(world as unknown as { footprint: () => unknown }).footprint = () => {
    const f = rasterFootprint(meshes, 0.05, scene)
    let bin = ''
    for (let k = 0; k < f.bits.length; k += 8) {
      let v = 0
      for (let q = 0; q < 8; q++) v |= (f.bits[k + q] ?? 0) << q
      bin += String.fromCharCode(v)
    }
    return { cell: f.cell, minX: f.minX, minZ: f.minZ, w: f.w, h: f.h, b64: btoa(bin) }
  }

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

  // the walkable grid (#138, designer): blocked cells a grey hatch at 25 %, so the floor and the routes stay readable;
  // each agent's current cell a white outline. Shown with the debug panel's checkbox (and by trafficDemo).
  const gridView = useMemo(() => {
    const g = planner.grid
    const px = 8
    const canvas = document.createElement('canvas')
    canvas.width = g.w * px
    canvas.height = g.h * px
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.beginPath()
      for (let c = 0; c < g.blocked.length; c++) if (g.blocked[c]) ctx.rect((c % g.w) * px, Math.floor(c / g.w) * px, px, px)
      ctx.clip()
      ctx.strokeStyle = '#9a9a9a'
      ctx.lineWidth = 1.5
      for (let k = -canvas.height; k < canvas.width; k += 6) {
        ctx.moveTo(k, 0)
        ctx.lineTo(k + canvas.height, canvas.height)
      }
      ctx.stroke()
    }
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    const W = g.w * g.cell
    const H = g.h * g.cell
    const hatch = new Mesh(new PlaneGeometry(W, H).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, toneMapped: false }))
    hatch.position.set(g.minX + W / 2, 0.02, g.minZ + H / 2)
    hatch.renderOrder = 1
    const group = new Group()
    group.add(hatch)
    const h = g.cell / 2
    const here = Object.fromEntries(
      Object.keys(world.rigs).map((id) => {
        const geo = new BufferGeometry().setFromPoints([new Vector3(-h, 0, -h), new Vector3(h, 0, -h), new Vector3(h, 0, h), new Vector3(-h, 0, h)])
        const loop = new LineLoop(geo, new LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }))
        loop.renderOrder = 3
        group.add(loop)
        return [id, loop]
      }),
    )
    return { group, here }
  }, [planner, world.rigs])

  useFrame(() => {
    gridView.group.visible = world.showGrid
    // the old spot graph is no longer the road: hide its edges while the grid is shown
    edges.visible = !world.showGrid
    if (world.showGrid)
      for (const id in gridView.here) {
        const r = world.rigs[id]
        const c = cellAt(planner.grid, r.x, r.z)
        const loop = gridView.here[id]
        loop.visible = c >= 0 && r.visible
        if (c >= 0) {
          const p = centre(planner.grid, c)
          loop.position.set(p.x, 0.04, p.z)
        }
      }
    for (const { id, line } of routes) {
      const pts = planner.has(id) ? planner.routePoints(id, world.simTime).slice(0, MAX_ROUTE) : world.rigs[id].route(graph).slice(0, MAX_ROUTE)
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
      <primitive object={gridView.group} />
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

/** the score over the net for 2 s after a point (play.md 1: the agents' rally; no scoreboard in the room) */
function TagLabel({ el, at }: { el: { current: HTMLDivElement | null }; at: { current: [number, number, number] } }) {
  const group = useRef<Group>(null)
  useFrame(() => group.current?.position.set(...at.current))
  return (
    <group ref={group}>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={el} className="play-tag" aria-hidden="true" style={{ opacity: 0, transition: 'opacity 0.2s', fontFamily: 'var(--font-pixel, monospace)', fontSize: 13, color: '#f3ead8', background: 'rgba(14,16,22,0.8)', padding: '2px 8px', border: '1px solid #f3ead8' }} />
      </Html>
    </group>
  )
}
