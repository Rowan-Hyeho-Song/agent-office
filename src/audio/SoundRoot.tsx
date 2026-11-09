import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Frustum, Matrix4, Vector3 } from 'three'
import { kstMinutes } from '../office/kst'
import { officeNow, type OfficeWorld } from '../office/world'
import { replay } from '../replay/store'
import { ROOM_MODE, onDeskAudio, onEntered, onLeaveStart, postToParent } from '../room/link'
import { setAmbienceMinute, startAmbience } from './ambience'
import { cue, setCueSpeed } from './cues'
import { audioGraph, ensureAudio, fadeRoom, setListener } from './engine'
import { getSetting, setSetting, subscribe } from './settings'
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
      const { keys, next } = keysBetween(typing.current.get(id) ?? null, t)
      typing.current.set(id, next)
      // the keyboard is in front of and below the head (agents.md 2.1: hands at 0.80 m, 0.32 m ahead)
      for (const k of keys) cue('type', { pos: { x: head.x, y: head.y - 0.35, z: head.z }, agent: id, at: Math.max(0, k - t) })
    }
  })
  return null
}
