// #424: the timelapse copies the page ships (src/timeline/fixtures/*.json) are public; nothing in a public title may be what the
// server's filter hides (paths, emails, token-shaped strings), and a SECRET point carries no title. (Banned words are not known
// here: the copy is made with them, OFFICE_BANNED_WORDS, and its titles are read through once by a person before committing.)
import { describe, expect, it } from 'vitest'
import agentOffice from './fixtures/agent-office.json'
import hub from './fixtures/rowansong.dev.json'
import { redact } from '../docs/filter'
import type { TimelineFile } from './types'

const files = { 'agent-office': agentOffice as unknown as TimelineFile, 'rowansong.dev': hub as unknown as TimelineFile }

describe('the shipped timelapse copies (#424)', () => {
  for (const [name, f] of Object.entries(files)) {
    it(`${name}: public, and no public title holds a path, an email or a token`, () => {
      expect(f.tier).toBe('public')
      const caught = f.points.filter((p) => !p.secret && redact(p.title).hits.length > 0).map((p) => p.title)
      expect(caught).toEqual([])
      expect(f.points.filter((p) => p.secret).every((p) => p.title === '' && p.key.startsWith('review:'))).toBe(true)
    })
  }

  it('rowansong.dev is shown in the office (#424): its points have their titles', () => {
    const f = files['rowansong.dev']
    expect(f.points.filter((p) => !p.secret).length).toBeGreaterThan(f.points.length * 0.9)
  })
})
