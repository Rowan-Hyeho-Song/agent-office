import { afterEach, describe, expect, it } from 'vitest'
import { faderLevels, musicGlow, roomSound, speakerCells, speakerCone, speakerHoverLabel, speakerOn, toggleSpeakerForMe } from './echoLive'
import { setSetting } from '../audio/settings'
import { SPEAKER_BOX, SPEAKER_TAG } from './SpeakerClick'

let t = 0
const frame = () => roomSound((t += 0.016), 0.016)
afterEach(() => setSetting({ muted: true, volume: 1 }))

describe('echoLive: the speaker adapter (#193 / #194 ③)', () => {
  it('muted page: LED off, nothing lit, a click says "muted" and starts nothing', () => {
    setSetting({ muted: true })
    frame()
    expect(speakerOn()).toBe(false)
    expect(speakerCells()).toBe(0)
    expect(speakerCone()).toBe(0)
    expect(musicGlow()).toBe(0)
    expect(faderLevels()).toEqual([0, 0, 0, 0])
    expect(toggleSpeakerForMe()).toBe('muted')
    expect(speakerHoverLabel()).toBe('소리가 꺼져 있어요')
  })
  it('sound on: the LED lights; a click switches it off for me, the next one back on', () => {
    setSetting({ muted: false, volume: 0.5 })
    frame()
    expect(speakerOn()).toBe(true)
    expect(faderLevels()[3]).toBe(0.5)
    expect(toggleSpeakerForMe()).toBe('off')
    frame()
    expect(speakerOn()).toBe(false)
    expect(faderLevels()).toEqual([0, 0, 0, 0])
    expect(toggleSpeakerForMe()).toBe('on')
    frame()
    expect(speakerOn()).toBe(true)
  })
  it('the press box and the tags are as agreed', () => {
    expect(SPEAKER_BOX).toEqual([0.12, 0.2, 0.14])
    expect(SPEAKER_TAG).toEqual({ off: '나에게만 꺼짐', muted: '소리가 꺼져 있어요' })
  })
})
