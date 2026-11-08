// Check office.glb the way the app reads it (three's GLTFLoader + MeshoptDecoder), in plain Node — no browser.
//
//   node .claude/skills/office-bake/check-glb.mjs [file.glb] [--want a,b,c] [--show <regex>] [--overlap]
//
// --overlap (#109): reads the slot_<name> empties (each object's footprint, extras slot = kind, size, wall) and checks
// the layout rules in SKILL.md 10: the gap between every pair against its minimum, walls, the room's inside.
//
// Prints: file size, top-level nodes by kind (atlas / live / nav / hit / surface / screen / prop), triangles,
// names that look like Blender duplicates ("x.001" → "x001"), live parts with neither pivot_at nor a reason to
// skip it, canvas-cell labels whose UVs leave their cell, and for --show the world position + extras of each match.
// Exit code 1 when a --want name is missing or a check fails.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const args = process.argv.slice(2)
const opt = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const file = resolve(args.find((a, i) => !a.startsWith('--') && !['--want', '--show'].includes(args[i - 1])) ?? 'public/models/office.glb')
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
  const rows = []
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = [items[i], items[j]].sort((x, y) => x.kind.localeCompare(y.kind))
      let need, g, where
      if (a.kind === 'wall' && b.kind === 'wall') {
        if (a.wall !== b.wall) continue
        ;[need, g, where] = [WALL_GAP, gap(a, b, [along[a.wall], 1]), `wall ${a.wall}`]
      } else if (a.kind === 'wall' || b.kind === 'wall') {
        ;[need, g, where] = [0, gap(a, b, [0, 1, 2]), '3D'] // a floor thing may stand under a wall item, not through it
      } else {
        need = NEED[`${a.kind}|${b.kind}`] ?? 0.1
        ;[g, where] = [gap(a, b, [0, 2]), 'floor']
      }
      if (g < need + 0.3) rows.push({ pair: `${a.name} · ${b.name}`, kinds: `${a.kind}/${b.kind}`, where, gap: g, need, ok: g >= need - 1e-3 })
    }
  rows.sort((x, y) => x.gap - x.need - (y.gap - y.need))
  console.log('\noverlap: pairs closer than their minimum + 0.3 m (gap < 0 = overlapping)')
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

// 6) --show: world position, bounds and extras
if (show)
  for (const o of scene.children.filter((x) => show.test(x.name))) {
    const box = new Box3().setFromObject(o)
    const size = box.isEmpty() ? '' : ` size=${JSON.stringify(f3(box.getSize(new Vector3())))}`
    console.log(`${o.name} pos=${JSON.stringify(f3(o.getWorldPosition(new Vector3())))}${size} ${JSON.stringify(o.userData)}`)
  }

if (failed) process.exit(1)
console.log('ok')
