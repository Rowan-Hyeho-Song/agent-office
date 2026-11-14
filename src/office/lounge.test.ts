/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { Box3, Raycaster, Vector3, type Mesh } from 'three'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRIP_S } from './grip'
import { meshesOf } from './nodes'
import { rasterFootprint } from './floorMask'
import { buildGrid, cellAt, decodeFootprint, findPath } from './grid'
import { FOOTPRINT_DATA } from './footprint.data'
import { GRAPH } from './navSpots.fixture'
import { REACH } from './water'
import { PLAYS } from './play'
import { ACT_PLACE, DISPENSER, DISPENSER_T, DRINK_KINDS, DRINK_PROP_KINDS, DRINKS, FRIDGE, FRIDGE_LIGHT, FRIDGE_T, RECORD, RECORD_T, actTotal, doorDeg, fridgeLightOn, fridgeStepK, grabAt, inSwept, openTimeAt, recordBeats, sweptDistance } from './lounge'
import { LEVER_T, MAT, leverAngle, onMat } from './loungeActs'
import { frameOfNode, linkOf, FRAME_LINKS } from './framePosters'

stubCanvas()

describe('the fridge door sweeps a known area (lounge.ts)', () => {
  it('the swing is a disc sector of the door width round the south hinge, from closed (north) to 100° (west and a little south)', () => {
    // on the closed door and at its free end
    expect(sweptDistance(FRIDGE.hinge.x, FRIDGE.hinge.z - 0.2)).toBe(0)
    expect(sweptDistance(FRIDGE.hinge.x, FRIDGE.hinge.z - FRIDGE.width)).toBeCloseTo(0, 6)
    // the door open to the room: a point west of the hinge at the door's length is on it
    expect(sweptDistance(FRIDGE.hinge.x - FRIDGE.width, FRIDGE.hinge.z)).toBeLessThan(0.01)
    // inside the sector, beyond the door's length: the distance is how far past its free end
    expect(sweptDistance(FRIDGE.hinge.x - 0.6, FRIDGE.hinge.z - 0.3)).toBeCloseTo(Math.hypot(0.6, 0.3) - FRIDGE.width, 6)
    // behind the hinge (east, the fridge body) is not swept
    expect(inSwept(FRIDGE.hinge.x + 0.2, FRIDGE.hinge.z - 0.2)).toBe(false)
  })

  it('the fridge stand is 0.5 m off the swept area, and the closed handle is within an arm of it (water.ts REACH)', async () => {
    expect(sweptDistance(FRIDGE.stand.x, FRIDGE.stand.z)).toBeGreaterThanOrEqual(FRIDGE.offM)
    const { scene } = await loadOffice()
    scene.updateMatrixWorld(true)
    // the model's door: its hinge and its width are the numbers lounge.ts has; the handle is within an arm of the stand
    const door = scene.getObjectByName('fridge_door')!
    const pivot = door.userData.pivot_at as number[]
    expect(pivot[0]).toBeCloseTo(FRIDGE.hinge.x, 3)
    expect(pivot[2]).toBeCloseTo(FRIDGE.hinge.z, 3)
    const open = door.userData.open as { axis: string; sign: number; deg: number; open_s: number; close_s: number }
    expect(open).toMatchObject({ axis: 'y', sign: 1, deg: FRIDGE.openDeg, open_s: FRIDGE.openS, close_s: FRIDGE.closeS })
    const handle = scene.getObjectByName('fridge_door_grip')!.getWorldPosition(new Vector3())
    expect(Math.hypot(handle.x - FRIDGE.stand.x, handle.z - FRIDGE.stand.z)).toBeLessThanOrEqual(REACH)
    // the door's free end, opened by 100° about the hinge, lies inside the swept area (the sector's radius is the door's width)
    const w = new Vector3(FRIDGE.hinge.x, 0, FRIDGE.hinge.z - FRIDGE.width)
    const a = (FRIDGE.openDeg * Math.PI) / 180
    const dx = w.x - FRIDGE.hinge.x
    const dz = w.z - FRIDGE.hinge.z
    const end = { x: FRIDGE.hinge.x + dx * Math.cos(a) + dz * Math.sin(a), z: FRIDGE.hinge.z - dx * Math.sin(a) + dz * Math.cos(a) }
    expect(sweptDistance(end.x, end.z)).toBeLessThan(1e-6)
  })

  it('the door angle: 0 closed, 100° open for the hold, back to 0, smooth the whole way', () => {
    expect(doorDeg(0)).toBe(0)
    expect(doorDeg(FRIDGE_T.open + FRIDGE.openS)).toBeCloseTo(FRIDGE.openDeg, 6)
    expect(doorDeg(FRIDGE_T.peek + 0.5)).toBeCloseTo(FRIDGE.openDeg, 6)
    expect(doorDeg(FRIDGE_T.shut)).toBeCloseTo(0, 6)
    expect(doorDeg(FRIDGE_T.total)).toBe(0)
    let prev = 0
    for (let u = 0; u <= FRIDGE_T.total; u += 0.01) {
      const d = doorDeg(u)
      expect(Math.abs(d - prev), 'at ' + u.toFixed(2)).toBeLessThan(4)
      prev = d
    }
    expect(doorDeg(openTimeAt(FRIDGE_T.letGoDeg))).toBeCloseTo(FRIDGE_T.letGoDeg, 2)
    // opening takes openS and closing closeS (extras open_s / close_s)
    expect(FRIDGE_T.shut - FRIDGE_T.close).toBeCloseTo(FRIDGE.closeS, 6)
  })
})

describe('#457 taking a drink out (lounge-props.md 5.3 · 5.5)', () => {
  it('the beats in order: open, the step in, the reach (the grip closes as the hand gets there), the step back, the close', () => {
    const t = FRIDGE_T
    expect(t.peek + t.stepS).toBeLessThanOrEqual(t.reach)
    expect(t.grab - t.reach, 'the grip\'s approach and closing').toBeCloseTo(GRIP_S.approach + GRIP_S.close, 6)
    expect(t.back).toBeGreaterThan(t.grab)
    expect(t.back + t.stepS).toBeLessThanOrEqual(t.close)
    expect(t.shut).toBeLessThan(t.total)
    // the spec's table: the step 0.9 → 1.25, the reach 1.25 → 1.75, back 1.75 → 2.1, closing 2.1 → 2.5, done at 3.0
    expect([t.peek, t.reach, t.back, t.close, t.shut, t.total]).toEqual([0.9, 1.25, 1.75, 2.1, 2.5, 3.0])
    expect(fridgeStepK(t.peek)).toBe(0)
    expect(fridgeStepK(t.reach)).toBe(1)
    expect(fridgeStepK(t.back)).toBe(1)
    expect(fridgeStepK(t.back + t.stepS)).toBe(0)
    // reduced motion: the drink is in the hand as the door passes 70°, before the grab would be
    expect(doorDeg(grabAt(true))).toBeCloseTo(t.letGoDeg, 2)
    expect(grabAt(false)).toBe(t.grab)
  })

  it('the step is 0.30 m in, and the body keeps 0.15 m or more off the door\'s swing all the way there', () => {
    expect(Math.hypot(FRIDGE.step.x - FRIDGE.stand.x, FRIDGE.step.z - FRIDGE.stand.z)).toBeCloseTo(0.3, 2)
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const x = FRIDGE.stand.x + (FRIDGE.step.x - FRIDGE.stand.x) * k
      const z = FRIDGE.stand.z + (FRIDGE.step.z - FRIDGE.stand.z) * k
      expect(sweptDistance(x, z), 'at ' + k.toFixed(2)).toBeGreaterThanOrEqual(FRIDGE.stepOffM)
    }
  })

  it('the model\'s drinks: their grips where lounge.ts has them, within the hands\' reach of the step (0.6 m ahead; designer: the shelf items moved 3 cm in), resting on their shelves (not floating)', async () => {
    const { scene } = await loadOffice()
    scene.updateMatrixWorld(true)
    const others: Mesh[] = []
    scene.traverse((o) => {
      let p: typeof o | null = o
      while (p && !/^prop_fridge_/.test(p.name)) p = p.parent
      if ((o as Mesh).isMesh && !p) others.push(o as Mesh)
    })
    for (const k of DRINK_KINDS) {
      const d = DRINKS[k]
      const node = scene.getObjectByName(d.prop)!
      expect(node.userData.prop, k).toBe(d.kind)
      expect(DRINK_PROP_KINDS[d.kind]).toBe(k)
      const g = scene.getObjectByName(`${d.prop}_grip_l`)!.getWorldPosition(new Vector3())
      expect(g.distanceTo(new Vector3(d.grip.x, d.grip.y, d.grip.z)), k + ' grip').toBeLessThan(0.002)
      // the hand poses reach 0.6 m ahead of the body (water.ts REACH notes); the grip from the step is inside that
      expect(Math.hypot(g.x - FRIDGE.step.x, g.z - FRIDGE.step.z), k + ' reach from the step').toBeLessThanOrEqual(0.6)
      // straight down from its middle, the first thing under it is its shelf, at its bottom
      const box = new Box3().setFromObject(node)
      const c = box.getCenter(new Vector3())
      const hit = new Raycaster(new Vector3(c.x, box.max.y + 0.01, c.z), new Vector3(0, -1, 0)).intersectObjects(others, false)[0]
      expect(hit, k + ' has a shelf under it').toBeTruthy()
      expect(Math.abs(hit.point.y - box.min.y), k + ' sits on it').toBeLessThan(0.001)
    }
  }, 60000)

  it('the inside light: on past 8°, stays on until below 4° (lounge-props.md 5.4); no brighter than 0.5 (#469 designer)', () => {
    expect(fridgeLightOn(8, false)).toBe(false)
    expect(fridgeLightOn(8.1, false)).toBe(true)
    expect(fridgeLightOn(5, true)).toBe(true)
    expect(fridgeLightOn(4, true)).toBe(true)
    expect(fridgeLightOn(3.9, true)).toBe(false)
    expect(fridgeLightOn(5, false)).toBe(false)
    expect(FRIDGE_LIGHT.intensity).toBeLessThanOrEqual(0.5)
    expect(FRIDGE_LIGHT).toMatchObject({ color: '#eaf2ff', distance: 1, decay: 2, spill: 0.16 })
  })
})

describe('where the agent stands for each act, on the walkable grid', () => {
  it('every stand is a walkable cell the planner reaches (the baked footprint and the committed one), with the thing it works within an arm', async () => {
    const { scene, nodes } = await loadOffice()
    scene.updateMatrixWorld(true)
    const grids = [buildGrid(rasterFootprint(Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf), 0.05, scene), GRAPH), buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH)]
    const reach = (st: { x: number; z: number }, p: Vector3) => Math.hypot(p.x - st.x, p.z - st.z)
    const tap = (k: number) => scene.getObjectByName(`water_tap_${k}`)!.getWorldPosition(new Vector3())
    const checks: [string, { x: number; z: number }, Vector3[]][] = [
      ['fridge', FRIDGE.stand, [scene.getObjectByName('fridge_door_grip')!.getWorldPosition(new Vector3())]],
      // #457 the step in to take a drink: the two drinks' left-hand grips
      ['fridge step', FRIDGE.step, DRINK_KINDS.map((k) => scene.getObjectByName(`${DRINKS[k].prop}_grip_l`)!.getWorldPosition(new Vector3()))],
      ['dispenser', DISPENSER.stand, [tap(0), tap(1)]],
      // the jacket's place, the platter's middle and the arm's headshell
      ['record', RECORD.stand, [nodes.prop_record.getWorldPosition(new Vector3()), nodes.turntable_platter.getWorldPosition(new Vector3()), nodes.turntable_arm.localToWorld(new Vector3(-0.0225, 0, -0.225))]],
    ]
    for (const grid of grids) {
      for (const [name, st, things] of checks) {
        const c = cellAt(grid, st.x, st.z)
        expect(c, name + ' on the grid').toBeGreaterThanOrEqual(0)
        expect(grid.blocked[c], name + ' stand is walkable').toBeFalsy()
        expect(findPath(grid, { x: -1, z: -0.6 }, st), name + ' reachable').toBeTruthy()
        for (const p of things) expect(reach(st, p), name + ' within an arm').toBeLessThanOrEqual(REACH)
      }
    }
  }, 60000)

  it('the schedule stands the agent at the act\'s stand, facing what it works; the fridge and the dispenser share a spot (one at the bar), the turntable has its own', () => {
    for (const k of ['fridge', 'dispenser', 'record'] as const) {
      const p = PLAYS.find((x) => x.kind === k)!
      expect(p.stand, k).toEqual(ACT_PLACE[k].stand)
      expect(p.face, k).toEqual(ACT_PLACE[k].face)
      expect(p.spots, k).toEqual([ACT_PLACE[k].spot])
    }
    expect(ACT_PLACE.fridge.spot).toBe(ACT_PLACE.dispenser.spot)
    expect(ACT_PLACE.record.spot).not.toBe(ACT_PLACE.fridge.spot)
    // the dispenser's stand is inside the area the door sweeps (plus a body radius): so the two are never used together, which the shared spot makes sure of
    expect(sweptDistance(DISPENSER.stand.x, DISPENSER.stand.z)).toBeLessThan(0.3)
  })
})

describe('the beats of each act', () => {
  it('the dispenser pours for the cue\'s dur (sound.md 0.4–2 s) between pressing and lifting off', () => {
    expect(DISPENSER.pourS).toBeGreaterThanOrEqual(0.4)
    expect(DISPENSER.pourS).toBeLessThanOrEqual(2)
    expect(DISPENSER_T.release - DISPENSER_T.press).toBeCloseTo(DISPENSER.pourS, 6)
    expect(DISPENSER_T.total).toBeGreaterThan(DISPENSER_T.release)
  })

  it('the record: with none on, the disc comes out (0.4 s), onto the platter (0.4 s), then the arm over (0.5 s) and down (0.3 s); with one on, only the arm; lifting is the arm back', () => {
    const put = recordBeats('put', false)
    expect(put.record).toBe(true)
    expect(RECORD_T.out - RECORD_T.take).toBeCloseTo(0.4, 6)
    expect(RECORD_T.place - RECORD_T.out).toBeCloseTo(0.4, 6)
    expect(put.over - put.swing0).toBeCloseTo(0.5, 6)
    expect(put.down - put.over).toBeCloseTo(0.3, 6)
    expect(put.arm0, 'the hand is free of the jacket first').toBeGreaterThanOrEqual(RECORD_T.place + 0.4)
    const on = recordBeats('put', true)
    expect(on.record).toBe(false)
    expect(on.total).toBeLessThan(put.total)
    const lift = recordBeats('lift', true)
    expect(lift.record).toBe(false)
    expect(lift.down).toBeGreaterThan(lift.swing0)
    expect(actTotal('record', 'put', false)).toBe(put.total)
    expect(actTotal('fridge')).toBe(FRIDGE_T.total)
    expect(actTotal('dispenser')).toBe(DISPENSER_T.total)
  })
})

describe('the door lever and the mat', () => {
  it('the lever presses 30° down (extras press) in press_s, holds, and comes back in release_s', async () => {
    const { scene } = await loadOffice()
    const lever = scene.getObjectByName('door_lever')!
    const press = lever.userData.press as { axis: string; sign: number; deg: number; press_s: number; release_s: number }
    expect(press).toMatchObject({ axis: 'z', sign: -1, deg: 30, press_s: 0.3, release_s: 0.3 })
    expect(leverAngle(0, press)).toBeCloseTo(0, 9)
    expect(leverAngle(LEVER_T.grab + press.press_s, press)).toBeCloseTo(-30, 6)
    expect(leverAngle(LEVER_T.grab + press.press_s + LEVER_T.hold + press.release_s, press)).toBeCloseTo(0, 6)
    // the left hand's grip is on the lever (it follows it)
    expect(scene.getObjectByName('door_lever_grip')!.parent).toBe(lever)
    expect(scene.getObjectByName('door_lever_grip')!.userData.grip_for).toBe('l')
  })

  it('the door spot is on the mat, and nothing else in the lounge is', () => {
    const door = GRAPH.spots.door
    expect(onMat(door.x, door.z)).toBe(true)
    expect(onMat(GRAPH.spots.hall_door.x, GRAPH.spots.hall_door.z)).toBe(false)
    expect(MAT.x1 - MAT.x0).toBeCloseTo(0.5, 6)
    expect(MAT.z1 - MAT.z0).toBeCloseTo(0.8, 6)
  })
})

describe('the wall frames', () => {
  it('each frame number has a name tag and a page; the model has a press box for each', async () => {
    const { scene } = await loadOffice()
    FRAME_LINKS.forEach((l, k) => {
      expect(linkOf(k)).toEqual(l)
      const hit = scene.getObjectByName(`hit_frame_${k}`)!
      expect(hit.userData).toMatchObject({ hit: 'frame', frame: k })
      expect(frameOfNode(`frame_${k}_art`, scene.getObjectByName(`frame_${k}_art`)!.userData)).toBe(k)
    })
    expect(linkOf(3)).toBeNull()
    expect(FRAME_LINKS.map((l) => l.go)).toEqual(['desk', 'repo', 'desk'])
  })
})
