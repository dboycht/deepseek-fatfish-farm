/**
 * 生成示例贴纸包：从授权表情表裁 3 格，放进 examples/sticker-pack/。
 * 仅开发期运行；产物入库，供用户照格式用 GPT 批量生成。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'examples', 'sticker-pack')
mkdirSync(outDir, { recursive: true })

const manifest = {
  id: 'fatfish-sample-pack',
  name: '示例：大肥鱼补充表情',
  version: '1.0.0',
  author: 'fatfish-farm',
  license: 'CC-BY-NC-4.0',
  description: '三张示意表情，展示文件命名与 manifest 格式。用 GPT 生成自己的包时可以照这个结构。',
  items: [
    { id: 'sample-happy', label: '开心到冒泡', file: 'sample-happy.png', tags: ['开心', '得意'] },
    { id: 'sample-hungry', label: '干饭魂', file: 'sample-hungry.png', tags: ['饿', '干饭'] },
    { id: 'sample-sleepy', label: '困成海螺', file: 'sample-sleepy.png', tags: ['困', '晚安'] }
  ]
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

const code = `
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.whenReady().then(() => {
  const sheetPath = path.join(${JSON.stringify(root)}, 'src', 'renderer', 'src', 'assets', 'art', 'expressions.png')
  const outDir = path.join(${JSON.stringify(root)}, 'examples', 'sticker-pack')
  const sheet = nativeImage.createFromPath(sheetPath)
  const cells = [
    ['sample-happy', 3, 1],
    ['sample-hungry', 0, 2],
    ['sample-sleepy', 3, 3]
  ]
  for (const [name, col, row] of cells) {
    const cell = sheet.crop({ x: col * 512, y: row * 512, width: 512, height: 512 })
    fs.writeFileSync(path.join(outDir, name + '.png'), cell.toPNG())
    console.log('wrote', name)
  }
  app.quit()
})
`
const script = join(outDir, '_make.cjs')
writeFileSync(script, code, 'utf8')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const run = spawnSync(electron, [script], { cwd: root, stdio: 'inherit', env })
rmSync(script, { force: true })
process.exit(run.status ?? 1)
