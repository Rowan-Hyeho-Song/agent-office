import { assetUrl } from '../../room/base'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalSource, Cover, DecidedCover, DecideResult, Role } from '../../approvals/source'
import type { StoredApproval } from '../../approvals/types'
import { oldestFirst } from '../../approvals/view'
import { signInPlan, type Win } from './signInFlow'

/** what the sign-in needs of the page (a test gives its own) */
export interface AuthPage {
  win(): Win
  /** open an address in the top window (a frame's sign-in) */
  goTop(url: string): void
  /** leave for an address, not kept in the history */
  replace(url: string): void
  /** a sign-in from the room's frame came back here: the room to go back to once the session is taken (supabase.ts roomAfterAuth) */
  returnTo: string | null
}

const browserPage = (returnTo: string | null): AuthPage => ({
  win: () => ({ top: window.top === window.self, href: location.href }),
  goTop(url) {
    try {
      window.top!.location.assign(url)
    } catch {
      window.open(url, '_blank', 'noopener')
    }
  },
  replace: (url) => location.replace(url),
  returnTo,
})

/** the real source: visitors read the two views, the owner reads the table and decides through /api/approve */
export function supabaseSource(supabase: SupabaseClient, returnTo: string | null = null, page: AuthPage = browserPage(returnTo)): ApprovalSource {
  let session: Session | null = null
  let role: Role = 'visitor'
  const listeners = new Set<() => void>()
  const set = (r: Role) => {
    if (r === role) return
    role = r
    listeners.forEach((l) => l())
  }
  const refresh = async () => {
    if (!session) return set('visitor')
    const { data } = await supabase.rpc('is_owner')
    set(data === true ? 'owner' : 'other')
  }
  void supabase.auth.getSession().then(({ data }) => {
    session = data.session
    // #597 back from GitHub in the top window for the room's frame: the session is kept (the room's frame shares it), back to the room
    if (page.returnTo) return page.replace(page.returnTo)
    void refresh()
  })
  supabase.auth.onAuthStateChange((_e, s) => {
    session = s
    void refresh()
  })

  return {
    role: () => role,
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    // #597 inside a frame (the desk room) GitHub will not show: the sign-in goes in the top window and comes back to this address
    signIn: () => {
      const plan = signInPlan(page.win())
      if (plan.where === 'here') return void supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: plan.redirectTo } })
      void supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: plan.redirectTo, skipBrowserRedirect: true } }).then(({ data }) => {
        if (data?.url) page.goTop(data.url)
      })
    },
    signOut: () => void supabase.auth.signOut(),
    async count() {
      const { data } = await supabase.from('approvals_pending').select('pending').single()
      return (data as { pending: number } | null)?.pending ?? 0
    },
    async covers() {
      const { data } = await supabase.from('approvals_cover').select('id, kind, requester_seat, created_at').order('created_at')
      return (data as Cover[] | null) ?? []
    },
    // #222: decided covers come from approvals_decided_cover; before that SQL is applied the view is missing and the
    // visitor's 처리된 결재 section simply stays empty (no error shown)
    async decidedCovers() {
      const { data, error } = await supabase.from('approvals_decided_cover').select('id, kind, requester_seat, result, decided_at').order('decided_at', { ascending: false }).limit(30)
      if (error) return []
      return (data as DecidedCover[] | null) ?? []
    },
    async pending() {
      const { data, error } = await supabase.from('approvals').select('*').in('status', ['pending', 'deciding']).order('created_at')
      if (error) throw error
      return oldestFirst(data as StoredApproval[])
    },
    async decided() {
      const { data, error } = await supabase.from('approvals').select('*').eq('status', 'decided').order('decided_at', { ascending: false }).limit(30)
      if (error) throw error
      return data as StoredApproval[]
    },
    async decide(id, result, opinion): Promise<DecideResult> {
      try {
        const res = await fetch(assetUrl('api/approve'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
          body: JSON.stringify({ id, result, opinion }),
        })
        return res.ok ? { ok: true } : { ok: false, status: res.status }
      } catch {
        return { ok: false, status: 0 }
      }
    },
  }
}
