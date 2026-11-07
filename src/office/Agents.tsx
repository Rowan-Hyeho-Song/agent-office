import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute, Line, LineBasicMaterial, LineSegments, type Group, type Mesh } from 'three'
import { buildGraph, patchSpots, type NavGraph } from './nav'
import { checkNav, edgeKey } from './navcheck'
import { meshesOf, useOffice } from './nodes'
import { AgentRig, buildRig } from './rig'
import { AGENT_COLORS, officeNow, type OfficeWorld } from './world'

/**
 * Same rule as the design tokens (src/styles/tokens.css): html[data-motion="reduce"|"full"] (the setting shared
 * with the desk room) wins, otherwise the OS prefers-reduced-motion.
 */
function useReducedMotion() {
  const read = () => {
    const forced = document.documentElement.dataset.motion
    if (forced === 'reduce' || forced === 'full') return forced === 'reduce'
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  const [reduced, setReduced] = useState(read)
  useEffect(() => {
    const on = () => setReduced(read())
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    m.addEventListener('change', on)
    const attr = new MutationObserver(on)
    attr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
    return () => {
      m.removeEventListener('change', on)
      attr.disconnect()
    }
  }, [])
  return reduced
}

/** The agents: each frame the director picks goals from the status source and the clock, the rigs move. */
export function Agents({ world }: { world: OfficeWorld }) {
  const { scene, nodes, spots } = useOffice()
  const graph = useMemo(() => {
    // ?debug=1&nav=… tries spots before they are re-baked into the model
    const tryout = world.debug ? (new URLSearchParams(location.search).get('nav') ?? '') : ''
    return buildGraph(patchSpots(spots, tryout))
  }, [world, spots])
  const rigs = useMemo(
    () => Object.fromEntries(world.director.agents.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i))])),
    [world, scene, nodes],
  )
  const reduced = useReducedMotion()
  world.rigs = rigs
  world.graph = graph

  useEffect(() => world.source.onMessage((m) => world.director.receive(m)), [world])

  useFrame((state, dt) => {
    const now = officeNow(world)
    const goals = world.director.goals(now, Math.floor(now / 60000), world.source.getSnapshot(), (a) => rigs[a].arrived)
    world.goals = goals
    for (const id in rigs) rigs[id].setGoal(goals[id], graph)
    for (const id in rigs) rigs[id].update(dt, state.clock.elapsedTime, graph, rigs, reduced)
  })

  return (
    <>
      {Object.values(rigs).map((rig) => (
        <Bubble key={rig.id} world={world} rig={rig} />
      ))}
      {world.debug && <NavDebug world={world} graph={graph} meshes={Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf)} />}
    </>
  )
}

/** placeholder speech bubble above the head (the real bubble design comes from the designer) */
function Bubble({ world, rig }: { world: OfficeWorld; rig: AgentRig }) {
  const anchor = useRef<Group>(null)
  const box = useRef<HTMLDivElement>(null)
  useFrame(() => {
    const text = world.goals[rig.id]?.bubble
    anchor.current?.position.set(rig.group.position.x, rig.group.position.y + 1.42, rig.group.position.z)
    const el = box.current
    if (!el) return
    el.style.display = text && !rig.hidden ? 'block' : 'none'
    if (text && el.textContent !== text) el.textContent = text
  })
  return (
    <group ref={anchor}>
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={box} className="bubble-placeholder" style={{ display: 'none', borderColor: AGENT_COLORS[rig.id] }} />
      </Html>
    </group>
  )
}

const MAX_ROUTE = 32

/** ?debug=1: the nav graph (red = an edge that hits furniture), spot names, and each agent's remaining route */
function NavDebug({ world, graph, meshes }: { world: OfficeWorld; graph: NavGraph; meshes: Mesh[] }) {
  const check = useMemo(() => checkNav(graph, meshes), [graph, meshes])
  world.check = check

  const edges = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    const ok = new Color('#5c6b80')
    const bad = new Color('#ff3030')
    for (const key in check.edges) {
      const [a, b] = key.split('|').map((id) => graph.spots[id])
      pos.push(a.x, 0.03, a.z, b.x, 0.03, b.z)
      const c = check.edges[edgeKey(a.id, b.id)] ? ok : bad
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new Float32BufferAttribute(col, 3))
    return new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
  }, [check, graph])

  const routes = useMemo(
    () =>
      Object.keys(world.rigs).map((id) => {
        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_ROUTE * 3), 3))
        const line = new Line(geo, new LineBasicMaterial({ color: AGENT_COLORS[id], depthTest: false, transparent: true }))
        line.renderOrder = 2
        return { id, line }
      }),
    [world.rigs],
  )

  useFrame(() => {
    for (const { id, line } of routes) {
      const pts = world.rigs[id].route(graph).slice(0, MAX_ROUTE)
      const attr = line.geometry.getAttribute('position') as Float32BufferAttribute
      pts.forEach((p, i) => attr.setXYZ(i, p.x, 0.06, p.z))
      attr.needsUpdate = true
      line.geometry.setDrawRange(0, pts.length)
      line.geometry.computeBoundingSphere()
    }
  })

  return (
    <>
      <primitive object={edges} renderOrder={1} />
      {routes.map(({ id, line }) => (
        <primitive key={id} object={line} />
      ))}
      {Object.values(graph.spots).map((s) => (
        <Html key={s.id} position={[s.x, 0.05, s.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <span className="nav-label">{s.id}</span>
        </Html>
      ))}
    </>
  )
}
