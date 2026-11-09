import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Frustum, Matrix4, Vector3 } from 'three'
import { isNight, kstMinutes } from '../office/kst'
import { officeNow, type OfficeWorld } from '../office/world'
import { replay } from '../replay/store'
import { ROOM_MODE, onDeskAudio, onEntered, onLeaveStart, postToParent } from '../room/link'
import { setAmbienceMinute, startAmbience } from './ambience'
import { onInput, type InputEvent } from '../office/inputEvents'
import { cue, getCueSpeed, setCueSpeed } from './cues'
import { inputCues } from './inputSound'
import { audioGraph, ensureAudio, fadeRoom, setListener } from './engine'
import { loadKeySample } from './keys'
import { getSetting, setSetting, subscribe } from './settings'
import { speakerFrame } from './speaker'
// Wires the office's sound to the page (docs/design/sound.md 2): the first gesture, the room door, the desk's
// setting, the clock for the room tone, and the replay speed. Renders nothing.

/** room crossfade (sound.md 2.3): in over 1.2 s after `entered`, out over 0.6 s when leaving starts */
const IN_S = 1.2
const OUT_S = 0.6

function wake() {
  if (getSetting().muted) return
  const g = ensureAudio()
  if (!g) return
  startAmbience()
  // the key sound is a recording (#194): fetch it now so the first key already sounds like it
  void loadKeySample(g.ctx)
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

/**
 * inside the canvas: the listener is the camera, and the agents' keys and mouse (#225): the input bus
 * (office/inputEvents.ts) sends each press when the hand makes it; the ones of a frame become cues here
 * (inputSound.ts), on screen only (busywork off-camera stays silent, sound.md 6). The bus sends nothing at ×16.
 * Listening only while sound plays, so the bus skips building events when nobody hears them.
 */
export function SoundListener({ world }: { world: OfficeWorld }) {
  const pending = useRef<InputEvent[]>([])
  const off = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      off.current?.()
      off.current = null
    },
    [],
  )
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
    const hearing = !!g && g.ctx.state === 'running' && !getSetting().muted
    if (hearing !== !!off.current) {
      if (hearing) off.current = onInput((e) => void pending.current.push(e))
      else {
        off.current?.()
        off.current = null
      }
      pending.current = []
    }
    if (!hearing || !pending.current.length) return
    const batch = pending.current
    pending.current = []
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(viewProj)
    const seen = batch.filter((e) => frustum.containsPoint(e.pos))
    for (const c of inputCues(seen, getCueSpeed())) cue(c.name, { pos: c.pos, agent: c.agent, at: c.at, keyKind: c.keyKind, key: c.key })
  })
  return null
}
