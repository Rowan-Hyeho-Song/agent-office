// #4 office-ui.md 12.3: the visitors' notes as sticky notes on the cork board (`surface_bulletin`, 0.8 × 0.9 m on the north wall,
// right of the whiteboard): the latest twelve, three across and four down, each with a pin of the colour of the robot it is
// for. A canvas on a plane 1 mm in front of the board, painted when the notes change and while a new one flutters in (0.4 s:
// it swings in on its pin), with the note.pin cue where it lands (#438). The words are the visitor's: only here, never in a
// bubble or the log. Reading them close (a press on the board) is the next step of #4.

import { useFrame } from '@react-three/fiber'
import { useCanvasPick } from '../pick'
import { getBoardView, openBoard } from '../boardView/store'
import { canOpen } from '../boardView/view'
import { useCameraBusy } from '../../room/Door'
import { replay } from '../../replay/store'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { CanvasTexture, Color, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D } from 'three'
import { cue } from '../../audio/cues'
import { NOTE_ANON, type Note } from '../../visit/note'
import { supabase } from '../supabase'
import { AGENT_COLORS, prefersReducedMotion, type OfficeWorld } from '../world'
import { listenNotes, notesStore, pinLocal, settled } from './notes'
import { noteSlot, paperOf, wrap } from './bulletinLayout'

/** canvas px per metre: 1 px = 1 mm */
const PX = 1000
const FLUTTER_MS = 400
const FONT = (size: number, bold = false) => `${bold ? '700 ' : ''}${size}px Galmuri11, ui-monospace, monospace`

/** a note's lean on the board, the same every time (±4°) */
const leanOf = (id: number) => (((id * 2654435761) >>> 0) % 81) / 10 - 4

export function Bulletin({ world, scene }: { world: OfficeWorld; scene: Object3D }) {
  const surface = useMemo(() => scene.getObjectByName('surface_bulletin') ?? null, [scene])
  const board = useSyncExternalStore(notesStore.subscribe, notesStore.getSnapshot)
  const [rig, setRig] = useState<BulletinRig | null>(null)
  useEffect(() => {
    if (!surface) return
    const r = new BulletinRig(surface)
    setRig(r)
    return () => {
      r.dispose()
      setRig(null)
    }
  }, [surface])
  useEffect(() => (supabase ? listenNotes(supabase) : undefined), [])
  useEffect(() => {
    if (!rig) return
    rig.show(board.notes, board.fresh)
  }, [rig, board])
  // the pixel font arrives late: paint again once it is in
  useEffect(() => {
    let alive = true
    void document.fonts?.load(FONT(24)).then(() => alive && rig?.show(notesStore.getSnapshot().notes, [], true))
    return () => void (alive = false)
  }, [rig])
  useEffect(() => {
    if (!world.debug) return
    ;(window as unknown as { __notes: unknown }).__notes = {
      /** pin a note on this screen only: __notes.pin('agent_2', '색이 예뻐요', '팬') */
      pin: (agent: string, text: string, name = '') => pinLocal({ id: Date.now(), agent, text, name, created_at: new Date().toISOString() }),
    }
  }, [world])
  useFrame(() => rig?.tick())
  // a press on the board flies the camera to it and lays the notes over it, like the whiteboard (#234); a phone gets the sheet
  const busy = useCameraBusy()
  const may = () => canOpen({ replayOn: replay.getSnapshot().mode !== 'off', cameraBusy: busy, phase: getBoardView().phase })
  useCanvasPick(
    () => (may() && rig ? [rig.face] : []),
    () => may() && openBoard({ mode: matchMedia('(max-width: 640px)').matches ? 'sheet' : 'stage', surface: 'bulletin' }),
  )
  return null
}

class BulletinRig {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private texture = new CanvasTexture(this.canvas)
  private plane: Mesh
  private notes: Note[] = []
  /** the notes fluttering in: id → start (performance.now) */
  private flutter = new Map<number, number>()
  private w: number
  private h: number
  /** an invisible plane over the face: what a press hits */
  face: Mesh

  constructor(private surface: Object3D) {
    const { w = 0.8, h = 0.9 } = surface.userData as { w?: number; h?: number }
    this.w = w
    this.h = h
    this.canvas.width = Math.round(w * PX)
    this.canvas.height = Math.round(h * PX)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.anisotropy = 8
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, color: new Color(0.92, 0.92, 0.92) })
    this.plane = new Mesh(new PlaneGeometry(w, h), material)
    this.plane.raycast = () => {}
    this.plane.position.z = 0.001
    surface.add(this.plane)
    this.face = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ visible: false }))
    this.face.position.z = 0.0015
    surface.add(this.face)
    this.plane.updateMatrixWorld(true)
    this.face.updateMatrixWorld(true)
  }

  show(notes: Note[], fresh: number[], refont = false) {
    this.notes = notes
    const reduced = prefersReducedMotion()
    for (const id of fresh)
      if (!this.flutter.has(id)) {
        this.flutter.set(id, performance.now())
        // the cue where it is pinned (sound.md: note.pin, the tack 0.38 s in is part of the sound)
        const k = notes.findIndex((n) => n.id === id)
        if (k >= 0) cue('note.pin', { pos: this.worldOf(k), key: `note:${id}` })
        if (reduced) settled(id)
      }
    if (refont || !this.flutter.size || reduced) this.paint()
  }

  tick() {
    if (!this.flutter.size) return
    const now = performance.now()
    for (const [id, t0] of this.flutter) if (now - t0 >= FLUTTER_MS || prefersReducedMotion()) {
      this.flutter.delete(id)
      settled(id)
    }
    this.paint(now)
  }

  /** the world point of the k-th note's centre (for its cue) */
  private worldOf(k: number) {
    const s = noteSlot(k, this.canvas.width, this.canvas.height)
    const local = new Vector3((s.x + s.w / 2) / PX - this.w / 2, this.h / 2 - (s.y + s.h / 2) / PX, 0.002)
    const p = this.surface.localToWorld(local)
    return { x: p.x, y: p.y, z: p.z }
  }

  private paint(now = performance.now()) {
    const g = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    g.clearRect(0, 0, W, H)
    this.notes.forEach((note, k) => {
      const s = noteSlot(k, W, H)
      const t0 = this.flutter.get(note.id)
      // fluttering in: swings on its pin from 14° and settles, a little lifted off the board
      const u = t0 === undefined ? 1 : Math.min(1, (now - t0) / FLUTTER_MS)
      const swing = t0 === undefined ? 0 : 14 * (1 - u) * Math.cos(u * Math.PI * 2.5)
      const ang = ((leanOf(note.id) + swing) * Math.PI) / 180
      g.save()
      g.translate(s.x + s.w / 2, s.y + 10)
      g.rotate(ang)
      // shadow, paper
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(-s.w / 2 + 5, 7, s.w, s.h)
      g.fillStyle = paperOf(note.id)
      g.fillRect(-s.w / 2, 0, s.w, s.h)
      g.fillStyle = 'rgba(0,0,0,0.06)'
      g.fillRect(-s.w / 2, s.h - 18, s.w, 18)
      // the words: up to three lines, then … (a fourth would touch the name line)
      g.fillStyle = '#2a2418'
      g.font = FONT(24)
      g.textBaseline = 'top'
      const lines = wrap(g, note.text, s.w - 28, 3)
      lines.forEach((l, i) => g.fillText(l, -s.w / 2 + 14, 28 + i * 32))
      g.font = FONT(18)
      g.fillStyle = '#6b5f45'
      // the name in one line, cut at the paper's width with … (a 20-character name ran off the note)
      g.fillText(wrap(g, `— ${note.name || NOTE_ANON}`, s.w - 28, 1)[0] ?? '', -s.w / 2 + 14, s.h - 44)
      // the pin, the robot's colour
      g.beginPath()
      g.arc(0, 4, 11, 0, Math.PI * 2)
      g.fillStyle = AGENT_COLORS[note.agent] ?? '#cccccc'
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = 'rgba(0,0,0,0.45)'
      g.stroke()
      g.restore()
    })
    this.texture.needsUpdate = true
  }

  dispose() {
    this.plane.removeFromParent()
    this.face.removeFromParent()
    this.face.geometry.dispose()
    ;(this.face.material as MeshBasicMaterial).dispose()
    this.plane.geometry.dispose()
    ;(this.plane.material as MeshBasicMaterial).dispose()
    this.texture.dispose()
  }
}

