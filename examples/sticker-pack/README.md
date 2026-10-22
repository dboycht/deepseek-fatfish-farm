# 示例贴纸包

这个文件夹是一个**可以直接导入软件**的贴纸包示例：

- `manifest.json`：贴纸清单（包 id、名称、每张图的 id / 文件名 / 标签）
- `sample-happy.png` / `sample-hungry.png` / `sample-sleepy.png`：三张示意表情
  （裁自随软件授权的表情表，仅作格式与画风参考）

## 用它做什么

1. 看 `GPT-PROMPT.md`，把里面的提示词 + 你缺的表情列表交给 GPT；
2. 让 GPT 按同样的目录结构产出 `manifest.json` + 一批 512×512 透明 PNG；
3. 在软件「聊天输入框 → 🐟 → 导入 zip / 导入文件夹」导入；
4. 之后模型就能用 `[[sticker:<id>]]` 调这些新表情。

也可以直接把本文件夹拖进软件导入（包 id 是 `fatfish-sample-pack`，不会和内置冲突）。

## 规则速查

| 项 | 要求 |
| --- | --- |
| 图片 | PNG/WebP，512×512，透明背景，≤4MB/张，角色居中 |
| 文件名 | `<id>.png`，id 用小写字母/数字/短横线，例如 `pout.png` |
| id | 不能与内置（joy/hungry/…）或已安装包重复 |
| manifest | `id`、`name`、`version`、`items[]` 必填 |
| 数量 | 一个包 1~200 张 |

## 许可

示例图来自 `YunYueSama/codex-deepseek-pet` 的授权表情表（大肥鱼项目署名许可 1.0），
只作为画风/格式参考；你自己生成的图归你，但角色是社区二创，请勿商用或宣称官方。
