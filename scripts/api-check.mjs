// Do the serverless functions load under Node ESM the way Vercel runs them? (#102)
// Vercel turns each api/*.ts into JS without touching import specifiers, so an extensionless relative import
// ('./filter' instead of './filter.js') fails at startup with ERR_MODULE_NOT_FOUND (500 FUNCTION_INVOCATION_FAILED).
// This compiles api/ and what it reaches with tsc (tsconfig.node.json, NodeNext), then imports every handler
// with plain Node. Nothing is called: no network, no environment needed.
//
//   pnpm api:check

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
// inside the repo so the compiled files find node_modules and package.json ("type": "module") by walking up
const out = join(root, 'node_modules', '.tmp', 'api-check')
rmSync(out, { recursive: true, force: true })
let failed = 0
try {
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.node.json'),
    '--noEmit', 'false', '--outDir', out, '--rootDir', root, '--incremental', 'false', '--tsBuildInfoFile', 'null'], { stdio: 'inherit' })
} catch {
  // type errors (e.g. TS2835: a relative import without .js) still emit JS: count them, then try the imports anyway
  failed++
  console.log('✗ tsc (tsconfig.node.json, NodeNext): 오류 위')
}

for (const f of readdirSync(join(root, 'api')).filter((f) => f.endsWith('.ts')).sort()) {
  const file = join(out, 'api', f.replace(/\.ts$/, '.js'))
  try {
    const mod = await import(pathToFileURL(file).href)
    const handlers = ['GET', 'POST', 'default'].filter((k) => typeof mod[k] === 'function')
    if (!handlers.length) throw new Error('no GET / POST / default export')
    console.log(`✓ api/${f}  ${handlers.join(', ')}`)
  } catch (e) {
    failed++
    console.log(`✗ api/${f}  ${e.code ?? ''} ${e.message.split('\n')[0]}`)
  }
}
console.log(failed ? `실패: ${failed}개 함수가 Node ESM에서 열리지 않음` : '통과: 모든 함수가 Node ESM에서 열림')
process.exit(failed ? 1 : 0)
