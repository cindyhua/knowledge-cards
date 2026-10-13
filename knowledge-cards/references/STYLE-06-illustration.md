# STYLE-06 · 插画风 — 规格与插画生成流程

Token 文件：`STYLE-06-illustration.json`。本文额外说明**插画资产怎么生成** —— 这是 01–05 都没有的部分。

## 风格内核

奶油底 + 珊瑚橙强调 + 大圆角（24px）。文字排版规则和 01–05 完全一致，
唯一的区别是**卡片顶部有一条真实插画带**。插画不是装饰噪点，它承担视觉记忆点。

## 插画字段

每张卡片可加两个字段：

| 字段 | 说明 |
|---|---|
| `art` | 图片路径。相对路径以 **cards.json 所在目录**为基准，或写绝对路径 |
| `artHeight` | 插画带高度（px）。封面默认 280，内容卡默认 300 |

插画带宽度铺满卡片内边距，圆角跟随风格的 `radius`，`object-fit: cover` 居中裁切。

## 生成插画（关键流程）

用 `mcode-tools` 的文生图。**先加载 `mcode-tools-master` skill** 再执行命令。

1. 写 args 文件（Windows 上用 `--args-file`，避免引号转义问题）：

```json
{ "requests": [ {
  "prompt": "<见下方模板>",
  "aspect_ratio": "21:9",
  "resolution": "2K",
  "output_file": "cover-art.jpg"
} ] }
```

2. 生成（bash timeout 设 600）：

```powershell
mcode-tools connector call connector__matrix__generate_image --args-file art-args.json
```

返回 `success_items[].node_id` 和 `file_name`。

3. 下载：

```powershell
mcode-tools get_asset_url <node_id>    # → download_url
Invoke-WebRequest -Uri <download_url> -OutFile art/cover-art.jpg
```

一次调用可以传多个 request（`requests` 数组），批量出图比逐张快。

## 提示词模板 —— 必须带死"不要文字"

```text
Flat vector editorial illustration, minimalist geometric shapes.
<画面描述>.
Soft coral, mint green and warm yellow shapes on a cream background.
Rounded organic forms, soft flat shadows, no gradients.
Absolutely no text, no letters, no numbers, no typography, no writing anywhere.
Generous negative space. Modern magazine illustration style.
```

**「不要文字」这一句不能删。** 扩散模型渲染字符几乎必然出错，
而且失败得很隐蔽 —— 它会生成形状像字母的装饰性笔画，不仔细看就放过去了。
文字一律交给 HTML/CSS 排版，插画只负责画面。

**一组卡必须复用同一段配色描述**，否则每张图配色漂移，整套看起来不像一套。

### 画面描述怎么写

描述「场景」，不要描述「文字内容」。有效：

- 俯视几个人围坐圆桌协作，对话框是纯色圆角块
- 一块空白网格板、一支笔、若干对勾徽章和纯色便签块

无效：想让图里出现"议程""计划"这类词 —— 换个画面隐喻，比如网格板加对勾。

## 高度预算（溢出高发区）

插画带是硬占空间的，加高就直接把底部内容挤出画布。实测预算：

| 卡片 | artHeight | 说明 |
|---|---|---|
| `cover` 带 toc + stats + hint | **280** | 上限。380 会把 hint 整行挤掉 |
| `cover` 不带 toc | 380～420 | 目录和插画二选一，别都要 |
| `resource` / `items` / `qa` | **300** | 再高就得砍掉 `more` 或缩短正文 |

溢出**不会报错**，只会安静地把内容推下去。所以插画风格出图后**必须看图**，
重点看封面最后一行有没有被切掉。

## AIGC 标识 —— 已定性，不要重复问

**用户已判定：插画算装饰，不算内容主体。** 所以不需要逐图标注 AIGC，
也不要在卡片上加声明条。用这套风格出图时直接按普通卡片交付。

事实记录（2026-10 核实）：
- `generate_image` 返回的原始 jpg，EXIF 里带 `AIGC.Label = "1"`、`ContentProducer = "MiniMax AI"`
- 但成品卡是 Chrome 截图生成的**全新 PNG**，EXIF / tEXt 全空，**标识在流水线末端丢失**
- 结论：当前链路下成品图本来就不含该标识，与「装饰/主体」的定性一致

**什么情况下要重新提这件事：**
1. 插画升级成内容主体（例如整张卡就是一张图，文字只做标注）
2. 用户改变主意
3. 发布平台明确要求声明 AI 生成

届时做法二选一：卡片角上压一条统一声明，或写进发布文案 / 勾选平台标签。

## 其他

- 配色 token 里的 `paper` 要和插画背景色接近，插画带才不像贴上去的贴纸。
  当前配置 `paper: #FBF3E7`，插画提示词里写的 cream 就是这个色。
- `coverBg` 是 `paper`（浅色封面），这样插画和封面是一体的。
- 其余 block 字段、标签覆盖规则、★ 语义，全部照 `STYLE-01-editorial.md`，没有例外。