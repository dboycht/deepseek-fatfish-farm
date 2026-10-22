import { providerForRoute, type RouteKind } from '@shared/config'
import type { AppConfig, ResolvedEndpoint } from '@shared/types'
import { resolveCredential } from '../credentials'

/**
 * 把「配置里的引用」解析成「这次请求真正要用的端点」：
 * provider → route model → 凭据（.credentials.yaml → 环境变量）→ 参数。
 */
async function buildEndpoint(cfg: AppConfig, kind: RouteKind): Promise<ResolvedEndpoint | null> {
  if (kind !== 'text' && !cfg.routes[kind].enabled) return null
  const provider = providerForRoute(cfg, kind)
  if (!provider) return null
  const route = cfg.routes[kind]
  const model = (route.model || provider.models[0] || '').trim()
  const cred = await resolveCredential(provider.apiKeyEnv)

  const base: ResolvedEndpoint = {
    providerId: provider.id,
    providerName: provider.name,
    mode: cfg.mode,
    baseUrl: provider.baseUrl,
    apiKey: cred?.value ?? '',
    apiKeyEnv: provider.apiKeyEnv,
    apiKeySource: cred?.source ?? 'none',
    model,
    temperature: 1.1,
    maxTokens: 1600,
    timeoutMs: 180_000,
    reasoning: false,
    ...(provider.headers ? { headers: provider.headers } : {})
  }

  if (kind === 'text') {
    return {
      ...base,
      temperature: cfg.routes.text.temperature,
      maxTokens: cfg.routes.text.maxTokens,
      timeoutMs: cfg.routes.text.timeoutMs,
      reasoning: cfg.routes.text.reasoning
    }
  }
  if (kind === 'vision') {
    return { ...base, temperature: 0.2, maxTokens: 300, timeoutMs: Math.min(120_000, base.timeoutMs) }
  }
  return { ...base, temperature: 0.4, maxTokens: 16, timeoutMs: 180_000, imageSize: cfg.routes.image.size }
}

export async function resolveTextEndpoint(cfg: AppConfig): Promise<ResolvedEndpoint> {
  const ep = await buildEndpoint(cfg, 'text')
  if (!ep) throw new Error('还没有可用的对话接口')
  return ep
}

export async function resolveVisionEndpoint(cfg: AppConfig): Promise<ResolvedEndpoint | null> {
  return buildEndpoint(cfg, 'vision')
}

export async function resolveImageEndpoint(cfg: AppConfig): Promise<ResolvedEndpoint | null> {
  return buildEndpoint(cfg, 'image')
}
