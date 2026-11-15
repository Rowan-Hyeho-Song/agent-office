// The key rack by the entrance door (#475, office-ui.md 13): the owner's sign-in. Pure rules here; KeyRack.tsx draws them.
// Signed out, a press signs in (GitHub); signed in, the owner's key is off the hook and a press leads to the HUD's OWNER tag
// (its 나가기 button) instead of signing out. On touch the first tap only shows what it is; a second one within 4 s signs in.

import { Mesh, Object3D, Vector3 } from 'three'
import type { Role } from '../approvals/source'
import { hitBox } from './pick'

export const KEY_RACK = {
  /** the key's swing on the middle hook: about the web x axis (along the wall), once, dying away */
  swingDeg: 6,
  swingS: 0.5,
  /** hung back after signing out: fades in this long, with the swing */
  appearS: 0.3,
  /** the outline flashes this long on a press (--dur-instant) */
  pressMs: 80,
  /** the OWNER tag blinks twice, ivory and amber 0.3 s each */
  blinkMs: 1200,
  /** touch: the second tap must come this soon */
  armMs: 4000,
  /** touch: the press box grows 1.5 times, and is never drawn smaller than 44 px on the screen */
  touchScale: 1.5,
  minPx: 44,
} as const

export const KEY_RACK_TAG = {
  visitor: '주인 로그인',
  owner: '주인 · 들어와 있어요',
  armed: '주인 로그인 · 한 번 더 누르면 GitHub',
} as const

export const KEY_RACK_LABEL = {
  visitor: '주인 로그인',
  owner: '주인으로 들어와 있어요. 나가기 단추로 가기',
} as const

// the swing's shape: two half-swings, squared decay; scaled so its largest angle is swingDeg
const shape = (u: number) => Math.sin(4 * Math.PI * u) * (1 - u) ** 2
const PEAK = Math.max(...Array.from({ length: 1001 }, (_, i) => Math.abs(shape(i / 1000))))

/** the key's angle (rad) `t` s after the swing started: 0 at the start and from swingS on */
export function keySwing(t: number): number {
  if (!(t > 0) || t >= KEY_RACK.swingS) return 0
  return (((KEY_RACK.swingDeg * Math.PI) / 180) * shape(t / KEY_RACK.swingS)) / PEAK
}

/** the key's opacity `t` s after it was hung back (0..1) */
export const keyAppear = (t: number) => Math.min(1, Math.max(0, t / KEY_RACK.appearS))

/** what a press does: sign in, lead to the OWNER tag, or (touch, first tap) only show what it is */
export type Press = 'signIn' | 'owner' | 'arm'

/** a press at `now` (ms) with the rack armed since `armedAt` (null: not armed); returns what it does and the new armedAt */
export function press(role: Role, touch: boolean, armedAt: number | null, now: number): { act: Press; armedAt: number | null } {
  if (role === 'owner') return { act: 'owner', armedAt: null }
  if (!touch || (armedAt !== null && now - armedAt <= KEY_RACK.armMs)) return { act: 'signIn', armedAt: null }
  return { act: 'arm', armedAt: now }
}

/** the tag over the rack */
export function rackTag(role: Role, armed: boolean): string {
  if (role === 'owner') return KEY_RACK_TAG.owner
  return armed ? KEY_RACK_TAG.armed : KEY_RACK_TAG.visitor
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** at least `min` px wide and high, about the same centre */
export function grow(r: Rect, min: number): Rect {
  const w = Math.max(0, min - (r.right - r.left)) / 2
  const h = Math.max(0, min - (r.bottom - r.top)) / 2
  return { left: r.left - w, right: r.right + w, top: r.top - h, bottom: r.bottom + h }
}

/** the tag's gap to the outline, and the margin it keeps from the screen's edges (px) */
export const TAG_GAP = 6
export const TAG_MARGIN = 8

/**
 * where the tag goes (top-left, screen px): centred over the outline, pulled in sideways to stay TAG_MARGIN inside the screen; below
 * the outline when there is no room above it (#480 designer: the rack at a phone's left edge cut '주인 로그인 ·' off)
 */
export function tagPlace(r: Rect, w: number, h: number, screenW: number): { left: number; top: number } {
  const centred = (r.left + r.right) / 2 - w / 2
  const left = Math.max(TAG_MARGIN, Math.min(centred, screenW - TAG_MARGIN - w))
  const above = r.top - TAG_GAP - h
  return { left, top: above >= TAG_MARGIN ? above : r.bottom + TAG_GAP }
}

/** the model's hit_keyrack as the press box, 1.5x on touch; null while the model has none */
export function keyRackTarget(scene: Object3D, touch: boolean): Mesh | null {
  const box = hitBox(scene, 'keyrack')
  if (box && touch) {
    box.scale.setScalar(KEY_RACK.touchScale)
    box.updateMatrixWorld(true)
  }
  return box
}

/** the way the rack faces (into the room): the press box's thinnest axis, turned toward the room's middle */
export function rackNormal(box: Mesh): Vector3 {
  const { width, height, depth } = (box.geometry as unknown as { parameters: { width: number; height: number; depth: number } }).parameters
  const axis = width <= height && width <= depth ? 0 : height <= depth ? 1 : 2
  const n = new Vector3().setComponent(axis, 1).applyQuaternion(box.quaternion)
  if (n.dot(box.position) > 0) n.negate()
  return n
}
