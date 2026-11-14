// #397: the coffee bar's tour cut was half hidden behind the fiddle-leaf fig's crown. The tour's line of sight now keeps out of the leafy
// plants' crowns (clearance.ts leafBoxes), so the cut takes a composition on the other side. On the baked model.
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { clearBoxes, furnitureBoxes, leafBoxes, setClearFurniture } from './clearance'
import { SPOTS } from './navSpots.fixture'
import { sightClear, standPose, type Clearance, type Pose } from './tour'
import { VIEW } from './view'
import { prepareView } from './walls'

stubCanvas()

describe('the tour looks past the fig (#397)', () => {
  it('the fig has a crown box; at the coffee bar some composition looked through it, now none does and one is still found', async () => {
    const { scene } = await loadOffice()
    setClearFurniture(prepareView(scene))
    const leaves = leafBoxes(scene)
    expect(leaves).toHaveLength(1)
    const [lb] = leaves
    // around the pot at (4.5, 1.35), above it
    expect(lb.min[0]).toBeLessThan(4.5)
    expect(lb.max[0]).toBeGreaterThan(4.5)
    expect(lb.min[2]).toBeLessThan(1.35)
    expect(lb.max[2]).toBeGreaterThan(1.35)
    expect(lb.min[1]).toBeGreaterThanOrEqual(0.6)

    const spot = SPOTS.find((s) => s.id === 'coffee')!
    const at = { x: spot.x, z: spot.z, ry: spot.ry }
    const throughLeaves = (p: Pose | null) => !!p && !sightClear(p.pos, p.target, { boxes: [], margin: 0, sight: leaves })
    const before: Clearance = { boxes: clearBoxes([]), margin: VIEW.clear.margin, sight: [...furnitureBoxes()] }
    const after: Clearance = { ...before, sight: [...furnitureBoxes(), ...leaves] }
    const was = [0, 1, 2].map((v) => standPose(at, before, 2.2, 1.7, 1.0, v))
    const now = [0, 1, 2].map((v) => standPose(at, after, 2.2, 1.7, 1.0, v))
    expect(was.some(throughLeaves)).toBe(true)
    expect(now.some(throughLeaves)).toBe(false)
    expect(now.some((p) => p !== null)).toBe(true)
  })
})
