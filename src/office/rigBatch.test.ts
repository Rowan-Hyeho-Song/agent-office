// #676 a robot in a few draws: one SkinnedMesh per material over its body and hands, each vertex where its own (moving) mesh puts it; the robot's
// own changing parts and transparent ones are left out; the meshes it stands for leave the camera's layer and come back on dispose
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BATCHED_LAYER, batchable, batchRig } from './rigBatch'

const shell = new MeshStandardMaterial({ name: 'bot_shell' })
const pin = new MeshStandardMaterial({ name: 'joint_pin' })
const part = (name: string, mat = shell, at: [number, number, number] = [0, 0, 0]) => {
  const m = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), mat)
  m.name = name
  m.position.set(...at)
  return m
}

/** a small robot: a root with a head and a face, and a hand with a two-segment finger (each segment a shell and a pin) */
function robot() {
  const scene = new Group()
  const root = new Object3D()
  root.name = 'agent_0'
  const head = part('agent_0_head_1', shell, [0, 1, 0])
  const face = new Mesh(new BoxGeometry(0.1, 0.1, 0.01), new MeshBasicMaterial())
  face.name = 'agent_0_face'
  head.add(face)
  const beam = new Mesh(new BoxGeometry(0.1, 1, 0.1), new MeshBasicMaterial({ transparent: true }))
  beam.name = 'agent_0_beam'
  root.add(head, beam)
  const hand = part('agent_0_hand_l_1', shell, [0.3, 0.8, 0])
  const s1 = part('agent_0_hand_l_f1_1_2', shell, [0, 0.03, 0])
  const p1 = part('agent_0_hand_l_f1_1_1', pin, [0, 0.02, 0])
  const s2 = part('agent_0_hand_l_f1_2_2', shell, [0, 0.03, 0])
  const p2 = part('agent_0_hand_l_f1_2_1', pin, [0, 0.02, 0])
  hand.add(s1)
  s1.add(p1, s2)
  s2.add(p2)
  scene.add(root, hand)
  scene.updateMatrixWorld(true)
  return { scene, root, head, face, beam, hand, s1, s2, p1, p2 }
}

describe('a robot in a few draws', () => {
  it("takes the opaque parts, not the robot's own changing ones (face, beam) nor transparent ones", () => {
    const r = robot()
    const names = batchable([r.root, r.hand]).map((m) => m.name)
    expect(names).toContain('agent_0_head_1')
    expect(names).toContain('agent_0_hand_l_f1_2_1')
    expect(names).not.toContain('agent_0_face')
    expect(names).not.toContain('agent_0_beam')
  })

  it('one draw per material: the shells (head, palm, two segments) and the pins', () => {
    const r = robot()
    const b = batchRig(r.scene, [r.root, r.hand], 'agent_0')!
    expect(b.meshes.map((m) => m.userData.batchOf).sort()).toEqual([2, 4])
    expect(b.sources).toBe(6)
    // the sources leave the camera's layer; the face and the beam stay drawn as they were
    for (const m of [r.head, r.s1, r.s2, r.p1, r.p2, r.hand]) expect([m.layers.isEnabled(BATCHED_LAYER), m.layers.isEnabled(0)]).toEqual([true, false])
    expect(r.face.layers.mask).toBe(1)
    expect(r.beam.layers.mask).toBe(1)
    b.dispose()
    for (const m of [r.head, r.s1, r.p2]) expect(m.layers.mask).toBe(1)
    expect(r.scene.children.some((c) => (c as { isSkinnedMesh?: boolean }).isSkinnedMesh)).toBe(false)
  })

  it('every vertex goes where its own mesh puts it, as the fingers bend and the hand moves', () => {
    const r = robot()
    const b = batchRig(r.scene, [r.root, r.hand], 'agent_0')!
    // the rig moves its nodes: the hand turns and walks, both segments bend, the head nods
    r.hand.position.add(new Vector3(0.5, 0, -0.2))
    r.hand.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.7)
    r.s1.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
    r.s2.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.9)
    r.head.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3))
    r.scene.updateMatrixWorld(true)
    let worst = 0
    for (const sm of b.meshes) {
      const pos = sm.geometry.getAttribute('position')
      const bone = sm.geometry.getAttribute('skinIndex')
      for (let i = 0; i < pos.count; i++) {
        const drawn = sm.applyBoneTransform(i, new Vector3().fromBufferAttribute(pos, i)).applyMatrix4(sm.matrixWorld)
        // the same vertex of the source mesh, where the source mesh is now
        const src = sm.skeleton.bones[bone.getX(i)] as unknown as Mesh
        const k = i - firstOf(sm, bone.getX(i))
        const truth = new Vector3().fromBufferAttribute(src.geometry.getAttribute('position'), k).applyMatrix4(src.matrixWorld)
        worst = Math.max(worst, drawn.distanceTo(truth))
      }
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it("a hidden part (or one under a hidden parent) is not drawn: its bone collapses; shown again, it is back", () => {
    const r = robot()
    const b = batchRig(r.scene, [r.root, r.hand], 'agent_0')!
    const shells = b.meshes.find((m) => m.userData.batchOf === 4)!
    const bones = shells.skeleton.bones as unknown as Object3D[]
    const at = (o: Object3D) => bones.indexOf(o)
    const zero = (i: number) => Array.from(shells.skeleton.boneMatrices!.slice(i * 16, i * 16 + 16)).every((v) => v === 0)
    r.hand.visible = false
    shells.skeleton.update()
    expect([r.hand, r.s1, r.s2].map((o) => zero(at(o)))).toEqual([true, true, true])
    expect(zero(at(r.head))).toBe(false)
    r.hand.visible = true
    r.head.visible = false
    shells.skeleton.update()
    expect([r.hand, r.s1, r.s2].map((o) => zero(at(o)))).toEqual([false, false, false])
    expect(zero(at(r.head))).toBe(true)
  })

  it('with no parts of its own to leave out (the shelf), every shared material is taken', () => {
    const r = robot()
    const names = batchable([r.root], null).map((m) => m.name)
    expect(names).toContain('agent_0_face')
    expect(names).not.toContain('agent_0_beam') // transparent
  })

  it('nothing to merge: no batch', () => {
    const scene = new Group()
    const one = part('agent_0_head_1')
    scene.add(one)
    expect(batchRig(scene, [one], 'agent_0')).toBeNull()
    expect(one.layers.mask).toBe(1)
  })
})

/** the first merged vertex of a bone (its source's vertices are laid one after another, bone by bone) */
function firstOf(sm: { geometry: { getAttribute(n: string): { count: number; getX(i: number): number } } }, bone: number) {
  const idx = sm.geometry.getAttribute('skinIndex')
  for (let i = 0; i < idx.count; i++) if (idx.getX(i) === bone) return i
  return -1
}
