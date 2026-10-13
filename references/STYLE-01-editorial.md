# STYLE-01 · 杂志编辑风 — 规格与卡片字段

Token 文件：`STYLE-01-editorial.json`（渲染器读取）。本文说明**怎么写 cards.json**。

## 风格内核

米白纸底 + 思源宋体 900 字重大字标题 + 朱红单一强调色。朱红只出现在四个地方：序号、栏目标签、
pull-quote 左边框、封面强调数字。底部大片留白 + 贴底的引语块 —— 这个留白就是"杂志感"的来源，
不要用其他元素把它填掉。

## 画布与平台

画布尺寸**不属于风格，属于平台**。`STYLE-01-editorial.json` 里的 `canvas` 是这套风格的默认出图尺寸，
换平台时用命令行覆盖，不要改 token 文件 —— 改了等于把风格 01 改坏。

```powershell
node render_cards.js --spec cards.json --style STYLE-01-editorial.json --out ./out `
  --width 1080 --height 1080
```

`supportedCanvas` 列出了这套风格调校过的尺寸：

| 尺寸 | 比例 | 表现 |
|---|---|---|
| 1080×1440 | 3:4 | **默认，最佳**（小红书） |
| 1080×1080 | 1:1 | **能用，但要砍内容**。实测正常长度文案在方图下溢出：封面 98px、内容卡 51px、条目卡 355px。封面通常得删掉副标题，条目卡塞不下第三条 |
| 900×383 | 2.35:1 | **直接崩**。实测文字互相压叠、内容被裁。顶部条 / 大标题 / 底部留白这套节奏撑不开横幅 |
| 1080×1920 | 9:16 | 未验证，且留白比例全错，另需考虑界面遮挡 |

渲染器现在会**实测每张卡的内容高度**，超出画布就打 `⚠ OVERFLOW NNpx` 并以退出码 1 结束。
这是因为 `.card` 用了 `overflow:hidden` —— 内容被裁掉时 PNG 照样正常生成、退出码也是 0，
光看「4/4 rendered」会被骗过去。**看到 OVERFLOW 就必须回去改文案**，别当成装饰性提示。

超出 `supportedCanvas` 的比例同样会先打 WARNING。真要支持极端比例，得换 `block` 组合
（比如 2.35:1 用 `cover` 单张），不是缩放能解决的。

## 字段的两类写法（先读这条）

| 类型 | 字段 | 写法 |
|---|---|---|
| **纯文本** | `subtitle` `titleCn` `src` `kicker` `folio` `footerL` `footerR` `ans` `lead` `tag` `desc` `text` `sub` `right` `ghost` | 直接写中文，不要写标签 |
| **原始 HTML** | `title`（数组每一行）`why` `keys[]` `note` `endnote` `stats[]` 的 value | 需要强调时写 `<b>` / `<span class="em">…</span>` |

写纯文本字段时如果里面有 `&` 或 `<`，渲染器会自动转义，不会出错。
原始 HTML 字段里的标签**不会**被转义 —— 这是为了能染朱红，代价是你得保证自己写对。

标题支持 HTML 的实际用法：把要染朱红的数字或词包起来。

```json
"title": ["Agent 工程", "必读的 <span class=\"em\">5</span> 份资料"]
```

## ★ 星标的含义

**★ 数 = 难度 / 上手成本，由高到低。** ★★ 比 ★★★★★ 容易。
封面 stats 里的 `★★★ → ★★★★★` 就是这套卡片的难度区间。
不要用星标表达重要度或优先级 —— 那会让读者误解。

**科普 / 非技术向题材默认不要用星标。** ★ 是这套风格里最容易被读成"推荐度 / 重要度"的元素，
发给非技术同事时几乎必然误读，而误读很隐蔽 —— 排版正常，不会有任何报错提示你。
`meta` 只留 `[标签, 值]` 两列即可，例如 `"meta": [["类型", "整体认知"]]`。
这条不是建议，是这类题材的默认做法；要用星标请显式确认读者会按"难度"读。

## 支持的 block 类型

`cards` 数组里每张卡片必须有 `block` 字段，取下面 5 种之一。

### `cover` — 封面（墨黑反色）

```json
{
  "block": "cover", "name": "01-cover",
  "kicker": "AI AGENT · READING LIST", "folio": "COVER",
  "ghost": "5",
  "title": ["第一行", "第二行"],
  "subtitle": "一句话说明这套图讲什么",
  "toc": [["01", "条目名", "右侧小字"], ...],
  "stats": [["资料量", "5 份"], ["总时长", "340 <span class=\"u\">分钟</span>"], ...],
  "hint": ["封面 + 8 张内容卡", "→ 右滑开始"]
}
```
`title` 是数组，逐行 `<br>` 拼接，断行自己控制。`stats` 的 value 走原始 HTML，
需要小字用 `<span class="u">…</span>`（自动降到 24px 并转灰）。
`ghost` 是右上角的大号背景数字，和标题首行容易打架 —— 标题排三行时最容易撞。

### `ladder` — 梯度列表（路线图 / 排行）

```json
{
  "block": "ladder",
  "kicker": "学习路线图", "folio": "01 / 08",
  "title": ["五份资料，", "一条明确的梯度"],
  "rows": [{"n":"01","title":"Building Effective Agents","sub":"Anthropic · 并行模式","stars":2,"right":"40 分钟"}],
  "note": "建议顺序 <b>01 → 02 → 03</b>：…",
  "total": {"label":"全部读完","value":"340","unit":"分钟 · 约 5.5 小时"},
  "footerL": "一手资料", "footerR": "从 01 开始"
}
```
`note` 走原始 HTML（要强调就用 `<b>`）。`total` 省略则底部不出现黑条。
`ladder` 适合"多条目 + 每条有数值指标"的场景；单条内容用 `resource` 更合适。

### `resource` — 单份资料卡（主力块）

```json
{
  "block": "resource",
  "kicker": "资料 01 / 05", "folio": "03 / 08",
  "title": "Building Effective Agents",
  "titleCn": "把 agent 拆成可枚举的模式",
  "src": "ANTHROPIC RESEARCH · 一手工程方法论",
  "meta": [["类型","方法论"], ["难度","",2], ["时长","40 分钟"]],
  "why": "原始 HTML，<b>可加粗</b>",
  "keys": ["<b>Workflow vs Agent</b> 的区分", "五种模式的适用场景表"],
  "more": ["inferenceloops.com", "owerczuk.dev"],
  "ans": "给我一个业务需求，我能不能判断它该做成 workflow 还是 agent？",
  "footerL": "anthropic.com/research/...", "footerR": "03 · 资料 01"
}
```
- `meta` 三列固定顺序 `[标签, 值]` 或 `[标签, "", 星数]`（第三元素 1–5 渲染成 ★☆☆☆☆）。科普 / 非技术向题材按上方「★ 星标的含义」的警告省略星数列。
- `why` / `keys[]` 走原始 HTML，需要强调写 `<b>`。
- `more[]` 可省略，省略后 pull-quote 自动上移，页面依然成立。
- `ans` 是这张卡的钩子，纯文本。

**标签字段可以覆盖 —— 换主题必改。** 默认值是按"书单推荐"场景写的，直接套到别的题材上
会出现语义错位（例如讲技术要点时印着"为什么选它"）。非推荐类内容要显式覆盖：

| 字段 | 默认值 | 技术要点 | 科普 / 非技术向 | 教程 | 清单 |
|---|---|---|---|---|---|
| `whyLabel` | `为什么选它` | `为什么重要` | `为什么重要` | `解决什么问题` | `为什么值得看` |
| `keysLabel` | `重点读` | `怎么做` | `拆开看` | `操作步骤` | `包含哪些` |
| `ansLabel` | `读完应能回答` | `实战时会问` | `能讲给别人听吗` | `学完你会` | `检查一下` |
| `moreLabel` | `延伸阅读` | `配套工具` | `想深入看` | `参考` | `补充材料` |

 STYLE-01 的 `bestFor` 第一条就是"知识科普"，所以科普那一列不是可选项 —— 遇到科普题材就按它填。

### `items` — 编号条目卡（补充清单）

```json
{
  "block": "items",
  "kicker": "加餐 · 有余力再看", "folio": "07 / 08",
  "title": ["三份延伸阅读"], "titleCn": "不影响主线，但值得收进资料架",
  "lead": "一段引导语",
  "items": [{"n":"01","title":"LangChain《…》","tag":"从业者调研","desc":"正文…"}],
  "endnote": "收尾句，<span class=\"em\">强调部分</span>",
  "footerL": "附录 · 3 份选读", "footerR": "08 · 加餐"
}
```
`endnote` 走原始 HTML，强调用 `<span class="em">…</span>`（自动染朱红）。
条目只有 2–3 条时这张卡会显得空 —— 加 `lead` 段，或直接把条目正文写厚一点。

### `qa` — 验收清单

```json
{
  "block": "qa",
  "kicker": "验收清单", "folio": "08 / 08",
  "title": ["读完这 5 份，", "你应该能回答"],
  "rows": [{"n":"01","text":"问题正文","dim":"来自 资料 01"}],
  "endnote": "收尾句",
  "footerL": "收藏这组卡", "footerR": "END"
}
```

## 通用规则

- `title` 数组逐行 `<br>` 拼接；单行标题给一个元素的数组。
- 文案本身不要为了"排版好看"改写。分卡、断句、加行内 `<b>` 强调是允许的，改措辞不是。
- `name` 决定文件名（`out/<name>.png`），用 `01-…`、`02-…` 顺序前缀，方便按序发布。
- 卡片数超过 10 张时 `folio` 手动写 `NN / NN`，渲染器不会自动改。
- 张数不凑数：用户给 N 个要点就出 N 张内容卡，不够就用留白撑，不编内容。

## 字号微调

正文太长导致溢出时，按这个顺序降级：`type.body` 26→24 → `type.keys` 25→23 →
`type.quote` 29→27 → 内容缩（删冗余句，不删关键信息）。
**不要**先动 `title`，标题字号是这套风格的脸。

改 `type.*` 要改 `STYLE-01-editorial.json`，重渲后**必须再看图** ——
字号变化可能反而把原本平衡的留白弄失衡。
## `variants`：换版式不只换配色

02–05 被判掉的原因是**版式像 PPT/报表**，不是配色。根因是基础版式里有三个硬伤，
所以它们做成了开关，放在 token 的 `variants` 段：

| 键 | 取值 | 作用 |
|---|---|---|
| `metaLayout` | `table`（默认）/ `stack` / `inline` | 三栏表格改竖排块，或压成 `适用／所有会议 ／成本／5 分钟` 一行 |
| `secLabel` | `rule`（默认）/ `plain` / `block` / `underline` | 章节标签后面那条拉到右边缘的长横线（PPT 味最重的一处） |
| `bulletShape` | `square`（默认）/ `dot` / `bar` / `dash` / `arrow` / `num` | 方块项目符号换成 01/02 序号、长横线、三角等 |
| `titleBlock` | `false`（默认）/ `true` | 标题嵌进实色块；开了之后封面的 ghost 数字自动不输出 |
| `cardBg` | 不填 / 十六进制色 | 整张内容卡铺一个底色 |
| `quoteStyle` | `bar` / `fill` / `rule` / `outline` / **`high`** | `high` 走 `colors.quote` 铺底（荧光笔效果），`fill` 走 `colors.accent` |

改这些开关后**一定要看图**：同一份 spec 在不同 variants 下留白完全不同，
有的组合会把正文挤到溢出（渲染器会报 `⚠ OVERFLOW` 并 exit 1）。

## 溢出检测的容差

渲染器量的是 `scrollHeight - clientHeight`，但真实布局带小数像素（letter-spacing、1.6 行高），
所以「最后一个元素底边正好压在内容框底边」的封面仍会报 3–5px。实测证据：该封面最后一块底边
= 1374px = 1440 − 66px 内边距，什么都没裁，但探针报 4px；真实溢出一个数量级更大
（实测 51 / 98 / 355px）。因此 `OVERFLOW_TOLERANCE = 8`，低于此值不报警。
## `poster` block（10–15 号用）

和 `cover` 并列的第六种版式，专职做封面。spec 字段：

```json
{
  "block": "poster",
  "name": "01-cover",
  "art": "poster/art/xxx.jpg",
  "kicker": "AI AGENT · 实测精选",
  "seal": ["18", "篇精读"],
  "title": ["Agent", "工程必读", "<span class=\"hi\">5</span> 份资料"],
  "sub": "副标题一句话",
  "tags": ["封面 + <b>8</b> 张内容卡", "总时长 <b>340</b> 分钟"]
}
```

- `title` 一个数组元素一行，行内可用 `<span class="hi">`（强调色）
  和 `<span class="blk">`（实色块衬底）。**这两个二选一，不要都上** —— 一处强调是硬规则。
- `seal` 可选，`[大数字, 小字]`，自动排成右上角旋转 −6° 的方章。
- `rule: false` 可以去掉色条。
- `art` 可选。给了就渲染成顶部整幅插画带，高度由 `variants.posterArtH` 定。

### 插画素材的生成与裁切

**素材比例必须按用途选**，这是实测踩过的坑：

- 人物、场景、微缩景观 → 生 **21:9**。3:4 素材裁成约 2:1 的横带会丢掉一半高度，
  实测把动漫角色裁成了「只剩一撮头发的贴纸」。
- 主体居中的特写（如单个毛绒角色）→ 3:4 也能用，因为裁切后主体仍完整。

出图提示词里必须写死「**Absolutely no text, no letters, no numbers, no typography,
no watermark**」。中文仍然一律由渲染器叠，不要交给图像模型写。

素材下载后按内容调整 `variants.posterArtPosition`（`object-position`）。
默认 `center 34%`；主体偏上的素材要调到 `center 10%` 之类。

### `art` 写错会直接失败（不是静默跳过）

spec 里显式写了 `art` 但文件不存在时，渲染器**删掉那张 PNG 并以退出码 1 结束**：

```
FAIL 00-cover    0 bytes  ⚠ ART MISSING — png deleted
⚠ 1 card(s) name an illustration that does not exist. Their PNGs were DELETED:
   00-cover
   missing file: C:/definitely/not/here/xxx.jpg
```

原来这里只打一行 warning 就继续出图，退出码还是 0 —— 交付目录里躺着一张顶部空白的
封面，看起来完全正常，然后被人拿去发了。同批其它卡不受影响照常出图。

`.hasart` 也改成由**实际渲染出的 `<img>`** 决定，不再看 `card.art` 字段。原来文件缺失时
`hasart` 仍然成立，`.poster.hasart .kicker{margin-top:posterArtH+44px}` 照样生效，
于是顶部空出一整条 520px 高的洞。两条都已修，正常路径逐字节无变化。

`art` 是可选字段，**不写就不渲染也不占位** —— 想要纯文字海报就别带 `art`。

### 现成素材池

`assets/art-pool/` 下有 13 张 21:9 横带，按风格分组，清单见同目录 `pool.json`：

| 风格 | 数量 | 场景 |
|---|---|---|
| `13` 毛绒潮玩 | 3 | 看书的玩偶 / 敲电脑的玩偶 / 举放大镜的玩偶 |
| `14` 动漫工位 | 4 | 办公 / 敲代码 / 写字 / 读书 |
| `15` 微缩立体书 | 4 | 山脉 / 森林 / 城市 / 海岸 |

换插画 = 改 spec 的 `art` 指向另一张再重渲，不用重新生图。选图和配色错开的原则见
`style-registry.md`。

### poster 专属 token

| 键 | 作用 |
|---|---|
| `posterBg` | 底色，**可以直接吃 CSS 渐变字符串**，如 `linear-gradient(158deg,#FF9E2C,#FFD98A)` |
| `posterInk` / `posterInkMuted` | 标题与次要文字色。独立于 `colors.ink`（那个是按纸底调的） |
| `posterTagInk` | 标签里 `<b>` 的颜色。亮底风格必调，否则白字压在橙底上看不清 |
| `posterSealBg` / `posterSealInk` | 印章配色 |
| `posterTexture` | `none` / `grain`（胶片噪点）/ `paper`（纸纹网格）/ `glow`（径向光晕） |
| `posterArtH` / `posterArtPosition` | 插画带高度与裁切焦点 |
| `posterRuleW` / `posterRuleH` | 标题下色条尺寸 |