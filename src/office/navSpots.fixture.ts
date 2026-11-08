// The nav_* empties of the 9 x 7 m layout (#109), for tests that need the real graph without the glb.
import { buildGraph, type NavKind, type NavSpot } from './nav'

const RAW = `bulletin 2.55 -2.6 0 stand; coffee 3.56 -2 -1.5708 stand; desk_side_0 -1.85 -2.52 1.5182 stand; desk_side_1 -0.05 -2.52 1.5182 stand; desk_side_2 -3.59 -2.07 3.089 stand; desk_side_3 -3.59 -0.27 3.089 stand; door -3.95 2.6 1.5708 door; game_a -2.2 2.2 -1.5708 stool; game_b -1 2.2 1.5708 stool; hall_back 2 -1.7 0 hall; hall_door -3.3 2.6 0 hall; hall_east 3.1 -1.3 0 hall; hall_front 0.2 1.3 0 hall; hall_game -1.6 1.2 0 hall; hall_lounge 3.95 1.6 0 hall; hall_mid -1 -0.6 0 hall; hall_ne 4.1 0 0 hall; hall_west -3 1.4 0 hall; hall_work -2.2 -1.5 0 hall; meet_center_board 1.1 -2.18 0 meet_center; meet_center_floor -1 -0.6 0 meet_center; pingpong_a 0.87 0 -1.5708 play; pingpong_b 3.53 0 1.5708 play; shelf 3.75 -2.6 0 stand; sofa_0 1.67 2.55 0 sofa; sofa_1 2.2 2.55 0 sofa; sofa_2 2.73 2.55 0 sofa; whiteboard 1.1 -2.6 0 stand; work_0 -2.8 -2.57 0 work; work_1 -1 -2.57 0 work; work_2 -3.64 -1.12 1.5708 work; work_3 -3.64 0.68 1.5708 work`

export const SPOTS: NavSpot[] = RAW.split(';').map((s) => {
  const [id, x, z, ry, kind] = s.trim().split(/\s+/)
  return { id, x: +x, z: +z, ry: +ry, kind: kind as NavKind }
})
export const GRAPH = buildGraph(SPOTS)
