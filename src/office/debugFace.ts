// ?debug=1 (#193 2/2): window.__office.face
//   set(agent, expression | null)   force an expression on one agent ('agent_2' or 2) or on 'all'; null = back to the real ones
//   sheet()                         a data URL of the judging table of robots.md 6: the five faces (rows) x the 15 expressions (columns), drawn by the real screen code
//   stats()                         per agent: the expression shown, canvas redraws since the start, the cost of the last / the average redraw (ms)

import { EXPRESSIONS, EXPRESSION_KO, newParams, type Expression } from './faceModel'
import { FaceScreen, FACE_CANVAS } from './faceScreen'
import { AGENTS, AGENT_COLORS, AGENT_INFO, type OfficeWorld } from './world'

export function makeFaceTools(world: OfficeWorld) {
  const ids = (agent: string | number) => (agent === 'all' ? Object.keys(world.rigs) : [typeof agent === 'number' ? `agent_${agent}` : agent])
  return {
    set(agent: string | number, expression: Expression | null) {
      if (expression !== null && !EXPRESSIONS.includes(expression)) throw new Error(`unknown expression: ${expression}`)
      for (const id of ids(agent)) world.rigs[id]?.forceFace(expression)
    },
    sheet(scale = 0.5): string {
      const w = Math.round(FACE_CANVAS.w * scale)
      const h = Math.round(FACE_CANVAS.h * scale)
      const pad = 6
      const left = 60
      const top = 34
      const c = document.createElement('canvas')
      c.width = left + EXPRESSIONS.length * (w + pad)
      c.height = top + AGENTS.length * (h + pad)
      const g = c.getContext('2d')!
      g.fillStyle = '#0c0f14'
      g.fillRect(0, 0, c.width, c.height)
      g.font = '13px sans-serif'
      g.textAlign = 'center'
      EXPRESSIONS.forEach((e, x) => {
        g.fillStyle = '#c9c3b5'
        g.fillText(EXPRESSION_KO[e], left + x * (w + pad) + w / 2, 22)
      })
      AGENTS.forEach((a, y) => {
        g.fillStyle = AGENT_COLORS[a]
        g.fillText(AGENT_INFO[a].name, left / 2, top + y * (h + pad) + h / 2)
        EXPRESSIONS.forEach((e, x) => {
          const screen = new FaceScreen(AGENT_COLORS[a], y)
          const p = screen.params
          Object.assign(p, newParams(), { agent: y, expr: e, red: e === 'embarrassed', amp: 0.4 })
          screen.draw()
          g.drawImage(screen.canvas, left + x * (w + pad), top + y * (h + pad), w, h)
          screen.texture.dispose()
        })
      })
      return c.toDataURL('image/png')
    },
    stats() {
      return Object.fromEntries(Object.entries(world.rigs).map(([id, r]) => [id, r.faceState()]))
    },
  }
}
