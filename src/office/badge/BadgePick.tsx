// A click on a robot opens its badge (사원증, office-ui.md 12.1 · 12.1a, #4); the pointer over a robot is a hand. Each robot is
// tested as one invisible box fitted to its body at the moment of the pointer event. The boxes are not in the scene (nothing else
// measures or draws them: robotBox and the camera's clearance must not see them). While the badge is open this also writes where
// that robot's head is on the screen, every frame, for the card to hang over it.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three'
import { isReplayActive } from '../../replay/store'
import { useCanvasPick } from '../pick'
import { isTouring } from '../tourStore'
import type { OfficeWorld } from '../world'
import { badgeAnchor, getBadge, openBadge } from './badgeStore'

const box = new Box3()
const v = new Vector3()

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
  useCanvasPick(targets, (h) => {
    const id = h[0]?.object.userData.agent as string | undefined
    if (id) openBadge(id)
  })

  useFrame(() => {
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
