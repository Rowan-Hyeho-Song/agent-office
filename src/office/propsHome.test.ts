/// <reference types="node" />
// No prop moves on its own (#184, #228): a prop that is not in a hand is at its home, every frame, through each scene (pick up, use, put back,
// walk away), and a hand takes a prop only where the prop is: no jump at the grasp or the release (≤ 5 mm), and the prop is within the holder's
// reach (water.ts REACH, 0.75 m: the farthest the hands' own poses go is 0.6 m, plus 0.15 m of lean) when taken, while carried, and when put down.
// #184 missed the watering can: its test stood the agent at the plant, where the can was never within reach, and only asked that the can not jump.
// Headless: PlayStage + PropBank on the baked model; the watering errand and a stretch of the real schedule run through Director + TrafficPlanner.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, JUMP, expectClean, reachOf, world } from './errandWorld.fixture'
import { SPOTS } from './navSpots.fixture'
import { BOARD_STAND } from './meetingRun'
import { PLAYS } from './play'
import { GRIPS } from './grip'
import { resolveTarget } from './gripTargets'
import type { Goal } from './director'

stubCanvas()
const LOG = process.env.FIT_LOG
const FINGER_NAMES = ['index', 'middle', 'ring', 'little', 'thumb'] as const
const PALM = new Set(['watering_can', 'stamp'])
interface Scene {
  name: string
  agent: string
  goal: Goal
  kind: string
  /** the node the scene takes, when the kind has several (the markers: one per seat) */
  prop?: string
  tablet?: boolean
  stamp?: boolean
}

const plays = (kind: string) => PLAYS.find((p) => p.kind === kind)!
const books = plays('books')
const slotOf = (p: { stand?: { x: number; z: number }; face?: { x: number; z: number } }, spot: string) => {
  const sp = SPOTS.find((s) => s.id === spot)!
  if (!p.stand) return { x: sp.x, z: sp.z, ry: sp.ry }
  const f = p.face!
  return { x: p.stand.x, z: p.stand.z, ry: Math.atan2(-(f.x - p.stand.x), -(f.z - p.stand.z)) }
}

const SCENES: Scene[] = [
  { name: 'coffee', agent: 'agent_3', kind: 'cup', goal: { spot: 'coffee', pose: 'coffee', label: '' } },
  { name: 'books', agent: 'agent_0', kind: 'book', goal: { spot: 'shelf', pose: 'books', face: books.face, slot: slotOf(books, 'shelf'), label: '' } },
  { name: 'marker', agent: 'agent_0', kind: 'marker', prop: 'prop_marker_0', goal: { spot: BOARD_STAND, pose: 'post', label: '' } },
  { name: 'marker 1', agent: 'agent_1', kind: 'marker', prop: 'prop_marker_1', goal: { spot: BOARD_STAND, pose: 'post', label: '' } },
  { name: 'marker 2', agent: 'agent_2', kind: 'marker', prop: 'prop_marker_2', goal: { spot: BOARD_STAND, pose: 'post', label: '' } },
  { name: 'tablet pen', agent: 'agent_2', kind: 'tablet_pen', goal: { spot: 'work_2', pose: 'type', label: '' }, tablet: true },
  { name: 'stamp', agent: 'agent_0', kind: 'stamp', goal: { spot: 'work_0', pose: 'type', label: '' }, stamp: true },
]

describe('props stay home unless a hand has them', () => {
  for (const sc of SCENES) {
    it(sc.name + ': pick up, use 12 s, put back, walk away — 0 frames with a loose prop away from home; the hand goes to the prop: at the grasp its fingertips are on the contacts (fingertip props) or its grip is on the prop grip (palm props), and the prop does not jump', async () => {
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
      const guard = new Guard(w)
      const propOf = () => (sc.prop ? w.nodes[sc.prop] : propNodes.find((n) => n.userData.prop === sc.kind))!
      let loose = 0
      let worst = 0
      let grasp: number | null = null
      let graspAt = -1
      const tips: string[] = []
      let worstTip = 0
      let jump = 0
      let prev: Vector3 | null = null
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
        guard.frame(t)
        const attached = !!rig.want?.attached
        if (attached) heldFrames++
        if (attached && !was) {
          const prop = w.nodes[rig.want!.prefer ?? ''] ?? propOf()
          const side = rig.want!.side
          // 3: the prop does not jump to the hand
          jump = prev ? prop.position.distanceTo(prev) : 0
          // 2: the grips (palm props)
          const pg = w.scene.getObjectByName(prop.name + '_grip_' + side)
          // the open book's grip frame is the computed one (bookGeom.ts readingGrip), not the glb's closed-book grip empty
          const bookTarget = sc.kind === 'book' ? resolveTarget(w.scene, prop.name, 'book', side) : null
          const hg = rig.parts.hands[side].grip
          if (pg && hg) {
            grasp = hg.getWorldPosition(new Vector3()).distanceTo(bookTarget ? prop.localToWorld(new Vector3().setFromMatrixPosition(bookTarget.pg)) : pg.getWorldPosition(new Vector3()))
            graspAt = t
          }
          // 1: every contact finger's pad point against its contact (fingertip props), both hands of a two-handed hold
          for (const hs of ['l', 'r'] as const) {
            for (const [fi, finger] of FINGER_NAMES.entries()) {
              // the open book's contacts are derived from the book's own size (bookGeom.ts, #231); the other props' are the glb's empties
              const bc = sc.kind === 'book' ? resolveTarget(w.scene, prop.name, 'book', hs)?.contacts.find((c) => c.finger === finger) : undefined
              const cn = bc ? null : w.scene.getObjectByName(prop.name + '_contact_' + finger + (hs === 'l' ? '_l' : '')) ?? (hs === 'r' ? null : null)
              if (!(bc || cn) || !GRIPS[sc.kind]?.[hs]?.contacts.includes(finger)) continue
              const h = rig.parts.hands[hs]
              const j = finger === 'thumb' ? h.thumb[2]!.node : h.fingers[fi][2]!.node
              const tipv = finger === 'thumb' ? h.thumbTip! : h.tips[fi]!
              j.updateWorldMatrix(true, false)
              const d = tipv.clone().applyMatrix4(j.matrixWorld).distanceTo(bc ? prop.localToWorld(bc.p.clone()) : cn!.getWorldPosition(new Vector3()))
              worstTip = Math.max(worstTip, d)
              tips.push(hs + '.' + finger + ' ' + (d * 1000).toFixed(2))
            }
          }
        }
        if (!attached) prev = propOf()?.position.clone() ?? prev
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
      if (LOG) appendFileSync(LOG, 'props home ' + sc.name + ': held ' + heldFrames + ' frames, loose-away-from-home frames ' + loose + ', worst ' + (worst * 1000).toFixed(1) + ' mm, grip-to-grip at grasp ' + (grasp === null ? 'n/a' : (grasp * 1000).toFixed(1) + ' mm at ' + graspAt.toFixed(2) + ' s') + ', fingertip pads to contacts [' + tips.join(', ') + '] mm, prop jump at grasp ' + (jump * 1000).toFixed(2) + ' mm\n')
      expect(heldFrames, 'the prop was held').toBeGreaterThan(50)
      expect(loose, 'frames where a prop not in a hand was away from its home').toBe(0)
      // the hand reaches the prop: its grip frame is within 2 cm of the prop's grip for the palm grips, and within the solved fingertip offset otherwise
      expect(grasp).not.toBeNull()
      expect(grasp!, 'sanity: the hand is at the prop').toBeLessThan(0.07)
      expect(jump, sc.name + ' the prop does not jump to the hand').toBeLessThanOrEqual(JUMP)
      expectClean(sc.name, guard.stats, sc.kind)
      if (LOG) appendFileSync(LOG, 'props reach ' + sc.name + ': grasp jump ' + (guard.stats.graspJump * 1000).toFixed(2) + ' mm, release jump ' + (guard.stats.releaseJump * 1000).toFixed(2) + ' mm, reach at grasp ' + guard.stats.graspReach.toFixed(3) + ' m, at release ' + guard.stats.releaseReach.toFixed(3) + ' m, worst held ' + guard.stats.heldReach.toFixed(3) + ' m (limit ' + reachOf(sc.kind) + ')\n')
      if (PALM.has(sc.kind)) expect(grasp!, sc.name + ' hand grip on the prop grip').toBeLessThan(0.02)
      else {
        expect(tips.length, sc.name + ' contact fingers measured').toBeGreaterThan(0)
        expect(worstTip, sc.name + ' fingertip pads on their contacts').toBeLessThanOrEqual(sc.kind === 'book' ? 0.012 : 0.003) // the book's pads land anywhere on a 6 mm disc (fallback contacts)
      }
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
      const guard = new Guard(w)
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
        w.scene.updateMatrixWorld(true)
        guard.frame(t)
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
      expectClean(kind, guard.stats, kind === 'pingpong' ? 'paddle' : 'piece')
      if (LOG) appendFileSync(LOG, 'props reach ' + kind + ': grasps ' + guard.stats.grasps + ', grasp jump ' + (guard.stats.graspJump * 1000).toFixed(2) + ' mm, release jump ' + (guard.stats.releaseJump * 1000).toFixed(2) + ' mm, reach at grasp ' + guard.stats.graspReach.toFixed(3) + ' m, at release ' + guard.stats.releaseReach.toFixed(3) + ' m, worst held ' + guard.stats.heldReach.toFixed(3) + ' m\n')
      if (LOG) appendFileSync(LOG, 'props home ' + kind + ': held-prop frames ' + held + ', loose-away-from-home frames ' + loose + '\n')
    }, 60000)
  }
})
