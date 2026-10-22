/**
 * 测试入口：用 esbuild 把 TS 测试打成单文件，再用 node --test 跑。
 * 不引入额外测试框架，保持依赖精简。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.tmp', 'core.test.mjs')
mkdirSync(dirname(out), { recursive: true })

await build({
  entryPoints: [join(root, 'tests', 'core.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  // yaml 是 CJS 且内部有 require('process')，打成 ESM 会炸；交给 Node 原生解析
  external: ['yaml'],
  logLevel: 'warning'
})

const run = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit', cwd: root })
process.exit(run.status ?? 1)
