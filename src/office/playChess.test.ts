/// <reference types="node" />
// #604 hologram chess on the stage (PlayStage + holoBoard's chess layer + chessTimeline): the board shows the game, the mover's hand takes the piece
// like a card (thumb and index on the glyph's back and front faces), palm down, from its own square; the same time gives the same board.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { sessionTime, type PlaySession } from '../play/session'
import { chessAt, resetChessCache } from '../play/chessTimeline'
import { KING, QUEEN } from '../play/chess'
import { loadOffice, stubCanvas } from './glbLoad'
import { CHESS_CARD_T, CHESS_TRIPOD_HALF } from './gripTargets'
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

/** a chess pair at the board (game_a, game_b as the omok tests seat them) */
function seat(w: W, players: [string, string]) {
  const s: PlaySession = { kind: 'boardgame', spot: 'game_a', players, seed: 4242, startMs: 0, game: 'chess' }
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
    goals[id] = { spot: r.at, pose: 'boardgame', label: '체스' }
  })
  for (const id of IDS) if (!goals[id]) goals[id] = { spot: 'work_0', pose: 'idle', label: '' }
  return { s, goals }
}
const inp = (w: W, goals: Record<string, Goal>, s: PlaySession, now: number, t: number, over: Partial<StageIn> = {}): StageIn => ({
  now, t, dt: 0.04, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, forcedSessions: [s], camera: new Vector3(-1.9, 2.5, 4.5), ...over,
})
const tipWorld = (rig: AgentRig, f: number | 'thumb', out = new Vector3()) => {
  const h = rig.parts.hands.r
  const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[f][2]!.node
  const tip = f === 'thumb' ? h.thumbTip! : h.tips[f]!
  j.updateWorldMatrix(true, false)
  return out.copy(tip).applyMatrix4(j.matrixWorld)
}
type Holo = { state: string; squarePos: (sq: number) => Vector3; chessLayer: unknown }
const holoOf = (w: W) => (w.stage as unknown as { holo: Holo }).holo

describe('hologram chess on the stage (#604)', () => {
  it('the board comes on with the pair seated; the same office time gives the same position in two worlds', async () => {
    resetChessCache()
    const a = await world()
    const b = await world()
    const sa = seat(a, ['agent_1', 'agent_2'])
    const sb = seat(b, ['agent_1', 'agent_2'])
    // 40 s into the session: catch up over frames
    for (let k = 0; k < 400; k++) {
      const now = 15_000 + 40_000 + k * 40
      a.stage.update(inp(a, sa.goals, sa.s, now, k * 0.04))
      b.stage.update(inp(b, sb.goals, sb.s, now, k * 0.04))
    }
    expect(holoOf(a).state).toBe('on')
    const va = chessAt(4242, ['agent_1', 'agent_2'], sessionTime(sa.s, 15_000 + 40_000 + 399 * 40))
    expect(va.phase).not.toBe('catching')
    const handA = a.rigs[va.move ? sa.s.players[va.move.mover] : 'agent_1'].drive.r?.target?.elements.map((x) => +x.toFixed(6))
    const handB = b.rigs[va.move ? sb.s.players[va.move.mover] : 'agent_1'].drive.r?.target?.elements.map((x) => +x.toFixed(6))
    expect(handA).toEqual(handB)
  }, 300_000)

  it('the hand takes the piece like a card: thumb and index on its back and front faces, 7.2 mm apart, palm down, from its own square', async () => {
    resetChessCache()
    const w = await world()
    for (const players of [['agent_0', 'agent_1'], ['agent_2', 'agent_3']] as [string, string][]) {
      const { s, goals } = seat(w, players)
      let held = 0
      let tripods = 0
      let worstGap = 0
      let palmMax = -Infinity
      let pickOff = 0
      let prevHeld: Record<string, boolean> = {}
      for (let k = 0; k < 700; k++) {
        const now = 15_000 + 100 + k * 40
        w.stage.update(inp(w, goals, s, now, k * 0.04))
        const v = chessAt(4242, players, sessionTime(s, now))
        if (!v.move) continue
        const id = players[v.move.mover]
        const rig = w.rigs[id]
        const d = rig.drive.r
        const since = v.move.sinceMs - v.move.thinkMs
        const isHeld = since >= 370 && since < 920 && !!d && d.w > 0.999
        if (isHeld) {
          held++
          const th = tipWorld(rig, 'thumb')
          const ix = tipWorld(rig, 0)
          // the king and the queen: three fingers, the index and the middle 1 cm each side of the middle of the front face
          const big = v.move.kind === KING || v.move.kind === QUEEN
          const want = big ? Math.hypot(CHESS_CARD_T, CHESS_TRIPOD_HALF) : CHESS_CARD_T
          worstGap = Math.max(worstGap, Math.abs(th.distanceTo(ix) - want))
          if (big) {
            tripods++
            worstGap = Math.max(worstGap, Math.abs(th.distanceTo(tipWorld(rig, 1)) - want), Math.abs(ix.distanceTo(tipWorld(rig, 1)) - 2 * CHESS_TRIPOD_HALF))
          }
          palmMax = Math.max(palmMax, new Vector3(0, 0, 1).transformDirection(d!.target!).y)
          // the pick frame: the pinch over the piece's own square
          if (!prevHeld[id]) {
            const mid = th.clone().add(ix).multiplyScalar(0.5)
            const sq = holoOf(w).squarePos(v.move.from)
            pickOff = Math.max(pickOff, Math.hypot(mid.x - sq.x, mid.z - sq.z))
          }
        }
        prevHeld = { ...prevHeld, [id]: isHeld }
      }
      expect(held, players.join('/') + ' held frames').toBeGreaterThan(10)
      void tripods
      expect(worstGap, players.join('/') + ' thumb–index gap = the glyph thickness (m)').toBeLessThan(0.003)
      expect(palmMax, players.join('/') + ' palm down').toBeLessThanOrEqual(-0.6)
      expect(pickOff, players.join('/') + ' taken over its own square (m)').toBeLessThan(0.02)
    }
  }, 300_000)
})
