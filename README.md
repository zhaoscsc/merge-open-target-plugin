# Merge And Open Target

> 专为 Obsidian 打造的高效笔记合并与流转工具：将整篇笔记或选区内容一键并入目标笔记，并在合并完成后**立即自动打开目标笔记**，让思考与写作保持连贯。

[English Brief](#english-brief) · [安装指引](#安装指引) · [配置说明](#配置说明) · [GitHub 仓库](https://github.com/zhaoscsc/merge-open-target-plugin)

---

## 为什么需要它？

Obsidian 自带的 Note Composer（笔记合并器）功能很实用，但在高频深度使用的卡片笔记、日记提炼与知识流转场景中，常常存在以下痛点：

1. **思维被中断**：合并 A 笔记到 B 笔记后，Obsidian 仍停留在原处（甚至变成空白），必须手动重新搜索并打开 B 笔记才能继续写作。
2. **颗粒度受限**：只想把当前正在阅读或记录的一段话并入主题笔记，不想移动整篇内容。
3. **元数据污染**：整篇合并时，源笔记的 YAML Frontmatter（创建时间、标签等）常被一并贴入目标笔记，破坏了目标笔记的属性结构。
4. **全库检索繁琐**：在数万篇笔记的大库中，跨主题归纳时往往一时想不起确切的文件名，只能依赖模糊记忆反复搜索。

**Merge And Open Target** 就是为了解决上述所有断点而生。

---

## 核心功能全景

### 1. 自动直达目标笔记
无论合并整篇笔记还是合并选中文字，合并动作完成后，焦点无缝切换至目标笔记，光标定位到最新合并的内容位置，思维不掉线。

### 2. 双模式智能合并
- **整篇合并（Whole Note Merge）**：
    - 自动剥离源笔记的 YAML Frontmatter，仅保留纯正文并入目标文件。
    - 支持配置合并后自动将源文件移入废纸篓（遵循 Obsidian 或系统回收站设置）。
    - 支持智能重定向双链：可选自动将全库中指向源笔记的双链与嵌入链接更新为指向目标笔记。
- **选区合并（Selection Merge）**：
    - 选中文本执行合并，内容自动剪切移动至目标笔记，原笔记选区内容被移除。

### 3. 多维度智能候选排序
唤起模态框时，无需键盘输入即可在第一屏看到最可能的候选目标：
- 🏷️ **`同名` 优先**：如果目标笔记与源笔记存在同名，置顶推荐。
- 🏷️ **`相似` 优先**：基于名称包含关系的相似笔记智能置顶。
- 🏷️ **`最近` 优先**：最近打开或编辑过的笔记优先排在前面，便于当前工作流的就近归纳。
- 🔍 **别名（Aliases）全检索**：支持按 YAML 中的 `aliases` 别名快速搜索候选。

### 4. TypeSafe AI (Jev) 智能语义推荐（可选）
内置新一代 TypeSafe AI 的 Jev (System One) 快速直觉模型：
- **语义级归纳**：即使标题字面上毫无关联（例如源笔记是《纳瓦尔访谈》，目标笔记是《商业杠杆与自由》），AI 亦能精准推断归属。
- **零阻塞极速体验**：模态框 0ms 本地秒开，后台异步请求 Jev 进行决策，完全不影响手动输入搜索。
- **BM25 本地初筛**：从当前内容中实时提取核心关键词，通过 BM25 算法在全库所有笔记标题与别名中初筛候选，确保大库（30,000+ 篇）下也能精准命中冷门深层笔记。
- **置信度百分比徽章**：决策成功后自动在候选首项展示 `AI推荐 95%` 徽章；低于置信度阈值时不打扰。

### 5. 原生安全保护
- **原生确认弹窗**：可选开启“合并前二次确认”，采用 Obsidian 原生 Modal 架构，跨端与移动端一致体验，防止误触。
- **合并位置灵活配置**：支持追加到末尾（Append）或插入到开头（Prepend）。
- **自定义分隔符**：可自定义两篇笔记合并时的拼接间隙（默认双换行）。

---

## 快速上手与命令

### 核心命令
打开 Obsidian 命令面板（`Ctrl/Cmd + P`），搜索并执行：
- `Merge And Open Target: Merge current file into another note and open target`
  合并当前整篇笔记并打开目标笔记。
- `Merge And Open Target: Merge selected text into another note and open target`
  将选中的文本合并到目标笔记并打开。

> 💡 **建议**：在 `设置 -> 快捷键` 中为上述两项命令分别绑定快捷键（例如 `Alt + M` 与 `Alt + Shift + M`），体验飞一般的归纳流。

---

## 配置说明

在 Obsidian 设置界面的 **Merge And Open Target** 选项卡中，可按需定制以下行为：

| 设置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| **合并位置** | 追加到末尾 | 可选 `追加到末尾` 或 `插入到开头`。 |
| **分隔符** | `\n\n` | 合并两段内容之间插入的间隔符号，支持 `\n`、`\t` 等转义字符。 |
| **合并后移入废纸篓** | 开启 | 整篇合并后自动把源笔记移入废纸篓。 |
| **整篇合并后同步更新双链** | 开启 | 自动重定向全库指向源笔记的 `[[...]]` 与 `![[...]]` 链接。 |
| **合并前确认** | 关闭 | 开启后每次执行合并均会弹出确认弹窗。 |
| **启用 Jev 语义推荐** | 关闭 | 是否启用 TypeSafe AI 智能语义目标推荐。 |
| **TypeSafe API Key** | 空 | 前往 [TypeSafe Console](https://console.typesafe.ai/) 获取的 API 密钥。 |
| **最低置信度阈值** | `0.6` | 只有当 AI 决策置信度高于该值时才进行自动置顶推荐。 |

---

## 隐私与网络安全说明

本插件严格遵守 Obsidian 社区插件安全准则：

- **完全离线优先**：AI 语义推荐功能默认**处于关闭状态**。在未开启该功能时，插件 100% 本地离线运行，不产生任何网络请求。
- **数据传输极小化**：仅在用户**主动开启 Jev 推荐**且**配置了有效 API Key** 时，插件才会向 `https://api.typesafe.ai/v1/systemone` 发起单次安全 HTTPS 请求。
- **请求内容透明**：发送的数据仅包含当前笔记标题、正文前 600 字符摘要，以及本地 BM25 算法初筛出的最多 30 个候选笔记标题与路径。
- **无数据留存**：该接口专用于瞬时分类推断，插件不会将任何库内数据用于持久化存储或模型训练。

---

## 安装指引

### 方式一：Obsidian 官方社区市场安装（推荐）
1. 打开 Obsidian `设置 -> 社区插件 -> 浏览`。
2. 搜索 `Merge And Open Target`。
3. 点击 `安装` 并启用。

### 方式二：使用 BRAT 插件安装测试版
1. 确保已安装 [BRAT 插件](https://github.com/TfTHacker/obsidian42-brat)。
2. 在 BRAT 设置中点击 `Add Beta plugin`。
3. 填入仓库地址：
   ```text
   https://github.com/zhaoscsc/merge-open-target-plugin
   ```
4. 点击确认安装，安装完成后在社区插件列表中启用。

### 方式三：手动安装
1. 从 [Releases 页面](https://github.com/zhaoscsc/merge-open-target-plugin/releases/latest) 下载最新发布的三个核心文件：
    - `main.js`
    - `manifest.json`
    - `styles.css`
2. 进入你的 Obsidian 库目录：`.obsidian/plugins/`，新建名为 `merge-open-target` 的文件夹。
3. 将下载的文件放入该文件夹中，在 Obsidian 插件面板中点击重新加载并启用。

---

## English Brief

**Merge And Open Target** is an Obsidian plugin designed to merge the current note or selected text into a destination note and immediately open the target note.

### Key Highlights
- **Immediate Navigation**: Opens and focuses on the destination note immediately after merge.
- **Two Merge Modes**: Whole-note merge (auto-strips source YAML frontmatter) & selection-only merge.
- **Backlink Updating**: Optionally redirects all wikilinks and embeds pointing to the source note to the target.
- **Multi-criteria Sorting**: Instant prioritization by exact title match (`同名`), containment similarity (`相似`), and recent activity (`最近`).
- **Optional TypeSafe AI (Jev)**: Asynchronous background semantic destination prediction with confidence badges.
- **Strict Privacy**: Fully offline by default. External requests to `https://api.typesafe.ai/v1/systemone` occur only when explicitly enabled by the user with a valid API key.

---

## 开源协议

本项目基于 [MIT 协议](LICENSE) 开源。
