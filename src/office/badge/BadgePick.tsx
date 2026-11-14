// A click on a robot opens its badge (사원증, office-ui.md 12.1 · 12.1a, #4); the pointer over a robot is a hand. Each robot is
// tested as one invisible box fitted to its body at the moment of the pointer event. The boxes are not in the scene (nothing else
// measures or draws them: robotBox and the camera's clearance must not see them). While the badge is open this also writes where
// that robot's head is on the screen, every frame, for the card to hang over it.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Box3, BoxGeometry, Color, Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three'
import { isReplayActive } from '../../replay/store'
import { useCanvasPick } from '../pick'
import { isTouring } from '../tourStore'
import type { OfficeWorld } from '../world'
import { badgeAnchor, badgeHover, getBadge, openBadge, setBadgeHover } from './badgeStore'

const box = new Box3()
const v = new Vector3()
const CYAN = new Color('#4df3ff')

/** 12.1 hover: the robot's floor ring (agent_i_floor_ring) turns cyan; its meshes get their own material the first time, the colour goes back after */
function tintRing(ring: Object3D | undefined, on: boolean) {
  ring?.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    if (!m.userData.badgeOwnMat) {
      m.material = (m.material as MeshBasicMaterial).clone()
      m.userData.badgeOwnMat = true
      m.userData.badgeColor = (m.material as MeshBasicMaterial).color.clone()
    }
    ;(m.material as MeshBasicMaterial).color.copy(on ? CYAN : (m.userData.badgeColor as Color))
  })
}

export function BadgePick({ world }: { world: OfficeWorld }) {
  const { camera, size } = useThree()
  const unit = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new MeshBasicMaterial({ visible: false }), [])
  const hits = useMemo(() => new Map<string, Mesh>(), [])
  useEffect(
    () => () => {
      unit.dispose()
      material.dispose()
    },
    [unit, material],
  )
  // ?debug: where each robot's head is on the screen (the designer's check and the smoke test click there)
  useEffect(() => {
    if (!world.debug) return
    ;(world as unknown as { badge: unknown }).badge = {
      heads: () =>
        Object.fromEntries(
          Object.entries(world.rigs).map(([id, rig]) => {
            box.setFromObject(rig.group)
            v.set((box.min.x + box.max.x) / 2, (box.min.y * 0.4 + box.max.y * 0.6), (box.min.z + box.max.z) / 2).project(camera)
            return [id, { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, visible: rig.visible && v.z < 1 }]
          }),
        ),
      anchor: () => ({ ...badgeAnchor }),
    }
  }, [world, camera, size])

  const targets = () => {
    // 12.1: not during the tour or the timelapse (the robot click is ignored then)
    if (isTouring() || isReplayActive()) return []
    const out: Object3D[] = []
    for (const [id, rig] of Object.entries(world.rigs)) {
      if (!rig.visible) continue
      box.setFromObject(rig.group)
      if (box.isEmpty()) continue
      let m = hits.get(id)
      if (!m) {
        m = new Mesh(unit, material)
        m.userData.agent = id
        hits.set(id, m)
      }
      box.getCenter(m.position)
      box.getSize(m.scale)
      m.updateMatrixWorld(true)
      out.push(m)
    }
    return out
  }
  const hover = (id: string | null) => {
    const was = badgeHover.agent
    if (was === id) return
    if (was) tintRing(world.rigs[was]?.parts.floorRing, false)
    if (id) tintRing(world.rigs[id]?.parts.floorRing, true)
    setBadgeHover(id)
  }
  useCanvasPick(
    targets,
    (h) => {
      const id = h[0]?.object.userData.agent as string | undefined
      if (id) openBadge(id)
    },
    (over, h) => hover(over ? ((h?.[0]?.object.userData.agent as string | undefined) ?? null) : null),
  )
  useEffect(() => () => hover(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    // the hover tag: over the head; gone when the tour or the timelapse takes the picture
    const hid = badgeHover.agent
    const hrig = hid ? world.rigs[hid] : null
    if (hid && (!hrig || isTouring() || isReplayActive())) hover(null)
    else if (hrig) {
      box.setFromObject(hrig.group)
      v.set((box.min.x + box.max.x) / 2, box.max.y + 0.08, (box.min.z + box.max.z) / 2).project(camera)
      badgeHover.x = ((v.x + 1) / 2) * size.width
      badgeHover.y = ((1 - v.y) / 2) * size.height
    }
    const id = getBadge().agent
    const rig = id ? world.rigs[id] : null
    if (!rig) {
      badgeAnchor.on = false
      return
    }
    box.setFromObject(rig.group)
    v.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera)
    badgeAnchor.x = ((v.x + 1) / 2) * size.width
    badgeAnchor.y = ((1 - v.y) / 2) * size.height
    badgeAnchor.on = v.z < 1
  })
  return null
}
