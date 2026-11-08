import { assetUrl } from '../../room/base'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalSource, Cover, DecideResult, Role } from '../../approvals/source'
import type { StoredApproval } from '../../approvals/types'
import { oldestFirst } from '../../approvals/view'

/** the real source: visitors read the two views, the owner reads the table and decides through /api/approve */
export function supabaseSource(supabase: SupabaseClient): ApprovalSource {
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
    signIn: () => void supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.href } }),
    signOut: () => void supabase.auth.signOut(),
    async count() {
      const { data } = await supabase.from('approvals_pending').select('pending').single()
      return (data as { pending: number } | null)?.pending ?? 0
    },
    async covers() {
      const { data } = await supabase.from('approvals_cover').select('id, kind, requester_seat, created_at').order('created_at')
      return (data as Cover[] | null) ?? []
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
