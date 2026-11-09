import { cue } from '../audio/cues'
import { approvalsRefreshed, resetApprovalChime } from '../audio/notify'
import { DockSlot } from './CornerDock'
import { SideSlot, useSidePanelOpen } from './SidePanel'
import { setSideBack, setSideLayout, setSideRaise, setSideUnseen } from './sidePanel/store'
import type { SignalHub } from './signal'
import { ANNOUNCE_GROUP_MS, announceText, approvalName, arrivals, groupAnnouncements, loadSeenAt, saveSeenAt, seenNow, showDot, unseenOf, type Waiting } from '../approvals/unseen'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react'
import { renderMarkdown } from './approval/markdown'
import { openApprovalBox, toggleApprovalBox, useApprovalBoxOpen } from './approval/panel'
import type { ApprovalSource, Cover, DecidedCover, Role } from '../approvals/source'
import type { StoredApproval } from '../approvals/types'
import { KIND_LABEL, answersFor, chosenOption, decidedCoverLabel, decidedLabel, decidedText, elapsedText, fmtDate, fmtDay, fmtStamp, kindOf, noteHint, shortRepo, stampText, type Kind } from '../approvals/view'
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
  return src ? <Box src={src} signal={world.signal} /> : null
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

function Box({ src, signal }: { src: ApprovalSource; signal: SignalHub | null }) {
  const role = useRole(src)
  const open = useApprovalBoxOpen()
  const [count, setCount] = useState<number | null>(null)
  const [items, setItems] = useState<Waiting[]>([])
  /** bumped on every re-read, so an open list re-reads with the box (the lists no longer poll on their own) */
  const [version, setVersion] = useState(0)
  /** #240 when the box was last open on this browser; none stored yet = a first visit, where nothing is new */
  const [seenAt, setSeenAt] = useState<number | null>(() => loadSeenAt() ?? Date.now())
  const [live, setLive] = useState('')
  const [thud, setThud] = useState(false)
  const back = useRef<(() => void) | null>(null) // set by the owner view while one item is open
  const shown = useSidePanelOpen()

  // the ids of the last look (null = the first look of this visit or role: nothing in it is news) and the 5 s grouping of what is read out
  const known = useRef<Set<number> | null>(null)
  const seq = useRef(0)
  const grouper = useMemo(() => groupAnnouncements((got) => setLive(announceText(got)), ANNOUNCE_GROUP_MS), [])
  useEffect(() => () => grouper.cancel(), [grouper])

  // one re-read of the waiting count and list (the owner's rows with titles, a visitor's covers)
  const refresh = useCallback(async () => {
    const mine = ++seq.current
    const asOwner = src.role() === 'owner'
    try {
      const [n, list] = await Promise.all([src.count(), asOwner ? src.pending() : src.covers()])
      if (mine !== seq.current) return
      const waiting: Waiting[] = asOwner
        ? (list as StoredApproval[]).map((a) => ({ id: a.id, at: a.created_at, label: `${agentOf(a.requester_seat, a.requester).first}: ${a.title}` }))
        : (list as Cover[]).map((c) => ({ id: c.id, at: c.created_at, label: null }))
      const newestAt = waiting.reduce<string | null>((m, w) => (m === null || w.at > m ? w.at : m), null)
      approvalsRefreshed(n, asOwner, newestAt)
      grouper.add(arrivals(known.current, waiting))
      known.current = new Set(waiting.map((w) => w.id))
      setCount(n)
      setItems(waiting)
      setVersion((v) => v + 1)
    } catch {
      /* keep what is shown; the next signal or poll tries again */
    }
  }, [src, grouper])
  // signed in or out: a different viewer, so the first look is a first look again (nothing is news, no chime)
  useEffect(() => {
    known.current = null
    resetApprovalChime()
    grouper.cancel()
    void refresh()
  }, [refresh, role, grouper])
  // #240 the server's signal (and, for the owner, the table's own changes) re-read; the hub polls when the channel is down
  useEffect(() => signal?.on('approvals', () => void refresh()), [signal, refresh])
  useEffect(() => {
    signal?.watchOwner(role === 'owner')
    return () => signal?.watchOwner(false)
  }, [signal, role])

  // the dot: waiting items filed after the box was last open. Open, the box is being looked at: all of it counts as seen
  const unseen = unseenOf(items, seenAt).length
  const dot = showDot(count, unseen)
  useEffect(() => {
    if (!open) return
    const at = seenNow(items, Date.now())
    saveSeenAt(at)
    setSeenAt(at)
  }, [open, items])
  useEffect(() => void setSideUnseen('approval', dot ? unseen : 0), [dot, unseen])
  // a first visit stores its start, so what arrives before the next visit counts as new then
  useEffect(() => {
    if (loadSeenAt() === null && seenAt !== null) saveSeenAt(seenAt)
  }, [seenAt])

  // ?owner opens the box for sign-in; becoming the owner opens it too (the way back from GitHub)
  useEffect(() => {
    if (new URLSearchParams(location.search).has('owner')) openApprovalBox()
  }, [])
  useEffect(() => {
    if (role === 'owner') openApprovalBox()
  }, [role])

  // focus and the close button belong to the side panel (SidePanel.tsx); here: a fresh count when it opens, and the count for its tab
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])
  useEffect(() => setSideLayout({ count }), [count])

  // Esc: back to the list first (the panel's Esc calls this, then closes the panel itself)
  useEffect(() => {
    setSideBack('approval', () => {
      if (!back.current) return false
      back.current()
      return true
    })
    return () => setSideBack('approval', null)
  }, [])

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
      {!shown && (
        <DockSlot slot="approval">
          <button
            type="button"
            className="dock-btn approval-launcher"
            aria-expanded={false}
            aria-controls="approval-box"
            onClick={toggleApprovalBox}
          >
            <Icon name="inbox" />
            {/* the name is words, the dot is not: `결재함, 대기 3건, 새 결재 1건` (#240) */}
            <span className="sr-only">{approvalName(count, unseen)}</span>
            <span className="dock-label" aria-hidden="true">
              결재함{count !== null && ` · 대기 ${count}`}
            </span>
            {dot && <i className="new-dot approval" aria-hidden="true" />}
            {/* the count on the icon when the label is hidden (under 360px; the name and count are in aria-label) */}
            {!!count && (
              <b className="dock-badge" aria-hidden="true">
                {count}
              </b>
            )}
          </button>
        </DockSlot>
      )}
      <SideSlot tab="approval">
        <div id="approval-box" className="approval-box" role="tabpanel" aria-labelledby="side-tab-approval">
          <div className={`approval-body${thud ? ' thud' : ''}`}>
            {role === 'owner' ? (
              <OwnerView src={src} announce={setLive} setThud={setThud} onChange={() => void refresh()} version={version} back={back} />
            ) : (
              <VisitorView src={src} role={role} count={count} version={version} back={back} />
            )}
          </div>
        </div>
      </SideSlot>
    </>
  )
}

function VisitorView({ src, role, count, version, back }: { src: ApprovalSource; role: Role; count: number | null; version: number; back: RefObject<(() => void) | null> }) {
  const [covers, setCovers] = useState<Cover[]>([])
  const [done, setDone] = useState<DecidedCover[]>([])
  const [cur, setCur] = useState<DecidedCover | null>(null)
  const lastId = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  // re-read with every re-read of the box (a signal, the poll when the channel is down, opening it)
  useEffect(() => {
    void src.covers().then(setCovers, () => {})
    void src.decidedCovers?.().then(setDone, () => {})
  }, [src, version])
  // one decided cover open: Esc and the back button return to the list, the phone sheet goes tall (like the owner's detail)
  const toList = useCallback(() => setCur(null), [])
  useEffect(() => {
    setSideRaise('approval', !!cur)
    back.current = cur ? toList : null
    return () => {
      back.current = null
      setSideRaise('approval', false)
    }
  }, [cur, toList, back])
  useEffect(() => {
    if (cur || lastId.current === null) return
    list.current?.querySelector<HTMLElement>(`[data-id="${lastId.current}"]`)?.focus()
  }, [cur])
  const askedForOwner = new URLSearchParams(location.search).has('owner')
  if (cur) return <DecidedCoverDetail c={cur} onBack={toList} />
  return (
    <div className="approval-scroll" ref={list}>
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
      {done.length > 0 && (
        <section className="secret-done" aria-label="처리된 결재">
          <p className="approval-sub">처리된 결재 {done.length}</p>
          <ul className="secret-list">
            {done.map((c) => {
              const who = agentOf(c.requester_seat)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="secret-cover"
                    data-seat={who.key}
                    data-id={c.id}
                    onClick={() => {
                      lastId.current = c.id
                      setCur(c)
                    }}
                  >
                    <span className="sr-only">{decidedCoverLabel(who.first, c.result, c.decided_at)}</span>
                    <span className="contents" aria-hidden="true">
                      <span className="k">{stampText(c.result)}</span>
                      <span className="bar" />
                      <span className="d">
                        {who.first} · {fmtDay(c.decided_at)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
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
  version,
  back,
}: {
  src: ApprovalSource
  announce: (s: string) => void
  setThud: (b: boolean) => void
  onChange: () => void
  version: number
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
  useEffect(() => void load(), [load, version])

  const toList = useCallback(() => setCur(null), [])
  // one approval open: the phone sheet goes tall
  useEffect(() => {
    setSideRaise('approval', !!cur)
    return () => void setSideRaise('approval', false)
  }, [cur])
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

  if (cur?.status === 'decided') return <DecidedDetail key={cur.id} a={cur} onBack={toList} />
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
                  <button
                    type="button"
                    className="approval-item"
                    data-seat={who.key}
                    data-id={a.id}
                    onClick={() => open(a)}
                  >
                    {/* the decided row is named by one spoken sentence (an sr-only span, not aria-label: axe's label-content-name-mismatch wants the visible words inside an aria-label); the visible words are hidden from readers so nothing is read twice */}
                    {tab === 'done' ? (
                      <>
                        <span className="sr-only">{decidedLabel(who.first, a.title, a.result, a.decided_at)}</span>
                        <span className="contents" aria-hidden="true">
                          {body}
                        </span>
                      </>
                    ) : (
                      body
                    )}
                  </button>
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

function Badge({ kind, label = KIND_LABEL[kind] }: { kind: Kind; label?: string }) {
  return (
    <span className="approval-badge" data-kind={kind}>
      <Icon name={kind} />
      {label}
    </span>
  )
}

/** the chip of a decided detail: what was asked, in a word */
const SHORT_KIND: Record<Kind, string> = { decision: '선택', publish: '공개', review: '승인/반려' }

/** the result stamp of a decided approval: 54px, red, tilted, and still (the one stamped in the pending detail is the animated one) */
function ResultStamp({ result }: { result: string | null }) {
  const text = stampText(result)
  const n = [...text].length
  return (
    <span className="result-stamp">
      <span className="sr-only">결과: {text}</span>
      <svg viewBox="0 0 112 112" aria-hidden="true">
        <circle cx="56" cy="56" r="50" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="56" cy="56" r="42" fill="none" stroke="currentColor" strokeWidth="2" />
        <text
          x="56"
          y="56"
          textAnchor="middle"
          dominantBaseline="central"
          fontWeight="700"
          fontSize={n <= 2 ? 32 : n <= 4 ? 24 : 15}
          textLength={n > 4 ? 70 : undefined}
          lengthAdjust="spacingAndGlyphs"
          fill="currentColor"
        >
          {text}
        </text>
      </svg>
    </span>
  )
}

/** a decided approval for its owner (#222): read-only, the pending detail's blocks, no action row */
function DecidedDetail({ a, onBack }: { a: StoredApproval; onBack: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => title.current?.focus(), [])
  const who = agentOf(a.requester_seat, a.requester)
  const k = kindOf(a.kind)
  const picked = chosenOption(a)
  const options = k === 'decision' ? answersFor(a).filter((o) => !o.reject) : []
  const opinion = (a.opinion ?? '').trim()
  const took = elapsedText(a.created_at, a.decided_at)
  return (
    <div className="approval-scroll">
      <div className="approval-detail decided" data-seat={who.key}>
        <button className="approval-back" type="button" onClick={onBack}>
          ← 처리됨
        </button>
        <div className="row1">
          <span className="who">
            <i className="dot" aria-hidden="true" />
            {who.label}
          </span>
          <Badge kind={k} label={SHORT_KIND[k]} />
          <ResultStamp result={a.result} />
        </div>
        <h3 className="approval-title" ref={title} tabIndex={-1}>
          {a.title}
        </h3>
        <div className="approval-meta">
          <span>
            요청 {fmtStamp(a.created_at)} · 결재 {fmtStamp(a.decided_at)}
            {took && ` · ${took}`}
          </span>
        </div>
        <div className="approval-content">{renderMarkdown(a.content)}</div>
        {options.length > 0 && (
          <div className="approval-options ro">
            <p className="legend">선택지</p>
            <ul>
              {options.map((o) => {
                const chosen = picked !== null && o.num === String(picked)
                return (
                  <li key={o.value} className={`approval-option ro${chosen ? ' chosen' : ' dim'}`}>
                    <span className="num">{o.num}</span>
                    <span className="lbl">{o.label}</span>
                    {o.recommended && <span className="approval-rec">추천</span>}
                    {chosen && <span className="pick">✓ 고름</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {(opinion || a.result === '반려') && (
          <div className="approval-note ro">
            <span className="nl">의견</span>
            {opinion ? <p className="said">{opinion}</p> : <p className="said none">의견 없음</p>}
          </div>
        )}
        {(a.source_url || a.result_url) && (
          <p className="approval-links">
            {a.source_url && (
              <a href={a.source_url} target="_blank" rel="noreferrer">
                🖊 요청 원문 ↗<span className="sr-only"> (새 탭)</span>
              </a>
            )}
            {a.result_url && (
              <a href={a.result_url} target="_blank" rel="noreferrer">
                ✅ 결과 기록 ↗<span className="sr-only"> (새 탭)</span>
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/** the same detail for a visitor: who, the result, when; the rest stays behind the SECRET cover (nothing private is in the page) */
function DecidedCoverDetail({ c, onBack }: { c: DecidedCover; onBack: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => title.current?.focus(), [])
  const who = agentOf(c.requester_seat)
  return (
    <div className="approval-scroll">
      <div className="approval-detail decided" data-seat={who.key}>
        <button className="approval-back" type="button" onClick={onBack}>
          ← 처리됨
        </button>
        <div className="row1">
          <span className="who">
            <i className="dot" aria-hidden="true" />
            {who.label}
          </span>
          <ResultStamp result={c.result} />
        </div>
        <h3 className="approval-title" ref={title} tabIndex={-1}>
          결재 서류 1건
        </h3>
        <div className="approval-meta">
          <span>결재 {fmtStamp(c.decided_at)}</span>
        </div>
        <div className="secret-seal">
          <span className="secret-stamp" aria-hidden="true">
            SECRET
          </span>
          <p>주인만 볼 수 있어요</p>
          <p className="sub">누가 · 언제 · 결과만 보입니다</p>
        </div>
      </div>
    </div>
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
    // the decision chime, then the stamp lands at 70% of its drop (styles.css stamp-in) (docs/design/sound.md 4.1 #8, #3)
    cue(answers.find((o) => o.value === sel)?.reject ? 'reject' : 'approve')
    cue('stamp.ui', { at: (tokenMs('--approval-stamp-ms') * 0.7) / 1000 })
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
