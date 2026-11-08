// Check office.glb the way the app reads it (three's GLTFLoader + MeshoptDecoder), in plain Node — no browser.
//
//   node .claude/skills/office-bake/check-glb.mjs [file.glb] [--want a,b,c] [--show <regex>]
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

// 5) --show: world position, bounds and extras
if (show)
  for (const o of scene.children.filter((x) => show.test(x.name))) {
    const box = new Box3().setFromObject(o)
    const size = box.isEmpty() ? '' : ` size=${JSON.stringify(f3(box.getSize(new Vector3())))}`
    console.log(`${o.name} pos=${JSON.stringify(f3(o.getWorldPosition(new Vector3())))}${size} ${JSON.stringify(o.userData)}`)
  }

if (failed) process.exit(1)
console.log('ok')
