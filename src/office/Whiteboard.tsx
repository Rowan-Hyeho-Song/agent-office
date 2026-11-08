import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Object3D } from 'three'
import { boardColors, drawBoard, font } from '../board/draw'
import { BH, BW, FS_L, FS_S, layoutBoard, type BoardLayout, type CardLayout, type Measure } from '../board/layout'
import type { BoardState } from '../board/state'
import { openDocs } from './docs/panel'
import { useCanvasPick } from './pick'
import type { OfficeWorld } from './world'

/** a new card fades in over this long (docs-ui 3.4) */
const FADE_S = 0.3
/** the baked board is lit already: a little under full so the card paper does not look emissive (docs-ui 3.4) */
const BRIGHTNESS = 0.92
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The whiteboard kanban (#66): a transparent 1536 x 1024 canvas on `surface_whiteboard`, so the baked board shows
 * through. The canvas is painted only when the data changes (and for the 0.3 s a new card fades in), never per frame.
 * A click on a card opens its binder in the library viewer; the click targets are one invisible plane per card.
 */
export function Whiteboard({ world, scene }: { world: OfficeWorld; scene: Object3D }) {
  const store = world.board
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const surface = useMemo(() => scene.getObjectByName('surface_whiteboard') ?? null, [scene])
  // built in an effect (not a memo): StrictMode would otherwise leave a second plane on the surface
  const [rig, setRig] = useState<BoardRig | null>(null)
  useEffect(() => {
    if (!surface) return
    const r = new BoardRig(surface, () => void store.draws++)
    setRig(r)
    return () => {
      r.dispose()
      setRig(null)
    }
  }, [surface, store])
  useEffect(() => rig?.show(state), [rig, state])
  // the pixel font arrives late: measure and paint again once it is in
  useEffect(() => {
    let alive = true
    void Promise.all([document.fonts?.load(font(FS_L, true)), document.fonts?.load(font(FS_S))]).then(() => alive && rig?.show(store.getSnapshot(), true))
    return () => void (alive = false)
  }, [rig, store])
  useFrame((_, dt) => rig?.tick(dt))
  useCanvasPick(
    () => rig?.targets ?? [],
    (hits) => {
      const card = hits.map((h) => h.object.userData.card as CardLayout | undefined).find(Boolean)
      if (card) openDocs({ repo: card.card.repo, n: card.card.n })
    },
  )
  return null
}

class BoardRig {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private texture = new CanvasTexture(this.canvas)
  private material = new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, color: new Color(BRIGHTNESS, BRIGHTNESS, BRIGHTNESS) })
  private group = new Group()
  private plane: Mesh
  private layout: BoardLayout | null = null
  private colors = boardColors()
  /** keys drawn at least once, and the ones still fading (key -> seconds so far) */
  private seen: Set<string> | null = null
  private fading = new Map<string, number>()
  /** one invisible plane per card, children of the group */
  targets: Mesh[] = []

  constructor(
    private surface: Object3D,
    private onDraw: () => void,
  ) {
    this.canvas.width = BW
    this.canvas.height = BH
    this.texture.colorSpace = SRGBColorSpace
    this.texture.anisotropy = 8
    const { w = 1.5, h = 1 } = surface.userData as { w?: number; h?: number }
    this.plane = new Mesh(new PlaneGeometry(w, h), this.material)
    this.plane.raycast = () => {} // clicks go to the per-card planes only
    this.plane.position.z = 0.001 // 1 mm in front of the board (the empty already sits on the face)
    this.group.add(this.plane)
    surface.add(this.group)
  }

  private measure: Measure = (text, size, bold) => {
    this.ctx.font = font(size, bold)
    return this.ctx.measureText(text).width
  }

  show(state: BoardState, refont = false) {
    this.layout = layoutBoard(state, this.measure)
    const keys = [...this.layout.columns.flatMap((c) => c.cards.map((k) => k.card.key + ':' + c.column)), ...this.layout.notes.map((n) => n.decision.key)]
    if (this.seen && !refont && !reduced()) for (const k of keys) if (!this.seen.has(k)) this.fading.set(k, 0)
    this.seen = new Set(keys)
    this.paint()
    this.rebuildTargets()
  }

  tick(dt: number) {
    if (!this.fading.size) return
    for (const [k, t] of this.fading) {
      if (t + dt >= FADE_S) this.fading.delete(k)
      else this.fading.set(k, t + dt)
    }
    this.paint()
  }

  private paint() {
    if (!this.layout) return
    const fadeOf = (k: string) => this.fading.get(k)
    drawBoard(this.ctx, this.layout, {
      colors: this.colors,
      alpha: (key) => {
        const t = fadeOf(key) ?? this.fading.get(this.columnKey(key))
        return t === undefined ? 1 : Math.min(1, t / FADE_S)
      },
    })
    this.texture.needsUpdate = true
    this.onDraw()
  }

  /** a card's fade key is `repo#n:column` so a card that changes column fades in again */
  private columnKey(key: string) {
    const col = this.layout?.columns.find((c) => c.cards.some((k) => k.card.key === key))
    return col ? `${key}:${col.column}` : key
  }

  private rebuildTargets() {
    for (const m of this.targets) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    const { width: w, height: h } = (this.plane.geometry as PlaneGeometry).parameters
    const hidden = new MeshBasicMaterial({ visible: false })
    this.targets = (this.layout?.columns ?? []).flatMap((c) =>
      c.cards.map((k) => {
        const m = new Mesh(new PlaneGeometry((k.w / BW) * w, (k.h / BH) * h), hidden)
        m.position.set(((k.x + k.w / 2) / BW - 0.5) * w, (0.5 - (k.y + k.h / 2) / BH) * h, 0.002)
        m.userData.card = k
        this.group.add(m)
        return m
      }),
    )
    this.group.updateMatrixWorld(true)
  }

  dispose() {
    this.surface.remove(this.group)
    this.texture.dispose()
    this.material.dispose()
    this.plane.geometry.dispose()
    for (const m of this.targets) m.geometry.dispose()
  }
}
