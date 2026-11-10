// GENERATED from public/models/office.glb by src/office/modelData.test.ts (NAV_WRITE=1 npx vitest run src/office/modelData.test.ts). Do not edit by hand.
// The nav_* empties of the baked layout, for tests that need the real graph without the glb.
import { buildGraph, type NavKind, type NavSpot } from './nav'

const RAW = 'board_tray 0.52 -3.55 0 stand; bulletin 2.25 -3.2 0 stand; chat_0 -1.75 -3.55 -1.5708 chat; chat_1 -0.75 -3.55 1.5708 chat; coffee 3.86 0.1 -1.5708 stand; desk_side_0 -3.65 -2.95 -1.7226 stand; desk_side_1 -3.72 0.65 -0.1272 stand; desk_side_2 -3.72 -2.2 -3.0032 stand; desk_side_3 -1.88 -2.2 3.0032 stand; desk_side_4 -1.88 0.65 0.1272 stand; door -4.25 2.4 1.5708 door; game_a -2.5 2.4 -1.5708 stool; game_b -1.3 2.4 1.5708 stool; hall_back 0.7 -0.3 0 hall; hall_door -3.6 2.4 0 hall; hall_east 2.8 -1.5 0 hall; hall_front -0.1 1.1 0 hall; hall_game -1.9 1.2 0 hall; hall_lounge 3.65 1.4 0 hall; hall_memo_back -2.8 -3.65 0 hall; hall_mid -1.05 -0.8 0 hall; hall_ne 3.4 -0.9 0 hall; hall_north -1.05 -2.9 0 hall; hall_west -3.3 1.2 0 hall; hall_work -1.05 -2.1 0 hall; meet_center 0.7 -1.97 -0.0524 meet_center; pingpong_a 0.27 0.7 -1.5708 play; pingpong_b 2.93 0.7 1.5708 play; shelf 3.45 -3.2 0 stand; sofa_0 3.2 3.487 0 sofa; sofa_1 3.73 3.487 0 sofa; sofa_2 4.26 3.487 0 sofa; whiteboard 0.8 -3.2 0 stand; work_0 -2.8 -2.82 3.1416 work; work_1 -3.61 -0.21 -1.5708 work; work_2 -3.61 -1.41 -1.5708 work; work_3 -1.99 -1.41 1.5708 work; work_4 -1.99 -0.21 1.5708 work'

export const SPOTS: NavSpot[] = RAW.split(';').map((s) => {
  const [id, x, z, ry, kind] = s.trim().split(/\s+/)
  return { id, x: +x, z: +z, ry: +ry, kind: kind as NavKind }
})
export const GRAPH = buildGraph(SPOTS)
