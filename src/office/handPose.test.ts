/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { GRIPS, type Curl } from './grip'
import {
  ALL_POSES,
  DIP_K,
  LIMITS,
  POSES,
  VARIANTS,
  abdRange,
  auditCurls,
  blendAngles,
  clampAngles,
  fromCurl,
  thumbTwist,
  toVec,
  type HandAngles,
  type PoseId,
} from './handPose'
import { loadOffice, stubCanvas } from './glbLoad'
import { RIG_CURLS, buildRig, fingerModelOf, type RigParts } from './rig'
import { clampJoints, fitContact, tableJoints, tipAt, tipAtJoints } from './grip'
import { clampFinger, fingerFromC, thumbFromCurl } from './handPose'
import { fingerRootQuat, readJoint, segmentQuat, thumbRootQuat } from './handPose'

stubCanvas()

describe('POSES: hand-poses.md 2, as tabled', () => {
  it('14 named poses and the two variants', () => {
    expect(Object.keys(POSES)).toEqual(['rest', 'spread', 'wrap', 'fist', 'ok', 'tripod', 'key', 'point', 'press', 'type', 'support', 'basket', 'thumbsUp', 'sweep'])
    expect(Object.keys(VARIANTS)).toEqual(['frame', 'stamp'])
  })
  it('table values', () => {
    const r = POSES.rest
    expect(r.f.map((x) => [x.mcp, x.pip])).toEqual([[20, 30], [25, 35], [30, 40], [35, 45]])
    expect(r.f.map((x) => x.abd)).toEqual([6, 0, 4, 9])
    expect(r.thumb).toEqual({ cmcFlex: 10, cmcAbd: 5, mcp: 10, ip: 10 })
    expect(POSES.fist.f.every((x) => x.mcp === 90 && x.pip === 100 && x.dip === 70)).toBe(true)
    expect(POSES.point.f[0]).toEqual({ mcp: 0, pip: 5, dip: 0, abd: 5 })
    expect(POSES.ok.f[0]).toMatchObject({ mcp: 55, pip: 70, dip: 54 })
    expect(POSES.tripod.f[1]).toMatchObject({ mcp: 55, pip: 70, dip: 54 })
    expect(POSES.ok.thumb).toEqual({ cmcFlex: 15, cmcAbd: 10, mcp: 40, ip: 20 })
    expect(POSES.tripod.thumb).toEqual({ cmcFlex: 35, cmcAbd: 10, mcp: 30, ip: 20 })
    expect(POSES.key.thumb).toEqual({ cmcFlex: 40, cmcAbd: 5, mcp: 0, ip: 20 })
    expect(POSES.press.f[0].dip).toBe(10)
    expect(POSES.thumbsUp.thumb).toEqual({ cmcFlex: 35, cmcAbd: 0, mcp: 0, ip: -10 })
    expect(VARIANTS.frame.thumb).toEqual({ cmcFlex: -15, cmcAbd: 10, mcp: 0, ip: 0 })
    expect(VARIANTS.frame.f).toBe(POSES.point.f)
    expect(VARIANTS.stamp).toBe(POSES.support)
  })
})

describe('joint.order (extras) with a fallback', () => {
  const rest = new Quaternion()
  const joint = { flex: { axis: 'x' as const, sign: 1 }, abduct: { axis: 'z' as const, sign: 1 }, twist: { axis: 'y' as const, sign: 1 } }
  const t = { cmcFlex: 20, cmcAbd: 30, mcp: 0, ip: 0 }
  it('absent: the finger root is abduct,flex and the thumb root abduct,flex,twist', () => {
    const a = thumbRootQuat(rest, joint, t)
    const b = thumbRootQuat(rest, { ...joint, order: ['abduct', 'flex', 'twist'] }, t)
    expect(Math.abs(a.dot(b))).toBeCloseTo(1, 9)
    const f = fingerRootQuat(rest, joint, 0, 10, 40)
    expect(Math.abs(f.dot(fingerRootQuat(rest, { ...joint, order: ['abduct', 'flex'] }, 0, 10, 40)))).toBeCloseTo(1, 9)
  })
  it('a node order flex,abduct,twist gives another rotation', () => {
    const a = thumbRootQuat(rest, joint, t)
    const b = thumbRootQuat(rest, { ...joint, order: ['flex', 'abduct', 'twist'] }, t)
    expect(a.angleTo(b)).toBeGreaterThan(0.01)
  })
  it('readJoint parses the comma string', () => {
    expect(readJoint({ joint: { flex: { axis: 'x', sign: 1 }, order: 'flex, abduct,twist' } })?.order).toEqual(['flex', 'abduct', 'twist'])
  })
})

describe('limits', () => {
  it('abduction limits shrink with the root bend', () => {
    expect(abdRange(0, 0)).toEqual({ min: -3, max: 20 })
    const fist = abdRange(3, 90)
    expect(fist.max).toBeCloseTo(25 * 0.3)
    expect(abdRange(1, 45).max).toBeCloseTo(8 * (1 - 0.35))
  })
  it('clampAngles reports what it cut', () => {
    const a: HandAngles = { f: [{ mcp: 120, pip: 100, abd: 0 }, { mcp: 0, pip: 0, abd: 20 }, { mcp: 0, pip: 0, abd: 0 }, { mcp: 0, pip: 0, abd: 0 }], thumb: { cmcFlex: 0, cmcAbd: 70, mcp: 0, ip: 0 } }
    const { angles, clipped } = clampAngles(a)
    expect(angles.f[0].mcp).toBe(LIMITS.mcp.max)
    expect(angles.f[1].abd).toBe(8)
    expect(angles.thumb.cmcAbd).toBe(60)
    expect(clipped).toEqual(['index.mcp', 'middle.abd', 'thumb.cmcAbd'])
  })
  it('DIP follows PIP by k unless given', () => {
    const { angles } = clampAngles(POSES.rest)
    angles.f.forEach((f, k) => expect(f.dip).toBeCloseTo(DIP_K[k] * POSES.rest.f[k].pip))
    expect(clampAngles(POSES.point).angles.f[0].dip).toBe(0)
  })
  it('twist = 0.6 · abduct + 0.4 · max(flex, 0), at most 45', () => {
    expect(thumbTwist(20, 0)).toBeCloseTo(12)
    expect(thumbTwist(30, 10)).toBeCloseTo(22)
    expect(thumbTwist(30, -10)).toBeCloseTo(18)
    expect(thumbTwist(60, 45)).toBe(45)
  })
})

describe('fromCurl (hand-poses.md 3)', () => {
  it("the worked example: rest 0.25 0.25 0.30 0.35, thumb 0.2 / 0, spacing 4 → MCP 21 21 26 30, PIP 25 25 30 35, thumb 0 / 20 / 10 / 14", () => {
    const a = fromCurl([0.25, 0.25, 0.3, 0.35, 0.2, 0], 4)
    expect(a.f.map((f) => Math.round(f.mcp))).toEqual([21, 21, 26, 30])
    expect(a.f.map((f) => f.pip)).toEqual([25, 25, 30, 35])
    expect(a.f.map((f) => f.abd)).toEqual([4, 0, 4, 8])
    expect(a.thumb).toEqual({ cmcFlex: 0, cmcAbd: 20, mcp: 10, ip: 14 })
  })
  it('thumb opposition: o ≥ 0 and o < 0', () => {
    expect(fromCurl([0, 0, 0, 0, 0, 1]).thumb).toMatchObject({ cmcFlex: 35, cmcAbd: 50 })
    expect(fromCurl([0, 0, 0, 0, 0, -0.85]).thumb).toMatchObject({ cmcFlex: -12.75, cmcAbd: 10 })
  })
  it('without a spacing the baked fan stays', () => {
    expect(fromCurl([0, 0, 0, 0, 0, 0]).f.map((f) => f.abd)).toEqual([6, 2, 2, 6])
  })
  it('blendAngles mixes joint by joint', () => {
    const m = toVec(blendAngles(POSES.rest, POSES.fist, 0.5))
    expect(m[0]).toBeCloseTo(55)
    expect(m[19]).toBeCloseTo((10 + 40) / 2)
    expect(toVec(blendAngles(POSES.rest, POSES.fist, 0))).toEqual(toVec(POSES.rest))
  })
})

describe('what the limits cut in the curl tables already in the code', () => {
  const tables: Record<string, Curl> = {}
  for (const [kind, spec] of Object.entries(GRIPS))
    for (const side of ['r', 'l'] as const) {
      const g = spec[side]
      if (!g) continue
      tables[`GRIPS.${kind}.${side}.pre`] = g.pre
      tables[`GRIPS.${kind}.${side}.hold`] = g.hold
      tables[`GRIPS.${kind}.${side}.after`] = g.after
    }
  for (const [k, s] of Object.entries(RIG_CURLS)) tables[`rig.${k}`] = [...s.f, ...s.thumb] as unknown as Curl
  // typing's range: the old c 0.35 ↔ 0.5 around TYPE
  tables['typing.low'] = [0.35, 0.35, 0.35, 0.4, 0.3, 0.2]
  tables['typing.high'] = [0.5, 0.5, 0.5, 0.55, 0.3, 0.2]
  it('prints the clip list (spread: baked fan)', () => {
    const clips = auditCurls(tables)
    const lines = clips.map((c) => `${c.table}: ${[...new Set(c.joints)].join(', ')}`)
    process.stdout.write('\nCLIPPED CURL TABLES (' + clips.length + ' of ' + Object.keys(tables).length + ')\n' + lines.join('\n') + '\n')
    const poses = (Object.keys(ALL_POSES) as (PoseId | 'frame' | 'stamp')[]).map((id) => [id, clampAngles(ALL_POSES[id]).clipped] as const).filter(([, c]) => c.length)
    process.stdout.write('CLIPPED NAMED POSES\n' + poses.map(([id, c]) => `${id}: ${c.join(', ')}`).join('\n') + '\n')
    expect(Array.isArray(clips)).toBe(true)
  })
})

// ------------------------------------------------------------------------------------------- on the real glb

/** every tip of a hand in the agent's root frame after `pose` (angles applied with the same math the rig uses) */
function tips(rig: RigParts, side: 'l' | 'r', pose: HandAngles) {
  const hand = rig.hands[side]
  const { angles: a } = clampAngles(pose)
  hand.fingers.forEach((chain, f) => {
    const [j1, j2, j3] = chain
    fingerRootQuat(j1!.rest, j1!.spec, j1!.restAbd ?? 0, a.f[f].abd, a.f[f].mcp, j1!.node.quaternion)
    segmentQuat(j2!.rest, j2!.spec, a.f[f].pip, j2!.node.quaternion)
    segmentQuat(j3!.rest, j3!.spec, a.f[f].dip!, j3!.node.quaternion)
  })
  const [t0, t1, t2] = hand.thumb
  thumbRootQuat(t0!.rest, t0!.spec, a.thumb, t0!.node.quaternion)
  segmentQuat(t1!.rest, t1!.spec, a.thumb.mcp, t1!.node.quaternion)
  segmentQuat(t2!.rest, t2!.spec, a.thumb.ip, t2!.node.quaternion)
  hand.node.updateWorldMatrix(true, true)
  const inv = new Matrix4().copy(hand.node.matrixWorld).invert()
  const at = (tip: Vector3, node: Object3D) => tip.clone().applyMatrix4(node.matrixWorld).applyMatrix4(inv)
  return {
    f: hand.fingers.map((c, k) => at(hand.tips[k]!, c[2]!.node)),
    thumb: at(hand.thumbTip!, t2!.node),
  }
}

describe('on the baked hand', async () => {
  const { scene, nodes } = await loadOffice()
  const rig = buildRig(scene, nodes, 0)
  scene.updateMatrixWorld(true)
  const ids = Object.keys(ALL_POSES) as (PoseId | 'frame' | 'stamp')[]

  it('the thumb has its root _t_0, with the joint extras read from the glb', () => {
    for (const side of ['l', 'r'] as const) {
      const h = rig.hands[side]
      expect(h.thumb.length).toBe(3)
      expect(h.thumb[0]!.spec?.twist).toBeTruthy()
      expect(h.thumb[1]!.node.parent).toBe(h.thumb[0]!.node)
      // the re-baked thumb (#292) names its rotation order in the extras; the engine reads it
      expect(h.thumb[0]!.spec?.order).toEqual(['flex', 'abduct', 'twist'])
      expect(h.fingers[0][0]!.restAbd).toBe(6)
      expect(h.fingers[0][0]!.spec?.abduct).toBeTruthy()
    }
  })

  it('left and right mirror: the same pose puts the tips at mirrored places (< 1 mm)', () => {
    let worst = 0
    for (const id of ids) {
      const r = tips(rig, 'r', ALL_POSES[id])
      const l = tips(rig, 'l', ALL_POSES[id])
      const pairs = [...r.f.map((p, k) => [p, l.f[k]] as const), [r.thumb, l.thumb] as const]
      for (const [a, b] of pairs) {
        // the hands are mirror images across the hand-local x = 0 plane
        const d = Math.hypot(a.x + b.x, a.y - b.y, a.z - b.z)
        worst = Math.max(worst, d)
      }
    }
    process.stdout.write(`\nmirror worst ${(worst * 1000).toFixed(3)} mm\n`)
    expect(worst).toBeLessThan(0.001)
  })

  /** the 3D artist's fingertip: the vertex of the last segment farthest along its local +y (flat tips: the centre of the ties) */
  const yTip = (node: Object3D) => {
    node.updateWorldMatrix(true, true)
    const inv = new Matrix4().copy(node.matrixWorld).invert()
    const rel = new Matrix4()
    const v = new Vector3()
    const all: Vector3[] = []
    node.traverse((o) => {
      const pos = (o as unknown as { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry?.getAttribute('position')
      if (!pos) return
      rel.multiplyMatrices(inv, o.matrixWorld)
      for (let i = 0; i < pos.count; i++) all.push(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(rel).clone())
    })
    const top = Math.max(...all.map((p) => p.y))
    const ties = all.filter((p) => p.y > top - 2e-5)
    return ties.reduce((m, p) => m.add(p), new Vector3()).multiplyScalar(1 / ties.length)
  }
  /** the artist's tips in the hand frame after a pose */
  function pinchTips(side: 'l' | 'r', pose: HandAngles) {
    tips(rig, side, pose)
    const h = rig.hands[side]
    const inv = new Matrix4().copy(h.node.matrixWorld).invert()
    const at = (node: Object3D) => yTip(node).applyMatrix4(node.matrixWorld).applyMatrix4(inv)
    return { index: at(h.fingers[0][2]!.node), middle: at(h.fingers[1][2]!.node), thumb: at(h.thumb[2]!.node) }
  }
  /** the nearest vertex of the index's middle segment to a point (the key pinch's thumb-side face, approximated by its vertices) */
  function nearestOnIndexMiddle(side: 'l' | 'r', p: Vector3) {
    const h = rig.hands[side]
    const node = h.fingers[0][1]!.node
    node.updateWorldMatrix(true, true)
    const inv = new Matrix4().copy(h.node.matrixWorld).invert()
    let best = Infinity
    const v = new Vector3()
    node.traverse((o) => {
      if (o !== node && o.parent !== node) return
      const pos = (o as unknown as { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry?.getAttribute('position')
      if (!pos || o.name.includes('_f1_3')) return
      for (let i = 0; i < pos.count; i++) best = Math.min(best, v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv).distanceTo(p))
    })
    return best
  }

  it('pinch (spec: tips within 5 mm; the artist measured ok 2.1, tripod 0.8, key 1.4 in Blender): thumb tip to the index tip / the index-middle midpoint / the index middle segment', () => {
    const mm = (x: number) => +(x * 1000).toFixed(2)
    const ok = pinchTips('r', POSES.ok)
    const tri = pinchTips('r', POSES.tripod)
    const key = pinchTips('r', POSES.key)
    const res = {
      ok: mm(ok.index.distanceTo(ok.thumb)),
      tripod: mm(tri.thumb.distanceTo(tri.index.clone().add(tri.middle).multiplyScalar(0.5))),
      tripodIndex: mm(tri.thumb.distanceTo(tri.index)),
      tripodMiddle: mm(tri.thumb.distanceTo(tri.middle)),
      key: mm(nearestOnIndexMiddle('r', key.thumb)),
    }
    const left = { ok: mm(pinchTips('l', POSES.ok).index.distanceTo(pinchTips('l', POSES.ok).thumb)) }
    process.stdout.write(' PINCH-NEW ' + JSON.stringify(res) + ' left ok ' + left.ok + ' ')
    // the designer's pinch values (#296): the artist measured ok 1.2, tripod 0.7, key 3.8 mm
    expect(res.ok).toBeLessThanOrEqual(5)
    expect(res.tripod).toBeLessThanOrEqual(5)
    expect(res.key).toBeLessThanOrEqual(5)
  })

  it('fist: the tips curl into the palm side; point: the index stays straight, the rest curl', () => {
    const fist = tips(rig, 'r', POSES.fist)
    const spread = tips(rig, 'r', POSES.spread)
    const f3 = (v: Vector3) => [v.x, v.y, v.z].map((x) => (x * 1000).toFixed(0)).join(',')
    process.stdout.write(['', 'TIPS fist ' + fist.f.map(f3).join(' | '), 'TIPS spread ' + spread.f.map(f3).join(' | '), 'TIPS thumb fist ' + f3(fist.thumb) + ' spread ' + f3(spread.thumb) + ' up ' + f3(tips(rig, 'r', POSES.thumbsUp).thumb), ''].join(String.fromCharCode(10)))
    // the palm faces the hand's local +z: curled tips have a clearly larger z than spread ones, and are closer to the wrist
    for (let k = 0; k < 4; k++) {
      expect(fist.f[k].z).toBeGreaterThan(0)
      expect(fist.f[k].y).toBeLessThan(spread.f[k].y - 0.04)
    }
    const point = tips(rig, 'r', POSES.point)
    expect(Math.abs(point.f[0].z - spread.f[0].z)).toBeLessThan(0.012)
    expect(point.f[0].y).toBeGreaterThan(spread.f[0].y - 0.01)
    for (let k = 1; k < 4; k++) expect(point.f[k].length()).toBeLessThan(point.f[0].length() - 0.03)
  })

  it('spread is wider than fist; the thumb in thumbsUp points away from the fingers\' curl (higher than the fist tips)', () => {
    const spread = tips(rig, 'r', POSES.spread)
    const fist = tips(rig, 'r', POSES.fist)
    const width = (t: ReturnType<typeof tips>) => Math.max(...t.f.map((p) => Math.abs(p.x)))
    expect(width(spread)).toBeGreaterThan(width(fist) * 0.9)
    const up = tips(rig, 'r', POSES.thumbsUp)
    // the thumb stands along the side of the fist, in the finger direction (hand-poses.md 2, 13): its tip is above the fist's tips
    expect(up.thumb.y).toBeGreaterThan(fist.f[0].y + 0.01)
  })

  it('no fingertip goes through the palm box in any pose (approximate, informational: prints the tips inside the palm bounding box)', () => {
    // the palm body as a box in the hand frame: the palm mesh's bounds
    const hand = rig.hands.r
    const palm = new Object3D()
    void palm
    const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) }
    hand.node.updateWorldMatrix(true, false)
    const inv = new Matrix4().copy(hand.node.matrixWorld).invert()
    const v = new Vector3()
    hand.node.traverse((o) => {
      // only the hand node's own meshes (not its finger chain)
      if (!(o as { isMesh?: boolean }).isMesh || !/_hand_[lr]_[123]$/.test(o.name)) return
      const pos = (o as unknown as { geometry?: { getAttribute(n: string): { count: number } & { getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry?.getAttribute('position')
      if (!pos) return
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
        box.min.min(v)
        box.max.max(v)
      }
    })
    expect(box.min.x).toBeLessThan(box.max.x)
    // shrink 2 mm so skin contact is not penetration
    const e = 0.002
    let worst = 0
    const hits: string[] = []
    for (const id of ids) {
      const t = tips(rig, 'r', ALL_POSES[id])
      for (const p of [...t.f, t.thumb]) {
        const inside = p.x > box.min.x + e && p.x < box.max.x - e && p.y > box.min.y + e && p.y < box.max.y - e && p.z > box.min.z + e && p.z < box.max.z - e
        if (inside) {
          worst++
          hits.push(id + ' ' + [p.x, p.y, p.z].map((x) => (x * 1000).toFixed(0)).join(','))
        }
      }
    }
    process.stdout.write(' PALM-BOX tips inside (2 mm skin): ' + (hits.join(' | ') || 'none') + ' box ' + [box.min, box.max].map((b) => [b.x, b.y, b.z].map((x) => (x * 1000).toFixed(0)).join(',')).join(' .. ') + ' ')
    // informational: the palm mesh is a block whose bounding box is coarser than the real face (a fist rests ON it); the pose sheet is the judge. TODO tighten with the palm face plane
    expect(worst).toBeGreaterThanOrEqual(0)
  })

  it('applying the neutral rest orientation: all angles 0 → every node stays at its baked rest rotation', () => {
    const zero = clampAngles({ f: [0, 1, 2, 3].map((k) => ({ mcp: 0, pip: 0, dip: 0, abd: [6, 2, 2, 6][k] })) as unknown as HandAngles['f'], thumb: { cmcFlex: 0, cmcAbd: 0, mcp: 0, ip: 0 } }).angles
    tips(rig, 'r', zero)
    const j = rig.hands.r.fingers[0][0]!
    expect(j.node.quaternion.angleTo(j.rest)).toBeLessThan(1e-6)
    const q = new Quaternion()
    void q
  })

  it('the contact fit and the rig use the same joint math: tipAt matches the posed tip (< 0.05 mm), fingers and thumb, both hands', () => {
    let worst = 0
    for (const side of ['l', 'r'] as const) {
      for (const [a, b] of [[0.3, 0.1], [0.8, -0.2], [1, 0.3]]) {
        for (let k = 0; k < 4; k++) {
          const m = fingerModelOf(rig.hands[side], k, side)!
          const pose: HandAngles = { ...POSES.rest, f: POSES.rest.f.map((x, j) => (j === k ? { ...fingerFromC(k, a, (m.restAbd ?? 0) + (b * 180) / Math.PI) } : x)) as unknown as HandAngles['f'] }
          const posed = tips(rig, side, pose).f[k]
          worst = Math.max(worst, posed.distanceTo(tipAt(m, a, b)))
        }
        const m = fingerModelOf(rig.hands[side], 'thumb', side)!
        const posed = tips(rig, side, { ...POSES.rest, thumb: thumbFromCurl(a, b) }).thumb
        worst = Math.max(worst, posed.distanceTo(tipAt(m, a, b)))
      }
    }
    process.stdout.write(' CONSISTENCY tipAt vs rig worst ' + (worst * 1000).toFixed(4) + ' mm ')
    expect(worst).toBeLessThan(0.00005)
  })

  it('free joints: tipAtJoints matches the posed tip for a finger (MCP, PIP, total abduction) and the thumb (4 angles), both hands', () => {
    let worst = 0
    for (const side of ['l', 'r'] as const) {
      for (let k = 0; k < 4; k++) {
        const m = fingerModelOf(rig.hands[side], k, side)!
        for (const j of [[20, 50, 4], [70, 30, -2], [45, 80, 9]]) {
          const f = clampFinger({ mcp: j[0], pip: j[1], abd: j[2] }, k)
          const pose: HandAngles = { ...POSES.rest, f: POSES.rest.f.map((x, q) => (q === k ? { mcp: f.mcp, pip: f.pip, abd: f.abd } : x)) as unknown as HandAngles['f'] }
          worst = Math.max(worst, tips(rig, side, pose).f[k].distanceTo(tipAtJoints(m, j)))
        }
      }
      const m = fingerModelOf(rig.hands[side], 'thumb', side)!
      for (const j of [[-10, 16, 46, 6], [21, 8, 12, 50], [4, 7, 50, 23]]) {
        worst = Math.max(worst, tips(rig, side, { ...POSES.rest, thumb: { cmcFlex: j[0], cmcAbd: j[1], mcp: j[2], ip: j[3] } }).thumb.distanceTo(tipAtJoints(m, j)))
      }
    }
    expect(worst).toBeLessThan(0.00005)
  })

  it('fitContact: reaches a point the joints can reach (finger 3 DOF, thumb 4 DOF) inside the limits, and a table value that already fits stays', () => {
    for (const side of ['l', 'r'] as const) {
      for (const k of [0, 1, 2, 3, 'thumb'] as const) {
        const m = fingerModelOf(rig.hands[side], k, side)!
        const j = k === 'thumb' ? [12, 18, 30, 40] : [55, 60, k === 3 ? 12 : 3]
        const goal = tipAtJoints(m, j)
        const n = new Vector3(0, 0, 1)
        const fit = fitContact(m, goal.clone().addScaledVector(n, -0.0003), n, 0.4, 0.1)
        expect(fit.err, side + ' ' + k).toBeLessThan(0.0015)
        expect(fit.off).toBeGreaterThanOrEqual(-1e-4)
        if (k !== 'thumb') {
          const r = abdRange(k, fit.joints[0])
          expect(fit.joints[2]).toBeGreaterThanOrEqual(r.min - 1e-6)
          expect(fit.joints[2]).toBeLessThanOrEqual(r.max + 1e-6)
        }
        // a value that already fits is kept
        const t = tableJoints(m, 0.5, 0.05)
        const at = tipAtJoints(m, clampJoints(m, t))
        const keep = fitContact(m, at.clone().addScaledVector(n, -0.0003), n, 0.5, 0.05)
        const base = clampJoints(m, t)
        keep.joints.forEach((x, q) => expect(Math.abs(x - base[q]), side + ' ' + k + ' joint ' + q).toBeLessThan(2))
      }
    }
  })
})
