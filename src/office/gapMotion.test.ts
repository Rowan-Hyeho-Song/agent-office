// #490 B (docs/design/play.md 9.2 · 9.3): the gaps' own motion, the ball bounced while waiting, the watcher's cheer; and, on the baked model, the
// stretch's hands over the head, palms up, and the head back.
import { Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { requestOf, type Goal } from './director'
import { BOUNCE, CHEER, GAP_MOTION, bounceAt, cheerAt, gapHead, gapPace, stretchLift } from './gapMotion'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'

const DEG = Math.PI / 180

describe('the gaps (play.md 9.3)', () => {
  it('기지개: the hands go up and down once over 1.2 s, after a moment; none with reduced motion', () => {
    const d = GAP_MOTION.stretchDelayS
    expect(stretchLift(0, false)).toBe(0)
    expect(stretchLift(d + GAP_MOTION.stretchS / 2, false)).toBeCloseTo(1, 6)
    expect(stretchLift(d + GAP_MOTION.stretchS + 0.01, false)).toBe(0)
    expect(stretchLift(20, false)).toBe(0)
    for (let u = 0; u < 3; u += 0.05) expect(stretchLift(u, true)).toBe(0)
    // the head goes back 6° at the top
    expect(gapHead('stretch', d + GAP_MOTION.stretchS / 2, false)!.pitch).toBeCloseTo(6 * DEG, 6)
  })

  it('창가: the head breathes 2° up and down, once every 4 s; still with reduced motion', () => {
    let lo = 0
    let hi = 0
    for (let u = 0; u < 8; u += 0.01) {
      const h = gapHead('window', u, false)!
      lo = Math.min(lo, h.pitch)
      hi = Math.max(hi, h.pitch)
      expect(h.yaw).toBe(0)
    }
    expect(hi).toBeCloseTo(2 * DEG, 4)
    expect(lo).toBeCloseTo(-2 * DEG, 4)
    expect(gapHead('window', 1, false)!.pitch).toBeCloseTo(gapHead('window', 5, false)!.pitch, 9)
    expect(gapHead('window', 1, true)).toBeNull()
  })

  it('서성이기: walked at 0.7 of the pace; on arrival one look left and one right, then the usual look round', () => {
    expect(gapPace('wander')).toBe(0.7)
    expect(gapPace('stretch')).toBe(1)
    expect(gapPace(undefined)).toBe(1)
    const req = (g: Goal['gap']) => requestOf({ spot: 'hall_a', pose: 'idle', label: '', gap: g }, 1).pace
    expect(req('wander')).toBeCloseTo(0.7, 9)
    expect(req('window')).toBe(1)
    const yaws = Array.from({ length: 300 }, (_, i) => gapHead('wander', (i / 300) * GAP_MOTION.wanderLookS, false)!.yaw!)
    expect(Math.max(...yaws)).toBeCloseTo(GAP_MOTION.wanderLookRad, 2)
    expect(Math.min(...yaws)).toBeCloseTo(-GAP_MOTION.wanderLookRad, 2)
    expect(gapHead('wander', GAP_MOTION.wanderLookS + 0.1, false)).toBeNull()
  })
})

describe('waiting and watching (play.md 9.2)', () => {
  it('공 튀기기: a bounce every 0.6 s, 25 cm high, a new number at each hit; held still with reduced motion', () => {
    expect(BOUNCE).toEqual({ everyS: 0.6, heightM: 0.25 })
    expect(bounceAt(0, false)).toEqual({ h: 0, n: 0 })
    expect(bounceAt(0.3, false).h).toBeCloseTo(0.25, 9)
    expect(bounceAt(0.59, false).n).toBe(0)
    expect(bounceAt(0.61, false).n).toBe(1)
    let top = 0
    for (let u = 0; u < 6; u += 0.01) top = Math.max(top, bounceAt(u, false).h)
    expect(top).toBeLessThanOrEqual(0.25 + 1e-9)
    expect(bounceAt(2, true)).toEqual({ h: 0, n: -1 })
  })

  it('구경: a cheer every 30 s, the first 10 s after arriving', () => {
    expect(CHEER.everyS).toBe(30)
    expect(cheerAt(5)).toBe(-1)
    expect(cheerAt(CHEER.firstS)).toBe(0)
    expect(cheerAt(CHEER.firstS + 29.9)).toBe(0)
    expect(cheerAt(CHEER.firstS + 30)).toBe(1)
  })
})

describe('the stretch on the model (play.md 9.3)', () => {
  it('at the top both hands are above the head; with reduced motion the hands stay down', async () => {
    const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
    ;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
    stubCanvas()
    const { scene, nodes } = await loadOffice()
    const top = async (reduced: boolean) => {
      const rig = new AgentRig('agent_2', 2, buildRig(scene, nodes, 2), '#ffffff')
      const spot = GRAPH.spots.coffee
      rig.x = spot.x
      rig.z = spot.z
      rig.heading = spot.ry
      const rigs = { agent_2: rig }
      let t = 0
      const DT = 1 / 60
      const step = (g: Goal) => {
        rig.setGoal(g, GRAPH)
        rig.update(DT, (t += DT), GRAPH, rigs, reduced)
        rig.applyDrive('l', t, reduced)
        rig.applyDrive('r', t, reduced)
      }
      // standing at the coffee machine, then the gap starts there
      for (let k = 0; k < 90; k++) step({ spot: 'coffee', pose: 'idle', label: '' })
      const t0 = t
      const g: Goal = { spot: 'coffee', pose: 'idle', gap: 'stretch', label: '쉬는 중 · 기지개' }
      let best = -Infinity
      while (t - t0 < GAP_MOTION.stretchDelayS + GAP_MOTION.stretchS + 0.5) {
        step(g)
        const head = rig.parts.head.getWorldPosition(new Vector3()).y
        const hands = (['l', 'r'] as const).map((s) => rig.parts.hands[s].node)
        const lift = Math.min(...hands.map((h) => h.getWorldPosition(new Vector3()).y)) - head
        best = Math.max(best, lift)
      }
      return best
    }
    const up = await top(false)
    expect(up, 'both hands over the head').toBeGreaterThan(0.1)
    const still = await top(true)
    expect(still, 'reduced motion: the hands stay down').toBeLessThan(-0.2)
  })
})

const cued = vi.hoisted(() => [] as { name: string; key?: string }[])
vi.mock('../audio/cues', async (orig) => ({ ...(await orig<typeof import('../audio/cues')>()), cue: (name: string, o?: { key?: string }) => void cued.push({ name, key: o?.key }) }))

describe('the bounce sound (play.md 9.2: the paddle click as it is)', () => {
  it('one pingpong.hit per new bounce; the first frame, a jump and reduced motion stay quiet', async () => {
    const { PlaySounds } = await import('../audio/playSounds')
    const s = new PlaySounds()
    const at = new Vector3()
    cued.length = 0
    for (let u = 0; u < 3.05; u += 1 / 60) {
      const b = bounceAt(u, false)
      s.paddleBounce('agent_3', b.n, `k${b.n}`, at)
    }
    // bounces 1 … 5 (0.6 s each over 3 s); the one already under way on the first frame is not heard
    expect(cued.map((c) => c.name)).toEqual(Array(5).fill('pingpong.hit'))
    cued.length = 0
    s.paddleBounce('agent_3', 9, 'k9', at) // a jump (a seek)
    s.paddleBounce('agent_3', -1, 'x', at) // reduced motion / not waiting any more
    s.paddleBounce('agent_3', 0, 'k0', at)
    expect(cued).toEqual([])
  })
})
