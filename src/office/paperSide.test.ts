/// <reference types="node" />
// The paper held by its long sides for reading (#374, paper-pass.md 2.1-2.3 and 5, grips.md "낱장 옆 쥐고 읽기"):
//  1. the grip fits the baked side-grip empties on every agent's hands, left and right: nothing through the sheet, every finger pad within 1 mm of its face
//     (four fingers on the back, the thumb on the text face), the wrist within 30 degrees of the arm at the viewing place;
//  2. the viewing place: the sheet's top edge and the hands' tops stay 1 cm under the face screen's bottom edge, the sheet 0.26 ahead of it and tilted 40 degrees;
//  3. each pass method's grip sequence (hand over: the right hand takes the right long edge while the giver holds the far short edge and the left comes 0.3 s
//     later; slide: the right lifts it by its right long edge, the left follows; toss: both are on the folded sheet's near half, no regrip), and one hand busy.
// The numbers are appended to FIT_LOG when set (the PR's table).
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { loadOffice, stubCanvas } from './glbLoad'
import { buildRig, fingerModelOf, type AgentRig } from './rig'
import { GRIPS, pointsAtJoints, tableJoints } from './grip'
import { fingerPenetration, fitFingers, handInObject, offsetOf, resolveTarget } from './gripTargets'
import { PAPER } from './paperProp'
import { sideSpot, viewBend } from './paperSide'
import { SHOULDER } from './reach'
import { VIEW } from './paperRun'
import { GRAPH } from './navSpots.fixture'
import { PaperPlanes } from './plane'
import { Walk, Guard, IDS, world, type World } from './errandWorld.fixture'
import type { HandCmd } from './paperRun'
import type { Method } from './paperPass'

stubCanvas()
const LOG = process.env.FIT_LOG
const log = (s: string) => LOG && appendFileSync(LOG, s + '\n')
const mm = (x: number) => (x * 1000).toFixed(2)
const FINGERS = ['index', 'middle', 'ring', 'little'] as const
const DEG = Math.PI / 180

describe('the side grip fits the baked sheet (#374)', () => {
  it('every agent, both hands: nothing through the sheet, finger pads within 1 mm of the back face, the thumb pad on the text face', async () => {
    const { scene, nodes } = await loadOffice()
    for (const i of [0, 1, 2, 3, 4]) {
      const rig = buildRig(scene, nodes, i)
      for (const side of ['l', 'r'] as const) {
        const t = resolveTarget(scene, 'prop_paper_a', 'paper_side', side)!
        expect(t, `${side} grip`).toBeTruthy()
        // the bake's own empties: the grip is 1.5 cm in from the long edge, 45 % up
        const spot = sideSpot(side)
        expect(new Vector3().setFromMatrixPosition(t.pg).distanceTo(spot), `agent_${i} ${side} grip empty at the computed spot`).toBeLessThan(1e-3)
        const hand = rig.hands[side]
        const off = offsetOf(t.key, i)
        const fits = fitFingers(t, hand, off)
        // the bake has the thumb's and the index's contacts; the other three fingers keep the table's hold and lie under the sheet
        expect(fits.map((f) => f.finger).sort()).toEqual(['index', 'thumb'])
        const hold = GRIPS.paper_side[side]!.hold
        const pen = fingerPenetration(t, hand, off, fits, 10, hold)
        log(`paper_side ${side} agent_${i} through ${mm(pen.min)} mm (${pen.finger}) ` + fits.map((f) => `${f.finger} err ${mm(f.err)} off ${mm(f.off)} pad ${mm(pen.per[f.finger])}`).join(' '))
        expect(pen.min, `agent_${i} ${side} nothing through the sheet`).toBeGreaterThanOrEqual(-1e-4)
        for (const f of fits) {
          expect(f.err, `agent_${i} ${side} ${f.finger} tip on its contact`).toBeLessThanOrEqual(0.003)
          expect(f.off, `agent_${i} ${side} ${f.finger} not through the surface`).toBeGreaterThanOrEqual(-1e-4)
          // the pad (the centre line's distance to the sheet) is within 1 mm of the face it touches
          expect(pen.per[f.finger], `agent_${i} ${side} ${f.finger} pad within 1 mm of the sheet`).toBeLessThanOrEqual(0.001)
        }
        // in the sheet's frame: the thumb's tip on the text face (+y), the index's on the back (-y)
        const M = handInObject(t, hand, off)
        const tipOf = (f: string, joints: number[]) => {
          const m = fingerModelOf(hand, f === 'thumb' ? 'thumb' : FINGERS.indexOf(f as (typeof FINGERS)[number]), side)!
          const pts = pointsAtJoints(m, joints)
          return pts[pts.length - 1].clone().applyMatrix4(M)
        }
        expect(tipOf('thumb', fits.find((f) => f.finger === 'thumb')!.joints).y, `agent_${i} ${side} thumb on the text face`).toBeGreaterThanOrEqual(-1e-4)
        expect(tipOf('index', fits.find((f) => f.finger === 'index')!.joints).y, `agent_${i} ${side} index on the back`).toBeLessThanOrEqual(1e-4)
        // the middle, ring and little fingers: every point of their centre lines over the sheet is under its back face (0.5 mm slack)
        for (const [k, f] of FINGERS.entries()) {
          if (f === 'index') continue
          const m = fingerModelOf(hand, k, side)!
          const pts = pointsAtJoints(m, tableJoints(m, hold[k], 0))
          for (const q of pts) {
            const w = q.clone().applyMatrix4(M)
            if (Math.abs(w.x) < PAPER.w / 2 && Math.abs(w.z) < PAPER.l / 2) expect(w.y, `agent_${i} ${side} ${f} under the sheet`).toBeLessThanOrEqual(0.0005)
          }
        }
      }
    }
  })

  it('a model without the grip empties falls back on the computed spots', async () => {
    const { scene } = await loadOffice()
    const clone = scene.clone(true)
    for (const n of ['prop_paper_grip_side_l', 'prop_paper_grip_side_r']) {
      const node = clone.getObjectByName(n)!
      node.removeFromParent()
    }
    for (const side of ['l', 'r'] as const) {
      const baked = resolveTarget(scene, 'prop_paper_a', 'paper_side', side)!
      const computed = resolveTarget(clone, 'prop_paper_a', 'paper_side', side)!
      expect(new Vector3().setFromMatrixPosition(computed.pg).distanceTo(new Vector3().setFromMatrixPosition(baked.pg))).toBeLessThan(1e-4)
      for (const f of ['thumb', 'index']) {
        const a = baked.contacts.find((c) => c.finger === f)!
        const b = computed.contacts.find((c) => c.finger === f)!
        expect(a.p.distanceTo(b.p), `${side} ${f}`).toBeLessThan(1e-4)
        expect(a.n.dot(b.n), `${side} ${f} normal`).toBeGreaterThan(0.999)
      }
    }
  })
})

// ------------------------------------------------------------------------------------------------ the passes

/** each frame of a pass: the commands of the hands, the sheet, where the hands are */
interface Frame {
  s: number
  cmds: HandCmd[]
  pos: Vector3
  quat: Quaternion
  fold: number
  opacity: number
  holder: { from: boolean; to: boolean }
  /** world positions of the receiver's / giver's hands, the top y of each hand (the whole hand node's box) */
  hands: Record<string, { pos: Vector3; top: number }>
  faceMinY: number
  faceCenter: Vector3
  /** the receiver's wrist bends (degrees) per side */
  bend: Record<string, number>
  grip: Record<string, Matrix4>
}

const PASS_PAIR: Record<string, [string, string]> = { hand: ['agent_2', 'agent_1'], slide: ['agent_2', 'agent_3'], toss: ['agent_2', 'agent_4'] }

function bendOf(rig: AgentRig, side: 'l' | 'r') {
  const root = rig.parts.root
  root.updateMatrixWorld(true)
  const hand = rig.parts.hands[side].node
  const pos = root.worldToLocal(hand.getWorldPosition(new Vector3()))
  const seat = (rig as unknown as { seat: number }).seat
  const shoulder = new Vector3((side === 'l' ? -1 : 1) * SHOULDER.x, SHOULDER.y + seat, SHOULDER.z)
  const a = pos.sub(shoulder).normalize()
  const fingers = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion())).applyQuaternion(root.getWorldQuaternion(new Quaternion()).invert()).normalize()
  return Math.acos(Math.max(-1, Math.min(1, fingers.dot(a)))) / DEG
}

async function play(method: Method, opts: { busy?: 'l' | 'r'; pair?: [string, string] } = {}) {
  const w: World = await world()
  const walk = new Walk(w, undefined, false)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  const planes = new PaperPlanes(w.props, w.nodes)
  walk.before = (t) => {
    // a mug in the receiver's busy hand the frame the pass begins (the stage's want), as an agent that is drinking has
    if (opts.busy && !planes.passes.busy) w.rigs[(opts.pair ?? PASS_PAIR[method])[1]].want = { kind: 'cup', side: opts.busy, prefer: 'prop_cup_0', attached: true }
    planes.update(t, GRAPH, w.rigs, false)
  }
  const guard = new Guard(w)
  for (let k = 0; k < 20; k++) walk.step(0.02, guard)
  const [from, to] = opts.pair ?? PASS_PAIR[method]
  planes.pass(from, to, method)
  const frames: Frame[] = []
  let started = -1
  const rto = w.rigs[to]
  const rfrom = w.rigs[from]
  for (let k = 0; k < 15 / 0.02; k++) {
    walk.step(0.02, guard)
    if (planes.passes.busy && started < 0) started = walk.t
    const st = planes.passes.lastState
    if (st && planes.passes.method) {
      w.scene.updateMatrixWorld(true)
      const hands: Frame['hands'] = {}
      for (const [who, rig] of [['to', rto], ['from', rfrom]] as const)
        for (const side of ['l', 'r'] as const) {
          const n = rig.parts.hands[side].node
          hands[who + side] = { pos: n.getWorldPosition(new Vector3()), top: new Box3().setFromObject(n).max.y }
        }
      const face = new Box3().setFromObject(w.nodes[`${to}_face`])
      frames.push({
        s: walk.t - started,
        cmds: st.hands.map((h) => ({ ...h })),
        pos: st.pos.clone(),
        quat: st.quat.clone(),
        fold: st.fold,
        opacity: st.opacity,
        holder: { ...st.holder },
        hands,
        faceMinY: face.min.y,
        faceCenter: face.getCenter(new Vector3()),
        bend: { l: bendOf(rto, 'l'), r: bendOf(rto, 'r') },
        grip: {},
      })
    }
    if (started > 0 && !planes.busy) break
  }
  return { w, planes, frames, from, to, rto, rfrom, guard }
}

const holding = (f: Frame, side: 'l' | 'r') => f.cmds.find((c) => c.who === 'to' && c.side === side && c.grip && c.w > 0.999 && (c.mix ?? 0) > 0.999)
/** the frames in which the sheet is fully shown and both receiver's hands hold it (the reading) */
const reading = (fr: Frame[]) => fr.filter((f) => f.opacity === 1 && f.holder.to && holding(f, 'l') && holding(f, 'r'))

describe('the viewing place (#374, paper-pass.md 5)', () => {
  for (const method of ['hand', 'slide', 'toss'] as const) {
    it(`${method}: the sheet is 0.26 ahead of the face screen, tilted 40 degrees, and neither it nor the hands reach the screen's bottom edge − 1 cm`, async () => {
      const r = await play(method)
      // the sheet has come up (the lift is over): the second half of the frames in which both hands hold it
      const all = reading(r.frames)
      const fr = all.slice(Math.floor(all.length * 0.4))
      expect(fr.length, 'frames at the reading place').toBeGreaterThan(40)
      let worstTop = Infinity
      let worstHand = Infinity
      let worstBend = 0
      for (const f of fr) {
        const toward = new Vector3(0, 1, 0).applyQuaternion(f.quat)
        // the tilt: the sheet's top edge direction is 40 degrees from vertical
        const top = new Vector3(0, 0, 1).applyQuaternion(f.quat)
        expect(Math.acos(top.y) / DEG).toBeCloseTo(40, 0)
        // the text side faces the face (toward the body) and up
        expect(toward.y).toBeGreaterThan(0)
        // 0.26 ahead of the screen's centre (horizontal distance), x 0
        const d = Math.hypot(f.pos.x - f.faceCenter.x, f.pos.z - f.faceCenter.z)
        expect(d, 'ahead of the screen').toBeGreaterThan(0.2)
        expect(d, 'ahead of the screen').toBeLessThan(0.3)
        // the top edge's two corners
        for (const sx of [-1, 1]) {
          const c = new Vector3(sx * PAPER.w / 2, 0, PAPER.l / 2).applyQuaternion(f.quat).add(f.pos)
          worstTop = Math.min(worstTop, f.faceMinY - 0.01 - c.y)
        }
        for (const side of ['l', 'r']) {
          worstHand = Math.min(worstHand, f.faceMinY - 0.01 - f.hands['to' + side].top)
          worstBend = Math.max(worstBend, f.bend[side])
        }
      }
      for (const side of ['l', 'r']) log(`  ${method} ${r.to} ${side} bend min ${Math.min(...fr.map((f) => f.bend[side])).toFixed(1)} max ${Math.max(...fr.map((f) => f.bend[side])).toFixed(1)}`)
      for (const side of ['l', 'r'] as const) {
        const t = resolveTarget(r.w.scene, 'prop_paper_a', 'paper_side', side)!
        const seat = Number(r.to.split('_')[1])
        log(`  nominal ${r.to} ${side} ${(viewBend(r.w.scene, r.rto.parts.hands[side].node, side, handInObject(t, r.rto.parts.hands[side], offsetOf(t.key, seat))) / DEG).toFixed(1)}`)
      }
      log(`view ${method}: top edge ${mm(worstTop)} mm clear of (screen bottom - 1 cm), hands ${mm(worstHand)} mm, worst wrist bend ${worstBend.toFixed(1)} deg, down ${VIEW.down}`)
      expect(worstTop, 'sheet top edge ≤ screen bottom − 1 cm').toBeGreaterThanOrEqual(0)
      expect(worstHand, 'hands top ≤ screen bottom − 1 cm').toBeGreaterThanOrEqual(0)
      expect(worstBend, 'wrist bend').toBeLessThanOrEqual(30)
    })
  }
})

/** a world point in the sheet's frame at frame f */
const inSheet = (f: Frame, p: Vector3) => p.clone().sub(f.pos).applyQuaternion(f.quat.clone().invert())
const grips = (f: Frame, side: 'l' | 'r') => f.cmds.filter((c) => c.who === 'to' && c.side === side)
/** the first frame in which the hand holds (grip closed, full weight) */
const takenAt = (fr: Frame[], side: 'l' | 'r') => fr.findIndex((f) => holding(f, side))

describe('each pass method\'s grip sequence (#374)', () => {
  it('hand over: the giver holds the far short edge, the right hand takes the right long edge, the left takes the left one 0.3 s later; the hands never overlap', async () => {
    const r = await play('hand')
    const fr = r.frames
    const ir = takenAt(fr, 'r')
    const il = takenAt(fr, 'l')
    expect(ir, 'right hand takes it').toBeGreaterThan(0)
    expect(il, 'left hand takes it').toBeGreaterThan(ir)
    const gap = fr[il].s - fr[ir].s
    log(`hand over: left hand ${gap.toFixed(2)} s after the right`)
    expect(gap).toBeGreaterThan(0.25)
    expect(gap).toBeLessThan(0.45)
    // while the right hand takes it the left is not on it yet
    expect(grips(fr[ir], 'l').filter((c) => c.grip && c.w > 0.999).length).toBe(0)
    // the sheet is held by both at the shared moment: the giver's pinch is on the far short edge (the top, z +), the receiver's right hand on the right long edge (x -), 1.5 cm in, 45 %
    const shared = fr.filter((f) => f.holder.from && f.holder.to && holding(f, 'r'))
    expect(shared.length, 'shared hold').toBeGreaterThan(3)
    let nearest = Infinity
    for (const f of shared) {
      const giver = f.cmds.find((c) => c.who === 'from' && c.side === 'r' && !c.grip)!
      const g = inSheet(f, giver.pinch)
      expect(g.z, 'the giver holds the far short edge').toBeGreaterThan(0.1)
      const h = inSheet(f, f.hands['tor'].pos)
      expect(h.x, 'the receiver\'s right hand is at the right long edge').toBeLessThan(-0.05)
      expect(h.z, 'about 45 % up').toBeLessThan(0.05)
      nearest = Math.min(nearest, f.hands['fromr'].pos.distanceTo(f.hands['tor'].pos))
      // the top edge points back to the giver: it reads the right way up for the receiver
      const top = new Vector3(0, 0, 1).applyQuaternion(f.quat)
      const toGiver = f.hands['fromr'].pos.clone().sub(f.hands['tor'].pos).setY(0).normalize()
      expect(top.dot(toGiver)).toBeGreaterThan(0.5)
    }
    log(`hand over: the giver's hand is at least ${mm(nearest)} mm from the receiver's right hand while both hold`)
    expect(nearest, 'the two hands do not overlap').toBeGreaterThan(0.1)
    // later the left hand is on the left long edge (x +)
    const left = inSheet(fr[il], fr[il].hands['tol'].pos)
    expect(left.x).toBeGreaterThan(0.05)
  })

  it('slide: the palm stops it, then the right hand lifts it by its right long edge and the left follows', async () => {
    const r = await play('slide')
    const fr = r.frames
    const ir = takenAt(fr, 'r')
    const il = takenAt(fr, 'l')
    expect(ir).toBeGreaterThan(0)
    expect(il).toBeGreaterThan(ir)
    // before the grip the receiver's hand is the palm (no grip command), on the paper
    const palm = fr.slice(0, ir).filter((f) => grips(f, 'r').some((c) => !c.grip))
    expect(palm.length, 'the palm blocks it').toBeGreaterThan(5)
    // the sheet is lifted off the desk when the hand has it
    expect(fr[ir].pos.y).toBeGreaterThan(0.745 + 0.03)
    expect(inSheet(fr[ir], fr[ir].hands['tor'].pos).x).toBeLessThan(-0.05)
    expect(inSheet(fr[il], fr[il].hands['tol'].pos).x).toBeGreaterThan(0.05)
    expect(fr[il].s - fr[ir].s).toBeGreaterThan(0.1)
  })

  it('toss: both hands are on the folded sheet\'s near half and stay there while the far half opens; no regrip', async () => {
    const r = await play('toss')
    const fr = r.frames
    const ir = takenAt(fr, 'r')
    const il = takenAt(fr, 'l')
    expect(ir).toBeGreaterThan(0)
    expect(il).toBeGreaterThanOrEqual(ir)
    // the sheet is still folded when the right hand holds it, and opens while both hold
    expect(fr[ir].fold).toBeGreaterThan(Math.PI * 0.9)
    const open = fr.filter((f) => f.holder.to && f.fold < 1e-6 && f.opacity === 1)
    expect(open.length).toBeGreaterThan(30)
    // from the first full hold to the end of the reading every frame has a grip command for each hand, and none that is a pinch
    const end = fr.findIndex((f, k) => k > il && f.opacity < 1)
    for (const f of fr.slice(ir, end)) {
      expect(grips(f, 'r').every((c) => c.grip), 'right hand stays on its grip').toBe(true)
      expect(grips(f, 'r').length).toBeGreaterThan(0)
    }
    for (const f of fr.slice(il, end)) {
      expect(grips(f, 'l').every((c) => c.grip), 'left hand stays on its grip').toBe(true)
      expect(grips(f, 'l').length).toBeGreaterThan(0)
    }
    // the hands do not move on the sheet: their place in the sheet's frame is the same folded and open
    const a = inSheet(fr[il], fr[il].hands['tor'].pos)
    const lastOpen = open[open.length - 1]
    const b = inSheet(lastOpen, lastOpen.hands['tor'].pos)
    expect(a.distanceTo(b), 'no regrip: the hand keeps its place on the sheet').toBeLessThan(0.02)
  })
})

describe('one hand busy (#374, paper-pass.md 5 "한 손")', () => {
  // (#416 ①: the receiving hand is the free one in all three methods, the first grab as well as the reading)
  for (const method of ['hand', 'slide', 'toss'] as const)
  for (const [busy, free] of [['r', 'l'], ['l', 'r']] as const) {
    it(`${method}: ${busy} hand holds a mug: only the ${free} hand holds the sheet, by its ${free === 'l' ? 'left' : 'right'} long edge, and the sheet is in front of the body's centre`, async () => {
      const r = await play(method, { busy })
      const fr = r.frames
      expect(fr.some((f) => grips(f, busy).length > 0), `the busy ${busy} hand is left alone`).toBe(false)
      const held = fr.filter((f) => f.opacity === 1 && f.holder.to && holding(f, free))
      expect(held.length).toBeGreaterThan(40)
      const f = held[held.length - 3]
      const h = inSheet(f, f.hands['to' + free].pos)
      expect(free === 'l' ? h.x : -h.x, 'the free hand is on its own side\'s long edge').toBeGreaterThan(0.05)
      // in front of the body's centre line: the sheet's centre is not to either side of the body
      const root = r.rto.parts.root
      const q = root.getWorldQuaternion(new Quaternion())
      const side = new Vector3(1, 0, 0).applyQuaternion(q)
      const off = f.pos.clone().sub(root.getWorldPosition(new Vector3())).dot(side)
      log(`one hand (${busy} busy): the sheet's centre is ${mm(off)} mm from the body's centre line`)
      expect(Math.abs(off)).toBeLessThan(0.02)
      expect(f.faceMinY - 0.01 - f.hands['to' + free].top).toBeGreaterThanOrEqual(0)
    })
  }
})
