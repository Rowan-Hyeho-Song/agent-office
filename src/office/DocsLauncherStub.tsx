import { DockSlot } from './CornerDock'
import { Icon } from './ApprovalIcons'
import { toggleDocs, useDocsViewerReady } from './docs/panel'
import { useSidePanelOpen } from './SidePanel'
import type { OfficeWorld } from './world'

/**
 * The 서재 dock button until the viewer's own chunk (DocsViewer, loaded after the first screen, #402) has mounted and
 * brings its own launcher (with the new-document dot). Same classes and label, so the dock does not move when the real one
 * takes over; a click opens the panel through the store and the viewer shows it as soon as it is there.
 */
export function DocsLauncherStub({ world }: { world: OfficeWorld }) {
  const ready = useDocsViewerReady()
  const sideOpen = useSidePanelOpen()
  if (ready || sideOpen || !world.library || !world.approvals) return null
  return (
    <DockSlot slot="docs">
      <button type="button" className="dock-btn docs-launcher" aria-label="서재" aria-expanded={false} aria-controls="docs-box" onClick={toggleDocs}>
        <Icon name="publish" />
        <span className="dock-label">서재</span>
      </button>
    </DockSlot>
  )
}
