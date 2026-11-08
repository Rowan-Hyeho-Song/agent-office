import { useEffect } from 'react'
import { conversations } from '../docs/library'
import { setClockClick, setClockTime } from '../office/clock'
import { prefersReducedMotion, officeNow, type OfficeWorld } from '../office/world'
import { atMs } from './engine'
import { scriptFor } from './scene'
import { replay } from './store'

const ENTER_MS = 1200
const EXIT_MS = 800
const ease = (k: number) => 1 - (1 - k) * (1 - k)

/**
 * Wires the replay into the office (#82): the whiteboard shows the folded board, the wall clock follows the playhead
 * (hands wind back on the way in and forward on the way out), a minutes point plays a short meeting at x1, the clock
 * click and ?replay=<project|all>&t=<time> open it.
 */
export function ReplayDriver({ world }: { world: OfficeWorld }) {
  useEffect(() => {
    let raf = 0
    let anim: { from: number; start: number; dur: number; to: number | null } | null = null
    const target = () => {
      const p = replay.point
      return p ? atMs(p) : Date.now()
    }
    const frame = (now: number) => {
      if (!anim) return
      const to = anim.to ?? Date.now()
      const k = anim.dur ? Math.min(1, (now - anim.start) / anim.dur) : 1
      const at = anim.from + (to - anim.from) * ease(k)
      if (k >= 1) {
        const leaving = anim.to === null
        anim = null
        setClockTime(leaving ? null : new Date(target()))
        return
      }
      setClockTime(new Date(at))
      raf = requestAnimationFrame(frame)
    }
    const animate = (from: number, to: number | null) => {
      cancelAnimationFrame(raf)
      anim = { from, to, start: performance.now(), dur: prefersReducedMotion() ? 0 : to === null ? EXIT_MS : ENTER_MS }
      raf = requestAnimationFrame(frame)
    }

    let was = replay.getSnapshot().mode
    let lastI = -1
    const sync = () => {
      const s = replay.getSnapshot()
      if (s.mode === 'office') {
        world.board.lock(replay.scene()?.board ?? null)
        if (was !== 'office') animate(Date.now(), target())
        else if (!anim && s.i !== lastI) setClockTime(new Date(target()))
        lastI = s.i
      } else if (was === 'office') {
        world.board.lock(null)
        world.meeting.stop()
        animate(replay.point ? target() : Date.now(), null)
      }
      was = s.mode
    }
    const off = [
      replay.subscribe(sync),
      replay.onPoint((p, via) => {
        const s = replay.getSnapshot()
        // seeking (drag, keys) only changes the state; a scene starts when the replay plays the point (design 8)
        world.meeting.stop()
        if (via !== 'play' || p.kind !== 'minutes' || s.speed !== 1 || prefersReducedMotion()) return
        const lib = world.library
        const meta = p.issue === null ? undefined : lib?.getSnapshot().metas?.find((m) => m.kind === 'minutes' && m.repo === p.project && m.folder === p.issue)
        void (async () => {
          let convs = null
          if (meta && meta.readable && meta.grade !== 'private') {
            await lib!.ensure([meta.id])
            const body = lib!.getSnapshot().bodies[meta.id]
            convs = body ? conversations(body.data) : null
          }
          // the playhead moved on while the body was loading
          if (replay.point !== p) return
          world.meeting.start(scriptFor(p, meta, convs, false), officeNow(world), replay.scene()!.status, {})
        })()
      }),
    ]
    replay.hold = () => world.meeting.busy
    // debug only: window.__replay.open({ project, t }) / .seek(i) / .points / .scene() for screenshot scripts
    if (world.debug) (window as unknown as { __replay: typeof replay }).__replay = replay
    setClockClick(() => void replay.open({ project: 'all' }))
    return () => {
      off.forEach((o) => o())
      cancelAnimationFrame(raf)
      replay.hold = () => false
      setClockClick(null)
    }
  }, [world])

  // ?replay=<project|all>&t=<time>: open there, paused (share link, design 4)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const want = q.get('replay')
    if (want === null || want === '') return
    const t = Date.parse(q.get('t') ?? '')
    void replay.load().then(() => {
      void replay.open({ project: want === 'all' ? 'all' : replay.getSnapshot().projects.find((p) => p === want || p.endsWith(`/${want}`)) ?? 'all', ...(Number.isNaN(t) ? {} : { t }) })
    })
  }, [])
  return null
}
