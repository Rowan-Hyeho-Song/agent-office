/// <reference types="node" />
import { it } from 'vitest'
import { Session } from 'node:inspector/promises'
import { simulateDay } from './traffic.sim'
it('prof', async () => {
  const s = new Session()
  s.connect()
  await s.post('Profiler.enable')
  await s.post('Profiler.setSamplingInterval', { interval: 1000 })
  await s.post('Profiler.start')
  simulateDay({ fromMin: 0, toMin: 24 * 60 })
  const { profile } = (await s.post('Profiler.stop')) as any
  const self = new Map<string, number>()
  const dt = profile.timeDeltas as number[]
  const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]))
  profile.samples.forEach((id: number, i: number) => {
    const n = byId.get(id)
    const f = n.callFrame
    const k = `${f.functionName || '(anon)'} ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0))
  })
  const tot = [...self.values()].reduce((a, b) => a + b, 0)
  console.log('TOTAL', (tot / 1e3).toFixed(0), 'ms')
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('SELF', (v / 1e3).toFixed(0).padStart(7), k)
}, 600000)
