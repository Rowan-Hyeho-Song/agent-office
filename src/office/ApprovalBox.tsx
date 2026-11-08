import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react'
import { renderMarkdown } from './approval/markdown'
import { closeApprovalBox, openApprovalBox, toggleApprovalBox, useApprovalBoxOpen } from './approval/panel'
import type { ApprovalSource, Cover, Role } from '../approvals/source'
import type { StoredApproval } from '../approvals/types'
import { KIND_LABEL, answersFor, decidedText, fmtDate, fmtDay, kindOf, noteHint, shortRepo, type Kind } from '../approvals/view'
import { Icon } from './ApprovalIcons'
import { AGENT_INFO, type OfficeWorld } from './world'

/**
 * The approval box (#25, #64; design: docs/design/docs-ui.md section 1). Visitors see "결재 대기 N건" and the SECRET
 * covers (kind, agent, date). The owner signs in with GitHub (the key dot on the door screen, or `?owner`), sees the
 * waiting list and decides here; the decision goes through /api/approve, which checks the sign-in on the server and
 * posts the ✅ comment on GitHub. The page only hides things from others; the lock is the server's owner check and
 * the table's RLS.
 */
export function ApprovalBox({ world }: { world: OfficeWorld }) {
  const src = world.approvals
  return src ? <Box src={src} /> : null
}

export const useRole = (src: ApprovalSource): Role => useSyncExternalStore(src.subscribe.bind(src), () => src.role())

/** a number from a design token (tokens.css, unitless ms) */
const tokenMs = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0

/** the requesting agent: name and role in its own color (the seat's color token), else a temporary worker */
function agentOf(seat: number | null, requester = '') {
  const info = seat === null ? undefined : AGENT_INFO[`agent_${seat}`]
  const other = requester || '임시 직원'
  return { key: info ? String(seat) : 'x', label: info ? `${info.name} · ${info.role}` : other, first: info ? info.name.split(' ')[0] : other }
}

function Box({ src }: { src: ApprovalSource }) {
  const role = useRole(src)
  const open = useApprovalBoxOpen()
  const [count, setCount] = useState<number | null>(null)
  const [live, setLive] = useState('')
  const [thud, setThud] = useState(false)
  const back = useRef<(() => void) | null>(null) // set by the owner view while one item is open
  const panel = useRef<HTMLElement>(null)

  const refresh = useCallback(() => void src.count().then(setCount, () => {}), [src])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  }, [refresh, role])

  // ?owner opens the box for sign-in; becoming the owner opens it too (the way back from GitHub)
  useEffect(() => {
    if (new URLSearchParams(location.search).has('owner')) openApprovalBox()
  }, [])
  useEffect(() => {
    if (role === 'owner') openApprovalBox()
  }, [role])

  // focus goes into the panel when it opens and back to where it was when it closes
  useEffect(() => {
    if (!open) return
    const from = document.activeElement as HTMLElement | null
    panel.current?.focus()
    refresh()
    return () => from?.focus?.()
  }, [open, refresh])

  // Esc: back to the list, and from the list close the panel
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (back.current) back.current()
      else closeApprovalBox()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {role === 'owner' && (
        <span className="owner-tag">
          OWNER{' '}
          <button type="button" onClick={() => src.signOut()}>
            나가기
          </button>
        </span>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
      {!open && (
        <button type="button" className="approval-tab approval-launcher" aria-expanded={false} aria-controls="approval-box" onClick={toggleApprovalBox}>
          <Icon name="inbox" />
          결재함{count !== null && ` · 대기 ${count}`}
        </button>
      )}
      {open && (
        <section id="approval-box" ref={panel} tabIndex={-1} className="approval-box" aria-label="결재함">
          <div className="approval-tab">
            <Icon name="inbox" />
            {role === 'owner' ? '결재함 · OWNER' : '결재함'}
          </div>
          <div className={`approval-body${thud ? ' thud' : ''}`}>
            <div className="approval-head">
              <h2>결재함</h2>
              <button type="button" className="approval-close" aria-label="닫기" onClick={closeApprovalBox}>
                Esc
              </button>
            </div>
            {role === 'owner' ? (
              <OwnerView src={src} announce={setLive} setThud={setThud} onChange={refresh} back={back} />
            ) : (
              <VisitorView src={src} role={role} count={count} />
            )}
          </div>
        </section>
      )}
    </>
  )
}

function VisitorView({ src, role, count }: { src: ApprovalSource; role: Role; count: number | null }) {
  const [covers, setCovers] = useState<Cover[]>([])
  useEffect(() => {
    const load = () => void src.covers().then(setCovers, () => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [src])
  const askedForOwner = new URLSearchParams(location.search).has('owner')
  return (
    <div className="approval-scroll">
      <div className="approval-count">
        <b>{count ?? '…'}</b>
        <span>결재 대기 {count ?? '…'}건 · 주인이 확인하면 공개돼요</span>
      </div>
      {covers.length > 0 && (
        <ul className="secret-list">
          {covers.map((c) => {
            const k = kindOf(c.kind)
            const who = agentOf(c.requester_seat)
            return (
              <li key={c.id} className="secret-cover" data-seat={who.key}>
                <span className="sr-only">SECRET 결재 요청. 내용은 공개되지 않았습니다.</span>
                <span className="k">
                  <Icon name={k} /> {KIND_LABEL[k]}
                </span>
                <span className="bar" aria-hidden="true" />
                <span className="d">
                  {who.first} · {fmtDay(c.created_at)}
                </span>
                <span className="secret-stamp" aria-hidden="true">
                  SECRET
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {role === 'other' ? (
        <p className="approval-signin">
          주인 계정이 아니에요.{' '}
          <button type="button" className="btn-ghost" onClick={() => src.signOut()}>
            로그아웃
          </button>
        </p>
      ) : askedForOwner ? (
        <p className="approval-signin">
          <button type="button" className="btn-primary" onClick={() => src.signIn()}>
            주인 로그인(GitHub)
          </button>
        </p>
      ) : (
        <p className="approval-signin">내용은 주인만 볼 수 있어요.</p>
      )}
    </div>
  )
}

type Tab = 'pending' | 'done'

function OwnerView({
  src,
  announce,
  setThud,
  onChange,
  back,
}: {
  src: ApprovalSource
  announce: (s: string) => void
  setThud: (b: boolean) => void
  onChange: () => void
  back: RefObject<(() => void) | null>
}) {
  const [pending, setPending] = useState<StoredApproval[] | null>(null)
  const [done, setDone] = useState<StoredApproval[]>([])
  const [error, setError] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [cur, setCur] = useState<StoredApproval | null>(null)
  const lastId = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([src.pending(), src.decided()])
      setPending(p)
      setDone(d)
      setError(false)
    } catch {
      setError(true)
    }
  }, [src])
  useEffect(() => void load(), [load])

  const toList = useCallback(() => setCur(null), [])
  useEffect(() => {
    back.current = cur ? toList : null
    return () => {
      back.current = null
    }
  }, [cur, toList, back])

  // back on the list: focus the card that was open
  useEffect(() => {
    if (cur || lastId.current === null) return
    list.current?.querySelector<HTMLElement>(`[data-id="${lastId.current}"]`)?.focus()
  }, [cur])

  const open = (a: StoredApproval) => {
    lastId.current = a.id
    setCur(a)
  }

  const finished = (a: StoredApproval, result: string) => {
    const rest = (pending ?? []).filter((x) => x.id !== a.id)
    setPending(rest)
    setDone((d) => [{ ...a, status: 'decided', result }, ...d])
    onChange()
    void load()
    if (rest[0]) open(rest[0])
    else {
      setTab('pending')
      setCur(null)
    }
  }

  if (cur) return <Detail key={cur.id} a={cur} src={src} onBack={toList} onDone={finished} announce={announce} setThud={setThud} />

  const items = tab === 'pending' ? (pending ?? []) : done
  return (
    <>
      <div className="approval-tabs" role="tablist" aria-label="결재함">
        <button role="tab" type="button" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
          대기 <b>{pending?.length ?? '…'}</b>
        </button>
        <button role="tab" type="button" aria-selected={tab === 'done'} onClick={() => setTab('done')}>
          처리됨 {done.length}
        </button>
      </div>
      <div className="approval-scroll" role="tabpanel" ref={list}>
        {error && (
          <p className="approval-error" role="alert">
            결재함을 불러오지 못했어요.{' '}
            <button type="button" className="btn-ghost" onClick={() => void load()}>
              다시 불러오기
            </button>
          </p>
        )}
        {items.length > 0 ? (
          <ul className="approval-list">
            {items.map((a) => {
              const who = agentOf(a.requester_seat, a.requester)
              const body = (
                <>
                  <span className="row1">
                    <Badge kind={kindOf(a.kind)} />
                    <span className="approval-date">{fmtDate(a.created_at)}</span>
                  </span>
                  <span className="t">{a.title}</span>
                  <span className="meta">
                    <span className="who">{who.label}</span>
                    <span>
                      {shortRepo(a.repo)} #{a.folder}
                    </span>
                    {a.result && <span className="approval-result">✅ {a.result}</span>}
                  </span>
                </>
              )
              return (
                <li key={a.id}>
                  {tab === 'pending' ? (
                    <button type="button" className="approval-item" data-seat={who.key} data-id={a.id} onClick={() => open(a)}>
                      {body}
                    </button>
                  ) : (
                    <div className="approval-item static" data-seat={who.key}>
                      {body}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          pending !== null &&
          !error && (
            <div className="approval-empty">
              <Icon name="inbox" />
              <p>
                {tab === 'pending' ? (
                  <>
                    결재할 것이 없어요.
                    <br />
                    에이전트들이 알아서 일하는 중입니다.
                  </>
                ) : (
                  '처리한 결재가 아직 없어요.'
                )}
              </p>
            </div>
          )
        )}
      </div>
    </>
  )
}

function Badge({ kind }: { kind: Kind }) {
  return (
    <span className="approval-badge" data-kind={kind}>
      <Icon name={kind} />
      {KIND_LABEL[kind]}
    </span>
  )
}

function Stamp() {
  const d = new Date()
  const day = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  return (
    <div className="approval-stamp" aria-hidden="true">
      <svg viewBox="0 0 112 112">
        <circle cx="56" cy="56" r="50" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="56" cy="56" r="42" fill="none" stroke="currentColor" strokeWidth="2" />
        <text x="56" y="34" textAnchor="middle" fontSize="11" fill="currentColor">
          ROWAN
        </text>
        <text x="56" y="60" textAnchor="middle" fontWeight="700" fontSize="26" fill="currentColor">
          결재
        </text>
        <text x="56" y="80" textAnchor="middle" fontSize="12" fill="currentColor">
          {day}
        </text>
      </svg>
    </div>
  )
}

type Phase = 'idle' | 'busy' | 'stamped' | 'error'

function Detail({
  a,
  src,
  onBack,
  onDone,
  announce,
  setThud,
}: {
  a: StoredApproval
  src: ApprovalSource
  onBack: () => void
  onDone: (a: StoredApproval, result: string) => void
  announce: (s: string) => void
  setThud: (b: boolean) => void
}) {
  const answers = answersFor(a)
  const [sel, setSel] = useState<string | null>(null) // kept after a failed send
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const title = useRef<HTMLHeadingElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const k = kindOf(a.kind)
  const who = agentOf(a.requester_seat, a.requester)
  const { required, hint } = noteHint(sel)
  const empty = !note.trim()
  const blocked = sel === null || (required && empty)

  useEffect(() => {
    title.current?.focus()
    return () => {
      clearTimeout(timer.current)
      setThud(false)
    }
  }, [setThud])

  const submit = async () => {
    if (phase === 'busy' || phase === 'stamped') return
    setTried(true)
    if (sel === null || blocked) return
    setPhase('busy')
    const res = await src.decide(a.id, sel, note)
    if (!res.ok) return setPhase('error')
    setPhase('stamped')
    setThud(true)
    announce(decidedText(a, sel))
    timer.current = setTimeout(() => onDone(a, sel), tokenMs('--approval-stamp-ms') + tokenMs('--approval-next-ms'))
  }

  // Enter decides (Shift+Enter is a new line in the opinion); not while an IME is composing, nor on buttons and links
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (['BUTTON', 'A', 'SUMMARY'].includes((e.target as HTMLElement).tagName)) return
    e.preventDefault()
    void submit()
  }

  const stamped = phase === 'stamped'
  return (
    <>
      <div className="approval-scroll" onKeyDown={onKeyDown}>
        <div className="approval-detail" data-seat={who.key}>
          <button className="approval-back" type="button" onClick={onBack}>
            ← 목록
          </button>
          <div>
            <Badge kind={k} />
          </div>
          <h3 className="approval-title" id={`t-${a.id}`} ref={title} tabIndex={-1}>
            {a.title}
          </h3>
          <div className="approval-meta">
            <span className="who">{who.label}</span>
            <span>
              파일철{' '}
              <a href={a.source_url} target="_blank" rel="noreferrer">
                {shortRepo(a.repo)} #{a.folder} ↗
              </a>
            </span>
            <span>{fmtDate(a.created_at)}</span>
          </div>
          <div className="approval-content">{renderMarkdown(a.content)}</div>
          <fieldset className="approval-options" disabled={stamped || phase === 'busy'}>
            <legend>{k === 'decision' ? '선택지' : '결과'}</legend>
            {answers.map((o) => (
              <label key={o.value} className={`approval-option${stamped && sel === o.value ? ' stamped' : ''}`} data-reject={o.reject ? '' : undefined}>
                <input type="radio" name={`opt-${a.id}`} value={o.value} checked={sel === o.value} onChange={() => setSel(o.value)} />
                <span className="num">{o.num}</span>
                <span className="lbl">{o.label}</span>
                {o.recommended && <span className="approval-rec">추천</span>}
                {stamped && sel === o.value && <Stamp />}
              </label>
            ))}
          </fieldset>
          {a.reason && (
            <details className="approval-reason">
              <summary>추천 이유</summary>
              <div>{renderMarkdown(a.reason)}</div>
            </details>
          )}
          <div className="approval-note">
            <label htmlFor={`note-${a.id}`}>
              의견 {required ? <b>{hint}</b> : hint}
            </label>
            <textarea id={`note-${a.id}`} value={note} maxLength={1000} disabled={stamped} aria-invalid={tried && required && empty} onChange={(e) => setNote(e.target.value)} />
          </div>
          {phase === 'error' && (
            <div className="approval-error" role="alert">
              결재를 보내지 못했어요. 고른 것은 그대로 있어요.{' '}
              <button className="btn-ghost" type="button" onClick={() => void submit()}>
                다시 보내기
              </button>
            </div>
          )}
          {stamped && (
            <div className="approval-done">
              <Icon name="check" />
              <span>
                {shortRepo(a.repo)} #{a.folder}에 ✅ 결재 댓글을 남겼어요. {who.first}에게 알림이 갑니다.
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="approval-actions">
        <span className="hint">{stamped ? '' : 'Enter로 결재 · Esc로 목록'}</span>
        <button className="btn-ghost" type="button" onClick={onBack} disabled={stamped}>
          나중에
        </button>
        <button className="btn-primary" type="button" disabled={blocked || phase === 'busy' || stamped} onClick={() => void submit()}>
          결재
        </button>
      </div>
    </>
  )
}
