/// <reference types="node" />
// The hands at the keyboard (#225) against the baked model: the home row, the fitted presses, the keycap shader's arrays, the input events.
import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { AgentRig, buildRig } from './rig'
import { Typist } from './typist'
import { FINGERING, HOME, makeChunk, type KeyPress } from './typingSchedule'
import { onInput, type InputEvent } from './inputEvents'
import { GRIPS, handFor } from './grip'
import { handGripMatrix, offsetOf, resolveTarget } from './gripTargets'

stubCanvas()

const setup = async () => {
  const { scene, nodes } = await loadOffice()
  scene.updateMatrixWorld(true)
  const rigs = [0, 1, 2, 3, 4].map((i) => new AgentRig(`agent_${i}`, i, buildRig(scene, nodes, i), '#ffffff'))
  return { scene, nodes, rigs, ty: new Typist(nodes) }
}
const opts = (t: number, extra: object = {}) => ({ t, dt: 1 / 60, reduced: false, activity: 'edit', dilation: 1, still: false, leftOnly: false, hasMouse: true, ...extra })

/** where a finger's drawn tip is, world */
function tipWorld(rig: AgentRig, side: 'l' | 'r', finger: number, out = new Vector3()) {
  const h = rig.parts.hands[side]
  h.node.updateMatrixWorld(true)
  if (finger === 4) return out.copy(h.thumbTip!).applyMatrix4(h.thumb[2]!.node.matrixWorld)
  return out.copy(h.tips[finger]!).applyMatrix4(h.fingers[finger][2]!.node.matrixWorld)
}

/** step like the stage does: a frame each 1/60 s with the drive applied, from t0 to t1 */
function run(ty: Typist, rig: AgentRig, seat: number, t0: number, t1: number, extra: object = {}) {
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    rig.drive = { l: null, r: null }
    ty.step(rig, seat, opts(t, extra))
    rig.applyDrive('l', t, false)
    rig.applyDrive('r', t, false)
  }
}

describe('hands at the keyboard (against office.glb)', () => {
  it('all five desks have a keycap mesh with 87 keys and one press array; the material has the press shader', async () => {
    const { ty, nodes } = await setup()
    for (let i = 0; i < 5; i++) {
      const kb = ty.keyboard(i)!
      expect(kb, `kb_${i}`).toBeTruthy()
      expect(kb.byCode.size).toBe(87)
      expect(kb.press.length).toBe(87)
      expect(kb.travel).toBeCloseTo(0.0035, 6)
      const mat = (nodes[`kb_${i}_caps`] as unknown as { material: { onBeforeCompile: unknown } }).material
      expect(typeof mat.onBeforeCompile).toBe('function')
    }
  })

  it('the vertex shader lowers vertex _key by press[_key] x travel, one program for all keyboards', async () => {
    const { ty, nodes } = await setup()
    const mat = (nodes.kb_0_caps as unknown as { material: { onBeforeCompile: (s: unknown, r: unknown) => void; customProgramCacheKey: () => string } }).material
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>\nvoid main(){}' }
    mat.onBeforeCompile(shader, null)
    expect(shader.vertexShader).toContain('attribute float _key;')
    expect(shader.vertexShader).toContain('uniform float press[87];')
    expect(shader.vertexShader).toContain('transformed.y -= press[int(_key + 0.5)] * keyTravel;')
    expect(shader.uniforms.press.value).toBe(ty.keyboard(0)!.press)
    expect((shader.uniforms.keyTravel.value as number) as number).toBeCloseTo(0.0035, 6)
    expect(mat.customProgramCacheKey()).toBe('keycap-press')
  })

  it('at home every fingertip is about 1 cm over its home-row key, for all five agents and both hands', async () => {
    const { ty, rigs } = await setup()
    let n = 0
    for (const [i, rig] of rigs.entries()) {
      const s = ty.seatState(rig, i)!
      // a pause with no keys; the drive ramps in
      run(ty, rig, i, 100, 100.6, { activity: 'think' })
      for (const side of ['l', 'r'] as const)
        for (const f of [0, 1, 2, 3] as const) {
          const key = s.kb.top(HOME[side][f])!
          const tip = tipWorld(rig, side, f)
          const horiz = Math.hypot(tip.x - key.x, tip.z - key.z)
          const up = tip.y - key.y
          expect(horiz, `${i}${side}${f} lateral`).toBeLessThan(0.008)
          expect(up, `${i}${side}${f} height`).toBeGreaterThan(0.004)
          expect(up, `${i}${side}${f} height`).toBeLessThan(0.016)
          n++
        }
    }
    expect(n).toBe(40)
  })

  it('at a key press the finger is on that key (within 8 mm of its top), the keycap down', async () => {
    const { ty, rigs } = await setup()
    const errs: number[] = []
    for (const [i, rig] of rigs.entries()) {
      const c = makeChunk(rig.id, 4, 'edit', { mouse: i !== 2 })
      const picks = c.keys.filter((k) => !k.shortcut && k.code !== 'Space' && k.code !== 'Backspace' && k.code !== 'Enter').slice(0, 12)
      expect(picks.length).toBeGreaterThan(5)
      for (const k of picks) {
        run(ty, rig, i, k.t - 0.7, k.t + 0.02, { hasMouse: i !== 2 })
        const s = ty.seatState(rig, i)!
        const top = s.kb.top(k.code)!
        const tip = tipWorld(rig, k.hand, k.finger)
        const d = tip.distanceTo(top.clone().add(new Vector3(0, -0.003, 0)))
        errs.push(d)
        expect(d, `${rig.id} ${k.code} ${k.hand}${k.finger}`).toBeLessThan(0.009)
        expect(s.kb.press[s.kb.byCode.get(k.code)!.idx]).toBeGreaterThan(0.85)
      }
    }
    expect(errs.length).toBeGreaterThan(40)
    expect(errs.reduce((a, b) => a + b, 0) / errs.length).toBeLessThan(0.005)
    if (process.env.TYPIST_LOG) (await import('node:fs')).writeFileSync(process.env.TYPIST_LOG, `press tip error mean ${(1000 * errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)} mm, worst ${(1000 * Math.max(...errs)).toFixed(2)} mm over ${errs.length}
`)
  })

  it('the keycap press is half way at the event time, up before and after', async () => {
    const { ty, rigs } = await setup()
    const rig = rigs[3]
    const c = makeChunk(rig.id, 7, 'edit', { mouse: true })
    const k = c.keys.find((x) => !x.shortcut && x.code !== 'Space')!
    const idx = ty.seatState(rig, 3)!.kb.byCode.get(k.code)!.idx
    const at = (t: number) => {
      rig.drive = { l: null, r: null }
      ty.step(rig, 3, opts(t))
      return ty.keyboard(3)!.press[idx]
    }
    expect(at(k.t - 0.1)).toBe(0)
    expect(at(k.t)).toBeCloseTo(0.5, 1)
    expect(at(k.t + 0.03)).toBe(1)
    expect(at(k.t + k.hold + 0.2)).toBe(0)
  })

  it('sends key / keyUp / mouse events at the schedule times, in order, with a world position on the key, and nothing when still', async () => {
    const { ty, rigs, nodes } = await setup()
    const rig = rigs[0]
    const seen: InputEvent[] = []
    const off = onInput((e) => seen.push(e))
    const c = makeChunk(rig.id, 2, 'edit', { mouse: true })
    run(ty, rig, 0, c.t0 + 0.3, c.t1 - 0.1)
    off()
    const wantKeys = c.events.filter((e) => e.type !== 'mouse' && e.t > c.t0 + 0.3 + 1 / 60)
    const keysSeen = seen.filter((e) => e.type !== 'mouse') as Extract<InputEvent, { type: 'key' | 'keyUp' }>[]
    expect(keysSeen.length).toBeGreaterThan(20)
    expect(keysSeen.length).toBe(wantKeys.length)
    keysSeen.forEach((e, i) => {
      expect(e.t).toBeCloseTo(wantKeys[i].t, 6)
      expect(e.type).toBe(wantKeys[i].type)
      expect(e.agent).toBe('agent_0')
      expect(['char', 'space', 'enter', 'backspace', 'mod']).toContain(e.kind)
      {
        const top = ty.keyboard(0)!.top((e as { key?: string }).key!)!
        expect(e.pos.distanceTo(top)).toBeLessThan(1e-9)
        expect(e.pos).not.toBe(top)
      }
    })
    for (let i = 1; i < seen.length; i++) expect(seen[i].t).toBeGreaterThanOrEqual(seen[i - 1].t)
    const mouse = seen.filter((e) => e.type === 'mouse')
    expect(mouse.length).toBe(c.mouse.filter((m) => m.t > c.t0 + 0.3 + 1 / 60).length)
    for (const m of mouse) expect(m.pos.distanceTo(nodes.desk_0_mouse_l.getWorldPosition(new Vector3()))).toBeLessThan(0.08)
    // x16: still
    const seen2: InputEvent[] = []
    const off2 = onInput((e) => seen2.push(e))
    run(ty, rig, 0, c.t0 + 2, c.t0 + 6, { still: true })
    off2()
    expect(seen2.length).toBe(0)
  })

  it('a clock jump (a seek) sends nothing for the skipped time', async () => {
    const { ty, rigs } = await setup()
    const rig = rigs[1]
    const seen: InputEvent[] = []
    const off = onInput((e) => seen.push(e))
    run(ty, rig, 1, 50, 50.2)
    const before = seen.length
    rig.drive = { l: null, r: null }
    ty.step(rig, 1, opts(80))
    ty.step(rig, 1, opts(80.016))
    off()
    expect(seen.length).toBeGreaterThanOrEqual(before)
    // whatever came after the jump is from the new time, nothing from the 30 s in between
    expect(seen.slice(before).every((e) => e.t >= 80)).toBe(true)
  })

  it('with the tablet pen only the left hand types and right-hand keys send nothing; desk 2 has no mouse', async () => {
    const { ty, rigs } = await setup()
    const rig = rigs[2]
    const seen: InputEvent[] = []
    const off = onInput((e) => seen.push(e))
    const c = makeChunk(rig.id, 3, 'edit', { mouse: false })
    run(ty, rig, 2, c.t0 + 0.2, c.t1 - 0.2, { hasMouse: false, leftOnly: true })
    off()
    expect(seen.some((e) => e.type === 'mouse')).toBe(false)
    for (const e of seen) if (e.type !== 'mouse') expect(FINGERING[e.key!].hand).toBe('l')
    expect(seen.length).toBeGreaterThan(5)
  })

  it('the mouse: the buttons and the wheel are live nodes that move about their hinge, the index reaches the wheel top', async () => {
    const { ty, rigs, nodes, scene } = await setup()
    for (const i of [0, 1, 3, 4]) {
      const rig = rigs[i]
      const s = ty.seatState(rig, i)!
      expect(s.mouse, `desk ${i} mouse`).toBeTruthy()
      // the hand where the mouse grip puts it (the stage's own formula), then the index fitted onto the wheel
      const tgt = resolveTarget(scene, `desk_${i}_mouse`, 'mouse', 'r')!
      const target = handFor(new Matrix4(), tgt.pg, handGripMatrix(rig.parts.hands.r)).multiply(offsetOf(tgt.key, i))
      ty.fitWheel(rig, i, target, rig.curlVec('r', GRIPS.mouse.r!.hold))
      expect(s.wheelFit).toBeTruthy()
      expect(s.wheelErr, `desk ${i} wheel`).toBeLessThan(0.008)
      // a click and a notch in the schedule move the nodes
      const c = makeChunk(rig.id, 6, 'read', { mouse: true })
      const down = c.mouse.find((m) => m.kind === 'down')
      const notch = c.mouse.find((m) => m.kind === 'wheel')!
      if (down) {
        const rest = nodes[`desk_${i}_mouse_l`].quaternion.clone()
        run(ty, rig, i, down.t - 0.3, down.t + 0.04, { activity: 'read' })
        expect(nodes[`desk_${i}_mouse_l`].quaternion.angleTo(rest)).toBeGreaterThan(0.025)
        expect(nodes[`desk_${i}_mouse_l`].quaternion.angleTo(rest)).toBeLessThan(0.04) // 2 degrees
      }
      const restW = nodes[`desk_${i}_mouse_wheel`].quaternion.clone()
      run(ty, rig, i, notch.t - 0.3, notch.t + 0.3, { activity: 'read' })
      expect(nodes[`desk_${i}_mouse_wheel`].quaternion.angleTo(restW)).toBeGreaterThan(0.1)
    }
    // desk 2 has none
    expect(ty.seatState(rigs[2], 2)!.mouse).toBeNull()
  })

  it('reduced motion: the hand does not travel, the keys still press', async () => {
    const { ty, rigs } = await setup()
    const rig = rigs[4]
    const c = makeChunk(rig.id, 5, 'edit', { mouse: true })
    const k: KeyPress = c.keys.find((x) => x.hand === 'r' && !x.shortcut)!
    run(ty, rig, 4, k.t - 0.6, k.t - 0.3, { reduced: true })
    const hand = rig.parts.hands.r.node
    const a = hand.position.clone()
    run(ty, rig, 4, k.t - 0.3, k.t + 0.02, { reduced: true })
    expect(hand.position.distanceTo(a)).toBeLessThan(1e-4)
    expect(ty.keyboard(4)!.press.some((p) => p > 0.8)).toBe(true)
  })
})
