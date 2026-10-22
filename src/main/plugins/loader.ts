import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { app } from 'electron'
import { pathExists, readJSON } from '../util/fsx'
import { loadConfig, saveConfig } from '../config'
import { cachedProfile, patchStats, pondRoot } from '../store/fish'
import { loadCards } from '../store/memory'
import { levelFromExp } from '@shared/persona'
import type { AppConfig, FishProfile, FishStats, MemoryCard, PluginInfo, PluginManifest } from '@shared/types'

/**
 * 插件系统（主进程侧）。
 *
 *  - 插件目录：内置 `<app>/plugins/<id>/`（随安装包分发）+ 用户 `<userData>/plugins/<id>/`
 *  - `manifest.json` 声明元信息；可选 `main`（CommonJS）导出 `activate(api)`
 *  - 可选 `panel` 提供一个 HTML 面板，渲染进程用 iframe 打开
 *    （协议 fatfish-plugin://，见 plugins/protocol.ts）
 *  - 插件通过 api 注册命令；渲染进程用 'plugins:invoke' 调用
 *  - 插件抛错只影响自己，不会带崩主进程
 */

declare const require: (id: string) => unknown

export interface PluginCommand {
  id: string
  title: string
  run: (payload?: unknown) => unknown | Promise<unknown>
}

export interface PluginApi {
  pluginId: string
  manifest: PluginManifest
  config: () => Promise<AppConfig>
  registerCommand: (cmd: PluginCommand) => void
  /** 往渲染进程推一个自定义事件（渲染端用 onPluginEvent 接收） */
  emit: (type: string, payload?: unknown) => void
  log: (...args: unknown[]) => void
  /** 只读：拿到某只肥鱼的档案 */
  getFish: (fishId: string) => Promise<FishProfile | null>
  /** 写入：给肥鱼加属性（token / 心情 / 饿度 / 经验） */
  addStats: (fishId: string, patch: Partial<FishStats>) => Promise<FishProfile | null>
  /** 只读：看看它记得什么 */
  listMemories: (fishId: string) => Promise<MemoryCard[]>
}

interface LoadedPlugin {
  manifest: PluginManifest
  dir: string
  commands: Map<string, PluginCommand>
  emit: (type: string, payload?: unknown) => void
  error?: string
}

const loaded = new Map<string, LoadedPlugin>()
let emitter: (pluginId: string, type: string, payload?: unknown) => void = () => {}

export function setPluginEmitter(fn: (pluginId: string, type: string, payload?: unknown) => void): void {
  emitter = fn
  for (const p of loaded.values()) p.emit = (type, payload) => emitter(p.manifest.id, type, payload)
}

export function bundledPluginsDir(): string {
  // 打包后：<resources>/plugins；开发时：仓库根 ./plugins
  return app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), 'plugins')
}

export function userPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

async function readManifest(dir: string): Promise<PluginManifest | null> {
  const file = join(dir, 'manifest.json')
  if (!(await pathExists(file))) return null
  const raw = await readJSON<Partial<PluginManifest> | null>(file, null)
  if (!raw || !raw.id || !raw.name) return null
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: String(raw.version ?? '0.0.0'),
    description: raw.description,
    author: raw.author,
    main: raw.main,
    panel: raw.panel,
    permissions: raw.permissions ?? [],
    dir
  }
}

async function scanRoot(root: string, builtin: boolean): Promise<PluginManifest[]> {
  const out: PluginManifest[] = []
  let names: string[] = []
  try {
    names = await fs.readdir(root)
  } catch {
    return out
  }
  for (const name of names) {
    const dir = join(root, name)
    const manifest = await readManifest(dir)
    if (!manifest) continue
    manifest.builtin = builtin
    manifest.dir = dir
    out.push(manifest)
  }
  return out
}

export async function listManifests(): Promise<PluginManifest[]> {
  const builtin = await scanRoot(bundledPluginsDir(), true)
  const user = await scanRoot(userPluginsDir(), false)
  const byId = new Map<string, PluginManifest>()
  for (const m of [...builtin, ...user]) byId.set(m.id, m) // 用户插件可覆盖同名内置插件
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/** 校验面板入口路径，防止插件引用到目录外 */
export function resolvePluginFile(pluginDir: string, rel: string): string | null {
  const target = resolve(pluginDir, rel)
  const base = resolve(pluginDir)
  if (target !== base && !target.startsWith(base + sep)) return null
  return target
}

export function getPluginDir(pluginId: string): string | null {
  const p = loaded.get(pluginId)
  return p ? p.dir : null
}

async function activate(manifest: PluginManifest): Promise<LoadedPlugin> {
  const commands = new Map<string, PluginCommand>()
  const plugin: LoadedPlugin = {
    manifest,
    dir: manifest.dir!,
    commands,
    emit: (type, payload) => emitter(manifest.id, type, payload)
  }
  if (!manifest.main) return plugin

  const entry = resolvePluginFile(manifest.dir!, manifest.main)
  if (!entry || !(await pathExists(entry))) {
    plugin.error = `入口文件不存在：${manifest.main}`
    return plugin
  }
  try {
    const mod = require(entry) as { activate?: (api: PluginApi) => unknown } | ((api: PluginApi) => unknown)
    const api: PluginApi = {
      pluginId: manifest.id,
      manifest,
      config: () => loadConfig(),
      registerCommand: (cmd) => {
        if (!cmd?.id || typeof cmd.run !== 'function') return
        commands.set(cmd.id, cmd)
      },
      emit: plugin.emit,
      log: (...args) => console.log(`[plugin:${manifest.id}]`, ...args),
      getFish: async (fishId) => cachedProfile(await pondRoot(), fishId),
      addStats: async (fishId, patch) => {
        const root = await pondRoot()
        const next = await patchStats(root, fishId, (p) => {
          p.stats.tokens += patch.tokens ?? 0
          p.stats.meals += patch.meals ?? 0
          p.stats.exp += patch.exp ?? 0
          p.stats.mood = Math.max(0, Math.min(100, p.stats.mood + (patch.mood ?? 0)))
          p.stats.hunger = Math.max(0, Math.min(100, p.stats.hunger + (patch.hunger ?? 0)))
          p.stats.level = levelFromExp(p.stats.exp)
        })
        return next
      },
      listMemories: async (fishId) => loadCards(await pondRoot(), fishId)
    }
    if (typeof mod === 'function') mod(api)
    else if (mod && typeof mod.activate === 'function') mod.activate(api)
    else plugin.error = '入口没有导出 activate()'
  } catch (e) {
    plugin.error = `加载失败：${(e as Error).message}`
  }
  return plugin
}

export async function reloadPlugins(): Promise<PluginInfo[]> {
  loaded.clear()
  const manifests = await listManifests()
  for (const m of manifests) {
    if (m.main || m.panel) loaded.set(m.id, await activate(m))
    else loaded.set(m.id, { manifest: m, dir: m.dir!, commands: new Map(), emit: () => {} })
  }
  // 允许热重载：清掉 require 缓存
  for (const m of manifests) {
    if (!m.main) continue
    const entry = resolvePluginFile(m.dir!, m.main)
    if (entry && typeof require === 'function') {
      try {
        delete (require as unknown as { cache?: Record<string, unknown> }).cache?.[entry]
      } catch {
        /* 忽略 */
      }
    }
  }
  return listPlugins()
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const cfg = await loadConfig()
  return [...loaded.values()].map((p) => ({
    ...p.manifest,
    enabled: !cfg.plugins.disabled.includes(p.manifest.id),
    loaded: !p.error,
    error: p.error,
    commands: [...p.commands.values()].map((c) => ({ id: c.id, title: c.title }))
  }))
}

export async function invokePlugin(pluginId: string, commandId: string, payload?: unknown): Promise<unknown> {
  const cfg = await loadConfig()
  if (cfg.plugins.disabled.includes(pluginId)) throw new Error('这个插件被停用了')
  const plugin = loaded.get(pluginId)
  if (!plugin) throw new Error('插件没有加载')
  const cmd = plugin.commands.get(commandId)
  if (!cmd) throw new Error(`插件里没有命令 ${commandId}`)
  return cmd.run(payload)
}

export async function togglePlugin(pluginId: string, enabled: boolean): Promise<PluginInfo[]> {
  const cfg = await loadConfig()
  const disabled = new Set(cfg.plugins.disabled)
  if (enabled) disabled.delete(pluginId)
  else disabled.add(pluginId)
  await saveConfig({ plugins: { disabled: [...disabled] } })
  return listPlugins()
}
