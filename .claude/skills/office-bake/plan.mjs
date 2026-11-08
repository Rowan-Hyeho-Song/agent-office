// Top-down layout plan of office.glb as an SVG (#109): the room, every slot_* footprint by kind, wall items on
// their walls, and the nav_* spots. Overlaps show as darker areas (footprints are half transparent).
//
//   node .claude/skills/office-bake/plan.mjs [file.glb] [out.svg]      (defaults: public/models/office.glb, plan.svg)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const [file = 'public/models/office.glb', out = 'plan.svg'] = process.argv.slice(2)
await MeshoptDecoder.ready
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const buf = readFileSync(resolve(file))
const gltf = await new Promise((ok, no) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, no))
const scene = gltf.scene
scene.updateMatrixWorld(true)

const slots = scene.children.filter((o) => o.name.startsWith('slot_') && o.userData.size).map((o) => {
  const p = o.getWorldPosition(new Vector3())
  const [w, , d] = o.userData.size
  const c = o.userData.core // #147: the body alone, when the slot also holds its use room
  const core = c && { x0: c.at[0] - c.size[0] / 2, x1: c.at[0] + c.size[0] / 2, z0: c.at[2] - c.size[2] / 2, z1: c.at[2] + c.size[2] / 2 }
  return { name: o.name.slice(5), kind: o.userData.slot, wall: o.userData.wall, x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2, core }
})
const room = slots.find((s) => s.kind === 'room')
if (!room) throw new Error('no slot_room in this glb (built before #109?)')
const navs = scene.children.filter((o) => o.userData.nav).map((o) => ({ id: o.name.slice(4), kind: o.userData.nav, x: o.position.x, z: o.position.z, ry: o.userData.ry ?? 0, r: o.userData.r }))

const S = 90 // px per m
const M = 40 // margin px
const W = (room.x1 - room.x0) * S + 2 * M
const H = (room.z1 - room.z0) * S + 2 * M
const X = (x) => M + (x - room.x0) * S
const Z = (z) => M + (z - room.z0) * S // +z (toward the default camera) is down the page
const COL = { floor: '#c9a46b', decor: '#5a9a5a', clear: '#4df3ff', wall: '#ff8a5c' }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const parts = []
parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#0b0e13"/>`)
parts.push(`<rect x="${X(room.x0)}" y="${Z(room.z0)}" width="${(room.x1 - room.x0) * S}" height="${(room.z1 - room.z0) * S}" fill="#1a1f29" stroke="#8b93a5" stroke-width="3"/>`)
// 1 m grid
for (let x = Math.ceil(room.x0); x <= room.x1; x++) parts.push(`<line x1="${X(x)}" y1="${Z(room.z0)}" x2="${X(x)}" y2="${Z(room.z1)}" stroke="#262c38" stroke-width="1"/>`)
for (let z = Math.ceil(room.z0); z <= room.z1; z++) parts.push(`<line x1="${X(room.x0)}" y1="${Z(z)}" x2="${X(room.x1)}" y2="${Z(z)}" stroke="#262c38" stroke-width="1"/>`)
// floor things, then wall items as thick bars on their wall
for (const s of slots.filter((s) => !['room', 'wall'].includes(s.kind))) {
  const c = COL[s.kind]
  const dash = s.kind === 'clear' ? ' stroke-dasharray="6 4"' : ''
  parts.push(`<rect x="${X(s.x0)}" y="${Z(s.z0)}" width="${(s.x1 - s.x0) * S}" height="${(s.z1 - s.z0) * S}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="2"${dash}/>`)
  if (s.core) parts.push(`<rect x="${X(s.core.x0)}" y="${Z(s.core.z0)}" width="${(s.core.x1 - s.core.x0) * S}" height="${(s.core.z1 - s.core.z0) * S}" fill="none" stroke="#f3ead8" stroke-width="1.5" stroke-dasharray="2 3"/>`)
  parts.push(`<text x="${X((s.x0 + s.x1) / 2)}" y="${Z((s.z0 + s.z1) / 2) + 4}" fill="#f3ead8" font-size="12" font-family="monospace" text-anchor="middle">${esc(s.name)}</text>`)
}
// meeting rings (#147): the free circle r (dashed) and the 0.75 m ring the people stand on (dotted)
for (const n of navs.filter((n) => n.kind === 'meet_center' && n.r)) {
  parts.push(`<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="${n.r * S}" fill="#ff6fb1" fill-opacity="0.08" stroke="#ff6fb1" stroke-width="2" stroke-dasharray="8 5"/>`)
  parts.push(`<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="${0.75 * S}" fill="none" stroke="#ff6fb1" stroke-width="1" stroke-dasharray="2 4"/>`)
}
for (const s of slots.filter((s) => s.kind === 'wall')) {
  const t = 8
  const r = { n: [X(s.x0), Z(room.z0) - t, (s.x1 - s.x0) * S, t], s: [X(s.x0), Z(room.z1), (s.x1 - s.x0) * S, t], w: [X(room.x0) - t, Z(s.z0), t, (s.z1 - s.z0) * S], e: [X(room.x1), Z(s.z0), t, (s.z1 - s.z0) * S] }[s.wall]
  if (!r) continue
  parts.push(`<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="${COL.wall}"/>`)
  const [tx, ty, anchor] = { n: [r[0] + r[2] / 2, r[1] - 6, 'middle'], s: [r[0] + r[2] / 2, r[1] + 22, 'middle'], w: [r[0] - 4, r[1] + r[3] / 2, 'end'], e: [r[0] + 12, r[1] + r[3] / 2, 'start'] }[s.wall]
  parts.push(`<text x="${tx}" y="${ty}" fill="${COL.wall}" font-size="11" font-family="monospace" text-anchor="${anchor}">${esc(s.name)}</text>`)
}
// nav spots: a dot and a short tick in the facing direction (ry turns local -z)
for (const n of navs) {
  const c = n.kind === 'hall' ? '#6b7385' : '#ffd166'
  const fx = -Math.sin(n.ry) * 0.25
  const fz = -Math.cos(n.ry) * 0.25
  parts.push(`<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="4" fill="${c}"/>`)
  if (n.kind !== 'hall') parts.push(`<line x1="${X(n.x)}" y1="${Z(n.z)}" x2="${X(n.x + fx)}" y2="${Z(n.z + fz)}" stroke="${c}" stroke-width="2"/>`)
  parts.push(`<text x="${X(n.x) + 6}" y="${Z(n.z) - 5}" fill="${c}" font-size="9" font-family="monospace">${esc(n.id)}</text>`)
}
const legend = `room ${(room.x1 - room.x0).toFixed(1)} × ${(room.z1 - room.z0).toFixed(1)} m · 1 m grid · tan floor · green decor · cyan dashed clear · orange wall items · dotted = core · pink = meeting ring · yellow nav · grey hall · camera side = bottom/right`
parts.push(`<text x="${M}" y="${H - 12}" fill="#a39d90" font-size="12" font-family="monospace">${esc(legend)}</text>`)
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join('\n')}\n</svg>\n`)
console.log(`wrote ${out} (${slots.length - 1} slots, ${navs.length} nav spots)`)
