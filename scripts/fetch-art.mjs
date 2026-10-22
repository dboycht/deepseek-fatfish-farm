/**
 * 拉取第三方角色素材（开发期一次性脚本，产物入库）。
 *
 * 来源：YunYueSama/codex-deepseek-pet
 * 许可：大肥鱼项目署名许可 1.0（允许使用/修改/分享/商用，须署名并保留许可）
 *      https://github.com/YunYueSama/codex-deepseek-pet/blob/main/LICENSE
 *
 * 只取 assets/whale 下作者有权授权的透明立绘与表情表；不取社区参考图。
 * 运行：node scripts/fetch-art.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'art')
mkdirSync(outDir, { recursive: true })

const REPO = 'YunYueSama/codex-deepseek-pet'
const WANT = ['portrait.png', 'idle-front.png', 'expressions.png', 'actions.png']
const RAW_WANT = ['LICENSE', 'ASSET_LICENSE.md', 'assets/whale/manifest.json']

let token = ''
try {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  token = (out.match(/^password=(.*)$/m) || [])[1] || ''
} catch {
  /* 没凭据也能走匿名 API，只是限额低 */
}

const headers = { 'User-Agent': 'fatfish-farm', Accept: 'application/vnd.github+json' }
if (token) headers.Authorization = `Bearer ${token}`

async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

const meta = await api('/git/trees/main?recursive=1')
const tree = meta.tree
const commit = meta.sha

async function fetchText(path) {
  const file = tree.find((t) => t.path === path)
  if (!file) throw new Error(`找不到 ${path}`)
  const blob = await api(`/git/blobs/${file.sha}`)
  return Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8')
}

const credits = {
  source: `https://github.com/${REPO}`,
  commit,
  license: '大肥鱼项目署名许可 1.0',
  licenseUrl: `https://github.com/${REPO}/blob/main/LICENSE`,
  author: 'YunYueSama',
  files: []
}

for (const name of WANT) {
  const file = tree.find((t) => t.path === `assets/whale/${name}`)
  if (!file) {
    console.warn('跳过（不存在）', name)
    continue
  }
  const blob = await api(`/git/blobs/${file.sha}`)
  const buf = Buffer.from(blob.content, 'base64')
  writeFileSync(join(outDir, name), buf)
  credits.files.push({ name, sourcePath: `assets/whale/${name}`, bytes: buf.byteLength })
  console.log('✅', name, (buf.byteLength / 1024).toFixed(0) + ' KB')
}

for (const path of RAW_WANT) {
  try {
    const buf = await fetchText(path)
    const name = path.endsWith('.md') ? 'LICENSE-ASSET.md' : path.endsWith('.json') ? 'manifest.json' : 'LICENSE.txt'
    writeFileSync(join(outDir, name), buf)
    console.log('✅', name)
  } catch (e) {
    console.warn('跳过', path, e.message)
  }
}

writeFileSync(join(outDir, 'CREDITS.json'), JSON.stringify(credits, null, 2), 'utf8')
console.log('done ->', outDir)
