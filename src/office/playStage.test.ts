/// <reference types="node" />
// PlayStage on the baked model, headless: the same office time gives the same ball and stones; the stone sits between the index and
// middle fingertips at their contact points; the paddle's grip touches. Numbers are appended to FIT_LOG when set (the PR's table).
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import { sessionsAt, sessionTime, type PlaySession } from '../play/session'
import { loadOffice, stubCanvas } from './glbLoad'
import { contactNormal } from './gripTargets'
import { PlayStage, type StageIn } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import type { Goal } from './director'

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
    const s = sessionsAt(1_790_000_000_000 + m * 180_000, IDS).find((x) => x.kind === kind && (!agent || x.players.includes(agent)))
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
  const j = f === 'thumb' ? h.thumb[1]!.node : h.fingers[f][2]!.node
  const tip = f === 'thumb' ? h.thumbTip! : h.tips[f]!
  j.updateWorldMatrix(true, false)
  return out.copy(tip).applyMatrix4(j.matrixWorld)
}
const at = (scene: Object3D, name: string) => scene.getObjectByName(name)!.getWorldPosition(new Vector3())
const up = (scene: Object3D, name: string) => contactNormal(scene, scene.getObjectByName(name)!)

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

  it('omok: the same office time gives the same stones; the stone sits between the index and middle fingertips at their contacts', async () => {
    const s = findSession('boardgame')
    const run = async (measure: boolean) => {
      const w = await world()
      const goals = seat(w.rigs, s)
      const sig: number[] = []
      let worst = 0
      let frames = 0
      let minOff = Infinity
      for (let k = 0; k < 400; k++) {
        const now = s.startMs + 15_000 + 3000 + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        const st = (w.stage as unknown as { stones: { b: { count: number }; w: { count: number } } }).stones
        sig.push(st.b.count, st.w.count)
        if (!measure) continue
        for (const id of s.players) {
          const r = w.rigs[id]
          if (r.want?.kind !== 'piece' || !r.want.attached) continue
          const col = r.want.prefer!.endsWith('a') ? 'a' : 'b'
          const d = r.drive.r
          // only once the hand has fully closed on the stone and re-gripped into the go grip
          if (!d || d.w < 0.999 || d.wc < 0.999 || (w.stage.lastPlace[id]?.regrip ?? 0) < 1) continue
          w.scene.updateMatrixWorld(true)
          const ci = 'prop_piece_' + col + '_contact_index'
          const cm = 'prop_piece_' + col + '_contact_middle'
          const ti = tipWorld(r, 'r', 0)
          const tm = tipWorld(r, 'r', 1)
          worst = Math.max(worst, ti.distanceTo(at(w.scene, ci)), tm.distanceTo(at(w.scene, cm)))
          minOff = Math.min(minOff, ti.sub(at(w.scene, ci)).dot(up(w.scene, ci)), tm.sub(at(w.scene, cm)).dot(up(w.scene, cm)))
          frames++
        }
      }
      return { sig, worst, frames, minOff }
    }
    const a = await run(true)
    const b = await run(false)
    expect(a.sig).toEqual(b.sig)
    expect(Math.max(...a.sig)).toBeGreaterThan(3) // stones are on the board
    expect(a.frames).toBeGreaterThan(5)
    if (LOG) appendFileSync(LOG, 'stone hold: ' + a.frames + ' frames, worst fingertip-to-contact ' + (a.worst * 1000).toFixed(2) + ' mm, min stand-off ' + (a.minOff * 1000).toFixed(2) + ' mm\n')
    expect(a.worst).toBeLessThan(0.003)
    expect(a.minOff).toBeGreaterThan(-0.0005)
  }, 60000)

  it('omok: at the place instant each agent hand is palm down and toward the body, fingers forward and down (designer: 30–45°), the stone flat', async () => {
    for (const agent of IDS) {
      const s = findSession('boardgame', agent)
      const w = await world()
      const goals = seat(w.rigs, s)
      let n = 0
      let palmMax = -Infinity
      let pitchMin = Infinity
      let pitchMax = -Infinity
      let flat = 1
      for (let k = 0; k < 500; k++) {
        const now = s.startMs + 15_000 + 100 + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        const r = w.rigs[agent]
        const d = r.drive.r
        if (r.want?.kind !== 'piece' || !r.want.attached || !d?.target || d.w < 0.999) continue
        const palm = new Vector3(0, 0, 1).transformDirection(d.target)
        const fingers = new Vector3(0, 1, 0).transformDirection(d.target)
        palmMax = Math.max(palmMax, palm.y)
        pitchMin = Math.min(pitchMin, fingers.y)
        pitchMax = Math.max(pitchMax, fingers.y)
        const stone = w.scene.getObjectByName('prop_piece_' + (r.want.prefer!.endsWith('a') ? 'a' : 'b'))!
        flat = Math.min(flat, new Vector3(0, 1, 0).transformDirection(stone.matrixWorld).y)
        n++
      }
      if (LOG) appendFileSync(LOG, 'place hand ' + agent + ': ' + n + ' frames, palm normal y <= ' + palmMax.toFixed(2) + ', finger pitch y in [' + pitchMin.toFixed(2) + ', ' + pitchMax.toFixed(2) + '], stone normal y >= ' + flat.toFixed(3) + '\n')
      expect(n, agent).toBeGreaterThan(5)
      expect(palmMax, agent + ' palm down').toBeLessThanOrEqual(-0.6)
      expect(pitchMax, agent + ' fingers down').toBeLessThan(-0.25)
      expect(pitchMin, agent + ' fingers not straight down').toBeGreaterThan(-0.85)
      expect(flat, agent + ' stone flat').toBeGreaterThan(0.95)
    }
  }, 120000)

  it('omok: every stone is taken from the bowl on the own side (seat → colour → bowl)', async () => {
    const s = findSession('boardgame')
    const w = await world()
    const goals = seat(w.rigs, s)
    w.scene.updateMatrixWorld(true)
    const bowls = { b: at(w.scene, 'omok_bowl_b_contact_index'), w: at(w.scene, 'omok_bowl_w_contact_index') }
    const was: Record<string, boolean> = {}
    let picks = 0
    const seen = new Set<string>()
    for (let k = 0; k < 2500; k++) {
      const now = s.startMs + 15_000 + k * 40
      w.stage.update(inp(w, goals, now, k * 0.04))
      w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
      w.props.update(0.04)
      for (const [i, id] of s.players.entries()) {
        const r = w.rigs[id]
        const att = r.want?.kind === 'piece' && !!r.want.attached && r.want.prefer !== undefined
        if (att && !was[id]) {
          const target = r.drive.r!.target!
          const hand = new Vector3().setFromMatrixPosition(target)
          const own = i === 0 ? bowls.b : bowls.w
          const other = i === 0 ? bowls.w : bowls.b
          expect(hand.distanceTo(own), id + ' pick ' + picks).toBeLessThan(hand.distanceTo(other))
          expect(r.want!.prefer, id + ' stone colour').toBe(i === 0 ? 'prop_piece_a' : 'prop_piece_b')
          seen.add(id)
          picks++
        }
        was[id] = att
      }
    }
    expect(picks).toBeGreaterThan(10)
    expect(seen.size).toBe(2)
  }, 60000)

  it('omok: seated mid-move (the first frame is already past the pick), the stone is never taken from anywhere but where it rests', async () => {
    const s = findSession('boardgame')
    let attachedFrames = 0
    for (let off = 0; off < 9000; off += 450) {
      const w = await world()
      const goals = seat(w.rigs, s)
      const stones = ['prop_piece_a', 'prop_piece_b'].map((n) => w.nodes[n])
      const home = stones.map((n) => n.position.clone())
      const had = new Set<string>()
      for (let k = 0; k < 120; k++) {
        const now = s.startMs + 15_000 + off + k * 40
        w.stage.update(inp(w, goals, now, k * 0.04))
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(0.04)
        stones.forEach((n, i) => {
          const holder = Object.values(w.rigs).find((r) => r.want?.attached && r.want.prefer === n.name)
          if (!holder) return
          attachedFrames++
          // the frame a hand takes it: it is where it rested, give or take the first 40 ms frame of the lift (2.4 cm at most; a late take was 20 cm away)
          if (!had.has(n.name)) expect(n.position.distanceTo(home[i]), `offset ${off} frame ${k}: ${n.name} taken away from where it rests`).toBeLessThanOrEqual(0.05)
          had.add(n.name)
        })
      }
    }
    expect(attachedFrames).toBeGreaterThan(10)
  }, 120000)

  it('nobody seated: the ball waits on the table', async () => {
    const w = await world()
    const s = findSession('pingpong')
    const goals = Object.fromEntries(IDS.map((id) => [id, { spot: 'work_0', pose: 'idle', label: '' } as Goal]))
    w.stage.update(inp(w, goals, s.startMs + 60_000, 1))
    expect(w.nodes.pp_ball.visible).toBe(true)
    expect(sessionTime(s, s.startMs + 60_000)).toBeGreaterThan(0)
  })
})
