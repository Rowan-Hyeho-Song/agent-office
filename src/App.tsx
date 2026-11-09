import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Suspense, useEffect, useState } from 'react'
import { AgentList } from './office/AgentList'
import { ApprovalBox } from './office/ApprovalBox'
import { CornerDock } from './office/CornerDock'
import { DebugPanel } from './office/DebugPanel'
import { DocsViewer } from './office/DocsViewer'
import { SidePanel } from './office/SidePanel'
import { SideViewOffset } from './office/sidePanelRig'
import { CameraHint, CameraRig } from './office/cameraRig'
import { CAMERA_FAR, DEFAULT_CAMERA, DEFAULT_TARGET, LAMP_POS } from './office/room'
import { VIEW } from './office/view'
import { Office } from './office/Office'
import { useCameraBusy } from './room/Door'
import { RoomUi } from './room/RoomUi'
import { createWorld } from './office/world'
import { ReplayDriver } from './replay/ReplayDriver'
import { ReplayHud } from './replay/ReplayHud'
import { SoundButton } from './audio/SoundButton'
import { SoundDebug } from './audio/SoundDebug'
import { SoundListener, SoundRoot } from './audio/SoundRoot'

/** the default isometric-ish view from the front right (room.ts) */
const TARGET = [...DEFAULT_TARGET] as [number, number, number]
const CAMERA = [...DEFAULT_CAMERA] as [number, number, number]
/** ?debug=1&view=top: straight down over the floor plan, to check routes against the furniture */
const TOP: [number, number, number] = [0, 13, 0.01]

export function App() {
  const [{ world, top, close }] = useState(() => {
    const q = new URLSearchParams(location.search)
    const debug = q.has('debug')
    // ?debug=1&cam=x,y,z,tx,ty,tz: a close-up for screenshots (any angle, no orbit limits)
    const cam = debug ? (q.get('cam')?.split(',').map(Number) ?? null) : null
    const close = cam?.length === 6 && cam.every(Number.isFinite) ? cam : null
    return { world: createWorld(debug, q), top: debug && q.get('view') === 'top', close }
  })
  useEffect(() => {
    // debug only: lets screenshot scripts read the nav check and drive the fake source
    if (world.debug) (window as unknown as { __office: typeof world }).__office = world
  }, [world])
  const busy = useCameraBusy()
  // the free camera's limits apply to the normal view (not the ?debug close-up or the top-down check)
  const limits = !top && !close
  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 32, near: VIEW.cameraNear, far: CAMERA_FAR, position: close ? (close.slice(0, 3) as [number, number, number]) : top ? TOP : CAMERA }}
        gl={{ antialias: true, stencil: true }}
      >
        <Suspense fallback={null}>
          {/* real-time light for the agents and live props only (everything else is baked): a neutral-warm fill and key,
              so their whites read like the baked room and the desk room (#173: the cool fill made them violet-grey, a mug
              measured #878ca2). The key is soft and the ground bounce light, so the tops do not burn out: from above a mug's
              brightest face is #f4eee2 and its bright 20% #d6d0c4 (designer: at most #f4efe6, at least #d0ccc4). A warm key
              from the lounge lamp, and the work-corner panel overhead */}
          <hemisphereLight args={['#fffaf3', '#c2b6a6', 1.82]} />
          <directionalLight position={[-2, 4.5, 2]} intensity={1.3} color="#fff8ef" />
          <pointLight position={[...LAMP_POS]} intensity={3} distance={5} decay={1.6} color="#ffcf8a" />
          <Office world={world} />
          <EffectComposer multisampling={0} stencilBuffer>
            <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1} luminanceSmoothing={0.3} />
            <Vignette offset={0.3} darkness={0.6} />
          </EffectComposer>
        </Suspense>
        {/* not mounted while the door animation owns the camera: nothing can clamp the door pose, and the controls
            start from the finished home pose */}
        {!busy && (
        <OrbitControls
          makeDefault
          target={close ? (close.slice(3) as [number, number, number]) : top ? [0, 0, 0] : TARGET}
          enablePan={limits}
          screenSpacePanning={false}
          enableDamping
          minDistance={close ? 0.3 : VIEW.distance[0]}
          maxDistance={close ? 60 : VIEW.distance[1]}
          minPolarAngle={top || close ? 0 : VIEW.polar[0]}
          maxPolarAngle={close ? Math.PI : VIEW.polar[1]}
        />
        )}
        <CameraRig limits={limits} world={world} />
        <SideViewOffset />
        <SoundListener />
      </Canvas>
      <p className="hud">
        <b>AGENT OFFICE</b> · 드래그해서 돌려 보기
      </p>
      <CameraHint enabled={limits && !busy} />
      <AgentList world={world} />
      <CornerDock />
      <SidePanel world={world} />
      <ApprovalBox world={world} />
      <DocsViewer world={world} />
      <RoomUi />
      <ReplayDriver world={world} />
      <ReplayHud world={world} />
      {world.debug && <DebugPanel world={world} />}
      <SoundRoot world={world} />
      <SoundButton />
      {world.debug && <SoundDebug />}
    </>
  )
}
