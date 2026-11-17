import { Html } from '@react-three/drei'
import { setDoorMessage } from '../room/doorMessage'
import { BubbleLayer, type Anchor, type TagItem } from './bubbleLayer'
import { BUBBLE, replayTag, statusTag, zRises, type BubbleItem } from './bubbles'
import { openDocs } from './docs/panel'
import { seatName } from './meeting'
import { captionOf } from './minutes'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { buildGraph, pathLength, patchSpots, shortestPath, type NavGraph } from './nav'
import { buildGrid, cellAt, centre } from './grid'
import { sideArea } from './sidePanel/store'
import { requestOf, standSlot, type Goal } from './director'
import { TrafficPlanner, type Request, type Sample } from './traffic'
import { syncFridgeHold } from './lounge'
import { musicWantsBreak, recordComing, resetDeck, speakerOn } from '../audio/speaker'
import { demoRequest } from './trafficDemo'
import { checkNav, edgeKey } from './navcheck'
import { rasterFootprint } from './floorMask'
import { meshesOf, useOffice } from './nodes'
import { DeskLive } from './deskLive'
import { DeskTouches } from './deskTouch'
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
import { landingFaces } from '../replay/faces'
import { setLineSub, type LineSub } from '../replay/lineSub'
import { setMinutesProgress } from '../replay/minutesInfo'
import { STAMP_MS } from './props'
import { ANXIOUS_AFTER_MS } from './faceMind'
import { greetsOwner, questionFaceFor } from './liveFace'
import { isLateHour } from './duty'
import { getOmokVisit, omokHoldsAgent, workSignalOmok } from './omokVisit/store'
import { faceScreenRect } from './omokVisit/bubbleAnchor'
import { getPingpongVisit, pingpongHoldsAgent, workSignalPingpong } from './pingpongVisit/store'
import { rallyOf } from '../play/visitorPingpong'
import { WATCH } from './play'
import { viewOf } from '../play/visitorOmok'

import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'
import { NOTE_READ, pinnedAt, thanksNow } from './noteRead'
import { notesStore } from './visit/notes'
import { groundAt, readRugs, type Rug } from './ground'
import type { RootState } from '@react-three/fiber'

/** #137 ② the visitor's game as the stage draws it, while the visitor is at the board (not in the replay) */
function omokView(now: number | null) {
  const v = getOmokVisit()
  if (now === null || v.phase === 'closed' || !v.agent || !v.game) return null
  return { agent: v.agent, view: viewOf(v.game, now) }
}

/** #137 ③ where the near end's player watches the visitor's match: beside the table at the net, on the window side (out of the view down the table) */
const PP_WATCH_STAND = { x: WATCH.pingpong.face.x, z: WATCH.pingpong.face.z - 1.15 }

/** #137 ③ the visitor's match as the stage draws it, while they hold the paddle (not in the replay) */
function pingpongView(on: boolean) {
  const v = getPingpongVisit()
  if (!on || v.phase === 'closed' || !v.agent || !v.match) return null
  return { agent: v.agent, rally: rallyOf(v.match, v.paddle), tMs: v.match.t }
}

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
  // #4 notes 2b: each robot's time at the cork board last frame (the thanks are said once, as it crosses NOTE_READ.lookS)
  const noteAt = useRef<Record<string, number>>({})
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
  // #370 A a hand on a thing of its own desk: when, and what the desk shows of it
  const touches = useMemo(() => new DeskTouches(), [])
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
  /** the landing whose face cues were fired (a replay's own events), and until when (real s) each body put down at once is blurred */
  const faceSeen = useRef(-1)
  const blurUntil = useRef<Record<string, number>>({})
  const lateAt = useRef(-1)
  for (const id in rigs) {
    const seat = Number(id.split('_')[1])
    const path = graph.spots.whiteboard ? shortestPath(graph, `work_${seat}`, 'whiteboard') : null
    if (path) boardDistance[seat] = pathLength(graph, path)
  }
  world.graph = graph
  world.traffic = planner

  // #4 notes 2b: the board's notes (the latest twelve, kept up to date by the note signal) go to the Director, which sends each robot to read
  // its own within the hour
  useEffect(() => {
    const feed = () => {
      // the pin time on the office clock (noteRead.ts pinnedAt): a note's age is its real age at any debug hour
      const now = officeNow(world)
      for (const n of notesStore.getSnapshot().notes) world.director.noteArrived(n.agent, n.id, pinnedAt(n.created_at, world.timeOffsetMs), now)
    }
    feed()
    return notesStore.subscribe(feed)
  }, [world])

  useEffect(
    () =>
      world.source.onMessage((m) => {
        world.director.receive(m)
        // the timelapse's papers are its own (the minutes rows); a live handoff does not fly among the replayed bodies
        if (!stage.current) planes.receive(m)
        // a talk asked of someone who is busy at work: the one who asked stands there puzzled (robots.md 4, 의문)
        // (nothing live touches the replayed bodies: no live question face while the timelapse plays, #428)
        const asker = questionFaceFor(!!stage.current, m, world.source.getSnapshot())
        if (asker) rigs[asker]?.faceEvent('question', sceneT.current)
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
      if (greetsOwner(!!stage.current, prev, next)) for (const id in rigs) rigs[id].faceEvent('greeting', sceneT.current)
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
      const st = new Stage({ store: replay, planner: replayPlanner, meeting: world.meeting, ids: Object.keys(rigs), door: door ? { x: door.x, z: door.z } : undefined, reduced: () => reducedRef.current, spot: (id) => graph.spots[id] ?? null, pass: (from, to) => planes.pass(from, to) })
      // the papers run on the replay clock from here on: a live one in the air is dropped
      planes.reset()
      st.begin()
      stage.current = st
      rigTau.current = st.now
      drawn.reset()
      drawnSeen.current = replay.landings
    } else if (!wantReplay && stage.current) {
      // back to live: everyone stands where the replay left them and walks to their live goal from there
      stage.current.dispose()
      stage.current = null
      planes.reset()
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
      // #4 notes 2b: after 2 s at the board, the nod (the goal's gesture) and the thanks, in the visitor's tab as a snack's
      for (const a in goals) {
        const u = goals[a].note?.u ?? -1
        if (thanksNow(noteAt.current[a] ?? -1, u)) world.bubbles.say(a, { kind: 'react', text: NOTE_READ.line, ms: NOTE_READ.sayMs, tag: '방문자' }, now)
        noteAt.current[a] = u
      }
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
    // #601 (designer, #615) held at the visitor's game while called to work: this tab's tag and list show the real activity (파일 편집 중, no
    // "자리로 가는 중": it is not on its way); the other tabs keep the director's words, the body there does go to its desk. Read by the director's
    // next frame
    const held = new Set<string>()
    const heldShown = (a: string) => void held.add(a)
    // #137 ② a visitor plays omok with the agent at the board (this tab only): it stays in its chair for the game. #601 (play.md 10) called to work,
    // it plays the game out (up to the cap) and then goes straight to its desk; the list and its tag show the real status all along
    const visit = st ? null : getOmokVisit()
    if (visit && visit.phase !== 'closed' && visit.agent && goals[visit.agent]) {
      const s = status[visit.agent]
      workSignalOmok(!!s && (s.state !== 'idle' || s.night === 'duty'), now)
      if (omokHoldsAgent(now)) {
        goals[visit.agent] = { spot: 'game_a', pose: 'boardgame', label: '오목 · 방문자와 대국' }
        heldShown(visit.agent)
      }
    }
    // #137 ③ the visitor holds the near paddle: the agent plays from the far end; the one who played at the near end watches by the table (play.md 3.1).
    // #601 called to work, it plays the match out (up to the cap) and then goes to its desk
    const ppVisit = st ? null : getPingpongVisit()
    if (ppVisit && ppVisit.phase !== 'closed' && ppVisit.agent && goals[ppVisit.agent]) {
      const s = status[ppVisit.agent]
      if (ppVisit.phase !== 'leaving') workSignalPingpong(!!s && (s.state !== 'idle' || s.night === 'duty'), now)
      if (pingpongHoldsAgent(now)) {
        // already at the far end: its goal as it is (its departure), only the words, and at the spot itself (no other play's standing place); else sent there
        const g0 = goals[ppVisit.agent]
        goals[ppVisit.agent] = g0.spot === 'pingpong_b' && g0.pose === 'pingpong' ? { ...g0, slot: undefined, label: '탁구 · 방문자와 경기' } : { spot: 'pingpong_b', pose: 'pingpong', label: '탁구 · 방문자와 경기' }
        heldShown(ppVisit.agent)
        // anyone else the director sends to the table (the near end's player, one coming to join) watches from beside it, by the net: out of the
        // visitor's view down the table (play.md 3.1)
        for (const w of Object.keys(goals))
          if (w !== ppVisit.agent && goals[w].pose === 'pingpong' && (goals[w].spot === 'pingpong_a' || goals[w].spot === 'pingpong_b'))
            goals[w] = { spot: WATCH.pingpong.spot, pose: 'idle', ...standSlot({ stand: PP_WATCH_STAND, face: WATCH.pingpong.face }), watching: 'pingpong', label: WATCH.pingpong.label }
      }
    }
    if (held.size || world.director.heldByVisitor.size) world.director.heldByVisitor = held
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
      // the replay's faces come from its own statuses (night: asleep / sleepy), not from the live clock
      for (const id in rigs) rigs[id].lateHour = !st && isLateHour(now, Number(id.split('_')[1]))
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
    } else for (const id in rigs) rigs[id].anxious = !!scene?.waitingSeats.includes(Number(id.split('_')[1]))
    // the timelapse's faces (#428, timelapse.md 12.4): the rig reads only the replay's own state, and the point that just landed fires its events
    for (const id in rigs) rigs[id].replayFace = !!st
    if (st && scene && faceSeen.current !== replay.landings) {
      faceSeen.current = replay.landings
      for (const c of landingFaces(scene.point)) rigs[`agent_${c.seat}`]?.faceEvent(c.expr, t, c.dur)
    }
    if (st) {
      // a schedule change put down at once (x16, reduced motion, too far to walk): that body alone blurs for 0.15 s
      for (const id of st.takePlaced()) blurUntil.current[id] = t + 0.15
      for (const id in rigs) rigs[id].blur = (blurUntil.current[id] ?? 0) > t
    } else for (const id in rigs) if (blurUntil.current[id]) (blurUntil.current[id] = 0), (rigs[id].blur = false)
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
        if (replay.landedVia === 'seek') {
          drawn.reset()
          resetDeck() // a seek forgets the turntable (speaker.ts)
          touches.reset() // and nothing on a desk is touched for what was jumped over
        }
      }
      const speed = replay.getSnapshot().rate
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
    // #370 A the desk touches, on the hands' clock: who sits at its own desk now
    const touchT = st ? st.now / 1000 : t
    if (world.debug && world.forceTouch) {
      touches.begin(world.forceTouch, touchT)
      world.forceTouch = null
    }
    touches.step({
      t: touchT,
      now: scene ? atMs(scene.point) : now,
      desk,
      seated: (seat) => {
        const r = rigs[`agent_${seat}`]
        return !!r?.visible && r.arrived === `work_${seat}`
      },
      awake: (seat) => !!status[`agent_${seat}`] && status[`agent_${seat}`].state !== 'off',
      working: (seat) => status[`agent_${seat}`]?.state === 'working',
      // #370 C4 the speaker playing (에코's mixer), the tidy-up starting (its snap)
      speaker: !st && speakerOn(),
      tidying: (seat) => (st ? undefined : goals[`agent_${seat}`])?.pose === 'tidy',
    })
    // the desk things first: a hand on one follows it where it is this frame (#370 A)
    desks.update(touches.desk(desk), t, Math.min(dt, 0.1), reduced, touches.shown(touchT, reduced))
    // the hands: play from the office clock (nothing of it in the timelapse), grips on everything that is held or touched
    playStage.update({
      touches: touches.all(touchT),
      // #370 B3b the planner's IN pile (its tidy-up squares it when there is one)
      inbox: desk.inbox,
      // the replay's games run on the replay's own time (the schedule at that KST time, 12.1), never the live clock
      now: st ? st.time : now,
      t: st ? st.now / 1000 : t,
      dt: Math.min(dt, 0.1),
      reduced,
      replaying: !!st,
      speed: st ? replay.getSnapshot().rate : 1,
      rigs,
      goals,
      status,
      tablet: desk.tablet,
      stamp: desk.stamp,
      colors: AGENT_COLORS,
      forcedSessions: world.debug ? world.forcedSessions : undefined,
      visitorOmok: omokView(st ? null : now),
      visitorPingpong: pingpongView(!st),
      // #455 the treats in a hand (not in the replay: a treat is a live visitor's)
      treats: st ? undefined : world.treats,
      gripDemo: world.debug ? world.gripDemo : null,
      // #604 the hologram chess pieces face the camera
      camera: state.camera.position,
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
    planes.update(st ? st.now / 1000 : state.clock.elapsedTime, graph, rigs, reduced)
    props.hold(new Map(Object.values(rigs).map((r) => [r, r.want])))
    props.update(Math.min(dt, 0.1))
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
      for (const id in rigs) world.bubbles.goal(id, world.goals[id]?.bubble ?? touches.bubble(id), now, world.goals[id]?.lookAt)
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
        mode = lineMode(reduced ? 1 : replay.getSnapshot().rate, (lines[k + 1]?.startMs ?? meet.script.linesMs) - line.startMs)
        // the caption reads `메시 → 휴 — 내용`: instead of a bubble, and while the receiver of a 1:1 pass reads (timelapse.md 11.2)
        if (mode === 'subtitle' || (line.pass && meet.t - line.startMs >= (line.readAt ?? 0))) sub = captionOf(line)
      }
    }
    setLineSub(sub)
    // the day view: `회의 4/9줄` while the rows of a minutes point play
    let row = 0
    if (replaying && meet?.script.minutes) for (let j = meet.frame.index; j >= 0 && !row; j--) row = meet.script.lines[j]?.row ?? 0
    setMinutesProgress(row ? { row, total: meet!.script.minutes!.rows.length } : null)
    if (meet && mode !== 'subtitle') {
      for (const b of meet.frame.bubbles) {
        const id = `agent_${b.seat}`
        byId.set(id, {
          id,
          key: b.key,
          seat: b.seat,
          kind: b.kind,
          label: b.kind === 'private' ? '비공개' : (b.tag ?? '회의'),
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
    // the replay shows the past: no live night / duty state reaches the bubble layer; its own (sleepers' z, the night chips, #599) does
    const status = replaying ? (replay.scene()?.status ?? {}) : world.source.getSnapshot()
    /** lying on the sofa (its goal's pose, arrived): asleep (faceMind baseExpression) */
    const napping = (id: string) => world.goals[id]?.pose === 'sofa' && rigs[id].arrived === world.goals[id]?.spot
    const omok = getOmokVisit()
    for (const id in rigs) {
      const rig = rigs[id]
      head.set(rig.group.position.x, rig.parts.head.position.y + 0.3, rig.group.position.z).project(state.camera)
      anchors[id] = { x: rect.left + ((head.x + 1) / 2) * rect.width, y: rect.top + ((1 - head.y) / 2) * rect.height, visible: head.z < 1 && !rig.hidden }
      // #137 ② C: at the board the head point is above the screen; the agent the visitor plays speaks from its face screen's corner
      if (omok.phase === 'open' && omok.agent === id && rig.parts.face && anchors[id].y < rect.top + BUBBLE.safeTop) {
        // a wide screen: beside the face at its lower right corner; a phone has no room there: over its top edge (the eyes and the hands stay clear)
        const f = faceScreenRect(rig.parts.face, state.camera, rect)
        if (f) {
          const avoid = [...document.querySelectorAll('.omok-hud, .desk-link, .door-btn')].map((el) => el.getBoundingClientRect())
          const beside = !narrow.matches
          anchors[id] = { x: beside ? f.right : (f.left + f.right) / 2, y: beside ? f.bottom : f.top, visible: !rig.hidden, face: { below: f.bottom, avoid, beside } }
        }
      }
      // #601 (designer, #615) the visitor's ping-pong: the agent is small far down the table and a bubble beside its head covered its face; its
      // lines stand just over its head (the work chip, higher, comes after them), centred, kept inside the screen and clear of the score
      const pv = getPingpongVisit()
      if (!replaying && pv.phase === 'open' && pv.agent === id && rig.parts.face) {
        // over the face screen's top edge, centred; no room under the score: beside the face from its lower right corner, never over it
        const f = faceScreenRect(rig.parts.face, state.camera, rect)
        if (f) {
          const avoid = [...document.querySelectorAll('.pp-hud, .pp-score, .desk-link, .door-btn')].map((el) => el.getBoundingClientRect())
          anchors[id] = { x: (f.left + f.right) / 2, y: f.top, visible: !rig.hidden, face: { below: f.bottom, avoid, aside: { x: f.right, y: f.bottom } } }
        }
      }
      if (anchors[id].x > area.w || anchors[id].y > area.h) anchors[id].visible = false
      const tag = replaying ? replayTag(status[id], napping(id)) : statusTag(world.director.shown[id]?.status ?? status[id], world.director.shown[id]?.detail)
      if (tag) tags.push({ id, seat: Number(id.split('_')[1]), ...tag })
    }
    l.update([...byId.values()], tags, anchors, { w: area.w, h: area.h, narrow: narrow.matches })
    // the sleepers' z: dozing at the desk at night; in the timelapse also lying on the sofa (#599 timelapse.md 13.1, the asleep face of 12.4)
    const dozing = (id: string) => status[id]?.night === 'sleep' && rigs[id].arrived === world.goals[id]?.spot && world.goals[id]?.pose === 'doze'
    l.updateZ(
      Object.keys(rigs).filter((id) => dozing(id) || (replaying && napping(id))).map((id) => ({ id, seat: Number(id.split('_')[1]) })),
      anchors,
      state.clock.elapsedTime,
      !zRises(replaying, replay.getSnapshot().rate, reduced),
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
