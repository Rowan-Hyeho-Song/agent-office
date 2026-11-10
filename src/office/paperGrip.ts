// A hand holding the loose sheet by a long side (#374, paper-pass.md 3 and 5, grips.md "낱장 옆 쥐고 읽기"): where the hand goes for the sheet's pose
// and fold, and the fingers' 20 joint angles from the pre-grip (mix 0) to the closed grip (mix 1). The same math as PlayStage.grip, for the
// pass scripts (paperRun.ts), which place the sheet themselves.
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { DIP_K } from './handPose'
import { GRIPS, handFor } from './grip'
import { fitFingers, handGripMatrix, offsetOf, resolveTarget, type GripTarget } from './gripTargets'
import type { AgentRig } from './rig'
import { SIDE_OBJ } from './paperSide'

const FINGERS = ['index', 'middle', 'ring', 'little'] as const
const AXIS_X = new Vector3(1, 0, 0)
const FOLD = new Quaternion()

/** the lower half's world matrix for the sheet at `pos`, `quat` and fold (paperProp.placePaper: the lower half turns +fold about its x) */
export function halfMatrix(pos: Vector3, quat: Quaternion, fold: number, out = new Matrix4()) {
  FOLD.setFromAxisAngle(AXIS_X, fold)
  return out.compose(pos, quat.clone().multiply(FOLD), new Vector3(1, 1, 1))
}

export class SideGrips {
  private targets = new Map<'l' | 'r', GripTarget | null>()
  private holds = new Map<string, number[]>()

  constructor(private readonly scene: Object3D) {}

  target(side: 'l' | 'r') {
    if (!this.targets.has(side)) this.targets.set(side, resolveTarget(this.scene, SIDE_OBJ, 'paper_side', side))
    return this.targets.get(side)!
  }

  /** the closed fingers for this agent's hand: the table's hold with each contact finger replaced by the fitted joints (what PlayStage.holdFit does) */
  private hold(rig: AgentRig, side: 'l' | 'r', t: GripTarget) {
    const seat = Number(rig.id.split('_')[1])
    const key = `${rig.id}:${side}`
    let hold = this.holds.get(key)
    if (!hold) {
      hold = rig.curlVec(side, GRIPS.paper_side[side]!.hold)
      for (const f of fitFingers(t, rig.parts.hands[side], offsetOf(t.key, seat))) {
        if (f.finger === 'thumb') hold.splice(16, 4, ...f.joints)
        else {
          const k = FINGERS.indexOf(f.finger)
          hold[k * 4] = f.joints[0]
          hold[k * 4 + 1] = f.joints[1]
          hold[k * 4 + 2] = DIP_K[k] * f.joints[1]
          hold[k * 4 + 3] = f.joints[2]
        }
      }
      this.holds.set(key, hold)
    }
    return hold
  }

  /** the hand's world matrix and finger angles for the lower half at `half`; null when the model has no side grip */
  place(rig: AgentRig, side: 'l' | 'r', half: Matrix4, mix: number): { target: Matrix4; angles: number[] } | null {
    const t = this.target(side)
    if (!t) return null
    const hand = rig.parts.hands[side]
    const spec = GRIPS.paper_side[side]!
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(half, t.pg, handGripMatrix(hand)).multiply(offsetOf(t.key, seat))
    const pre = rig.curlVec(side, spec.pre)
    const hold = this.hold(rig, side, t)
    const k = Math.min(1, Math.max(0, mix))
    return { target, angles: pre.map((x, i) => x + (hold[i] - x) * k) }
  }
}
