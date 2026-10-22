import type { ProviderConfig } from '@shared/types'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export function normalizeBase(baseUrl: string): string {
  let b = (baseUrl || '').trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(b)) b = b.slice(0, -'/chat/completions'.length)
  return b.replace(/\/+$/, '')
}

/** 兼容 OpenAI 风格：base 已带 /v1 就不重复补 */
export function apiUrl(baseUrl: string, path: string): string {
  const b = normalizeBase(baseUrl)
  if (!b) throw new Error('还没有填接口地址哦')
  const hasVersion = /\/v\d+($|\/)/.test(b)
  return `${b}${hasVersion ? '' : '/v1'}${path}`
}

export interface CompletionOptions {
  messages: ChatMsg[]
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onDelta?: (chunk: string) => void
  onReason?: (chunk: string) => void
  signal?: AbortSignal
}

export interface CompletionResult {
  text: string
  reason: string
  usage?: { i: number; o: number }
}

function withTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('请求超时')), ms)
  const onAbort = (): void => ctrl.abort(parent?.reason)
  if (parent) {
    if (parent.aborted) ctrl.abort(parent.reason)
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    }
  }
}

export async function chatCompletion(
  cfg: ProviderConfig,
  apiKey: string,
  opts: CompletionOptions
): Promise<CompletionResult> {
  const url = apiUrl(cfg.baseUrl, '/chat/completions')
  const body: Record<string, unknown> = {
    model: opts.model ?? cfg.model,
    messages: opts.messages,
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
    stream: Boolean(opts.stream)
  }
  if (!body.model) throw new Error('还没有选模型')

  const { signal, cancel } = withTimeout(opts.signal, cfg.timeoutMs || 180_000)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (e) {
    cancel()
    throw new Error(`连不上接口：${(e as Error).message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    cancel()
    throw new Error(`接口返回 ${res.status}：${detail.slice(0, 300) || res.statusText}`)
  }

  try {
    if (!opts.stream || !res.body) {
      const json = (await res.json()) as any
      const msg = json?.choices?.[0]?.message ?? {}
      return {
        text: String(msg.content ?? ''),
        reason: String(msg.reasoning_content ?? msg.reasoning ?? ''),
        usage: json?.usage
          ? { i: json.usage.prompt_tokens ?? 0, o: json.usage.completion_tokens ?? 0 }
          : undefined
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let text = ''
    let reason = ''
    let usage: CompletionResult['usage']
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s || !s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') continue
        let json: any
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const delta = json?.choices?.[0]?.delta ?? {}
        const piece = delta.content
        if (typeof piece === 'string' && piece) {
          text += piece
          opts.onDelta?.(piece)
        }
        const r = delta.reasoning_content ?? delta.reasoning
        if (typeof r === 'string' && r) {
          reason += r
          opts.onReason?.(r)
        }
        if (json?.usage) {
          usage = { i: json.usage.prompt_tokens ?? 0, o: json.usage.completion_tokens ?? 0 }
        }
      }
    }
    return { text, reason, usage }
  } finally {
    cancel()
  }
}

/** 让视觉模型给图片写一句英文压缩描述，供记忆与检索使用 */
export async function captionImage(
  cfg: ProviderConfig,
  apiKey: string,
  dataUrl: string,
  hint = ''
): Promise<string> {
  const visionCfg: ProviderConfig = {
    ...cfg,
    baseUrl: cfg.vision.baseUrl || cfg.baseUrl,
    model: cfg.vision.model || cfg.model,
    maxTokens: 120,
    temperature: 0.2
  }
  const res = await chatCompletion(visionCfg, apiKey, {
    messages: [
      {
        role: 'system',
        content:
          'Describe the image in ONE compact English sentence (max 30 words) for a memory index. Include subject, setting, notable objects, visible text and mood. No preamble.'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: hint ? `Context: ${hint}` : 'Describe this image.' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    maxTokens: 120,
    temperature: 0.2
  })
  return res.text.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export interface GeneratedImage {
  buffer: Buffer
  ext: string
}

export async function generateImage(
  cfg: ProviderConfig,
  apiKey: string,
  prompt: string
): Promise<GeneratedImage> {
  const url = apiUrl(cfg.image.baseUrl || cfg.baseUrl, '/images/generations')
  const body = {
    model: cfg.image.model,
    prompt,
    n: 1,
    size: cfg.image.size || '1024x1024',
    response_format: 'b64_json'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`生图接口返回 ${res.status}：${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as any
  const item = json?.data?.[0]
  if (!item) throw new Error('生图接口没有返回图片')
  if (typeof item.b64_json === 'string' && item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), ext: 'png' }
  }
  if (typeof item.url === 'string' && item.url) {
    const img = await fetch(item.url)
    if (!img.ok) throw new Error('下载生成的图片失败')
    const ab = await img.arrayBuffer()
    const ext = item.url.split('.').pop()?.split('?')[0]?.slice(0, 4) || 'png'
    return { buffer: Buffer.from(ab), ext }
  }
  throw new Error('生图接口返回格式不认识')
}

export interface TestResult {
  ok: boolean
  detail: string
  models?: string[]
}

export async function testConnection(cfg: ProviderConfig, apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch(apiUrl(cfg.baseUrl, '/models'), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
    if (res.ok) {
      const json = (await res.json()) as any
      const models: string[] = Array.isArray(json?.data)
        ? json.data.map((m: any) => String(m?.id ?? '')).filter(Boolean).slice(0, 200)
        : []
      return { ok: true, detail: `连接正常，可用模型 ${models.length} 个`, models }
    }
  } catch {
    /* 有些服务不开放 /models，退回一次极短的对话测试 */
  }
  try {
    const r = await chatCompletion({ ...cfg, timeoutMs: 30_000 }, apiKey, {
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 4,
      temperature: 0
    })
    return { ok: true, detail: `连接正常（对话测试返回：${r.text.slice(0, 40) || '空'}）` }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}
