// The LIVE desk props in 3D (#44, nodes from #43, docs/design/desks.md 4): what deskProps() decided, put on the
// model every frame. Nothing here decides; it only shows.

import { CanvasTexture, MathUtils, MeshBasicMaterial, SRGBColorSpace, Vector3, type Color, type Mesh, type Object3D } from 'three'
import type { DeskProps } from './props'

/** an emitter's own colors (a node may hold several meshes), so it can be dimmed and brought back */
function emitter(node: Object3D | undefined) {
  const parts: { mat: MeshBasicMaterial; base: Color }[] = []
  node?.traverse((o) => {
    const mesh = o as Mesh
    const mat = mesh.material as MeshBasicMaterial | undefined
    const base = (mesh.userData.baseColor as Color | undefined) ?? mat?.color
    if (mesh.isMesh && mat?.color && base) parts.push({ mat, base: base.clone() })
  })
  return (k: number) => {
    for (const p of parts) p.mat.color.copy(p.base).multiplyScalar(k)
  }
}

const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const OFF = 0.08
const HOURGLASS_EVERY = 6 // s: while the planner waits, it turns the hourglass over now and then
const BLINK_HZ = 2.2

export class DeskLive {
  private trays: { node: Object3D | undefined; rest: number }[]
  private hourglass: Object3D | undefined
  private turntable: Object3D | undefined
  private ring: (k: number) => void
  private tablet: (k: number) => void
  private lamp: (k: number) => void
  private signal: Record<'g' | 'y' | 'r', (k: number) => void>
  private duck: Object3D | undefined
  private calendar: { ctx: CanvasRenderingContext2D; texture: CanvasTexture; drawn: string } | null = null
  private flip = { angle: 0, target: 0, nextAt: 0 }
  private spin = 0

  constructor(nodes: Record<string, Object3D>) {
    const n = (name: string) => nodes[name]
    this.trays = ['desk_0_in', 'desk_0_out'].map((k) => ({ node: n(k), rest: n(k)?.scale.y ?? 1 }))
    this.hourglass = n('desk_0_hourglass')
    this.turntable = n('desk_1_turntable')
    this.ring = emitter(n('desk_1_ringlight'))
    this.tablet = emitter(n('desk_2_tablet'))
    this.lamp = emitter(n('desk_2_lamp'))
    this.signal = { g: emitter(n('desk_3_signal_g')), y: emitter(n('desk_3_signal_y')), r: emitter(n('desk_3_signal_r')) }
    this.duck = n('desk_3_duck_look')
    const cal = n('screen_cal_0') as Mesh | undefined
    if (cal) {
      // one canvas per scene (StrictMode builds this twice): the texture shown is the one drawn on
      this.calendar = (cal.userData.calendar ??= DeskLive.makeCalendar(cal)) as DeskLive['calendar']
    }
  }

  private static makeCalendar(mesh: Mesh) {
    const c = document.createElement('canvas')
    c.width = 204 // the slot is 0.10 × 0.07 m (aspect 1.4286), ~2 px per mm
    c.height = 143
    const texture = new CanvasTexture(c)
    texture.flipY = false // glTF UVs
    texture.colorSpace = SRGBColorSpace
    const old = mesh.material as MeshBasicMaterial
    mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    old.dispose()
    return { ctx: c.getContext('2d')!, texture, drawn: '' }
  }

  /** the planner's desk calendar: month and day big, the weekday on a red band (the visitor's day) */
  private drawCalendar(p: DeskProps) {
    const cal = this.calendar
    if (!cal) return
    const key = `${p.calendar.year}-${p.calendar.month}-${p.calendar.day}`
    if (cal.drawn === key) return
    cal.drawn = key
    const g = cal.ctx
    const day = new Date(p.calendar.year, p.calendar.month - 1, p.calendar.day).getDay()
    g.fillStyle = '#f3ead8'
    g.fillRect(0, 0, 204, 143)
    g.fillStyle = '#d64545'
    g.fillRect(0, 0, 204, 36)
    g.fillStyle = '#f3ead8'
    g.font = 'bold 22px ui-monospace, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(`${p.calendar.month}월 · ${WEEKDAY_EN[day]}`, 102, 19)
    g.fillStyle = '#16181d'
    g.font = 'bold 78px ui-monospace, monospace'
    g.fillText(String(p.calendar.day), 102, 92)
    cal.texture.needsUpdate = true
  }

  /** the duck's head in world space, for the coder to look at when a test fails */
  duckPoint(out = new Vector3()) {
    return this.duck ? this.duck.getWorldPosition(out) : null
  }

  update(p: DeskProps, t: number, dt: number, reduced: boolean) {
    // 메모: the trays hold as many sheets as there is work (5 modeled, scale by n/5; none = hidden)
    for (const [i, tray] of this.trays.entries()) {
      if (!tray.node) continue
      const n = i === 0 ? p.inbox : p.outbox
      tray.node.visible = n > 0
      tray.node.scale.y = tray.rest * Math.max(n, 0.001) / 5
    }
    this.drawCalendar(p)
    // the hourglass turns over every few seconds while the planner waits for an approval, else stays upright
    if (this.hourglass) {
      if (p.hourglass && t >= this.flip.nextAt) {
        this.flip.target += Math.PI
        this.flip.nextAt = t + HOURGLASS_EVERY
      }
      if (!p.hourglass) this.flip.target = Math.round(this.flip.target / (2 * Math.PI)) * 2 * Math.PI
      this.flip.angle = reduced ? this.flip.target : MathUtils.damp(this.flip.angle, this.flip.target, 5, dt)
      this.hourglass.rotation.x = this.flip.angle
    }
    // 메시: the turntable spins while baking; the ring light is on while baking and blinks after
    if (this.turntable && p.turntable) {
      this.spin += dt * (reduced ? 0.4 : 1.2)
      this.turntable.rotation.y = this.spin
    }
    const blink = reduced ? 1 : Math.sin(t * BLINK_HZ * Math.PI * 2) > 0 ? 1 : 0.25
    this.ring(p.ringlight === 'on' ? 1 : p.ringlight === 'blink' ? blink : OFF)
    // 휴: the tablet glows while editing; the lamp is on while she's in
    this.tablet(p.tablet ? 1 : OFF)
    this.lamp(p.lamp ? 1 : 0.04)
    // 루프: one light at a time
    this.signal.g(p.signal === 'green' ? 1 : OFF)
    this.signal.y(p.signal === 'yellow' ? (reduced ? 1 : 0.65 + 0.35 * Math.sin(t * 6)) : OFF)
    this.signal.r(p.signal === 'red' ? 1 : OFF)
  }
}
