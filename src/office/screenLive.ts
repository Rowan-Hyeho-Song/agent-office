// The four work monitors (#75, docs/design/office-ui.md 4): a 584 x 338 canvas on each screen_work_N. screens.ts decides
// what to show; this draws it. At most 8 redraws a second; an unchanged state repaints only the bottom band
// (progress strip, elapsed time); a monitor outside the view is not drawn at all.

import { CanvasTexture, Color, Frustum, LinearMipmapLinearFilter, Matrix4, MeshBasicMaterial, SRGBColorSpace, Sphere, type Camera, type Mesh, type Object3D } from 'three'
import { hasStill, LIVE_OPS, screenPlan, screenState, ICONS, WRAP_FIELDS, type IconName, type Op, type ScreenState } from './screens'
import { clip, PRIVATE_TASK_LABEL, taskNumber, taskOf, type AgentStatus, type AgentTask, type StatusMap } from './status'
import { AGENT_INFO } from './world'

export const MW = 584
export const MH = 338
const DRAW_MS = 125 // 8 per second
/** the bottom band that holds the strip, the elapsed time and the wrap-up fields; its top is a multiple of 3 (scanlines line up) */
const BAND_Y = 288

/** the design tokens the canvas reads (src/styles/tokens.css), once */
function readTokens() {
  const cs = getComputedStyle(document.documentElement)
  const s = (n: string) => cs.getPropertyValue(n).trim()
  const n = (name: string, fallback: number) => parseFloat(s(name)) || fallback
  return {
    pad: n('--screen-pad', 24),
    fsS: n('--screen-fs-s', 24),
    fsL: n('--screen-fs-l', 48),
    icon: n('--screen-icon', 96),
    tint: n('--screen-tint', 0.08),
    hatch: n('--screen-hatch', 0.12),
    scan: n('--screen-scanline', 0.035),
    glow: n('--screen-glow', 0.85),
    bg: s('--screen-bg') || '#05080b',
    off: s('--screen-off') || '#020304',
    text: s('--color-text') || '#f3ead8',
    muted: s('--color-text-muted') || '#b3ab9c',
    faint: s('--color-text-faint') || '#8a8478',
    lock: s('--color-lock') || '#b8b2a6',
    amber: s('--color-amber') || '#ffb347',
    agent: (seat: number) => ({
      col: s(`--agent-${seat}`) || AGENT_INFO[`agent_${seat}`]?.color || '#a39d90',
      ink: s(`--agent-${seat}-ink`) || s(`--agent-${seat}`) || '#a39d90',
    }),
  }
}
type Tokens = ReturnType<typeof readTokens>

const hex = (h: string) => {
  const v = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
}
const mix = (a: string, b: string, t: number) => {
  const A = hex(a)
  const B = hex(b)
  return `rgb(${A.map((v, i) => Math.round(v * (1 - t) + B[i] * t)).join(',')})`
}
const alpha = (a: string, t: number) => `rgba(${hex(a).join(',')},${t})`
const taskNumber2 = (t: AgentTask) => (t.private ? 'private' : `${taskNumber(t)} ${t.title ?? ''}`)
const two = (n: number) => String(n).padStart(2, '0')
const pixel = (size: number, bold = false) => `${bold ? 700 : 400} ${size}px Galmuri11, monospace`

/** the debug override of one monitor (window.__office.screens) */
export interface ScreenForce {
  state: ScreenState
  activity?: string
}

interface Monitor {
  seat: number
  mesh: Mesh
  ctx: CanvasRenderingContext2D
  texture: CanvasTexture
  sphere: Sphere
  /** what is on the canvas now */
  key: string
}

export interface ScreenFrame {
  t: number
  now: number
  status: StatusMap
  reduced: boolean
  camera: Camera
  /** debug: states forced per seat */
  forced?: Partial<Record<number, ScreenForce>>
}

const frustum = new Frustum()
const projView = new Matrix4()

export class ScreenLive {
  readonly monitors: Monitor[] = []
  private tk: Tokens | null = null
  private fontsReady = false
  private lastTick = -Infinity
  /** canvas uploads since the start (debug: window.__office.screens.stats) */
  uploads = 0
  fullDraws = 0
  stripDraws = 0
  /** time spent in update() since the start, ms (debug stats) */
  ms = 0

  constructor(nodes: Record<string, Object3D>, maxAnisotropy: number) {
    for (let seat = 0; seat < 4; seat++) {
      const node = nodes[`screen_work_${seat}`]
      const mesh = node && ([node, ...node.children].find((o) => (o as Mesh).isMesh) as Mesh | undefined)
      if (!mesh) continue
      // one canvas per scene (StrictMode builds this twice): the texture shown is the one drawn on
      const made = (mesh.userData.workScreen ??= ScreenLive.make(mesh, maxAnisotropy)) as Pick<Monitor, 'ctx' | 'texture' | 'sphere'>
      this.monitors.push({ seat, mesh, ...made, key: '' })
    }
    // first full draw only once Galmuri11 is in (a fallback face would be baked into the canvas)
    void Promise.all([document.fonts.load(pixel(24)), document.fonts.load(pixel(48, true))])
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .then(() => {
        this.fontsReady = true
      })
  }

  private static make(mesh: Mesh, maxAnisotropy: number) {
    const c = document.createElement('canvas')
    c.width = MW
    c.height = MH
    const texture = new CanvasTexture(c)
    texture.flipY = false // glTF UVs
    texture.colorSpace = SRGBColorSpace
    // the monitor is 62 px wide from the default camera: without mipmaps the text and the strip shimmer
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.anisotropy = Math.min(8, maxAnisotropy)
    const old = mesh.material as MeshBasicMaterial
    const glow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--screen-glow')) || 0.85
    // toneMapped off like the other emitters; colour = glow < 1 keeps the brightest text under the bloom threshold
    mesh.material = new MeshBasicMaterial({ map: texture, color: new Color().setScalar(glow), toneMapped: false })
    old.dispose()
    mesh.geometry.computeBoundingSphere()
    mesh.updateWorldMatrix(true, false)
    const sphere = mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld)
    return { ctx: c.getContext('2d')!, texture, sphere }
  }

  update(f: ScreenFrame) {
    const t0 = performance.now()
    this.tick(f)
    this.ms += performance.now() - t0
  }

  private tick(f: ScreenFrame) {
    if (!this.fontsReady || !this.monitors.length) return
    const ms = f.t * 1000
    if (ms - this.lastTick < DRAW_MS) return
    this.lastTick = ms
    this.tk ??= readTokens()
    projView.multiplyMatrices(f.camera.projectionMatrix, f.camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projView)
    for (const m of this.monitors) {
      if (!frustum.intersectsSphere(m.sphere)) continue
      const forced = f.forced?.[m.seat]
      const st: Pick<AgentStatus, 'state' | 'activity'> | undefined = f.status[`agent_${m.seat}`]
      const state = forced?.state ?? screenState(st)
      const activity = forced ? forced.activity : st?.activity
      const since = f.status[`agent_${m.seat}`]?.since ?? f.now
      // the saver's position / the standby light's phase are part of the key for the states that are only that
      const phase = state === 'rest' ? Math.round(f.t * 8) : state === 'off' ? (f.reduced || Math.floor(f.t * 0.8) % 2 === 0 ? 1 : 0) : 0
      const minute = Math.floor(f.now / 60000)
      const task = state === 'work' || state === 'wrap' || state === 'private' ? taskOf(f.status[`agent_${m.seat}`]) : undefined
      const key = `${state}|${state === 'work' ? activity : ''}|${f.reduced}|${minute}|${phase}|${task ? taskNumber2(task) : ''}`
      const plan = screenPlan(state, activity)
      if (key !== m.key) {
        m.key = key
        this.draw(m, plan, f, since, false, task)
        this.fullDraws++
      } else if (hasStill(plan)) {
        this.draw(m, plan, f, since, true, task)
        this.stripDraws++
      } else continue
      m.texture.needsUpdate = true
      this.uploads++
    }
  }

  private draw(m: Monitor, plan: Op[], f: ScreenFrame, since: number, bandOnly: boolean, task?: AgentTask) {
    const tk = this.tk!
    const g = m.ctx
    const { col, ink } = tk.agent(m.seat)
    const { pad, fsS, fsL, icon: ic } = tk
    const bg = tk.bg
    g.save()
    if (bandOnly) {
      g.beginPath()
      g.rect(0, BAND_Y, MW, MH - BAND_Y)
      g.clip()
    }
    g.clearRect(0, 0, MW, MH)
    g.textBaseline = 'top'
    g.textAlign = 'left'
    const tone = (t: string) => (t === 'lock' ? tk.lock : t === 'ink' ? ink : tk.text)
    const stripY = MH - pad - 16
    const icon = (name: IconName, x: number, y: number, size: number, color: string) => {
      const px = size / 12
      g.fillStyle = color
      ICONS[name].forEach((r, ry) =>
        [...r].forEach((c, rx) => {
          if (c === '#') g.fillRect(Math.round(x + rx * px), Math.round(y + ry * px), Math.ceil(px), Math.ceil(px))
        }),
      )
    }
    const clock = () => {
      const d = new Date(f.now)
      return `${two(d.getHours())}:${two(d.getMinutes())}`
    }
    for (const o of plan) {
      if (bandOnly && !LIVE_OPS.has(o.op) && o.op !== 'bg' && o.op !== 'hatch') continue
      switch (o.op) {
        case 'bg':
          g.fillStyle = o.tone === 'off' ? tk.off : o.tone === 'lock' ? mix(bg, tk.lock, 0.05) : mix(bg, col, o.tone === 'rest' ? tk.tint * 0.35 : tk.tint)
          g.fillRect(0, 0, MW, MH)
          break
        case 'hatch':
          g.save()
          g.strokeStyle = alpha(col, tk.hatch)
          g.lineWidth = 8
          for (let x = -MH; x < MW; x += 28) {
            g.beginPath()
            g.moveTo(x, MH)
            g.lineTo(x + MH, 0)
            g.stroke()
          }
          g.restore()
          break
        case 'head': {
          const info = AGENT_INFO[`agent_${m.seat}`]
          g.font = pixel(fsS)
          g.fillStyle = tone(o.tone)
          g.fillText(`${info?.name.split(' ')[1] ?? ''} · RB-1${m.seat}`, pad, pad)
          g.textAlign = 'right'
          g.fillStyle = tk.muted
          g.fillText(clock(), MW - pad, pad)
          g.textAlign = 'left'
          g.fillStyle = mix(o.tone === 'lock' ? tk.lock : col, bg, 0.7)
          g.fillRect(pad, pad + fsS + 10, MW - 2 * pad, 2)
          break
        }
        case 'icon':
          icon(o.icon, pad, 172 - ic / 2, ic, tone(o.tone))
          break
        case 'label':
          g.font = pixel(fsL, true)
          g.fillStyle = tone(o.tone)
          g.textBaseline = 'middle'
          g.fillText(o.text, pad + ic + 24, 174)
          g.textBaseline = 'top'
          break
        case 'strip': {
          const c = o.tone === 'lock' ? tk.lock : col
          const head = f.reduced ? -1 : Math.floor(f.t * 8) % 12
          for (let i = 0; i < 12; i++) {
            const lit = f.reduced ? true : (i - head + 12) % 12 < 3
            g.fillStyle = lit ? c : mix(c, bg, 0.8)
            g.fillRect(pad + i * 32, stripY, 24, 12)
          }
          break
        }
        case 'elapsed': {
          const s = Math.max(0, Math.floor((f.now - since) / 1000))
          g.font = pixel(fsS)
          g.fillStyle = tk.muted
          g.textAlign = 'right'
          g.textBaseline = 'middle'
          g.fillText([s / 3600, (s / 60) % 60, s % 60].map((v) => two(Math.floor(v))).join(':'), MW - pad, stripY + 6)
          g.textAlign = 'left'
          g.textBaseline = 'top'
          break
        }
        case 'fields': {
          const done = f.reduced ? 4 : Math.floor(f.t * 1.4) % 6
          g.font = pixel(fsS)
          let x = pad
          WRAP_FIELDS.forEach((name, i) => {
            g.fillStyle = i < done ? col : mix(col, bg, 0.75)
            g.fillRect(x, stripY - 4, 20, 20)
            if (i >= done) {
              g.fillStyle = mix(bg, col, tk.tint)
              g.fillRect(x + 3, stripY - 1, 14, 14)
            }
            g.fillStyle = i < done ? tk.text : tk.muted
            g.textBaseline = 'middle'
            g.fillText(name, x + 28, stripY + 7)
            g.textBaseline = 'top'
            x += 28 + g.measureText(name).width + 28
          })
          break
        }
        case 'saver': {
          const size = 72
          const L = MW - 2 * pad - size
          const H = MH - 2 * pad - size - fsS - 8
          const tri = (v: number, len: number) => {
            const p = v % (2 * len)
            return p < len ? p : 2 * len - p
          }
          const tt = f.reduced ? 3 : f.t
          icon('bot', pad + tri(tt * 38, L), pad + tri(tt * 27 + 40, H), size, alpha(ink, 0.8))
          break
        }
        case 'restFoot':
          g.font = pixel(fsS)
          g.fillStyle = tk.muted
          g.fillText('휴식 중', pad, MH - pad - fsS)
          g.textAlign = 'right'
          g.fillText(clock(), MW - pad, MH - pad - fsS)
          g.textAlign = 'left'
          break
        case 'standby':
          g.font = pixel(fsS)
          g.fillStyle = alpha(tk.faint, 0.6)
          g.fillText('대기', pad, MH - pad - fsS)
          break
        case 'led': {
          const on = f.reduced || Math.floor(f.t * 0.8) % 2 === 0 // slow breathing
          g.shadowColor = tk.amber
          g.shadowBlur = on ? 12 : 4
          g.fillStyle = on ? tk.amber : mix(tk.amber, tk.off, 0.5)
          g.fillRect(MW - pad - 12, MH - pad - 12, 12, 12)
          g.shadowBlur = 0
          break
        }
      }
    }
    if (task && !bandOnly) {
      // #182: the one-line header strip at the very top: number chip (agent colour at 20%) + the title, cut with an ellipsis
      g.font = pixel(16)
      g.textBaseline = 'middle'
      const y = 12
      let x = pad
      if (task.private) {
        icon('lock', x, y - 6, 12, tk.lock)
        g.fillStyle = tk.muted
        g.fillText(PRIVATE_TASK_LABEL, x + 20, y)
      } else {
        const num = taskNumber(task)
        const w = g.measureText(num).width
        g.fillStyle = alpha(col, 0.2)
        g.fillRect(x - 6, y - 10, w + 12, 20)
        g.fillStyle = tk.text
        g.fillText(num, x, y)
        x += w + 14
        let title = task.title ? clip(task.title, 22) : ''
        while (title.length > 1 && x + g.measureText(title).width > MW - pad) title = clip(title, Array.from(title).length - 1)
        g.fillStyle = tk.muted
        g.fillText(title, x, y)
      }
      g.textBaseline = 'top'
    }
    g.fillStyle = `rgb(255 255 255 / ${tk.scan})`
    for (let y = bandOnly ? BAND_Y : 0; y < MH; y += 3) g.fillRect(0, y, MW, 1)
    g.restore()
  }
}
