// Usage: CHROME_PATH=<chrome> node assets/posters/make-posters.cjs public/posters  (needs playwright-core)
// three pixel posters for the lounge frames (#280 lounge-props.md 6). Drawn on a low-res grid, scaled up with nearest-neighbour.
const fs = require('fs'), { chromium } = require('playwright-core')
const OUT = process.argv[2]
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<canvas id="c"></canvas>
<script>
const C = { void:'#07090c', surf:'#0b0e13', line:'#262d36', text:'#f3ead8', muted:'#a39d90', faint:'#6f6a60', amber:'#ffb347', cyan:'#4df3ff', mag:'#ff3ea5', lav:'#8f9bff', echo:'#f2ffc4', oak:'#cdb894', paper:'#efe6d2', wood:'#7a5236', graph:'#3a3f48', ivory:'#e9e4d8' }
// 5x7 pixel font for the capitals, digits and . we need
const F = {
A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','11110','10001','10001','10001','11110'],
C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
E:['11111','10000','11110','10000','10000','10000','11111'], F:['11111','10000','11110','10000','10000','10000','10000'],
G:['01111','10000','10000','10011','10001','10001','01111'], H:['10001','10001','11111','10001','10001','10001','10001'],
I:['11111','00100','00100','00100','00100','00100','11111'], K:['10001','10010','11100','10010','10001','10001','10001'],
L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10001','10001','10001','10001'],
N:['10001','11001','10101','10011','10001','10001','10001'], O:['01110','10001','10001','10001','10001','10001','01110'],
P:['11110','10001','10001','11110','10000','10000','10000'], R:['11110','10001','10001','11110','10010','10001','10001'],
S:['01111','10000','01110','00001','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'],
V:['10001','10001','10001','10001','01010','01010','00100'], W:['10001','10001','10001','10101','10101','11011','10001'],
Y:['10001','01010','00100','00100','00100','00100','00100'], '.':['0','0','0','0','0','0','1'], ' ':['000','000','000','000','000','000','000'],
'-':['000','000','000','111','000','000','000'], '0':['01110','10011','10101','11001','10001','10001','01110'], '5':['11111','10000','11110','00001','00001','10001','01110']
}
function mk(W, H, S) { const c = document.getElementById('c'); c.width = W * S; c.height = H * S; const x = c.getContext('2d'); x.imageSmoothingEnabled = false
  const px = (i, j, col) => { x.fillStyle = col; x.fillRect(i * S, j * S, S, S) }
  const rect = (i, j, w, h, col) => { x.fillStyle = col; x.fillRect(i * S, j * S, w * S, h * S) }
  const text = (s, i, j, col, k = 1) => { let cx = i; for (const ch of s) { const g = F[ch] || F[' ']; g.forEach((row, r) => [...row].forEach((b, q) => { if (b === '1') rect(cx + q * k, j + r * k, k, k, col) })); cx += (g[0].length + 1) * k } return cx }
  const textW = (s, k = 1) => [...s].reduce((a, ch) => a + ((F[ch] || F[' '])[0].length + 1) * k, -k)
  const center = (s, j, col, k = 1) => text(s, Math.round((W - textW(s, k)) / 2), j, col, k)
  return { c, x, px, rect, text, center, textW, W, H, S } }
// a robot head: box + screen + two eyes + topper
function bot(g, i, j, col, kind) { const { rect, px } = g
  rect(i, j + 4, 16, 12, C.ivory); rect(i + 2, j + 6, 12, 8, C.surf); rect(i + 4, j + 8, 2, 3, col); rect(i + 10, j + 8, 2, 3, col); rect(i + 6, j + 12, 4, 1, col)
  rect(i, j + 16, 16, 1, C.faint)
  if (kind === 0) { rect(i + 7, j, 1, 4, C.graph); rect(i + 6, j - 2, 3, 2, col) }            // memo antenna
  if (kind === 1) { rect(i + 4, j + 1, 8, 1, col); rect(i + 4, j + 1, 1, 3, col); rect(i + 11, j + 1, 1, 3, col) } // mesh gizmo
  if (kind === 2) { rect(i + 1, j + 2, 14, 2, col); rect(i + 3, j + 1, 10, 1, col) }        // hue beret
  if (kind === 3) { rect(i - 1, j + 6, 2, 6, col); rect(i + 15, j + 6, 2, 6, col); rect(i + 1, j + 2, 14, 1, C.graph) } // loop headphones
  if (kind === 4) { rect(i + 5, j - 2, 1, 6, C.muted); rect(i + 10, j - 2, 1, 6, C.muted); rect(i + 5, j + 3, 6, 1, C.muted) } // echo fork
}
const posters = []
// 0: AGENT OFFICE, 0.5 x 0.7 -> 128 x 179 grid, x4 = 512 x 716
{ const g = mk(128, 192, 4); const { rect, center, px } = g
  rect(0, 0, 128, 192, C.void); rect(4, 4, 120, 184, C.surf)
  for (let k = 0; k < 40; k++) px((k * 37) % 116 + 6, (k * 53) % 60 + 8, k % 3 ? C.faint : C.line)  // dim star field
  rect(14, 96, 100, 26, C.oak); rect(14, 122, 100, 3, C.graph); rect(18, 125, 3, 14, C.graph); rect(107, 125, 3, 14, C.graph) // the pod desk
  ;[22, 46, 70, 94].forEach((i) => { rect(i + 2, 86, 12, 9, C.graph); rect(i + 3, 87, 10, 7, C.void); rect(i + 4, 89, 6, 1, C.cyan); rect(i + 4, 91, 4, 1, C.muted); rect(i + 7, 95, 2, 1, C.graph) }) // monitors
  const cols = [C.amber, C.lav, C.mag, C.cyan, C.echo]
  ;[[18, 64], [42, 60], [66, 64], [90, 60]].forEach(([i, j], k) => bot(g, i, j, cols[k], k))
  bot(g, 56, 30, cols[4], 4)
  center('AGENT', 150, C.text, 2); center('OFFICE', 168, C.amber, 2)
  posters.push(['poster_agent_office.png', g.c.toDataURL()]) }
// 1: DESK ROOM, 0.4 x 0.5 -> 128 x 160 grid, x4 = 512 x 640
{ const g = mk(128, 171, 4); const { rect, center, px } = g
  rect(0, 0, 128, 171, C.void); rect(4, 4, 120, 163, C.surf)
  // an isometric-ish diorama: floor diamond + desk + CRT
  for (let r = 0; r < 30; r++) rect(64 - r * 2, 70 + r, r * 4, 1, r % 2 ? C.wood : '#6b4a32')
  for (let r = 0; r < 30; r++) rect(4 + r * 2, 100 + r, 120 - r * 4, 1, r % 2 ? C.wood : '#6b4a32')
  rect(40, 72, 48, 6, C.oak); rect(42, 78, 3, 20, C.graph); rect(83, 78, 3, 20, C.graph)            // desk
  rect(50, 46, 28, 24, C.ivory); rect(53, 49, 22, 16, C.surf); rect(56, 52, 10, 1, C.amber); rect(56, 55, 14, 1, C.amber); rect(56, 58, 6, 1, C.amber); rect(57, 61, 2, 2, C.amber) // CRT
  rect(60, 70, 8, 2, C.ivory)
  rect(30, 64, 6, 8, '#5f8a4f'); rect(31, 72, 4, 0, C.graph)                                         // plant
  center('DESK', 132, C.text, 2); center('ROOM', 150, C.amber, 2)
  posters.push(['poster_desk_room.png', g.c.toDataURL()]) }
// 2: ROWANSONG.DEV, 0.4 x 0.5 -> 128 x 160 grid
{ const g = mk(128, 171, 4); const { rect, center } = g
  rect(0, 0, 128, 171, C.void); rect(4, 4, 120, 163, C.surf)
  rect(18, 18, 92, 66, C.line); rect(20, 20, 88, 62, C.void)                                          // a terminal window
  rect(20, 20, 88, 6, C.line); rect(23, 22, 2, 2, C.mag); rect(27, 22, 2, 2, C.amber); rect(31, 22, 2, 2, '#7dff9b')
  const lines = [[C.cyan, 30], [C.muted, 44], [C.muted, 36], [C.amber, 22], [C.muted, 50], [C.cyan, 16]]
  lines.forEach(([col, w], k) => { rect(25, 31 + k * 7, 4, 2, C.faint); rect(31, 31 + k * 7, w, 2, col) })
  rect(31, 74, 4, 4, C.cyan)                                                                          // cursor
  center('ROWAN', 104, C.text, 2); center('SONG', 122, C.text, 2); center('.DEV', 140, C.cyan, 2)
  posters.push(['poster_rowansong.png', g.c.toDataURL()]) }
window.__posters = posters
</script>`
;(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  const p = await b.newPage(); await p.setContent(html); await p.waitForTimeout(300)
  const list = await p.evaluate(() => window.__posters)
  for (const [name, url] of list) { fs.writeFileSync(OUT + '/' + name, Buffer.from(url.split(',')[1], 'base64')); console.log(name) }
  await b.close()
})()
