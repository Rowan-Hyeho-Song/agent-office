import { describe, expect, it } from 'vitest'
import { NS, allowedOrigins, envelope, parentOrigin, parseDeskAudio, parseDeskMessage } from './protocol'

const parent = {}
const allowed = allowedOrigins('http://localhost:5186', 'http://localhost:5187')
const ev = (over: Partial<{ source: unknown; origin: string; data: unknown }> = {}) => ({
  source: parent,
  origin: 'http://localhost:5187',
  data: { ns: NS, v: 1, type: 'entered' },
  ...over,
})

describe('allowedOrigins', () => {
  it('is its own origin + the env list, defaulting to the production desk', () => {
    expect(allowed).toEqual(['http://localhost:5186', 'http://localhost:5187'])
    expect(allowedOrigins('http://a.test', undefined)).toEqual(['http://a.test', 'https://rowansong-dev.vercel.app', 'https://rowansong.dev'])
    expect(allowedOrigins('http://a.test', ' , nonsense, https://x.test/path ')).toEqual(['http://a.test', 'https://x.test'])
  })
})

describe('parentOrigin', () => {
  it('uses ancestorOrigins first, then the referrer, only when allow-listed', () => {
    expect(parentOrigin('http://localhost:5187', '', allowed)).toBe('http://localhost:5187')
    expect(parentOrigin(undefined, 'http://localhost:5187/rooms/office', allowed)).toBe('http://localhost:5187')
    expect(parentOrigin('https://evil.test', 'http://localhost:5187/', allowed)).toBeNull()
    expect(parentOrigin(undefined, '', allowed)).toBeNull()
  })
})

describe('parseDeskMessage', () => {
  it('accepts the contract from the parent window and an allowed origin', () => {
    expect(parseDeskMessage(ev(), parent, allowed)).toBe('entered')
    expect(parseDeskMessage(ev({ data: { ns: NS, v: 1, type: 'leaving' } }), parent, allowed)).toBe('leaving')
    expect(parseDeskMessage(ev({ origin: 'http://localhost:5186' }), parent, allowed)).toBe('entered')
  })
  it('ignores a disallowed origin', () => {
    expect(parseDeskMessage(ev({ origin: 'https://evil.test' }), parent, allowed)).toBeNull()
  })
  it('ignores a message that is not from the parent window', () => {
    expect(parseDeskMessage(ev({ source: {} }), parent, allowed)).toBeNull()
    expect(parseDeskMessage(ev({ source: null }), parent, allowed)).toBeNull()
    expect(parseDeskMessage(ev(), null, allowed)).toBeNull()
  })
  it('ignores a wrong ns, version or type', () => {
    expect(parseDeskMessage(ev({ data: { ns: 'other', v: 1, type: 'entered' } }), parent, allowed)).toBeNull()
    expect(parseDeskMessage(ev({ data: { ns: NS, v: 2, type: 'entered' } }), parent, allowed)).toBeNull()
    expect(parseDeskMessage(ev({ data: { ns: NS, v: 1, type: 'ready' } }), parent, allowed)).toBeNull()
    expect(parseDeskMessage(ev({ data: { ns: NS, v: 1 } }), parent, allowed)).toBeNull()
  })
  it('ignores malformed payloads', () => {
    for (const data of [null, undefined, 'entered', 42, [], [NS], { type: 'entered' }]) expect(parseDeskMessage(ev({ data }), parent, allowed)).toBeNull()
  })
})

describe('envelope', () => {
  it('wraps a message in the versioned envelope', () => {
    expect(envelope({ type: 'exit', room: 'office', via: 'door' })).toEqual({ ns: NS, v: 1, type: 'exit', room: 'office', via: 'door' })
  })
})

describe('parseDeskAudio (#194)', () => {
  const audio = (data: Record<string, unknown>) => ev({ data: { ns: NS, v: 1, type: 'audio', ...data } })
  it('reads muted + volume (clamped) and drops other fields', () => {
    expect(parseDeskAudio(audio({ muted: false, volume: 0.4, x: 1 }), parent, allowed)).toEqual({ muted: false, volume: 0.4 })
    expect(parseDeskAudio(audio({ muted: true, volume: 3 }), parent, allowed)).toEqual({ muted: true, volume: 1 })
  })
  it('#353 keeps music / sfx only when the desk sends them (an older desk leaves the office levels alone)', () => {
    expect(parseDeskAudio(audio({ muted: false, volume: 1, music: 0.3, sfx: 4 }), parent, allowed)).toEqual({ muted: false, volume: 1, music: 0.3, sfx: 1 })
    expect(parseDeskAudio(audio({ muted: false, volume: 1, music: 'x' }), parent, allowed)).toEqual({ muted: false, volume: 1 })
  })
  it('needs the same envelope and allow-list as the rest', () => {
    expect(parseDeskAudio(audio({ muted: 'yes', volume: 1 }), parent, allowed)).toBeNull()
    expect(parseDeskAudio({ ...audio({ muted: true, volume: 1 }), origin: 'https://evil.test' }, parent, allowed)).toBeNull()
    expect(parseDeskAudio({ ...audio({ muted: true, volume: 1 }), source: {} }, parent, allowed)).toBeNull()
    expect(parseDeskAudio(ev({ data: { ns: NS, v: 2, type: 'audio', muted: true, volume: 1 } }), parent, allowed)).toBeNull()
  })
  it('is not an entered/leaving message', () => {
    expect(parseDeskMessage(audio({ muted: true, volume: 1 }), parent, allowed)).toBeNull()
  })
})
