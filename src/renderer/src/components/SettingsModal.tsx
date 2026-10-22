import { useEffect, useState, type ReactElement } from 'react'
import type { AppConfig, FishPersona } from '@shared/types'
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

export function SettingsModal(): ReactElement | null {
  const s = useStore()
  const cfg = s.cfg
  const [tab, setTab] = useState<Tab>('api')
  const [draft, setDraft] = useState<AppConfig | null>(cfg)
  const [keyText, setKeyText] = useState('')
  const [keyVision, setKeyVision] = useState('')
  const [keyImage, setKeyImage] = useState('')
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
    setKeyText('')
    setKeyVision('')
    setKeyImage('')
  }, [s.settingsOpen])

  if (!s.settingsOpen || !draft) return null
  const d = draft

  const patch = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void => {
    setDraft({ ...d, [key]: value })
  }

  const save = async (): Promise<void> => {
    await s.saveConfig(d)
    if (keyText || keyVision || keyImage) {
      await s.saveSecrets({
        ...(keyText ? { text: keyText } : {}),
        ...(keyVision ? { vision: keyVision } : {}),
        ...(keyImage ? { image: keyImage } : {})
      })
      setKeyText('')
      setKeyVision('')
      setKeyImage('')
    }
    s.toast('设置已保存', 'ok')
  }

  const runTest = async (target: 'text' | 'vision' | 'image'): Promise<void> => {
    setTesting(target)
    try {
      await s.saveConfig(d)
      if (keyText || keyVision || keyImage) {
        await s.saveSecrets({
          ...(keyText ? { text: keyText } : {}),
          ...(keyVision ? { vision: keyVision } : {}),
          ...(keyImage ? { image: keyImage } : {})
        })
      }
      const res = await s.testConnection(target)
      s.toast(res.ok ? `✅ ${res.detail}` : `❌ ${res.detail}`, res.ok ? 'ok' : 'err')
    } finally {
      setTesting(null)
    }
  }

  const persona = s.fish?.persona

  return (
    <div className="overlay" onClick={() => s.setSettingsOpen(false)}>
      <div className="modal" style={{ width: 'min(880px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <span className="spacer" />
          <span className="hint" style={{ maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.info?.pondRoot}
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
              <div className="section-title">对话模型（OpenAI 兼容接口）</div>
              <div className="grid2">
                <div className="field">
                  <label>运行模式</label>
                  <select
                    value={d.provider.mode}
                    onChange={(e) => patch('provider', { ...d.provider, mode: e.target.value as 'api' | 'mock' })}
                  >
                    <option value="api">调用真实接口（DeepSeek 或任意 OpenAI 兼容服务）</option>
                    <option value="mock">排练模式（本地假装是它，不联网）</option>
                  </select>
                  <div className="hint">
                    DeepSeek 官方填 <code>https://api.deepseek.com</code>，模型 <code>deepseek-chat</code>；
                    本机 Ollama 可填 <code>http://127.0.0.1:11434/v1</code>。
                  </div>
                </div>
                <div className="field">
                  <label>接口地址 Base URL</label>
                  <input
                    type="text"
                    value={d.provider.baseUrl}
                    placeholder="https://api.deepseek.com"
                    onChange={(e) => patch('provider', { ...d.provider, baseUrl: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>模型</label>
                  <input
                    type="text"
                    value={d.provider.model}
                    placeholder="deepseek-chat"
                    onChange={(e) => patch('provider', { ...d.provider, model: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>API Key {s.info?.hasSecret.text ? '（已保存，留空表示不改）' : ''}</label>
                  <input
                    type="password"
                    value={keyText}
                    placeholder={s.info?.hasSecret.text ? '••••••••（已加密保存）' : 'sk-...'}
                    onChange={(e) => setKeyText(e.target.value)}
                  />
                  <div className="hint">
                    {encAvail ? '用系统 DPAPI 加密后存在本地，不会出现在导出包里。' : '⚠ 当前系统不支持加密存储，密钥将以明文保存。'}
                  </div>
                </div>
                <div className="field">
                  <label>温度 {d.provider.temperature.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={d.provider.temperature}
                    onChange={(e) => patch('provider', { ...d.provider, temperature: Number(e.target.value) })}
                  />
                  <div className="hint">越高质量越跳脱。1.05 ~ 1.25 比较像这条鱼。</div>
                </div>
                <div className="field">
                  <label>单次最大输出 token</label>
                  <input
                    type="number"
                    min={128}
                    max={8192}
                    value={d.provider.maxTokens}
                    onChange={(e) => patch('provider', { ...d.provider, maxTokens: Number(e.target.value) })}
                  />
                </div>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.provider.reasoning}
                  onChange={(e) => patch('provider', { ...d.provider, reasoning: e.target.checked })}
                />
                显示内心 OS（推理模型的 reasoning_content，折叠在消息下面）
              </label>
              <div className="row">
                <button className="btn" disabled={testing !== null} onClick={() => void runTest('text')}>
                  {testing === 'text' ? '测试中…' : '测试对话接口'}
                </button>
              </div>

              <div className="section-title">视觉（看图）</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.provider.vision.enabled}
                  onChange={(e) => patch('provider', { ...d.provider, vision: { ...d.provider.vision, enabled: e.target.checked } })}
                />
                启用视觉识别（发图时把图喂给多模态模型，并写进记忆）
              </label>
              <div className="grid2">
                <div className="field">
                  <label>视觉接口地址（留空沿用上面的）</label>
                  <input
                    type="text"
                    value={d.provider.vision.baseUrl}
                    placeholder={d.provider.baseUrl}
                    onChange={(e) => patch('provider', { ...d.provider, vision: { ...d.provider.vision, baseUrl: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>视觉模型</label>
                  <input
                    type="text"
                    value={d.provider.vision.model}
                    placeholder="例如 qwen-vl-max / glm-4v / gpt-4o-mini"
                    onChange={(e) => patch('provider', { ...d.provider, vision: { ...d.provider.vision, model: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>视觉 API Key（留空沿用对话的）</label>
                  <input
                    type="password"
                    value={keyVision}
                    placeholder={s.info?.hasSecret.vision ? '••••••••（已保存）' : '可留空'}
                    onChange={(e) => setKeyVision(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn" disabled={testing !== null} onClick={() => void runTest('vision')}>
                    {testing === 'vision' ? '测试中…' : '测试视觉接口'}
                  </button>
                </div>
              </div>

              <div className="section-title">画图（图文并茂）</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.provider.image.enabled}
                  onChange={(e) => patch('provider', { ...d.provider, image: { ...d.provider.image, enabled: e.target.checked } })}
                />
                启用图片生成（它可以在回复里画一张给你）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.memory.allowDraw}
                  onChange={(e) => patch('memory', { ...d.memory, allowDraw: e.target.checked })}
                />
                允许它主动画图（否则只在你明确要求时画）
              </label>
              <div className="grid3">
                <div className="field">
                  <label>生图接口地址</label>
                  <input
                    type="text"
                    value={d.provider.image.baseUrl}
                    placeholder="例如 https://api.siliconflow.cn"
                    onChange={(e) => patch('provider', { ...d.provider, image: { ...d.provider.image, baseUrl: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>生图模型</label>
                  <input
                    type="text"
                    value={d.provider.image.model}
                    placeholder="例如 Kolors / flux-schnell"
                    onChange={(e) => patch('provider', { ...d.provider, image: { ...d.provider.image, model: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>尺寸</label>
                  <input
                    type="text"
                    value={d.provider.image.size}
                    placeholder="1024x1024"
                    onChange={(e) => patch('provider', { ...d.provider, image: { ...d.provider.image, size: e.target.value } })}
                  />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>生图 API Key</label>
                  <input
                    type="password"
                    value={keyImage}
                    placeholder={s.info?.hasSecret.image ? '••••••••（已保存）' : '可留空'}
                    onChange={(e) => setKeyImage(e.target.value)}
                  />
                </div>
                <button className="btn" style={{ marginTop: 20 }} disabled={testing !== null} onClick={() => void runTest('image')}>
                  {testing === 'image' ? '测试中…' : '测试生图接口'}
                </button>
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
                <button className="btn sm" onClick={() => void window.farm.app.openPath(s.info?.userData ?? '')}>
                  打开配置目录
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
              <div className="section-title">关于角色</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                大肥鱼是 DeepSeek 的<b>民间二创</b>形象（蓝发、呆毛、鲸尾、爱吃白米饭与 token、呆萌又带点屑），
                与官方无关，本软件也非官方作品。软件内的鱼形象、贴纸全部是用代码现画的原创 SVG，
                没有使用任何第三方图片素材。请勿将本软件或其素材用于商业用途。
              </div>
              <div className="section-title">数据与隐私</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                所有对话、记忆与图片都只存在你自己的鱼塘文件夹里；请求只发往你自己填的那个 API 地址。
                API Key {encAvail ? '用系统 DPAPI 加密保存' : '（当前系统不支持加密）'}，不上传、不写日志、不进导出包。
              </div>
              <div className="section-title">路径</div>
              <div className="hint" style={{ lineHeight: 1.85 }}>
                鱼塘：{s.info?.pondRoot}
                <br />
                配置：{s.info?.userData}
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
          <button className="btn primary" onClick={() => void save()}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}
