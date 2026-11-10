// The sofa's "knee row" (#341): the strip between the low table and the sofa's long side is 0.75 m wide, a body (R 0.3) fits
// but not two, and the normal furniture clearance (a whole R) would shut it. The designer's rule for the strip, kept here as
// plain geometry so the grid (clearance), the planner (one standing body at a time, slow, facing the sofa) and the glb reader
// agree on one rectangle. Pure apart from reading the glb node. No zone in the scene -> none of this runs.

import type { Object3D } from 'three'

/** the rectangle: centre, its rotation, the yaw a body in it faces, and its size */
export interface SofaRow {
  cx: number
  cz: number
  /** rotation y of the rectangle (its local x runs along the row) */
  ry: number
  /** the yaw a body in the row faces: towards the sofa (the nav spots' ry: forward = (-sin ry, -cos ry)) */
  face: number
  /** along the row (local x) and across it (local z), m */
  sizeX: number
  sizeZ: number
}

export const SOFA_ROW = {
  /** the glb empty that marks the zone (position, rotation y, extras size_x / size_z) */
  node: 'zone_sofa_row',
  /** furniture clearance inside the row, m: the baked row is only 0.42 m deep, so a body on its centre line is 0.21 m from each side
   * and the grid (cells 0.15 m) needs a little slack to have a cell there (outside the row it stays GRID.inflate = R) */
  clearance: 0.12,
  /** speed in the row (and its approach) as a share of the agent's own cruise */
  speedScale: 0.4,
  /** the slow, side-stepping stretch starts this far before the rectangle, m: the path is smoothed over 0.5 s and the body needs
   * time to turn to the sofa, so both are done by the time the rectangle's edge is crossed */
  approachM: 0.4,
  /** a body this close to a sofa seat spot rests on it: seated, it does not count as standing in the row, m */
  seatEps: 0.12,
  /** a body that waits for the row stays this much longer clear of another's occupancy (s): the smoothed path
   * is a fraction of a second ahead of / behind the cells it was planned on */
  gapS: 0.4,
  /** an entering body may not walk on past its seat deeper into the row than this, m: that is how the far entrance stays shut */
  overshootM: 0.3,
  /** how far the sofa-side strip behind the row (where the seats' docks run) reaches, m */
  stripM: 1.0,
  /** how long before it enters the row the body already faces the sofa (s), so the turn is done at the edge */
  turnLeadS: 1.0,
}

/** the point in the row's own frame: along (u) and across (v) */
export function rowLocal(z: SofaRow, x: number, zz: number): { u: number; v: number } {
  const c = Math.cos(z.ry)
  const s = Math.sin(z.ry)
  const dx = x - z.cx
  const dz = zz - z.cz
  return { u: dx * c - dz * s, v: dx * s + dz * c }
}

/** inside the rectangle, grown by `pad` all round */
export function inSofaRow(z: SofaRow, x: number, zz: number, pad = 0): boolean {
  const { u, v } = rowLocal(z, x, zz)
  return Math.abs(u) <= z.sizeX / 2 + pad && Math.abs(v) <= z.sizeZ / 2 + pad
}

/**
 * The zone of a loaded model, or null (not baked yet): the `zone_sofa_row` empty's world position and rotation y, extras
 * size_x / size_z (m; the sofa is on the +z side of the node's own frame). Read like the rugs (ground.ts): once at load, from the node's userData.
 */
export function readSofaRow(scene: Object3D): SofaRow | null {
  const node = scene.getObjectByName(SOFA_ROW.node)
  if (!node) return null
  const sizeX = Number(node.userData.size_x)
  const sizeZ = Number(node.userData.size_z)
  if (!Number.isFinite(sizeX) || !Number.isFinite(sizeZ) || sizeX <= 0 || sizeZ <= 0) return null
  scene.updateMatrixWorld(true)
  const e = node.matrixWorld.elements
  // the node's rotation y (the rectangle's local x runs along the row); the baked empty has ry 0 and the sofa lies on its +z side,
  // so a body in the row faces +z = ry + pi
  const ry = Math.atan2(e[8], e[10])
  return { cx: e[12], cz: e[14], ry, face: Math.atan2(Math.sin(ry + Math.PI), Math.cos(ry + Math.PI)), sizeX, sizeZ }
}
