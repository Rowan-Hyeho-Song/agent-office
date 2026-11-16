// #597 the owner's sign-in from the desk room's frame: in the top window (GitHub will not show in a frame), back to the office's own address,
// and from there back to the room once the session is taken; alone (no frame) as before.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasAuthAnswer, roomAfterSignIn, signInPlan } from './signInFlow'
import { supabaseSource, type AuthPage } from './supabaseSource'

const OFFICE = 'https://desk.example/rooms/office/app/?embed=room'

describe('the rules', () => {
  it('alone: here; in a frame: the top window; back to this address either way', () => {
    expect(signInPlan({ top: true, href: 'https://office.example/rooms/office/app/' })).toEqual({ where: 'here', redirectTo: 'https://office.example/rooms/office/app/' })
    expect(signInPlan({ top: false, href: OFFICE })).toEqual({ where: 'top', redirectTo: OFFICE })
  })
  it('the answer in the address: tokens or an error in the hash, a code or an error in the query', () => {
    expect(hasAuthAnswer(`${OFFICE}#access_token=a&refresh_token=b`)).toBe(true)
    expect(hasAuthAnswer(`${OFFICE}#error=access_denied&error_description=x`)).toBe(true)
    expect(hasAuthAnswer(`${OFFICE}&code=abc`)).toBe(true)
    expect(hasAuthAnswer(OFFICE)).toBe(false)
    expect(hasAuthAnswer(`${OFFICE}#room`)).toBe(false)
  })
  it('back to the room: only the room office, in the top window, with an answer; the room is the parent path', () => {
    expect(roomAfterSignIn({ top: true, href: `${OFFICE}#access_token=a` })).toBe('https://desk.example/rooms/office/')
    expect(roomAfterSignIn({ top: true, href: `${OFFICE}#error=access_denied` })).toBe('https://desk.example/rooms/office/')
    expect(roomAfterSignIn({ top: false, href: `${OFFICE}#access_token=a` })).toBeNull() // still in the frame
    expect(roomAfterSignIn({ top: true, href: OFFICE })).toBeNull() // no answer
    expect(roomAfterSignIn({ top: true, href: 'https://office.example/rooms/office/app/#access_token=a' })).toBeNull() // the office alone
  })
})

describe('supabaseSource', () => {
  const fake = (url = 'https://auth.example/authorize?x=1') => {
    const signInWithOAuth = vi.fn(async (_: unknown) => ({ data: { url }, error: null }))
    const client = {
      auth: { signInWithOAuth, getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({}) },
      rpc: async () => ({ data: false }),
    } as unknown as SupabaseClient
    return { client, signInWithOAuth }
  }
  const page = (top: boolean, returnTo: string | null = null) => ({ win: () => ({ top, href: OFFICE }), goTop: vi.fn(), replace: vi.fn(), returnTo }) satisfies AuthPage

  it('alone: the client goes there itself (as before)', async () => {
    const { client, signInWithOAuth } = fake()
    const p = page(true)
    supabaseSource(client, null, p).signIn()
    await Promise.resolve()
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'github', options: { redirectTo: OFFICE } })
    expect(p.goTop).not.toHaveBeenCalled()
  })
  it('in the frame: the address only, then the top window goes there', async () => {
    const { client, signInWithOAuth } = fake()
    const p = page(false)
    supabaseSource(client, null, p).signIn()
    await new Promise((r) => setTimeout(r, 0))
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'github', options: { redirectTo: OFFICE, skipBrowserRedirect: true } })
    expect(p.goTop).toHaveBeenCalledWith('https://auth.example/authorize?x=1')
  })
  it('back in the top window for the room: once the session is taken, back to the room', async () => {
    const { client } = fake()
    const p = page(true, 'https://desk.example/rooms/office/')
    supabaseSource(client, p.returnTo, p)
    await new Promise((r) => setTimeout(r, 0))
    expect(p.replace).toHaveBeenCalledWith('https://desk.example/rooms/office/')
  })
})
