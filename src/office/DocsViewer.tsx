import { IssueReplayButton } from '../replay/IssueReplayButton'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { fmtDay as fmtShortDay } from '../approvals/view'
import {
  KIND_NAME,
  TOC,
  conversations,
  decisionView,
  formatRef,
  landOn,
  paperText,
  sections,
  type Sel,
  type DocBody,
  type DocFile,
  type DocFolder,
  type DocMeta,
} from '../docs/library'
import type { LibraryStore } from '../docs/store'
import { closeApprovalBox, openApprovalBox } from './approval/panel'
import { renderMarkdown } from './approval/markdown'
import { useRole } from './ApprovalBox'
import { Icon } from './ApprovalIcons'
import { closeDocs, openFromHash, toggleDocs, useDocsPanel } from './docs/panel'
import { AGENT_INFO, type OfficeWorld } from './world'

/**
 * The library viewer (#65; design: docs/design/docs-ui.md section 2). Left: project folders and files (an issue each).
 * Right: the file's head, its table of contents (기획서 → 회의록 → 결정 → 보고서, only those present) and one sheet of
 * paper. Minutes read as a conversation. SECRET documents show a manila cover with kind, date and agents only; the
 * body is never in the page for a visitor (the server's filter, see src/docs/library.ts and supabase/docs.sql), so
 * nothing here hides anything: it just draws what arrived. The owner sees review bodies under a "SECRET · 결재 대기" band.
 */
export function DocsViewer({ world }: { world: OfficeWorld }) {
  return world.library && world.approvals ? <Viewer world={world} lib={world.library} /> : null
}

/** a number from a design token (tokens.css, unitless ms) */
const tokenMs = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0

/** "11.07", with the year ("2025.11.07") when it is not this year */
const fmtDocDay = (iso: string) => (new Date(iso).getFullYear() === new Date().getFullYear() ? fmtShortDay(iso) : `${new Date(iso).getFullYear()}.${fmtShortDay(iso)}`)

const seatName = (seat: number) => AGENT_INFO[`agent_${seat}`]?.name ?? ''
const seatFirst = (seat: number) => seatName(seat).split(' ')[0]

function Viewer({ world, lib }: { world: OfficeWorld; lib: LibraryStore }) {
  const src = world.approvals!
  const role = useRole(src)
  const isOwner = role === 'owner'
  const panel = useDocsPanel()
  const snap = useSyncExternalStore(lib.subscribe, lib.getSnapshot)
  const [sel, setSel] = useState<Sel>({ fileKey: null, kind: null, row: null })
  const [live, setLive] = useState('')
  const [peeling, setPeeling] = useState<ReadonlySet<number>>(new Set())
  const box = useRef<HTMLElement>(null)
  const landed = useRef(0)
  const open = panel.open

  // an address in the page opens the viewer there, on load and when it changes
  useEffect(() => {
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  // where to land: each open (or "전문 보기") picks a file / kind / row once the list has arrived
  useEffect(() => {
    if (!open || !snap.metas || landed.current === panel.nonce) return
    landed.current = panel.nonce
    // a bare open (the launcher) keeps where you were
    setSel((s) => (panel.target || !s.fileKey ? landOn(snap.folders, panel.target) : s))
  }, [open, snap.metas, snap.folders, panel])

  // the viewer and the approval box share the screen: opening one closes the other
  useEffect(() => {
    if (open) closeApprovalBox()
  }, [open])

  // fresh list each time it opens
  useEffect(() => {
    if (open) void lib.refresh()
  }, [open, lib])

  // focus goes into the panel when it opens and back to where it was when it closes
  useEffect(() => {
    if (!open) return
    const from = document.activeElement as HTMLElement | null
    box.current?.focus()
    // the launcher is unmounted while open: after it is back, focus returns to it (or to where focus was)
    return () => void requestAnimationFrame(() => (from && from !== document.body && from.isConnected ? from : document.querySelector<HTMLElement>('.docs-launcher'))?.focus())
  }, [open])

  // Esc closes (joins the shared Esc registry of #68 later)
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeDocs()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const files = snap.folders.flatMap((f) => f.files)
  const file = files.find((f) => f.key === sel.fileKey) ?? files[0] ?? null
  const folder = snap.folders.find((f) => f.files.some((x) => x === file)) ?? null
  const kinds = file ? TOC.filter((t) => file.docs.some((d) => d.kind === t.kind)) : []
  const kind = kinds.find((t) => t.kind === sel.kind)?.kind ?? kinds[0]?.kind ?? null
  const docs = useMemo(() => (file && kind ? file.docs.filter((d) => d.kind === kind) : []), [file, kind])

  // the bodies of the readable documents shown now
  useEffect(() => {
    if (open && docs.length) void lib.ensure(docs.filter((d) => d.readable).map((d) => d.id))
  }, [open, docs, lib, snap.metas])

  // a SECRET document just approved: its cover plays the stamp fall and peel before the paper shows
  useEffect(
    () =>
      lib.onPublish((ids) => {
        setPeeling((p) => new Set([...p, ...ids]))
        setLive('결재되어 공개됐어요. 도장이 떨어지고 표지가 열렸습니다.')
        setTimeout(
          () =>
            setPeeling((p) => {
              const next = new Set(p)
              ids.forEach((id) => next.delete(id))
              return next
            }),
          tokenMs('--docs-peel-delay-ms') + tokenMs('--docs-peel-ms') + 100,
        )
      }),
    [lib],
  )

  // the page address follows the viewer: #library/owner/name/28/minutes/1-3 (private documents have none)
  useEffect(() => {
    const at = open && file ? formatRef({ repo: file.repo ?? undefined, n: file.n ?? undefined, kind: kind ?? undefined, row: sel.row ?? undefined }) : null
    const mine = /^#library\//.test(location.hash)
    if (at && at !== location.hash) history.replaceState(null, '', at)
    else if (!at && mine) history.replaceState(null, '', location.pathname + location.search)
  }, [open, file, kind, sel.row])

  const pick = useCallback((next: Partial<Sel>) => setSel((s) => ({ ...s, row: null, ...next })), [])
  const goFile = (f: DocFile) => pick({ fileKey: f.key, kind: null })
  const goFolder = (fo: DocFolder) => fo.files[0] && goFile(fo.files[0])

  const toc = useRef<HTMLDivElement>(null)
  const onTocKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = kinds.findIndex((t) => t.kind === kind)
    const next = kinds[(i + (e.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length]
    if (!next) return
    e.preventDefault()
    pick({ kind: next.kind })
    requestAnimationFrame(() => toc.current?.querySelector<HTMLElement>(`[data-doc="${next.kind}"]`)?.focus())
  }

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
      {!open && (
        <button type="button" className="approval-tab docs-launcher" aria-expanded={false} aria-controls="docs-box" onClick={toggleDocs}>
          <Icon name="publish" />
          서재
        </button>
      )}
      {open && (
        <section id="docs-box" ref={box} tabIndex={-1} className="docs-box" aria-label="서재">
          <div className="docs-tab">
            <Icon name="publish" />
            {isOwner ? '서재 · OWNER' : '서재'}
          </div>
          <div className="docs-body">
            <button type="button" className="approval-close docs-close" aria-label="닫기" onClick={closeDocs}>
              Esc
            </button>
            <div className="doc-viewer">
              <nav className="doc-nav" aria-label="서재 목록">
                {snap.metas === null && !snap.error && <p className="doc-note">불러오는 중…</p>}
                {snap.error && (
                  <p className="approval-error" role="alert">
                    서재를 불러오지 못했어요.{' '}
                    <button type="button" className="btn-ghost" onClick={() => void lib.refresh()}>
                      다시 불러오기
                    </button>
                  </p>
                )}
                <h4>프로젝트 폴더</h4>
                {snap.folders.map((fo) => (
                  <button key={fo.key} type="button" className="doc-folder" aria-current={fo === folder} onClick={() => goFolder(fo)}>
                    <Icon name={fo.repo === null ? 'lock' : 'publish'} />
                    {fo.label}
                  </button>
                ))}
                {folder && <h4>파일철</h4>}
                {folder?.files.map((f) => (
                  <button key={f.key} type="button" className="doc-file" aria-current={f === file} onClick={() => goFile(f)}>
                    <span className="n">{f.n ? `#${f.n}` : '—'}</span>
                    <span>
                      {f.title ?? (
                        <>
                          <span className="redact" style={{ width: 120 }} aria-hidden="true" />
                          <span className="sr-only">가려진 제목</span>
                        </>
                      )}
                    </span>
                    {f.secret && <span className="sec">{f.secret === 'review' ? `SECRET ${f.docs.filter((d) => !d.approved).length}` : 'SECRET'}</span>}
                  </button>
                ))}
                {snap.layout.note && <p className="doc-note">{snap.layout.note}</p>}
                {snap.metas?.length === 0 && <p className="doc-note">아직 문서가 없어요.</p>}
              </nav>
              <div className="doc-main">
                {file && folder ? (
                  <>
                    <FileHead file={file} folder={folder} />
                    {kinds.length > 0 && (
                      <div className="doc-toc" role="tablist" aria-label="문서 순서" ref={toc} onKeyDown={onTocKey}>
                        {kinds.map((t, i) => (
                          <button
                            key={t.kind}
                            type="button"
                            role="tab"
                            id={`doc-tab-${t.kind}`}
                            data-doc={t.kind}
                            aria-selected={t.kind === kind}
                            aria-controls="doc-stage"
                            tabIndex={t.kind === kind ? 0 : -1}
                            onClick={() => pick({ kind: t.kind })}
                          >
                            {i + 1}. {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="doc-stage" id="doc-stage" role="tabpanel" aria-labelledby={kind ? `doc-tab-${kind}` : undefined}>
                      <Stack file={file} folder={folder} docs={docs} bodies={snap.bodies} isOwner={isOwner} peeling={peeling} row={sel.row} nonce={panel.nonce} />
                    </div>
                  </>
                ) : (
                  <p className="doc-note doc-empty">{snap.metas ? '왼쪽에서 파일철을 골라 주세요.' : ''}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

function FileHead({ file, folder }: { file: DocFile; folder: DocFolder }) {
  const priv = folder.repo === null
  return (
    <div className="doc-filehead">
      <span className="doc-crumb">
        {folder.label}
        {' · 파일철 '}
        {priv ? <Bar w={30} /> : `#${file.n}`}
      </span>
      <h4>
        {file.title ?? (
          <>
            SECRET 문서
            <span className="sr-only">{priv ? ' (제목 지워짐)' : ' (결재 전이라 제목 가려짐)'}</span>
          </>
        )}
      </h4>
      {file.seats.length > 0 && (
        <div className="doc-who">
          참여{' '}
          {file.seats.map((s) => (
            <i key={s} data-seat={s}>
              {seatName(s)}
            </i>
          ))}
        </div>
      )}
      {!priv && file.repo && file.n !== null && <IssueReplayButton repo={file.repo} n={file.n} />}
    </div>
  )
}

const Bar = ({ w }: { w: number }) => <span className="redact" style={{ width: w }} aria-hidden="true" />

/** the documents of one kind in a file, one after another (a covers for the ones this viewer may not read) */
function Stack({
  file,
  folder,
  docs,
  bodies,
  isOwner,
  peeling,
  row,
  nonce,
}: {
  file: DocFile
  folder: DocFolder
  docs: DocMeta[]
  bodies: Readonly<Record<number, DocBody>>
  isOwner: boolean
  peeling: ReadonlySet<number>
  row: string | null
  nonce: number
}) {
  // the focused minutes row belongs to the first document that has it
  let rowOwner: number | null = null
  if (row) {
    for (const d of docs) {
      const b = bodies[d.id]
      if (b && conversations(b.data).some((c) => c.lines.some((l) => l.key === row))) {
        rowOwner = d.id
        break
      }
    }
  }
  return (
    <>
      {docs.map((d) => {
        const body = bodies[d.id]
        if (!d.readable || peeling.has(d.id)) return <SecretCover key={d.id} doc={d} file={file} folder={folder} unsealing={peeling.has(d.id)} />
        if (!body) return <p key={d.id} className="doc-note">불러오는 중…</p>
        return <Paper key={d.id} doc={d} body={body} file={file} isOwner={isOwner} row={rowOwner === d.id ? row : null} nonce={nonce} />
      })}
    </>
  )
}

function Paper({ doc, body, file, isOwner, row, nonce }: { doc: DocMeta; body: DocBody; file: DocFile; isOwner: boolean; row: string | null; nonce: number }) {
  const label = KIND_NAME[doc.kind] ?? doc.kind
  const pending = !doc.approved
  let tag = label
  if (doc.kind === 'plan' && file.n) tag = `${label} · 이슈 #${file.n}`
  if (doc.kind === 'report' && typeof body.data.pr === 'number') tag = `${label} · PR #${body.data.pr}`
  const link = body.source_url && doc.grade === 'public' ? body.source_url : null
  const linkText = doc.kind === 'plan' ? `GitHub 이슈 #${file.n}` : doc.kind === 'report' ? 'GitHub PR' : doc.kind === 'minutes' ? `#${file.n} 댓글 “🗂 에이전트 간 협의 기록”` : '결재 댓글'
  let content: ReactNode
  if (doc.kind === 'minutes') content = <Talk doc={doc} body={body} file={file} row={row} nonce={nonce} />
  else if (doc.kind === 'decision') content = <Decision body={body} />
  else
    content = sections(paperText(body.body)).map((s, i) => (
      <Fragment key={i}>
        {s.heading && <h5>{s.heading}</h5>}
        {renderMarkdown(s.text)}
      </Fragment>
    ))
  return (
    <>
      {isOwner && pending && (
        <div className="doc-band">
          <span className="secret-stamp" aria-hidden="true">
            SECRET
          </span>
          <span className="t">
            <b>SECRET · 결재 대기</b>
            <span> 주인만 보고 있어요. 결재하면 모두에게 공개돼요.</span>
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              closeDocs()
              openApprovalBox()
            }}
          >
            결재함에서 결재 →
          </button>
        </div>
      )}
      <article className="doc-paper" aria-label={label}>
        <span className="kindtag">{tag}</span>
        {content}
        {link && (
          <p className="src">
            원문:{' '}
            <a href={link} target="_blank" rel="noreferrer">
              {linkText} ↗
            </a>
          </p>
        )}
      </article>
    </>
  )
}

function Decision({ body }: { body: DocBody }) {
  const v = decisionView(body.data)
  if (!v) return <div className="decision-card">{renderMarkdown(paperText(body.body))}</div>
  return (
    <div className="decision-card">
      <p className="big">{v.text}</p>
      {v.why && renderMarkdown(v.why)}
      <span className="ok">
        ✅ 결재 · {v.result}
        {v.date ? ` · ${v.date}` : ''}
      </span>
    </div>
  )
}

/** minutes as a conversation: a 협의 기록 table row = one utterance; the owner on the right in amber; 결정 · 후속 as a memo */
function Talk({ doc, body, file, row, nonce }: { doc: DocMeta; body: DocBody; file: DocFile; row: string | null; nonce: number }) {
  const talks = useMemo(() => conversations(body.data), [body])
  const focus = useRef<HTMLDivElement>(null)
  const done = useRef(0)
  // "전문 보기": scroll to the row, put focus on it
  useEffect(() => {
    if (!row || done.current === nonce || !focus.current) return
    done.current = nonce
    focus.current.focus()
    focus.current.scrollIntoView({ block: 'center' })
  }, [row, nonce, talks])
  if (!talks.length) return <>{renderMarkdown(paperText(body.body))}</>
  return (
    <>
      {talks.map((m, b) => (
        <Fragment key={b}>
          <h5>에이전트 간 협의 기록{m.date ? ` · ${m.date}` : ''}</h5>
          <div className="talk">
            {m.lines.map((l) => {
              const isFocus = row === l.key
              const at = file.repo && file.n ? formatRef({ repo: file.repo, n: file.n, kind: 'minutes', row: l.key }) : null
              return (
                <div
                  key={l.key}
                  id={`row-${doc.id}-${l.key}`}
                  ref={isFocus ? focus : undefined}
                  tabIndex={-1}
                  className={`line${l.owner ? ' owner' : ''}${isFocus ? ' is-focus' : ''}`}
                  data-seat={l.owner ? undefined : l.from.seat}
                  aria-current={isFocus ? 'location' : undefined}
                >
                  <div className="from">
                    <b>{l.from.tag}</b>
                    {l.to.length > 0 && <span>→ {l.to.map((w) => w.ko).join(' · ')}</span>}
                  </div>
                  <div className="said">
                    {renderMarkdown(l.text)}
                    {at && (
                      <a className="perma" href={at} aria-label={`${l.from.ko}의 말 주소`}>
                        #
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {(m.decision || m.followUp) && (
            <div className="memo-note">
              {m.decision && (
                <>
                  <b>결정</b>
                  {renderMarkdown(m.decision)}
                </>
              )}
              {m.followUp && (
                <>
                  <b>후속</b>
                  {renderMarkdown(m.followUp)}
                </>
              )}
            </div>
          )}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The manila SECRET cover: kind, date and agents only. The black bars are decoration (aria-hidden); a screen reader
 * hears that the content is withheld and why. `unsealing`: the document was just approved (stamp falls, cover peels).
 */
function SecretCover({ doc, file, folder, unsealing }: { doc: DocMeta; file: DocFile; folder: DocFolder; unsealing: boolean }) {
  const priv = doc.grade === 'private'
  const kindName = KIND_NAME[doc.kind] ?? doc.kind
  return (
    <article className={`secret-doc${unsealing ? ' unsealing' : ''}`} aria-label="SECRET 문서. 내용은 공개되지 않았습니다">
      <span className="big-stamp" aria-hidden="true">
        SECRET
      </span>
      <span className="doc-crumb">
        {folder.label}
        {' · 파일철 '}
        {priv ? <Bar w={30} /> : `#${file.n}`}
      </span>
      <dl>
        <dt>종류</dt>
        <dd>{kindName}</dd>
        <dt>제목</dt>
        <dd>
          <Bar w={priv ? 220 : 260} />
          <span className="sr-only">{priv ? '지워짐' : '결재 전이라 가려짐'}</span>
        </dd>
        <dt>날짜</dt>
        <dd>{fmtDocDay(doc.created_at)}</dd>
        <dt>참여</dt>
        <dd>{doc.agents.length ? doc.agents.map(seatFirst).join(', ') : '—'}</dd>
      </dl>
      <div className="redact-lines" aria-hidden="true">
        <span style={{ width: '92%' }} />
        <span style={{ width: '84%' }} />
        <span style={{ width: '70%' }} />
        <span style={{ width: '88%' }} />
        <span style={{ width: '40%' }} />
      </div>
      <p className="secret-note">
        {priv ? '비공개 작업이라 내용이 서버에 올라오지 않아요. 이런 일이 있었다는 것만 보여요.' : '주인이 결재하면 공개돼요. 그때 도장이 떨어지고 표지가 열립니다.'}
      </p>
    </article>
  )
}
