import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Suspense, useEffect, useState } from 'react'
import { AgentList } from './office/AgentList'
import { ApprovalBox } from './office/ApprovalBox'
import { DebugPanel } from './office/DebugPanel'
import { Office } from './office/Office'
import { createWorld } from './office/world'

/** the diorama's center and the default isometric-ish view from the front right */
const TARGET: [number, number, number] = [-0.25, 0.7, -0.2]
const CAMERA: [number, number, number] = [6.6, 6.2, 7.4]
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
  return (
    <>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 32, near: 0.1, far: 60, position: close ? (close.slice(0, 3) as [number, number, number]) : top ? TOP : CAMERA }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          {/* real-time light for the agents only (everything else is baked): cool fill from the window side,
              a warm key from the lounge lamp, and the work-corner panel overhead */}
          <hemisphereLight args={['#9fb4ff', '#2a1e1a', 0.9]} />
          <directionalLight position={[-2, 4.5, 2]} intensity={1.6} color="#e8ecff" />
          <pointLight position={[1.6, 1.55, 2.25]} intensity={3} distance={5} decay={1.6} color="#ffcf8a" />
          <Office world={world} />
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1} luminanceSmoothing={0.3} />
            <Vignette offset={0.3} darkness={0.6} />
          </EffectComposer>
        </Suspense>
        <OrbitControls
          target={close ? (close.slice(3) as [number, number, number]) : top ? [0, 0, 0] : TARGET}
          enablePan={false}
          enableDamping
          minDistance={close ? 0.3 : 4}
          maxDistance={14}
          minPolarAngle={top || close ? 0 : 0.35}
          maxPolarAngle={close ? Math.PI : 1.25}
          minAzimuthAngle={top || close ? -Infinity : -0.15}
          maxAzimuthAngle={top || close ? Infinity : 1.45}
        />
      </Canvas>
      <p className="hud">
        <b>AGENT OFFICE</b> · 드래그해서 돌려 보기
      </p>
      <AgentList world={world} />
      <ApprovalBox world={world} />
      {world.debug && <DebugPanel world={world} />}
    </>
  )
}
