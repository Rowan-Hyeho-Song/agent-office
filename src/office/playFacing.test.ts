/// <reference types="node" />
// Facing and hands at the play spots (#333): every agent, at both omok seats and both ping-pong ends, stands square to the board / table while it
// plays (≤ 5° between its body's forward and the direction along the x axis to the other seat: the seats' designed facing is towards the board
// / table centre), and its playing hand is on the grip target: the go stone between the index and middle fingertips at their contacts, the
// paddle's index and thumb fingertips on its contacts. Headless on the baked model, driven by the real Director + TrafficPlanner as Agents.tsx
// runs them. Numbers go to FIT_LOG when set.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { sessionsAt, type PlaySession } from '../play/session'
import { stubCanvas } from './glbLoad'
import { IDS, Walk, world } from './errandWorld.fixture'
import { contactNormal } from './gripTargets'
import { STONE_DISC_R } from './grip'
import type { AgentRig } from './rig'

stubCanvas()
const LOG = process.env.FIT_LOG
const DEG = 180 / Math.PI
/** the body's forward against the seat's designed facing (deg) */
const MAX_DEG = 5
/** a fingertip on its stone / paddle contact (m): the same tolerance as playStage.test.ts */
const MAX_TIP_M = 0.003

function findSession(kind: 'pingpong' | 'boardgame', agent: string, side: 0 | 1): PlaySession {
  for (let m = 0; m < 20000; m++) {
    const s = sessionsAt(1_790_000_000_000 + m * 180_000, IDS).find((x) => x.kind === kind && x.players[side] === agent)
    if (s) return s
  }
  throw new Error(`no ${kind} session for ${agent} side ${side}`)
}

const tipWorld = (rig: AgentRig, f: number | 'thumb') => {
  const h = rig.parts.hands.r
  const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[f][2]!.node
  const tip = f === 'thumb' ? h.thumbTip! : h.tips[f]!
  j.updateWorldMatrix(true, false)
  return tip.clone().applyMatrix4(j.matrixWorld)
}
const toDisc = (tip: Vector3, c: Vector3, n: Vector3) => {
  const d = tip.clone().sub(c)
  const h = d.dot(n)
  return Math.hypot(h, Math.max(0, d.addScaledVector(n, -h).length() - STONE_DISC_R))
}

describe('facing and hands at the play spots', () => {
  for (const kind of ['boardgame', 'pingpong'] as const) {
    for (const agent of IDS) {
      for (const side of [0, 1] as const) {
        it(`${kind} ${agent} side ${side}: square to the ${kind === 'pingpong' ? 'table' : 'board'}, fingertips on the grip`, async () => {
          const s = findSession(kind, agent, side)
          const w = await world()
          const walk = new Walk(w, s.startMs + 1000)
          const rig = w.rigs[agent]
          let facing = 0
          let tipWorst = 0
          let n = 0
          let grips = 0
          for (let k = 0; k < 75 / 0.02; k++) {
            walk.step(0.02)
            if (rig.arrived !== s.spot && rig.arrived !== (kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b'])[side]) continue
            if (walk.t > 20 && k % 10 === 0) {
              const fwd = new Vector3(0, 0, -1).applyQuaternion(rig.parts.root.getWorldQuaternion(new Quaternion()))
              facing = Math.max(facing, fwd.angleTo(new Vector3(side === 0 ? 1 : -1, 0, 0)) * DEG)
              n++
            }
            const want = rig.want
            if (!want?.attached) continue
            if (kind === 'boardgame' && want.kind === 'piece') {
              const d = rig.drive.r
              if (!d || d.w < 0.999 || d.wc < 0.999 || (w.stage.lastPlace[agent]?.regrip ?? 0) < 1) continue
              const col = want.prefer!.endsWith('a') ? 'a' : 'b'
              for (const [f, finger] of [[0, 'index'], [1, 'middle']] as const) {
                const c = w.scene.getObjectByName(`prop_piece_${col}_contact_${finger}`)!
                tipWorst = Math.max(tipWorst, toDisc(tipWorld(rig, f), c.getWorldPosition(new Vector3()), contactNormal(w.scene, c)))
              }
              grips++
            } else if (kind === 'pingpong' && want.kind === 'paddle' && k % 5 === 0) {
              const pad = want.prefer?.endsWith('b') ? 'b' : 'a'
              for (const f of ['index', 'thumb'] as const) {
                const c = w.scene.getObjectByName(`prop_paddle_${pad}_contact_${f}`)
                if (!c) continue
                tipWorst = Math.max(tipWorst, tipWorld(rig, f === 'thumb' ? 'thumb' : 0).distanceTo(c.getWorldPosition(new Vector3())))
              }
              grips++
            }
          }
          if (LOG) appendFileSync(LOG, `facing ${kind} ${agent} side ${side}: ${n} samples, worst facing ${facing.toFixed(2)} deg, ${grips} grip frames, worst fingertip-to-contact ${(tipWorst * 1000).toFixed(2)} mm, stone mode ${(w.stage as unknown as { stoneModes: Map<string, string> }).stoneModes.get(agent) ?? '-'}\n`)
          expect(n, 'sampled while playing').toBeGreaterThan(5)
          expect(grips, 'the hand held the stone / paddle').toBeGreaterThan(3)
          expect(facing, 'body forward vs the seat facing (deg)').toBeLessThanOrEqual(MAX_DEG)
          expect(tipWorst, 'fingertip to its contact (m)').toBeLessThan(MAX_TIP_M)
        }, 120_000)
      }
    }
  }
})
