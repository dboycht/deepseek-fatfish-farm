/**
 * 端到端自检：启动真实 Electron，跑一遍数据层（建鱼 / 聊天 / 蒸馏 / 检索 / 导出 / 导入）。
 * 用法：pnpm build && node scripts/selftest.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const base = mkdtempSync(join(tmpdir(), 'fatfish-selftest-'))
const userData = join(base, 'userData')
const pond = join(base, 'pond')
const report = join(base, 'report.json')
mkdirSync(userData, { recursive: true })
mkdirSync(pond, { recursive: true })

writeFileSync(
  join(userData, 'config.json'),
  JSON.stringify(
    {
      v: 1,
      pondRoot: pond,
      onboarded: true,
      provider: {
        mode: 'mock',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        temperature: 1.1,
        maxTokens: 1600,
        reasoning: false,
        timeoutMs: 60000,
        vision: { enabled: false, baseUrl: '', model: '' },
        image: { enabled: false, baseUrl: '', model: '', size: '1024x1024' }
      },
      memory: { auto: true, every: 6, maxCards: 400, recall: 6, allowDraw: false },
      ui: { theme: 'abyss', showReasoning: true, fontSize: 15, animate: true },
      plugins: { disabled: [] }
    },
    null,
    2
  ),
  'utf8'
)

const env = { ...process.env, FATFISH_USER_DATA: userData, FATFISH_SELFTEST: report }
delete env.ELECTRON_RUN_AS_NODE

const run = spawnSync(electron, ['.'], { cwd: root, stdio: 'inherit', env })
if (!existsSync(report)) {
  console.error('❌ 自检没有产出报告，退出码', run.status)
  process.exit(1)
}
const data = JSON.parse(readFileSync(report, 'utf8'))
for (const step of data.report) {
  console.log(`${step.ok ? '✅' : '❌'} ${step.name}${step.error ? ` — ${step.error}` : ''}`)
  if (step.detail) console.log('   ', JSON.stringify(step.detail).slice(0, 300))
}
console.log(data.ok ? '\n✅ 自检全部通过' : '\n❌ 自检有失败项')
process.exit(data.ok ? 0 : 1)
