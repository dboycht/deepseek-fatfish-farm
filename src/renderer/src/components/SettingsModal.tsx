import { useEffect, useState, type ReactElement } from 'react'
import type { AppConfig, FishPersona, ProviderProfile } from '@shared/types'
import { useStore } from '../state/store'
import { ArtPortrait } from './ArtAvatar'

type Tab = 'api' | 'look' | 'fish' | 'memory' | 'data' | 'about'

const TABS: { id: Tab; label: string }[] = [
  { id: 'api', label: '连接' },
  { id: 'look', label: '外观' },
  { id: 'fish', label: '这只鱼' },
  { id: 'memory', label: '记忆' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' }
]

function sourceLabel(source: string, encrypted?: boolean): string {
  if (source === 'store') return encrypted ? '已保存 · DPAPI 加密' : '已保存 · 明文'
  if (source === 'env') return '来自环境变量'
  return '未配置'
}

export function SettingsModal(): ReactElement | null {
  const s = useStore()
  const cfg = s.cfg
  const [tab, setTab] = useState<Tab>('api')
  const [draft, setDraft] = useState<AppConfig | null>(cfg)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [encAvail, setEncAvail] = useState(true)
  const [pondBytes, setPondBytes] = useState<number | null>(null)

  useEffect(() => {
    setDraft(s.cfg)
  }, [s.cfg])

  useEffect(() => {
    if (!s.settingsOpen) return
    void window.farm.app.encryption().then(setEncAvail)
    void window.farm.stats.pond().then((r) => setPondBytes(r.bytes))
    setKeyDrafts({})
  }, [s.settingsOpen])

  if (!s.settingsOpen || !draft) return null
  const d = draft
  const providers = s.providers

  const patch = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void => {
    setDraft({ ...d, [key]: value })
  }

  const patchProvider = (id: string, patch2: Partial<ProviderProfile>): void => {
    setDraft({ ...d, providers: d.providers.map((p) => (p.id === id ? { ...p, ...patch2 } : p)) })
  }

  const addProvider = (): void => {
    const n = d.providers.length + 1
    const provider: ProviderProfile = {
      id: `provider-${Math.random().toString(36).slice(2, 6)}`,
      name: `新接口 ${n}`,
      baseUrl: '',
      apiKeyEnv: `PROVIDER_${n}_API_KEY`,
      models: []
    }
    setDraft({ ...d, providers: [...d.providers, provider] })
  }

  const removeProvider = (id: string): void => {
    if (d.providers.length <= 1) {
      s.toast('至少保留一个 provider', 'err')
      return
    }
    const rest = d.providers.filter((p) => p.id !== id)
    const fallback = rest[0].id
    const fix = <T extends { providerId: string }>(route: T): T =>
      route.providerId === id ? { ...route, providerId: fallback } : route
    setDraft({
      ...d,
      providers: rest,
      routes: {
        text: fix(d.routes.text),
        vision: fix(d.routes.vision),
        image: fix(d.routes.image)
      }
    })
  }

  const saveDraft = async (): Promise<AppConfig> => {
    await s.saveConfig(d)
    return d
  }

  const saveKey = async (ref: string): Promise<void> => {
    const value = (keyDrafts[ref] ?? '').trim()
    if (!value) return
    try {
      await s.setCredential(ref, value)
      setKeyDrafts((prev) => ({ ...prev, [ref]: '' }))
    } catch {
      /* store 已经弹过错误提示 */
    }
  }

  const runTest = async (target: 'text' | 'vision' | 'image'): Promise<void> => {
    setTesting(target)
    try {
      await saveDraft()
      const res = await s.testConnection(target)
      s.toast(res.ok ? `✅ ${res.detail}` : `❌ ${res.detail}`, res.ok ? 'ok' : 'err')
    } finally {
      setTesting(null)
    }
  }

  const runProviderTest = async (providerId: string): Promise<void> => {
    setTesting(`provider:${providerId}`)
    try {
      await saveDraft()
      const res = await s.testProvider(providerId)
      s.toast(res.ok ? `✅ ${res.detail}` : `❌ ${res.detail}`, res.ok ? 'ok' : 'err')
    } finally {
      setTesting(null)
    }
  }

  const persona = s.fish?.persona

  return (
    <div className="overlay" onClick={() => s.setSettingsOpen(false)}>
      <div className="modal" style={{ width: 'min(960px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <span className="spacer" />
          <span
            className="hint"
            style={{ maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {s.info?.configFile}
          </span>
          <button className="btn sm ghost" onClick={() => s.setSettingsOpen(false)}>
            关闭
          </button>
        </div>
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'api' ? (
            <>
              <div className="section-title">运行方式</div>
              <div className="grid2">
                <div className="field">
                  <label>模式</label>
                  <select value={d.mode} onChange={(e) => patch('mode', e.target.value as 'api' | 'mock')}>
                    <option value="api">调用真实接口（任意 OpenAI 兼容服务）</option>
                    <option value="mock">排练模式（本地假装是它，不联网）</option>
                  </select>
                </div>
                <div className="field">
                  <label>配置与密钥（DSH 同构）</label>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <button className="btn sm" onClick={() => void window.farm.config.open('config')}>
                      打开 config.yaml
                    </button>
                    <button className="btn sm" onClick={() => void window.farm.config.open('credentials')}>
                      打开 .credentials.yaml
                    </button>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        if (!window.confirm('从 ~/.dsh/.credentials.yaml 导入本机还没有的密钥引用？')) return
                        await s.importDsh()
                      }}
                    >
                      从 DSH 导入凭据
                    </button>
                  </div>
                  <div className="hint">
                    密钥不写进 config.yaml，只写 <code>apiKeyEnv</code> 引用名；真实值在{' '}
                    <code>.credentials.yaml</code> 的 <code>refs</code> 下，解析顺序：引用 → 同名环境变量。
                  </div>
                </div>
              </div>

              <div className="section-title">Provider（接口 + 密钥引用）</div>
              {d.providers.map((p) => {
                const saved = providers.find((x) => x.id === p.id)
                const cred = saved?.credential
                const isTyping = Boolean((keyDrafts[p.apiKeyEnv] ?? '').trim())
                return (
                  <div className="provider-card" key={p.id}>
                    <div className="provider-card-head">
                      <span className="tag">{p.id}</span>
                      <input
                        type="text"
                        value={p.name}
                        style={{ maxWidth: 200 }}
                        onChange={(e) => patchProvider(p.id, { name: e.target.value })}
                      />
                      <span className={`cred-pill ${cred?.source ?? 'none'}`}>
                        凭据：{sourceLabel(cred?.source ?? 'none', cred?.encrypted)}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="btn sm"
                        disabled={testing !== null}
                        onClick={() => void runProviderTest(p.id)}
                      >
                        {testing === `provider:${p.id}` ? '测试中…' : '测试连通'}
                      </button>
                      <button className="btn sm danger" onClick={() => removeProvider(p.id)}>
                        删除
                      </button>
                    </div>

                    <div className="provider-grid">
                      <div className="field">
                        <label>Base URL</label>
                        <input
                          type="text"
                          value={p.baseUrl}
                          placeholder="https://api.deepseek.com"
                          onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>密钥引用名（apiKeyEnv）</label>
                        <input
                          type="text"
                          value={p.apiKeyEnv}
                          placeholder="DEEPSEEK_API_KEY"
                          onChange={(e) => patchProvider(p.id, { apiKeyEnv: e.target.value.toUpperCase() })}
                        />
                      </div>
                      <div className="field">
                        <label>模型列表（逗号分隔）</label>
                        <input
                          type="text"
                          value={p.models.join(', ')}
                          placeholder="deepseek-chat, deepseek-reasoner"
                          onChange={(e) =>
                            patchProvider(p.id, {
                              models: e.target.value
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean)
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label>写入密钥（{p.apiKeyEnv}）</label>
                        <div className="row">
                          <input
                            type="password"
                            value={keyDrafts[p.apiKeyEnv] ?? ''}
                            placeholder={cred?.configured ? '已配置，留空表示不改' : 'sk-...'}
                            onChange={(e) =>
                              setKeyDrafts((prev) => ({ ...prev, [p.apiKeyEnv]: e.target.value }))
                            }
                          />
                          <button className="btn sm" disabled={!isTyping} onClick={() => void saveKey(p.apiKeyEnv)}>
                            保存
                          </button>
                          {cred?.source === 'store' ? (
                            <button className="btn sm ghost" onClick={() => void s.removeCredential(p.apiKeyEnv)}>
                              清除
                            </button>
                          ) : null}
                        </div>
                        <div className="hint">
                          {encAvail
                            ? '保存时用系统 DPAPI 加密；也可设置同名环境变量，二者都缺时请求会失败。'
                            : '⚠ 当前系统不支持 DPAPI，密钥会以 base64 形式落盘（仍不进 config.yaml）。'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="row">
                <button className="btn sm" onClick={addProvider}>
                  ＋ 添加 Provider
                </button>
                <span className="hint">
                  引用名建议用 <code>DEEPSEEK_API_KEY</code> / <code>VISION_API_KEY</code> 这种环境变量风格。
                </span>
              </div>

              <div className="section-title">路由（每条能力选一个 provider + 模型）</div>
              <div className="route-card">
                <div className="route-title">对话</div>
                <div className="route-grid">
                  <div className="field">
                    <label>Provider</label>
                    <select
                      value={d.routes.text.providerId}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, text: { ...d.routes.text, providerId: e.target.value } })
                      }
                    >
                      {d.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.id}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>模型</label>
                    <input
                      type="text"
                      list="ff-models-text"
                      value={d.routes.text.model}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, text: { ...d.routes.text, model: e.target.value } })
                      }
                    />
                    <datalist id="ff-models-text">
                      {(d.providers.find((p) => p.id === d.routes.text.providerId)?.models ?? []).map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="field">
                    <label>温度 {d.routes.text.temperature.toFixed(2)}</label>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={d.routes.text.temperature}
                      onChange={(e) =>
                        patch('routes', {
                          ...d.routes,
                          text: { ...d.routes.text, temperature: Number(e.target.value) }
                        })
                      }
                    />
                    <div className="hint">1.05 ~ 1.25 比较像这条鱼。</div>
                  </div>
                  <div className="field">
                    <label>最大输出 token / 超时</label>
                    <div className="row">
                      <input
                        type="number"
                        min={128}
                        max={8192}
                        value={d.routes.text.maxTokens}
                        onChange={(e) =>
                          patch('routes', {
                            ...d.routes,
                            text: { ...d.routes.text, maxTokens: Number(e.target.value) }
                          })
                        }
                      />
                      <input
                        type="number"
                        min={10}
                        max={600}
                        value={Math.round(d.routes.text.timeoutMs / 1000)}
                        onChange={(e) =>
                          patch('routes', {
                            ...d.routes,
                            text: { ...d.routes.text, timeoutMs: Number(e.target.value) * 1000 }
                          })
                        }
                      />
                      <span className="hint">秒</span>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <span className="hint">内心 OS 的显示开关在「外观」页；这里控制路由参数。</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" disabled={testing !== null} onClick={() => void runTest('text')}>
                    {testing === 'text' ? '测试中…' : '测试对话接口'}
                  </button>
                </div>
              </div>

              <div className="route-card">
                <div className="route-title">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.routes.vision.enabled}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, vision: { ...d.routes.vision, enabled: e.target.checked } })
                      }
                    />
                    视觉（看图）
                  </label>
                </div>
                <div className="route-grid">
                  <div className="field">
                    <label>Provider</label>
                    <select
                      value={d.routes.vision.providerId}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, vision: { ...d.routes.vision, providerId: e.target.value } })
                      }
                    >
                      {d.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.id}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>模型</label>
                    <input
                      type="text"
                      value={d.routes.vision.model}
                      placeholder="qwen-vl-max / glm-4v / gpt-4o-mini"
                      onChange={(e) =>
                        patch('routes', { ...d.routes, vision: { ...d.routes.vision, model: e.target.value } })
                      }
                    />
                  </div>
                </div>
                <div className="hint">
                  启用后，发图时会把缩略图发给这个模型做描述，并把描述写进记忆；不启用时只能看到文件名。
                </div>
                <div className="row">
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" disabled={testing !== null} onClick={() => void runTest('vision')}>
                    {testing === 'vision' ? '测试中…' : '测试视觉接口'}
                  </button>
                </div>
              </div>

              <div className="route-card">
                <div className="route-title">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.routes.image.enabled}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, image: { ...d.routes.image, enabled: e.target.checked } })
                      }
                    />
                    生图（图文并茂）
                  </label>
                </div>
                <div className="route-grid">
                  <div className="field">
                    <label>Provider</label>
                    <select
                      value={d.routes.image.providerId}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, image: { ...d.routes.image, providerId: e.target.value } })
                      }
                    >
                      {d.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.id}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>模型</label>
                    <input
                      type="text"
                      value={d.routes.image.model}
                      placeholder="Kolors / flux-schnell"
                      onChange={(e) =>
                        patch('routes', { ...d.routes, image: { ...d.routes.image, model: e.target.value } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>尺寸</label>
                    <input
                      type="text"
                      value={d.routes.image.size}
                      onChange={(e) =>
                        patch('routes', { ...d.routes, image: { ...d.routes.image, size: e.target.value } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>主动性</label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={d.memory.allowDraw}
                        onChange={(e) => patch('memory', { ...d.memory, allowDraw: e.target.checked })}
                      />
                      允许它主动画图
                    </label>
                  </div>
                </div>
                <div className="row">
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" disabled={testing !== null} onClick={() => void runTest('image')}>
                    {testing === 'image' ? '测试中…' : '测试生图接口'}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'look' ? (
            <>
              <div className="section-title">主题</div>
              <div className="grid2">
                <div className="field">
                  <label>配色</label>
                  <select value={d.ui.theme} onChange={(e) => patch('ui', { ...d.ui, theme: e.target.value as 'abyss' | 'dawn' })}>
                    <option value="abyss">深海夜色（默认）</option>
                    <option value="dawn">清晨浅海</option>
                  </select>
                  <div className="hint">浅色主题会在下一次启动时完全生效。</div>
                </div>
                <div className="field">
                  <label>字号 {d.ui.fontSize}px</label>
                  <input
                    type="range"
                    min={13}
                    max={18}
                    value={d.ui.fontSize}
                    onChange={(e) => patch('ui', { ...d.ui, fontSize: Number(e.target.value) })}
                  />
                </div>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.ui.showReasoning}
                  onChange={(e) => patch('ui', { ...d.ui, showReasoning: e.target.checked })}
                />
                显示内心 OS
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.ui.animate}
                  onChange={(e) => patch('ui', { ...d.ui, animate: e.target.checked })}
                />
                允许气泡、摆尾等动画
              </label>
            </>
          ) : null}

          {tab === 'fish' && s.fish && persona ? (
            <>
              <div className="section-title">「{s.fish.name}」的性格调教</div>
              {(
                [
                  ['appetite', '贪吃'],
                  ['clingy', '黏人'],
                  ['tsundere', '傲娇'],
                  ['mischief', '调皮'],
                  ['laziness', '摸鱼'],
                  ['sleepy', '犯困']
                ] as [keyof FishPersona, string][]
              ).map(([k, label]) => (
                <div className="slider-row" key={k}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={persona[k]}
                    onChange={(e) => {
                      const next = { ...persona, [k]: Number(e.target.value) }
                      void s.updateFish({ persona: next })
                    }}
                  />
                  <span className="val">{persona[k]}</span>
                </div>
              ))}
              <div className="field">
                <label>一句话简介</label>
                <input
                  type="text"
                  defaultValue={s.fish.tagline}
                  onBlur={(e) => void s.updateFish({ tagline: e.target.value })}
                />
              </div>
              <div className="field">
                <label>饲养备注（只给自己看）</label>
                <textarea
                  defaultValue={s.fish.note ?? ''}
                  placeholder="比如：它怕打雷；周三要提醒我交报告……"
                  onBlur={(e) => void s.updateFish({ note: e.target.value })}
                />
              </div>
              <div className="row">
                <span className="hint">
                  专属习惯：口头禅「{s.fish.flavor.phrase}」· 最爱{s.fish.flavor.food} · {s.fish.flavor.quirk}
                </span>
              </div>
            </>
          ) : null}

          {tab === 'memory' ? (
            <>
              <div className="section-title">自动记忆</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.memory.auto}
                  onChange={(e) => patch('memory', { ...d.memory, auto: e.target.checked })}
                />
                聊完自动把对话压成记忆卡片（后台进行，不打断聊天）
              </label>
              <div className="grid3">
                <div className="field">
                  <label>每积累多少条消息蒸馏一次</label>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    value={d.memory.every}
                    onChange={(e) => patch('memory', { ...d.memory, every: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>卡片上限（超出自动归档压缩）</label>
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={d.memory.maxCards}
                    onChange={(e) => patch('memory', { ...d.memory, maxCards: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>每次回忆带几条进上下文</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={d.memory.recall}
                    onChange={(e) => patch('memory', { ...d.memory, recall: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="section-title">当前这只鱼的记忆</div>
              <div className="mem-stats">
                <div className="stat">
                  <div className="k">卡片</div>
                  <div className="v">{s.memStats?.cards ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">归档</div>
                  <div className="v">{s.memStats?.archived ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">体积</div>
                  <div className="v">{((s.memStats?.bytes ?? 0) / 1024).toFixed(1)} KB</div>
                </div>
                <div className="stat">
                  <div className="k">约 token</div>
                  <div className="v">≈{s.memStats?.approxTokens ?? 0}</div>
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void s.distillMemory(true)}>
                  立刻回味一次
                </button>
                <button className="btn sm" onClick={() => void s.compactMemory()}>
                  压缩归档
                </button>
                <button className="btn sm" onClick={() => void s.exportMemory()}>
                  导出记忆包
                </button>
                <button className="btn sm" onClick={() => void s.importBundle()}>
                  导入记忆包
                </button>
              </div>
              <div className="hint">
                记忆卡片正文用英文书写（同样内容更省字节），每张卡都保留来源消息与图片 id，
                所以聊天里可以「引用」并跳回原话。
              </div>
            </>
          ) : null}

          {tab === 'data' ? (
            <>
              <div className="section-title">文件位置（与 DSH 类似：配置与密钥同目录）</div>
              <div className="field">
                <label>config.yaml</label>
                <input type="text" value={s.info?.configFile ?? ''} readOnly />
              </div>
              <div className="field">
                <label>.credentials.yaml（密钥引用，值已加密）</label>
                <input type="text" value={s.info?.credentialsFile ?? ''} readOnly />
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void window.farm.config.open('config')}>
                  打开 config.yaml
                </button>
                <button className="btn sm" onClick={() => void window.farm.config.open('credentials')}>
                  打开 .credentials.yaml
                </button>
                <button className="btn sm" onClick={() => void window.farm.app.openPath(s.info?.configDir ?? '')}>
                  打开配置目录
                </button>
              </div>

              <div className="section-title">鱼塘位置</div>
              <div className="field">
                <label>当前鱼塘</label>
                <input type="text" value={d.pondRoot} readOnly />
                <div className="hint">
                  每只肥鱼在鱼塘里有一个独立文件夹：fish.json（档案）、chats/（会话）、memory/（压缩记忆）、media/（图片）。
                  {pondBytes !== null ? ` 当前占用 ${(pondBytes / 1024 / 1024).toFixed(2)} MB。` : ''}
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void window.farm.pond.open()}>
                  打开鱼塘文件夹
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const dir = await window.farm.pond.choose()
                    if (!dir) return
                    await window.farm.pond.migrate(dir)
                    const next = await window.farm.config.get()
                    setDraft(next)
                    await s.refreshFish()
                    s.toast('鱼塘已搬迁（原文件夹保留了一份，可自行删除）', 'ok')
                  }}
                >
                  更换位置并搬迁
                </button>
              </div>

              <div className="section-title">导出 / 导入</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void s.exportFish()}>
                  导出整只肥鱼（.fatfish）
                </button>
                <button className="btn sm" onClick={() => void s.exportMemory()}>
                  只导出记忆（.fatmem）
                </button>
                <button className="btn sm" onClick={() => void s.importBundle()}>
                  导入
                </button>
              </div>
              <div className="hint">
                两个格式都是 gzip 压缩的单个文件，里面不含 API Key，可以随手备份或搬到别的电脑。
                导入整只鱼会新建一只（不覆盖现有的），导入记忆则合并进当前选中的鱼。
              </div>
            </>
          ) : null}

          {tab === 'about' ? (
            <>
              <div className="row">
                <ArtPortrait hue={s.fish?.hue ?? 205} size={92} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>DeepSeek 肥鱼养殖场 v{s.info?.version}</div>
                  <div className="hint">
                    Electron {s.info?.electron} · Node {s.info?.node} · Chromium {s.info?.chrome} · {s.info?.platform}
                  </div>
                </div>
              </div>
              <div className="section-title">这是什么</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                一个把「蓝色大肥鱼（DeepSeek 娘）」养在本地电脑里的桌面软件。你可以同时养好几只，
                每只都有自己的名字、性格和一套独立的压缩记忆；它们会自己把聊天压成记忆卡片，
                过几天你提到相关的事，它会翻出那张卡甚至那张图，指给你看。
              </div>
              <div className="section-title">配置与密钥</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                配置在 <code>config.yaml</code>，密钥在 <code>.credentials.yaml</code>。provider 只记录{' '}
                <code>baseUrl</code> 与 <code>apiKeyEnv</code>（引用名）；运行时按「引用 → 环境变量」解析。
                这套结构参考了 DeepSeek Harness 的 provider + credentials 设计，并支持从 DSH 一键导入已有凭据。
              </div>
              <div className="section-title">关于角色</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                大肥鱼是 DeepSeek 的<b>民间二创</b>形象（蓝发、呆毛、鲸尾、爱吃白米饭与 token、呆萌又带点屑），
                与官方无关，本软件也非官方作品。软件内的鱼形象、贴纸全部来自授权立绘与表情表，
                未使用任何第三方投稿图。请勿将本软件或其素材用于商业用途。
              </div>
              <div className="section-title">数据与隐私</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                所有对话、记忆与图片都只存在你自己的鱼塘文件夹里；请求只发往你自己填的那个 API 地址。
                API Key {encAvail ? '用系统 DPAPI 加密保存在 .credentials.yaml' : '（当前系统不支持加密，以 base64 保存）'}，
                不上传、不写日志、不进导出包。
              </div>
              <div className="section-title">路径</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                鱼塘：{s.info?.pondRoot}
                <br />
                配置：{s.info?.configFile}
                <br />
                密钥：{s.info?.credentialsFile}
                <br />
                内置插件：{s.info?.bundledPluginsDir}
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={() => s.setSettingsOpen(false)}>
            关闭
          </button>
          <button className="btn primary" onClick={() => void saveDraft().then(() => s.toast('设置已保存', 'ok'))}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}
