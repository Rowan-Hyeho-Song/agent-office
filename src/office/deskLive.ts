// The LIVE desk props in 3D (#44, nodes from #43, docs/design/desks.md 4): what deskProps() decided, put on the
// model every frame. Nothing here decides; it only shows.

import { CanvasTexture, MathUtils, MeshBasicMaterial, SRGBColorSpace, Vector3, type Color, type Mesh, type Object3D } from 'three'
import type { DeskProps } from './props'
import type { TouchShown } from './deskTouch'
import { TrayPile } from './tray'
import { LiveAxis } from './liveAxis'
import { PlaySounds } from '../audio/playSounds'
import { faderLevels, setSpeakerNodes, speakerCells, speakerCone, speakerOn } from '../audio/speaker'

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
/** the IN tray's amber dot when nothing waits: 15% of lit (designer, #64), dim enough not to read as "pending" */
const APPROVAL_DOT_OFF = 0.15
const BLINK_HZ = 2.2

/** echo's mixer (desks.md, #193): the woofer cones travel 3 mm, the level meter has 8 cells, 4 faders; every value comes from src/audio/speaker.ts */
export class EchoDesk {
  private spk: { live: LiveAxis; travel: number }[]
  private led: (k: number) => void
  private meter: ((k: number) => void)[]
  private fader: { live: LiveAxis; travel: number }[]
  private knob: LiveAxis[]
  readonly present: boolean
  private cells = 0

  constructor(n: (name: string) => Object3D | undefined) {
    // each along or about its own axis from extras (#484): the cones +z (the push), the faders -z (the slot, zero at its end), the knobs y
    const slide = (node: Object3D | undefined, fallback: Vector3) => (node ? [{ live: new LiveAxis(node, fallback), travel: Number(node.userData.travel) || 0 }] : [])
    this.spk = ['desk_4_spk_l', 'desk_4_spk_r'].flatMap((k) => slide(n(k), new Vector3(0, 0, 1)))
    this.fader = [0, 1, 2, 3].flatMap((k) => slide(n(`desk_4_fader_${k}`), new Vector3(0, 0, -1)))
    this.knob = [0, 1, 2, 3].flatMap((k) => {
      const node = n(`desk_4_knob_${k}`)
      return node ? [new LiveAxis(node, new Vector3(0, 1, 0))] : []
    })
    this.led = emitter(n('desk_4_spk_led'))
    this.meter = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => emitter(n(`desk_4_meter_${k}`)))
    this.present = this.spk.length > 0 || this.fader.length > 0
    const l = n('desk_4_spk_l')
    const r = n('desk_4_spk_r')
    if (l && r) setSpeakerNodes(l, r)
  }

  update(reduced: boolean) {
    if (!this.present) return
    const cone = speakerCone()
    const faders = faderLevels()
    // the cones: along their own +z (the speaker's push); reduced motion leaves them
    for (const c of this.spk) c.live.slide(c.travel * (reduced ? 0 : cone))
    // the faders: hook / piano / bass / drums, along their slot
    this.fader.forEach((f, k) => f.live.slide(f.travel * faders[k]))
    // the gain knobs turn with their fader (about 270 degrees end to end)
    this.knob.forEach((o, k) => o.turn((faders[k] - 0.5) * 1.5 * Math.PI))
    this.led(speakerOn() ? 1 : OFF)
    // the level meter follows the speaker's cells only: no sound, no light (sound.md 5)
    const lit = MathUtils.clamp(speakerCells(), 0, 8)
    this.cells = lit
    this.meter.forEach((m, k) => m(k < lit ? 1 : 0.06))
  }

  /** cells lit now (debug / tests) */
  get lit() {
    return this.cells
  }
}

export class DeskLive {
  private trays: (TrayPile | null)[]
  /** both turn about their own axis on top of the baked rotation (#484: the hourglass is baked turned 180°, the turntable 90°) */
  private hourglass: LiveAxis | undefined
  private turntable: LiveAxis | undefined
  private ring: (k: number) => void
  private tablet: (k: number) => void
  /** neon_approval: the amber dot on the IN tray, lit while something waits for the owner (when the model has it) */
  private approvalDot: (k: number) => void
  private lamp: (k: number) => void
  private signal: Record<'g' | 'y' | 'r', (k: number) => void>
  private duck: Object3D | undefined
  /** where the test pass / fail chime comes from (#194 ②) */
  private signalAt: Object3D | undefined
  private signalPos = new Vector3()
  private sounds = new PlaySounds()
  private echo: EchoDesk
  private calendar: { ctx: CanvasRenderingContext2D; texture: CanvasTexture; drawn: string } | null = null
  /** #370 A the ring light's knob and the calendar's page (hidden at rest), turned by a hand (deskTouch.ts) */
  private knob: LiveAxis | undefined
  private page: { live: LiveAxis; sign: number } | undefined
  /** #370 B2 휴's swatch chips: each about its own z, from its baked fan angle (rest_deg) */
  private chips: { live: LiveAxis; rest: number }[] = []
  private spin = 0

  constructor(nodes: Record<string, Object3D>) {
    const n = (name: string) => nodes[name]
    this.trays = ['desk_0_in', 'desk_0_out'].map((k) => TrayPile.of(n(k)))
    const hg = n('desk_0_hourglass')
    const tt = n('desk_1_turntable')
    this.hourglass = hg && new LiveAxis(hg, new Vector3(1, 0, 0))
    this.turntable = tt && new LiveAxis(tt, new Vector3(0, 1, 0))
    this.ring = emitter(n('desk_1_ringlight'))
    const kn = n('desk_1_ringlight_knob')
    this.knob = kn && new LiveAxis(kn, new Vector3(1, 0, 0))
    const pg = n('desk_0_calendar_page')
    if (pg) this.page = { live: new LiveAxis(pg, new Vector3(1, 0, 0)), sign: Number(pg.userData.flip_sign) || 1 }
    for (let k = 0; k < 4; k++) {
      const c = n(`desk_2_swatch_leaf_${k}`)
      if (c) this.chips.push({ live: new LiveAxis(c, new Vector3(0, 0, 1)), rest: Number(c.userData.rest_deg) || 0 })
    }
    this.tablet = emitter(n('desk_2_tablet'))
    this.approvalDot = emitter(n('neon_approval'))
    this.lamp = emitter(n('desk_2_lamp'))
    this.signal = { g: emitter(n('desk_3_signal_g')), y: emitter(n('desk_3_signal_y')), r: emitter(n('desk_3_signal_r')) }
    this.duck = n('desk_3_duck_look')
    this.signalAt = n('desk_3_signal_y')
    this.echo = new EchoDesk(n)
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

  /** `touch`: what the hands move (#370 A, deskTouch.ts); without it all rests as baked */
  update(p: DeskProps, t: number, dt: number, reduced: boolean, touch?: TouchShown) {
    // 메모: the trays hold as many sheets as there is work, 0.8 cm each; past five a '+' tab (#59, tray.ts)
    this.trays[0]?.set(p.inbox, p.inboxMore)
    this.trays[1]?.set(p.outbox, p.outboxMore)
    this.drawCalendar(p)
    this.approvalDot(p.inbox > 0 ? 1 : APPROVAL_DOT_OFF)
    // the hourglass is turned over only by the planner's hand, once as an approval starts waiting (#370 A: no longer every 6 s by itself)
    if (this.hourglass) {
      // about its middle, lifted so the plates never go into the felt coaster it stands on (#493), and as the fingers lift it
      this.hourglass.turnResting(touch?.hourglassTurn ?? 0)
      this.hourglass.node.position.y += touch?.hourglassLift ?? 0
    }
    // 메시: the turntable spins while baking (and is pushed round by hand now and then); the ring light is on while baking and blinks after
    if (this.turntable) {
      if (p.turntable) this.spin += dt * (reduced ? 0.4 : 1.2)
      this.turntable.turn(this.spin + (touch?.turntablePush ?? 0))
    }
    this.knob?.turn(touch?.knobTurn ?? 0)
    // the swatch spread by the designer's hand: each chip as far again past its rest
    for (const c of this.chips) c.live.turn(((c.rest * (touch?.swatchSpread ?? 0)) * Math.PI) / 180)
    if (this.page) {
      const deg = touch?.calendarPage ?? null
      this.page.live.node.visible = deg !== null
      this.page.live.turn(((deg ?? 0) * this.page.sign * Math.PI) / 180)
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
    // 에코: speaker cones, faders, knobs, level meter
    this.echo.update(reduced)
    this.sounds.signalLight(p.signal, this.signalAt ? this.signalAt.getWorldPosition(this.signalPos) : null)
  }
}
