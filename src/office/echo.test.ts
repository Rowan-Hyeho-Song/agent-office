/// <reference types="node" />
// Echo (agent_4, seat 4, #193 2/2): the fifth agent's rig, the colour and name tables, and the live bits of its body and desk
// (tuning fork, grille light, speaker cones, faders, level meter). The sound comes from echoLive.ts, replaced here by a fixed value.
import { Color, MeshBasicMaterial, Vector3, type Mesh, type Object3D } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AgentRig, buildRig } from './rig'
import { EchoDesk } from './deskLive'
import { AGENTS, AGENT_COLORS, AGENT_INFO } from './world'
import { loadOffice, stubCanvas } from './glbLoad'
import type { RoomSound } from './echoLive'

const sound: { now: RoomSound } = { now: { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] } }
vi.mock('./echoLive', () => ({ roomSound: () => sound.now, musicGlow: () => (sound.now.audible ? 0.3 * sound.now.level : 0), setSpeakerNodes: () => {} }))
stubCanvas()

const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
type Role = { updateRole(dt: number, t: number, s: undefined, r: boolean): void; glowBase: Map<Mesh, Color> }
const role = (rig: AgentRig) => rig as unknown as Role

describe('the five agents', () => {
  it('AGENTS, names and colours: seat 4 is 에코 ECHO, 사운드, #f2ffc4 (the same colour as --agent-4)', () => {
    expect(AGENTS).toEqual(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'])
    expect(AGENT_INFO.agent_4).toEqual({ name: '에코 ECHO', role: '사운드', color: '#f2ffc4' })
    expect(AGENT_COLORS.agent_4).toBe('#f2ffc4')
    expect(tokens).toMatch(/--agent-4:\s*#f2ffc4/)
    for (const a of AGENTS) expect(AGENT_INFO[a], a).toBeTruthy()
    expect(new Set(AGENTS.map((a) => AGENT_INFO[a].color)).size).toBe(5)
  })
})

describe('echo in the model', async () => {
  const { scene, nodes } = await loadOffice()
  const rigs = [0, 1, 2, 3, 4].map((i) => buildRig(scene, nodes, i))

  it('agent_4 is in the scene (not hidden) with a head, two hands and the role parts under the head', () => {
    const r = rigs[4]
    expect(scene.getObjectByName('agent_4')).toBe(r.root)
    expect(r.head.parent).toBe(r.root)
    expect(r.fork?.parent).toBe(r.head)
    expect(r.grille?.parent).toBe(r.head)
    expect(r.face?.parent).toBe(r.head)
    expect(r.hands.l.node).toBeTruthy()
    expect(r.hands.r.fingers.flat().filter(Boolean)).toHaveLength(12)
    // the other four have none of echo's parts
    for (const k of [0, 1, 2, 3]) {
      expect(rigs[k].fork).toBeUndefined()
      expect(rigs[k].grille).toBeUndefined()
    }
  })

  it('resting: true only for a play goal (also while walking there); work, talk, meeting, doze are not', () => {
    const rig = new AgentRig('agent_4', 4, rigs[4], '#f2ffc4')
    const set = (pose: string | null) => ((rig as unknown as { goal: unknown }).goal = pose ? { pose, spot: 'x' } : null)
    expect(rig.resting).toBe(false)
    for (const p of ['pingpong', 'boardgame', 'coffee', 'sofa', 'water', 'books']) {
      set(p)
      expect(rig.resting, p).toBe(true)
    }
    for (const p of ['idle', 'type', 'talk', 'listen', 'doze', 'leave', 'post']) {
      set(p)
      expect(rig.resting, p).toBe(false)
    }
  })

  it('the fork rings about its local x by at most 0.6 degrees while there is sound, and stops with it', () => {
    sound.now = { on: true, audible: true, level: 1, faders: [1, 1, 1, 1] }
    const rig = new AgentRig('agent_4', 4, rigs[4], '#f2ffc4')
    const fork = rigs[4].fork!
    let max = 0
    for (let k = 0; k < 200; k++) {
      role(rig).updateRole(1 / 60, k / 60, undefined, false)
      max = Math.max(max, Math.abs(fork.rotation.x))
    }
    expect(max).toBeGreaterThan(0.004)
    expect(max).toBeLessThanOrEqual((0.6 * Math.PI) / 180 + 1e-9)
    sound.now = { on: true, audible: false, level: 0, faders: [1, 1, 1, 1] }
    for (let k = 0; k < 60; k++) role(rig).updateRole(1 / 60, 4 + k / 60, undefined, false)
    expect(Math.abs(fork.rotation.x)).toBe(0)
    // reduced motion: no ringing at all
    sound.now = { on: true, audible: true, level: 1, faders: [1, 1, 1, 1] }
    for (let k = 0; k < 30; k++) role(rig).updateRole(1 / 60, 8 + k / 60, undefined, true)
    expect(Math.abs(fork.rotation.x)).toBe(0)
  })

  it('the grille ring breathes 0.35..0.6 of full without sound and follows the loudness 0.4..1 with it', () => {
    const rig = new AgentRig('agent_4', 4, rigs[4], '#f2ffc4')
    let mesh: Mesh | undefined
    rigs[4].grille!.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh
    })
    const bright = () => (mesh!.material as MeshBasicMaterial).color.g
    const base = role(rig).glowBase.get(mesh!)!.g
    const step = (t: number) => role(rig).updateRole(1 / 60, t, undefined, false)
    sound.now = { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] }
    const seen: number[] = []
    for (let k = 0; k < 480; k++) {
      step(k / 60)
      seen.push(bright() / base)
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.35 - 1e-6)
    expect(Math.max(...seen)).toBeLessThanOrEqual(0.6 + 1e-6)
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.2)
    sound.now = { on: true, audible: true, level: 0, faders: [1, 1, 1, 1] }
    step(10)
    expect(bright() / base).toBeCloseTo(0.4)
    sound.now = { on: true, audible: true, level: 1, faders: [1, 1, 1, 1] }
    step(10.02)
    expect(bright() / base).toBeCloseTo(1)
  })

  describe('the desk: cones, faders, knobs, LED, level meter', () => {
    let desks: EchoDesk
    const rest = new Map<string, Vector3>()
    const at = (n: string) => nodes[n] as Object3D
    const cells = () =>
      [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => {
        const m = nodes[`desk_4_meter_${k}`] as Mesh
        return (m.material as MeshBasicMaterial).color.g > (m.userData.baseColor as Color).g * 0.5
      }).length
    const moved = (n: string) => at(n).position.distanceTo(rest.get(n)!)
    beforeEach(() => {
      desks = new EchoDesk((n) => nodes[n])
      for (const n of ['desk_4_spk_l', 'desk_4_fader_0', 'desk_4_fader_3']) if (!rest.has(n)) rest.set(n, at(n).position.clone())
    })

    it('the model has every node the desk needs', () => {
      const names = ['desk_4_spk_l', 'desk_4_spk_r', 'desk_4_spk_led', 'screen_work_4']
      for (let k = 0; k < 4; k++) names.push(`desk_4_knob_${k}`, `desk_4_fader_${k}`)
      for (let k = 0; k < 8; k++) names.push(`desk_4_meter_${k}`)
      for (const n of names) expect(nodes[n], n).toBeTruthy()
    })

    it('cones travel the extras travel (3 mm) with the loudness and faders slide their travel (45 mm) with the volumes; both rest at silence', () => {
      sound.now = { on: true, audible: true, level: 1, faders: [1, 0.5, 0, 1] }
      desks.update(false, 1, 1 / 60, false)
      expect(moved('desk_4_spk_l')).toBeCloseTo(at('desk_4_spk_l').userData.travel, 6)
      expect(moved('desk_4_fader_0')).toBeCloseTo(0.045, 6)
      expect(moved('desk_4_fader_3')).toBeCloseTo(0.045, 6)
      sound.now = { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] }
      desks.update(false, 2, 1 / 60, false)
      expect(moved('desk_4_spk_l')).toBeCloseTo(0, 9)
      expect(moved('desk_4_fader_0')).toBeCloseTo(0, 9)
      // reduced motion: the cones stay
      sound.now = { on: true, audible: true, level: 1, faders: [1, 1, 1, 1] }
      desks.update(false, 3, 1 / 60, true)
      expect(moved('desk_4_spk_l')).toBeCloseTo(0, 9)
    })

    it('the level meter is dark when nothing works and nothing is heard, shows the sound when audible, and moves while echo works', () => {
      sound.now = { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] }
      desks.update(false, 3, 1 / 60, false)
      expect(cells()).toBe(0)
      sound.now = { on: true, audible: true, level: 0.75, faders: [1, 1, 1, 1] }
      desks.update(false, 4, 1 / 60, false)
      expect(cells()).toBe(6)
      sound.now = { on: false, audible: false, level: 0, faders: [0, 0, 0, 0] }
      const seen = new Set<number>()
      for (let k = 0; k < 400; k++) {
        desks.update(true, 5 + k / 20, 1 / 60, false)
        seen.add(cells())
      }
      expect(seen.size).toBeGreaterThan(1)
      expect(Math.max(...seen)).toBeLessThanOrEqual(5)
    })
  })
})
