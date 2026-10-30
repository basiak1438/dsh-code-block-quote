# dsh-code-block-quote

<div align="center">
  <b style="font-size: 1.15em;">DSH 全场景智能引用套件：代码块一键引用 · 全局划词悬浮药丸 · 侧边对话直通 · 气泡折叠卡片 · 跨会话永久定位</b><br /><br />
  <a href="https://github.com/basiak1438/dsh-code-block-quote"><img alt="Version" src="https://img.shields.io/badge/version-0.2.1-blue.svg" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img alt="DSH >=0.2.0-rc.2" src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4d6bfe" /></a>
  <img alt="Zero Dependencies" src="https://img.shields.io/badge/dependencies-0-success" />
</div>

> 在 DeepSeek Harness (DSH) 里，无论你是想**一键引用整段代码块**，还是在回答正文里**随手划选一句话**，都能以最干净的引用胶囊（Reference Chip）送入主对话或右侧栏独立侧边对话。
> 发送后的用户气泡不再被大段 `>` 源码或内部 base64 坐标乱码撑爆——无论是代码引用还是文本引用，统统自动收纳为带 **「📍 定位」** 与 **「展开 ▼ / 收起 ▲」** 的精致折叠卡片，哪怕关闭重开客户端依然能一键平滑跳回原文并呼吸光晕高亮。

---

## ✨ 30 秒速览

1. **代码块右上角「引用」**：紧挨着原生「复制」按钮，点一下就把整段代码按带语言标签的围栏作为引用胶囊放进输入框。
2. **全局划选悬浮药丸**：在对话正文或代码块里划选任意文字，选区上方浮出磨砂圆角药丸 **`[ 💬 添加到对话 ]`** 与 **`[ 📑 侧边对话 ]`**。
3. **主对话 & 侧边对话双通道**：
   - 点 **「💬 添加到对话」**：以原生引用胶囊插入当前主会话输入框上方，光标自动聚焦，接着写提问即可；
   - 点 **「📑 侧边对话」**：自动唤起右侧栏（`dsh-better-sidebar`）的「侧边对话」页签，把引用直接写入侧栏输入框并聚焦，独立追问不污染主线上下文（只写草稿、绝不代发）。
4. **发送后统一折叠为卡片**：无论是文本引用还是整块代码，发送后在你的消息气泡里都会自动变成结构化卡片（标头显示 `❝ bash · 5 行 · 第 16 轮` 或 `❝ 文本引用 · 2 行 · 第 34 轮`），超过 3 行自动折叠，下方干干净净展示你的提问正文。
5. **重开页面依然能「📍 定位」**：采用「轻量轮次标记（`> ※ 第 N 轮`）+ 文本/代码特征指纹」两步定位引擎，彻底告别丑陋的 `│q1:eyJ...` base64 坐标乱码，刷新或重开应用依然能一键平滑滚动回原文并触发 1.8 秒呼吸高亮。

---

## 🧩 核心功能一览

| 功能模块 | 触发方式 | 交互细节与效果 |
| --- | --- | --- |
| **代码块一键引用** | 点击代码块横幅右上角 **`引用`** | 自动提取代码块纯文本与语言标签（`python`、`bash`、`ts` 等），以原生引用胶囊插入主输入框；草稿已有内容时，引用落在草稿上方、不打断输入。插入成功后按钮短暂变为「已引用」。 |
| **全局划词悬浮药丸** | 在回答正文或代码块内**鼠标划选文字** | 选区正上方弹出深色磨砂胶囊工具条 **`[ 💬 添加到对话 ] [ 📑 侧边对话 ]`**。自动识别选区位于普通段落还是代码块内，并拦截其他插件的浮层冲突。 |
| **侧边对话直通车** | 点击悬浮药丸的 **`📑 侧边对话`** | 自动展开右侧栏并激活 `sidechat` 页签（若尚未创建侧聊线程则自动触发创建），将引用写入侧边栏输入框并聚焦。未安装侧边栏扩展时自动复制引用到剪贴板并友好提示。 |
| **气泡统一卡片化与折叠** | 消息发送后自动生效 | 自动扫描 DSH 原生气泡文本与第三方引用节点：不论是**文本划选引用**还是**代码块整体引用**，统一渲染为卡片。超过 **3 行**（或 140 字符）默认折叠至 `76px` 高度，配底部渐变遮罩与 **`展开 ▼ / 收起 ▲`** 按钮。 |
| **坐标乱码净化** | 消息发送后自动生效 | 自动剥离历史消息中残留的 `※ 引自第 N 轮 │q1:eyJ...` 内部 base64 乱码与冗长提示词包裹，恢复清爽排版。 |
| **跨刷新永久定位** | 点击卡片右上角 **`📍 定位`** | **第一步（粗排）**：按 `第 N 轮` 锁定对应回合的所有消息流节点；**第二步（精排）**：按引用首行指纹精准匹配具体代码块或正文段落。平滑滚动至视口中央，并伴随 1.8 秒蓝色呼吸光晕（Flash Highlight）。 |

---

## 📐 引用线格式（Prompt 形态）

本插件坚持**人类与模型双友好**的极简线格式，绝不向模型上下文塞入任何 base64 机器编码：

### 1. 代码引用（代码块一键引用 / 代码块内划选）
```markdown
> ❝ ``` python
> def greet(name):
>     return f"Hello, {name}!"
> ```
> ※ 第 16 轮
```
- 围栏语言自动取自代码块顶部标签；若代码本身包含 ```` ``` ````，自动切换为 `~~~` 围栏防止提前闭合。

### 2. 文本引用（普通正文段落划选）
```markdown
> ❝ 这里是从回答正文里划选的一段关键论述，
> 跨越多行时依然保持干净的自然块引用。
> ※ 第 34 轮
```
- 普通文本划选**不套多余的空代码围栏**，发送后在气泡卡片内使用舒适的正文排版字体，代码块引用则使用等宽代码字体。
- 行首若以 `\`、`❞`、`※` 开头会自动转义，完全兼容 `dsh-client-ui-quote` 的往返解析规范。

---

## 🚀 安装与更新

要求：DSH `>= 0.2.0-rc.2`（桌面端 `desktop` 或网页端 `web` profile）。

### 方式一：通过 GitHub 仓库直接安装（推荐）

打开终端执行一行命令（将 `desktop` 替换为你实际使用的 profile 名称，如 `web`）：

```bash
dsh plugin --profile desktop add https://github.com/basiak1438/dsh-code-block-quote
```

或者在 DSH 桌面端内：**设置 → 插件 → 添加插件**，填入仓库地址：
`https://github.com/basiak1438/dsh-code-block-quote`

### 方式二：让 DSH 智能体帮你安装

把下面这段话直接发给任意一个 DSH 会话：

```text
帮我安装 dsh-code-block-quote 插件：
1. 执行 dsh plugin --profile desktop add https://github.com/basiak1438/dsh-code-block-quote
2. 安装完成后提醒我重启或刷新客户端
```

### 方式三：从本地源码或 `.tgz` 离线包安装

```bash
# 从离线单文件包安装
dsh plugin --profile desktop add /path/to/dsh-code-block-quote-0.2.1.tgz

# 或从本地克隆的源码目录软链安装（方便开发调试）
git clone https://github.com/basiak1438/dsh-code-block-quote.git
dsh plugin --profile desktop add link:/path/to/dsh-code-block-quote
```

> **提示**：安装或更新完成后，请**重启 DSH 桌面端**（Web 端请重启 `dsh web` 并硬刷新浏览器 `Ctrl+Shift+R`），客户端插件即可生效。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-code-block-quote
```

---

## 🤝 与其他插件的兼容性

- **独立运行**：本插件零外部依赖，**不需要**前置安装 `dsh-client-ui-quote` 或 `@michengai/dsh-btw` 即可完整使用代码块引用、划词药丸、气泡折叠卡片与定位跳转。
- **共存友好**：当环境中同时安装了 `dsh-client-ui-quote` 或 `@michengai/dsh-btw` 时，本插件会自动接管选区工具条并净化气泡中的裸露坐标乱码，避免多个悬浮层打架。
- **侧边栏联动**：当环境中安装了 `dsh-better-sidebar` 时，「📑 侧边对话」按钮会自动与其 `betterSidebar` 服务联动打开右侧栏对话页签；未安装时则安全降级为剪贴板复制提示。

---

## 🔒 信任边界与轻量化设计

- **纯客户端运行**：宿主侧入口 [`lib/index.js`](./lib/index.js) 是空 `apply`，不注册后台路由、不读写本地文件、不发起任何外部网络请求。
- **零构建依赖**：纯原生 JavaScript 编写（[`lib/client.js`](./lib/client.js)），无打包器、无运行时第三方 npm 依赖，整包体积仅 ~16 KB。
- **只写草稿、绝不代发**：无论是主输入框还是侧边对话输入框，所有引用动作只负责将内容放入草稿并聚焦光标，发送权始终在你手里。

---

## 🛠️ 本地开发与自检

本仓库内置了完整的离线假 DOM 测试套件、跨插件往返兼容校验以及本地可视化预览服务：

```bash
# 运行全部离线检查（29 项客户端 DOM/折叠/选区/定位断言 + 13 项跨插件线格式往返测试）
npm run check

# 单独运行客户端功能与假 DOM 测试
npm run check:client

# 启动本地可视化预览服务（浏览器打开打印出的 URL 即可交互体验）
npm run test:live
```

---

## 📄 开源许可

[MIT](./package.json)
