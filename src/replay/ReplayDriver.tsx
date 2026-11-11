import { useEffect } from 'react'
import { conversations } from '../docs/library'
import { setCameraKeysBlocked } from '../office/cameraRig'
import { setClockClick, setClockTime } from '../office/clock'
import { prefersReducedMotion, type OfficeWorld } from '../office/world'
import { atMs } from './engine'
import type { Point } from '../timeline/types'
import { noteMinutes } from './minutesInfo'
import { scriptFor } from './scene'
import { startMinutes } from './stage'
import { replay } from './store'

const ENTER_MS = 1200
const EXIT_MS = 800
const ease = (k: number) => 1 - (1 - k) * (1 - k)

/**
 * Wires the replay into the office (#82): the whiteboard shows the folded board, the wall clock follows the playhead
 * (hands wind back on the way in and forward on the way out), a minutes point plays a short meeting at any speed (on the replay clock), the clock
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
        setCameraKeysBlocked(false)
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
      // the camera keys rest while the hands wind back on the way in (WASD works again right after, also during playback)
      setCameraKeysBlocked(to !== null && anim.dur > 0)
      raf = requestAnimationFrame(frame)
    }

    // the library's document of a minutes point and its table's rows (null rows: SECRET / private, or not loaded)
    const tableOf = async (p: Point) => {
      const lib = world.library
      const meta = p.issue === null ? undefined : lib?.getSnapshot().metas?.find((m) => m.kind === 'minutes' && m.repo === p.project && m.folder === p.issue)
      let convs = null
      if (meta && meta.readable && meta.grade !== 'private') {
        await lib!.ensure([meta.id])
        const body = lib!.getSnapshot().bodies[meta.id]
        convs = body ? conversations(body.data) : null
      }
      return { meta, convs }
    }
    // the rows of this day's minutes points are counted ahead (the remaining time includes them, timelapse.md 11.4)
    let preloaded: readonly Point[] | null = null
    const preload = (win: readonly Point[]) => {
      if (win === preloaded || !world.library?.getSnapshot().metas) return
      preloaded = win
      void (async () => {
        for (const p of win.filter((q) => q.kind === 'minutes').slice(0, 40)) {
          const { meta, convs } = await tableOf(p)
          if (replay.points !== win) return
          noteMinutes(p, scriptFor(p, meta, convs, false))
        }
      })()
    }
    let was = replay.getSnapshot().mode
    let lastPoint: unknown = null
    const sync = () => {
      const s = replay.getSnapshot()
      if (s.mode === 'office') {
        preload(replay.points)
        world.board.lock(replay.scene()?.board ?? null)
        if (was !== 'office') animate(Date.now(), target())
        else if (!anim && replay.point !== lastPoint) setClockTime(new Date(target()))
        lastPoint = replay.point
      } else if (was === 'office') {
        world.board.lock(null)
        world.meeting.stop()
        setCameraKeysBlocked(false)
        animate(replay.point ? target() : Date.now(), null)
      }
      was = s.mode
    }
    const off = [
      replay.subscribe(sync),
      replay.onPoint((p, via) => {
        // seeking (drag, keys) only changes the state; a scene starts when the replay plays the point (design 8)
        world.meeting.stop()
        if (via !== 'play' || p.kind !== 'minutes') return
        // the meeting starts at the clock of the landing, however long its body takes to load
        const at = replay.landedClock
        void (async () => {
          const { meta, convs } = await tableOf(p)
          // the playhead moved on while the body was loading
          if (replay.point !== p) return
          // reduced motion: the rows are bubbles at the seats, nobody gathers or passes (timelapse.md 11.4)
          const reduced = prefersReducedMotion()
          noteMinutes(p, scriptFor(p, meta, convs, false))
          startMinutes(world.meeting, p, meta, convs, at, replay.scene()!.status, replay.getSnapshot().speed, reduced)
        })()
      }),
    ]
    // debug only: window.__replay.open({ project, t }) / .seek(i) / .points / .scene() for screenshot scripts
    if (world.debug) (window as unknown as { __replay: typeof replay }).__replay = replay
    setClockClick(() => void replay.open({ project: 'all' }))
    return () => {
      off.forEach((o) => o())
      cancelAnimationFrame(raf)
      setCameraKeysBlocked(false)
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
