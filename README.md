# dsh-eye-themes · 五套护眼主题

给 DeepSeek Harness 加五套护眼配色：**宣纸 / 豆沙绿 / 月白 / 墨夜 / 霞光**。
设置 → 通用里多一行选择器，点一下立即生效，不做别的。

![五套配色预览](preview/palettes.jpg)

（`preview/preview.html` 可以自己用浏览器打开，界面用真实 token 名渲染，深浅两组共 10 张卡片。）

## 它是什么

- **5 套配色，每套自带浅色 + 深色两个变体**。所以内置的「浅色 / 深色 / 跟随系统」照常可用，
  它决定当前显示哪一套的日间还是夜间版本，而不是被插件抢走。
- **只叠加 token，不注入 CSS**。每套配色是一层 `--dsw-*` 别名变量，交给内置 `theme` 服务
  （`overrideTokens`），由 `ui-layout` 的 presenter 写成 `<body>` 上的内联自定义属性。
  因此和任何第三方主题插件都能共存，卸载后不留残余样式。
- **一行 UI，没有开关、没有滑块、没有字体设置**。5 个色卡 + 一个「默认」。
- 选择记在 `localStorage`（键 `dsh-eye-themes:palette`），刷新后自动恢复；
  多窗口之间通过 `storage` 事件同步。「默认」＝撤掉这一层，回到内置配色。

## 五套配色

正文对比度按 WCAG 2.1 实测（`npm run verify` 会重新校验，任何一项跌破阈值即构建失败）。

| 主题 | 风格 | 底色（浅 / 深） | 主文字 | 强调色 | 正文对比度 |
|---|---|---|---|---|---|
| 宣纸 Paper | 暖米黄，久读不涩 | `#F5F0E1` / `#211F19` | `#2E2A22` | `#8A5A2B` | 12.54 / 12.86 |
| 豆沙绿 Sage | 经典护眼绿 | `#CCE8CF` / `#16231A` | `#1F2E20` | `#2B6440` | 10.89 / 12.70 |
| 月白 Mist | 冷灰白，明亮房间 | `#ECEDE7` / `#1A1D20` | `#2A2E2A` | `#33667A` | 11.71 / 12.23 |
| 墨夜 Ink Night | 无彩中性，夜间不偏色 | `#EDEDEB` / `#16171A` | `#26262A` | `#4B4E6B` | 12.86 / 12.61 |
| 霞光 Amber | 暖杏暮色，蓝光最少 | `#F6EDE0` / `#1D1512` | `#33281F` | `#9A5230` | 12.37 / 12.17 |

共同约束（`src/palettes.mjs` 顶部注释即规范）：

- 不用纯白底、纯黑字：浅色底固定在 `#ECEDE7`–`#F6EDE0`，深色底固定在 `#16171A`–`#211F19`，
  正文对比度封顶 14:1，避免长时间阅读的眩光；
- 正文 ≥ 7:1（AAA）、次要文字 ≥ 4.5:1、链接 ≥ 4.5:1、代码区文字 ≥ 7:1、语法高亮 ≥ 3:1；
- 强调色一律降饱和：护眼不是把界面刷成糖果色。

每套覆盖 **146 个 token**（`lib/palettes.json` 可逐条查阅，含每个 token 的浅/深两个值），
包括背景层次、边框、文字层级、按钮、交互态、Markdown/代码块、滚动条、状态色、diff、
菜单/提示/引导、侧栏与气泡，以及 `--shiki-*` 语法高亮与 `--dsw-static-*` 兜底色阶。

## 安装

本机（`web` profile，也就是当前 GUI 用的那个）已经装好了：

```bash
ln -sfn /Users/gusu/Desktop/aiTest/dsh-eye-themes ~/.dsh/profiles/web/node_modules/dsh-eye-themes
# 再把 "dsh-eye-themes" 加进 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles
```

分发安装（任选其一）：

```bash
npm pack                                   # 生成 dsh-eye-themes-1.0.0.tgz
dsh plugin --profile web install ./dsh-eye-themes-1.0.0.tgz
# 或在插件市场里安装 @<你>/dsh-eye-themes
```

装完**重启 DSH Desktop / `dsh web`**，打开 设置 → 通用，在「外观」「字号大小」下面即可看到「护眼配色」。

卸载：从 `dsh.profile.bundles` 移除该条目（或 `dsh plugin --profile web remove dsh-eye-themes`）后重启。
配色层随插件一起释放，不会留下覆盖样式。

## 开发

```bash
npm run build     # src/ → lib/client.js（ModuleLoader bundle）+ lib/palettes.json
npm run verify    # token 名对照真实主题表、10 个变体的对比度、bundle 行为自测
node tools/preview.mjs && open preview/preview.html   # 10 张卡片的静态预览
```

目录：

| 路径 | 作用 |
|---|---|
| `src/palettes.mjs` | 5 套配色的种子（每套浅/深各 10 个种子色）+ 146 token 的推导规则 |
| `src/color.mjs` | 混色 / 透明度 / 相对亮度 / WCAG 对比度，无依赖 |
| `src/client.mjs` | 客户端半身：叠层、持久化、设置行组件（手写，只 `require('react')`） |
| `src/row.css` | 设置行样式，全部使用应用自身 token，跟随当前主题 |
| `tools/build.mjs` | 生成 `lib/client.js` 与 `lib/palettes.json` |
| `tools/verify.mjs` | 契约与行为校验（见下） |
| `lib/index.js` | 宿主半身：空 `apply()`，只用于让 loader 行存在（客户端 bundle 靠它被发现） |

`verify.mjs` 会实际把 bundle 放进一个假的 ModuleLoader + 假 React 里跑一遍，断言：
只注册一个 `settings.general.item`（id `eye-themes`，order 11.5，不覆盖内置行）、
选配色时只压一层且 token 齐全、换配色是替换而不是叠加、「默认」会释放这一层、
卸载时释放、刷新后能按存储恢复、行内渲染出 5 个色卡 + 默认。

## 已知取舍

- 选择存在**本机浏览器**（`localStorage`），不走 Host 设置文档，所以不同浏览器/设备各记各的。
  这是刻意的：内置 `ui-theme` 的 `preference` 字段只接受 `light/dark/system`，
  第三方主题 id 无法写进去，而 `overrideTokens` 图层本来就不需要持久化在 Host 侧。
- 选中的配色会**同时作用于日间和夜间**（同一色系的深浅两版），
  所以切换系统的深色模式时看到的是这套配色的夜间版本，而不是回到原生黑白。
- 没有自定义调色、没有字体/圆角/动效开关 —— 刻意留白。要更多花样请用壁纸类插件，别塞进这里。
