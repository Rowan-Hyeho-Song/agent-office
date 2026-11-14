// #4 office-ui.md 12.2: how a robot takes a visitor's snack or cheer, by what it is doing. Pure (the table of the spec),
// so it is tested apart from the scene.

import type { Expression } from '../faceModel'
import type { TreatKind } from '../../visit/treat'

export type RobotMood = 'free' | 'working' | 'meeting' | 'asleep'

export interface Reaction {
  /** the face and how long (none: the face stays as it is) */
  face: { expr: Expression; ms: number } | null
  /** the reaction bubble (tab '방문자'); none: no words */
  line: string | null
  /** a snack: where it ends up for a while before it fades (in the hand, on the desk in front, on the floor outside the circle) */
  rest: 'hand' | 'desk' | 'floor' | null
  /** a cheer: hearts over the head (three for 1.2 s; one for 1 s when it sleeps) */
  hearts: 0 | 1 | 3
}

export const SNACK_ICON: Record<Exclude<TreatKind, 'cheer'>, string> = { coffee: '☕', cookie: '🍪', apple: '🍎' }
export const CHEER_ICON = '✨'
export const TREAT_LABEL: Record<TreatKind, string> = { coffee: '커피', cookie: '쿠키', apple: '사과', cheer: '응원' }

/** the mood from the scene: asleep (dozing at night), in a meeting, working (or wrapping up), else free (resting, playing) */
export function moodOf(s: { state?: string; night?: string } | undefined, pose: string | undefined): RobotMood {
  if (s?.night === 'sleep' || pose === 'doze') return 'asleep'
  if (pose === 'talk' || pose === 'listen') return 'meeting'
  if (s?.state === 'working' || s?.state === 'wrapping') return 'working'
  return 'free'
}

/** 12.2's table. `speaking`: in a meeting and saying a line right now (then a cheer gets no nod either) */
export function reactionOf(kind: TreatKind, mood: RobotMood, speaking = false): Reaction {
  const snack = kind !== 'cheer'
  switch (mood) {
    case 'free':
      return snack
        ? { face: { expr: 'joy', ms: 2500 }, line: '고마워요!', rest: 'hand', hearts: 0 }
        : { face: { expr: 'joy', ms: 2500 }, line: '힘이 나네요', rest: null, hearts: 3 }
    case 'working':
      return snack
        ? { face: { expr: 'nodding', ms: 1200 }, line: '이따 먹을게요', rest: 'desk', hearts: 0 }
        : { face: { expr: 'nodding', ms: 1200 }, line: '고마워요', rest: null, hearts: 3 }
    case 'meeting':
      // a snack waits on the floor outside the circle until the meeting ends; a cheer is a nod unless it is talking
      return snack ? { face: null, line: null, rest: 'floor', hearts: 0 } : { face: speaking ? null : { expr: 'nodding', ms: 1200 }, line: null, rest: null, hearts: 3 }
    case 'asleep':
      // never woken: the snack lands quietly on the desk, the cheer is one heart for a second
      return snack ? { face: null, line: null, rest: 'desk', hearts: 0 } : { face: null, line: null, rest: null, hearts: 1 }
  }
}
