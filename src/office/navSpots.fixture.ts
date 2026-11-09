// GENERATED from public/models/office.glb by src/office/modelData.test.ts (NAV_WRITE=1 npx vitest run src/office/modelData.test.ts). Do not edit by hand.
// The nav_* empties of the baked layout, for tests that need the real graph without the glb.
import { buildGraph, type NavKind, type NavSpot } from './nav'

const RAW = 'board_tray 0.82 -2.95 0 stand; bulletin 2.55 -2.6 0 stand; chat_0 -1.45 -2.95 -1.5708 chat; chat_1 -0.45 -2.95 1.5708 chat; coffee 3.56 -2 -1.5708 stand; desk_side_0 -3.35 -2.75 -1.7226 stand; desk_side_1 -3.42 0.85 -0.1272 stand; desk_side_2 -3.42 -2 -3.0032 stand; desk_side_3 -1.58 -2 3.0032 stand; desk_side_4 -1.58 0.85 0.1272 stand; door -3.95 2.6 1.5708 door; game_a -2.2 2.2 -1.5708 stool; game_b -1 2.2 1.5708 stool; hall_back 1 -0.1 0 hall; hall_door -3.3 2.6 0 hall; hall_east 3.1 -1.3 0 hall; hall_front 0.2 1.3 0 hall; hall_game -1.6 1.2 0 hall; hall_lounge 3.95 1.6 0 hall; hall_mid -0.75 -0.6 0 hall; hall_ne 4.1 0 0 hall; hall_north -0.75 -2.3 0 hall; hall_west -3 1.4 0 hall; hall_work -0.75 -1.9 0 hall; meet_center 1 -1.57 -0.0524 meet_center; pingpong_a 0.82 0.97 -1.5708 play; pingpong_b 3.48 0.97 1.5708 play; shelf 3.75 -2.6 0 stand; sofa_0 1.67 2.735 0 sofa; sofa_1 2.2 2.735 0 sofa; sofa_2 2.73 2.735 0 sofa; whiteboard 1.1 -2.6 0 stand; work_0 -2.5 -2.62 3.1416 work; work_1 -3.31 -0.01 -1.5708 work; work_2 -3.31 -1.21 -1.5708 work; work_3 -1.69 -1.21 1.5708 work; work_4 -1.69 -0.01 1.5708 work'

export const SPOTS: NavSpot[] = RAW.split(';').map((s) => {
  const [id, x, z, ry, kind] = s.trim().split(/\s+/)
  return { id, x: +x, z: +z, ry: +ry, kind: kind as NavKind }
})
export const GRAPH = buildGraph(SPOTS)
