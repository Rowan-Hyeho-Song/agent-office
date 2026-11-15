// #370 A (desk-props.md 4, grips.md): when a hand touches a thing of its own desk, what the desk shows of it, and the hand on the baked model.
/// <reference types="node" />
import { appendFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DeskTouches, HABIT_PER_HOUR, NO_REPEAT_S, TOUCH_S, TURNTABLE_PUSH, calendarPage, habitTimes, hourglassAt, type TouchIn, type TouchKind } from './deskTouch'
import { deskProps, type DeskProps } from './props'
import { Walk, world } from './errandWorld.fixture'
import { contactNormal } from './gripTargets'
import { DeskLive } from './deskLive'
import type { AgentRig } from './rig'
import type { StatusMap } from './status'

const LOG = process.env.FIT_LOG
const NOW = Date.UTC(2026, 10, 16, 1, 0, 0)
const base = (over: Partial<DeskProps> = {}): DeskProps => ({
  ...deskProps({ status: {} as StatusMap, pending: 0, waitingSeats: [], decidedAt: null, handoffsToday: 0, now: NOW }),
  ...over,
})
const inp = (t: number, desk: DeskProps, o: Partial<TouchIn> = {}): TouchIn => ({ t, now: NOW + t * 1000, desk, seated: () => true, awake: () => true, working: () => false, ...o })

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
        expect(ts.length).toBe(HABIT_PER_HOUR[kind])
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
async function touchRun(kind: TouchKind, onFrame: (w: Awaited<ReturnType<typeof world>>, u: number) => void) {
  const w = await world()
  const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
  walk.status = Object.fromEntries(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'].map((id) => [id, { state: 'working' as const, activity: 'edit', since: 0 }]))
  const live = new DeskLive(w.nodes)
  const touches = new DeskTouches()
  const dt = 1 / 60
  const desk = base({ lamp: true })
  for (let k = 0; k < 360; k++) walk.step(dt)
  const t0 = walk.t
  touches.begin(kind, t0)
  while (walk.t < t0 + TOUCH_S[kind].len + 0.3) {
    walk.touches = touches.all(walk.t)
    live.update(touches.desk(desk), walk.t, dt, false, touches.shown(walk.t, false))
    w.scene.updateMatrixWorld(true)
    walk.step(dt)
    onFrame(w, walk.t - t0)
    touches.step({ t: walk.t, now: NOW, desk, seated: () => true, awake: () => true, working: () => true })
  }
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
    if (has) expect(worst, 'thumb and index on the pillars').toBeLessThan(0.01)
  }, 120_000)
})
