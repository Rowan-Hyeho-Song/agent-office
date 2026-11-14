import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeBoard, noteWaitLeft, notesStore, pinNote, resetNotesForTest } from './notes'
import type { Note } from '../../visit/note'

afterEach(() => resetNotesForTest())
const n = (id: number, text = `쪽지 ${id}`): Note => ({ id, agent: 'agent_1', text, name: '', created_at: new Date(1_800_000_000_000 + id * 1000).toISOString() })
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('the board of notes (#4 12.3)', () => {
  it('the latest twelve, newest first; new ones flutter (none on the first read)', () => {
    const first = mergeBoard({ notes: [], fresh: [] }, Array.from({ length: 15 }, (_, i) => n(i + 1)), true)
    expect(first.notes.map((x) => x.id)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
    expect(first.fresh).toEqual([])
    const next = mergeBoard(first, [n(16), ...first.notes], false)
    expect(next.notes[0].id).toBe(16)
    expect(next.notes).toHaveLength(12)
    expect(next.fresh).toEqual([16])
  })

  it('pinning: the page tells the reason at once, the server decides, then this tab waits 30 s', async () => {
    expect(await pinNote('agent_2', '010-1234-5678로 연락', '', answer(200, {}))).toEqual({ error: expect.stringContaining('전화번호') })
    const ok = await pinNote('agent_2', '색이 예뻐요', '팬', answer(200, { note: n(40, '색이 예뻐요') }))
    expect(ok).toEqual({ ok: true })
    expect(notesStore.getSnapshot().notes[0].text).toBe('색이 예뻐요')
    expect(notesStore.getSnapshot().fresh).toEqual([40])
    expect(noteWaitLeft()).toBe(30)
    expect(await pinNote('agent_2', '또', '', answer(200, { note: n(41) }))).toEqual({ wait: 30 })
  })

  it("the server's word is the one shown (a repeat, the server's own cooldown)", async () => {
    expect(await pinNote('agent_0', '같은 말', '', answer(409, { error: '같은 쪽지가 이미 붙어 있어요.' }))).toEqual({ error: '같은 쪽지가 이미 붙어 있어요.' })
    expect(await pinNote('agent_0', '다른 말', '', answer(429, { retryS: 12 }))).toEqual({ wait: 12 })
    expect(noteWaitLeft()).toBe(12)
  })
})
