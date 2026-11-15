// A bubble says the first sentence of a markdown cell; a line written in the code (#137 ② C, play.md 2.5) can be said whole.
import { describe, expect, it } from 'vitest'
import { BubbleCenter } from './bubbleCenter'
import { OMOK_LINES } from '../play/visitorOmok'

describe('BubbleCenter.say', () => {
  it('cuts a cell at its first sentence; a whole line keeps "졌어요! 한 판 더?" as written', () => {
    const c = new BubbleCenter()
    c.say('agent_0', { kind: 'react', text: OMOK_LINES.visitorWon }, 0)
    expect(c.items(10, true).find((b) => b.id === 'agent_0')!.text).toBe('졌어요!')
    c.say('agent_0', { kind: 'react', text: OMOK_LINES.visitorWon, whole: true }, 0)
    expect(c.items(10, true).find((b) => b.id === 'agent_0')!.text).toBe('졌어요! 한 판 더?')
    c.say('agent_1', { kind: 'react', text: `가${'나'.repeat(80)}`, whole: true }, 0)
    expect([...c.items(10, true).find((b) => b.id === 'agent_1')!.text].at(-1)).toBe('…') // still at most a bubble's length
  })
})
