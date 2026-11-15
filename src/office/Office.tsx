import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { openApprovalBox } from './approval/panel'
import { Door } from '../room/Door'
import { Frames } from './Frames'
import { ReadyPing } from '../room/RoomUi'
import { ClockRig } from './ClockRig'
import { SpeakerClick } from './SpeakerClick'
import { BadgePick } from './badge/BadgePick'
import { TreatRig } from './visit/TreatRig'
import { Bulletin } from './visit/Bulletin'
import { TurntablePick } from './TurntablePick'
import { KeyRack } from './KeyRack'
import { FramePick } from './FramePick'
import { Agents } from './Agents'
import { meshesOf, useOffice } from './nodes'
import { hitBox, useCanvasPick } from './pick'
import { Shelf } from './Shelf'
import { Whiteboard } from './Whiteboard'
import { Cutaway } from './cutaway'
import { setClearFurniture } from './clearance'
import { Outside } from './OutsideView'
import type { OfficeWorld } from './world'

/** The whole office as baked (room, desks, wall, lounge) and the agents moving through it. */
export function Office({ world }: { world: OfficeWorld }) {
  const { scene, nodes, fades } = useOffice()
  // the furniture boxes keep the camera clear of the furniture (#208); nothing fades (#253)
  useEffect(() => setClearFurniture(fades), [fades])
  return (
    <>
      <primitive object={scene} />
      <Cutaway scene={scene} />
      <Outside nodes={nodes} world={world} />
      <Agents world={world} />
      <BadgePick world={world} />
      <TreatRig world={world} />
      <Bulletin world={world} scene={scene} />
      <TrayClick scene={scene} nodes={nodes} />
      <ClockRig scene={scene} nodes={nodes} />
      <SpeakerClick nodes={nodes} />
      <TurntablePick scene={scene} />
      <Shelf world={world} scene={scene} nodes={nodes} />
      <Whiteboard world={world} scene={scene} />
      {world.approvals && <KeyRack world={world} scene={scene} nodes={nodes} />}
      <Door nodes={nodes} />
      <Frames nodes={nodes} />
      <FramePick scene={scene} />
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
