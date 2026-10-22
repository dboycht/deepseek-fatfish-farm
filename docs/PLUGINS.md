# 插件开发

软件的一切可扩展点都在 `plugins/`。一个插件就是一个文件夹：

```
plugins/my-plugin/
├── manifest.json   必需：元信息
├── main.js         可选：CommonJS 入口，导出 activate(api)
└── panel.html      可选：面板（在 iframe 里打开）
```

## 加载顺序与位置

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| 内置 | 开发时 `仓库/plugins/`；打包后 `<安装目录>/resources/plugins/` | 随软件分发 |
| 用户 | `%APPDATA%/deepseek-fatfish-farm/plugins/` | 同名 id 会覆盖内置插件 |

软件启动时扫描并 `require` 每个插件的 `main.js`；在「记忆面板 → 插件」里可以
**重新扫描**、**停用/启用**、打开用户插件目录。

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": "your-name",
  "main": "main.js",
  "panel": { "title": "面板标题", "entry": "panel.html" },
  "permissions": ["read:fish", "write:stats", "read:memory"]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识，建议 kebab-case；会显示在 URL 协议里 |
| `name` / `version` | ✅ | 展示用 |
| `main` |  | 相对插件目录的 CommonJS 入口；没有则只有面板或纯静态资源 |
| `panel.entry` |  | 面板 HTML；存在时界面会出现「打开面板」 |
| `permissions` |  | 仅作展示与审计，不参与运行时鉴权 |

## 主进程 API

`main.js` 可以是：

```js
module.exports.activate = (api) => { ... }
// 或
module.exports = (api) => { ... }
```

`api` 提供：

| 方法 | 说明 |
| --- | --- |
| `api.pluginId` / `api.manifest` | 自身信息 |
| `api.registerCommand({ id, title, run(payload) })` | 注册命令；会出现在插件面板的按钮里 |
| `api.getFish(fishId)` | 读肥鱼档案（只读快照） |
| `api.addStats(fishId, { tokens, meals, exp, mood, hunger })` | 修改状态（增量），返回新档案 |
| `api.listMemories(fishId)` | 读压缩记忆卡片数组 |
| `api.config()` | 读应用配置（含 pondRoot、provider 等） |
| `api.emit(type, payload)` | 往渲染进程推事件（目前用于扩展，无默认 UI） |
| `api.log(...args)` | 主进程控制台日志 |

命令的 `run` 可以返回任意可序列化值，界面会把它作为 toast 文本显示（字符串原样显示）。

示例：`plugins/rice-diary/main.js`。

## 面板与桥

面板通过自定义协议加载：

```
fatfish-plugin://<pluginId>/<entry>
```

- 只能读取**自己插件目录内**的文件（路径穿越会被 403）。
- iframe 带 `sandbox="allow-scripts allow-forms allow-same-origin"`，没有 Node 权限。
- 与宿主用 `postMessage` 通信：

宿主 → 面板：

```js
{ type: 'farm:init', pluginId, context: { fishId, fishName, hue, stats, memories, theme } }
{ type: 'farm:result', id, ok: true, result }   // 或 ok:false, error
```

面板 → 宿主：

```js
// 调一个命令
parent.postMessage({ type: 'farm:invoke', id: 1, command: 'bonus', payload: { fishId } }, '*')

// 弹一个 toast
parent.postMessage({ type: 'farm:toast', text: '加餐完成', kind: 'ok' }, '*')
```

`id` 由面板自增生成，宿主原样带回，便于 Promise 化：

```js
function invoke(command, payload) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    parent.postMessage({ type: 'farm:invoke', id, command, payload }, '*')
  })
}
```

完整可运行示例：`plugins/rice-diary/panel.html`。

## 安全边界（务必读）

- 插件主进程代码拥有和软件同等的 Node 权限（能读写文件、发网络请求）。
  只安装你信任的插件；不需要时在插件面板里停用。
- 面板代码被限制在 iframe + 自定义协议内，不能直接 `require`，也不能读插件目录之外的文件。
- 不要在主进程代码里把 API Key 传给面板；需要密钥的逻辑放在主进程。
- 插件不要写 `data/` 或鱼塘外的路径；数据操作请走 `api`。

## 调试

1. 把插件文件夹放进用户插件目录，点「重新扫描」。
2. 看终端日志：`[plugin:<id>] ...`。
3. 如果显示「加载失败」，检查 `manifest.json` 是否能被 JSON 解析、`main` 路径是否存在、
   `activate` 是否真的导出。
4. 面板打不开：确认 `panel.entry` 指向 HTML，且没有引用目录外的脚本/图片
   （也可以用 data: 内联）。

## 发布

插件不需要编译：手写 JS/HTML 即可。分发时打包整个文件夹，附上许可与说明。
