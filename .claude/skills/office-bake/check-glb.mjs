// Check office.glb the way the app reads it (three's GLTFLoader + MeshoptDecoder), in plain Node — no browser.
//
//   node .claude/skills/office-bake/check-glb.mjs [file.glb] [--want a,b,c] [--show <regex>] [--overlap [--coplanar <regex>]]
//
// --overlap (#109): reads the slot_<name> empties (each object's footprint, extras slot = kind, size, wall) and checks
// the layout rules in SKILL.md 10: the gap between every pair against its minimum, walls, the room's inside.
// It also finds coplanar same-facing faces that overlap (z-fighting, #263); --coplanar <regex> lists where.
//
// Prints: file size, top-level nodes by kind (atlas / live / nav / hit / surface / screen / prop), triangles,
// names that look like Blender duplicates ("x.001" → "x001"), live parts with neither pivot_at nor a reason to
// skip it, canvas-cell labels whose UVs leave their cell, and for --show the world position + extras of each match.
// Exit code 1 when a --want name is missing or a check fails.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box3, Triangle, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const args = process.argv.slice(2)
const opt = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const file = resolve(args.find((a, i) => !a.startsWith('--') && !['--want', '--show', '--coplanar'].includes(args[i - 1])) ?? 'public/models/office.glb')
const want = (opt('--want') ?? '').split(',').filter(Boolean)
const show = opt('--show') ? new RegExp(opt('--show')) : null
const overlap = args.includes('--overlap')

await MeshoptDecoder.ready
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const buf = readFileSync(file)
const gltf = await new Promise((ok, no) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, no))
const scene = gltf.scene
scene.updateMatrixWorld(true)

let failed = false
const fail = (msg) => {
  failed = true
  console.log('FAIL', msg)
}
const f3 = (v) => v.toArray().map((x) => +x.toFixed(3))
const tris = (o) => {
  let n = 0
  o.traverse((m) => {
    if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3
  })
  return n
}

console.log(`${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`)

// 1) top-level nodes by kind, triangles by atlas / live kind
const kinds = {}
const triBy = {}
for (const o of scene.children) {
  const u = o.userData
  const key = u.atlas ? `atlas:${u.atlas}` : u.live ? `live:${u.live}` : u.nav ? 'nav' : u.hit ? 'hit' : u.surface ? 'surface' : 'other'
  kinds[key] = (kinds[key] ?? 0) + 1
  if (u.atlas || u.live) triBy[key] = (triBy[key] ?? 0) + tris(o)
}
console.log('nodes:', Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', '))
console.log('triangles:', Object.entries(triBy).map(([k, n]) => `${k} ${n}`).join(', '))

// 2) names: a unique Blender name never ends in three digits here; "x.001" (a name clash) becomes "x001" in three
const names = new Set()
scene.traverse((o) => o.name && names.add(o.name))
const dupes = [...names].filter((n) => /[a-z_]\d{3}$/i.test(n))
if (dupes.length) fail(`names that look like Blender duplicates (a clash renamed them): ${dupes.join(', ')}`)
const missing = want.filter((n) => !names.has(n))
if (missing.length) fail(`missing: ${missing.join(', ')}`)
else if (want.length) console.log(`want: all ${want.length} present`)

// 3) moving / lit live parts carry pivot_at (meshopt moves node origins; the app rebuilds pivots from it)
const noPivot = scene.children.filter((o) => ['bot', 'prop', 'anchor'].includes(o.userData.live) && !o.userData.pivot_at && !/^(agent_\d|agent_\d_(head|face))$/.test(o.name))
if (noPivot.length) console.log(`note: live bot/prop/anchor without pivot_at (fine if the app never turns them): ${noPivot.map((o) => o.name).join(', ')}`)

// 4) canvas-cell labels (#67): UVs inside cell [k, r] of a grid [cols, rows]; glTF convention, v = 0 at the canvas top
for (const o of scene.children) {
  const { canvas, cell, grid } = o.userData
  if (!canvas || !cell || !grid) continue
  const [k, r] = cell
  const [cols, rows] = grid
  o.traverse((m) => {
    if (!m.isMesh) return
    const uv = m.geometry.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      if (u < k / cols - 1e-3 || u > (k + 1) / cols + 1e-3 || v < r / rows - 1e-3 || v > (r + 1) / rows + 1e-3) {
        fail(`${o.name}: uv (${u.toFixed(3)}, ${v.toFixed(3)}) outside cell [${k}, ${r}] of ${canvas}`)
        return
      }
    }
  })
}

// 5) --overlap: layout rules on the slot_* footprints (SKILL.md 10)
if (overlap) {
  // minimum gap (m) between two footprints on the floor, by kind pair; wall items are checked along their wall
  const NEED = { 'floor|floor': 0.6, 'decor|floor': 0.1, 'decor|decor': 0.1, 'clear|floor': 0, 'clear|decor': 0, 'clear|clear': 0 }
  const WALL_GAP = 0.1 // between two things on the same wall
  const slots = scene.children.filter((o) => o.name.startsWith('slot_') && o.userData.size).map((o) => {
    const p = o.getWorldPosition(new Vector3())
    const [w, h, d] = o.userData.size
    return { name: o.name.replace(/^slot_/, ''), kind: o.userData.slot, wall: o.userData.wall, lo: [p.x - w / 2, p.y, p.z - d / 2], hi: [p.x + w / 2, p.y + h, p.z + d / 2] }
  })
  const room = slots.find((s) => s.kind === 'room')
  const items = slots.filter((s) => s.kind !== 'room')
  if (!items.length) fail('--overlap: no slot_* empties in this glb (built before #109?)')
  // gap between two boxes on chosen axes: > 0 apart, < 0 = overlap depth (the smaller of the axes' overlaps)
  const gap = (a, b, axes) => {
    const d = axes.map((k) => Math.max(a.lo[k] - b.hi[k], b.lo[k] - a.hi[k]))
    if (d.every((x) => x < 0)) return Math.max(...d)
    const pos = d.filter((x) => x > 0)
    return Math.hypot(...pos)
  }
  const along = { n: 0, s: 0, e: 2, w: 2 } // the axis that runs along each wall
  // #195 (desks.md 2.1.4 / 2.1.6): named pairs with their own minimum (the main aisle: the pod with its chair room
  // to the omok table). #185: the can stand stands under the fig's canopy (that box is the canopy) and beside the lamp
  // (that box is its shade, 1.6 m up); the designer's real-outline gaps (path 0.45, lamp pole 0.15) are measured apart
  // #280: the L sofa is two boxes (sofa · sofa_chaise) of one thing; the low table stands 0.42 / 0.45 off it (room-280.md 2:
  // 0.35-0.45); the fridge and the water dispenser stand against the counter and each other (one coffee bar)
  const PAIR_NEED = { 'game|pod': 1.12, 'shelf|shelf_2': 0.03, 'can_stand|plant_corner': 0, 'can_stand|floor_lamp': 0.05, 'sofa|sofa_chaise': 0,
    'sofa|table_low': 0.35, 'sofa_chaise|table_low': 0.35, 'counter|fridge': 0, 'fridge|water_dispenser': 0,
    'counter|water_dispenser': 0, 'side_table|sofa': 0.1, 'side_table|table_low': 0.4 }
  const rows = []
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = [items[i], items[j]].sort((x, y) => x.kind.localeCompare(y.kind))
      if (a.kind === 'rug' || b.kind === 'rug') continue // rugs lie under furniture: their own rules below
      let need, g, where
      if (a.kind === 'wall' && b.kind === 'wall') {
        if (a.wall !== b.wall) continue
        ;[need, g, where] = [WALL_GAP, gap(a, b, [along[a.wall], 1]), `wall ${a.wall}`]
      } else if (a.kind === 'wall' || b.kind === 'wall') {
        ;[need, g, where] = [0, gap(a, b, [0, 1, 2]), '3D'] // a floor thing may stand under a wall item, not through it
      } else {
        need = PAIR_NEED[[a.name, b.name].sort().join('|')] ?? NEED[`${a.kind}|${b.kind}`] ?? 0.1
        ;[g, where] = [gap(a, b, [0, 2]), 'floor']
      }
      if (g < need + 0.3) rows.push({ pair: `${a.name} · ${b.name}`, kinds: `${a.kind}/${b.kind}`, where, gap: g, need, ok: g >= need - 1e-3 })
    }
  // meeting rings (#147): nav_meet_center_* with extras r; the circle keeps clear of every floor footprint (with its
  // use room: an agent at a desk counts) and of the other rings, and stays inside the walls
  const rings = scene.children.filter((o) => o.userData.nav === 'meet_center' && o.userData.r).map((o) => {
    const p = o.getWorldPosition(new Vector3())
    return { name: o.name.replace(/^nav_/, ''), x: p.x, z: p.z, r: o.userData.r }
  })
  // #195: the circle (ring + a body) keeps 0.76 from furniture (a secondary aisle round it, desks.md 2.1.4) and
  // 0.6 from the walls (MEMO's way to the board along the north wall)
  const RING_FURNITURE = 0.76, RING_WALL = 0.6
  for (const c of rings) {
    for (const s of items.filter((x) => x.kind !== 'wall' && x.kind !== 'rug')) {
      const dx = Math.max(s.lo[0] - c.x, 0, c.x - s.hi[0])
      const dz = Math.max(s.lo[2] - c.z, 0, c.z - s.hi[2])
      const g = Math.hypot(dx, dz) - c.r
      const need = s.kind === 'floor' || s.kind === 'decor' ? RING_FURNITURE : 0
      if (g < need + 0.3) rows.push({ pair: `${c.name} · ${s.name}`, kinds: `ring/${s.kind}`, where: 'floor', gap: g, need, ok: g >= need - 1e-3 })
    }
    for (const d of rings.filter((x) => x.name > c.name)) {
      const g = Math.hypot(c.x - d.x, c.z - d.z) - c.r - d.r
      rows.push({ pair: `${c.name} · ${d.name}`, kinds: 'ring/ring', where: 'floor', gap: g, need: 0, ok: g >= -1e-3 })
    }
    if (room) {
      const g = Math.min(c.x - c.r - room.lo[0], room.hi[0] - c.x - c.r, c.z - c.r - room.lo[2], room.hi[2] - c.z - c.r)
      rows.push({ pair: `${c.name} · room`, kinds: 'ring/room', where: 'walls', gap: g, need: RING_WALL, ok: g >= RING_WALL - 1e-3 })
    }
  }
  // #195 rugs (desks.md 2.1.5): none overlapping or touching another (0.3), 0.30 off the walls; the work rug 0.61
  // beyond the pod's desks (the slot's core); the meeting rug 0.30 beyond the standing circle
  const rugs = items.filter((s) => s.kind === 'rug')
  for (let i = 0; i < rugs.length; i++) {
    for (let j = i + 1; j < rugs.length; j++) {
      const g = gap(rugs[i], rugs[j], [0, 2])
      rows.push({ pair: `${rugs[i].name} · ${rugs[j].name}`, kinds: 'rug/rug', where: 'floor', gap: g, need: 0.3, ok: g >= 0.3 - 1e-3 })
    }
    if (room) {
      const r = rugs[i]
      const g = Math.min(r.lo[0] - room.lo[0], room.hi[0] - r.hi[0], r.lo[2] - room.lo[2], room.hi[2] - r.hi[2])
      rows.push({ pair: `${r.name} · room`, kinds: 'rug/room', where: 'walls', gap: g, need: 0.3, ok: g >= 0.3 - 1e-3 })
    }
  }
  const podSlot = scene.children.find((o) => o.name === 'slot_pod')
  const rugWork = rugs.find((r) => r.name === 'rug_work')
  if (podSlot?.userData.core && rugWork) {
    const { at, size } = podSlot.userData.core
    const lo = [at[0] - size[0] / 2, at[2] - size[2] / 2], hi = [at[0] + size[0] / 2, at[2] + size[2] / 2]
    const g = Math.min(lo[0] - rugWork.lo[0], rugWork.hi[0] - hi[0], lo[1] - rugWork.lo[2], rugWork.hi[2] - hi[1])
    rows.push({ pair: 'rug_work · pod desks', kinds: 'rug/floor', where: 'floor', gap: g, need: 0.61, ok: g >= 0.61 - 1e-3 })
  }
  const rugMeet = rugs.find((r) => r.name === 'rug_meet')
  if (rugMeet && rings.length) {
    const g = (rugMeet.hi[0] - rugMeet.lo[0]) / 2 - rings[0].r
    rows.push({ pair: `rug_meet · ${rings[0].name}`, kinds: 'rug/ring', where: 'floor', gap: g, need: 0.3, ok: g >= 0.3 - 1e-3 })
  }
  // #195 chair room (desks.md 2.1.4): from each desk's front edge back past the seated agent to the first obstacle
  // (a floor footprint other than the pod and the rugs, a meeting circle, a wall) >= 0.91, along a body-wide lane
  const CHAIR_BACK = 0.91, BODY = 0.22
  for (const o of scene.children.filter((x) => x.userData.nav === 'work')) {
    const p = o.getWorldPosition(new Vector3()), ry = o.userData.ry
    const f = [-Math.sin(ry), -Math.cos(ry)] // the way the agent faces (local -z)
    const start = [p.x + f[0] * 0.19, p.z + f[1] * 0.19] // the desk's front edge (desk centre 0.5 ahead, 0.62 deep)
    const back = [-f[0], -f[1]]
    let hit = 4
    for (let t = 0; t < 4; t += 0.01) {
      const q = [start[0] + back[0] * t, start[1] + back[1] * t]
      const inBox = items.some((s) => s.kind !== 'wall' && s.kind !== 'rug' && s.name !== 'pod' &&
        q[0] > s.lo[0] - BODY * Math.abs(back[1]) && q[0] < s.hi[0] + BODY * Math.abs(back[1]) &&
        q[1] > s.lo[2] - BODY * Math.abs(back[0]) && q[1] < s.hi[2] + BODY * Math.abs(back[0]))
      const inRing = rings.some((c) => Math.hypot(q[0] - c.x, q[1] - c.z) < c.r)
      const outRoom = room && (q[0] < room.lo[0] || q[0] > room.hi[0] || q[1] < room.lo[2] || q[1] > room.hi[2])
      if (inBox || inRing || outRoom) { hit = t; break }
    }
    const name = o.name.replace(/^nav_/, '')
    rows.push({ pair: `${name} chair room`, kinds: 'work/back', where: 'floor', gap: hit, need: CHAIR_BACK, ok: hit >= CHAIR_BACK - 1e-3 })
  }
  rows.sort((x, y) => x.gap - x.need - (y.gap - y.need))
  console.log('\noverlap: pairs closer than their minimum + 0.3 m (gap < 0 = overlapping; ring = a meeting circle, #147)')
  console.log('| pair | kinds | checked | gap (m) | min (m) | |')
  console.log('|---|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.pair} | ${r.kinds} | ${r.where} | ${r.gap.toFixed(2)} | ${r.need.toFixed(2)} | ${r.ok ? 'ok' : 'FAIL'} |`)
  const bad = rows.filter((r) => !r.ok)
  // floor things inside the walls (against a wall = gap 0 is fine)
  const outside = room ? items.filter((s) => s.kind !== 'wall' && (s.lo[0] < room.lo[0] - 1e-3 || s.hi[0] > room.hi[0] + 1e-3 || s.lo[2] < room.lo[2] - 1e-3 || s.hi[2] > room.hi[2] + 1e-3)) : []
  for (const s of outside) console.log(`outside the room: ${s.name}`)
  console.log(`overlap: ${items.length} slots, ${bad.length} pairs under their minimum, ${outside.length} outside the room`)
  if (bad.length || outside.length) fail('--overlap: layout rules broken (table above)')
}

// 5a) #263 coplanar faces (with --overlap): two triangles facing the same way on the same plane (within TOL) whose
// areas overlap z-fight in the app, flickering with the camera angle (#260 the screen on its bed, #263 the sofa's
// arm on its base). Counted per node pair (a pair of one node = inside one joined mesh). Faces back to back (opposite
// normals) are a contact, not a fight, and are not counted. --coplanar <regex> lists where each matching pair fights.
// A pair under SMALL in all is 'small' and does not fail: slivers where touching parts meet after meshopt (a few
// mm², under a pixel at the default camera). COPLANAR_KNOWN: faces never seen from outside, each with its issue and
// why it is hidden; any other pair of SMALL or more fails the check
const COPLANAR_KNOWN = [
  [/^prop_(shelf)?book(_\d+)?_(l · prop_(shelf)?book(_\d+)?_(r|page)|page · prop_(shelf)?book(_\d+)?_r)$/, '#281', 'a closed book: its halves\' inner pages and the turning page (paper, ink lines) meet inside the book and part when it opens'],
]
if (overlap) {
  const TOL = 0.00015 // 0.15 mm: meshopt moves a vertex by up to ~0.04 mm; deliberate decal offsets are >= 0.3 mm
  const MIN_AREA = 1e-6 // 1 mm^2
  const SMALL = 0.5e-4 // 0.5 cm²
  const detail = opt('--coplanar') ? new RegExp(opt('--coplanar')) : null
  const T = []
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e1 = new Vector3(), e2 = new Vector3()
  scene.traverse((m) => {
    if (!m.isMesh) return
    let top = m
    while (top.parent && top.parent !== scene) top = top.parent
    const pos = m.geometry.getAttribute('position')
    const idx = m.geometry.index
    const cnt = idx ? idx.count : pos.count
    for (let k = 0; k < cnt; k += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld)
      b.fromBufferAttribute(pos, idx ? idx.getX(k + 1) : k + 1).applyMatrix4(m.matrixWorld)
      c.fromBufferAttribute(pos, idx ? idx.getX(k + 2) : k + 2).applyMatrix4(m.matrixWorld)
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a))
      if (n.length() / 2 < MIN_AREA) continue
      n.normalize()
      T.push({ node: top.name, mat: m.material?.name ?? '?', n: n.clone(), d: n.dot(a), p: [a.clone(), b.clone(), c.clone()] })
    }
  })
  const groups = new Map() // by normal (2 mrad bins), then a sweep along the plane offset
  for (const t of T) {
    const key = `${Math.round(t.n.x * 500)},${Math.round(t.n.y * 500)},${Math.round(t.n.z * 500)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const area2 = (P) => P.reduce((s, A, i) => s + A[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * A[1], 0) / 2
  const clip = (poly, A, B) => { // Sutherland–Hodgman: keep the left of A→B (the clip triangle is counter-clockwise)
    const out = []
    const side = (P) => (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0])
    poly.forEach((P, i) => {
      const Q = poly[(i + 1) % poly.length], sp = side(P), sq = side(Q)
      if (sp >= 0) out.push(P)
      if (sp >= 0 !== sq >= 0) out.push([P[0] + (sp / (sp - sq)) * (Q[0] - P[0]), P[1] + (sp / (sp - sq)) * (Q[1] - P[1])])
    })
    return out
  }
  const hits = new Map()
  for (const g of groups.values()) {
    if (g.length < 2) continue
    g.sort((x, y) => x.d - y.d)
    const n0 = g[0].n
    const u = new Vector3(...(Math.abs(n0.y) < 0.9 ? [0, 1, 0] : [1, 0, 0])).cross(n0).normalize()
    const v = new Vector3().crossVectors(n0, u)
    for (const t of g) {
      t.q = t.p.map((q) => [q.dot(u), q.dot(v)])
      if (area2(t.q) < 0) t.q = [t.q[0], t.q[2], t.q[1]]
      t.lo = [Math.min(...t.q.map((q) => q[0])), Math.min(...t.q.map((q) => q[1]))]
      t.hi = [Math.max(...t.q.map((q) => q[0])), Math.max(...t.q.map((q) => q[1]))]
    }
    for (let i = 0; i < g.length; i++) {
      // d = n·p is measured from the world origin, where a normal 1 mrad off moves it by mm: sweep wide on d, then
      // test the real thing (normals within 2 mrad, t's corners on s's plane within TOL)
      for (let j = i + 1; j < g.length && g[j].d - g[i].d <= 0.02; j++) {
        const s = g[i], t = g[j]
        if (s.lo[0] >= t.hi[0] || t.lo[0] >= s.hi[0] || s.lo[1] >= t.hi[1] || t.lo[1] >= s.hi[1]) continue
        if (s.n.dot(t.n) < 1 - 2e-6 || t.p.some((q) => Math.abs(s.n.dot(e1.subVectors(q, s.p[0]))) > TOL)) continue
        let P = s.q
        for (let k = 0; k < 3 && P.length; k++) P = clip(P, t.q[k], t.q[(k + 1) % 3])
        const ar = P.length > 2 ? Math.abs(area2(P)) : 0
        if (ar < MIN_AREA) continue
        const key = [s.node, t.node].sort().join(' · ')
        const h = hits.get(key) ?? { area: 0, n: 0, at: [] }
        h.area += ar
        h.n++
        h.at.push([ar, s.p.reduce((acc, q) => acc.add(q), new Vector3()).divideScalar(3), s.n, `${s.mat} / ${t.mat}, ${(Math.max(...t.p.map((q) => Math.abs(s.n.dot(e1.subVectors(q, s.p[0]))))) * 1000).toFixed(3)} mm apart`])
        hits.set(key, h)
      }
    }
  }
  const rows = [...hits.entries()].sort((x, y) => y[1].area - x[1].area)
  const known = (k) => COPLANAR_KNOWN.find(([re]) => re.test(k))
  console.log(`\ncoplanar (#263): same-facing faces on one plane (±${TOL * 1000} mm) whose areas overlap, by node pair`)
  console.log('| pair | area (cm²) | triangle pairs | e.g. at (web) | |')
  console.log('|---|---|---|---|---|')
  for (const [k, h] of rows) {
    const [, e, nn] = h.at.reduce((x, y) => (y[0] > x[0] ? y : x))
    const kn = known(k)
    const verdict = kn ? `known ${kn[1]}: ${kn[2]}` : h.area < SMALL ? 'small' : 'FAIL'
    console.log(`| ${k} | ${(h.area * 1e4).toFixed(2)} | ${h.n} | ${f3(e)} n ${f3(nn).map((x) => +x.toFixed(2))} | ${verdict} |`)
    if (detail?.test(k)) for (const [ar, at, nn, mats] of h.at.sort((x, y) => y[0] - x[0])) console.log(`    ${(ar * 1e4).toFixed(2)} cm² at ${f3(at)} n ${f3(nn).map((x) => +x.toFixed(2))}  ${mats}`)
  }
  const newBad = rows.filter(([k, h]) => !known(k) && h.area >= SMALL)
  console.log(`coplanar: ${rows.length} pairs, ${newBad.length} failing (not known, >= ${SMALL * 1e4} cm²)`)
  if (newBad.length) fail('--overlap: coplanar faces (table above)')
}

// 5b) #164 hand fits: every prop with a <prop>_grip_r|l child has a contact point or more, and each
// <prop>_contact_* lies within 2 mm of the prop's surface (the prop and its sibling parts <prop>_* meshes, e.g. the
// book halves). Contacts with extras state (e.g. "open": a page only there once the book opens) are skipped
{
  scene.updateMatrixWorld(true)
  const props = scene.children.filter((o) => o.children.some((c) => /_grip_[lr]$/.test(c.name)))
  const tri = new Triangle()
  const near = new Vector3()
  let bad = 0
  for (const p of props) {
    const contacts = p.children.filter((c) => c.name.startsWith(`${p.name}_contact_`))
    if (!contacts.length) {
      console.log(`hand fit: ${p.name} has a grip but no contact point`)
      bad++
    }
    const meshes = []  // a prop with several materials is a group of meshes
    for (const o of [p, ...scene.children.filter((o) => o !== p && o.name.startsWith(`${p.name}_`))]) o.traverse((m) => m.isMesh && meshes.push(m))
    for (const c of contacts.filter((c) => !c.userData.state)) {
      const at = c.getWorldPosition(new Vector3())
      let best = Infinity
      for (const m of meshes) {
        const g = m.geometry
        const pos = g.attributes.position
        const idx = g.index
        const n = idx ? idx.count : pos.count
        const v = [new Vector3(), new Vector3(), new Vector3()]
        for (let i = 0; i < n; i += 3) {
          for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld)
          tri.set(v[0], v[1], v[2]).closestPointToPoint(at, near)
          best = Math.min(best, near.distanceTo(at))
        }
      }
      if (best > 0.002) {
        console.log(`hand fit: ${c.name} is ${(best * 1000).toFixed(1)} mm off ${p.name}'s surface`)
        bad++
      }
    }
  }
  console.log(`hand fit (#164): ${props.length} props with grips, ${bad} problems`)
  if (bad) fail('hand fit: contact points (above)')
}

// 6) --show: world position, bounds and extras
if (show)
  for (const o of scene.children.filter((x) => show.test(x.name))) {
    const box = new Box3().setFromObject(o)
    const size = box.isEmpty() ? '' : ` size=${JSON.stringify(f3(box.getSize(new Vector3())))}`
    console.log(`${o.name} pos=${JSON.stringify(f3(o.getWorldPosition(new Vector3())))}${size} ${JSON.stringify(o.userData)}`)
  }

if (failed) process.exit(1)
console.log('ok')
