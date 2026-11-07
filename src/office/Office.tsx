import { useOffice } from './nodes'

/** The whole office as baked: room, desks, wall, lounge, agents. Behaviour comes later (#1, #3). */
export function Office() {
  const { scene } = useOffice()
  return <primitive object={scene} />
}
