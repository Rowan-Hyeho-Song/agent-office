// #502: the white bowl's errand (#137 ①) walked through the planner with the real rigs, both ways: out to the corner for a record placed alone, and home
// again once nobody places one. Each time the body is at its stand when it lifts, the bowl is taken and set down within reach (0.75 m, water.ts REACH),
// and every prop stays clean. (The world tests used to run the stage without the Director's bowl rest: a put at the corner slid the bowl back home, and the
// errand home took it from 0.9 m.) #600: the hands never jump (letting the bowl go dropped the left hand 0.4 m in a frame; the run home began the frame the
// record ended, with a stone in the hand, and dropped it 0.35 m), and nobody else sits at the board while the bowl is carried.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BOWL_CORNER_STAND, BOWL_HOME_STAND } from './bowlRun'
import { Guard, IDS, Walk, expectCleanAll, world } from './errandWorld.fixture'
import { playAt } from './play'
import { REACH } from './water'

/** a moment just before somebody places a record alone (#490: its own stay), its stay short enough that the bowl goes home again within the walk */
function soloStart(): number {
  for (let t = Date.UTC(2026, 10, 9, 1, 0, 0); ; t += 5_000) {
    const p = Object.values(playAt(t, IDS)).find((x) => x.kind === 'boardgame_solo')
    if (p && p.until - t > 60_000 && p.until - t < 150_000) return t - 1000
  }
}

describe('the white bowl carried by a real rig (#502)', () => {
  it('out to the corner and home again: lifted at the stand, taken and set down within reach; every prop clean', async () => {
    const w = await world()
    const walk = new Walk(w, soloStart())
    const guard = new Guard(w)
    const bowl = w.scene.getObjectByName('prop_omok_bowl_w')!
    const lifts: { way: string; dStand: number; reach: number }[] = []
    let last = ''
    // #600 the largest step of either hand in one frame while the agent is on the errand (or was placing the record just before), and anyone else at the board
    const prev: Record<string, Vector3[]> = {}
    let jump = { d: 0, at: '' }
    const others: string[] = []
    for (let k = 0; k < 240 / 0.05 && lifts.length < 2; k++) {
      walk.step(0.05, guard)
      const runner = IDS.find((a) => walk.goals[a].pose === 'bowl')
      for (const a of IDS) {
        const g = walk.goals[a]
        const hands = (['l', 'r'] as const).map((s) => w.rigs[a].parts.hands[s].node.getWorldPosition(new Vector3()))
        if ((g.pose === 'bowl' || g.pose === 'boardgame') && prev[a] && walk.t > 1) {
          const d = Math.max(...hands.map((h, i) => h.distanceTo(prev[a][i])))
          if (d > jump.d) jump = { d, at: `${a} ${g.pose} ${g.bowl?.way ?? ''}/${g.bowl?.stage ?? ''} t=${walk.t.toFixed(2)}` }
        }
        prev[a] = hands
        if (runner && a !== runner && (g.spot === 'game_a' || g.spot === 'game_b')) others.push(`${a} ${g.spot} while ${runner} carries the bowl ${walk.goals[runner].bowl?.way}`)
        const b = walk.goals[a].bowl
        const key = b ? `${a}:${b.way}:${b.stage}` : ''
        if (b?.stage === 'lift' && key !== last) {
          const root = w.rigs[a].parts.root.position
          const stand = b.way === 'out' ? BOWL_HOME_STAND : BOWL_CORNER_STAND
          const at = bowl.getWorldPosition(new Vector3())
          lifts.push({ way: b.way, dStand: Math.hypot(root.x - stand.x, root.z - stand.z), reach: Math.hypot(at.x - root.x, at.z - root.z) })
        }
        if (key) last = key
      }
    }
    // let the second errand finish (put down at home)
    for (let k = 0; k < 20 / 0.05 && walk.director.bowlRest() !== 'home'; k++) walk.step(0.05, guard)
    expect(lifts.map((l) => l.way), 'out, then home').toEqual(['out', 'home'])
    for (const l of lifts) {
      expect(l.dStand, `${l.way}: at its stand`).toBeLessThan(0.1)
      expect(l.reach, `${l.way}: within reach`).toBeLessThanOrEqual(REACH)
    }
    expect(walk.director.bowlRest()).toBe('home')
    // a hand at 0.05 s steps: at most 0.25 m (5 m/s, the quickest reach of the lift); the first second is the walk setting the bodies down at their desks
    expect(jump.d, `the largest hand step: ${jump.at}`).toBeLessThanOrEqual(0.25)
    expect(others, 'nobody else at the board while the bowl is carried').toEqual([])
    expectCleanAll('bowl out and home', w, guard)
  }, 180_000)
})
