import { DockSlot } from '../office/CornerDock'
import { ALL } from './engine'
import { replay, useReplay } from './store'

/**
 * The 타임랩스 dock button while the replay is off. It lives in the main bundle (a button and a store call) so the dock is
 * complete on the first screen; the replay itself (ReplayHud, ReplayDriver) is a chunk fetched after it (#402).
 */
export function ReplayEntry() {
  const s = useReplay()
  if (s.mode !== 'off') return null
  return (
    <DockSlot slot="replay">
      <button type="button" className="dock-btn replay-entry" aria-label="타임랩스" onClick={() => void replay.open({ project: ALL })}>
        <span aria-hidden="true">◀◀</span>
        <span className="dock-label">타임랩스</span>
      </button>
    </DockSlot>
  )
}
