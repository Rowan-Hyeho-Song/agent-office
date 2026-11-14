import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { afterFirstScreen } from './office/atlases'
import { AgentList } from './office/AgentList'
import { AgentBadge } from './office/badge/AgentBadge'
import { ApprovalBox } from './office/ApprovalBox'
import { CornerDock } from './office/CornerDock'
import { SidePanel } from './office/SidePanel'
import { DocsLauncherStub } from './office/DocsLauncherStub'
import { ReplayEntry } from './replay/ReplayEntry'
import { SideViewOffset } from './office/sidePanelRig'
import { CameraHint, CameraRig } from './office/cameraRig'
import { EdgeHintRig, EdgeHints } from './office/EdgeHints'
import { TourBar } from './office/TourBar'
import { TourRig } from './office/TourRig'
import { CAMERA_FAR, LAMP_POS } from './office/room'
import { VIEW } from './office/view'
import { Office } from './office/Office'
import { CAMERA_FOV, HOME_POS, HOME_TARGET, useCameraBusy } from './room/Door'
import { RoomUi } from './room/RoomUi'
import { createWorld } from './office/world'
import { SoundButton } from './audio/SoundButton'
import { ViewToggle } from './office/ViewToggle'
import { SoundListener, SoundRoot } from './audio/SoundRoot'

// #402: UI that the first screen does not show is its own chunk, fetched once the first screen has been shown (ReadyPing), so it
// never competes with the room's own downloads. Each one is a store-driven panel: the stores stay in the main bundle, so an
// open request made before the chunk arrives is still there when the panel mounts.
const DocsViewer = lazy(() => import('./office/DocsViewer').then((m) => ({ default: m.DocsViewer })))
const BoardView = lazy(() => import('./office/boardView/BoardView').then((m) => ({ default: m.BoardView })))
const BoardCamera = lazy(() => import('./office/boardView/BoardCamera').then((m) => ({ default: m.BoardCamera })))
const ReplayDriver = lazy(() => import('./replay/ReplayDriver').then((m) => ({ default: m.ReplayDriver })))
const ReplayHud = lazy(() => import('./replay/ReplayHud').then((m) => ({ default: m.ReplayHud })))
const SoundPanel = lazy(() => import('./audio/SoundPanel').then((m) => ({ default: m.SoundPanel })))
const DebugPanel = lazy(() => import('./office/DebugPanel').then((m) => ({ default: m.DebugPanel })))
const SoundDebug = lazy(() => import('./audio/SoundDebug').then((m) => ({ default: m.SoundDebug })))

/** true once the first screen has been shown: the later chunks are not requested before that */
function useFirstScreenShown() {
  const [shown, setShown] = useState(false)
  useEffect(() => afterFirstScreen(() => setShown(true)), [])
  return shown
}

/** a lazy panel: nothing before the first screen, then its own chunk; each one apart, so a slow or failed chunk holds back no other */
function Later({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Suspense fallback={null}>{children}</Suspense> : null
}

/** ?debug=1&view=top: straight down over the floor plan, to check routes against the furniture */
const TOP: [number, number, number] = [0, 13, 0.01]

export function App() {
  const [{ world, top, close, camera, target }] = useState(() => {
    const q = new URLSearchParams(location.search)
    const debug = q.has('debug')
    // ?debug=1&cam=x,y,z,tx,ty,tz: a close-up for screenshots (any angle, no orbit limits)
    const cam = debug ? (q.get('cam')?.split(',').map(Number) ?? null) : null
    const close = cam?.length === 6 && cam.every(Number.isFinite) ? cam : null
    // the default isometric-ish view from the front right (room.ts), or the portrait-phone one (portraitCamera.ts); only the start pose
    return { world: createWorld(debug, q), top: debug && q.get('view') === 'top', close, camera: HOME_POS.toArray(), target: HOME_TARGET.toArray() }
  })
  useEffect(() => {
    // debug only: lets screenshot scripts read the nav check and drive the fake source
    if (world.debug) (window as unknown as { __office: typeof world }).__office = world
  }, [world])
  const busy = useCameraBusy()
  const later = useFirstScreenShown()
  // the free camera's limits apply to the normal view (not the ?debug close-up or the top-down check)
  const limits = !top && !close
  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: CAMERA_FOV, near: VIEW.cameraNear, far: CAMERA_FAR, position: close ? (close.slice(0, 3) as [number, number, number]) : top ? TOP : (camera as [number, number, number]) }}
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
          target={close ? (close.slice(3) as [number, number, number]) : top ? [0, 0, 0] : (target as [number, number, number])}
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
        <TourRig limits={limits} world={world} />
        <Later on={later}>
          <BoardCamera />
        </Later>
        <SideViewOffset />
        <EdgeHintRig limits={limits} />
        <SoundListener world={world} />
      </Canvas>
      <p className="hud">
        <b>AGENT OFFICE</b> · 드래그해서 돌려 보기
      </p>
      <CameraHint enabled={limits && !busy} />
      <EdgeHints />
      <TourBar world={world} />
      <AgentList world={world} />
      <AgentBadge world={world} />
      <CornerDock />
      <SidePanel world={world} />
      <ApprovalBox world={world} />
      <DocsLauncherStub world={world} />
      <ReplayEntry />
      <RoomUi />
      <SoundRoot world={world} />
      <SoundButton />
      <ViewToggle />
      <Later on={later}>
        <DocsViewer world={world} />
      </Later>
      <Later on={later}>
        <BoardView world={world} />
      </Later>
      <Later on={later}>
        <ReplayDriver world={world} />
      </Later>
      <Later on={later}>
        <ReplayHud world={world} />
      </Later>
      <Later on={later}>
        <SoundPanel />
      </Later>
      {world.debug && (
        <Later on={later}>
          <DebugPanel world={world} />
        </Later>
      )}
      {world.debug && (
        <Later on={later}>
          <SoundDebug />
        </Later>
      )}
    </>
  )
}
