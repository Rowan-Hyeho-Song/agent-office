import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { type Object3D } from 'three'
import { shelfLayout } from '../docs/library'
import { openDocs } from './docs/panel'
import { hitBox, useCanvasPick } from './pick'
import { ShelfRig } from './shelfRig'
import type { OfficeWorld } from './world'

// one snapshot object for good: useSyncExternalStore loops forever if getSnapshot returns a new object each call
// (an office without a library = no Supabase and not ?debug=1, i.e. the plain page)
const EMPTY_SNAPSHOT = { layout: shelfLayout([]) }
export const EMPTY_LIBRARY = { subscribe: () => () => {}, getSnapshot: () => EMPTY_SNAPSHOT }

/**
 * The bookshelf as the library's door (#65): one binder per filed issue (stamp only on SECRET ones), the folder names
 * on the plates. A click on a binder opens the viewer at that file; a click anywhere else on the shelf (`hit_library`)
 * opens it at the newest. Visibility is data-driven: until the list arrives the shelf is empty.
 */
export function Shelf({ world, scene, nodes }: { world: OfficeWorld; scene: Object3D; nodes: Record<string, Object3D> }) {
  const lib = world.library
  // once per loaded scene: React StrictMode builds this twice, and a second pass would clone the clones
  const rig = useMemo(() => (scene.userData.shelfRig ??= new ShelfRig(nodes)) as ShelfRig, [scene, nodes])
  const src = lib ?? EMPTY_LIBRARY
  const { layout } = useSyncExternalStore(src.subscribe, src.getSnapshot)
  useEffect(() => {
    rig.apply(layout)
  }, [rig, layout])
  useEffect(() => rig.redrawWhenFontsReady(), [rig])
  // a replayed meeting is over: its minutes are filed, the binder lights up
  useEffect(
    () =>
      world.meeting.onEnd((s) => {
        void lib?.refresh()
        rig.flash(s.repo, s.n)
      }),
    [world, lib, rig],
  )
  useFrame((_, dt) => rig.update(Math.min(dt, 0.1)))

  const box = useMemo(() => hitBox(scene, 'library'), [scene])
  useCanvasPick(
    () => [...rig.visibleBodies(), ...(box ? [box] : [])],
    (hits) => {
      for (const h of hits) {
        const b = rig.binderOf(h.object)
        if (b) return openDocs(b.repo && b.n ? { repo: b.repo, n: b.n } : { id: lib?.getSnapshot().metas?.find((m) => `private:${m.id}` === b.fileKey)?.id })
      }
      if (box && hits.some((h) => h.object === box)) openDocs()
    },
  )
  return null
}
