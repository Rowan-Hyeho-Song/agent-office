import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Frustum, Matrix4, Vector3 } from 'three'
import { isNight, kstMinutes } from '../office/kst'
import { officeNow, type OfficeWorld } from '../office/world'
import { replay } from '../replay/store'
import { ROOM_MODE, onDeskAudio, onEntered, onLeaveStart, postToParent } from '../room/link'
import { setAmbienceMinute, startAmbience } from './ambience'
import { cue, setCueSpeed } from './cues'
import { audioGraph, ensureAudio, fadeRoom, setListener } from './engine'
import { getSetting, setSetting, subscribe } from './settings'
import { speakerFrame } from './speaker'
import { keysBetween, type TypeState } from './typing'

// Wires the office's sound to the page (docs/design/sound.md 2): the first gesture, the room door, the desk's
// setting, the clock for the room tone, and the replay speed. Renders nothing.

/** room crossfade (sound.md 2.3): in over 1.2 s after `entered`, out over 0.6 s when leaving starts */
const IN_S = 1.2
const OUT_S = 0.6

function wake() {
  if (getSetting().muted) return
  if (!ensureAudio()) return
  startAmbience()
}

export function SoundRoot({ world }: { world: OfficeWorld }) {
  useEffect(() => {
    // the first gesture (standalone: the HUD button is one too); not before, so headless smoke sees no context
    const onGesture = () => wake()
    window.addEventListener('pointerdown', onGesture, { capture: true })
    window.addEventListener('keydown', onGesture, { capture: true })

    // turning sound on (a click, so a gesture) or the desk saying so: start; local changes go back to the desk
    const offSetting = subscribe((s, from) => {
      if (!s.muted) wake()
      if (from === 'local') postToParent({ type: 'audio', room: 'office', muted: s.muted, volume: s.volume })
    })

    const offs: (() => void)[] = []
    if (ROOM_MODE) {
      offs.push(onDeskAudio((a) => setSetting(a, 'desk')))
      offs.push(
        onEntered(() => {
          // the visitor clicked in the desk page; the iframe has allow="autoplay", so this may start
          wake()
          fadeRoom(0, 0)
          fadeRoom(1, IN_S)
        }),
      )
      offs.push(onLeaveStart(() => fadeRoom(0, OUT_S)))
    }

    // the room tone follows the window's clock (?debug=1&kst=02:00 moves it too)
    const clock = () => setAmbienceMinute(kstMinutes(officeNow(world)))
    clock()
    const timer = window.setInterval(clock, 2000)

    // the timelapse: busywork thins at ×4 and stops at ×16 (sound.md 6)
    const onReplay = () => {
      const r = replay.getSnapshot()
      setCueSpeed(r.mode !== 'off' && r.playing ? r.speed : 1)
    }
    onReplay()
    const offReplay = replay.subscribe(onReplay)

    return () => {
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('keydown', onGesture, { capture: true })
      offSetting()
      offs.forEach((f) => f())
      window.clearInterval(timer)
      offReplay()
    }
  }, [world])
  return null
}

const fwd = new Vector3()
const up = new Vector3()

const BREAKS = new Set<string>(['pingpong', 'boardgame', 'coffee', 'sofa', 'water', 'books'])
/** on a break (walking to one too): the rig's `resting` (#193 2/2, coder) once it has it, else what it is doing there */
const isResting = (r: OfficeWorld['rigs'][string]) => {
  const own = (r as unknown as { resting?: boolean }).resting
  return typeof own === 'boolean' ? own : BREAKS.has(r.doing ?? '')
}

const frustum = new Frustum()
const viewProj = new Matrix4()
const head = new Vector3()

/**
 * inside the canvas: the listener is the camera, and the typing sound (#194 ②): agents at their desk, typing, on
 * screen (busywork off-camera stays silent, sound.md 6), with the ambient motion on (off at the timelapse's ×16)
 */
export function SoundListener({ world }: { world: OfficeWorld }) {
  const typing = useRef(new Map<string, TypeState | null>())
  useFrame(({ camera }) => {
    camera.getWorldDirection(fwd)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    setListener(camera.position, fwd, up)

    // ③ the speaker music follows the agents: two or more on a break = break music, a rally dips it, night = off
    let resting = 0
    let playing = false
    for (const id in world.rigs) {
      const r = world.rigs[id]
      if (!r.visible) continue
      if (isResting(r)) resting++
      if (r.doing === 'pingpong') playing = true
    }
    const ms = officeNow(world)
    speakerFrame(resting, playing, isNight(ms), ms / 1000)

    const g = audioGraph()
    if (!g || g.ctx.state !== 'running' || getSetting().muted) return
    const t = g.ctx.currentTime
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(viewProj)
    for (const id in world.rigs) {
      const r = world.rigs[id]
      r.parts.head.getWorldPosition(head)
      const on = r.visible && r.ambient > 0 && r.doing === 'type' && frustum.containsPoint(head)
      if (!on) {
        typing.current.set(id, null)
        continue
      }
      const { keys, kinds, next } = keysBetween(typing.current.get(id) ?? null, t)
      typing.current.set(id, next)
      // the keyboard is in front of and below the head (agents.md 2.1: hands at 0.80 m, 0.32 m ahead)
      keys.forEach((k, i) => cue('type', { pos: { x: head.x, y: head.y - 0.35, z: head.z }, agent: id, at: Math.max(0, k - t), keyKind: kinds[i] }))
    }
  })
  return null
}
