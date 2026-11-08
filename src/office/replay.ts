// What starts a meeting replay: new minutes arriving in the library (everyone is called in), the idle replay of a past
// minutes picked from the clock once an hour (only agents that are not working), and ?debug=1 by hand. It reads only what
// the library gives THIS viewer: a body is fetched only for a document the viewer may read.

import { conversations, type DocMeta } from '../docs/library'
import type { LibraryStore } from '../docs/store'
import { buildScript, newMinutes, pickReplay, replayDue, hourOf } from './meeting'
import type { MeetingRunner, StartOptions } from './meetingRun'
import type { StatusMap } from './status'

export class ReplayControl {
  /** the hourly idle replay (off under ?debug=1 unless asked, so screenshots stay still) */
  auto: boolean
  private prev: DocMeta[] | null
  private lastHour: number | null = null

  constructor(
    private lib: LibraryStore,
    readonly run: MeetingRunner,
    private env: { now: () => number; status: () => StatusMap; reduced: () => boolean },
    auto: boolean,
  ) {
    this.auto = auto
    this.prev = lib.getSnapshot().metas
  }

  /** start watching the library for new minutes; returns the unsubscribe */
  watch(): () => void {
    return this.lib.subscribe(() => {
      const metas = this.lib.getSnapshot().metas
      if (!metas) return
      const news = newMinutes(this.prev, metas)
      this.prev = metas
      for (const m of news) void this.play(m, {})
    })
  }

  /** every frame: the idle replay when it is time */
  tick() {
    const now = this.env.now()
    if (!this.auto || this.run.busy || !replayDue(now, this.lastHour)) return
    this.lastHour = hourOf(now)
    const meta = pickReplay(this.lib.getSnapshot().metas ?? [], now)
    if (meta) void this.play(meta, { skipWorking: true })
  }

  /** replay one minutes document as this viewer may see it; false if nobody could meet */
  async play(meta: DocMeta, opts: StartOptions): Promise<boolean> {
    let convs = null
    if (meta.readable && meta.grade !== 'private') {
      await this.lib.ensure([meta.id])
      const body = this.lib.getSnapshot().bodies[meta.id]
      convs = body ? conversations(body.data) : null
    }
    return this.run.start(buildScript(meta, convs, { reduced: this.env.reduced() }), this.env.now(), this.env.status(), opts)
  }

  private metas = () => (this.lib.getSnapshot().metas ?? []).filter((m) => m.kind === 'minutes')

  // ---- ?debug=1: window.__office.replay ------------------------------------------------------------------------------

  /** replay the minutes of issue n (of a repo, if two share the number); everyone is called in */
  minutes(n: number, repo?: string) {
    const m = this.metas().find((x) => x.folder === n && (!repo || x.repo === repo))
    return m ? this.play(m, {}) : Promise.resolve(false)
  }
  /** replay a SECRET (not yet approved, review) minutes: blocks instead of words */
  secret() {
    const m = this.metas().find((x) => x.grade === 'review' && !x.approved)
    return m ? this.play(m, {}) : Promise.resolve(false)
  }
  /** replay a private minutes: the lock's words */
  private() {
    const m = this.metas().find((x) => x.grade === 'private')
    return m ? this.play(m, {}) : Promise.resolve(false)
  }
  /** force the clock-based pick of `at` (ms since the epoch; default now): the same document every visitor gets that hour */
  pick(at = this.env.now()) {
    const m = pickReplay(this.metas(), at)
    return m ? this.play(m, { skipWorking: true }).then((ok) => (ok ? m.id : false)) : Promise.resolve(false)
  }
  /** which document the pick of `at` is (nothing plays) */
  pickId(at = this.env.now()) {
    return pickReplay(this.metas(), at)?.id ?? null
  }
  stop() {
    this.run.stop()
  }
}
