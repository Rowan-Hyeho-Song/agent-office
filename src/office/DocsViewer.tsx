import { DockSlot } from './CornerDock'
import { SideSlot, useSidePanelOpen } from './SidePanel'
import { setSideBack, setSideRaise, setSideUnseen } from './sidePanel/store'
import { clearFile, loadDocsSeen, reconcileDocs, saveDocsSeen, unreadFile, unreadFolder, type DocsSeen } from '../docs/unread'
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
import { openApprovalBox } from './approval/panel'
import { renderMarkdown } from './approval/markdown'
import { useRole } from './ApprovalBox'
import { Icon } from './ApprovalIcons'
import { TopicBadges } from './TopicBadges'
import { PendingChip, ProgressBar, StageChip } from './ProgressMarks'
import { shownTitle } from '../docs/topics'
import { SORTS, STAGE_FILTERS, loadView, saveView, stageCounts, viewFiles, type ListView, type SortKey, type StageFilter } from '../docs/progressList'
import { STAGE_NAME } from '../docs/progress'
import { closeDocs, openFromHash, toggleDocs, useDocsPanel } from './docs/panel'
import { AGENT_INFO, type OfficeWorld } from './world'

/**
 * The library viewer (#65; design: docs/design/docs-ui.md sections 2 and 4). It is the 서재 tab of the side panel (#170),
 * one column: a list stage (project folders, then the files of one folder: an issue each) or the paper stage: a path
 * line, the file's head, its table of contents (기획서 → 회의록 → 결정 → 보고서, only those present) and one sheet of
 * paper. Minutes read as a conversation. SECRET documents show a manila cover with kind, date and agents only; the
 * body is never in the page for a visitor (the server's filter, see src/docs/library.ts and supabase/docs.sql), so
 * nothing here hides anything: it just draws what arrived. The owner sees review bodies under a "SECRET · 결재 대기" band.
 */
export function DocsViewer({ world }: { world: OfficeWorld }) {
  return world.library && world.approvals ? <Viewer world={world} lib={world.library} /> : null
}

/** the 6 px ivory dot before a folder / file title that has new documents (read as words too) */
const NewMark = () => (
  <>
    <i className="doc-dot" aria-hidden="true" />
    <span className="sr-only">새 문서, </span>
  </>
)

/** a number from a design token (tokens.css, unitless ms) */
const tokenMs = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0

/** "11.07", with the year ("2025.11.07") when it is not this year */
const fmtDocDay = (iso: string) => (new Date(iso).getFullYear() === new Date().getFullYear() ? fmtShortDay(iso) : `${new Date(iso).getFullYear()}.${fmtShortDay(iso)}`)

const seatName = (seat: number) => AGENT_INFO[`agent_${seat}`]?.name ?? ''
const seatFirst = (seat: number) => seatName(seat).split(' ')[0]

/** the stages of the one column: the folders, the files of a folder, one file's papers */
type Stage = 'folders' | 'files' | 'paper'

function Viewer({ world, lib }: { world: OfficeWorld; lib: LibraryStore }) {
  const src = world.approvals!
  const role = useRole(src)
  const isOwner = role === 'owner'
  const panel = useDocsPanel()
  const snap = useSyncExternalStore(lib.subscribe, lib.getSnapshot)
  const [sel, setSel] = useState<Sel>({ fileKey: null, kind: null, row: null })
  const [live, setLive] = useState('')
  const [peeling, setPeeling] = useState<ReadonlySet<number>>(new Set())
  const [stage, setStage] = useState<Stage>('files')
  // the file list's filter and sort (#241), remembered in the browser
  const [listView, setListView] = useState<ListView>(loadView)
  const changeView = useCallback((patch: Partial<ListView>) => {
    setListView((v) => {
      const next = { ...v, ...patch }
      saveView(next)
      return next
    })
  }, [])
  const shown = useSidePanelOpen()
  const viewer = useRef<HTMLDivElement>(null)
  const selRef = useRef(sel)
  selRef.current = sel
  const landed = useRef(0)
  const open = panel.open

  // #240 new documents since the library was last opened: the dock / tab dot, and the dots in the list
  const [seen, setSeen] = useState<DocsSeen>(loadDocsSeen)
  const folded = useMemo(() => (snap.metas ? reconcileDocs(seen, snap.metas, Date.now(), open) : null), [seen, snap.metas, open])
  useEffect(() => {
    if (!folded || folded.seen === seen) return
    saveDocsSeen(folded.seen)
    setSeen(folded.seen)
  }, [folded, seen])
  const dot = folded?.dot ?? false
  const fresh = folded?.fresh ?? 0
  useEffect(() => void setSideUnseen('docs', dot ? fresh : 0), [dot, fresh])

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
    // a bare open (the launcher) keeps where you were; the first one starts at the list
    setSel((s) => (panel.target || !s.fileKey ? landOn(snap.folders, panel.target) : s))
    if (panel.target) setStage('paper')
    else if (!selRef.current.fileKey) setStage(snap.folders.length > 1 ? 'folders' : 'files')
  }, [open, snap.metas, snap.folders, panel])

  // fresh list each time it opens
  useEffect(() => {
    if (open) void lib.refresh()
  }, [open, lib])

  const files = snap.folders.flatMap((f) => f.files)
  const file = files.find((f) => f.key === sel.fileKey) ?? files[0] ?? null
  const folder = snap.folders.find((f) => f.files.some((x) => x === file)) ?? null
  const kinds = file ? TOC.filter((t) => file.docs.some((d) => d.kind === t.kind)) : []
  const kind = kinds.find((t) => t.kind === sel.kind)?.kind ?? kinds[0]?.kind ?? null
  const docs = useMemo(() => (file && kind ? file.docs.filter((d) => d.kind === kind) : []), [file, kind])
  const view: Stage = stage === 'paper' && file && folder ? 'paper' : stage === 'files' && folder ? 'files' : 'folders'

  // Esc steps back first (a paper -> its list); at a list it closes the panel (SidePanel.tsx). Focus follows the stage
  // so a button that just left the page does not drop it on the body. A paper raises the phone sheet to full.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    setSideBack('docs', () => {
      if (viewRef.current !== 'paper') return false
      setStage('files')
      return true
    })
    return () => setSideBack('docs', null)
  }, [])
  useEffect(() => viewer.current?.focus({ preventScroll: true }), [view])
  useEffect(() => {
    setSideRaise('docs', open && view === 'paper')
    return () => void setSideRaise('docs', false)
  }, [open, view])

  // opening a file clears its dot (and only its)
  useEffect(() => {
    if (!open || view !== 'paper' || !file) return
    const next = clearFile(seen, file)
    if (next === seen) return
    saveDocsSeen(next)
    setSeen(next)
  }, [open, view, file, seen])

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
  const goFile = (f: DocFile) => {
    pick({ fileKey: f.key, kind: null })
    setStage('paper')
  }
  const goFolder = (fo: DocFolder) => {
    if (!fo.files[0]) return
    pick({ fileKey: fo.files[0].key, kind: null })
    setStage('files')
  }

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
      {!shown && (
        <DockSlot slot="docs">
          <button type="button" className="dock-btn docs-launcher" aria-label={dot ? `서재, 새 문서 ${fresh}건` : '서재'} aria-expanded={false} aria-controls="docs-box" onClick={toggleDocs}>
            <Icon name="publish" />
            <span className="dock-label">서재</span>
          </button>
          {dot && <i className="new-dot docs" aria-hidden="true" />}
        </DockSlot>
      )}
      <SideSlot tab="docs">
        <div id="docs-box" className="docs-box" role="tabpanel" aria-labelledby="side-tab-docs">
          <div className="doc-viewer" ref={viewer} tabIndex={-1}>
            {view === 'paper' && file && folder ? (
              <div className="doc-main">
                <DocPath folder={folder} file={file} onRoot={() => setStage('folders')} onFolder={() => setStage('files')} />
                <FileHead file={file} />
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
              </div>
            ) : (
              <nav className="doc-nav" aria-label="서재 목록">
                {view === 'files' && folder && <DocPath folder={folder} file={null} onRoot={() => setStage('folders')} onFolder={() => setStage('files')} />}
                {snap.metas === null && !snap.error && <p className="doc-note">불러오는 중…</p>}
                {snap.error && (
                  <p className="approval-error" role="alert">
                    서재를 불러오지 못했어요.{' '}
                    <button type="button" className="btn-ghost" onClick={() => void lib.refresh()}>
                      다시 불러오기
                    </button>
                  </p>
                )}
                {view === 'folders' && <h4>프로젝트 폴더</h4>}
                {view === 'folders' &&
                  snap.folders.map((fo) => (
                    <button key={fo.key} type="button" className="doc-folder" aria-current={fo === folder} onClick={() => goFolder(fo)}>
                      <Icon name={fo.repo === null ? 'lock' : 'publish'} />
                      {unreadFolder(fo, seen) && <NewMark />}
                      {fo.label}
                    </button>
                  ))}
                {view === 'files' && <h4>파일철</h4>}
                {view === 'files' && folder && <ListControls files={folder.files} value={listView} onChange={changeView} />}
                {view === 'files' &&
                  folder &&
                  viewFiles(folder.files, listView).map((f) => (
                    <button key={f.key} type="button" className="doc-file" data-stage={f.progress?.stage} aria-current={f === file} onClick={() => goFile(f)}>
                      <span className="l1">
                        <span className="n">{f.n ? `#${f.n}` : '—'}</span>
                        {unreadFile(f, seen) && <NewMark />}
                        <span className="ttl">
                          {(f.title && shownTitle(f.title, f.topics)) ?? (
                            <>
                              <span className="redact" style={{ width: 120 }} aria-hidden="true" />
                              <span className="sr-only">가려진 제목</span>
                            </>
                          )}
                        </span>
                        {f.secret && <span className="sec">{f.secret === 'review' ? `SECRET ${f.docs.filter((d) => !d.approved).length}` : 'SECRET'}</span>}
                        {f.repo !== null && <span className="date">{fmtDocDay(f.date)}</span>}
                      </span>
                      {(f.progress || f.topics.length > 0 || f.seats.length > 0) && (
                        <span className="l2">
                          <span className="l2-main">
                            {f.progress && <StageChip stage={f.progress.stage} />}
                            <PendingChip progress={f.progress} />
                            <TopicBadges topics={f.topics} fold />
                            {f.seats.length > 0 && (
                              <span className="who">
                                {f.seats.map((s) => (
                                  <i key={s} data-seat={s}>
                                    {seatFirst(s)}
                                  </i>
                                ))}
                              </span>
                            )}
                          </span>
                          <ProgressBar progress={f.progress} />
                        </span>
                      )}
                    </button>
                  ))}
                {view === 'files' && folder && folder.files.length > 0 && viewFiles(folder.files, listView).length === 0 && (
                  <p className="doc-note">
                    이 조건에 맞는 파일철이 없어요.{' '}
                    <button type="button" className="btn-ghost" onClick={() => changeView({ stage: 'all', pendingOnly: false })}>
                      모두 보기
                    </button>
                  </p>
                )}
                {snap.layout.note && <p className="doc-note">{snap.layout.note}</p>}
                {snap.metas?.length === 0 && <p className="doc-note">아직 문서가 없어요.</p>}
              </nav>
            )}
          </div>
        </div>
      </SideSlot>
    </>
  )
}

/** the path line of a stage: 서재 › folder › 파일철 #45; every step before the last goes back to that list */
function DocPath({ folder, file, onRoot, onFolder }: { folder: DocFolder; file: DocFile | null; onRoot: () => void; onFolder: () => void }) {
  const priv = folder.repo === null
  return (
    <nav className="doc-path" aria-label="경로">
      <button type="button" onClick={onRoot}>
        서재
      </button>
      <span aria-hidden="true">›</span>
      {file ? (
        <>
          <button type="button" onClick={onFolder}>
            {folder.label}
          </button>
          <span aria-hidden="true">›</span>
          <span aria-current="location">파일철 {priv ? <Bar w={30} /> : `#${file.n}`}</span>
          {file.progress && (
            <span className="doc-path-progress">
              <StageChip stage={file.progress.stage} />
              <ProgressBar progress={file.progress} />
            </span>
          )}
        </>
      ) : (
        <span aria-current="location">{folder.label}</span>
      )}
    </nav>
  )
}

function FileHead({ file }: { file: DocFile }) {
  const priv = file.repo === null
  return (
    <div className="doc-filehead">
      <h4>
        {(file.title && shownTitle(file.title, file.topics)) ?? (
          <>
            SECRET 문서
            <span className="sr-only">{priv ? ' (제목 지워짐)' : ' (결재 전이라 제목 가려짐)'}</span>
          </>
        )}
      </h4>
      {(file.progress || file.topics.length > 0) && (
        <div className="doc-status">
          {file.progress && <StageChip stage={file.progress.stage} />}
          <PendingChip progress={file.progress} />
          <TopicBadges topics={file.topics} />
        </div>
      )}
      <ProgressBar progress={file.progress} variant="wide" />
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

/** the filter chips, the 결재 대기만 toggle and the sort of the file list (#241): arrows move between the chips, Tab leaves the group */
function ListControls({ files, value, onChange }: { files: readonly DocFile[]; value: ListView; onChange: (patch: Partial<ListView>) => void }) {
  const counts = stageCounts(files, value)
  const group = useRef<HTMLDivElement>(null)
  const label = (f: StageFilter) => (f === 'all' ? '전체' : STAGE_NAME[f])
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = STAGE_FILTERS[(STAGE_FILTERS.indexOf(value.stage) + step + STAGE_FILTERS.length) % STAGE_FILTERS.length]
    onChange({ stage: next })
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus())
  }
  return (
    <div className="doc-filter">
      <div className="doc-chips" role="radiogroup" aria-label="상태로 거르기" ref={group} onKeyDown={onKey}>
        {STAGE_FILTERS.map((f) => (
          <button key={f} type="button" role="radio" className="doc-chip" data-filter={f} aria-checked={value.stage === f} tabIndex={value.stage === f ? 0 : -1} onClick={() => onChange({ stage: f })}>
            {label(f)}
            <span className="cnt"> {counts[f]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="doc-chip toggle" aria-pressed={value.pendingOnly} onClick={() => onChange({ pendingOnly: !value.pendingOnly })}>
        결재 대기만
      </button>
      <label className="doc-sort">
        <span>정렬</span>
        <select value={value.sort} onChange={(e) => onChange({ sort: e.target.value as SortKey })}>
          {SORTS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
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
