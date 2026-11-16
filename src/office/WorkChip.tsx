import { AGENT_INFO } from './world'

// #601 (play.md 10.2): the agent called to work during the visitor's game shows it will go once the game ends: a small chip, the tag's tokens, a
// 1 px border in the agent's colour, ivory 11 px words after the agent list's working dot (same colour, same size). The rig gives its place on
// the screen each frame: beside the face screen (omok: its top aligned, `anchor: 'start'`), or over the head (ping-pong, centred, `anchor: 'over'`).
// It fades in over 0.2 s rising 2 px, then stays still (no fade with reduced motion: styles.css).

export function WorkChip({ agent, at, anchor, text }: { agent: string; at: { x: number; y: number }; anchor: 'start' | 'over'; text: string }) {
  const color = AGENT_INFO[agent]?.color
  return (
    <p className="work-chip" data-anchor={anchor} style={{ left: at.x, top: at.y, ['--chip-agent' as string]: color }} aria-hidden="true">
      <i style={{ background: color }} />
      {text}
    </p>
  )
}
