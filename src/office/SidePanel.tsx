import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useReplay } from '../replay/store'
import { closeApprovalBox, openApprovalBox, useApprovalBoxOpen } from './approval/panel'
import { closeDocs, openDocs, useDocsPanel } from './docs/panel'
import { SIDE, isPhone, panelWidth, snapSheet, stepWidth, widthAt, clampWidth, maxWidth, type Sheet } from './sidePanel/model'
import { getSideBack, loadWidth, saveWidth, setSideLayout, useSideLayout, type Tab } from './sidePanel/store'
import type { OfficeWorld } from './world'

// The side panel (#170; design: docs/design/docs-ui.md section 4): 서재 and 결재함 are two tabs of ONE panel, flush right
// (a bottom sheet with two heights on phones). This is the shell: head with the tabs, the drag strip, open / close
// motion, focus and Esc. The contents stay in DocsViewer.tsx and ApprovalBox.tsx, which render into #side-body through
// <SideSlot>. The 3D picture moves over with camera.setViewOffset (sidePanelRig.tsx), which reads sidePanel/store.ts.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'

/** render a tab's content into the panel body (nothing until that tab is the one shown, or sliding out) */
export function SideSlot({ tab, children }: { tab: Tab; children: ReactNode }) {
  const present = useSideLayout().present
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setEl(present === tab ? document.getElementById('side-body') : null), [present, tab])
  return el ? createPortal(children, el) : null
}

export function SidePanel({ world }: { world: OfficeWorld }) {
  return world.approvals ? <Shell hasDocs={!!world.library} /> : null
}

function Shell({ hasDocs }: { hasDocs: boolean }) {
  const docsOpen = useDocsPanel().open
  const boxOpen = useApprovalBoxOpen()
  const replayOn = useReplay().mode !== 'off'
  const L = useSideLayout()
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [stored, setStored] = useState<number | null>(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [sheet, setSheet] = useState<Sheet>('half')
  const [dragH, setDragH] = useState<number | null>(null)
  const [exiting, setExiting] = useState<Tab | null>(null)
  const lastTab = useRef<Tab | null>(null)
  const ref = useRef<HTMLElement>(null)

  // the timelapse needs the whole screen: the panel does not open during it (and closes when it starts)
  const tab: Tab | null = replayOn ? null : docsOpen && hasDocs ? 'docs' : boxOpen ? 'approval' : null
  const open = tab !== null
  const phone = isPhone(screen.w)
  const width = panelWidth(stored, screen.w)
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    if (!replayOn) return
    closeDocs()
    closeApprovalBox()
  }, [replayOn, docsOpen, boxOpen])

  useEffect(() => {
    const on = () => setScreen({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // sliding out: the content stays for the 240 ms of the exit (not at all under reduced motion)
  useEffect(() => {
    if (tab) {
      lastTab.current = tab
      setExiting(null)
      return
    }
    if (!lastTab.current) return
    if (reduced()) {
      lastTab.current = null
      return
    }
    setExiting(lastTab.current)
    const id = window.setTimeout(() => {
      lastTab.current = null
      setExiting(null)
    }, SIDE.ms)
    return () => window.clearTimeout(id)
  }, [tab])
  const present = tab ?? exiting

  // reading one paper / one approval raises the phone sheet to full, back on the list it goes back to half
  const raise = tab ? L.raise[tab] : false
  useEffect(() => setSheet(raise ? 'full' : 'half'), [open, raise])

  // tell the camera rig, the bubble layer and the stylesheet (dock, hint) where the panel is
  useLayoutEffect(() => {
    setSideLayout({ open, width, sheet, dragging: dragging || dragH !== null, present })
  }, [open, width, sheet, dragging, dragH, present])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--side-w', open && !phone ? `${width}px` : '0px')
    if (open) root.dataset.side = phone ? 'sheet' : 'panel'
    else delete root.dataset.side
    if (dragging) root.dataset.sideDrag = ''
    else delete root.dataset.sideDrag
  }, [open, phone, width, dragging])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--side-w')
      delete document.documentElement.dataset.side
      delete document.documentElement.dataset.sideDrag
      setSideLayout({ open: false, present: null })
    },
    [],
  )

  // focus goes into the panel when it opens and back to where it was when it closes
  useEffect(() => {
    if (!open) return
    const from = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () =>
      void requestAnimationFrame(() => {
        const back = from && from !== document.body && from.isConnected ? from : document.querySelector<HTMLElement>(`.${lastTab.current ?? 'docs'}-launcher`)
        back?.focus()
      })
  }, [open])

  // Esc: one step inside the tab (one paper -> the list), then the panel closes
  useEffect(() => {
    if (!tab) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!getSideBack(tab)?.()) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tab])

  const close = () => {
    closeDocs()
    closeApprovalBox()
  }

  // ---- drag strip (desktop) ----
  const onStripDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    e.preventDefault()
  }
  const onStripMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (dragging) setStored(widthAt(e.clientX, screen.w))
  }
  const onStripUp = () => {
    if (!dragging) return
    setDragging(false)
    saveWidth(widthRef.current)
  }
  const onStripKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = stepWidth(width, e.key === 'ArrowLeft' ? 'left' : 'right', screen.w)
    setStored(next)
    saveWidth(next)
  }

  // ---- sheet handle (phones) ----
  const onHandleDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragH(screen.h * (sheet === 'full' ? SIDE.full : SIDE.half))
    e.preventDefault()
  }
  const onHandleMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (dragH !== null) setDragH(Math.min(screen.h * 0.97, Math.max(screen.h * 0.15, screen.h - e.clientY)))
  }
  const onHandleUp = () => {
    if (dragH === null) return
    const to = snapSheet(dragH, screen.h)
    setDragH(null)
    if (to === 'close') close()
    else setSheet(to)
  }
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') setSheet('full')
    else if (e.key === 'ArrowDown') setSheet('half')
    else return
    e.preventDefault()
  }

  // ---- tabs ----
  const tabs: Tab[] = hasDocs ? ['docs', 'approval'] : ['approval']
  const go = (t: Tab) => (t === 'docs' ? openDocs() : openApprovalBox())
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const i = tabs.indexOf(tab ?? 'approval')
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    e.preventDefault()
    go(next)
    requestAnimationFrame(() => document.getElementById(`side-tab-${next}`)?.focus())
  }

  if (!present) return null
  const sheetH = dragH ?? screen.h * (sheet === 'full' ? SIDE.full : SIDE.half)
  const count = L.count
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className="side-panel"
      aria-label="서재와 결재함"
      data-tab={present}
      data-closing={!tab ? '' : undefined}
      data-sheet={phone ? sheet : undefined}
      data-dragging={dragging || dragH !== null ? '' : undefined}
      style={phone ? { height: sheetH } : { width }}
    >
      {phone ? (
        <div
          className="side-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="시트 높이"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((sheetH / screen.h) * 100)}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onKeyDown={onHandleKey}
        >
          <i aria-hidden="true" />
        </div>
      ) : (
        <div
          className="side-strip"
          role="separator"
          aria-orientation="vertical"
          aria-label="패널 너비"
          aria-valuemin={SIDE.min}
          aria-valuemax={maxWidth(screen.w)}
          aria-valuenow={clampWidth(width, screen.w)}
          tabIndex={0}
          onPointerDown={onStripDown}
          onPointerMove={onStripMove}
          onPointerUp={onStripUp}
          onPointerCancel={onStripUp}
          onKeyDown={onStripKey}
        />
      )}
      <div className="side-head">
        <div className="side-tabs" role="tablist" aria-label="패널 탭" onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`side-tab-${t}`}
              data-tab={t}
              aria-selected={present === t}
              aria-controls={`${t === 'docs' ? 'docs' : 'approval'}-box`}
              tabIndex={present === t ? 0 : -1}
              onClick={() => go(t)}
            >
              {t === 'docs' ? '서재' : '결재함'}
              {t === 'approval' && !!count && <b>{count}</b>}
            </button>
          ))}
        </div>
        <button type="button" className="side-close" aria-label="닫기 Esc" onClick={close}>
          ✕
        </button>
      </div>
      <div id="side-body" className="side-body" />
    </aside>
  )
}

/** the panel is open (a launcher in the dock is only for when it is not) */
export const useSidePanelOpen = () => useSideLayout().open
