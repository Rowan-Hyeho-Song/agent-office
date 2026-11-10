// `pnpm hand:measure [--agent N] [--side l|r] [--pose id] [--json] [--angles '<HandAngles json>']`
// The app's own measurement of the robot hand's poses (docs/design/hand-poses.md 4): runs src/office/handMeasure.report.test.ts under
// vitest (same glb, same rig and joint math as the app) and prints its report. The test is skipped in the normal suite.
// Examples:
//   pnpm hand:measure                                  every pose of agent_0's right hand, as markdown
//   pnpm hand:measure --pose ok --json
//   pnpm hand:measure --angles '{"f":[{"mcp":45,"pip":60,"dip":45}],"thumb":{"cmcFlex":10,"cmcAbd":10,"mcp":10,"ip":80}}'
//       --angles is HandAngles-shaped, partial (degrees); it is laid over --pose, or over "straight" (no bend, the baked fan) when no pose is given

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'



const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const args = process.argv.slice(2).filter((a) => a !== '--')
const res = spawnSync(process.execPath, [vitest, 'run', 'src/office/handMeasure.report.test.ts', '--reporter=default'], {
  env: { ...process.env, HAND_MEASURE: '1', HAND_MEASURE_ARGS: JSON.stringify(args) },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const out = (res.stdout ?? '') + (res.stderr ?? '')
const m = out.match(/<<<HAND_MEASURE\n([\s\S]*?)\nHAND_MEASURE>>>/)
if (m) {
  process.stdout.write(m[1] + '\n')
} else {
  process.stderr.write(out.split('\n').filter((l) => !/THREE\.Material|trace-deprecation|DeprecationWarning|require\("three"\)/.test(l)).join('\n'))
  process.exit(res.status || 1)
}
