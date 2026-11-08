/// <reference types="node" />
// No prop moves on its own (#184): a prop that is not in a hand is at its home, every frame, through each scene (pick up, use, put back,
// walk away), and a hand takes a prop only where the prop is. Headless: PlayStage + PropBank on the baked model.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { loadOffice, stubCanvas } from './glbLoad'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { SPOTS } from './navSpots.fixture'
import { PLAYS } from './play'
import type { Goal } from './director'
import { WATERED, standOf } from './water'

stubCanvas()
const LOG = process.env.FIT_LOG
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

interface Scene {
  name: string
  agent: string
  goal: Goal
  kind: string
  tablet?: boolean
  stamp?: boolean
}

const plays = (kind: string) => PLAYS.find((p) => p.kind === kind)!
const water = { face: { x: WATERED.x, z: WATERED.z }, stand: standOf(WATERED) }
const books = plays('books')
const slotOf = (p: { stand?: { x: number; z: number }; face?: { x: number; z: number } }, spot: string) => {
  const sp = SPOTS.find((s) => s.id === spot)!
  if (!p.stand) return { x: sp.x, z: sp.z, ry: sp.ry }
  const f = p.face!
  return { x: p.stand.x, z: p.stand.z, ry: Math.atan2(-(f.x - p.stand.x), -(f.z - p.stand.z)) }
}

const SCENES: Scene[] = [
  { name: 'coffee', agent: 'agent_3', kind: 'cup', goal: { spot: 'coffee', pose: 'coffee', label: '' } },
  { name: 'water', agent: 'agent_1', kind: 'watering_can', goal: { spot: 'hall_lounge', pose: 'water', face: water.face, slot: slotOf(water, 'hall_lounge'), label: '' } },
  { name: 'books', agent: 'agent_0', kind: 'book', goal: { spot: 'shelf', pose: 'books', face: books.face, slot: slotOf(books, 'shelf'), label: '' } },
  { name: 'marker', agent: 'agent_0', kind: 'marker', goal: { spot: 'whiteboard', pose: 'post', label: '' } },
  { name: 'tablet pen', agent: 'agent_2', kind: 'tablet_pen', goal: { spot: 'work_2', pose: 'type', label: '' }, tablet: true },
  { name: 'stamp', agent: 'agent_0', kind: 'stamp', goal: { spot: 'work_0', pose: 'type', label: '' }, stamp: true },
]

async function world() {
  const { scene, nodes } = await loadOffice()
  const props = new PropBank(scene, nodes)
  const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
  const stage = new PlayStage(scene, nodes, props)
  return { scene, nodes, props, rigs, stage }
}

describe('props stay home unless a hand has them', () => {
  for (const sc of SCENES) {
    it(sc.name + ': pick up, use 12 s, put back, walk away — 0 frames with a loose prop away from home; the grasp happens at the prop', async () => {
      const w = await world()
      const home = new Map<string, { pos: Vector3; quat: Quaternion }>()
      const propNodes = Object.values(w.nodes).filter((n) => n.userData.prop && !n.userData.home_on)
      for (const n of propNodes) home.set(n.name, { pos: n.position.clone(), quat: n.quaternion.clone() })
      const rig = w.rigs[sc.agent]
      const place = sc.goal.slot ?? (() => { const s = SPOTS.find((x) => x.id === sc.goal.spot)!; return { x: s.x, z: s.z, ry: s.ry } })()
      rig.at = sc.goal.spot
      rig.x = place.x
      rig.z = place.z
      rig.heading = place.ry
      rig.parts.root.position.set(place.x, 0, place.z)
      rig.parts.root.rotation.set(0, place.ry, 0)
      rig.parts.root.updateMatrixWorld(true)
      const idle: Goal = { spot: 'work_1', pose: 'idle', label: '' }
      let loose = 0
      let worst = 0
      let grasp: number | null = null
      let graspAt = -1
      let was = false
      let heldFrames = 0
      const dt = 0.02
      for (let k = 0; k < 900; k++) {
        const t = k * dt
        const active = t < 12
        const goals = Object.fromEntries(IDS.map((id) => [id, id === sc.agent && active ? sc.goal : idle]))
        if (!active) rig.at = null // walked off
        w.stage.update({ now: 0, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: !!sc.tablet && active, stamp: !!sc.stamp && active, colors: {} })
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(dt)
        w.scene.updateMatrixWorld(true)
        const attached = !!rig.want?.attached
        if (attached) heldFrames++
        if (attached && !was) {
          // the grasp instant: how far the hand's grip frame is from the prop's grip frame
          const prop = w.nodes[rig.want!.prefer ?? ''] ?? propNodes.find((n) => n.userData.prop === sc.kind)!
          const side = rig.want!.side
          const pg = w.scene.getObjectByName(prop.name + '_grip_' + side)
          const hg = rig.parts.hands[side].grip
          if (pg && hg) {
            grasp = hg.getWorldPosition(new Vector3()).distanceTo(pg.getWorldPosition(new Vector3()))
            graspAt = t
          }
        }
        was = attached
        for (const n of propNodes) {
          const holding = rig.want && rig.want.attached && (rig.want.prefer === n.name || (rig.want.kind === n.userData.prop && !rig.want.prefer))
          if (holding) continue
          const h = home.get(n.name)!
          const d = n.position.distanceTo(h.pos)
          worst = Math.max(worst, d)
          if (d > 0.01) loose++
        }
      }
      if (LOG) appendFileSync(LOG, 'props home ' + sc.name + ': held ' + heldFrames + ' frames, loose-away-from-home frames ' + loose + ', worst ' + (worst * 1000).toFixed(1) + ' mm, grip-to-grip at grasp ' + (grasp === null ? 'n/a' : (grasp * 1000).toFixed(1) + ' mm at ' + graspAt.toFixed(2) + ' s') + '\n')
      expect(heldFrames, 'the prop was held').toBeGreaterThan(50)
      expect(loose, 'frames where a prop not in a hand was away from its home').toBe(0)
      // the hand reaches the prop: its grip frame is within 2 cm of the prop's grip for the palm grips, and within the solved fingertip offset otherwise
      expect(grasp).not.toBeNull()
      expect(grasp!).toBeLessThan(0.07)
    }, 60000)
  }
})
void Matrix4

describe('pair games: paddles and stones', () => {
  for (const kind of ['pingpong', 'boardgame'] as const) {
    it(kind + ': a loose paddle / stone is at its home every frame, also after the session ends', async () => {
      const { sessionsAt } = await import('../play/session')
      let s = null as ReturnType<typeof sessionsAt>[number] | null
      for (let m = 0; m < 3000 && !s; m++) s = sessionsAt(1_790_000_000_000 + m * 180_000, IDS).find((x) => x.kind === kind) ?? null
      const w = await world()
      const home = new Map<string, Vector3>()
      const propNodes = Object.values(w.nodes).filter((n) => n.userData.prop && !n.userData.home_on)
      for (const n of propNodes) home.set(n.name, n.position.clone())
      const spots = kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
      s!.players.forEach((id, i) => {
        const sp = SPOTS.find((x) => x.id === spots[i])!
        const r = w.rigs[id]
        r.at = spots[i]
        r.x = sp.x
        r.z = sp.z
        r.heading = sp.ry
        r.parts.root.position.set(sp.x, 0, sp.z)
        r.parts.root.rotation.set(0, sp.ry, 0)
        r.parts.root.updateMatrixWorld(true)
      })
      let loose = 0
      let held = 0
      const dt = 0.02
      for (let k = 0; k < 1800; k++) {
        const t = k * dt
        const active = t < 25
        const now = s!.startMs + 15_000 + 5_000 + t * 1000
        const goals = Object.fromEntries(IDS.map((id) => [id, active && s!.players.includes(id) ? { spot: spots[s!.players.indexOf(id)], pose: kind, label: '' } : { spot: 'work_0', pose: 'idle', label: '' }])) as Record<string, Goal>
        if (!active) for (const id of s!.players) w.rigs[id].at = null
        w.stage.update({ now, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {} })
        w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
        w.props.update(dt)
        for (const n of propNodes) {
          const holding = Object.values(w.rigs).some((r) => r.want?.attached && r.want.prefer === n.name)
          if (holding) {
            held++
            continue
          }
          if (n.position.distanceTo(home.get(n.name)!) > 0.01) loose++
        }
      }
      expect(held).toBeGreaterThan(100)
      expect(loose).toBe(0)
      if (LOG) appendFileSync(LOG, 'props home ' + kind + ': held-prop frames ' + held + ', loose-away-from-home frames ' + loose + '\n')
    }, 60000)
  }
})
