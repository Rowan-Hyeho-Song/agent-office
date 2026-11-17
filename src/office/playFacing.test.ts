/// <reference types="node" />
// Facing and hands at the play spots (#333): every agent, at both omok seats and both ping-pong ends, stands square to the board / table while it
// plays (≤ 5° between its body's forward and the direction along the x axis to the other seat: the seats' designed facing is towards the board
// / table centre), and its playing hand is on the grip target: the light stone (#538) pinched by the thumb and index tips on its rim, the
// paddle's index and thumb fingertips on its contacts. Headless on the baked model, driven by the real Director + TrafficPlanner as Agents.tsx
// runs them. Numbers go to FIT_LOG when set.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { sessionsAt, sessionTime, type PlaySession } from '../play/session'
import { gameAt } from '../play/omok'
import { pinchSequence } from '../play/holoPinch'
import { STONE_H, STONE_Y, type HoloBoard } from './holoBoard'
import { stubCanvas } from './glbLoad'
import { IDS, Walk, world } from './errandWorld.fixture'
import { HOLO_PINCH_R } from './gripTargets'
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
    const s = sessionsAt(1_790_000_000_000 + m * 180_000, IDS).find((x) => !x.solo && x.kind === kind && (kind !== 'boardgame' || x.game === 'omok') && x.players[side] === agent) // #604 the omok board (chess: playChess.test.ts) // a pair (a record placed alone has one player, #137)
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

/** the held light stone of the agent's move at the office time (as PlayStage.omokHands places it) and the rim points the thumb and index meet */
function heldStone(stage: { holo: HoloBoard }, s: PlaySession, rig: AgentRig, agent: string, now: number) {
  const mv = gameAt(s.seed, s.players, sessionTime(s, now), false).move
  if (!mv || s.players[mv.mover] !== agent) return null
  const p = pinchSequence(mv.sinceMs, mv.thinkMs)
  if (!p.held) return null
  const holo = stage.holo
  const at = rig.parts.root.position
  const fount = holo.fountPos(at)
  const target = holo.cellPos(mv.cell)
  const lift = STONE_Y + STONE_H / 2
  const centre = new Vector3(fount.x, target.y + lift, fount.z).lerp(new Vector3(target.x, target.y + lift, target.z), p.u)
  centre.y += p.h
  const mid = holo.cellPos(112)
  const fwd = new Vector3(mid.x - at.x, 0, mid.z - at.z).normalize()
  const side = new Vector3().crossVectors(new Vector3(0, 1, 0), fwd)
  return { thumb: centre.clone().addScaledVector(side, -HOLO_PINCH_R), index: centre.clone().addScaledVector(side, HOLO_PINCH_R) }
}

describe('facing and hands at the play spots', () => {
  for (const kind of ['boardgame', 'pingpong'] as const) {
    for (const agent of IDS) {
      for (const side of [0, 1] as const) {
        it(`${kind} ${agent} side ${side}: square to the ${kind === 'pingpong' ? 'table' : 'board'}, fingertips on the grip (the light stone's rim for omok)`, async () => {
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
            if (kind === 'boardgame') {
              const now = walk.t0 + (walk.t - 0.02) * 1000
              const hs = heldStone(w.stage as unknown as { holo: HoloBoard }, s, rig, agent, now)
              const d = rig.drive.r
              if (!hs || !w.stage.lastPlace[agent]?.held || !d || d.w < 0.999) continue
              tipWorst = Math.max(tipWorst, tipWorld(rig, 'thumb').distanceTo(hs.thumb), tipWorld(rig, 0).distanceTo(hs.index))
              grips++
              continue
            }
            const want = rig.want
            if (!want?.attached) continue
            if (kind === 'pingpong' && want.kind === 'paddle' && k % 5 === 0) {
              const pad = want.prefer?.endsWith('b') ? 'b' : 'a'
              for (const f of ['index', 'thumb'] as const) {
                const c = w.scene.getObjectByName(`prop_paddle_${pad}_contact_${f}`)
                if (!c) continue
                tipWorst = Math.max(tipWorst, tipWorld(rig, f === 'thumb' ? 'thumb' : 0).distanceTo(c.getWorldPosition(new Vector3())))
              }
              grips++
            }
          }
          if (LOG) appendFileSync(LOG, `facing ${kind} ${agent} side ${side}: ${n} samples, worst facing ${facing.toFixed(2)} deg, ${grips} grip frames, worst fingertip-to-contact ${(tipWorst * 1000).toFixed(2)} mm\n`)
          expect(n, 'sampled while playing').toBeGreaterThan(5)
          expect(grips, 'the hand held the stone / paddle').toBeGreaterThan(3)
          expect(facing, 'body forward vs the seat facing (deg)').toBeLessThanOrEqual(MAX_DEG)
          expect(tipWorst, 'fingertip to its contact (m)').toBeLessThan(MAX_TIP_M)
        }, 120_000)
      }
    }
  }
})
