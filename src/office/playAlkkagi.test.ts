/// <reference types="node" />
// #605 hologram alkkagi on the stage (PlayStage + holoBoard's alkkagi layer + alkkagiTimeline): the board shows the game, the mover's index tip
// meets the stone's back at the nail's frame, palm down, and the stone then moves; the same time gives the same stones and hand in two worlds.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { sessionTime, type PlaySession } from '../play/session'
import { ALK_HAND, alkkagiAt, resetAlkkagiCache } from '../play/alkkagiTimeline'
import { loadOffice, stubCanvas } from './glbLoad'
import { ALK_STONE_R } from './gripTargets'
import { STONE_Y as HOLO_STONE_Y } from './holoBoard'
import { PlayStage, type StageIn } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import type { Goal } from './director'

stubCanvas()
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

async function world() {
  const { scene, nodes } = await loadOffice()
  const props = new PropBank(scene, nodes)
  const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
  const stage = new PlayStage(scene, nodes, props)
  return { scene, nodes, props, rigs, stage }
}
type W = Awaited<ReturnType<typeof world>>

function seat(w: W, players: [string, string]) {
  const s: PlaySession = { kind: 'boardgame', spot: 'game_a', players, seed: 5151, startMs: 0, game: 'alkkagi' }
  const goals: Record<string, Goal> = {}
  players.forEach((id, i) => {
    const r = w.rigs[id]
    r.at = i === 0 ? 'game_a' : 'game_b'
    r.x = i === 0 ? -2.2 : -1
    r.z = 2.2
    r.heading = i === 0 ? -Math.PI / 2 : Math.PI / 2
    r.parts.root.position.set(r.x, 0, r.z)
    r.parts.root.rotation.set(0, r.heading, 0)
    r.parts.root.updateMatrixWorld(true)
    goals[id] = { spot: r.at, pose: 'boardgame', label: '알까기' }
  })
  for (const id of IDS) if (!goals[id]) goals[id] = { spot: 'work_0', pose: 'idle', label: '' }
  return { s, goals }
}
const inp = (w: W, goals: Record<string, Goal>, s: PlaySession, now: number, t: number): StageIn => ({
  now, t, dt: 0.04, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, forcedSessions: [s], camera: new Vector3(-1.9, 2.5, 4.5),
})
const tipWorld = (rig: AgentRig, out = new Vector3()) => {
  const h = rig.parts.hands.r
  const j = h.fingers[0][2]!.node
  j.updateWorldMatrix(true, false)
  return out.copy(h.tips[0]!).applyMatrix4(j.matrixWorld)
}
type Holo = { state: string; alkPos: (x: number, y: number) => Vector3 }
const holoOf = (w: W) => (w.stage as unknown as { holo: Holo }).holo

describe('hologram alkkagi on the stage (#605)', () => {
  it('the board comes on with the pair seated; the same office time gives the same hand in two worlds', async () => {
    resetAlkkagiCache()
    const a = await world()
    const b = await world()
    const sa = seat(a, ['agent_1', 'agent_3'])
    const sb = seat(b, ['agent_1', 'agent_3'])
    for (let k = 0; k < 300; k++) {
      const now = 15_000 + 20_000 + k * 40
      a.stage.update(inp(a, sa.goals, sa.s, now, k * 0.04))
      b.stage.update(inp(b, sb.goals, sb.s, now, k * 0.04))
    }
    expect(holoOf(a).state).toBe('on')
    for (const id of ['agent_1', 'agent_3']) expect(a.rigs[id].drive.r?.target?.elements.map((x) => +x.toFixed(6))).toEqual(b.rigs[id].drive.r?.target?.elements.map((x) => +x.toFixed(6)))
  }, 300_000)

  it("at the nail's frame the index tip is on the stone's back (3 mm), palm down; the stone then moves", async () => {
    resetAlkkagiCache()
    const w = await world()
    for (const players of [['agent_0', 'agent_1'], ['agent_2', 'agent_3']] as [string, string][]) {
      const { s, goals } = seat(w, players)
      let nails = 0
      let worst = 0
      let palmMax = -Infinity
      let moved = 0
      // 40 ms frames; the nail's frame is the first one at or after it
      let prevNail = -1
      for (let k = 0; k < 900; k++) {
        const now = 15_000 + 100 + k * 40
        w.stage.update(inp(w, goals, s, now, k * 0.04))
        const v = alkkagiAt(5151, players, sessionTime(s, now))
        const f = v.flick
        if (!f) continue
        const sinceNail = f.sinceMs - f.thinkMs - ALK_HAND.flick
        if (sinceNail >= 0 && sinceNail < 40 && prevNail !== v.turn) {
          prevNail = v.turn
          const rig = w.rigs[players[f.mover]]
          const d = rig.drive.r
          if (!d || d.w < 0.99) continue
          // where the stone was at the aim: its place before the motion (the hand stays there), its back opposite the flick
          const before = alkkagiAt(5151, players, sessionTime(s, now) - sinceNail - 1)
          const st = before.stones[f.flick.stone]
          const holo = holoOf(w)
          const c = holo.alkPos(st.x, st.y)
          const ahead = holo.alkPos(st.x + f.flick.dx / 1000, st.y + f.flick.dy / 1000)
          const dir = new Vector3(ahead.x - c.x, 0, ahead.z - c.z).normalize()
          const back = c.clone().addScaledVector(dir, -ALK_STONE_R)
          back.y += HOLO_STONE_Y + 0.0023
          worst = Math.max(worst, tipWorld(rig).distanceTo(back))
          palmMax = Math.max(palmMax, new Vector3(0, 0, 1).transformDirection(d.target!).y)
          nails++
          if (Math.hypot(v.stones[f.flick.stone].x - st.x, v.stones[f.flick.stone].y - st.y) > 0 || f.motionTotalMs > 0) moved++
        }
      }
      expect(nails, players.join('/') + ' flicks seen').toBeGreaterThan(3)
      expect(worst, players.join('/') + ' index tip on the stone\'s back (m)').toBeLessThan(0.003)
      expect(palmMax, players.join('/') + ' palm down').toBeLessThanOrEqual(-0.6)
      expect(moved).toBe(nails)
    }
  }, 300_000)
})
