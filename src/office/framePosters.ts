// The three wall frames' pictures (docs/design/lounge-props.md 6): the project posters of public/posters/ on the frames' live screen slots
// `frame_<k>_art` (extras frame = k, aspect = width / height). Pure parts here (which poster, how it fits the face); Frames.tsx loads and paints.

/** poster file (no extension) per frame number: 0 = north small one, 1 = the big one in the middle, 2 = south small one, towards the door */
export const FRAME_POSTERS = ['poster_rowansong', 'poster_agent_office', 'poster_desk_room'] as const

/** the poster of a frame number, or null for a frame the table does not know */
export const posterOf = (frame: number): string | null => FRAME_POSTERS[frame] ?? null

/** the frame number of a `frame_<k>_art` node (its extras frame, else the number in the name), or null */
export function frameOfNode(name: string, extras: { frame?: unknown } = {}): number | null {
  const m = /^frame_(\d+)_art$/.exec(name)
  if (!m) return null
  const k = Number(extras.frame)
  return extras.frame !== undefined && Number.isInteger(k) && k >= 0 ? k : Number(m[1])
}

/** a picture of iw x ih drawn into a face of fw x fh without stretching: centred, the whole picture, the rest left as the dark face */
export function containRect(fw: number, fh: number, iw: number, ih: number): { x: number; y: number; w: number; h: number } {
  if (!(fw > 0 && fh > 0 && iw > 0 && ih > 0)) return { x: 0, y: 0, w: fw, h: fh }
  const s = Math.min(fw / iw, fh / ih)
  const w = iw * s
  const h = ih * s
  return { x: (fw - w) / 2, y: (fh - h) / 2, w, h }
}

/** what a click on each frame does (lounge-props.md 6: the project's page), and its name tag. */
export const AGENT_OFFICE_REPO_URL = 'https://github.com/Rowan-Hyeho-Song/agent-office'
export type FrameGo = 'desk' | 'repo'
/**
 * The user's decision: frame 0 (rowansong.dev, the personal home) and frame 2 (desk room) both go out through the door, in this window (the exit animation inside the room, else the
 * desk site in this tab: the same as the door's); only frame 1 (agent office) opens its GitHub repository, in a new tab.
 */
export const FRAME_LINKS: readonly { name: string; go: FrameGo }[] = [
  { name: 'rowansong.dev', go: 'desk' },
  { name: 'agent office', go: 'repo' },
  { name: '책상 방', go: 'desk' },
]
export const linkOf = (frame: number) => FRAME_LINKS[frame] ?? null
