// #370 D (desk-props.md 7): what a pressed desk thing says, and the owner's gesture; the press boxes on the baked model; the owner's head
// turned to the thing for a second (and the nod when resting).
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { PROP_PRESS, PROPS, gestureFor, pickNearest, propLabel, secondLine, type PropId, type PropNow } from './propPressRules'
import { propTargets, SPEAKER_BOX } from './propPressRules'
import { AgentRig, PROP_LOOK, buildRig } from './rig'

stubCanvas()
const base: PropNow = { desk: { signal: 'off', turntable: false, ringlight: 'off', lamp: false }, pending: 0, speaker: 'on', music: 'work', private: () => false }
const w = (over: Partial<PropNow> = {}): PropNow => ({ ...base, ...over, desk: { ...base.desk, ...over.desk } })

describe('the tag (7.1)', () => {
  it('eight things, first lines within 24 characters', () => {
    expect(PROPS.map((p) => p.id).sort()).toEqual(['duck', 'hourglass', 'lamp', 'mixer', 'ringlight', 'signal', 'speaker', 'turntable'])
    for (const p of PROPS) expect([...p.first].length).toBeLessThanOrEqual(24)
  })
  it('the second line is what each shows now', () => {
    const line = (id: PropId, o: Partial<PropNow> = {}) => secondLine(id, w(o))
    expect(['green', 'red', 'yellow', 'off'].map((signal) => line('signal', { desk: { signal } as PropNow['desk'] }))).toEqual(['통과', '실패', '도는 중', '아직 없음'])
    expect(line('duck', { desk: { signal: 'red' } as PropNow['desk'] })).toBe('최근에 말을 걸었어요')
    expect(line('duck', { desk: { signal: 'green' } as PropNow['desk'] })).toBeNull()
    expect(line('hourglass', { pending: 3 })).toBe('결재 대기 3건')
    expect(line('hourglass')).toBe('기다리는 결재 없음')
    expect(line('turntable', { desk: { turntable: true } as PropNow['desk'] })).toBe('굽는 중')
    expect(line('turntable')).toBe('멈춤')
    expect(['on', 'blink', 'off'].map((ringlight) => line('ringlight', { desk: { ringlight } as PropNow['desk'] }))).toEqual(['켜짐', '켜짐', '꺼짐'])
    expect(line('lamp', { desk: { lamp: true } as PropNow['desk'] })).toBe('켜짐')
    expect(line('lamp')).toBe('꺼짐')
    expect((['on', 'off', 'muted'] as const).map((speaker) => line('speaker', { speaker }))).toEqual(['켜짐', '나에게만 꺼짐', '소리가 꺼져 있어요'])
    expect((['break', 'work', 'off'] as const).map((music) => line('mixer', { music }))).toEqual(['쉬는 시간 음악', '일할 때 음악', '꺼짐'])
  })
  it('a seat on private work says 비공개 for its things (not for the speaker: that line is the visitor own switch)', () => {
    const o = w({ private: (seat) => seat === 4 || seat === 3, desk: { signal: 'red' } as PropNow['desk'] })
    expect(secondLine('signal', o)).toBe('비공개')
    expect(secondLine('duck', o)).toBe('비공개')
    expect(secondLine('mixer', o)).toBe('비공개')
    expect(secondLine('speaker', o)).toBe('켜짐')
    expect(secondLine('lamp', o)).toBe('꺼짐')
  })
  it('the button reads both lines', () => {
    expect(propLabel('hourglass', w({ pending: 2 }))).toBe('모래시계 · 결재를 기다리는 동안 흐릅니다. 결재 대기 2건')
    expect(propLabel('duck', w())).toBe('고무 오리 · 루프가 막히면 말을 겁니다')
  })
})

describe('the gesture (7.4)', () => {
  const at = { atDesk: true, working: false, busy: false }
  it('resting: look and nod; working: the head alone; away, dozing, tidying, meeting: none', () => {
    expect(gestureFor(at, false, Infinity)).toBe('lookNod')
    expect(gestureFor({ ...at, working: true }, false, Infinity)).toBe('look')
    expect(gestureFor({ ...at, atDesk: false }, false, Infinity)).toBeNull()
    expect(gestureFor({ ...at, busy: true }, false, Infinity)).toBeNull()
  })
  it('again within 2 s, or reduced motion: the tag only', () => {
    expect(gestureFor(at, false, PROP_PRESS.againMs - 1)).toBeNull()
    expect(gestureFor(at, false, PROP_PRESS.againMs)).toBe('lookNod')
    expect(gestureFor(at, true, Infinity)).toBeNull()
  })
})

describe('the press', () => {
  it('close together, the nearest middle wins (a 44 px finger box takes in its neighbours)', () => {
    const lamp = { left: 108, top: 295, right: 152, bottom: 339 }
    const signal = { left: 122, top: 304, right: 166, bottom: 348 }
    const boxes: [PropId, typeof lamp][] = [['signal', signal], ['lamp', lamp]]
    expect(pickNearest(boxes, 130, 317)).toBe('lamp')
    expect(pickNearest(boxes, 145, 326)).toBe('signal')
    expect(pickNearest(boxes, 20, 20)).toBeNull()
  })
})

describe('on the baked model', () => {
  it('every thing has its press box around it; 1.5 times on touch', async () => {
    const { nodes } = await loadOffice()
    const t = propTargets(nodes, false)
    expect([...t.keys()].sort()).toEqual(PROPS.map((p) => p.id).sort())
    expect(t.get('speaker')!.length).toBe(2)
    const hg = t.get('hourglass')![0]
    expect(hg.position.distanceTo(nodes.desk_0_hourglass.getWorldPosition(new Vector3()))).toBeLessThan(0.02)
    for (const [, ms] of t) for (const m of ms) expect(m.scale.x).toBe(1)
    const touch = propTargets(nodes, true)
    for (const [, ms] of touch) for (const m of ms) expect(m.scale.x).toBe(PROP_PRESS.touchScale)
    expect(SPEAKER_BOX).toEqual([0.12, 0.2, 0.14])
  })

  it('the owner turns its head to the thing for a second, nods once when resting, then looks back', async () => {
    const { scene, nodes } = await loadOffice()
    const run = async (pose: string, nod: boolean, press = true) => {
      const rig = new AgentRig('agent_2', 2, buildRig(scene, nodes, 2), '#ffffff')
      const goal = { spot: 'work_2', pose, label: '' } as Goal
      const DT = 1 / 60
      let t = 0
      const step = (s: number) => {
        for (let k = 0; k < s / DT; k++) {
          rig.setGoal(goal, GRAPH)
          rig.update(DT, (t += DT), GRAPH, { agent_2: rig }, false)
        }
      }
      step(6)
      const fwd = () => rig.parts.head.getWorldDirection(new Vector3()).setY(0).normalize()
      const before = fwd()
      // a point beside the desk: 60 degrees to the agent's right
      const h = rig.heading
      const side = new Vector3(rig.x - Math.sin(h - Math.PI / 3) * 0.6, 0.85, rig.z - Math.cos(h - Math.PI / 3) * 0.6)
      if (press) rig.propLook = { at: side, nod, t0: null }
      step(PROP_LOOK.nodAt + 0.1)
      const turned = (before.angleTo(fwd()) * 180) / Math.PI
      const nodding = (rig as unknown as { nod: unknown }).nod !== null
      step(PROP_LOOK.s)
      const gone = rig.propLook === null
      step(2)
      return { turned, nodding, gone, end: fwd() }
    }
    const rest = await run('idle', true)
    expect(rest.turned).toBeGreaterThan(20)
    expect(rest.nodding).toBe(true)
    expect(rest.gone).toBe(true)
    // looked back: as the same agent that was never pressed (the idle head sways by itself)
    const still = await run('idle', true, false)
    expect((rest.end.angleTo(still.end) * 180) / Math.PI).toBeLessThan(2)
    expect(still.turned).toBeLessThan(rest.turned - 15)
    const work = await run('type', false)
    expect(work.turned).toBeGreaterThan(20)
    expect(work.nodding).toBe(false)
  }, 120000)
})
