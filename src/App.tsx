import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Suspense } from 'react'
import { Office } from './office/Office'

/** the diorama's center and the default isometric-ish view from the front right */
const TARGET: [number, number, number] = [-0.25, 0.7, -0.2]
const CAMERA: [number, number, number] = [6.6, 6.2, 7.4]

export function App() {
  return (
    <>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 32, near: 0.1, far: 60, position: CAMERA }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          {/* real-time light for the agents only (everything else is baked): cool fill from the window side,
              a warm key from the lounge lamp, and the work-corner panel overhead */}
          <hemisphereLight args={['#9fb4ff', '#2a1e1a', 0.9]} />
          <directionalLight position={[-2, 4.5, 2]} intensity={1.6} color="#e8ecff" />
          <pointLight position={[1.6, 1.55, 2.25]} intensity={3} distance={5} decay={1.6} color="#ffcf8a" />
          <Office />
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1} luminanceSmoothing={0.3} />
            <Vignette offset={0.3} darkness={0.6} />
          </EffectComposer>
        </Suspense>
        <OrbitControls
          target={TARGET}
          enablePan={false}
          enableDamping
          minDistance={4}
          maxDistance={14}
          minPolarAngle={0.35}
          maxPolarAngle={1.25}
          minAzimuthAngle={-0.15}
          maxAzimuthAngle={1.45}
        />
      </Canvas>
      <p className="hud">
        <b>AGENT OFFICE</b> · 1차 모델 미리보기 · 드래그해서 돌려 보기
      </p>
    </>
  )
}
