/**
 * 从授权立绘裁一张应用图标（PNG + 256 尺寸的 PNG-ICO）。
 * 运行：node scripts/make-icon.mjs（会自动用 electron 执行）
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
mkdirSync(join(root, 'build'), { recursive: true })

const code = `
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.whenReady().then(() => {
  const src = path.join(${JSON.stringify(root)}, 'resources', 'art', 'portrait.png')
  const img = nativeImage.createFromPath(src)
  const { width, height } = img.getSize()
  const crop = img.crop({
    x: Math.round(width * 0.255),
    y: Math.round(height * 0.09),
    width: Math.round(width * 0.49),
    height: Math.round(height * 0.49)
  })
  const png = crop.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
  fs.writeFileSync(path.join(${JSON.stringify(root)}, 'build', 'icon.png'), png)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0)
  entry.writeUInt8(0, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  fs.writeFileSync(path.join(${JSON.stringify(root)}, 'build', 'icon.ico'), Buffer.concat([header, entry, png]))
  console.log('icon ok', png.length)
  app.quit()
})
`

const script = join(root, 'build', '_make-icon.cjs')
const { writeFileSync } = await import('node:fs')
writeFileSync(script, code, 'utf8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const run = spawnSync(electron, [script], { cwd: root, stdio: 'inherit', env })
process.exit(run.status ?? 1)
