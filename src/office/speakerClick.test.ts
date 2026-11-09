import { describe, expect, it } from 'vitest'
import { SPEAKER_BOX, SPEAKER_TAG } from './SpeakerClick'

describe('speaker click (#193)', () => {
  it('the press box and the tags are as agreed with the sound side', () => {
    expect(SPEAKER_BOX).toEqual([0.12, 0.2, 0.14])
    expect(SPEAKER_TAG).toEqual({ off: '나에게만 꺼짐', muted: '소리가 꺼져 있어요' })
  })
})
