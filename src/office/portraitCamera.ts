// The portrait-phone default camera (#280 follow-up). On a tall screen the default view crops the room sideways and
// the room (9.6 m wide) cannot fit while the robots stay readable (0.8 x the phone's size). So below PORTRAIT_ASPECT the
// default view moves its target and lowers its elevation a little, backs off until the robots are exactly 0.8 x, and keeps
// the landmarks in priority order in view (work pod, ping-pong, lounge; the whiteboard and the omok table get an edge hint).
// Pure maths, no three.js: Door.tsx (HOME_POS / HOME_TARGET are set from this), cameraRig.tsx, EdgeHints.tsx and the tests.

import { DEFAULT_CAMERA, DEFAULT_TARGET } from './room'

type V3 = [number, number, number]

/** below this width / height the portrait pose applies */
export const PORTRAIT_ASPECT = 0.8
export const PORTRAIT = {
  /** elevation above the ground plane (the default's own is 29.3); the azimuth is the default's */
  elevationDeg: 26,
  /** the target: the default's (1, 0.6, 1) moved to the work pod / ping-pong side so the pod, the table and the lounge sofa all fit */
  target: [-0.3, 0.6, -0.35] as V3,
  /** the robots' on-screen size is this times the phone's current default (390 x 844) */
  minRobot: 0.8,
  /** the orbit's max distance (view.ts VIEW.distance[1]); the pose never asks for more */
  maxDistance: 21,
  refW: 390,
  refH: 844,
  /** a robot is this tall (m) */
  robotH: 0.6,
} as const

/** the five work seats (navSpots.fixture.ts work_0..work_4): where the robot size is measured */
export const WORK_SEATS: readonly (readonly [number, number])[] = [
  [-2.8, -2.82],
  [-3.61, -0.21],
  [-3.61, -1.41],
  [-1.99, -1.41],
  [-1.99, -0.21],
]

export interface Pose {
  camera: V3
  target: V3
}

export interface Landmark {
  id: 'pod' | 'whiteboard' | 'pingpong' | 'omok' | 'lounge'
  label: string
  /** world box (m); the work pod = the desks, the lounge = the sofa side, the ping-pong table from its two nav spots */
  min: V3
  max: V3
}
/** in priority order (the designer's) */
export const LANDMARKS: readonly Landmark[] = [
  { id: 'pod', label: '작업석', min: [-3.42, 0, -2.63], max: [-2.18, 0.74, 0.39] },
  { id: 'whiteboard', label: '화이트보드', min: [0.05, 1, -4.06], max: [1.55, 2, -4.06] },
  { id: 'pingpong', label: '탁구대', min: [0, 0, 0], max: [3.2, 0.8, 1.4] },
  { id: 'omok', label: '오목', min: [-2.235, 0.74, 2.19], max: [-1.565, 0.8, 2.61] },
  { id: 'lounge', label: '라운지', min: [2.6, 0, 2.9], max: [4.8, 1.5, 3.98] },
]

const DEG = Math.PI / 180
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** project a world point: ndc x / y (1 = the screen edge) and depth; fovDeg is the vertical fov */
export function project(p: V3, pose: Pose, fovDeg: number, aspect: number) {
  const f = norm(sub(pose.target, pose.camera))
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  const v = sub(p, pose.camera)
  const z = dot(v, f)
  const t = Math.tan((fovDeg * DEG) / 2)
  return { x: dot(v, r) / (z * t * aspect), y: dot(v, u) / (z * t), z }
}

/** mean pixel height of a 0.6 m upright segment at the five work seats, on a screen `height` px tall */
export function robotPx(pose: Pose, fovDeg: number, aspect: number, height: number = PORTRAIT.refH): number {
  let sum = 0
  for (const [x, z] of WORK_SEATS) {
    const a = project([x, 0, z], pose, fovDeg, aspect)
    const b = project([x, PORTRAIT.robotH, z], pose, fovDeg, aspect)
    sum += (Math.abs(b.y - a.y) / 2) * height
  }
  return sum / WORK_SEATS.length
}

/** where each landmark's box sits on screen: its ndc centre, and whether all of it is inside the screen (`margin` = ndc inset) */
export function landmarkView(pose: Pose, fovDeg: number, aspect: number, margin = 0) {
  return LANDMARKS.map((l) => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    let behind = false
    for (const x of [l.min[0], l.max[0]]) for (const y of [l.min[1], l.max[1]]) for (const z of [l.min[2], l.max[2]]) {
      const p = project([x, y, z], pose, fovDeg, aspect)
      if (p.z <= 0.01) behind = true
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
    const lim = 1 - margin
    return { ...l, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, full: !behind && x0 >= -lim && x1 <= lim && y0 >= -lim && y1 <= lim }
  })
}

/** the default pose (the desktop one) */
export const defaultPose = (): Pose => ({ camera: [...DEFAULT_CAMERA], target: [...DEFAULT_TARGET] })

const posed = (target: V3, azimuth: number, elevDeg: number, dist: number): Pose => {
  const c = Math.cos(elevDeg * DEG)
  return { camera: [target[0] + Math.sin(azimuth) * c * dist, target[1] + Math.sin(elevDeg * DEG) * dist, target[2] + Math.cos(azimuth) * c * dist], target }
}

export interface PortraitInfo extends Pose {
  elevationDeg: number
  distance: number
  /** robot size as a multiple of the phone's current default */
  robotRatio: number
}

/** The default pose for a viewport: the default at aspect >= PORTRAIT_ASPECT, else the portrait pose (same azimuth as the default). */
export function portraitInfo(aspect: number, fovDeg: number, minRobot: number = PORTRAIT.minRobot): PortraitInfo {
  const def = defaultPose()
  const ref = robotPx(def, fovDeg, PORTRAIT.refW / PORTRAIT.refH)
  const off = sub(def.camera, def.target)
  const full = (p: Pose): PortraitInfo => ({
    ...p,
    elevationDeg: Math.atan2(p.camera[1] - p.target[1], Math.hypot(p.camera[0] - p.target[0], p.camera[2] - p.target[2])) / DEG,
    distance: Math.hypot(...sub(p.camera, p.target)),
    robotRatio: robotPx(p, fovDeg, aspect) / ref,
  })
  if (aspect >= PORTRAIT_ASPECT) return full(def)
  const azimuth = Math.atan2(off[0], off[2])
  const at = (d: number) => posed([...PORTRAIT.target], azimuth, PORTRAIT.elevationDeg, d)
  // the farthest distance that keeps the robots at minRobot x (bisection; the size falls with distance)
  let lo = 2
  let hi = 60
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (robotPx(at(mid), fovDeg, aspect) >= minRobot * ref) lo = mid
    else hi = mid
  }
  return full(at(Math.min(lo, PORTRAIT.maxDistance)))
}

export const portraitPose = (aspect: number, fovDeg: number): Pose => {
  const { camera, target } = portraitInfo(aspect, fovDeg)
  return { camera, target }
}
