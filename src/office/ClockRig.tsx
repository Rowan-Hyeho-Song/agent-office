import { useEffect, useMemo } from 'react'
import { Color, Quaternion, Vector3, type MeshStandardMaterial, type Object3D } from 'three'
import { clockAngles, clockTime, onClockClick, onClockOverride } from './clock'
import { meshesOf } from './nodes'
import { hitBox, useCanvasPick } from './pick'

const Z = new Vector3(0, 0, 1)
const CYAN = new Color('#4df3ff')

/**
 * The wall clock (#82): hands at Seoul time (or the override), updated once a second; hovering the dial (`hit_clock`)
 * lights the hub cyan, a click calls onClockClick. Hands rotate about their local z (the dial normal) on top of the
 * pose rebase() baked into the node.
 */
export function ClockRig({ scene, nodes }: { scene: Object3D; nodes: Record<string, Object3D> }) {
  const box = useMemo(() => hitBox(scene, 'clock'), [scene])
  // per-mesh material copies, so the hover glow never leaks to meshes sharing the exported material
  // (once per mesh: StrictMode runs memos twice)
  const hub = useMemo(() => {
    for (const n of [nodes.clock_hand_h, nodes.clock_hand_m, nodes.clock_hub])
      for (const m of n ? meshesOf(n) : [])
        if (!m.userData.clockMat) {
          const mat = (m.material as MeshStandardMaterial).clone()
          m.material = mat
          m.userData.clockMat = { color: mat.emissive.clone(), k: mat.emissiveIntensity }
        }
    return (nodes.clock_hub ? meshesOf(nodes.clock_hub) : []).map((m) => ({ m: m.material as MeshStandardMaterial, ...m.userData.clockMat }))
  }, [nodes])

  useEffect(() => {
    const hands = [nodes.clock_hand_h, nodes.clock_hand_m]
    if (!hands[0] || !hands[1]) return
    const base = hands.map((h) => h.quaternion.clone())
    const turn = new Quaternion()
    const apply = () => {
      const a = clockAngles(clockTime())
      ;[a.hour, a.minute].forEach((r, i) => hands[i].quaternion.copy(base[i]).multiply(turn.setFromAxisAngle(Z, r)))
    }
    apply()
    const id = setInterval(apply, 1000)
    const off = onClockOverride(apply)
    return () => {
      clearInterval(id)
      off()
      hands.forEach((h, i) => h.quaternion.copy(base[i]))
    }
  }, [nodes])

  useCanvasPick(
    () => (box ? [box] : []),
    () => onClockClick(),
    (over) =>
      hub.forEach(({ m, color, k }) => {
        m.emissive.copy(over ? CYAN : color)
        m.emissiveIntensity = over ? 2 : k
      }),
  )
  return null
}
