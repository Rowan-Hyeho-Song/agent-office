import { describe, expect, it } from 'vitest'
import { checkNote, handleNote, looksLikeContact, NOTE_COOLDOWN_MS, type Note, type NoteStore } from './note'

function memStore() {
  const cooldown: { hash: string; at: number }[] = []
  const notes: Note[] = []
  const store: NoteStore = {
    async lastCooldown(hash) {
      const r = cooldown.filter((c) => c.hash === hash).map((c) => c.at)
      return r.length ? Math.max(...r) : null
    },
    async putCooldown(hash, _agent, at, before) {
      for (let i = cooldown.length - 1; i >= 0; i--) if (cooldown[i].at < before.getTime()) cooldown.splice(i, 1)
      cooldown.push({ hash, at: at.getTime() })
    },
    async recentTexts() {
      return notes.slice(-12).map((n) => n.text)
    },
    async add({ agent, text, name, at }) {
      const n = { id: notes.length + 1, agent, text, name, created_at: at.toISOString() }
      notes.push(n)
      return n
    },
  }
  return { store, cooldown, notes }
}
const T0 = Date.parse('2026-11-14T05:00:00Z')
const send = async (m: ReturnType<typeof memStore>, at: number, body: unknown, ip = '203.0.113.7') => {
  const req = new Request('https://x/api/note', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) })
  const res = await handleNote(req, m.store, { secret: 'k', now: () => new Date(at) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('the notes (#4 12.3): the guestbook rules, and no contact details', () => {
  it('length, words, links, emails and phone numbers in the note and in the name', () => {
    expect(checkNote('', '오늘도 수고했어요!')).toBeNull()
    expect(checkNote('', '   ')).toBe('한마디를 적어 주세요.')
    expect(checkNote('', 'a'.repeat(81))).toContain('80자')
    expect(checkNote('가'.repeat(21), '좋아요')).toContain('20자')
    expect(checkNote('', 'fuck')).toContain('고운 말')
    expect(checkNote('fuck', '좋아요')).toContain('고운 말')
    expect(checkNote('', 'https://example.com 보세요')).toContain('링크')
    expect(checkNote('me@example.com', '안녕')).toContain('이메일')
    expect(checkNote('', '연락 주세요 010-1234-5678')).toContain('전화번호')
    expect(checkNote('', '+82 10 1234 5678')).toContain('전화번호')
    expect(looksLikeContact('2026년 11월 14일 3시')).toBe(false)
    expect(looksLikeContact('#137 PR 456 좋아요')).toBe(false)
  })

  it('pinned once; the same visitor again within 30 s waits; the same note twice is a repeat; another visitor is free', async () => {
    const m = memStore()
    const a = await send(m, T0, { agent: 'agent_2', text: '  색 고르는 거 멋져요  ', name: '' })
    expect(a.status).toBe(200)
    expect(a.body.note).toMatchObject({ agent: 'agent_2', text: '색 고르는 거 멋져요', name: '' })
    const again = await send(m, T0 + 10_000, { agent: 'agent_3', text: '다른 말' })
    expect(again.status).toBe(429)
    expect(again.body.retryS).toBe(20)
    expect((await send(m, T0 + 10_000, { agent: 'agent_2', text: '색 고르는 거 멋져요' }, '198.51.100.2')).status).toBe(409)
    expect((await send(m, T0 + 10_000, { agent: 'agent_2', text: '다른 사람의 말' }, '198.51.100.2')).status).toBe(200)
    expect((await send(m, T0 + NOTE_COOLDOWN_MS, { agent: 'agent_3', text: '다시 왔어요' })).status).toBe(200)
  })

  it('the server checks again (a page that skipped its own check gets the reason); nothing about the visitor in the note', async () => {
    const m = memStore()
    const bad = await send(m, T0, { agent: 'agent_1', text: '전화 010 9876 5432' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('전화번호')
    expect((await send(m, T0, { agent: 'agent_9', text: '안녕' })).status).toBe(400)
    await send(m, T0, { agent: 'agent_1', text: '안녕', name: '루프팬' })
    expect(Object.keys(m.notes[0]).sort()).toEqual(['agent', 'created_at', 'id', 'name', 'text'])
    expect(JSON.stringify(m.cooldown)).not.toContain('203.0.113.7')
  })
})
