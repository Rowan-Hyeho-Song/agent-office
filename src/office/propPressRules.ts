// #370 D the visitor presses a desk thing (desk-props.md 7): only the eight tied to the office's data. A press never changes what they
// show (the office shows the real signals; the speaker's music for this visitor alone is the one exception, #194). It brings a tag
// (what it is, and what it shows now), the owner's small gesture and a quiet click. Pure rules here; PropPress.tsx draws them.

import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three'
import type { MusicState } from '../audio/music'
import type { DeskProps } from './props'

export type PropId = 'signal' | 'duck' | 'hourglass' | 'turntable' | 'ringlight' | 'lamp' | 'speaker' | 'mixer'

export const PROP_PRESS = {
  /** a press shows the tag this long (hover and focus keep it) */
  tagMs: 3000,
  /** the same thing pressed again this soon: the tag again, no gesture */
  againMs: 2000,
  /** a finger is bigger than a cursor: the box grows 1.5 times on touch, and is never smaller than 44 px on the screen */
  touchScale: 1.5,
  minPx: 44,
} as const

export interface PropDef {
  id: PropId
  /** the owner's seat (agent_<seat>) */
  seat: number
  /** the tag's first line, always the same (desk-props.md 7.1) */
  first: string
}

/** in the keyboard's order: the desks from 메모 to 에코, as the agent list */
export const PROPS: readonly PropDef[] = [
  { id: 'hourglass', seat: 0, first: '모래시계 · 결재를 기다리는 동안 흐릅니다' },
  { id: 'turntable', seat: 1, first: '턴테이블 · 메시가 3D를 굽는 동안 돕니다' },
  { id: 'ringlight', seat: 1, first: '링 조명 · 메시가 결과를 찍을 때 켭니다' },
  { id: 'lamp', seat: 2, first: '스탠드 · 휴가 출근해 있으면 켜집니다' },
  { id: 'signal', seat: 3, first: '신호등 · 루프의 마지막 테스트 결과' },
  { id: 'duck', seat: 3, first: '고무 오리 · 루프가 막히면 말을 겁니다' },
  { id: 'speaker', seat: 4, first: '스피커 · 나에게만 음악 켜고 끄기' },
  { id: 'mixer', seat: 4, first: '믹서 · 에코가 쉬는 시간 음악을 올립니다' },
]
export const PROP_BY_ID = Object.fromEntries(PROPS.map((p) => [p.id, p])) as Record<PropId, PropDef>

export interface PropNow {
  desk: Pick<DeskProps, 'signal' | 'turntable' | 'ringlight' | 'lamp'>
  /** approvals waiting for the owner */
  pending: number
  /** the speaker for this visitor: on, off for me, or the sound is off altogether */
  speaker: 'on' | 'off' | 'muted'
  music: MusicState
  /** the seat is on private work (#34) */
  private: (seat: number) => boolean
}

/**
 * The tag's second line: what the thing shows now (null: none). A seat on private work says '비공개' for its things, except the speaker,
 * whose line is this visitor's own switch.
 */
export function secondLine(id: PropId, w: PropNow): string | null {
  if (id !== 'speaker' && w.private(PROP_BY_ID[id].seat)) return '비공개'
  switch (id) {
    case 'signal':
      return { green: '통과', red: '실패', yellow: '도는 중', off: '아직 없음' }[w.desk.signal]
    case 'duck':
      return w.desk.signal === 'red' ? '최근에 말을 걸었어요' : null
    case 'hourglass':
      return w.pending > 0 ? `결재 대기 ${w.pending}건` : '기다리는 결재 없음'
    case 'turntable':
      return w.desk.turntable ? '굽는 중' : '멈춤'
    case 'ringlight':
      // the blink after a bake is the light on
      return w.desk.ringlight === 'off' ? '꺼짐' : '켜짐'
    case 'lamp':
      return w.desk.lamp ? '켜짐' : '꺼짐'
    case 'speaker':
      return { on: '켜짐', off: '나에게만 꺼짐', muted: '소리가 꺼져 있어요' }[w.speaker]
    case 'mixer':
      return { break: '쉬는 시간 음악', work: '일할 때 음악', off: '꺼짐' }[w.music]
  }
}

/** the button's name for a screen reader: both lines */
export const propLabel = (id: PropId, w: PropNow) => {
  const second = secondLine(id, w)
  return second ? `${PROP_BY_ID[id].first}. ${second}` : PROP_BY_ID[id].first
}

/** where the owner is and what it does, as the gesture needs it */
export interface Owner {
  /** at its own desk (arrived at work_<seat>) */
  atDesk: boolean
  /** working (typing, the mouse) */
  working: boolean
  /** dozing, tidying up, or in a meeting */
  busy: boolean
}

/**
 * The owner's gesture (desk-props.md 7.4): resting at the desk = look 1 s and nod once; working = the head alone, no nod (the hands go
 * on); away, dozing, tidying, in a meeting = none. None either for the same thing again within 2 s, or with reduced motion.
 */
export function gestureFor(o: Owner, reduced: boolean, sinceLastMs: number): 'lookNod' | 'look' | null {
  if (reduced || sinceLastMs < PROP_PRESS.againMs) return null
  if (!o.atDesk || o.busy) return null
  return o.working ? 'look' : 'lookNod'
}

/** a box on the screen (px) */
export interface ScreenBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Which thing a pointer or a finger at (x, y) presses: of the screen boxes it is in, the one whose middle is nearest. The things stand
 * close together in the office's view (a 44 px finger box takes in its neighbours), so the nearest middle wins, not the first box.
 */
export function pickNearest(boxes: Iterable<[PropId, ScreenBox]>, x: number, y: number): PropId | null {
  let best: PropId | null = null
  let bestD = Infinity
  for (const [id, b] of boxes) {
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue
    const d = Math.hypot(x - (b.left + b.right) / 2, y - (b.top + b.bottom) / 2)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

// ---- the press boxes ----------------------------------------------------------------------------------------------

/** the press box of one speaker, centred on its pivot (desk_4_spk_l | _r), 0.12 x 0.20 x 0.14 m (#193, sound.md 5) */
export const SPEAKER_BOX = [0.12, 0.2, 0.14] as const
/** the duck is baked into the desk: a box about its body, from the point over its head (desks.md: body r 0.03, 0.065 high) */
const DUCK_BOX = { size: [0.08, 0.08, 0.08] as const, down: 0.03 }

const PARTS: Record<Exclude<PropId, 'speaker' | 'duck'>, string[]> = {
  signal: ['desk_3_signal_g', 'desk_3_signal_y', 'desk_3_signal_r'],
  hourglass: ['desk_0_hourglass'],
  turntable: ['desk_1_turntable'],
  ringlight: ['desk_1_ringlight', 'desk_1_ringlight_knob'],
  lamp: ['desk_2_lamp', 'desk_2_lamp_head'],
  mixer: [0, 1, 2, 3].flatMap((k) => [`desk_4_fader_${k}`, `desk_4_knob_${k}`]).concat([0, 1, 2, 3, 4, 5, 6, 7].map((k) => `desk_4_meter_${k}`)),
}

const boxMesh = (size: readonly [number, number, number], at: Vector3, id: PropId) => {
  const m = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ visible: false }))
  m.position.copy(at)
  m.userData.prop = id
  return m
}

/** each thing's press boxes (the speaker has two), scaled on touch; a thing the model lacks has none */
export function propTargets(nodes: Record<string, Object3D>, touch: boolean): Map<PropId, Mesh[]> {
  const out = new Map<PropId, Mesh[]>()
  const bx = new Box3()
  for (const [id, names] of Object.entries(PARTS) as [PropId, string[]][]) {
    const box = new Box3()
    for (const n of names) {
      const o = nodes[n]
      if (!o) continue
      o.updateWorldMatrix(true, true)
      box.union(bx.setFromObject(o))
    }
    if (box.isEmpty()) continue
    out.set(id, [boxMesh(box.getSize(new Vector3()).toArray() as [number, number, number], box.getCenter(new Vector3()), id)])
  }
  const duck = nodes.desk_3_duck_look
  if (duck) {
    duck.updateWorldMatrix(true, false)
    out.set('duck', [boxMesh(DUCK_BOX.size, duck.getWorldPosition(new Vector3()).add(new Vector3(0, -DUCK_BOX.down, 0)), 'duck')])
  }
  const spk = ['desk_4_spk_l', 'desk_4_spk_r'].flatMap((k) => {
    const o = nodes[k]
    if (!o) return []
    o.updateWorldMatrix(true, false)
    const m = boxMesh(SPEAKER_BOX, o.getWorldPosition(new Vector3()), 'speaker')
    o.getWorldQuaternion(m.quaternion)
    return [m]
  })
  if (spk.length) out.set('speaker', spk)
  for (const ms of out.values())
    for (const m of ms) {
      if (touch) m.scale.setScalar(PROP_PRESS.touchScale)
      m.updateMatrixWorld(true)
    }
  return out
}
