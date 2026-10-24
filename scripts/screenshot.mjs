/**
 * 实机截图：启动真实的 Electron 窗口，等界面渲染完成后用 webContents.capturePage() 抓图。
 * 用法：node scripts/screenshot.mjs [场景...]      默认 main / onboarding / settings
 * 依赖：先 `pnpm build`（会读取 out/ 里的产物）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanWorkDir } from './lib/work-dir.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outDir = join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })

const SCENES = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const scenes = SCENES.length ? SCENES : ['main', 'onboarding', 'settings']

if (!existsSync(electron)) {
  console.error('找不到 Electron 可执行文件：', electron)
  process.exit(1)
}
if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('还没构建，先跑 pnpm build')
  process.exit(1)
}

try {
  for (const scene of scenes) {
    const seed = spawnSync(process.execPath, [join(root, 'scripts', 'seed-demo.mjs')], {
      encoding: 'utf8'
    })
    if (seed.status !== 0) {
      console.error('造演示数据失败：', seed.stderr)
      process.exitCode = 1
      break
    }
    const { userData } = JSON.parse(seed.stdout.trim().split('\n').pop())

    if (scene === 'onboarding') {
      const cfgPath = join(userData, 'config.json')
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      cfg.onboarded = false
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
    }

    const shot = join(outDir, `${scene}.png`)
    // 注意：DSH 的 shell 里带着 ELECTRON_RUN_AS_NODE=1，会让 electron.exe 退化成纯 Node，
    // 表现为 protocol 为 undefined。必须在子进程环境里删掉它。
    const env = {
      ...process.env,
      FATFISH_USER_DATA: userData,
      FATFISH_SHOT: shot,
      FATFISH_SCENE: scene === 'main' || scene === 'onboarding' ? '' : scene
    }
    delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(electron, ['.'], {
      cwd: root,
      stdio: 'inherit',
      env
    })
    if (run.status !== 0 && run.status !== null) {
      console.error(`场景 ${scene} 退出码 ${run.status}`)
    }
    if (!existsSync(shot)) {
      console.error(`❌ 场景 ${scene} 没有产出截图`)
      process.exitCode = 1
    } else {
      const size = readFileSync(shot).byteLength
      console.log(`✅ ${scene} -> ${shot} (${(size / 1024).toFixed(1)} KB)`)
    }
  }
} finally {
  // 规则 18：截图完立即清掉项目内演示数据（失败也清）
  cleanWorkDir('demo')
}
