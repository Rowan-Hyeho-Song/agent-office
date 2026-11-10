// The water on the model (#185, watering.md 3): puts waterFx.ts's stream, wet soil, sway and drips on the office's scene. The stream is the one
// InstancedMesh the stage already has for the dispenser's tap (no new draw call); the wet soil is a flat dark layer over each pot's soil (the
// soil is baked into the plant's atlas mesh, whose material every lounge prop shares: there is no soil material of its own to darken); the
// sway turns the plant's node (and its veins) about the pot's foot; the drips are three more instances of the stream's mesh.

import { CircleGeometry, Mesh, MeshBasicMaterial, Matrix4, Quaternion, Vector3, type InstancedMesh, type Object3D } from 'three'
import { landing as streamLanding, type Plant } from './water'
import { Drips, PARTICLE_CAP, dripTips, Stream, Sway, Wetness, lastDropTimes, type FxLevel } from './waterFx'

/** how many leaf tips the model gives each plant (office_bake.py: <plant>_tip_0..2) */
const TIPS = 3
/** the height of each pot's foot, where the plant sways about (the floor, or the sansevieria's stand) */
const BASE_Y: Record<string, number> = { plant_corner: 0.02, plant_sofa: 0.02, plant_desk: 0.28 }
const DROP_GEO_R = 0.003
/** the stream's landing point must be inside this share of the soil's radius for water to run (the rose's spread and the drops' speed spread take the rest) */
const STREAM_SOIL_SHARE = 0.85

export const isMobileish = () => typeof matchMedia === 'function' && typeof innerWidth === 'number' && (matchMedia('(pointer: coarse)').matches || innerWidth < 700)

export interface PourNow {
  plant: Plant
  /** the rose's centre and the stream's direction this frame */
  tip: Vector3
  dir: Vector3
  /** 0 … 1 (waterFx.flowAt) and the time into the pour, s */
  flow: number
  u: number
  /** the shake's two last drops use this to know how many turns it has */
  shakes: number
}

interface Swaying {
  nodes: Object3D[]
  sway: Sway
  /** the horizontal axis the plant swings about, and what it was last set to */
  axis: Vector3
  angle: number
  tips: Object3D[]
  base: Vector3
}

export class WaterScene {
  readonly stream: Stream
  readonly wet = new Wetness()
  readonly drips = new Drips()
  private dripPlant: string | null = null
  private dripTriggers = 0
  private swing = new Map<string, Swaying>()
  private discs = new Map<string, Mesh>()
  private last: Plant | null = null
  private prevU = -1
  private hitHold = 0
  private dripFired = false
  private dripIdx: number[] = []
  private cap: number
  private m = new Matrix4()
  private q = new Quaternion()
  private v = new Vector3()
  private sv = new Vector3()
  /** how many instances the last frame drew (the stage's tap writes the same mesh when the can is quiet) */
  drawn = 0

  constructor(
    scene: Object3D,
    private mesh: InstancedMesh,
    private plantList: Plant[],
    mobile = isMobileish(),
  ) {
    this.cap = mobile ? PARTICLE_CAP.mobile : PARTICLE_CAP.desktop
    // the drips take up to TIPS of the cap: the mesh never draws more than `cap` instances
    this.stream = new Stream(this.cap - TIPS, 7)
    for (const p of plantList) {
      const disc = new Mesh(new CircleGeometry(1, 24), new MeshBasicMaterial({ color: '#150d07', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
      disc.rotation.x = -Math.PI / 2
      disc.position.set(p.x, p.soilY + 0.001, p.z) // the soil's surface + 1 mm
      disc.scale.set(p.r * 0.95, p.r * 0.95, 1) // inside the soil disc, which is inside the pot's rim
      disc.visible = false
      disc.renderOrder = 2
      disc.name = 'wet_' + p.name
      scene.add(disc)
      this.discs.set(p.name, disc)
      const tips = Array.from({ length: TIPS }, (_, k) => scene.getObjectByName(`${p.name}_tip_${k}`)).filter((o): o is Object3D => !!o)
      const nodes = [p.name, p.name + '_veins'].map((n) => scene.getObjectByName(n)).filter((o): o is Object3D => !!o)
      // only the plants the model gives leaf tips sway (the hanging planters' pivot is the ceiling hook, not their foot)
      if (tips.length && nodes.length && BASE_Y[p.name] !== undefined) this.swing.set(p.name, { nodes, sway: new Sway(), axis: new Vector3(1, 0, 0), angle: 0, tips, base: new Vector3(p.x, BASE_Y[p.name], p.z) })
    }
  }

  /** something is still moving (drops falling, a plant swaying, the soil not yet dry): the tap does not take the mesh meanwhile */
  get busy() {
    return this.stream.n > 0 || this.drips.active
  }

  /** the soil's wetness 0 … 1 */
  wetness(plant: string) {
    return this.wet.get(plant)
  }

  /** the tip `k` of a swaying plant in the world now (with the sway on it) */
  tipOf(plant: string, k: number, out = new Vector3()) {
    const s = this.swing.get(plant)
    const t = s?.tips[k]
    if (!s || !t) return null
    t.getWorldPosition(out)
    return this.swung(s, out)
  }
  private swung(s: Swaying, p: Vector3) {
    if (s.angle === 0) return p
    this.q.setFromAxisAngle(s.axis, s.angle)
    return p.sub(s.base).applyQuaternion(this.q).add(s.base)
  }

  /**
   * One frame: `dt` s of the office clock, the pour (or null: the can is not pouring), what the speed and reduced motion keep. Runs the stream, the soil,
   * the sway and the drips, and writes the mesh. Returns how many instances it drew.
   */
  frame(dt: number, pour: PourNow | null, level: FxLevel): number {
    dt = Math.min(Math.max(dt, 0), 0.5)
    if (pour) this.last = pour.plant
    const plant = pour?.plant ?? this.last
    // water only runs while it would land on the soil: the tail of the taper, when the spout lifts, and the spill do not throw it outside the pot
    let flow = pour?.flow ?? 0
    if (pour && flow > 0) {
      const l = streamLanding(pour.tip, pour.dir, pour.plant.soilY)
      if (!l || Math.hypot(l.at.x - pour.plant.x, l.at.z - pour.plant.z) > STREAM_SOIL_SHARE * pour.plant.r) flow = 0
    }
    if (!level.particles) this.stream.clear()
    let landed = 0
    if (plant && level.particles) {
      const soil = { x: plant.x, z: plant.z, y: plant.soilY, r: plant.r }
      const n = Math.max(1, Math.ceil(dt / 0.05))
      for (let k = 0; k < n; k++) {
        landed += this.stream.step(dt / n, pour && flow > 0 ? { tip: pour.tip, dir: pour.dir, flow } : null, soil)
        // the last two drops of the shake leave the rose and just fall
        if (k === n - 1 && pour && this.prevU >= 0) {
          for (const t of lastDropTimes(pour.plant.name)) if (this.prevU < t && pour.u >= t) this.stream.drop(pour.tip, { x: 0, y: -0.01, z: 0 })
        }
      }
    }
    if (pour) this.prevU = pour.u
    else {
      this.prevU = -1
      this.dripFired = false
    }
    // the soil: wet while the stream lands (without particles: while there is a flow)
    if (landed > 0) this.hitHold = 0.3
    else this.hitHold = Math.max(0, this.hitHold - dt)
    const landing = level.particles ? this.hitHold > 0 : flow > 0
    if (plant) {
      this.wet.step(plant.name, dt, landing, level.instantSoil)
      // leaf drips begin where the water starts to hit, once per watering (the water pausing and starting again does not start them again)
      if (landing && !this.dripFired && level.drips && this.swing.has(plant.name)) {
        this.dripFired = true
        // only a tip whose drop would fall inside the soil disc forms a drip
        const tips = [0, 1, 2].map((k) => this.tipOf(plant.name, k))
        const ok = dripTips(tips.map((t) => t ?? { x: 1e3, z: 1e3 }), plant)
        this.dripIdx = ok.slice(0, 2 + (this.dripTriggers++ % 2))
        if (this.dripIdx.length) {
          this.dripPlant = plant.name
          this.drips.trigger(this.dripIdx.length)
        }
      }
      this.swayStep(plant, dt, landing && level.sway ? flow : 0, pour)
    }
    for (const name of this.wet.active()) {
      if (name !== plant?.name) this.wet.step(name, dt, false)
      const d = this.discs.get(name)
      const mat = d?.material as MeshBasicMaterial | undefined
      if (d && mat) {
        mat.opacity = this.wet.opacity(name)
        d.visible = mat.opacity > 0.004
      }
    }
    if (plant) {
      const d = this.discs.get(plant.name)
      const mat = d?.material as MeshBasicMaterial | undefined
      if (d && mat) {
        mat.opacity = this.wet.opacity(plant.name)
        d.visible = mat.opacity > 0.004
      }
    }
    // the plants that have stopped swaying go back to rest
    for (const [name, s] of this.swing) if (name !== plant?.name && s.sway.amp > 0) this.swayStep(null, dt, 0, null, s)
    if (this.drips.active && this.dripPlant) this.dripStep(dt)
    return this.write(level)
  }

  private swayStep(plant: Plant | null, dt: number, flow: number, pour: PourNow | null, only?: Swaying) {
    const s = only ?? (plant ? this.swing.get(plant.name) : undefined)
    if (!s) return
    if (pour && flow > 0) {
      // the plant swings toward and away from whoever pours: the axis is the horizontal one across that line
      const dx = s.base.x - pour.tip.x
      const dz = s.base.z - pour.tip.z
      const l = Math.hypot(dx, dz) || 1
      s.axis.set(-dz / l, 0, dx / l)
    }
    const a = s.sway.step(dt, flow)
    if (a === 0 && s.angle === 0) return
    s.angle = s.sway.amp === 0 ? 0 : a
    this.q.setFromAxisAngle(s.axis, s.angle)
    for (const n of s.nodes) {
      // x' = pivot + R (x − pivot): the node's vertices are in world space, its origin at 0
      n.quaternion.copy(this.q)
      n.position.copy(s.base).sub(this.v.copy(s.base).applyQuaternion(this.q))
      n.updateMatrixWorld(true)
    }
  }

  private dripStep(dt: number) {
    const name = this.dripPlant!
    const p = this.v
    this.drips.step(dt, (k) => {
      const t = this.tipOf(name, this.dripIdx[k], p)
      return t ? Math.max(0.05, t.y - (this.landY(name, t.x, t.z))) : 0.3
    })
  }
  private landY(name: string, x: number, z: number) {
    const p = this.plantList.find((q) => q.name === name)
    if (p && Math.hypot(x - p.x, z - p.z) < p.r) return p.soilY
    return BASE_Y[name] ?? 0
  }

  private write(level: FxLevel): number {
    const mesh = this.mesh
    let n = 0
    const pos = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < this.stream.n; i++) {
      this.stream.position(i, pos)
      const s = this.stream.rad[i] / DROP_GEO_R
      this.m.compose(this.v.set(pos.x, pos.y, pos.z), this.q.identity(), this.sv.set(s, s, s))
      mesh.setMatrixAt(n++, this.m)
    }
    if (level.drips && this.dripPlant && this.drips.active) {
      const name = this.dripPlant
      const tip = new Vector3()
      for (let k = 0; k < this.drips.drips.length && n < this.cap; k++) {
        const r = this.drips.size(k)
        if (r <= 0 || !this.tipOf(name, this.dripIdx[k], tip)) continue
        const s = r / DROP_GEO_R
        this.m.compose(this.v.set(tip.x, tip.y - this.drips.below(k), tip.z), this.q.identity(), this.sv.set(s, s, s))
        mesh.setMatrixAt(n++, this.m)
      }
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = n > 0 || this.drawn > 0
    this.drawn = n
    return n
  }
}
