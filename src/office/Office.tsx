import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Box3, Vector3, type Object3D } from 'three'
import { openApprovalBox } from './approval/panel'
import { Door } from '../room/Door'
import { ReadyPing } from '../room/RoomUi'
import { ClockRig } from './ClockRig'
import { Agents } from './Agents'
import { useRole } from './ApprovalBox'
import { Icon } from './ApprovalIcons'
import { meshesOf, useOffice } from './nodes'
import { hitBox, useCanvasPick } from './pick'
import { Shelf } from './Shelf'
import { Whiteboard } from './Whiteboard'
import type { OfficeWorld } from './world'

/** The whole office as baked (room, desks, wall, lounge) and the agents moving through it. */
export function Office({ world }: { world: OfficeWorld }) {
  const { scene, nodes } = useOffice()
  return (
    <>
      <primitive object={scene} />
      <Agents world={world} />
      <TrayClick scene={scene} nodes={nodes} />
      <ClockRig scene={scene} nodes={nodes} />
      <Shelf world={world} scene={scene} nodes={nodes} />
      <Whiteboard world={world} scene={scene} />
      {world.approvals && <DoorKey world={world} nodes={nodes} />}
      <Door nodes={nodes} />
      <ReadyPing />
    </>
  )
}

/**
 * The planner's IN tray doubles as the approval box (#64): a click on it opens the panel. The ray tests only the
 * tray (never the agents, their hands or props), so nothing standing in front can block it. When the model has
 * `hit_approval` (an empty with extras {hit:'approval', size:[w,h,d]} wrapping the tray) an invisible box of that
 * size is the target instead, so the empty tray can be clicked too.
 */
function TrayClick({ scene, nodes }: { scene: Object3D; nodes: Record<string, Object3D> }) {
  const targets = useMemo(() => {
    const box = hitBox(scene, 'approval')
    return box ? [box] : nodes.desk_0_in ? meshesOf(nodes.desk_0_in) : []
  }, [scene, nodes])
  useCanvasPick(() => targets, openApprovalBox)
  return null
}

/**
 * The sign-in entry (#64): a small key dot at the door screen's bottom-right corner (as seen from the room).
 * A real button anchored to that corner in 3D; ~25% bright until hovered or focused. Only while signed out.
 */
function DoorKey({ world, nodes }: { world: OfficeWorld; nodes: Record<string, Object3D> }) {
  const src = world.approvals!
  const role = useRole(src)
  const wrap = useRef<HTMLDivElement>(null)
  const anchor = useMemo(() => doorCorner(nodes.screen_door), [nodes])
  const camDir = useMemo(() => new Vector3(), [])
  // hide the dot while the door screen faces away from the camera
  useFrame(({ camera }) => {
    if (!anchor || !wrap.current) return
    camDir.copy(camera.position).sub(anchor.position)
    wrap.current.style.visibility = camDir.dot(anchor.normal) > 0 ? 'visible' : 'hidden'
  })
  if (!anchor || role !== 'visitor') return null
  return (
    <Html position={anchor.position} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={wrap}>
        <button type="button" className="door-key" aria-label="주인 로그인" onClick={() => src.signIn()}>
          <Icon name="key" />
        </button>
      </div>
    </Html>
  )
}

/**
 * The screen's bottom-right corner in world space, nudged inward and a hair off the glass, and its normal.
 * "Bottom-right" is read from the texture: the vertex with the largest u and v (glTF v grows downward).
 */
function doorCorner(node: Object3D | undefined) {
  const mesh = node && meshesOf(node)[0]
  const uv = mesh?.geometry.getAttribute('uv')
  const pos = mesh?.geometry.getAttribute('position')
  if (!mesh || !uv || !pos) return null
  mesh.updateWorldMatrix(true, false)
  let best = 0
  for (let i = 1; i < uv.count; i++) if (uv.getX(i) + uv.getY(i) > uv.getX(best) + uv.getY(best)) best = i
  const corner = new Vector3().fromBufferAttribute(pos, best).applyMatrix4(mesh.matrixWorld)
  // normal from the first triangle (front faces are counter-clockwise)
  const idx = mesh.geometry.index
  const v = (k: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld)
  const [a, b, c] = [v(0), v(1), v(2)]
  const normal = b.sub(a).cross(c.sub(a)).normalize()
  // inward = toward the screen's centre, within its plane
  const toCentre = new Box3().setFromObject(mesh).getCenter(new Vector3()).sub(corner)
  toCentre.sub(normal.clone().multiplyScalar(toCentre.dot(normal))).normalize()
  const position = corner.addScaledVector(toCentre, 0.07).addScaledVector(normal, 0.01)
  return { position, normal }
}
