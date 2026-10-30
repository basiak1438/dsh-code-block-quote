# dsh-code-block-quote

<div align="center">
  <b style="font-size: 1.15em;">DSH 全场景智能引用套件：代码块一键引用 · 全局划词悬浮工具条 · 侧边对话直通 · 气泡折叠卡片 · 跨会话永久定位</b><br /><br />
  <a href="https://github.com/basiak1438/dsh-code-block-quote"><img alt="Version" src="https://img.shields.io/badge/version-0.2.1-blue.svg" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img alt="DSH >=0.2.0-rc.2" src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4d6bfe" /></a>
  <img alt="Zero Dependencies" src="https://img.shields.io/badge/dependencies-0-success" />
  <img alt="Built with DSH Vibe Coding" src="https://img.shields.io/badge/Built_with-DSH_Vibe_Coding-8b5cf6" />
</div>

> 在 DeepSeek Harness (DSH) 中，无论是**一键引用整段代码块**，还是在回答正文里**划选任意文本片段**，都可以将其作为引用胶囊（Reference Chip）快速插入主对话或右侧栏的独立侧边对话。
> 发送后的消息气泡会自动将引文（含代码引用与普通文本引用）渲染为带 **「📍 定位」** 与 **「展开 ▼ / 收起 ▲」** 的可折叠卡片，过滤内部坐标冗余信息，并在页面刷新或客户端重启后依然支持平滑定位回原文。
>
> 💡 **项目说明**：本插件由 **DeepSeek Harness (DSH)** 全程通过 **Vibe Coding**（自然语言交互式结对开发、自动化测试与真机视觉验收）构建完成。

---

## ✨ 快速概览

1. **代码块右上角「引用」**：位于代码块横幅原生「复制」按钮旁，点击即可将整段代码连同语言标签作为引用胶囊插入输入框。
2. **全局划词悬浮工具条**：在对话正文或代码块内划选任意文字，选区上方自动弹出圆角工具条 **`[ 💬 添加到对话 ]`** 与 **`[ 📑 侧边对话 ]`**。
3. **主对话与侧边对话双通道**：
   - **「💬 添加到对话」**：将引用插入当前主会话输入框上方并自动聚焦，方便继续输入提问内容；
   - **「📑 侧边对话」**：自动打开右侧栏（`dsh-better-sidebar`）的「侧边对话」页签，将引用写入侧栏输入框并聚焦，便于针对局部细节独立追问，保持主会话上下文整洁（仅写入草稿，不自动发送）。
4. **发送后统一折叠为卡片**：无论是文本引用还是整块代码，发送后在用户消息气泡中均会转换为结构化卡片（标头显示如 `❝ bash · 5 行 · 第 16 轮` 或 `❝ 文本引用 · 2 行 · 第 34 轮`），超过 3 行自动收起，下方清晰展示提问正文。
5. **跨刷新永久定位**：采用「轻量轮次标记（`> ※ 第 N 轮`）+ 文本/代码特征指纹」两步定位机制，去除冗长的 `│q1:eyJ...` base64 编码字符串，刷新或重开应用后仍可一键平滑滚动至原文位置并触发高亮提示。

---

## 🧩 功能列表

| 功能模块 | 触发方式 | 行为说明 |
| --- | --- | --- |
| **代码块一键引用** | 点击代码块横幅右上角 **`引用`** | 提取代码块纯文本与语言标签（`python`、`bash`、`ts` 等），以原生引用胶囊插入主输入框；若输入框已有草稿，引用会置于草稿上方。插入成功后按钮短暂显示「已引用」。 |
| **全局划词悬浮工具条** | 在回答正文或代码块内**鼠标划选文字** | 选区上方弹出胶囊工具条 **`[ 💬 添加到对话 ] [ 📑 侧边对话 ]`**。自动识别选区位于普通段落还是代码块内，并处理与其他选区插件的浮层重叠问题。 |
| **侧边对话联动** | 点击悬浮工具条的 **`📑 侧边对话`** | 展开右侧栏并激活 `sidechat` 页签（若当前会话尚无侧聊线程则自动触发创建），将引用写入侧边栏输入框并聚焦。未安装侧边栏扩展时自动复制引用到剪贴板并给出提示。 |
| **气泡统一卡片化与折叠** | 消息发送后自动生效 | 扫描用户消息气泡中的原生文本与引用节点，将**文本划选引用**与**代码块整体引用**统一渲染为卡片。超过 **3 行**（或 140 字符）默认折叠至 `76px` 高度，提供渐变遮罩与 **`展开 ▼ / 收起 ▲`** 切换按钮。 |
| **内部元数据清理** | 消息发送后自动生效 | 自动剥离消息中可能携带的 `※ 引自第 N 轮 │q1:eyJ...` 内部 base64 坐标字符串及多余提示词包裹，保持气泡内容整洁。 |
| **原文定位与高亮** | 点击卡片右上角 **`📍 定位`** | **第一步（按轮次）**：根据 `第 N 轮` 锁定对应回合的消息节点；**第二步（按指纹）**：根据引用首行特征匹配具体代码块或正文段落。平滑滚动至视口中央，并触发 1.8 秒蓝色呼吸光晕（Flash Highlight）。 |

---

## 📐 引用格式说明（Markdown 线格式）

插件生成的引用采用标准 Markdown 块引用语法，兼顾人类阅读体验与大语言模型解析准确性：

### 1. 代码引用（代码块一键引用 / 代码块内划选）
```markdown
> ❝ ``` python
> def greet(name):
>     return f"Hello, {name}!"
> ```
> ※ 第 16 轮
```
- 围栏语言标签自动读取自代码块横幅；若代码内容本身包含 ```` ``` ````，会自动切换为 `~~~` 围栏以避免提前闭合。

### 2. 文本引用（普通正文段落划选）
```markdown
> ❝ 这里是从回答正文里划选的一段关键论述，
> 跨越多行时依然保持干净的自然块引用。
> ※ 第 34 轮
```
- 普通文本划选不添加多余的代码围栏，发送后在气泡卡片内采用正文排版字体，代码引用则采用等宽字体。
- 行首若以 `\`、`❞`、`※` 开头会自动进行转义，兼容 `dsh-client-ui-quote` 的往返解析规范。

---

## 🚀 安装与更新

环境要求：DSH `>= 0.2.0-rc.2`（支持桌面端 `desktop` 或网页端 `web` profile）。

### 方式一：通过 GitHub 仓库安装（推荐）

在终端执行以下命令（请将 `desktop` 替换为你实际使用的 profile 名称，例如 `web`）：

```bash
dsh plugin --profile desktop add https://github.com/basiak1438/dsh-code-block-quote
```

或在 DSH 桌面端界面操作：**设置 → 插件 → 添加插件**，输入仓库地址：
`https://github.com/basiak1438/dsh-code-block-quote`

### 方式二：通过 DSH 会话自动安装

将以下提示词发送给任意 DSH 会话即可由智能体代为安装：

```text
帮我安装 dsh-code-block-quote 插件：
1. 执行 dsh plugin --profile desktop add https://github.com/basiak1438/dsh-code-block-quote
2. 安装完成后提醒我重启或刷新客户端
```

### 方式三：从本地源码或 `.tgz` 离线包安装

```bash
# 从离线单文件包安装
dsh plugin --profile desktop add /path/to/dsh-code-block-quote-0.2.1.tgz

# 或从本地克隆的源码目录软链安装（适用于本地开发调试）
git clone https://github.com/basiak1438/dsh-code-block-quote.git
dsh plugin --profile desktop add link:/path/to/dsh-code-block-quote
```

> **提示**：安装或更新完成后，请**重启 DSH 桌面端**（Web 端请重启 `dsh web` 并使用 `Ctrl+Shift+R` 刷新浏览器），以加载最新的客户端脚本。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-code-block-quote
```

---

## 🤝 插件兼容性

- **独立运行**：零外部运行时依赖，无需前置安装 `dsh-client-ui-quote` 或 `@michengai/dsh-btw` 即可使用全部核心功能。
- **多插件共存**：当环境中同时安装了 `dsh-client-ui-quote` 或 `@michengai/dsh-btw` 时，会自动协调选区工具条显示并清理气泡中的裸露坐标文本。
- **侧边栏集成**：当环境中安装了 `dsh-better-sidebar` 时，「📑 侧边对话」按钮会自动调用 `betterSidebar` 服务打开右侧栏对话页签；未安装时则降级为复制到剪贴板并提示用户。

---

## 🔒 架构与安全说明

- **纯客户端实现**：宿主侧入口 [`lib/index.js`](./lib/index.js) 为空实现，不注册服务端路由、不读写本地文件系统、不发起外部网络请求。
- **轻量无构建**：采用原生 JavaScript 编写（[`lib/client.js`](./lib/client.js)），无需打包编译，无第三方 npm 依赖，打包体积约 16 KB。
- **仅修改输入草稿**：所有引用操作仅将内容写入主输入框或侧边对话输入框并聚焦光标，由用户确认后手动发送。

---

## 🛠️ 本地开发与测试

仓库包含离线 DOM 测试脚本、跨插件格式兼容校验脚本以及本地可视化预览服务：

```bash
# 运行全部离线测试（客户端 DOM/折叠/选区/定位测试 + 跨插件格式往返校验）
npm run check

# 单独运行客户端单元测试
npm run check:client

# 启动本地可视化预览服务（在浏览器中打开终端输出的 URL 即可交互体验）
npm run test:live
```

---

## 📄 开源许可

[MIT](./package.json) · Built with **DeepSeek Harness (DSH)** Vibe Coding
