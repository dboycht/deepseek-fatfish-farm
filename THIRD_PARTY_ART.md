# 角色素材来源与许可

本项目的**代码**以 MIT 发布；但**角色立绘、表情等图片素材不适用 MIT**，它们按各自的许可使用。

## 使用了什么

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `resources/art/portrait.png`（打包进 `src/renderer/src/assets/art/`） | 立绘：引导页、创建鱼、空状态、关于页 | `YunYueSama/codex-deepseek-pet` → `assets/whale/portrait.png` |
| `resources/art/expressions.png`（同上） | 4×4 表情表：头像、贴纸、状态 | `YunYueSama/codex-deepseek-pet` → `assets/whale/expressions.png` |
| `resources/art/manifest.json` | 表情表网格参数（4 列、每格 512） | 同上 |
| `resources/art/LICENSE.txt` | 原始许可全文（随软件分发） | 同上 |
| `resources/art/LICENSE-ASSET.md` | 作者对素材范围的说明 | 同上 |

来源仓库：<https://github.com/YunYueSama/codex-deepseek-pet>
（下载时的 commit 与文件大小记录在 `resources/art/CREDITS.json`）

## 许可

**大肥鱼项目署名许可 1.0**（非标准 MIT）：

- 允许使用、修改、分享、商用；
- 须注明作者与仓库地址，分发材料或其实质性部分时须保留完整许可；
- 本许可只覆盖作者有权授权的部分；底层社区参考、角色设计与 DeepSeek 标志等第三方内容，
  不因此获得额外授权，也不代表 DeepSeek 官方授权。

按许可要求，署名如下（也可直接用于二次分发的说明）：

> 角色立绘与表情素材：YunYueSama
> 仓库：https://github.com/YunYueSama/codex-deepseek-pet
> 依「大肥鱼项目署名许可 1.0」使用，许可全文见 `resources/art/LICENSE.txt`。

## 我们**没有**使用

- 该仓库中明确标注为「用户提供的社区参考图」「第三方参考」的图片；
- 表情包档案馆（aigengtu.com / ai-girl-stickers）里的投稿图；
- DeepSeek 官方 logo 或任何官方素材。

## 角色声明

「蓝色大肥鱼 / DeepSeek 娘」是社区二创形象，与 DeepSeek（深度求索）官方无关。
本项目是非官方、非商业的同人软件，仅用于个人陪伴与本地记忆管理。

## 替换素材

想换成你自己的形象：

1. 用同尺寸透明 PNG 覆盖 `src/renderer/src/assets/art/portrait.png`
   （1024×1024，人物居中）与 `expressions.png`（2048×2048，4×4 网格，每格 512）；
2. 如果网格不同，改 `src/renderer/src/components/ArtAvatar.tsx` 里的 `CELLS` 与缩放参数；
3. `node scripts/make-icon.mjs` 重新生成应用图标；
4. 同步更新本文件与 `resources/art/LICENSE.txt`。

如果新素材有署名要求，请保留本文件的格式并替换相应段落。
