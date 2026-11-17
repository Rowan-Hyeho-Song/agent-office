/// <reference types="node" />
// PlayStage on the baked model, headless: the same office time gives the same ball and hologram stones; the pinch holds the light stone on its rim;
// the paddle's grip touches. Numbers are appended to FIT_LOG when set (the PR's table).
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Color, type InstancedBufferAttribute, type InstancedMesh, type Object3D, Vector3 } from 'three'
import { sessionsAt, sessionTime, type PlaySession } from '../play/session'
import { loadOffice, stubCanvas } from './glbLoad'
import { HOLO_PINCH_R } from './gripTargets'
import { STONE_H as HOLO_STONE_H, STONE_Y as HOLO_STONE_Y } from './holoBoard'
import { pinchSequence, pinchTimes } from '../play/holoPinch'
import { gameAt } from '../play/omok'
import { PlayStage, type StageIn } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import type { Goal } from './director'
import { startVisitorGame, viewOf } from '../play/visitorOmok'
import { chessViewOf, startVisitorChess } from '../play/visitorChess'

stubCanvas()
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const LOG = process.env.FIT_LOG

async function world() {
  const { scene, nodes } = await loadOffice()
  const props = new PropBank(scene, nodes)
  const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
  const stage = new PlayStage(scene, nodes, props)
  return { scene, nodes, props, rigs, stage }
}

function findSession(kind: 'pingpong' | 'boardgame', agent?: string): PlaySession {
  for (let m = 0; m < 6000; m++) {
    // a pair (#490: the first one at the board places a record alone while it waits; that is its own, solo session)
    const s = sessionsAt(1_790_000_000_000 + m * 180_000, IDS).find((x) => x.kind === kind && !x.solo && (kind !== 'boardgame' || x.game === 'omok') && (!agent || x.players.includes(agent))) // #604 the omok board
    if (s) return s
  }
  throw new Error('no session')
}

function seat(rigs: Record<string, AgentRig>, s: PlaySession) {
  const spots = s.kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
  const goals: Record<string, Goal> = {}
  s.players.forEach((id, i) => {
    const r = rigs[id]
    r.at = spots[i]
    r.x = i === 0 ? (s.kind === 'pingpong' ? 0.87 : -2.2) : s.kind === 'pingpong' ? 3.53 : -1
    r.z = s.kind === 'pingpong' ? 0 : 2.2
    r.heading = i === 0 ? -Math.PI / 2 : Math.PI / 2
    r.parts.root.position.set(r.x, 0, r.z)
    r.parts.root.rotation.set(0, r.heading, 0)
    r.parts.root.updateMatrixWorld(true)
    goals[id] = { spot: spots[i], pose: s.kind, label: s.kind }
  })
  for (const id of IDS) if (!goals[id]) goals[id] = { spot: 'work_0', pose: 'idle', label: '' }
  return goals
}

type W = Awaited<ReturnType<typeof world>>
const inp = (w: W, goals: Record<string, Goal>, now: number, t: number, over: Partial<StageIn> = {}): StageIn => ({
  now, t, dt: 0.016, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, ...over,
})

const tipWorld = (rig: AgentRig, side: 'l' | 'r', f: number | 'thumb', out = new Vector3()) => {
  const h = rig.parts.hands[side]
  const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[f][2]!.node
  const tip = f === 'thumb' ? h.thumbTip! : h.tips[f]!
  j.updateWorldMatrix(true, false)
  return out.copy(tip).applyMatrix4(j.matrixWorld)
}


// #538 the hologram board (hologram.md): the board is light the app draws; the mover's right hand pinches a light stone from its own fount
type Holo = { stones: { 1: InstancedMesh; 2: InstancedMesh }; marks: InstancedMesh; state: string; fountPos(seat: Vector3): Vector3; cellPos(cell: number): Vector3 }
const holoOf = (w: W) => (w.stage as unknown as { holo: Holo }).holo
const ARR = (m: InstancedMesh, name: string) => Array.from((m.geometry.getAttribute(name) as InstancedBufferAttribute).array as Float32Array)
const at = (scene: Object3D, name: string) => scene.getObjectByName(name)!.getWorldPosition(new Vector3())
const rgbOf = (hex: string) => new Color(hex).toArray().slice(0, 3).map((x) => x.toFixed(4)).join(',')

/** the held stone of `agent`'s move at office time `now`, recomputed as PlayStage.omokHands does: the centre, and the two rim points the thumb and index meet */
function heldStone(w: W, s: PlaySession, agent: string, now: number) {
  const view = gameAt(s.seed, s.players, sessionTime(s, now), false)
  const mv = view.move
  if (!mv || s.players[mv.mover] !== agent) return null
  const p = pinchSequence(mv.sinceMs, mv.thinkMs)
  const holo = holoOf(w)
  const at = w.rigs[agent].parts.root.position
  const fount = holo.fountPos(at)
  const target = holo.cellPos(mv.cell)
  const lift = HOLO_STONE_Y + HOLO_STONE_H / 2
  const centre = new Vector3(fount.x, target.y + lift, fount.z).lerp(new Vector3(target.x, target.y + lift, target.z), p.u)
  centre.y += p.h
  const mid = holo.cellPos(112)
  const fwd = new Vector3(mid.x - at.x, 0, mid.z - at.z).normalize()
  const side = new Vector3().crossVectors(new Vector3(0, 1, 0), fwd)
  return { p, view, fount, centre, thumb: centre.clone().addScaledVector(side, -HOLO_PINCH_R), index: centre.clone().addScaledVector(side, HOLO_PINCH_R) }
}

/** agent_0 seated at game_a, for the visitor's game (the visitor has no rig) */
function visitorSeat(w: W) {
  const goals = Object.fromEntries(IDS.map((id) => [id, { spot: 'work_0', pose: 'idle', label: '' } as Goal]))
  const r = w.rigs.agent_0
  r.at = 'game_a'
  r.x = -2.2
  r.z = 2.2
  r.heading = -Math.PI / 2
  r.parts.root.position.set(r.x, 0, r.z)
  r.parts.root.rotation.set(0, r.heading, 0)
  r.parts.root.updateMatrixWorld(true)
  goals.agent_0 = { spot: 'game_a', pose: 'boardgame', label: '' }
  return goals
}

describe('PlayStage', () => {
  it('ping-pong: the same office time gives the same ball position, in two separate worlds', async () => {
    const s = findSession('pingpong')
    const run = async () => {
      const w = await world()
      const goals = seat(w.rigs, s)
      const out: number[][] = []
      for (let k = 0; k < 80; k++) {
        const now = s.startMs + 15_000 + 8_000 + k * 120
        w.stage.update(inp(w, goals, now, k * 0.12))
        const b = w.nodes.pp_ball
        out.push([b.visible ? 1 : 0, ...b.position.toArray()])
      }
      return out
    }
    const a = await run()
    const b = await run()
    expect(a).toEqual(b)
    expect(a.some((p) => p[0] === 1 && Math.abs(p[1] - 2.45) > 0.1)).toBe(true) // the ball travels
  })

  it('ping-pong: the paddle comes to the ball and the hand holds it with fingertips on the contacts', async () => {
    const s = findSession('pingpong')
    const w = await world()
    const goals = seat(w.rigs, s)
    let best = Infinity
    let touch = 0
    for (let k = 0; k < 600; k++) {
      const tMs = 6000 + k * 20
      const now = s.startMs + 15_000 + tMs
      w.stage.update(inp(w, goals, now, k * 0.02))
      w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
      w.props.update(0.02)
      for (const side of [0, 1] as const) {
        const paddle = w.scene.getObjectByName(side ? 'prop_paddle_b' : 'prop_paddle_a')!
        paddle.updateMatrixWorld(true)
        if (!w.nodes.pp_ball.visible) continue
        const blade = new Vector3(0, 0.175, 0).applyMatrix4(paddle.matrixWorld)
        best = Math.min(best, blade.distanceTo(w.nodes.pp_ball.position))
      }
      if (k === 300) {
        const r = w.rigs[s.players[0]]
        w.scene.updateMatrixWorld(true)
        for (const f of ['index', 'thumb'] as const) {
          const d = tipWorld(r, 'r', f === 'thumb' ? 'thumb' : 0).distanceTo(at(w.scene, 'prop_paddle_a_contact_' + f))
          touch = Math.max(touch, d)
          if (LOG) appendFileSync(LOG, 'paddle_a hold ' + s.players[0] + ' ' + f + ' tip-to-contact ' + (d * 1000).toFixed(2) + ' mm\n')
        }
      }
    }
    expect(best).toBeLessThan(0.06) // the blade comes within 6 cm of the ball's centre
    expect(touch).toBeLessThan(0.003)
  })

  it('ping-pong: a ball out of reach makes the body step along the end line, at most 0.4 m and 1.2 m/s, and it comes back (#397, play.md 7)', async () => {
    const s = findSession('pingpong')
    const w = await world()
    const goals = seat(w.rigs, s)
    const steps: number[][] = [[], []]
    for (let k = 0; k < 1500; k++) {
      const now = s.startMs + 15_000 + 6000 + k * 20
      w.stage.update(inp(w, goals, now, k * 0.02))
      for (const side of [0, 1] as const) {
        const r = w.rigs[s.players[side]]
        steps[side].push(r.parts.root.position.z - r.z)
      }
    }
    for (const side of [0, 1]) {
      const st = steps[side]
      expect(Math.max(...st.map(Math.abs))).toBeLessThanOrEqual(0.4 + 1e-6)
      for (let i = 1; i < st.length; i++) expect(Math.abs(st[i] - st[i - 1])).toBeLessThanOrEqual(1.2 * 0.02 + 1e-6)
    }
    const all = [...steps[0], ...steps[1]]
    if (LOG) appendFileSync(LOG, 'pingpong side step max ' + Math.max(...all.map(Math.abs)).toFixed(3) + ' m, frames stepped ' + all.filter((x) => Math.abs(x) > 0.01).length + '/' + all.length + '\n')
    expect(Math.max(...all.map(Math.abs))).toBeGreaterThan(0.05) // in 30 s of rally some ball is out of reach
    expect(all.some((x, i) => i > 0 && Math.abs(x) < 1e-6 && Math.abs(all[i - 1]) > 0)).toBe(true) // and it comes back to the spot
  })

  it('ping-pong: the side step keeps to 1.2 m/s of frame time even when the office clock runs ahead of the frames (#448: 1.38 m/s at peaks)', async () => {
    const s = findSession('pingpong')
    const w = await world()
    const goals = seat(w.rigs, s)
    const dt = 0.016
    const prev: Record<string, number> = {}
    let worst = 0
    for (let k = 0; k < 1500; k++) {
      // 40 ms of office time per 16 ms frame
      w.stage.update(inp(w, goals, s.startMs + 15_000 + 6000 + k * 40, k * dt, { dt }))
      for (const id of s.players) {
        const r = w.rigs[id]
        const z = r.parts.root.position.z - r.z
        if (id in prev) worst = Math.max(worst, Math.abs(z - prev[id]) / dt)
        prev[id] = z
      }
    }
    expect(worst).toBeGreaterThan(0.5) // it does step
    expect(worst).toBeLessThanOrEqual(1.2 + 1e-6)
  })

  it('omok: the same office time gives the same hologram stones and the same hand, in two separate worlds', async () => {
    const s = findSession('boardgame')
    const run = async () => {
      const w = await world()
      const goals = seat(w.rigs, s)
      const sig: unknown[] = []
      for (let k = 0; k < 400; k++) {
        const now = s.startMs + 15_000 + 3000 + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        const h = holoOf(w)
        sig.push([h.stones[1].count, h.stones[2].count, ARR(h.stones[1], 'iPos').slice(0, h.stones[1].count * 3), ARR(h.stones[2], 'iPos').slice(0, h.stones[2].count * 3), ...s.players.map((id) => w.rigs[id].drive.r?.target?.elements.slice() ?? null)])
      }
      return sig as [number, number][]
    }
    const a = await run()
    const b = await run()
    expect(a).toEqual(b)
    expect(Math.max(...a.map((x) => x[0] + x[1])), 'stones are on the board').toBeGreaterThan(3)
  }, 60000)

  it('omok: the thumb and index tips meet the held light stone on its rim (2.24 cm apart, 3 mm), palm down, fingers forward and down', async () => {
    for (const agent of IDS) {
      const s = findSession('boardgame', agent)
      const w = await world()
      const goals = seat(w.rigs, s)
      let n = 0
      let worstRim = 0
      let worstGap = 0
      let palmMax = -Infinity
      let pitchMin = Infinity
      let pitchMax = -Infinity
      for (let k = 0; k < 500; k++) {
        const now = s.startMs + 15_000 + 100 + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        w.scene.updateMatrixWorld(true)
        const r = w.rigs[agent]
        const d = r.drive.r
        const hs = heldStone(w, s, agent, now)
        if (!hs || !hs.p.held || !w.stage.lastPlace[agent]?.held || !d?.target || d.w < 0.999) continue
        const th = tipWorld(r, 'r', 'thumb')
        const ix = tipWorld(r, 'r', 0)
        worstRim = Math.max(worstRim, th.distanceTo(hs.thumb), ix.distanceTo(hs.index))
        worstGap = Math.max(worstGap, Math.abs(th.distanceTo(ix) - 2 * HOLO_PINCH_R))
        const palm = new Vector3(0, 0, 1).transformDirection(d.target)
        const fingers = new Vector3(0, 1, 0).transformDirection(d.target)
        palmMax = Math.max(palmMax, palm.y)
        pitchMin = Math.min(pitchMin, fingers.y)
        pitchMax = Math.max(pitchMax, fingers.y)
        n++
      }
      if (LOG) appendFileSync(LOG, 'pinch ' + agent + ': ' + n + ' frames, worst tip-to-rim ' + (worstRim * 1000).toFixed(2) + ' mm, worst gap error ' + (worstGap * 1000).toFixed(2) + ' mm, palm normal y <= ' + palmMax.toFixed(2) + ', finger pitch y in [' + pitchMin.toFixed(2) + ', ' + pitchMax.toFixed(2) + ']\n')
      expect(n, agent).toBeGreaterThan(5)
      expect(worstRim, agent + ' tips on the rim (m)').toBeLessThan(0.003)
      expect(worstGap, agent + ' tip distance 2.24 cm').toBeLessThan(0.003)
      expect(palmMax, agent + ' palm down').toBeLessThanOrEqual(-0.6)
      expect(pitchMax, agent + ' fingers forward and down (y < -0.1)').toBeLessThan(-0.1)
      expect(pitchMin, agent + ' fingers not straight down').toBeGreaterThan(-0.85)
    }
  }, 120000)

  it("omok: every stone is pinched from the fount of the mover's own seat", async () => {
    let picks = 0
    for (const agent of IDS) {
      const s = findSession('boardgame', agent)
      const w = await world()
      const goals = seat(w.rigs, s)
      let was = false
      let worst = 0
      for (let k = 0; k < 1500; k++) {
        const now = s.startMs + 15_000 + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        w.scene.updateMatrixWorld(true)
        const held = !!w.stage.lastPlace[agent]?.held && !!heldStone(w, s, agent, now)
        if (held && !was && w.rigs[agent].drive.r) {
          const r = w.rigs[agent]
          const mid = tipWorld(r, 'r', 'thumb').add(tipWorld(r, 'r', 0)).multiplyScalar(0.5)
          const f = holoOf(w).fountPos(r.parts.root.position)
          worst = Math.max(worst, Math.hypot(mid.x - f.x, mid.z - f.z))
          picks++
        }
        was = held
      }
      expect(worst, agent + ' pick over its own fount (m)').toBeLessThan(0.015)
    }
    expect(picks).toBeGreaterThan(10)
  }, 180000)

  it('omok: seated mid-move (the first frame is already past the pick), no hand drive for that move: the light stone is never made from nothing', async () => {
    const s = findSession('boardgame')
    let late = 0
    let early = 0
    for (let off = 0; off < 9000; off += 450) {
      const w = await world()
      const goals = seat(w.rigs, s)
      const first = new Map<string, { key: string; late: boolean }>()
      for (let k = 0; k < 120; k++) {
        const now = s.startMs + 15_000 + off + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        const view = gameAt(s.seed, s.players, sessionTime(s, now), false)
        const mv = view.move
        const playing = view.phase === 'thinking' || view.phase === 'pick' || view.phase === 'place'
        if (!mv || !playing) continue
        const id = s.players[mv.mover]
        const key = `${view.game}:${mv.cell}`
        const p = pinchSequence(mv.sinceMs, mv.thinkMs)
        if (!first.has(id)) first.set(id, { key, late: mv.sinceMs >= pinchTimes(mv.thinkMs).pick })
        const f = first.get(id)!
        if (f.key !== key || p.stage === 'rest') continue
        if (f.late) {
          late++
          expect(w.rigs[id].drive.r, `offset ${off} frame ${k}: ${id} has a hand on a stone nobody took`).toBeFalsy()
        } else if (w.rigs[id].drive.r) early++
      }
    }
    expect(late).toBeGreaterThan(10)
    expect(early).toBeGreaterThan(10)
  }, 120000)

  it('nobody seated: the ball waits on the table', async () => {
    const w = await world()
    const s = findSession('pingpong')
    const goals = Object.fromEntries(IDS.map((id) => [id, { spot: 'work_0', pose: 'idle', label: '' } as Goal]))
    w.stage.update(inp(w, goals, s.startMs + 60_000, 1))
    expect(w.nodes.pp_ball.visible).toBe(true)
    expect(sessionTime(s, s.startMs + 60_000)).toBeGreaterThan(0)
  })

  it('omok: the hologram turns on while a player sits at the board and off after they leave; the stones carry the side colours only', async () => {
    const s = findSession('boardgame')
    const w = await world()
    const goals = seat(w.rigs, s)
    const h = holoOf(w)
    expect(h.state).toBe('off')
    const seen = new Set<string>()
    const colours = new Set<string>()
    let k = 0
    for (; k < 600; k++) {
      w.stage.update(inp(w, goals, s.startMs + 15_000 + 3000 + k * 40, k * 0.04))
      seen.add(h.state)
      for (const side of [1, 2] as const) {
        const m = h.stones[side]
        const c = ARR(m, 'iCol')
        for (let i = 0; i < m.count; i++) colours.add(side + ':' + c.slice(i * 3, i * 3 + 3).map((x) => x.toFixed(4)).join(','))
      }
    }
    expect(seen.has('on')).toBe(true)
    expect([...colours].sort()).toEqual(['1:' + rgbOf('#4df3ff'), '2:' + rgbOf('#f3ead8')].sort())
    for (const id of s.players) w.rigs[id].at = null
    const idle = Object.fromEntries(IDS.map((id) => [id, { spot: 'work_0', pose: 'idle', label: '' } as Goal]))
    for (let j = 0; j < 200 && h.state !== 'off'; j++, k++) w.stage.update(inp(w, idle, s.startMs + 15_000 + 3000 + k * 40, k * 0.04))
    expect(h.state).toBe('off')
    expect(h.stones[1].count + h.stones[2].count).toBe(0)
  }, 60000)

  it("omok: the visitor's game is drawn: the stones follow the visitor game", async () => {
    const w = await world()
    const goals = visitorSeat(w)
    const g = startVisitorGame('agent_0', 7, 0)
    const h = holoOf(w)
    const view = { ...viewOf(g, 9_000), phase: 'won' as const, winner: 1 as const, line: [110, 111, 112, 113, 114], wonMs: 900 }
    view.board = new Uint8Array(225)
    for (const c of [110, 111, 112, 113, 114]) view.board[c] = 1
    for (const c of [95, 96, 97]) view.board[c] = 2
    w.stage.update(inp(w, goals, 10_000, 1, { dt: 0.02, visitorOmok: { agent: 'agent_0', view } }))
    expect(h.state).toBe('on')
    expect(h.stones[1].count).toBe(5)
    expect(h.stones[2].count).toBe(3)
  })

  it("#538 the visitor sitting down turns the board on, while its agent is still on its way (hologram.md 2: the first one, the visitor too)", async () => {
    const w = await world()
    const goals = visitorSeat(w)
    // the agent not at its chair yet: nowhere near the board
    const r = w.rigs.agent_0
    r.at = 'work_0'
    r.parts.root.position.set(4, 0, -3)
    r.parts.root.updateMatrixWorld(true)
    const h = holoOf(w)
    const view = viewOf(startVisitorGame('agent_0', 7, 0), 9_000)
    w.stage.update(inp(w, goals, 10_000, 1, { dt: 0.02, visitorOmok: { agent: 'agent_0', view } }))
    w.stage.update(inp(w, goals, 10_000, 1.4, { dt: 0.02, visitorOmok: { agent: 'agent_0', view } }))
    expect(h.state).toBe('on')
  })

  it('#137 ② the board takes a world point to its cell and back (the visitor pointer)', async () => {
    const w = await world()
    const g = w.stage.omokGrid!
    expect(g.n).toBe(15)
    for (const cell of [0, 14, 112, 210, 224, 37]) {
      const p = w.stage.omokPoint(cell)!
      expect(w.stage.omokCellAt(p)).toBe(cell)
      expect(w.stage.omokCellAt(p.clone().add(new Vector3(g.cell * 0.3, 0, -g.cell * 0.3)))).toBe(cell)
    }
    expect(w.stage.omokCellAt(w.stage.omokPoint(0)!.add(new Vector3(-g.cell, 0, 0)))).toBeNull() // off the board
  })

  it("#137 ② (hologram.md 3): a won game draws the five in a line of the winner's side colour (cyan for black, ivory for white), whoever won", async () => {
    const w = await world()
    const goals = visitorSeat(w)
    const g = startVisitorGame('agent_0', 7, 0)
    const line = [110, 111, 112, 113, 114]
    const h = holoOf(w)
    let t = 1
    const look = (winner: 1 | 2) => {
      const view = { ...viewOf(g, 9_000), phase: 'won' as const, winner, line, wonMs: 900 }
      for (let i = 0; i < 3; i++) w.stage.update(inp(w, goals, 10_000, t++, { dt: 0.02, colors: { agent_0: '#4a90d9' }, visitorOmok: { agent: 'agent_0', view } }))
      return { n: h.marks.count, rgb: ARR(h.marks, 'iCol').slice(0, 3).map((x) => x.toFixed(4)).join(',') }
    }
    expect(look(1)).toEqual({ n: 1, rgb: rgbOf('#4df3ff') })
    expect(look(2)).toEqual({ n: 1, rgb: rgbOf('#f3ead8') })
  })

  // #604 the visitor's chess: its view is drawn on the board, the visitor's colour is near (a black visitor turns the board)
  it("chess: the visitor's game is drawn (the board on, all 32 pieces); a black visitor turns the board so their colour is near the chair", async () => {
    const chair = (w: W) => at(w.scene, 'nav_game_b')
    for (const game of [0, 1]) {
      const w = await world()
      const goals = visitorSeat(w)
      const h = holoOf(w) as Holo & { chessLayer: { pieces: Record<1 | 2, Record<number, InstancedMesh>> } }
      const g = startVisitorChess('agent_0', 7, 0, 'normal', game)
      const vis = { selected: null, targets: [], cursor: 12, drag: null }
      const run = (t: number) => w.stage.update(inp(w, goals, 10_000, t, { dt: 0.02, visitorChess: { agent: 'agent_0', view: chessViewOf(g, 9_000), visitor: vis } }))
      for (let t = 1; t < 5; t += 0.2) run(t)
      expect(h.state).toBe('on')
      let n = 0
      for (const c of [1, 2] as const) for (let k = 1; k <= 6; k++) n += h.chessLayer.pieces[c][k].count
      expect(n).toBe(32)
      // the visitor's back rank is the near one: white's e1 (game 0) / black's e8 (game 1) is nearer the chair than the far king
      const mine = w.stage.chessSquarePos(game === 0 ? 4 : 60)!
      const theirs = w.stage.chessSquarePos(game === 0 ? 60 : 4)!
      expect(mine.distanceTo(chair(w))).toBeLessThan(theirs.distanceTo(chair(w)))
      expect(w.stage.chessSquareAt(mine)).toBe(game === 0 ? 4 : 60)
    }
  })
})
