import { DockSlot } from './CornerDock'
import { pressViewToggle, useTour, viewToggleModel } from './tourStore'

// The dock's free view <-> tour button (#368, docs/design/office-ui.md 10.6): the desk room's CameraToggle drawings. The
// icon shows the mode you are in, the name is the mode a press goes to. The tour state is tourStore's; this holds none.
// Hidden with the whole dock while the timelapse covers the corner (styles.css).

export function ViewToggle() {
  const m = viewToggleModel(useTour())
  return (
    <DockSlot slot="camera">
      <button
        type="button"
        className="dock-btn view-toggle"
        onClick={pressViewToggle}
        aria-pressed={m.pressed}
        aria-label={m.label}
        aria-description={m.description}
        title={m.title}
      >
        {m.icon === 'cursor' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2 L4 13 L7 10 L9 14.5 L10.8 13.7 L8.8 9.3 L12.5 9.3 Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="4.5" width="9" height="7" rx="1" />
            <path d="M10.5 7 L14.5 4.8 L14.5 11.2 L10.5 9 Z" />
          </svg>
        )}
      </button>
    </DockSlot>
  )
}
