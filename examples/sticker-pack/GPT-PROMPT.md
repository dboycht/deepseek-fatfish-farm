# 给 GPT 的批量生成任务（直接复制）

> 用法：先在软件里点「🐟 → 导出需求清单（含 GPT 提示词）」，把导出的「缺失的表情」列表
> 粘到下面 `【缺失表情】` 的位置；没有缺的也可以自己列一批想补的表情。
> 生成后让 GPT 按 `manifest.json` 格式打包成 zip，回到软件导入。

---

你是一个角色表情包生成助手。角色是「蓝色大肥鱼」：Q 版鲸鱼娘，深蓝到浅蓝渐变长发、呆毛、
白色女仆发带、蓝色眼睛、白色围裙（上面有蓝色小鲸鱼）、一条蓝色鲸尾，圆滚滚、呆萌、带点屑。

请为下面每一个表情生成一张图，并输出一个可导入软件的贴纸包：

【缺失表情】
- pout：鼓嘴生气 / 被逗急了
- surprised：震惊 / 呆住
- speechless：无语 / 省略号
- clingy：贴贴 / 想被摸头
- proud：得意 / 叉腰
（按实际需求替换或增删）

## 图片要求

- 512×512 PNG，透明背景，角色居中，半身或全身 Q 版
- 粗描边、干净赛璐璐上色，表情夸张但可爱
- 不要文字、不要水印、不要多余角色、不要复杂背景
- 同一套图里保持发型、发带、围裙、鲸尾、配色完全一致
- 每张一个文件，文件名用表情 id（如 `pout.png`）

## 输出结构

```text
my-sticker-pack/
├── manifest.json
├── pout.png
├── surprised.png
├── speechless.png
├── clingy.png
└── proud.png
```

`manifest.json`：

```json
{
  "id": "my-sticker-pack",
  "name": "我的大肥鱼补充表情",
  "version": "1.0.0",
  "author": "your-name",
  "license": "CC-BY-NC-4.0",
  "description": "用 GPT 批量生成的补充表情",
  "items": [
    { "id": "pout", "label": "鼓嘴", "file": "pout.png", "tags": ["生气", "撒娇"] },
    { "id": "surprised", "label": "震惊", "file": "surprised.png", "tags": ["惊讶"] }
  ]
}
```

## 约束

- `id` 只能用小写字母/数字/短横线（2~32 位），不能与内置 `joy/hungry/rice/sleepy/proud/shy/angry/cry/work/love/dizzy/smug` 冲突
- 一个包最多 200 张，每张 ≤4MB
- 不要参考或模仿任何具体画师/作品的画风；使用通用的日系 Q 版风格
- 角色是社区二创，生成物仅用于非商业同人使用

最后把整个文件夹压成 zip 发给我（或直接给我文件清单），我导入软件测试。
