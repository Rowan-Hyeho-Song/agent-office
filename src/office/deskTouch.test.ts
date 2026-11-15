// #370 A (desk-props.md 4, grips.md): when a hand touches a thing of its own desk, what the desk shows of it, and the hand on the baked model.
/// <reference types="node" />
import { appendFileSync } from 'node:fs'
import { Box3, Matrix4, Quaternion, Vector3, type Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { DUCK_BUBBLE, DUCK_LINES, DeskTouches, HABIT_PER_HOUR, KNOB_TURN, LEAF_STROKE, TOUCH_PROP, leafAt, NO_REPEAT_S, TOUCH_S, TURNTABLE_PUSH, calendarPage, habitTimes, hourglassAt, type TouchIn, type TouchKind } from './deskTouch'
import { deskProps, type DeskProps } from './props'
import { Guard, Walk, expectCleanAll, world } from './errandWorld.fixture'
import { contactNormal, handGripMatrix } from './gripTargets'
import { DeskLive } from './deskLive'
import { HELD_T, TrayPile } from './tray'
import { localBox } from './localBox'
import { STAMP_INK } from './playStage'
import { beatAt, tidyBeats, totalOf } from './wrap'
import type { AgentRig } from './rig'
import type { StatusMap } from './status'

const LOG = process.env.FIT_LOG
const NOW = Date.UTC(2026, 10, 16, 1, 0, 0)
const base = (over: Partial<DeskProps> = {}): DeskProps => ({
  ...deskProps({ status: {} as StatusMap, pending: 0, waitingSeats: [], decidedAt: null, handoffsToday: 0, now: NOW }),
  ...over,
})
const inp = (t: number, desk: DeskProps, o: Partial<TouchIn> = {}): TouchIn => ({ t, now: NOW + t * 1000, desk, seated: () => true, awake: () => true, working: () => false, ...o })

describe('the props taken from the desk (#370 B)', () => {
  it('루프 takes its duck at a failure, talks to it (a line of five, not the same twice running) only while it holds it before its face', () => {
    const d = new DeskTouches()
    const seen: string[] = []
    let t = 0
    for (let n = 0; n < 12; n++) {
      d.step(inp(t, base({ signal: 'yellow' })))
      d.step(inp((t += 0.1), base({ signal: 'red' })))
      expect(d.of(3, t)?.kind).toBe('duck')
      const t0 = t
      expect(d.bubble('agent_3')).toBeUndefined()
      d.step(inp(t0 + DUCK_BUBBLE.from + 0.1, base({ signal: 'red' })))
      const line = d.bubble('agent_3')!
      expect(DUCK_LINES).toContain(line)
      expect(line.length).toBeLessThanOrEqual(36)
      expect(d.bubble('agent_2')).toBeUndefined()
      d.step(inp(t0 + DUCK_BUBBLE.to + 0.05, base({ signal: 'red' })))
      expect(d.bubble('agent_3')).toBeUndefined()
      if (seen.length) expect(line).not.toBe(seen[seen.length - 1])
      seen.push(line)
      t = t0 + 10
    }
    expect(new Set(seen).size).toBeGreaterThan(2)
  })

  it('the keycap and the shape: 2 an hour while working, 3 while resting awake at the desk', () => {
    for (const [mode, n] of [['work', 2], ['rest', 3]] as const) {
      const d = new DeskTouches()
      let count = 0
      let prev: TouchKind | null = null
      const hour0 = Math.floor(NOW / 3_600_000) * 3_600_000
      for (let t = 0; t < 4 * 3600; t += 1) {
        d.step({ t, now: hour0 + t * 1000, desk: base(), seated: () => true, awake: () => true, working: () => mode === 'work' })
        const k = d.of(3, t)?.kind ?? null
        if (k === 'keycap' && prev !== 'keycap') count++
        prev = k
      }
      expect(count, mode).toBe(4 * n)
    }
  })
})

describe('when a desk thing is touched (#370 A)', () => {
  it('루프 taps the signal as it turns green while it sits at its desk; not when away', () => {
    const d = new DeskTouches()
    d.step(inp(0, base({ signal: 'yellow' })))
    d.step(inp(0.1, base({ signal: 'green' })))
    expect(d.of(3, 0.2)?.kind).toBe('signal')
    // gone after its length
    d.step(inp(0.1 + TOUCH_S.signal.len + 0.01, base({ signal: 'green' })))
    expect(d.of(3, 2)).toBe(null)
    const away = new DeskTouches()
    away.step(inp(0, base({ signal: 'yellow' }), { seated: () => false }))
    away.step(inp(0.1, base({ signal: 'green' }), { seated: () => false }))
    expect(away.of(3, 0.2)).toBe(null)
  })

  it('휴 presses the lamp switch as it comes in or goes off at its desk: the lamp changes at the press; away, at once', () => {
    const d = new DeskTouches()
    d.step(inp(0, base({ lamp: false })))
    d.step(inp(0.1, base({ lamp: true })))
    expect(d.of(2, 0.1)?.kind).toBe('lamp')
    expect(d.desk(base({ lamp: true })).lamp, 'not yet pressed').toBe(false)
    d.step(inp(0.1 + TOUCH_S.lamp.at, base({ lamp: true })))
    expect(d.desk(base({ lamp: true })).lamp).toBe(true)
    const away = new DeskTouches()
    away.step(inp(0, base({ lamp: true }), { seated: () => false }))
    away.step(inp(0.1, base({ lamp: false }), { seated: () => false }))
    expect(away.desk(base({ lamp: false })).lamp).toBe(false)
  })

  it('메모 turns the hourglass once as an approval starts waiting: half a turn when it is put down, kept after', () => {
    const d = new DeskTouches()
    d.step(inp(0, base({ hourglass: false })))
    d.step(inp(0.1, base({ hourglass: true })))
    expect(d.of(0, 0.1)?.kind).toBe('hourglass')
    expect(d.shown(0.1, false).hourglassTurn).toBe(0)
    for (let t = 0.1; t < 0.1 + TOUCH_S.hourglass.len + 0.2; t += 0.05) d.step(inp(t, base({ hourglass: true })))
    expect(d.shown(5, false).hourglassTurn).toBeCloseTo(Math.PI, 9)
    // waiting on: not again
    for (let t = 3; t < 20; t += 0.5) d.step(inp(t, base({ hourglass: true })))
    expect(d.shown(20, false).hourglassTurn).toBeCloseTo(Math.PI, 9)
    // lifted 5 cm between the lift and the set down, on the table before and after; turned only while lifted
    expect(hourglassAt(0.5, false).lift).toBe(0)
    expect(hourglassAt(1.15, false).lift).toBeCloseTo(0.05, 6)
    expect(hourglassAt(1.15, false).turn).toBeGreaterThan(0)
    expect(hourglassAt(2.0, false)).toEqual({ turn: 1, lift: 0 })
  })

  it('메모 turns the calendar page the first time it sits awake on a new day: the new day shows from the page let go', () => {
    const d = new DeskTouches()
    const day = (n: number) => base({ calendar: { year: 2026, month: 11, day: n, weekday: '월' } })
    d.step(inp(0, day(16)))
    d.step(inp(1, day(17), { awake: () => false }))
    expect(d.of(0, 1), 'asleep: not yet').toBe(null)
    expect(d.desk(day(17)).calendar.day).toBe(16)
    d.step(inp(2, day(17)))
    expect(d.of(0, 2)?.kind).toBe('calendar')
    d.step(inp(2 + TOUCH_S.calendar.at, day(17)))
    expect(d.desk(day(17)).calendar.day).toBe(17)
    // the page: hidden, lifted by the finger, over by itself, hidden again
    expect(calendarPage(0.3, false)).toBe(null)
    expect(calendarPage(0.8, false)!).toBeGreaterThan(0)
    expect(calendarPage(1.2, false)!).toBeGreaterThan(110)
    expect(calendarPage(1.6, false)).toBe(null)
    expect(calendarPage(0.8, true)).toBe(null)
  })

  it('메시 pushes the turntable 3 times an hour while it bakes and turns the knob once an hour while it works, never again within 2 minutes', () => {
    for (const kind of ['turntable', 'knob'] as const) {
      for (let h = 0; h < 50; h++) {
        const ts = habitTimes(kind, h)
        expect(ts.length).toBe(HABIT_PER_HOUR[kind]!.work)
        for (const x of ts) expect(Math.floor(x / 3_600_000)).toBe(h)
        for (let k = 1; k < ts.length; k++) expect(ts[k] - ts[k - 1]).toBeGreaterThanOrEqual(NO_REPEAT_S * 1000)
      }
    }
    // a day of baking: 3 an hour, as the clock crosses them
    const d = new DeskTouches()
    let n = 0
    let prev: TouchKind | null = null
    for (let t = 0; t < 3 * 3600; t += 1) {
      d.step({ t, now: Math.floor(NOW / 3_600_000) * 3_600_000 + t * 1000, desk: base({ turntable: true }), seated: () => true, awake: () => true, working: () => true })
      const k = d.of(1, t)?.kind ?? null
      if (k === 'turntable' && prev !== 'turntable') n++
      prev = k
    }
    expect(n).toBe(9)
    // the turntable's pushes and the knob's turns kept (90° each; the knob back and forth)
    const e = new DeskTouches()
    e.begin('turntable', 0)
    e.step(inp(TOUCH_S.turntable.len + 0.1, base()))
    expect(e.shown(5, false).turntablePush).toBeCloseTo((TURNTABLE_PUSH.deg * Math.PI) / 180, 9)
    e.begin('knob', 10)
    e.step(inp(10 + TOUCH_S.knob.len + 0.1, base()))
    const once = e.shown(20, false).knobTurn
    e.begin('knob', 30)
    e.step(inp(30 + TOUCH_S.knob.len + 0.1, base()))
    expect(once).toBeCloseTo((20 * Math.PI) / 180, 9)
    expect(e.shown(40, false).knobTurn).toBeCloseTo(0, 9)
  })
})

// ── on the baked model ──

const tipWorld = (rig: AgentRig, f: number | 'thumb') => {
  const h = rig.parts.hands.r
  const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[f][2]!.node
  const tip = f === 'thumb' ? h.thumbTip! : h.tips[f]!
  j.updateWorldMatrix(true, false)
  return tip.clone().applyMatrix4(j.matrixWorld)
}

/** everyone working at their desk; then `kind` begun and its whole length stepped, the desk drawn by DeskLive with the touch, as Agents.tsx does */
async function touchRun(kind: TouchKind, onFrame: (w: Awaited<ReturnType<typeof world>>, u: number) => void, withGuard = false, deskOver: Partial<DeskProps> = {}) {
  const w = await world()
  const guard = withGuard ? new Guard(w) : undefined
  const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
  walk.status = Object.fromEntries(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'].map((id) => [id, { state: 'working' as const, activity: 'edit', since: 0 }]))
  const live = new DeskLive(w.nodes)
  const touches = new DeskTouches()
  const dt = 1 / 60
  const desk = base({ lamp: true, ...deskOver })
  for (let k = 0; k < 360; k++) walk.step(dt)
  const t0 = walk.t
  touches.begin(kind, t0)
  while (walk.t < t0 + TOUCH_S[kind].len + 0.3) {
    walk.touches = touches.all(walk.t)
    live.update(touches.desk(desk), walk.t, dt, false, touches.shown(walk.t, false))
    w.scene.updateMatrixWorld(true)
    walk.step(dt, guard)
    onFrame(w, walk.t - t0)
    touches.step({ t: walk.t, now: NOW, desk, seated: () => true, awake: () => true, working: () => true })
  }
  if (guard) expectCleanAll(kind, w, guard)
  return w
}

describe('the hand on the desk thing (#370 A, grips.md)', () => {
  // the index fingertip on its contact while it presses / pushes / turns: within 1 cm of it, and never more than the press (+2 mm) into it
  const CASES: { kind: TouchKind; seat: number; contact: string; from: number; to: number; depth: number; rim?: boolean }[] = [
    { kind: 'signal', seat: 3, contact: 'desk_3_signal_contact_index', from: 0.5, to: 0.6, depth: 0 },
    { kind: 'lamp', seat: 2, contact: 'desk_2_lamp_switch_contact_index', from: 0.9, to: 1.02, depth: 0 },
    { kind: 'turntable', seat: 1, contact: 'desk_1_turntable_contact_index', from: 0.5, to: 0.62, depth: 0 },
    { kind: 'turntable', seat: 1, contact: 'desk_1_turntable_rim_contact_index', from: 1.3, to: 1.9, depth: 0, rim: true },
    { kind: 'knob', seat: 1, contact: 'desk_1_ringlight_knob_contact_index', from: 0.6, to: 1.1, depth: 0 },
    { kind: 'calendar', seat: 0, contact: 'desk_0_calendar_page_contact_index', from: 0.62, to: 0.95, depth: 0 },
  ]
  for (const c of CASES) {
    it(`${c.kind}${c.rim ? ' (the rim)' : ''}: the index on ${c.contact} within 1 cm, not into it`, async () => {
      let far = 0
      let deepest = 0
      let deepAt = 0
      let farAt = 0
      let frames = 0
      await touchRun(c.kind, (w, u) => {
        const rig = w.rigs[`agent_${c.seat}`]
        const node = w.scene.getObjectByName(c.contact)!
        let P = node.getWorldPosition(new Vector3())
        let n = contactNormal(w.scene, node)
        if (c.rim) {
          const tt = w.scene.getObjectByName('desk_1_turntable')!
          const pv = tt.userData.pivot_at as number[]
          const pivot = new Vector3(pv[0], pv[1], pv[2])
          const k = Math.min(1, Math.max(0, (u - TURNTABLE_PUSH.from) / TURNTABLE_PUSH.s))
          const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (k * k * (3 - 2 * k) * TURNTABLE_PUSH.deg * Math.PI) / 180)
          P = P.sub(pivot).applyQuaternion(q).add(pivot)
          n = n.applyQuaternion(q)
        }
        const tip = tipWorld(rig, 0)
        const d = tip.clone().sub(P)
        const into = -d.dot(n)
        // into it only where it is over it (within 1.5 cm across the normal): coming from the side is not into it
        const across = d.addScaledVector(n, into).length()
        if (u >= c.from && u <= c.to) {
          frames++
          if (tip.distanceTo(P) > far) farAt = u
          far = Math.max(far, tip.distanceTo(P))
        }
        if (u >= 0.3 && u <= TOUCH_S[c.kind].back && across < 0.015 && into > deepest) {
          deepest = into
          deepAt = u
        }
      })
      if (LOG) appendFileSync(LOG, `${c.kind}${c.rim ? ' rim' : ''}: far ${(far * 1000).toFixed(1)} mm, into ${(deepest * 1000).toFixed(1)} mm (u ${deepAt.toFixed(2)}, far at ${farAt.toFixed(2)})
`)
      expect(frames).toBeGreaterThan(3)
      expect(far, 'the fingertip from its contact').toBeLessThan(0.01)
      expect(deepest, 'into the thing').toBeLessThanOrEqual(c.depth + 0.002)
    }, 120_000)
  }

  it('the things move with the hand: the turntable 90° round, the knob 20°, the calendar page over and hidden after', async () => {
    let pageSeen = false
    const w = await touchRun('calendar', (w) => {
      if (w.scene.getObjectByName('desk_0_calendar_page')!.visible) pageSeen = true
    })
    expect(pageSeen).toBe(true)
    expect(w.scene.getObjectByName('desk_0_calendar_page')!.visible).toBe(false)
  }, 120_000)

  it('the hourglass: pinched at two pillars (thumb and index on their contacts), or no hand while the model has no such contacts', async () => {
    let worst = 0
    let has = false
    await touchRun('hourglass', (w, u) => {
      const thumb = w.scene.getObjectByName('desk_0_hourglass_contact_thumb')
      const index = w.scene.getObjectByName('desk_0_hourglass_contact_index')
      if (!thumb || !index) return
      has = true
      if (u < 0.8 || u > 1.6) return
      const rig = w.rigs.agent_0
      worst = Math.max(worst, tipWorld(rig, 0).distanceTo(index.getWorldPosition(new Vector3())), tipWorld(rig, 'thumb').distanceTo(thumb.getWorldPosition(new Vector3())))
    })
    if (has && LOG) appendFileSync(LOG, `hourglass: thumb / index ${(worst * 1000).toFixed(1)} mm off the pillars at most while lifted and turned
`)
    if (has) expect(worst, 'thumb and index on the pillars').toBeLessThan(0.006)
  }, 120_000)

  it('the ring light knob: pinched (thumb and index on their contacts) while it turns, the knob turned 20°', async () => {
    let worst = 0
    let frames = 0
    let turned = 0
    const w = await touchRun('knob', (w, u) => {
      const k = w.scene.getObjectByName('desk_1_ringlight_knob')!
      const r0 = (k.userData.liveRest as { q: Quaternion } | undefined)?.q
      if (r0) turned = Math.max(turned, k.quaternion.angleTo(r0))
      const thumb = w.scene.getObjectByName('desk_1_ringlight_knob_contact_thumb')
      const index = w.scene.getObjectByName('desk_1_ringlight_knob_contact_index')
      if (!thumb || !index || u < KNOB_TURN.from || u > KNOB_TURN.from + KNOB_TURN.s) return
      frames++
      const rig = w.rigs.agent_1
      worst = Math.max(worst, tipWorld(rig, 0).distanceTo(index.getWorldPosition(new Vector3())), tipWorld(rig, 'thumb').distanceTo(thumb.getWorldPosition(new Vector3())))
    })
    void w
    if (LOG) appendFileSync(LOG, `ring light knob: thumb / index ${(worst * 1000).toFixed(1)} mm off its contacts while turning, turned ${((turned * 180) / Math.PI).toFixed(1)}°
`)
    expect(frames).toBeGreaterThan(5)
    expect(worst, 'thumb and index on the knob').toBeLessThan(0.006)
    expect((turned * 180) / Math.PI).toBeCloseTo(20, 0)
  }, 120_000)
})

describe('the prop in the hand (#370 B, grips.md)', () => {
  for (const kind of ['duck', 'keycap', 'shape'] as const) {
    it(`${kind}: taken from where it rests, held off the desk, its contacts under the fingertips, put back exactly where it rested`, async () => {
      const name = TOUCH_PROP[kind]!
      let homePos: Vector3 | null = null
      let farthest = 0
      let worst = 0
      let under = Infinity
      const w = await touchRun(
        kind,
        (w, u) => {
          const node = w.scene.getObjectByName(name)!
          const p = node.getWorldPosition(new Vector3())
          homePos ??= p.clone()
          farthest = Math.max(farthest, p.distanceTo(homePos))
          const rig = w.rigs[`agent_${kind === 'shape' ? 1 : 3}`]
          // held: each contact under its fingertip
          if (u > 1.4 && u < TOUCH_S[kind].back - 0.6) {
            for (const [f, c] of [[0, 'index'], ['thumb', 'thumb']] as const) {
              const cn = w.scene.getObjectByName(`${name}_contact_${c}`)
              if (cn) worst = Math.max(worst, tipWorld(rig, f).distanceTo(cn.getWorldPosition(new Vector3())))
            }
            if (kind === 'shape') {
              // the gap from the open left hand to the bottom of the shape, over the shape's footprint (the hand's vertices under it)
              const shape = new Box3().setFromObject(node)
              let top = -Infinity
              rig.parts.hands.l.node.updateMatrixWorld(true)
              rig.parts.hands.l.node.traverseVisible((m) => {
                const g = (m as Mesh).geometry?.getAttribute('position')
                if (!(m as Mesh).isMesh || !g) return
                const v = new Vector3()
                for (let k = 0; k < g.count; k++) {
                  v.fromBufferAttribute(g, k).applyMatrix4(m.matrixWorld)
                  if (v.x >= shape.min.x && v.x <= shape.max.x && v.z >= shape.min.z && v.z <= shape.max.z) top = Math.max(top, v.y)
                }
              })
              if (top > -Infinity) under = Math.min(under, shape.min.y - top)
            }
          }
        },
        true,
      )
      const end = w.scene.getObjectByName(name)!.getWorldPosition(new Vector3())
      if (LOG) appendFileSync(LOG, `${kind}: lifted ${(farthest * 100).toFixed(1)} cm, fingertips ${(worst * 1000).toFixed(1)} mm off their contacts, back ${(end.distanceTo(homePos!) * 1000).toFixed(2)} mm from its rest${kind === 'shape' ? `, the left hand ${(under * 1000).toFixed(1)} mm under it` : ''}
`)
      expect(farthest, 'lifted off the desk').toBeGreaterThan(0.12)
      expect(worst, 'fingertips on the contacts').toBeLessThan(0.012)
      expect(end.distanceTo(homePos!), 'back where it rested').toBeLessThan(0.001)
      if (kind === 'shape') {
        expect(under, 'the left hand not into the shape, about 1 cm under it').toBeGreaterThanOrEqual(0.005)
        expect(under, 'the left hand just under it').toBeLessThan(0.015)
      }
    }, 120_000)
  }
})

describe('the swatch fan (#370 B2, grips.md 색견본 부채)', () => {
  it('the left hand on the stand, the fan spread twice its rest and closed again, the right index on the chip it points at, not into it', async () => {
    let leftFar = 0
    let far = 0
    let into = 0
    let spreadMax = 0
    let rest0 = 0
    const w = await touchRun('swatch', (w, u) => {
      const rig = w.rigs.agent_2
      const gl = w.scene.getObjectByName('desk_2_swatch_grip_l')!
      const c3 = w.scene.getObjectByName('desk_2_swatch_leaf_3')!
      const c0 = w.scene.getObjectByName('desk_2_swatch_leaf_0')!
      const a = new Vector3(0, 1, 0).transformDirection(c0.matrixWorld).angleTo(new Vector3(0, 1, 0).transformDirection(c3.matrixWorld))
      if (u < 0.1) rest0 = a
      spreadMax = Math.max(spreadMax, a)
      // the hand's own grip point (its grip frame) on the stand's
      const hl = rig.parts.hands.l
      hl.node.updateWorldMatrix(true, false)
      const g = new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(hl.node.matrixWorld, handGripMatrix(hl)))
      if (u > 0.8 && u < 2.8) leftFar = Math.max(leftFar, g.distanceTo(gl.getWorldPosition(new Vector3())))
      if (u > 1.6 && u < 2.6) {
        const c = w.scene.getObjectByName('desk_2_swatch_leaf_1')!
        const tip = w.scene.getObjectByName('desk_2_swatch_leaf_1_tip')!
        const up = new Vector3(0, 1, 0).transformDirection(c.matrixWorld)
        const n = new Vector3(0, 0, 1).transformDirection(c.matrixWorld)
        if (n.dot(rig.parts.root.position.clone().sub(c.getWorldPosition(new Vector3()))) < 0) n.negate()
        const P = tip.getWorldPosition(new Vector3()).addScaledVector(up, -0.025)
        const t = tipWorld(rig, 0)
        far = Math.max(far, t.distanceTo(P))
        into = Math.max(into, -t.clone().sub(P).dot(n))
      }
    })
    const c0 = w.scene.getObjectByName('desk_2_swatch_leaf_0')!
    const c3 = w.scene.getObjectByName('desk_2_swatch_leaf_3')!
    const after = new Vector3(0, 1, 0).transformDirection(c0.matrixWorld).angleTo(new Vector3(0, 1, 0).transformDirection(c3.matrixWorld))
    if (LOG) appendFileSync(LOG, `swatch: fan ${((rest0 * 180) / Math.PI).toFixed(0)}° → ${((spreadMax * 180) / Math.PI).toFixed(0)}° → ${((after * 180) / Math.PI).toFixed(0)}°, left hand ${(leftFar * 1000).toFixed(1)} mm from the stand's grip, index ${(far * 1000).toFixed(1)} mm from the chip, ${(into * 1000).toFixed(1)} mm into it\n`)
    expect(spreadMax / rest0, 'spread to about twice').toBeGreaterThan(1.8)
    expect(Math.abs(after - rest0), 'closed again').toBeLessThan(0.01)
    expect(leftFar, 'the left hand on the stand').toBeLessThan(0.01)
    expect(far, 'the index on the chip').toBeLessThan(0.01)
    expect(into, 'not into it').toBeLessThanOrEqual(0.002)
  }, 120_000)
})

describe('the top sheet of the IN pile read (#370 B3, grips.md 서류 한 장 집기 · 낱장 옆 쥐고 읽기)', () => {
  it('pinched at its corner, read held by both long sides (thumbs on the face, the fingers behind), laid back squared; the pile keeps its count', async () => {
    let lift = 0
    let moved = 0
    let restY = 0
    const restP = new Vector3()
    let corner = 0
    let sides = 0
    let through = -Infinity
    const tipOf = (rig: AgentRig, side: 'l' | 'r', f: number | 'thumb') => {
      const h = rig.parts.hands[side]
      const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[f][2]!.node
      j.updateWorldMatrix(true, false)
      return (f === 'thumb' ? h.thumbTip! : h.tips[f]!).clone().applyMatrix4(j.matrixWorld)
    }
    const w = await touchRun(
      'paper',
      (w, u) => {
        const rig = w.rigs.agent_0
        const top = w.scene.getObjectByName('desk_0_in_top')!
        const c = top.getWorldPosition(new Vector3())
        if (u < 0.3) {
          restY = c.y
          restP.copy(c)
        }
        lift = Math.max(lift, c.y - restY)
        moved = Math.max(moved, c.distanceTo(restP))
        const at = (name: string) => w.scene.getObjectByName(name)!.getWorldPosition(new Vector3())
        // the corner pinched as it is taken
        if (u > 0.62 && u < 0.78) for (const [f, n] of [[0, 'index'], ['thumb', 'thumb']] as const) corner = Math.max(corner, tipOf(rig, 'r', f).distanceTo(at(`desk_0_in_top_contact_${n}`)))
        if (u > 1.3 && u < 3.3) {
          for (const side of ['l', 'r'] as const)
            for (const [f, n] of [[0, 'index'], ['thumb', 'thumb']] as const) sides = Math.max(sides, tipOf(rig, side, f).distanceTo(at(`desk_0_in_top_grip_side_${side}_contact_${n}`)))
          // no finger through the sheet: the four fingers are behind it (the thumbs and the palm blocks are on its face side, beside the edge), so over
          // its footprint no vertex of a finger is in front of its back face
          const inv = top.matrixWorld.clone().invert()
          const box = top.userData.sheetBox as { min: number[]; max: number[] }
          const v = new Vector3()
          for (const side of ['l', 'r'] as const)
            rig.parts.hands[side].node.traverseVisible((m) => {
              const g = (m as Mesh).geometry?.getAttribute('position')
              if (!(m as Mesh).isMesh || !g || !/_f\d/.test(m.name)) return
              for (let k = 0; k < g.count; k++) {
                v.fromBufferAttribute(g, k).applyMatrix4(m.matrixWorld)
                const q = v.clone().applyMatrix4(inv)
                if (q.x < box.min[0] + 0.005 || q.x > box.max[0] - 0.005 || q.z < box.min[2] || q.z > box.max[2]) continue
                // in the sheet's own frame y is stretched by its drawn thinness: back to metres along its normal
                const n = new Vector3(0, 1, 0).transformDirection(top.matrixWorld)
                through = Math.max(through, v.clone().sub(c).dot(n))
              }
            })
        }
      },
      true,
      { inbox: 3 },
    )
    const pile = TrayPile.of(w.scene.getObjectByName('desk_0_in'))!
    const end = new Vector3().setFromMatrixPosition(w.scene.getObjectByName('desk_0_in_top')!.matrixWorld)
    const squared = new Vector3().setFromMatrixPosition(pile.topRest(true))
    if (LOG) appendFileSync(LOG, `paper: lifted ${(lift * 100).toFixed(1)} cm (moved ${(moved * 100).toFixed(1)} cm), the corner pinch ${(corner * 1000).toFixed(1)} mm, both sides ${(sides * 1000).toFixed(1)} mm off their contacts, fingers at most ${(through * 1000).toFixed(1)} mm over the sheet's back (the sheet is ${HELD_T * 1000} mm), back ${(end.distanceTo(squared) * 1000).toFixed(2)} mm from its squared rest
`)
    expect(lift, 'lifted off the pile').toBeGreaterThan(0.08)
    expect(moved, 'brought to the reader').toBeGreaterThan(0.15)
    expect(corner, 'the corner pinched').toBeLessThan(0.006)
    expect(sides, 'thumbs and indexes on the long sides').toBeLessThan(0.006)
    // the sheet in a hand is HELD_T thick: a finger pad on its back (grips.md: within 1 mm) comes no further than 1 mm past its face
    expect(through, 'no finger through the sheet').toBeLessThanOrEqual(HELD_T + 0.001)
    expect(end.distanceTo(squared), 'laid back squared').toBeLessThan(0.001)
  }, 120_000)
})

describe('the IN pile squared at the tidy-up (#370 B3b, desk-props.md 4)', () => {
  /** the planner's tidy-up beats (wrap.ts) played at its desk, the desk drawn as Agents.tsx does; `inbox` sheets in its IN pile */
  async function tidyRun(inbox: number, onFrame: (w: Awaited<ReturnType<typeof world>>, kind: string, u: number) => void) {
    const w = await world()
    const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
    walk.status = Object.fromEntries(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'].map((id) => [id, { state: 'working' as const, activity: 'edit', since: 0 }]))
    walk.inbox = inbox
    const live = new DeskLive(w.nodes)
    const desk = base({ inbox })
    const dt = 1 / 60
    const step = () => {
      live.update(desk, walk.t, dt, false)
      w.scene.updateMatrixWorld(true)
      walk.step(dt)
    }
    for (let k = 0; k < 360; k++) step()
    const beats = tidyBeats(0)
    let beat: Record<string, unknown> | null = null
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      return beat ? { ...g, agent_0: { spot: 'work_0', pose: 'tidy', label: '', wrapStep: 'tidy', beat } } : g
    }) as typeof walk.director.goals
    const total = totalOf(beats)
    for (let t = 0; t <= total + 0.3; t += dt) {
      const at = beatAt(beats, Math.min(t, total))
      beat = { ...at.beat, u: t > total ? 1 : at.u }
      step()
      onFrame(w, at.beat.kind, at.u)
    }
    beat = null
    for (let k = 0; k < 30; k++) step()
    return w
  }

  it('both palms on its sides, stood up on its near edge and tapped down twice, set back exactly where it rests', async () => {
    let stood = 0
    let into = 0
    const gap = { l: Infinity, r: Infinity }
    let restP: Vector3 | null = null
    let restQ: Quaternion | null = null
    const w = await tidyRun(3, (w, kind) => {
      const node = w.scene.getObjectByName('desk_0_in')!
      const p = new Vector3()
      const q = new Quaternion()
      node.matrixWorld.decompose(p, q, new Vector3())
      if (!restP) {
        restP = p.clone()
        restQ = q.clone()
      }
      stood = Math.max(stood, new Vector3(0, 1, 0).applyQuaternion(q).angleTo(new Vector3(0, 1, 0)))
      if (kind !== 'tap') return
      // no hand vertex inside the pile's box (its frame without the sheet stretch)
      const pile = TrayPile.of(node)!
      const size = pile.pileSize
      const inv = new Matrix4().compose(p, q, new Vector3(1, 1, 1)).invert()
      const v = new Vector3()
      for (const side of ['l', 'r'] as const)
        w.rigs.agent_0.parts.hands[side].node.traverseVisible((m) => {
          const g = (m as Mesh).geometry?.getAttribute('position')
          if (!(m as Mesh).isMesh || !g) return
          for (let k = 0; k < g.count; k++) {
            v.fromBufferAttribute(g, k).applyMatrix4(m.matrixWorld).applyMatrix4(inv)
            const d = Math.min(v.x - size.min.x, size.max.x - v.x, v.z - size.min.z, size.max.z - v.z, v.y, size.height - v.y)
            if (d > 0) into = Math.max(into, d)
            // the palm on its side: the nearest vertex beside it (within its length and height)
            if (v.z > size.min.z && v.z < size.max.z && v.y > 0 && v.y < size.height) {
              const off = side === 'l' ? size.min.x - v.x : v.x - size.max.x
              if (off >= 0) gap[side] = Math.min(gap[side], off)
            }
          }
        })
    })
    const node = w.scene.getObjectByName('desk_0_in')!
    const p = new Vector3()
    const q = new Quaternion()
    node.matrixWorld.decompose(p, q, new Vector3())
    if (LOG) appendFileSync(LOG, `pile tidy: stood ${((stood * 180) / Math.PI).toFixed(0)}°, hands ${(into * 1000).toFixed(1)} mm into the pile at most, palms ${(gap.l * 1000).toFixed(1)} / ${(gap.r * 1000).toFixed(1)} mm off its sides, back ${(p.distanceTo(restP!) * 1000).toFixed(2)} mm / ${((q.angleTo(restQ!) * 180) / Math.PI).toFixed(2)}° from its rest
`)
    expect((stood * 180) / Math.PI, 'stood up').toBeGreaterThan(60)
    expect(into, 'no hand into the pile').toBeLessThanOrEqual(0.002)
    expect(Math.max(gap.l, gap.r), 'the palms on its sides').toBeLessThan(0.006)
    expect(p.distanceTo(restP!), 'set back').toBeLessThan(1e-4)
    expect(q.angleTo(restQ!), 'set back straight').toBeLessThan(1e-4)
  }, 120_000)

  it('an empty IN pile is not squared (the tidy-up as before)', async () => {
    let moved = 0
    let rest: Vector3 | null = null
    await tidyRun(0, (w) => {
      const p = w.scene.getObjectByName('desk_0_in')!.getWorldPosition(new Vector3())
      rest ??= p.clone()
      moved = Math.max(moved, p.distanceTo(rest))
    })
    expect(moved).toBe(0)
  }, 120_000)
})

describe('the succulent leaf stroked (#370 C3)', () => {
  it('the index fingertip along the leaf from its start to its end, twice, riding it down as it gives (6°); the leaf back after', async () => {
    let far = 0
    let frames = 0
    let sway = 0
    const w = await touchRun('leaf', (w, u) => {
      const lf = w.scene.getObjectByName('succulent_leaf')!
      const r0 = (lf.userData.liveRest as { q: Quaternion }).q
      sway = Math.max(sway, (lf.quaternion.angleTo(r0) * 180) / Math.PI)
      const L = leafAt(u, false)
      if (L.k < 0.1 || L.k > 0.9) return
      frames++
      const a = w.scene.getObjectByName('succulent_leaf_touch_0')!.getWorldPosition(new Vector3())
      const b = w.scene.getObjectByName('succulent_leaf_touch_1')!.getWorldPosition(new Vector3())
      const P = a.lerp(b, L.k)
      const pv = lf.userData.pivot_at as number[]
      const pivot = new Vector3(pv[0], pv[1], pv[2])
      P.sub(pivot).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).transformDirection(lf.matrixWorld), (L.sway * Math.PI) / 180)).add(pivot)
      far = Math.max(far, tipWorld(w.rigs.agent_2, 0).distanceTo(P))
    })
    const lf = w.scene.getObjectByName('succulent_leaf')!
    const back = (lf.quaternion.angleTo((lf.userData.liveRest as { q: Quaternion }).q) * 180) / Math.PI
    if (LOG) appendFileSync(LOG, `leaf: the fingertip ${(far * 1000).toFixed(1)} mm off the stroke at most, the leaf gave ${sway.toFixed(1)}°, ${back.toFixed(2)}° after
`)
    expect(frames).toBeGreaterThan(20)
    expect(far, 'on the leaf').toBeLessThan(0.006)
    expect(sway).toBeGreaterThan(5)
    expect(sway).toBeLessThanOrEqual(LEAF_STROKE.deg + 0.01)
    expect(back).toBeLessThan(0.01)
  }, 120_000)
})

describe('the stamp inked on the pad (#370 C3, desk-props.md 4)', () => {
  it('dabbed twice on the felt (its face 2 mm into it, inside the pad), then pressed where it rests and back there; the stamp heard once', async () => {
    const w = await world()
    const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
    walk.status = Object.fromEntries(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'].map((id) => [id, { state: 'working' as const, activity: 'edit', since: 0 }]))
    const dt = 1 / 60
    for (let k = 0; k < 360; k++) walk.step(dt)
    const stamp = w.scene.getObjectByName('prop_stamp')!
    const pad = w.scene.getObjectByName('desk_0_inkpad')!
    const padP = pad.getWorldPosition(new Vector3())
    const homeP = stamp.getWorldPosition(new Vector3())
    const faceY = localBox(stamp).min.y
    let deepest = 0
    let off = 0
    walk.stamp = true
    const t0 = walk.t
    while (walk.t - t0 < 2) {
      walk.step(dt)
      const s = walk.t - t0
      if (s < STAMP_INK.dabs[0] || s > STAMP_INK.dabs[1]) continue
      const face = stamp.localToWorld(new Vector3(0, faceY, 0))
      deepest = Math.max(deepest, padP.y - face.y)
      off = Math.max(off, Math.hypot(face.x - padP.x, face.z - padP.z))
    }
    walk.stamp = false
    for (let k = 0; k < 90; k++) walk.step(dt)
    const end = stamp.getWorldPosition(new Vector3()).distanceTo(homeP)
    if (LOG) appendFileSync(LOG, `stamp: its face ${(deepest * 1000).toFixed(1)} mm into the felt at the deepest, ${(off * 1000).toFixed(1)} mm from the pad's middle at most, back ${(end * 1000).toFixed(2)} mm from its rest
`)
    expect(deepest, 'into the felt by its press').toBeCloseTo(Number(pad.userData.press) || 0.002, 3)
    expect(off, 'on the pad').toBeLessThan(Number(pad.userData.dab_r) || 0.026)
    expect(end, 'back where it rests').toBeLessThan(0.001)
  }, 120_000)
})
