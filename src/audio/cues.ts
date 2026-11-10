// Every office sound effect, one name each (docs/design/sound.md 4). Call sites add one line: `cue('omok.place', { pos })`.
// Nothing happens before the context exists or while muted. Levels use the desk room's `beep(level)` scale
// (its click is 0.04, its success 0.05). Pitched cues stay in A minor pentatonic so they sit on the music.

import { MAX_SFX, audioGraph, duck, panner, type Bus, type Vec } from './engine'
import { keyVoice, type KeyKind } from './keys'
import { mouseVoice } from './mouse'
import { getSetting } from './settings'
import { knock, midi, noise, tone, type Out } from './synth'

/** repeat = background busywork (dropped when fast or off-camera), event = something happened, ui = the visitor did it */
type Kind = 'repeat' | 'event' | 'ui'

type CueVars = { agent?: string; dur?: number; pitch: number; keyKind?: KeyKind }

/** most keys sounding at once across all typists (#194 thock: five typists must not pile up) */
export const MAX_KEYS = 4

type CueDef = {
  label: string
  kind: Kind
  bus: Bus
  /** has a place in the room (panned, quieter far away) */
  spatial: boolean
  /** minimum gap between two of the same cue, ms */
  gap: number
  /** seconds it sounds (for the voice cap) */
  length: number
  play: (o: Out, v: CueVars) => void
}

/** robot voices by seat (sound.md 4.3): 메모 · 메시 · 휴 · 루프 · 에코 */
export const AGENT_PITCH: Record<string, number> = { agent_0: 1, agent_1: 0.85, agent_2: 1.15, agent_3: 0.95, agent_4: 0.9 }
const seatPitch = (agent?: string) => (agent ? (AGENT_PITCH[agent] ?? 1) : 1)

/** a lowpassed destination for the softer square tones */
function dark(o: Out, cutoff: number): Out {
  const f = o.c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = cutoff
  f.connect(o.dest)
  return { ...o, dest: f }
}

export const CUES = {
  // ── 1차 묶음 (sound.md 4.1) ──
  type: {
    label: '타자 (키보드 소리는 위에서 고름)',
    kind: 'repeat',
    bus: 'keys',
    spatial: true,
    gap: 38,
    length: 0.1,
    // each seat's keyboard is a little different, half as far apart as their voices (±7%)
    play: (o, v) => keyVoice(o, v.keyKind ?? 'char', 1 + (v.pitch - 1) * 0.5),
  },
  // the agents' mouse (#225 input bus): synth microswitch clicks and wheel notches, under a keystroke (mouse.ts)
  // #229 the wrap-up (wrapup.md 5): a card pressed onto the board, a small paper "톡" (wrapSound.ts finds the moment)
  'card.press': {
    label: '정리 카드 보드에 누름',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.06,
    // paper flattened onto cork under the thumb: a short dry tap and a soft low knock of the board
    play: (o) => {
      noise(o, 0.025, { freq: 1900, q: 1.1, level: 0.056, attack: 0.001 })
      noise(o, 0.04, { kind: 'pink', filter: 'lowpass', freq: 450, level: 0.056, attack: 0.002 })
    },
  },
  'mouse.down': {
    label: '마우스 누름',
    kind: 'repeat',
    bus: 'keys',
    spatial: true,
    gap: 38,
    length: 0.03,
    play: (o, v) => mouseVoice(o, 'down', 1 + (v.pitch - 1) * 0.5),
  },
  'mouse.up': {
    label: '마우스 뗌',
    kind: 'repeat',
    bus: 'keys',
    spatial: true,
    gap: 38,
    length: 0.03,
    play: (o, v) => mouseVoice(o, 'up', 1 + (v.pitch - 1) * 0.5),
  },
  'mouse.wheel': {
    label: '마우스 휠 한 칸',
    kind: 'repeat',
    bus: 'keys',
    spatial: true,
    gap: 30,
    length: 0.02,
    play: (o, v) => mouseVoice(o, 'wheel', 1 + (v.pitch - 1) * 0.5),
  },
  'plane.throw': {
    label: '종이비행기 슉',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.3,
    play: (o) => noise(o, 0.28, { kind: 'pink', freq: 800, to: 2400, q: 1.2, level: 0.09, shape: 'swell' }),
  },
  'plane.land': {
    label: '종이비행기 톡',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.06,
    play: (o) => {
      noise(o, 0.05, { freq: 2600, q: 0.8, level: 0.07 })
      noise(o, 0.03, { kind: 'pink', filter: 'lowpass', freq: 900, level: 0.04 })
    },
  },
  // ── #262 종이 전달 (거리에 따라): 셋 다 종이비행기보다 작고 짧다. 가까이서 일어나는 작은 일이다 ──
  'handoff.give': {
    label: '건네기 종이 스침',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.22,
    // two soft brushes of paper on paper, the second a little brighter (the receiving hand takes it)
    play: (o) => {
      noise(o, 0.12, { freq: 3200, to: 4200, q: 0.7, level: 0.038, shape: 'swell' })
      noise(o, 0.07, { freq: 5000, q: 0.9, level: 0.026, at: 0.11 })
    },
  },
  'handoff.slide': {
    label: '밀어 주기 책상 위 미끄러짐',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 150,
    length: 0.5,
    // paper on oak: low-ish friction that slows down (the band falls), as long as it slides (dur, 0.15–1.2 s)
    play: (o, v) => {
      const d = Math.max(0.15, Math.min(1.2, v.dur ?? 0.45))
      noise(o, d, { kind: 'pink', freq: 1500, to: 650, q: 0.9, level: 0.04, attack: 0.03, shape: 'flat' })
      noise(o, d * 0.8, { freq: 3800, to: 2400, q: 1.2, level: 0.012, attack: 0.03, shape: 'swell' })
    },
  },
  'handoff.toss': {
    label: '툭 던지기 휙',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.16,
    // the plane's whoosh, shorter and lower: a folded sheet, not a glider
    play: (o) => noise(o, 0.16, { kind: 'pink', freq: 700, to: 1700, q: 1.1, level: 0.085, shape: 'swell' }),
  },
  'handoff.catch': {
    label: '툭 던지기 받는 톡',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 200,
    length: 0.05,
    // into a hand, not onto a desk: softer and duller than plane.land
    play: (o) => {
      noise(o, 0.04, { freq: 2000, q: 0.8, level: 0.065 })
      noise(o, 0.03, { kind: 'pink', filter: 'lowpass', freq: 600, level: 0.04 })
    },
  },
  stamp: {
    label: '도장 쿵',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 250,
    length: 0.15,
    play: (o) => {
      tone(o, 90, 0.12, { type: 'sine', level: 0.06, slide: 0.66, attack: 0.002 })
      noise(o, 0.04, { kind: 'pink', filter: 'lowpass', freq: 500, level: 0.09 })
    },
  },
  'omok.place': {
    label: '오목 돌 딱',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.05,
    play: (o, v) => knock(o, 1800 * v.pitch, 0.04, 0.045, 12, 0.5),
  },
  'pingpong.hit': {
    label: '탁구 라켓 톡',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.04,
    play: (o, v) => {
      tone(o, 1100 * v.pitch, 0.03, { type: 'triangle', level: 0.04, slide: 0.82, attack: 0.001 })
      noise(o, 0.012, { freq: 2500, q: 2, level: 0.05 })
    },
  },
  'pingpong.bounce': {
    label: '탁구 탁자 튐',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 80,
    length: 0.03,
    play: (o, v) => knock(o, 1500 * v.pitch, 0.02, 0.03, 10, 0.6),
  },
  'pingpong.dull': {
    label: '탁구 네트 · 실수 툭',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 120,
    length: 0.05,
    play: (o) => knock(o, 600, 0.04, 0.035, 6, 0.7),
  },
  water: {
    label: '물 주기 졸졸',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 2,
    play: (o, v) => {
      // a steady wash plus short droplets whose band jumps around 1.2–3 kHz every ~60 ms, like a trickle
      const dur = Math.min(3, v.dur ?? 2)
      noise(o, dur, { freq: 2000, q: 3, level: 0.02, shape: 'flat', attack: 0.15 })
      for (let k = 0; k < dur / 0.06; k++) {
        noise({ ...o, t: o.t + k * 0.06 + Math.random() * 0.03 }, 0.05, { freq: 1200 + Math.random() * 1800, q: 6, level: 0.03 })
      }
    },
  },
  'water.drip': {
    label: '잎끝 물방울 톡',
    kind: 'repeat',
    bus: 'sfx',
    spatial: true,
    gap: 150,
    length: 0.05,
    // #185 / #393: a drop from a leaf tip landing on the wet soil: a tiny "plip" (a short sine rising 1.5 → 2.4 kHz, the
    // bubble's ring) over a soft dull touch of the soil; each drop a little different in pitch
    play: (o) => {
      const p = 0.9 + Math.random() * 0.25
      tone(o, 1500 * p, 0.03, { type: 'sine', level: 0.012, slide: 1.6, attack: 0.001 })
      noise(o, 0.015, { kind: 'pink', filter: 'lowpass', freq: 700, level: 0.012, attack: 0.001 })
    },
  },
  // ── #280 라운지 소품 (lounge-props.md, sound.md 4.4). 모두 그 자리에서 나는 작은 사건음이다. 레코드에는 지직거림을
  // 넣지 않는다(사용자 "치지지지직" 뒤, 5.2) ──
  'record.out': {
    label: '레코드 자켓에서 판 꺼냄',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.4,
    // a paper sleeve letting go of the disc: a soft brush that rises a little
    play: (o) => noise(o, 0.35, { kind: 'pink', freq: 1800, to: 2600, q: 0.8, level: 0.035, shape: 'swell' }),
  },
  'record.place': {
    label: '판을 플래터에 놓음',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.08,
    // vinyl onto the rubber mat: a flat, dull tap with a little ring of the platter under it
    play: (o) => {
      knock(o, 380, 0.05, 0.04, 3, 0.8)
      tone(o, 1900, 0.06, { type: 'sine', level: 0.005, attack: 0.002 })
    },
  },
  'record.needle': {
    label: '바늘 내려놓음',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.12,
    // the stylus meets the groove: a tiny low thump through the arm and one soft tick; then the speaker plays (no crackle)
    play: (o) => {
      tone(o, 70, 0.1, { type: 'sine', level: 0.018, slide: 0.8, attack: 0.002 })
      noise(o, 0.006, { freq: 2500, q: 1.5, level: 0.007, attack: 0.0005 })
    },
  },
  'record.lift': {
    label: '톤암 들어 올림',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.05,
    // the arm off the groove and onto its rest: two small clicks
    play: (o) => {
      noise(o, 0.005, { freq: 3000, q: 1.5, level: 0.045, attack: 0.0005 })
      knock(o, 1300, 0.02, 0.036, 8, 0.5)
    },
  },
  'fridge.open': {
    label: '냉장고 문 열림',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.3,
    // the seal letting go ("쩍"), then a moment of the cold inside: a low hum that fades
    play: (o) => {
      noise(o, 0.06, { kind: 'pink', filter: 'lowpass', freq: 450, level: 0.05, attack: 0.003 })
      tone(o, 170, 0.08, { type: 'sine', level: 0.02, slide: 0.7, attack: 0.002 })
      tone(o, 120, 0.25, { type: 'sine', level: 0.006, attack: 0.04, at: 0.04 })
    },
  },
  'fridge.close': {
    label: '냉장고 문 닫힘',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.16,
    // a padded thud, the seal pulling in, a bottle in the door clinking once
    play: (o) => {
      tone(o, 80, 0.12, { type: 'sine', level: 0.032, slide: 0.7, attack: 0.002 })
      noise(o, 0.05, { kind: 'pink', filter: 'lowpass', freq: 700, level: 0.038 })
      knock(o, 2600, 0.03, 0.004, 14, 0.4)
    },
  },
  'dispenser.pour': {
    label: '정수기 물 받기',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 600,
    length: 1.2,
    // the tap clicks, water into a mug climbs in pitch as it fills (dur, ~1 s), then the bottle on top glugs twice
    play: (o, v) => {
      const d = Math.max(0.4, Math.min(2, v.dur ?? 1))
      knock(o, 1400, 0.02, 0.02, 6, 0.5)
      noise(o, d, { freq: 900, to: 2200, q: 2.5, level: 0.022, shape: 'flat', attack: 0.05, at: 0.03 })
      for (let k = 0; k < d / 0.05; k++)
        noise({ ...o, t: o.t + 0.03 + k * 0.05 + Math.random() * 0.02 }, 0.04, { freq: 900 + (k / (d / 0.05)) * 1300 + Math.random() * 500, q: 7, level: 0.014 })
      tone(o, 240, 0.09, { type: 'sine', level: 0.02, slide: 1.6, attack: 0.01, at: d + 0.08 })
      tone(o, 280, 0.08, { type: 'sine', level: 0.014, slide: 1.6, attack: 0.01, at: d + 0.22 })
    },
  },
  'sofa.sit': {
    label: '소파에 앉음',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 500,
    length: 0.25,
    // a cushion taking the weight: a low padded thump and the fabric breathing out
    play: (o) => {
      tone(o, 70, 0.14, { type: 'sine', level: 0.018, slide: 0.75, attack: 0.01 })
      noise(o, 0.22, { kind: 'pink', filter: 'lowpass', freq: 800, level: 0.016, shape: 'swell' })
    },
  },
  'pillow.hug': {
    label: '쿠션 끌어안음',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 500,
    length: 0.2,
    // fabric squeezed: a short soft puff
    play: (o) => noise(o, 0.18, { kind: 'pink', freq: 900, q: 0.7, level: 0.04, shape: 'swell' }),
  },
  'mat.step': {
    label: '문 매트 밟음',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.14,
    // a foot on coir: a short rough scrape
    play: (o) => {
      noise(o, 0.12, { kind: 'pink', freq: 1300, q: 0.9, level: 0.042, shape: 'swell' })
      noise(o, 0.05, { freq: 3500, q: 1.2, level: 0.011, at: 0.03 })
    },
  },
  'lever.down': {
    label: '문 레버 누름 (걸쇠 딸깍)',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.06,
    // the latch pulled back at the bottom of the press: a small metal click with a short ring, a dull knock of the door under it
    play: (o) => {
      knock(o, 2400, 0.03, 0.03, 14, 0.4)
      tone(o, 3300, 0.04, { type: 'sine', level: 0.004, attack: 0.001 })
      knock(o, 300, 0.04, 0.02, 3, 0.8)
    },
  },
  'lever.up': {
    label: '문 레버 놓음 (스프링 철컥)',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.06,
    // the spring brings the lever up and the latch snaps out: a lighter, higher click
    play: (o) => {
      knock(o, 2900, 0.025, 0.022, 12, 0.4)
      noise(o, 0.01, { freq: 4500, q: 2, level: 0.006, attack: 0.0005, at: 0.012 })
    },
  },
  'door.enter': {
    label: '출입문 (따로 열었을 때)',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.2,
    play: (o) => {
      tone(o, 520, 0.08, { type: 'triangle', level: 0.035, slide: 2 })
      tone(o, 1040, 0.1, { type: 'triangle', level: 0.025, at: 0.06 })
    },
  },
  approve: {
    label: '결재 승인',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.6,
    play: (o) => [0, 4, 7, 12].forEach((s, i) => tone(o, midi(60 + s), 0.18, { level: 0.045, at: i * 0.08, echo: true })),
  },
  reject: {
    label: '결재 반려',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 300,
    length: 0.35,
    play: (o) => {
      tone(o, midi(64), 0.14, { level: 0.04 })
      tone(o, midi(60), 0.2, { level: 0.04, at: 0.12 })
    },
  },
  'stamp.ui': {
    label: '결재함 도장 쾅',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 250,
    length: 0.15,
    play: (o) => {
      tone(o, 90, 0.12, { type: 'sine', level: 0.07, slide: 0.66, attack: 0.002 })
      noise(o, 0.045, { kind: 'pink', filter: 'lowpass', freq: 600, level: 0.11 })
    },
  },
  'test.pass': {
    label: '테스트 통과',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.3,
    play: (o) => {
      tone(o, midi(88), 0.12, { level: 0.03 })
      tone(o, midi(95), 0.16, { level: 0.03, at: 0.09 })
    },
  },
  'test.fail': {
    label: '테스트 실패',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 400,
    length: 0.35,
    play: (o) => {
      const d = dark(o, 1400)
      tone(d, midi(57), 0.14, { type: 'square', level: 0.025 })
      tone(d, midi(56), 0.2, { type: 'square', level: 0.025, at: 0.12 })
    },
  },
  'approval.new': {
    // #240: a new approval arrived. A small bell "띵-동" falling a fourth (G6 → D6, both in the pentatonic), so it reads
    // apart from the stamp (a low thud), the paper plane (air) and the approve chime (a rising triangle arpeggio).
    // A bell = a sine plus an inharmonic partial (×2.76) that dies sooner, with a short echo tail.
    label: '결재함 새 항목 띵동',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 5000, // several within 5 s = one (docs-ui.md 1.6)
    length: 0.9,
    play: (o) => {
      for (const [n, at] of [
        [91, 0],
        [86, 0.16],
      ] as const) {
        tone(o, midi(n), 0.55, { type: 'sine', level: 0.038, at, attack: 0.002, echo: true })
        tone(o, midi(n) * 2.76, 0.18, { type: 'sine', level: 0.01, at, attack: 0.001 })
      }
    },
  },
  // ── 화면 UI (책상 방과 같은 소리) ──
  'ui.hover': {
    label: 'UI 호버',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 60,
    length: 0.03,
    play: (o) => tone(o, 1800, 0.03, { type: 'sine', level: 0.025 }),
  },
  'ui.click': {
    label: 'UI 누름',
    kind: 'ui',
    bus: 'sfx',
    spatial: false,
    gap: 60,
    length: 0.05,
    play: (o) => tone(o, 900, 0.05, { type: 'square', level: 0.04, slide: 1.6 }),
  },
  // ── 2차 후보 중 미리 (sound.md 4.2) ──
  snap: {
    label: '에코 손가락 딱',
    kind: 'event',
    bus: 'sfx',
    spatial: true,
    gap: 300,
    length: 0.05,
    play: (o) => {
      noise(o, 0.02, { freq: 2100, q: 8, level: 0.12, attack: 0.0005 })
      noise(o, 0.04, { freq: 5000, q: 0.7, level: 0.02, attack: 0.0005 })
    },
  },
  voice: {
    label: '로봇 말소리 한 음절',
    kind: 'event',
    bus: 'voice',
    spatial: true,
    gap: 68,
    length: 0.12,
    play: (o, v) => {
      // the desk room's babble: a buzzy glottal saw (+ a sub) through one vowel formant
      const { c, t } = o
      const f0 = (300 + Math.random() * 180) * v.pitch
      const dur = 0.07 + Math.random() * 0.04
      const saw = c.createOscillator()
      saw.type = 'sawtooth'
      saw.frequency.setValueAtTime(f0, t)
      saw.frequency.exponentialRampToValueAtTime(f0 * (0.85 + Math.random() * 0.35), t + dur)
      const sub = c.createOscillator()
      sub.type = 'square'
      sub.frequency.setValueAtTime(f0 / 2, t)
      const formant = c.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = [650, 1050, 1500, 2300][Math.floor(Math.random() * 4)]
      formant.Q.value = 5
      const gain = c.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.32, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      const sg = c.createGain()
      sg.gain.value = 0.25
      saw.connect(formant)
      sub.connect(sg).connect(formant)
      formant.connect(gain).connect(o.dest)
      // 에코 keeps a short slap-back tail (0.12 s, feedback 0.2)
      if (v.agent === 'agent_4') {
        const d = c.createDelay(0.5)
        d.delayTime.value = 0.12
        const fb = c.createGain()
        fb.gain.value = 0.2
        const wet = c.createGain()
        wet.gain.value = 0.5
        gain.connect(d).connect(fb).connect(d)
        d.connect(wet).connect(o.dest)
      }
      saw.start(t)
      sub.start(t)
      saw.stop(t + dur + 0.02)
      sub.stop(t + dur + 0.02)
    },
  },
} satisfies Record<string, CueDef>

export type CueName = keyof typeof CUES
export const CUE_NAMES = Object.keys(CUES) as CueName[]

export type CueOpts = {
  /** where in the room (world metres); ignored by non-spatial cues */
  pos?: Vec
  /** which agent (voice pitch, small timbre offsets) */
  agent?: string
  /** how long, for sustained cues (water) */
  dur?: number
  /** seconds from now */
  at?: number
  /** a stable id of the event (e.g. `pingpong:<session>:<shot>`): the replay keeps or drops the same ones every time */
  key?: string
  /** internal: already waited once for the context to start */
  retried?: boolean
  /** typing: which key (#225 kinds); char when not given */
  keyKind?: KeyKind
}

// ── replay speed (sound.md 6): ×1 as is, ×4 half the busywork and events −3 dB, ×16 events only at −6 dB ──
let speed = 1
export const setCueSpeed = (s: number) => void (speed = s)
export const getCueSpeed = () => speed

/** whether a cue of this kind plays at this replay speed, and its gain factor (pure, tested) */
export function speedRule(kind: Kind, s: number, roll: number): number {
  if (kind === 'ui' || s <= 1) return 1
  if (kind === 'repeat') return s >= 16 ? 0 : roll < 0.5 ? 1 : 0
  return s >= 16 ? 0.5 : 0.71
}

/** a stable 0..1 from an event key (FNV-1a), for the replay's "half of them" (pure, tested) */
export function keyRoll(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

// ── the voice cap and repeats ──
/** last time per cue (per agent for typing and voices, so five typists don't share one 38 ms gap) */
const lastAt = new Map<string, number>()
const PER_AGENT = new Set<CueName>(['type', 'voice', 'mouse.down', 'mouse.up', 'mouse.wheel'])
const gapKey = (name: CueName, agent?: string) => (PER_AGENT.has(name) && agent ? `${name}:${agent}` : name)
/** how many times each cue has sounded (?debug level scripts read it through window.__sound) */
export const cueCounts = new Map<CueName, number>()
const lastPitch = new Map<CueName, number>()
/** sounding (or scheduled) voices as [start, end] in ctx seconds, sfx and keys apart: the caps count overlap at a cue's own time */
type Span = [number, number]
let active: Span[] = []
let activeKeys: Span[] = []
/** how many spans overlap [t, t + len) (pure, tested) */
export const overlapping = (spans: Span[], t: number, len: number) => spans.filter(([s, e]) => s < t + len && e > t).length

/** #353 the settings panel's preview: at most one in this many ms (designer, office-ui.md 11) */
export const PREVIEW_GAP_MS = 150
let lastPreview = -Infinity
/** whether a preview at `now` (ms) may sound after one at `last` (pure, tested) */
export const previewDue = (last: number, now: number) => now - last >= PREVIEW_GAP_MS
/**
 * #353 the 전체 / 효과음 slider was let go: one `ui.click` (the desk room's click, level 0.04) at the new level. It goes
 * through the sfx category and the master, so it sounds exactly as loud as the setting now is.
 */
export function previewClick(now = performance.now()): boolean {
  if (!previewDue(lastPreview, now)) return false
  lastPreview = now
  return cue('ui.click')
}

/** play a cue now. Returns whether it sounded (for tests and the debug panel). */
export function cue(name: CueName, opts: CueOpts = {}): boolean {
  const g = audioGraph()
  if (!g || getSetting().muted) return false
  if (g.ctx.state !== 'running') {
    // the very first click builds the context, which starts 'suspended' and runs a moment later: play once it does
    // (#194 levels fix: the first ▶ in the debug panel was silent)
    if (g.ctx.state === 'suspended' && !document.hidden && !opts.retried)
      void g.ctx.resume().then(() => {
        if (g.ctx.state === 'running') cue(name, { ...opts, retried: true })
      })
    return false
  }
  const def = CUES[name] as CueDef
  const now = performance.now()
  // the gap is measured on the scheduled time, so a run of keys booked ahead (at) keeps its rhythm
  const when = (g.ctx.currentTime + (opts.at ?? 0)) * 1000
  if (Math.abs(when - (lastAt.get(gapKey(name, opts.agent)) ?? -1e9)) < def.gap) return false
  // the "every other one" at ×4 is decided by the event's key when there is one, so a replayed scene sounds the same
  const k = speedRule(def.kind, speed, opts.key !== undefined ? keyRoll(opts.key) : Math.random())
  if (k === 0) return false

  const t = g.ctx.currentTime + (opts.at ?? 0)
  active = active.filter(([, e]) => e > g.ctx.currentTime)
  if (def.bus === 'sfx' && def.kind !== 'ui' && overlapping(active, t, def.length) >= MAX_SFX) return false
  activeKeys = activeKeys.filter(([, e]) => e > g.ctx.currentTime)
  if (def.bus === 'keys' && overlapping(activeKeys, t, def.length) >= MAX_KEYS) return false
  lastAt.set(gapKey(name, opts.agent), when)

  // a repeat within a second wobbles ±3% so it doesn't sound like a machine gun
  const base = seatPitch(opts.agent)
  const wobble = now - (lastPitch.get(name) ?? -1e9) < 1000 ? 1 + (Math.random() * 2 - 1) * 0.03 : 1
  lastPitch.set(name, now)

  let dest: AudioNode = g.bus[def.bus]
  const trim = g.ctx.createGain()
  trim.gain.value = k
  trim.connect(dest)
  dest = trim
  if (def.spatial && opts.pos) dest = panner(g.ctx, opts.pos, trim)
  def.play({ c: g.ctx, dest, echo: g.echo, t }, { agent: opts.agent, dur: opts.dur, pitch: base * wobble, keyKind: opts.keyKind })
  if (def.bus === 'keys') activeKeys.push([t, t + def.length])
  else active.push([t, t + def.length])
  cueCounts.set(name, (cueCounts.get(name) ?? 0) + 1)
  if (def.bus === 'voice') duck('music', -6)
  // let go of the per-cue nodes once it's over
  const free = dest
  setTimeout(() => {
    free.disconnect()
    trim.disconnect()
  }, (def.length + (opts.at ?? 0) + 1.5) * 1000)
  return true
}

/** play a cue into any context (the debug level check renders into an OfflineAudioContext) */
export function playInto(c: BaseAudioContext, dest: AudioNode, name: CueName, t = 0, agent?: string, keyKind?: KeyKind) {
  const def = CUES[name] as CueDef
  def.play({ c, dest, t }, { agent, pitch: seatPitch(agent), keyKind })
  return def.length
}
