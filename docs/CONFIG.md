# 配置与密钥（与 DeepSeek Harness 同构）

本软件的配置分成两个文件，**密钥永远不写进主配置**：

```
<配置目录>/
├── config.yaml          # 接口、模型、路由、记忆、外观……（人类可读，可手改）
└── .credentials.yaml    # 密钥引用 refs（本项目用 DPAPI 加密）
```

这套结构直接参考了 DeepSeek Harness（DSH）：

| 维度 | DSH | 本软件 |
| --- | --- | --- |
| 主配置 | `~/.dsh/cordis.patch.yml` | `config.yaml` |
| 密钥 | `~/.dsh/.credentials.yaml` 的 `refs` | 同目录 `.credentials.yaml` 的 `refs` |
| 配置里的密钥字段 | `apiKeyEnv: DEEPSEEK_API_KEY` | `providers[].apiKeyEnv` |
| 解析顺序 | credentials → 进程环境变量 | **相同**（refs → 同名环境变量） |
| 多接口 | `baseURL + apiKeyEnv + model` 多个 endpoint | 多个 `provider` + 三条 `routes` |
| 密钥落盘 | 明文 | 默认 DPAPI 加密（`enc:v1:`），不支持时 `raw:v1:<base64>` |
| 导入 | — | 「从 DSH 导入凭据」一键读取 `~/.dsh/.credentials.yaml` |

## 文件位置

- 默认：Electron 的 `userData`，Windows 上是
  `%APPDATA%\deepseek-fatfish-farm\`（以「设置 → 数据」里显示的路径为准）。
- 设置环境变量 `FATFISH_HOME` 可以整体搬走（类似 DSH 的 `$DSH_HOME`），
  例如：
  ```powershell
  $env:FATFISH_HOME = 'D:\fatfish-config'
  ```
- 鱼塘数据不在这里，仍由 `config.yaml` 的 `pondRoot` 指定。

## config.yaml

```yaml
version: 2
onboarded: true
mode: api                 # api = 真实接口；mock = 本地排练模式
pondRoot: 'D:\Documents\DeepSeek肥鱼养殖场'

providers:
  - id: deepseek
    name: DeepSeek 官方
    baseUrl: https://api.deepseek.com
    apiKeyEnv: DEEPSEEK_API_KEY     # 只是引用名！
    models:
      - deepseek-chat
      - deepseek-reasoner
  - id: local
    name: 本机 Ollama
    baseUrl: http://127.0.0.1:11434/v1
    apiKeyEnv: OLLAMA_API_KEY       # 没有 key 也可以；本地地址不会因缺 key 报错
    models:
      - qwen2.5:14b
  - id: vision
    name: 视觉接口
    baseUrl: https://api.example.com/v1
    apiKeyEnv: VISION_API_KEY
    models:
      - qwen-vl-max

routes:
  text:                    # 对话
    providerId: deepseek
    model: deepseek-chat
    temperature: 1.1
    maxTokens: 1600
    reasoning: false
    timeoutMs: 180000
  vision:                  # 看图
    enabled: false
    providerId: vision
    model: qwen-vl-max
  image:                   # 生图
    enabled: false
    providerId: image
    model: ''
    size: 1024x1024

memory:
  auto: true
  every: 6
  maxCards: 400
  recall: 6
  allowDraw: false

ui:
  theme: abyss
  showReasoning: true
  fontSize: 15
  animate: true

plugins:
  disabled: []
```

关键点：

- `provider` 只描述「去哪儿请求」：`baseUrl` + `apiKeyEnv` + 可用模型。
- `routes` 描述「用谁做什么」：对话 / 视觉 / 生图可以指向不同 provider。
- 修改 `config.yaml` 后**下一次请求**就会读到（程序按 mtime 缓存），不必重启；
  也可以点「设置 → 保存设置」让程序规范化后重写。
- 程序会把明显的坏值夹紧（温度 0..2、超时 10s..600s、卡片上限 50..5000），
  但不会阻止你手写自定义字段（未知字段会被丢弃）。

## .credentials.yaml

```yaml
# 密钥引用（与 DeepSeek Harness 的 .credentials.yaml 同构）
# refs.<NAME> 被 config.yaml 里的 providers[].apiKeyEnv 引用。
version: 1
refs:
  DEEPSEEK_API_KEY: enc:v1:....        # DPAPI 加密后的 base64
  VISION_API_KEY: enc:v1:....
  OLLAMA_API_KEY: raw:v1:....          # 系统不支持加密时的降级格式
records: []
```

- `refs` 的键必须像环境变量名：`^[A-Z][A-Z0-9_]{1,63}$`。
- 值有三种前缀：
  - `enc:v1:`：DPAPI 加密（默认，绑定当前 Windows 用户）；
  - `raw:v1:`：base64（DPAPI 不可用时的降级，仍不进 config.yaml）；
  - 无前缀：明文（可手写；从 DSH 导入的明文也会被重新加密）。
- `records` 预留给未来的 OAuth/token 记录，当前为空数组。

## 解析顺序

每次请求都会重新解析，改完文件立即生效：

1. `refs[apiKeyEnv]`（能解密且非空）；
2. 进程环境变量 `process.env[apiKeyEnv]`；
3. 都没有 → 视为未配置（本地 `127.0.0.1` / `localhost` 例外，允许无 key）。

示例：

```powershell
$env:DEEPSEEK_API_KEY = 'sk-...'
pnpm dev
```

环境变量的优先级低于 `.credentials.yaml`，所以想临时覆盖时先清掉文件里的引用，
或者在配置里换一个引用名。

## 从 DSH 导入

「设置 → 连接 → 从 DSH 导入凭据」会读取 `%USERPROFILE%\.dsh\.credentials.yaml`：

- 只读取 `refs` 的键和值，转存进本软件的 `.credentials.yaml`（重新加密）；
- 已存在的引用跳过，不覆盖；
- 导入的是**全部**引用名（包括 DSH 里的网关 key），导入后可在界面里逐个清除。
- 不会修改 DSH 的文件。

## 从 v1 自动迁移

旧版本把 `{provider:{baseUrl, model, vision, image}}` 存在 `config.json`，
密钥在 `secrets.bin`。首次启动新版本时：

1. 读取旧 `config.json` + `secrets.bin`；
2. 生成 `providers` 与 `routes`：
   - 对话接口 → 第一个 provider；
   - 视觉/生图若 URL 或密钥与对话不同 → 各建一个 provider（`VISION_API_KEY` / `IMAGE_API_KEY`）；
   - 否则复用对话 provider；
3. 密钥写入 `.credentials.yaml`（DPAPI 加密）；
4. 把旧文件改名为 `config.json.v1.bak` / `secrets.bin.v1.bak`（保留可回滚）。

迁移只发生一次；之后所有读写都走 v2 文件。

## 安全建议

- `.credentials.yaml` 默认走系统 DPAPI，**绑定当前 Windows 用户**；换用户/换机器后需要重新填。
- 不要把 `config.yaml` 或 `.credentials.yaml` 提交到 Git；鱼塘目录也不要。
- 导出 `.fatfish` / `.fatmem` 时不会包含密钥。
- 备份配置时，如果不想带走密钥，只复制 `config.yaml`；到新机器再填 key。
- 如果你更信任 DSH 的明文方案，可以手动写无前缀值；程序仍能解析，但**不推荐**。
- 系统不支持 DPAPI 时（极少见），程序会降级为 base64 并在设置里提示。

## 多接口示例

**对话用官方、看图和生图用别的服务：**

```yaml
providers:
  - { id: deepseek, name: DeepSeek 官方, baseUrl: https://api.deepseek.com, apiKeyEnv: DEEPSEEK_API_KEY, models: [deepseek-chat] }
  - { id: vision, name: 视觉, baseUrl: https://api.example.com/v1, apiKeyEnv: VISION_API_KEY, models: [qwen-vl-max] }
  - { id: image, name: 生图, baseUrl: https://api.example.com/v1, apiKeyEnv: IMAGE_API_KEY, models: [flux-schnell] }
routes:
  text: { providerId: deepseek, model: deepseek-chat, temperature: 1.1, maxTokens: 1600, reasoning: false, timeoutMs: 180000 }
  vision: { enabled: true, providerId: vision, model: qwen-vl-max }
  image: { enabled: true, providerId: image, model: flux-schnell, size: 1024x1024 }
```

**本机 Ollama（无需 key）：**

```yaml
providers:
  - { id: local, name: 本机, baseUrl: http://127.0.0.1:11434/v1, apiKeyEnv: OLLAMA_API_KEY, models: [qwen2.5:14b] }
routes:
  text: { providerId: local, model: qwen2.5:14b, temperature: 1.1, maxTokens: 1600, reasoning: false, timeoutMs: 180000 }
```

## 排错

| 现象 | 检查 |
| --- | --- |
| 测试提示「没有找到密钥 X」 | `s.X` 是否存在、值是否能解密；或设置同名环境变量 |
| 401 / 403 | key 是否属于这个 baseUrl；是否把网关 key 填给了官方 |
| 测试通过但聊天失败 | 路由的 `model` 是否存在；视觉/生图是否单独启用 |
| 改了 YAML 不生效 | 看文件路径是否是程序显示的那个（`FATFISH_HOME`/userData）；YAML 是否有语法错误（解析失败会回退旧配置并打印警告） |
| 迁移后找不到旧 key | 看 `secrets.bin.v1.bak`，或重新填一次；迁移日志会打印 provider 数量 |
