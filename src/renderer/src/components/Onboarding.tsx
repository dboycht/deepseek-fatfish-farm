import { useState, type ReactElement } from 'react'
import { flavorFromSeed, personaFromSeed, randomSeed } from '@shared/persona'
import { useStore } from '../state/store'
import { ArtPortrait } from './ArtAvatar'
import { STICKERS } from '@shared/persona'
import { Sticker } from './Sticker'

export function Onboarding(): ReactElement {
  const s = useStore()
  const [step, setStep] = useState(0)
  const [pond, setPond] = useState(s.cfg?.pondRoot ?? '')
  const [mode, setMode] = useState<'api' | 'mock'>(s.cfg?.mode ?? 'api')
  const [baseUrl, setBaseUrl] = useState(s.cfg?.providers[0]?.baseUrl ?? 'https://api.deepseek.com')
  const [providerName, setProviderName] = useState(s.cfg?.providers[0]?.name ?? 'DeepSeek 官方')
  const [model, setModel] = useState(s.cfg?.routes.text.model ?? 'deepseek-chat')
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [hue, setHue] = useState(205)
  const [tagline, setTagline] = useState('')
  const [seed, setSeed] = useState(() => randomSeed())
  const [busy, setBusy] = useState(false)
  const [testMsg, setTestMsg] = useState('')

  const flavor = flavorFromSeed(seed, name || '大肥鱼')
  const persona = personaFromSeed(seed)
  const looksDeepSeek = /deepseek/i.test(baseUrl)

  const buildConfig = (onboarded = true): Parameters<typeof s.saveConfig>[0] => {
    const id = looksDeepSeek ? 'deepseek' : 'custom'
    const ref = looksDeepSeek ? 'DEEPSEEK_API_KEY' : 'CUSTOM_API_KEY'
    return {
      onboarded,
      pondRoot: pond || s.cfg?.pondRoot,
      mode,
      providers: [
        {
          id,
          name: providerName.trim() || (looksDeepSeek ? 'DeepSeek 官方' : '自定义接口'),
          baseUrl: baseUrl.trim(),
          apiKeyEnv: ref,
          models: [...new Set([model.trim()].filter(Boolean))]
        }
      ],
      routes: {
        ...s.cfg!.routes,
        text: { ...s.cfg!.routes.text, providerId: id, model: model.trim() }
      }
    }
  }

  const finish = async (): Promise<void> => {
    if (!name.trim()) {
      s.toast('先给它起个名字吧', 'err')
      return
    }
    setBusy(true)
    try {
      const patch = buildConfig()
      const ref = patch.providers![0].apiKeyEnv
      if (key.trim()) await window.farm.credentials.set(ref, key.trim())
      await s.saveConfig(patch)
      await s.createFish({ name: name.trim(), hue, tagline: tagline.trim() || undefined, seed })
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setTestMsg('测试中…')
    const patch = buildConfig(false)
    const ref = patch.providers![0].apiKeyEnv
    if (key.trim()) await window.farm.credentials.set(ref, key.trim())
    await s.saveConfig(patch)
    const res = await s.testConnection('text')
    setTestMsg(res.ok ? `✅ ${res.detail}` : `❌ ${res.detail}`)
  }

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="onboard-art">
          <ArtPortrait hue={hue} size={260} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {STICKERS.slice(0, 6).map((n) => (
              <Sticker key={n} name={n} hue={hue} size={64} showLabel={false} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.8 }}>
            「嚼嚼嚼……你要养我吗？」
            <br />
            蓝色大肥鱼 · 民间二创形象 · 与 DeepSeek 官方无关
          </div>
        </div>

        <div className="onboard-form">
          <div className="steps">
            {[0, 1, 2].map((i) => (
              <i key={i} className={i <= step ? 'on' : ''} />
            ))}
          </div>

          {step === 0 ? (
            <>
              <h2 style={{ margin: 0, fontSize: 19 }}>欢迎来到肥鱼养殖场</h2>
              <div className="hint" style={{ lineHeight: 1.9 }}>
                这里可以养好几只属于你的蓝色大肥鱼。它们会跟你聊天、收下你发的图片，
                并且自己把相处的点滴压成一小张一小张的记忆卡存在本地；过几天你提起，它会翻出那张卡给你看。
              </div>
              <div className="section-title">第一步 · 选鱼塘位置</div>
              <div className="field">
                <label>鱼塘文件夹（每只鱼会有自己的子文件夹）</label>
                <input type="text" value={pond} readOnly />
                <div className="row">
                  <button
                    className="btn sm"
                    onClick={async () => {
                      const dir = await window.farm.pond.choose()
                      if (dir) setPond(dir)
                    }}
                  >
                    选一个文件夹
                  </button>
                  <span className="hint">默认放在「文档」里，之后可以在设置里搬迁。</span>
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 style={{ margin: 0, fontSize: 19 }}>给它一个脑子</h2>
              <div className="hint" style={{ lineHeight: 1.9 }}>
                填你自己的 API。推荐 DeepSeek 官方：地址 <code>https://api.deepseek.com</code>，模型{' '}
                <code>deepseek-chat</code>。也可以先选「排练模式」进去看看界面，随时再改。
                <br />
                密钥会单独存进 <code>.credentials.yaml</code>，配置里只留引用名。
              </div>
              <div className="field">
                <label>运行模式</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'api' | 'mock')}>
                  <option value="api">调用真实接口</option>
                  <option value="mock">排练模式（本地，不联网）</option>
                </select>
              </div>
              {mode === 'api' ? (
                <>
                  <div className="grid2">
                    <div className="field">
                      <label>接口名称</label>
                      <input type="text" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>模型</label>
                      <input type="text" value={model} onChange={(e) => setModel(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label>接口地址</label>
                    <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>API Key（保存为 {looksDeepSeek ? 'DEEPSEEK_API_KEY' : 'CUSTOM_API_KEY'}）</label>
                    <input
                      type="password"
                      value={key}
                      placeholder="sk-..."
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <div className="hint">
                      用系统 DPAPI 加密存进 <code>.credentials.yaml</code>，不进 config.yaml、不进日志、不进导出包。
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn sm" onClick={() => void test()}>
                      测试连接
                    </button>
                    <span className="hint">{testMsg}</span>
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 style={{ margin: 0, fontSize: 19 }}>给它起个名字</h2>
              <div className="field">
                <label>名字</label>
                <input
                  type="text"
                  value={name}
                  autoFocus
                  maxLength={24}
                  placeholder="小肥 / 鲸鲸 / 白饭终结者"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>一句话简介（可留空）</label>
                <input type="text" value={tagline} maxLength={60} onChange={(e) => setTagline(e.target.value)} />
              </div>
              <div className="field">
                <label>体色与性格</label>
                <div className="slider-row">
                  <span>色相</span>
                  <input type="range" min={170} max={250} value={hue} onChange={(e) => setHue(Number(e.target.value))} />
                  <span className="val">{hue}</span>
                </div>
                <div className="row">
                  <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                    🎲 重掷性格
                  </button>
                  <span className="hint">
                    贪吃 {persona.appetite} · 黏人 {persona.clingy} · 傲娇 {persona.tsundere} · 摸鱼 {persona.laziness}
                  </span>
                </div>
              </div>
              <div className="hint">
                它的专属习惯：口头禅「{flavor.phrase}」· 最爱{flavor.food} · {flavor.quirk}
              </div>
            </>
          ) : null}

          <div style={{ flex: 1 }} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost" disabled={step === 0} onClick={() => setStep((v) => Math.max(0, v - 1))}>
              上一步
            </button>
            {step < 2 ? (
              <button className="btn primary" onClick={() => setStep((v) => v + 1)}>
                下一步
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => void finish()}>
                {busy ? '正在放鱼入塘…' : '开始养它'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
