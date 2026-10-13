# knowledge-cards

小红书图文卡片生成 Skill。模型负责写文案和分块，脚本负责把 spec 确定性地渲染成像素。

一句话分工：**判断性的活在 `cards.json`，确定性的活在 `render_cards.js`。**

## 它解决什么

小红书图文的难点不在排版，在两件事：

1. **版式容易滑向 PPT** —— 三栏等分网格、圆角卡片配阴影、图标在左说明在右，看起来像一页幻灯片而不是一张值得截图保存的图。这个 Skill 把这些反模式固化成了 `variants` 开关，新风格照着做就不会再犯。
2. **中文排版的老问题** —— CJK 字形几乎撑满 em box，横图那套 1.04 行高搬到竖版会让三行字糊成一团。渲染器实测每张卡的内容高度，超出画布就打警告并以退出码 1 结束。

## 安装

把仓库里的 `knowledge-cards/` 整个目录放进你的 skills 目录：

```bash
git clone https://github.com/cindyhua/knowledge-cards
cp -r knowledge-cards/knowledge-cards ~/.minimax/skills/
```

Windows 是 `%USERPROFILE%\.minimax\skills\`。放进去之后目录结构应该是
`skills/knowledge-cards/SKILL.md` —— 目录名必须和 SKILL.md 里的 `name` 一致。

## 环境依赖

| 依赖 | 说明 |
|---|---|
| Node.js | v18+，只用内置模块，**无 npm 依赖**，clone 下来直接能跑 |
| Chrome 或 Edge | 渲染器用 headless 模式截图。找不到时设 `CHROME_PATH` 环境变量 |
| 中文字体 | 思源宋体 / 思源黑体，或系统自带的等价字体 |

## 用法

写一份 `cards.json` 描述卡片，然后渲染：

```bash
node scripts/render_cards.js \
  --spec cards.json \
  --style references/STYLE-01-editorial.json \
  --out out/
```

换平台尺寸走命令行覆盖，**永远不要改 token 文件的 `canvas`**：

```bash
node scripts/render_cards.js --spec cards.json \
  --style references/STYLE-06-illustration.json --out out/ \
  --width 1080 --height 1080
```

画布尺寸属于平台，不属于风格。

## 六种版式

| block | 职责 | 说明 |
|---|---|---|
| `cover` | 索引 | 目录 + 统计，告诉读者这套有几张、分别讲什么 |
| `ladder` | 分级路径 | 编号 + 步骤 + 难度星标 |
| `resource` | 单项详解 | 一份资料 / 一个工具的深度介绍 |
| `items` | 并列清单 | 多个同级要点 |
| `qa` | 验收清单 | 可勾选的动作项 |
| `poster` | 拦截 | **只让人停下来点**，元素 ≤5，一处强调色 |

`cover` 和 `poster` 的区别值得单独说：`cover` 是索引职责，`poster` 是拦截职责。
一张封面要么在告诉人里面有什么，要么在让人点进来，不要两个都想干。

## 风格编号库

15 套风格，`02`–`05` 因版式像 PPT 被判**作废**（编号不复用，留档仅作记录）。
查号和加新风格的规矩看 [`knowledge-cards/references/style-registry.md`](knowledge-cards/references/style-registry.md)。

| 编号 | 名称 | 状态 |
|---|---|---|
| 01 | 杂志编辑风 | 已启用 |
| 02–05 | — | **作废，编号不复用** |
| 06 | 插画风 | 已启用 |
| 07–09 | 大字报 / 拼贴 / 手记 | 候选 |
| 10–12 | 干货大字报 / 白底撞色 / 活力橙 | 已启用，纯文字海报 |
| 13–15 | 毛绒潮玩 / 动漫工位 / 微缩立体书 | 已启用，插画型海报 |

编号**一旦分配就不复用、不重排**。加新风格从 `16` 开始。

## 插画素材池

`assets/art-pool/` 有 13 张 21:9 横带，按风格分组，清单见同目录 `pool.json`。
换内容时挑一张贴到封面顶部，不必每次重新生图 —— 插画是静态素材，**不会跟着主题自动变**。

在 `cards.json` 里引用（路径相对 `cards.json` 所在目录解析，也可以写绝对路径）：

```json
{ "block": "poster", "name": "00-cover",
  "art": "assets/art-pool/14-code.jpg" }
```

生图提示词的三条硬规则，都是踩坑换来的：

1. **主体居中，左右配等重**。封面在信息流里是缩略图，主体偏一侧会让整张图重心失衡。
2. **明写禁止色**。只说「暖色背景」不够，模型会随手把配景补成绿植，得写 `ABSOLUTELY NO GREEN`。
3. **写死无文字**：`Absolutely no text, no letters, no numbers, no typography, no watermark`。中文一律由渲染器叠。

## 渲染器不会放过你的三种错

| 情况 | 行为 |
|---|---|
| 内容溢出画布 | 打 `⚠ OVERFLOW NNpx`，exit 1。`.card` 是 `overflow:hidden`，不量就会静默裁掉 |
| `art` 指向不存在的文件 | **删掉那张 PNG** 并 exit 1。留一张顶部空白的封面在输出目录里才是真正的危险 |
| 字体没生效 | 不会报错，但中文会掉成默认字体 —— 所以**渲染完必须看图**，返回 OK 不代表图对 |

溢出检测有 8px 容差：真实布局带小数像素，「最后一个元素底边正好压在内容框底边」会误报 3–5px，
而真实溢出一个数量级更大（实测 51 / 98 / 355px）。

## 仓库结构

```
README.md                  本文件
LICENSE                    MIT
assets/art-pool/           插画素材池（13 张横带 + pool.json 清单）
knowledge-cards/           ← 这个目录装进 skills/
  ├── SKILL.md             Skill 主文件
  ├── scripts/
  │   └── render_cards.js  渲染器，零依赖
  └── references/
      ├── style-registry.md    编号库：查号、新风格的规矩、踩过的坑
      ├── STYLE-NN-*.json      token 文件（渲染器读）
      └── STYLE-NN-*.md        规格文档（怎么写 cards.json）
```

## 一些硬规矩

- **不要改 token 的 `canvas`** —— 换平台用 `--width/--height`。改了等于把这个编号永久改坏。
- **不要为了塞下内容去删关键信息** —— 宁可按降级顺序缩字号：`type.body` 26→24 → `type.keys` 25→23 → `type.quote` 29→27。
- **★ 是难度不是数量** —— ★ 比 ★★★★★ 容易。
- **同一张海报里 `seal` 和 `blk`/`hi` 二选一** —— 强调色一图只给一处，同一个信息不说两遍。
- **中文行高必须 ≥1.16**。

## License

MIT。`assets/art-pool/` 下的插画由 AI 图像模型生成，供本 Skill 产出的卡片自由使用。