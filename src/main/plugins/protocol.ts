import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { listManifests, resolvePluginFile } from './loader'

/**
 * 插件面板协议：fatfish-plugin://<pluginId>/<path>
 * 插件面板跑在 iframe 里，只能读到自己的目录（路径穿越会被拒绝），
 * 与主界面之间通过 postMessage 桥通信（见 preload 暴露的 farm.pluginBridge）。
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2'
}

export function registerPluginProtocol(): void {
  protocol.handle('fatfish-plugin', async (request) => {
    const url = new URL(request.url)
    const pluginId = url.hostname
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const manifests = await listManifests()
    const manifest = manifests.find((m) => m.id === pluginId)
    if (!manifest?.dir) return new Response('plugin not found', { status: 404 })
    const file = resolvePluginFile(manifest.dir, rel || manifest.panel?.entry || 'panel.html')
    if (!file) return new Response('forbidden', { status: 403 })
    try {
      const data = await fs.readFile(file)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/** 图片协议：fatfish://media/<fishId>/<mediaId>?v=thumb|src */
export function mediaUrl(fishId: string, mediaId: string, variant: 'thumb' | 'src' = 'thumb'): string {
  return `fatfish://media/${encodeURIComponent(fishId)}/${encodeURIComponent(mediaId)}?v=${variant}`
}

export function registerMediaProtocol(
  resolveMedia: (fishId: string, mediaId: string, variant: 'thumb' | 'src') => Promise<string | null>
): void {
  protocol.handle('fatfish', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'media') return new Response('bad host', { status: 400 })
    const [fishId, mediaId] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (!fishId || !mediaId) return new Response('bad path', { status: 400 })
    const variant = url.searchParams.get('v') === 'src' ? 'src' : 'thumb'
    const file = await resolveMedia(fishId, mediaId, variant)
    if (!file) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
