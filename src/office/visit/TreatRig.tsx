// #4 office-ui.md 12.2 on screen: a snack or a cheer flies from the visitor's place (the bottom middle of the screen) to the
// robot in a 0.6 s arc, then the robot takes it as its mood says (reaction.ts): a face, a '방문자' bubble, the snack resting
// in the hand / on the desk / on the floor for a while before it fades, hearts over the head for a cheer. The sound cues
// (#438) at the arrival. The same on every screen: the sender's at once, the others' when the server shares them.
// A DOM layer over the canvas (aria-hidden: the robot's bubble goes to the log as usual); the robots are followed per frame.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { cue } from '../../audio/cues'
import { supabase } from '../supabase'
import { prefersReducedMotion, type OfficeWorld } from '../world'
import { CHEER_ICON, moodOf, reactionOf, SNACK_ICON, type Reaction } from './reaction'
import { listenTreats, onTreat, type Treat } from './treats'

export const FLY_MS = 600
const FADE_MS = 400
const REST_MS: Record<NonNullable<Reaction['rest']>, number> = { hand: 2500, desk: 6000, floor: 8000 }

interface Flight {
  treat: Treat
  el: HTMLElement
  start: number | null
  arrived: number | null
  reaction: Reaction | null
  hearts: HTMLElement[]
  /** where the snack rests (world), fixed at the arrival for desk / floor */
  restAt: Vector3 | null
}

const box = new Box3()
const v = new Vector3()

export function TreatRig({ world }: { world: OfficeWorld }) {
  const { camera, gl } = useThree()
  const root = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'treat-layer'
    el.setAttribute('aria-hidden', 'true')
    return el
  }, [])
  const flights = useRef<Flight[]>([])
  useEffect(() => {
    document.body.appendChild(root)
    return () => root.remove()
  }, [root])
  useEffect(
    () =>
      onTreat((treat) => {
        const el = document.createElement('span')
        el.className = `treat-icon treat-${treat.kind}`
        el.textContent = treat.kind === 'cheer' ? CHEER_ICON : SNACK_ICON[treat.kind]
        root.appendChild(el)
        flights.current.push({ treat, el, start: null, arrived: null, reaction: null, hearts: [], restAt: null })
      }),
    [root],
  )
  useEffect(() => (supabase ? listenTreats(supabase) : undefined), [])

  useFrame((state) => {
    if (!flights.current.length) return
    const now = performance.now()
    const t = state.clock.elapsedTime
    const reduced = prefersReducedMotion()
    const rect = gl.domElement.getBoundingClientRect()
    const toScreen = (p: Vector3) => {
      v.copy(p).project(camera)
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, on: v.z < 1 }
    }
    const place = (el: HTMLElement, x: number, y: number, opacity = 1, scale = 1) => {
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`
      el.style.opacity = String(opacity)
    }
    flights.current = flights.current.filter((f) => {
      const rig = world.rigs[f.treat.agent]
      if (!rig) {
        f.el.remove()
        f.hearts.forEach((h) => h.remove())
        return false
      }
      box.setFromObject(rig.group)
      const head = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)
      const hand = head.clone().setY(box.min.y + (box.max.y - box.min.y) * 0.45)
      f.start ??= now
      // the flight: a 0.6 s arc from the visitor's place (reduced motion: it appears at the robot)
      if (f.arrived === null) {
        const target = toScreen(f.treat.kind === 'cheer' ? head : hand)
        const u = reduced ? 1 : Math.min(1, (now - f.start) / FLY_MS)
        const from = { x: rect.left + rect.width / 2, y: rect.bottom - 48 }
        const ctrl = { x: (from.x + target.x) / 2, y: Math.min(from.y, target.y) - 140 }
        const a = 1 - u
        place(f.el, a * a * from.x + 2 * a * u * ctrl.x + u * u * target.x, a * a * from.y + 2 * a * u * ctrl.y + u * u * target.y, reduced ? Math.min(1, (now - f.start) / 120) : 1, 0.8 + 0.2 * u)
        if (u < 1 || (reduced && now - f.start < 120)) return true
        f.arrived = now
        arrive(f, rig, head, hand, t)
      }
      return rest(f, rig, head, hand, now, reduced, toScreen, place)
    })
  })

  /** the arrival: the robot takes it as its mood says, the cue sounds where it lands */
  function arrive(f: Flight, rig: OfficeWorld['rigs'][string], head: Vector3, hand: Vector3, t: number) {
    const id = f.treat.agent
    const status = world.director.getShown()[id]?.status ?? world.source.getSnapshot()[id]
    const r = reactionOf(f.treat.kind, moodOf(status, world.goals[id]?.pose), rig.faceTalk.speaking)
    f.reaction = r
    if (r.face) rig.faceEvent(r.face.expr, t, r.face.ms / 1000)
    if (r.line) world.bubbles.say(id, { kind: 'react', text: r.line, ms: 2500, tag: '방문자' })
    const key = f.treat.id
    if (f.treat.kind === 'cheer') {
      cue('cheer', { pos: { x: head.x, y: head.y + 0.15, z: head.z }, key, agent: id })
      f.el.remove()
      for (let i = 0; i < r.hearts; i++) {
        const h = document.createElement('span')
        h.className = 'treat-heart'
        h.textContent = '♥'
        root.appendChild(h)
        f.hearts.push(h)
      }
      return
    }
    // where the snack rests: in the hand (follows the robot), or put down in front of it (desk) / beside it (floor)
    const fwd = new Vector3(Math.sin(rig.heading), 0, Math.cos(rig.heading))
    if (r.rest === 'desk') f.restAt = new Vector3(rig.x, 0.8, rig.z).addScaledVector(fwd, 0.35)
    if (r.rest === 'floor') f.restAt = new Vector3(rig.x, 0.05, rig.z).addScaledVector(fwd, -0.6)
    const at = f.restAt ?? hand
    cue('treat.arrive', { pos: { x: at.x, y: at.y, z: at.z }, key, agent: id })
  }

  /** after the arrival: the snack stays, then fades; the hearts rise (one stays a second when the robot sleeps) */
  function rest(
    f: Flight,
    _rig: OfficeWorld['rigs'][string],
    head: Vector3,
    hand: Vector3,
    now: number,
    reduced: boolean,
    toScreen: (p: Vector3) => { x: number; y: number; on: boolean },
    place: (el: HTMLElement, x: number, y: number, opacity?: number, scale?: number) => void,
  ): boolean {
    const r = f.reaction!
    const since = now - f.arrived!
    if (f.treat.kind === 'cheer') {
      const life = r.hearts === 1 ? 1000 : 1200
      const p = toScreen(head)
      f.hearts.forEach((h, i) => {
        const k = Math.min(1, since / life)
        const rise = reduced ? 0 : 46 * k
        place(h, p.x + (i - (f.hearts.length - 1) / 2) * 14, p.y - 18 - rise - i * 6, 1 - Math.max(0, (k - 0.7) / 0.3))
      })
      if (since < life) return true
      f.hearts.forEach((h) => h.remove())
      return false
    }
    const stay = REST_MS[r.rest ?? 'hand']
    const p = toScreen(f.restAt ?? hand)
    const o = since < stay ? 1 : 1 - (since - stay) / FADE_MS
    place(f.el, p.x, p.y, Math.max(0, p.on ? o : 0), 0.9)
    if (o > 0) return true
    f.el.remove()
    return false
  }

  return null
}
