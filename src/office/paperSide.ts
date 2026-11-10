// The loose sheet held by its long sides for reading (#374, docs/design/paper-pass.md 5, grips.md "낱장 옆 쥐고 읽기"): the grip target the
// fit (gripFit.test.ts, gripTargets.resolveTarget kind 'paper_side') and the passes (paperRun.ts) both use.
//
// The bake's `prop_paper_grip_side_<l|r>` is a child of the lower half `prop_paper_a` (so it follows the fold), 1.5 cm in from the long edge and 45 %
// up from the near short edge, with `_contact_thumb` (text face, outward normal +y) and `_contact_index` (back face, -y). `l` is the reader's left
// long edge (+x of the sheet's frame), `r` the right (-x). A missing empty is computed from the sheet's size.
import { Box3, Euler, MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type { BookBox } from './bookGeom'
import { GRIPS, pointsAtJoints, tableJoints } from './grip'
import { fingerModelOf, type Hand } from './rig'
import type { Contact, GripTarget } from './gripTargets'
import { PAPER } from './paperProp'
import { SHOULDER } from './reach'

export const SIDE_OBJ = 'prop_paper_a'

/** where the sheet is read (paper-pass.md 5): its centre 0.26 in front of the face screen's centre and `down` below it, tilted back 40 degrees from vertical.
 *  `down` is tuned (paperSide.test.ts) so that the sheet's top edge and the hands' tops stay 1 cm under the screen's bottom edge */
export const VIEW = { ahead: 0.26, down: 0.22, tilt: MathUtils.degToRad(40) }

/** how much a degree of wrist bend above the aim costs the fit, against the squared fingertip errors in m² (grip.ts solveContacts) */
const BEND_W = 1e-4
const FINGER_NAMES = ['index', 'middle', 'ring', 'little'] as const

/**
 * The fingers that are not baked contacts (the middle, ring and little: the bake has only the index and the thumb) must lie on the back, under the sheet:
 * a cost for every sampled point of their centre lines that is over the sheet's footprint and above its back face. The fingers on a contact are held by the fit.
 */
function backSideCost(hand: Hand, side: 'l' | 'r', m: Matrix4, fits: readonly { finger: string; joints: number[] }[]) {
  let cost = 0
  const hold = GRIPS.paper_side[side]!.hold
  const p = new Vector3()
  const a = new Vector3()
  for (const [k, f] of FINGER_NAMES.entries()) {
    const model = fingerModelOf(hand, k, side)
    if (!model) continue
    const joints = fits.find((x) => x.finger === f)?.joints ?? tableJoints(model, hold[k], 0)
    const pts = pointsAtJoints(model, joints)
    for (let i = 0; i + 1 < pts.length; i++)
      for (let s = 0; s <= 4; s++) {
        a.copy(pts[i]).lerp(pts[i + 1], s / 4)
        p.copy(a).applyMatrix4(m)
        if (Math.abs(p.x) < PAPER.w / 2 && Math.abs(p.z) < PAPER.l / 2 && p.y > -0.0005) cost += 4000 * (p.y + 0.0005) ** 2
      }
  }
  return cost
}

/** the wrist bend the fit keeps (grips.md 1.1: at most 30 degrees; the fit aims lower so the pose has some room) */
const BEND_AIM = MathUtils.degToRad(16)

/**
 * The angle between a hand's fingers and its arm (shoulder -> hand) when the sheet is at its viewing place in front of the agent at rest; `m` is the hand's
 * frame in the sheet's frame. The generator adds a cost above BEND_AIM, so the stored offsets keep the wrist within its limit at the viewing place.
 */
const FACES = new WeakMap<Object3D, Vector3>()
export function viewBend(scene: Object3D, hand: Object3D, side: 'l' | 'r', m: Matrix4): number {
  const id = /^(agent_[0-9]+)/.exec(hand.name)?.[1]
  const root = id ? scene.getObjectByName(id) : null
  const face = id && scene.getObjectByName(`${id}_face`)
  if (!root || !face) return 0
  let c = FACES.get(root)
  if (!c) {
    root.updateWorldMatrix(true, true)
    FACES.set(root, (c = root.worldToLocal(new Box3().setFromObject(face).getCenter(new Vector3()))))
  }
  // the sheet's frame in the agent's frame (forward is -z): top edge up and leaning away, text side toward the face and up
  const top = new Vector3(0, Math.cos(VIEW.tilt), -Math.sin(VIEW.tilt))
  const normal = new Vector3(0, Math.sin(VIEW.tilt), Math.cos(VIEW.tilt))
  const R = new Matrix4().makeBasis(new Vector3().crossVectors(normal, top), normal, top)
  const centre = new Vector3(0, c.y - VIEW.down, c.z - VIEW.ahead)
  const at = new Vector3().setFromMatrixPosition(m).applyMatrix4(R).add(centre)
  const fingers = new Vector3(0, 1, 0).transformDirection(m).transformDirection(R)
  const shoulder = new Vector3((side === 'l' ? -1 : 1) * SHOULDER.x, SHOULDER.y, SHOULDER.z)
  return fingers.angleTo(at.sub(shoulder))
}

/** the sheet as a solid for the fit: a slab of its size in the sheet's frame, so no finger goes through it */
export function paperSolids(): BookBox[] {
  const h = PAPER.t / 2
  return [{ name: 'paper', half: 'r', min: new Vector3(-PAPER.w / 2, -h, -PAPER.l / 2), max: new Vector3(PAPER.w / 2, h, PAPER.l / 2), toBox: new Matrix4() }]
}

/** where the side grip sits in the sheet's frame (computed): x the reader's left (+) or right (-) long edge, z at 45 % of the length */
export const sideSpot = (side: 'l' | 'r') => new Vector3((side === 'l' ? 1 : -1) * (PAPER.w / 2 - 0.015), 0, -PAPER.l / 2 + 0.45 * PAPER.l)

/** the grip target of the sheet's `side` long edge; `axis` is the contact nodes' outward normal axis (gripTargets.contactAxis) */
export function resolvePaperSideTarget(scene: Object3D, side: 'l' | 'r', axis: 'y' | 'z'): GripTarget | null {
  const obj = scene.getObjectByName(SIDE_OBJ)
  if (!obj) return null
  scene.updateMatrixWorld(true)
  const inv = new Matrix4().copy(obj.matrixWorld).invert()
  const local = (o: Object3D) => inv.clone().multiply(o.matrixWorld)
  const name = `prop_paper_grip_side_${side}`
  const spot = sideSpot(side)
  const make = (p: Vector3, rx: number, rz: number) => new Matrix4().compose(p, new Quaternion().setFromEuler(new Euler(rx, 0, rz, 'XYZ')), new Vector3(1, 1, 1))
  const node = scene.getObjectByName(name)
  const pg = node ? local(node) : make(spot, 0, ((side === 'l' ? -1 : 1) * Math.PI) / 2)
  const normal = axis === 'z' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const contacts: Contact[] = (['index', 'thumb'] as const).map((finger) => {
    const c = scene.getObjectByName(`${name}_contact_${finger}`)
    const y = (finger === 'thumb' ? 1 : -1) * (PAPER.t / 2)
    const m = c ? local(c) : make(spot.clone().setY(y), ((finger === 'thumb' ? -1 : 1) * Math.PI) / 2, 0)
    return { finger, p: new Vector3().setFromMatrixPosition(m), n: normal.clone().transformDirection(m) }
  })
  const cost: GripTarget['cost'] = (m, hand, fits) => {
    const excess = Math.max(0, viewBend(scene, hand.node, side, m) - BEND_AIM)
    return BEND_W * excess * excess + backSideCost(hand, side, m, fits)
  }
  return { key: `${SIDE_OBJ}:${side}`, kind: 'paper_side', side, obj, pg, contacts, solids: paperSolids(), cost }
}
