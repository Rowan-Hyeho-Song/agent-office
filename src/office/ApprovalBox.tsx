import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { PUBLISH_RESULTS, needsOpinion } from '../approvals/approve'
import type { StoredApproval } from '../approvals/types'
import { supabase } from './supabase'

/**
 * The approval box, 2D first (#25, plan.md 6.5–6.6). Visitors see only "결재 대기 N건". The owner signs in with
 * GitHub (the way in is `?owner`, not shown to visitors), sees the pending list and decides here; the decision
 * goes through /api/approve, which checks the sign-in on the server and posts the ✅ comment on GitHub.
 * The page only hides the box from others; the lock is the server's owner check and the table's RLS.
 */
export function ApprovalBox() {
  const [pending, setPending] = useState<number | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [owner, setOwner] = useState<boolean | null>(null)
  const askedForOwner = new URLSearchParams(location.search).has('owner')

  // the count everyone sees (a view that hands out only the number)
  const refreshCount = useCallback(async () => {
    const { data } = await supabase!.from('approvals_pending').select('pending').single()
    setPending((data as { pending: number } | null)?.pending ?? 0)
  }, [])

  useEffect(() => {
    if (!supabase) return
    void refreshCount()
    const timer = setInterval(refreshCount, 60_000)
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      clearInterval(timer)
      sub.subscription.unsubscribe()
    }
  }, [refreshCount])

  useEffect(() => {
    if (!supabase || !session) return setOwner(null)
    void supabase.rpc('is_owner').then(({ data }) => setOwner(data === true))
  }, [session])

  if (!supabase) return null
  const signIn = () => supabase!.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.href } })
  const signOut = () => supabase!.auth.signOut()

  return (
    <section className="approval-box" aria-label="결재함">
      <p className="approval-count">
        결재 대기 <b>{pending ?? '…'}</b>건
      </p>
      {askedForOwner && !session && (
        <button className="approval-signin" onClick={signIn}>
          주인 로그인(GitHub)
        </button>
      )}
      {session && owner === false && (
        <p className="approval-note">
          주인 계정이 아니에요. <button onClick={signOut}>로그아웃</button>
        </p>
      )}
      {session && owner && <OwnerList session={session} onChange={refreshCount} onSignOut={signOut} />}
    </section>
  )
}

function OwnerList({ session, onChange, onSignOut }: { session: Session; onChange: () => void; onSignOut: () => void }) {
  const [items, setItems] = useState<StoredApproval[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase!.from('approvals').select('*').eq('status', 'pending').order('created_at')
    if (error) setError('결재함을 불러오지 못했어요')
    else setItems(data as StoredApproval[])
  }, [])
  useEffect(() => void load(), [load])

  const decide = async (id: number, result: string, opinion: string) => {
    setError(null)
    const res = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id, result, opinion }),
    })
    if (!res.ok) setError(`결재하지 못했어요 (${res.status})`)
    await load()
    onChange()
  }

  return (
    <div className="approval-list">
      <header>
        결재함 <button onClick={onSignOut}>로그아웃</button>
      </header>
      {error && <p className="approval-note">{error}</p>}
      {!items.length && <p className="approval-note">대기 중인 결재가 없어요.</p>}
      {items.map((a) => (
        <ApprovalItem key={a.id} a={a} onDecide={decide} />
      ))}
    </div>
  )
}

/** the answers each kind takes, same rules as the server (src/approvals/approve.ts readChoice) */
function answersFor(a: StoredApproval): { value: string; label: string }[] {
  if (/공개/.test(a.kind)) return PUBLISH_RESULTS.map((r) => ({ value: r, label: r }))
  if (/결정/.test(a.kind)) {
    return [
      ...a.options.map((o, i) => ({ value: `선택지 ${i + 1}`, label: `${i + 1}. ${o}${a.recommended === i + 1 ? ' (추천)' : ''}` })),
      { value: '반려', label: '반려' },
    ]
  }
  return [
    { value: '승인', label: '승인' },
    { value: '반려', label: '반려' },
  ]
}

function ApprovalItem({ a, onDecide }: { a: StoredApproval; onDecide: (id: number, result: string, opinion: string) => Promise<void> }) {
  const answers = answersFor(a)
  const [choice, setChoice] = useState<string>(a.recommended ? `선택지 ${a.recommended}` : answers[0].value)
  const [opinion, setOpinion] = useState('')
  const [busy, setBusy] = useState(false)
  const opinionMissing = needsOpinion(choice) && !opinion.trim()
  const submit = async () => {
    setBusy(true)
    await onDecide(a.id, choice, opinion)
    setBusy(false)
  }
  return (
    <article className="approval-item">
      <h3>
        <a href={a.source_url} target="_blank" rel="noreferrer">
          {a.repo.split('/').pop()} #{a.folder}
        </a>{' '}
        {a.title} · {a.kind} · {a.requester}
      </h3>
      <p>{a.content}</p>
      <fieldset>
        <legend>결재</legend>
        {answers.map((o) => (
          <label key={o.value}>
            <input type="radio" name={`choice-${a.id}`} checked={choice === o.value} onChange={() => setChoice(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {a.reason && <p className="approval-reason">추천 이유: {a.reason}</p>}
      <textarea
        placeholder={needsOpinion(choice) ? '의견(필수: 무엇을 고칠지)' : '의견(선택)'}
        value={opinion}
        maxLength={1000}
        onChange={(e) => setOpinion(e.target.value)}
      />
      <div className="approval-actions">
        <button disabled={busy || opinionMissing} onClick={submit}>
          {choice}(으)로 결재
        </button>
      </div>
    </article>
  )
}
