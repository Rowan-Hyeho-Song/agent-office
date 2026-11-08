/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { SPOTS } from './navSpots.fixture'
import type { Goal } from './director'
import type { GripDemo } from './debugPlay'

stubCanvas()
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

describe('grip.demo', () => {
  for (const [prop, kind, obj, side, spot] of [['paddle', 'paddle', 'prop_paddle_a', 'r', 'pingpong_a'], ['stamp', 'stamp', 'prop_stamp', 'r', 'work_0'], ['book', 'book', 'prop_book', 'l', 'shelf']] as const) {
    it(prop + ': the object is attached to the hand through the hold part of the loop', async () => {
      const { scene, nodes } = await loadOffice()
      const props = new PropBank(scene, nodes)
      const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
      const stage = new PlayStage(scene, nodes, props)
      const rig = rigs.agent_0
      const sp = SPOTS.find((s) => s.id === spot)!
      rig.at = spot
      rig.x = sp.x
      rig.z = sp.z
      rig.heading = sp.ry
      rig.parts.root.position.set(sp.x, 0, sp.z)
      rig.parts.root.rotation.set(0, sp.ry, 0)
      rig.parts.root.updateMatrixWorld(true)
      const demo: GripDemo = { agent: 'agent_0', kind, obj, side, goal: { spot } }
      const goals = Object.fromEntries(IDS.map((id) => [id, id === 'agent_0' ? { spot, pose: 'idle', label: '' } : { spot: 'work_1', pose: 'idle', label: '' }])) as Record<string, Goal>
      let attached = 0
      for (let k = 0; k < 300; k++) {
        stage.update({ now: 0, t: k * 0.02, dt: 0.02, reduced: false, replaying: false, rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, gripDemo: demo })
        props.hold(new Map(Object.values(rigs).map((r) => [r, r.want])))
        props.update(0.02)
        if (rig.want?.attached) attached++
      }
      expect(attached, prop).toBeGreaterThan(80)
    })
  }
})
