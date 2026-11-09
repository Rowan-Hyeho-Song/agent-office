import { useEffect, useMemo } from 'react'
import { BoxGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from 'three'
import { toggleSpeakerForMe } from '../audio/speaker'
import { useCanvasPick } from './pick'

/** the press box of one speaker, centred on its pivot (desk_4_spk_l | _r), 0.12 x 0.20 x 0.14 m in the speaker's own axes (#193, sound.md 5) */
export const SPEAKER_BOX = [0.12, 0.2, 0.14] as const

let toastEl: HTMLDivElement | null = null
let toastTimer = 0
/** a small tag by the HUD: the visitor's own switch (not the office's music) says what it did */
function toast(text: string, ms: number) {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'speaker-tag'
    toastEl.setAttribute('role', 'status')
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = text
  toastEl.dataset.show = '1'
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    if (toastEl) delete toastEl.dataset.show
  }, ms)
}

/** what a click on the speaker says: 'off' -> "나에게만 꺼짐" for 1.5 s, 'muted' -> "소리가 꺼져 있어요", 'on' -> nothing */
export const SPEAKER_TAG = { off: '나에게만 꺼짐', muted: '소리가 꺼져 있어요' } as const

/** Echo's speakers are pressable (desk_4_spk_l | _r): the same pointer + click pick as the clock and the bookshelf. */
export function SpeakerClick({ nodes }: { nodes: Record<string, Object3D> }) {
  const boxes = useMemo(() => {
    const out: Mesh[] = []
    for (const k of ['desk_4_spk_l', 'desk_4_spk_r']) {
      const node = nodes[k]
      if (!node) continue
      node.updateWorldMatrix(true, false)
      const box = new Mesh(new BoxGeometry(...SPEAKER_BOX), new MeshBasicMaterial({ visible: false }))
      node.matrixWorld.decompose(box.position, box.quaternion, new Vector3())
      box.quaternion.copy(node.getWorldQuaternion(new Quaternion()))
      box.updateMatrixWorld(true)
      out.push(box)
    }
    return out
  }, [nodes])
  useEffect(() => () => void (toastEl && delete toastEl.dataset.show), [])
  useCanvasPick(
    () => boxes,
    () => {
      const r = toggleSpeakerForMe()
      // speaker.ts: 'off' = the music is off for me now
      if (r === 'off') toast(SPEAKER_TAG.off, 1500)
      else if (r === 'muted') toast(SPEAKER_TAG.muted, 1500)
    },
  )
  return null
}
