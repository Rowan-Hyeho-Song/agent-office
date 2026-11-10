/// <reference types="node" />
// `pnpm hand:measure` (scripts/hand-measure.mjs): the app's own measurement of the robot hand's poses, the single reference for the
// designer and the 3D artist. It loads the committed glb, builds a real AgentRig and puts every pose on the hand through the rig's own
// finger path (AgentRig.poseNow → setFingers: clamp to the limits, then the joint math of handPose.ts), then reads the node matrices.
// Without HAND_MEASURE set this file is skipped (no asserts, no cost in the normal suite).
import { describe, it } from 'vitest'
import type { Matrix4 as Mat4, Mesh, Object3D, Vector3 as Vec3 } from 'three'

const ENABLED = !!process.env.HAND_MEASURE

interface Opts {
  agent: number
  side: 'l' | 'r'
  pose: string | null
  json: boolean
  angles: unknown | null
}
function parseArgs(): Opts {
  const argv = JSON.parse(process.env.HAND_MEASURE_ARGS ?? '[]') as string[]
  const o: Opts = { agent: 0, side: 'r', pose: null, json: false, angles: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--agent') o.agent = Number(argv[++i])
    else if (a === '--side') o.side = argv[++i] === 'l' ? 'l' : 'r'
    else if (a === '--pose') o.pose = argv[++i]
    else if (a === '--json') o.json = true
    else if (a === '--angles') o.angles = JSON.parse(argv[++i])
  }
  return o
}

describe.skipIf(!ENABLED)('hand measure (pnpm hand:measure)', () => {
  it('prints the report', async () => {
    const { Matrix4, Triangle, Vector3 } = await import('three')
    const { loadOffice, stubCanvas } = await import('./glbLoad')
    const { AgentRig, buildRig } = await import('./rig')
    const hp = await import('./handPose')
    stubCanvas()
    const o = parseArgs()
    const { scene, nodes } = await loadOffice()
    const parts = buildRig(scene, nodes, o.agent)
    const rig = new AgentRig(`agent_${o.agent}`, o.agent, parts, '#ffffff')
    const hand = parts.hands[o.side]
    const mm = (v: number) => (v * 1000).toFixed(1)
    const f3 = (v: { x: number; y: number; z: number }) => `${mm(v.x)}, ${mm(v.y)}, ${mm(v.z)}`

    // ---- poses to measure
    const FAN = [6, 2, 2, 6]
    const straight: import('./handPose').HandAngles = {
      f: [0, 1, 2, 3].map((k) => ({ mcp: 0, pip: 0, dip: 0, abd: hand.fingers[k][0]?.restAbd ?? FAN[k] })) as unknown as import('./handPose').HandAngles['f'],
      thumb: { cmcFlex: 0, cmcAbd: 0, mcp: 0, ip: 0 },
    }
    const table: Record<string, import('./handPose').HandAngles> = { ...hp.ALL_POSES, straight }
    const names: Record<string, string> = { ...hp.POSE_NAMES, frame: 'ㄱ자 틀', stamp: '손바닥 도장', straight: '곧은 손(굽힘 0, 부채각만)' }
    const merge = (base: import('./handPose').HandAngles, over: any): import('./handPose').HandAngles => {
      const f = base.f.map((x, k) => {
        const u = over?.f?.[k]
        if (!u) return x
        const m = { ...x, ...u }
        if (u.pip !== undefined && u.dip === undefined) delete m.dip // DIP follows the new PIP
        return m
      }) as unknown as import('./handPose').HandAngles['f']
      return { f, thumb: { ...base.thumb, ...(over?.thumb ?? {}) } }
    }
    let jobs: [string, import('./handPose').HandAngles, string][]
    if (o.angles) {
      const baseId = o.pose ?? 'straight'
      if (!table[baseId]) throw new Error('unknown pose ' + baseId)
      jobs = [[o.pose ? `${o.pose}+angles` : 'custom', merge(table[baseId], o.angles), `custom angles over "${baseId}"`]]
    } else if (o.pose) {
      if (!table[o.pose]) throw new Error('unknown pose ' + o.pose + ', one of ' + Object.keys(table).join(', '))
      jobs = [[o.pose, table[o.pose], names[o.pose]]]
    } else jobs = Object.keys(hp.ALL_POSES).map((id) => [id, table[id], names[id]])

    // ---- geometry helpers
    const ownMeshes = (n: Object3D): Mesh[] => [n, ...n.children].filter((c) => (c as Mesh).isMesh) as Mesh[]
    const verts = (n: Object3D, into: Mat4 | null) => {
      const out: Vec3[] = []
      for (const m of ownMeshes(n)) {
        const pos = m.geometry.getAttribute('position')
        const rel = into ? new Matrix4().multiplyMatrices(into, m.matrixWorld) : new Matrix4().copy(n.matrixWorld).invert().multiply(m.matrixWorld)
        for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(rel))
      }
      return out
    }
    /** the measurement tip: the average of the segment's own vertices within 0.5 mm of the farthest along its local +y (the centre of the end) */
    const tipTies = (n: Object3D) => {
      const local = verts(n, null)
      const top = Math.max(...local.map((p) => p.y))
      const ties = local.filter((p) => p.y > top - 5e-4)
      return [ties.reduce((m, p) => m.add(p), new Vector3()).multiplyScalar(1 / ties.length)]
    }
    /** palm face: the +z face of the palm shell (the hand's largest mesh) in the hand frame */
    scene.updateMatrixWorld(true)
    const handInv0 = new Matrix4().copy(hand.node.matrixWorld).invert()
    const palmMesh = hand.node.children.find((c) => c.name === `agent_${o.agent}_hand_${o.side}_1`)!
    const palmVerts = verts(palmMesh, null).map((p) => p.applyMatrix4(new Matrix4().multiplyMatrices(handInv0, palmMesh.matrixWorld)))
    const palm = { zFace: Math.max(...palmVerts.map((p) => p.z)), x: Math.max(...palmVerts.map((p) => Math.abs(p.x))), y: Math.max(...palmVerts.map((p) => Math.abs(p.y))) }

    const results: any[] = []
    const md: string[] = []
    const fingerNames = ['index', 'middle', 'ring', 'little'] as const
    for (const [id, angles, label] of jobs) {
      rig.poseNow(o.side, angles) // the rig's own finger path (clamps, then the joint math)
      scene.updateMatrixWorld(true)
      const { angles: a, clipped } = hp.clampAngles(angles)
      const inv = new Matrix4().copy(hand.node.matrixWorld).invert()
      const inHand = (p: Vec3, n: Object3D) => p.clone().applyMatrix4(n.matrixWorld).applyMatrix4(inv)
      const originOf = (n: Object3D) => new Vector3().setFromMatrixPosition(n.matrixWorld).applyMatrix4(inv)
      // tips: A = the centre of the end (measurement), B = the app's tipOf (the pad-side +z corner: what grips and the contact fit use)
      const chain = [...hand.fingers.map((c) => c[2]!.node), hand.thumb[2]!.node]
      const tipA = chain.map((n) => {
        const ties = tipTies(n).sort((p, q) => p.z - q.z || p.x - q.x)
        return inHand(ties[0], n)
      })
      const tipB = [...hand.tips, hand.thumbTip].map((t, i) => inHand(t!, chain[i]))
      const names5 = [...fingerNames, 'thumb'] as const
      const idx = tipA[0], mid = tipA[1], th = tipA[4]
      const midpoint = idx.clone().add(mid).multiplyScalar(0.5)
      // nearest vertex of the index's middle segment (its own meshes) to the thumb tip
      const nearest = (p: Vec3) => {
        // the distance to the segment's surface: the nearest point on any triangle of its own meshes
        let best = Infinity
        const seg = hand.fingers[0][1]!.node
        const rel = new Matrix4()
        const q = new Vector3()
        const tri = new Triangle()
        for (const m of ownMeshes(seg)) {
          rel.multiplyMatrices(inv, m.matrixWorld)
          const pos = m.geometry.getAttribute('position')
          const idx = m.geometry.getIndex()
          const n = idx ? idx.count : pos.count
          const at = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(rel)
          for (let i = 0; i + 2 < n; i += 3) {
            tri.set(at(i), at(i + 1), at(i + 2))
            tri.closestPointToPoint(p, q)
            best = Math.min(best, q.distanceTo(p))
          }
        }
        return best
      }
      const dist = {
        A: { thumbIndex: th.distanceTo(idx), thumbMiddle: th.distanceTo(mid), thumbMidpoint: th.distanceTo(midpoint), thumbIndexMiddleSegment: nearest(th) },
        B: {
          thumbIndex: tipB[4].distanceTo(tipB[0]),
          thumbMiddle: tipB[4].distanceTo(tipB[1]),
          thumbMidpoint: tipB[4].distanceTo(tipB[0].clone().add(tipB[1]).multiplyScalar(0.5)),
          thumbIndexMiddleSegment: nearest(tipB[4]),
        },
      }
      const target = id === 'ok' ? ['thumb–index', dist.A.thumbIndex] : id === 'tripod' ? ['thumb–(index/middle midpoint)', dist.A.thumbMidpoint] : id === 'key' ? ['thumb–index middle segment', dist.A.thumbIndexMiddleSegment] : null
      const origins = {
        f1_1: originOf(hand.fingers[0][0]!.node),
        f1_2: originOf(hand.fingers[0][1]!.node),
        f1_3: originOf(hand.fingers[0][2]!.node),
        f2_1: originOf(hand.fingers[1][0]!.node),
        t_0: originOf(hand.thumb[0]!.node),
        t_1: originOf(hand.thumb[1]!.node),
        t_2: originOf(hand.thumb[2]!.node),
      }
      const rest = (k: number) => hand.fingers[k][0]?.restAbd ?? FAN[k]
      const joints = {
        fingers: a.f.map((f, k) => ({ finger: fingerNames[k], mcp: f.mcp, pip: f.pip, dip: f.dip, abdTotal: f.abd, abdFromRest: f.abd - rest(k) })),
        thumb: { cmcFlex: a.thumb.cmcFlex, cmcAbd: a.thumb.cmcAbd, twist: hp.thumbTwist(a.thumb.cmcAbd, a.thumb.cmcFlex), mcp: a.thumb.mcp, ip: a.thumb.ip },
        clipped,
      }
      results.push({
        id, label, joints,
        origins: Object.fromEntries(Object.entries(origins).map(([k, v]) => [k, [+mm(v.x), +mm(v.y), +mm(v.z)]])),
        tips: names5.map((n, i) => ({ finger: n, artist: [+mm(tipA[i].x), +mm(tipA[i].y), +mm(tipA[i].z)], app: [+mm(tipB[i].x), +mm(tipB[i].y), +mm(tipB[i].z)], heightAbovePalmFace: +mm(tipA[i].z - palm.zFace), overPalm: Math.abs(tipA[i].x) <= palm.x && Math.abs(tipA[i].y) <= palm.y })),
        distancesMm: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, d]) => [n, +mm(d)]))])),
        target: target ? { what: target[0], mm: +mm(target[1] as number), pass: (target[1] as number) <= 0.005 } : null,
      })
      // ---- markdown
      md.push(`### ${id} — ${label}`, '')
      md.push('| finger | MCP | PIP | DIP | abduction (total) | abduction − rest_abduct |', '|---|---|---|---|---|---|')
      for (const j of joints.fingers) md.push(`| ${j.finger} | ${j.mcp.toFixed(1)} | ${j.pip.toFixed(1)} | ${j.dip!.toFixed(1)} | ${j.abdTotal.toFixed(1)} | ${j.abdFromRest.toFixed(1)} |`)
      md.push('', `thumb: CMC flex ${joints.thumb.cmcFlex.toFixed(1)}, CMC abduct ${joints.thumb.cmcAbd.toFixed(1)}, twist ${joints.thumb.twist.toFixed(1)} (computed), MCP ${joints.thumb.mcp.toFixed(1)}, IP ${joints.thumb.ip.toFixed(1)}`)
      md.push('', `clipped by the limits: ${clipped.length ? clipped.join(', ') : 'none'}`, '')
      md.push('| node origin | x, y, z (mm) |', '|---|---|')
      for (const [k, v] of Object.entries(origins)) md.push(`| ${k} | ${f3(v)} |`)
      md.push('', '| tip | A: centre-of-end tip x, y, z (mm) | height above palm face (mm) | B: app tipOf x, y, z (mm) |', '|---|---|---|---|')
      names5.forEach((n, i) => {
        const h = tipA[i].z - palm.zFace
        const over = Math.abs(tipA[i].x) <= palm.x && Math.abs(tipA[i].y) <= palm.y
        md.push(`| ${n} | ${f3(tipA[i])} | ${mm(h)}${over ? '' : ' (not over the palm)'} | ${f3(tipB[i])} |`)
      })
      md.push('', '| distance (mm) | A | B |', '|---|---|---|')
      md.push(`| thumb–index tip | ${mm(dist.A.thumbIndex)} | ${mm(dist.B.thumbIndex)} |`)
      md.push(`| thumb–middle tip | ${mm(dist.A.thumbMiddle)} | ${mm(dist.B.thumbMiddle)} |`)
      md.push(`| thumb–(index/middle midpoint) | ${mm(dist.A.thumbMidpoint)} | ${mm(dist.B.thumbMidpoint)} |`)
      md.push(`| thumb tip → surface of the index middle segment (nearest triangle point) | ${mm(dist.A.thumbIndexMiddleSegment)} | ${mm(dist.B.thumbIndexMiddleSegment)} |`)
      if (target) md.push('', `target (A, ≤ 5 mm): ${target[0]} = ${mm(target[1] as number)} mm → **${(target[1] as number) <= 0.005 ? 'PASS' : 'FAIL'}**`)
      md.push('')
    }

    const header = [
      `# hand measure — agent_${o.agent}, ${o.side === 'r' ? 'right' : 'left'} hand`,
      '',
      '## Frame',
      `- Frame: the hand node \`agent_${o.agent}_hand_${o.side}\` itself (hand-local, glTF Y-up, mm). Origin = the node's pivot (extras pivot_at, the web of the hand; the wrist ring centre is 50 mm below it on −y).`,
      '- x toward the thumb (+x for the right hand, −x for the left), y along the fingers, z palm-front (out of the palm face).',
      '- Blender hand object, local axes: glTF (x, y, z) = Blender (X, Z, −Y), so **Blender X = x, Blender Z = y, Blender Y = −z** (palm-front is Blender −Y). Checked against the bake script (assets/blender/office_bake.py): it places `_t_0` at web `(sx·0.037, −0.028, 0.004)` and maps hand web → Blender local with `Vector((a, −c, b))`; this tool reads `_t_0` at (37.0, −28.0, 4.0) mm in the right hand.',
      '- Tip definition (**A**, the measurement): the average of the vertices of the last segment\'s own meshes within 0.5 mm of the farthest along its local +y, i.e. the centre of the end (the end is flat with two rounded corners at local z = ± half width, so one farthest vertex would be arbitrary). **B** = the rig\'s `tipOf`, the contact tip that grips and the contact fit use: it deliberately prefers the pad side (the +z corner of the same end, about 8 mm off the centre). Distances and PASS/FAIL use A.',
      `- Palm face: the plane z = ${mm(palm.zFace)} mm, the +z face of the palm shell mesh (hand-local ±${mm(palm.x)} x ±${mm(palm.y)} mm in x, y). "Height above palm face" = tip z − that plane for tip A; negative = inside the palm block. Approximate: the palm shell is a rounded block, so the plane is its flat front.`,
      '- Pose path: `AgentRig.poseNow` → `setFingers` (limits, then joint math of src/office/handPose.ts). Abduction is the total angle; the baked fan (rest_abduct) is subtracted when applied.',
      '',
      '## Poses',
      '',
    ]
    const text = o.json ? JSON.stringify({ agent: o.agent, side: o.side, palm, results }, null, 1) : [...header, ...md].join('\n')
    process.stdout.write('\n<<<HAND_MEASURE\n' + text + '\nHAND_MEASURE>>>\n')
  }, 120000)
})
