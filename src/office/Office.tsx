import { Agents } from './Agents'
import { useOffice } from './nodes'
import type { OfficeWorld } from './world'

/** The whole office as baked (room, desks, wall, lounge) and the agents moving through it. */
export function Office({ world }: { world: OfficeWorld }) {
  const { scene } = useOffice()
  return (
    <>
      <primitive object={scene} />
      <Agents world={world} />
    </>
  )
}
