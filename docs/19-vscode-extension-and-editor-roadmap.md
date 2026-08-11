# Evir VS Code 扩展与编辑器路线

> 本文的扩展 UI 名称固定为 **Evir**，Manifest ID 与展示名解耦。Desktop/CLI 的 Provider 共享不改变 VS Code 扩展的独立 SecretStorage 边界。

## 1. 产品定位

Evir for VS Code 是可独立安装的 BYOM 编辑器 Agent。它不要求账号、Evir 云端后端或 Evir Desktop 常驻进程。用户配置一个模型即可使用 Ask；配置支持 Tool Calling 的模型后，可在受信任的本地工作区使用 Agent。

首版产物：

```text
extensions/vscode/artifacts/evir.vsix
```

### 1.1 用户、场景与成功标准

- 目标用户：已在 VS Code 中工作的开发者，希望使用自己的模型完成代码解释、检查和受控修改。
- 核心任务：不离开编辑器完成“配置模型 → Ask → 信任工作区 → Agent → 审批 → 验证 → Diff/回滚”。
- 非目标：替代完整 Evir Desktop、接管编辑器所有代码补全、后台索引整个工作区或静默上传代码。
- 首次成功：安装后 5 分钟内完成 Provider 配置和一次流式 Ask；有 Tool Calling 的用户在 3 个显式决策内启动首个 Agent 任务。
- 安全成功：任何工作区外访问、未信任工作区写入、非本地 Workspace Agent 或无审批写入均被代码阻止。
- 质量成功：停止后 1 秒内进入 stopped 状态；所有完成声明都能关联验证或明确“未验证”。

## 2. 架构边界

```text
Evir Provider / Streaming Core
        ↓
VS Code Extension Host
        ↓
SecretStorage / workspace.fs / Workspace Trust / child_process
        ↓
Evir Webview UI
```

- 扩展复用 `src/core/providers` 中不依赖 React、Dexie 和 Tauri 的 Provider Adapter。
- VS Code UI 不直接访问 Provider、文件系统或进程；消息先由 Zod 校验，再进入 Extension Host。
- Ask 不注册工作区工具。
- Agent 只在 Tool Calling 模型、受信任工作区和本地 `file` Workspace 同时满足时启用。
- 工作区路径经过规范化、真实路径和符号链接边界检查。
- 写入和命令执行逐次审批；命令采用程序与参数数组，不启用 Shell 插值。
- API Key 只写入 VS Code SecretStorage；配置与会话使用 VS Code 本地 Extension Storage。

CLI 是另一独立入口：它与 Desktop 共享非敏感 Provider Profile 和系统凭据，但不要求 Desktop 安装或运行。VS Code 扩展首版不加入该共享域，以避免编辑器 SecretStorage、Remote/WSL 和本机凭据语义混淆。

## 3. 当前功能

- OpenAI Chat Completions / compatible Chat。
- OpenAI Responses。
- Anthropic Messages。
- Gemini GenerateContent。
- Ollama。
- Provider 连接测试、流式 Ask、停止、本地会话。
- `read_file`、`list_directory`、`search_files`、`write_file`。
- `git_status`、`git_diff`、`run_command`。
- 写入/执行审批、10 步上限、相同工具调用循环检测。
- 最后一次文件写入的 VS Code Diff 与冲突感知回滚。
- 配置与主操作已有中英文文案，支持 VS Code Light/Dark 主题、窄侧栏布局和键盘焦点；角色/ARIA 文案仍有本地化缺口。

### 3.1 用户主流程

```text
安装并打开 Evir
→ 配置 Provider/模型/密钥
→ 测试连接并保存
→ Ask 流式回答
→ 信任本地 Workspace
→ 选择 Agent 并确认数据去向
→ 查看步骤/工具 → 审批写入或命令
→ 查看验证、Diff、遗留问题
→ 接受或回滚最后一次写入
```

取消路径：配置未保存时可取消回到已有配置；生成中 Stop 保留部分内容；审批拒绝只拒绝当前调用；关闭视图或新建会话会终止活动请求，不自动重放工具。

### 3.2 状态矩阵

| 状态                        | 用户看到什么                    | 可执行下一步               | 当前证据                     |
| --------------------------- | ------------------------------- | -------------------------- | ---------------------------- |
| 未配置                      | 自动打开 Provider 对话框        | 填写、测试、保存           | 已实现                       |
| 测试中/成功/失败            | 状态文本                        | 等待、保存或修正           | 已实现；失败分类较粗         |
| Ask 空态                    | 两个真实示例和输入框            | 选择示例或输入             | 已实现                       |
| Streaming                   | 部分回答与 Stop                 | 停止                       | 已实现                       |
| Stopped/Error               | 保留部分回答与状态              | 修改后重试                 | 已实现基础状态               |
| 无 Workspace/未信任/Remote  | Agent 禁用和具体原因            | 打开、信任或改用本地工作区 | 已实现                       |
| Tool pending/running/result | 当前步骤、工具与结果摘要        | 等待、展开或停止           | **当前 Webview 未完整实现**  |
| Approval                    | 工具、影响、拒绝/本次允许       | 默认拒绝或允许一次         | 已实现；拒绝首焦点已验证     |
| Verification                | 检查命令与结果                  | 修复、重试或接受           | **当前 Webview 未完整实现**  |
| Completed                   | 变更、验证、遗留问题、Diff/回滚 | 打开 Diff 或回滚           | 命令存在；摘要未完整实现     |
| Rollback conflict           | 文件已变化的冲突说明            | 打开 Diff 或取消           | ChangeTracker 已实现冲突保护 |

## 4. 明确非目标

首版不包括：

- Evir Desktop 进程依赖或自动启动。
- VS Code Web、Remote SSH、Dev Container 和 WSL 工作区。
- Inline Completion 和自动改写当前编辑器内容。
- MCP、Skill、浏览器自动化和 Computer Use。
- Desktop/Web 会话、Provider 或密钥同步。
- Marketplace 自动发布和自动遥测。

## 5. 打包与验证

```bash
pnpm --dir extensions/vscode check
pnpm --dir extensions/vscode test:host
pnpm package:vscode
```

质量证据包括：

- 单元测试：输入 Schema、SecretStorage 分层、会话上限、流式 SSE、审批拒绝、验证证据和路径边界。
- 真实 Extension Host：下载并启动官方 VS Code，激活扩展、检查命令并打开视图。
- Electron UI：在临时 Profile 中检查配置、空态、Agent 数据去向提示、审批、Light/Dark、窄侧栏和键盘焦点。
- VSIX 内容：只能包含 Manifest、说明、许可证声明、图标和生产 Bundle。

公开发布前仍需：选择项目许可证、确定 Publisher、准备 Marketplace 图标/截图/隐私说明，并在 Marketplace 和 Open VSX 分别完成安装升级验收。

### 5.1 UI 与无障碍验收

- 使用 VS Code `--vscode-*` 语义颜色，覆盖 Light、Dark、High Contrast。
- 覆盖 240px、320px、600px 侧栏宽度；设置按钮组允许换行但主次不变。
- 模式使用 `aria-pressed`，滚动会话区有名称，配置对话框有首焦点/Escape/焦点恢复，审批首焦点为拒绝。
- 所有角色、状态、错误和 ARIA 文案进入中英文资源；不得出现硬编码 `You`、`Tool`、`Mode` 或 `Conversation`。
- Agent Activity 的当前步骤优先于历史文本；审批始终位于可见区域，不能被长消息推离视口。
- 真实视觉基线覆盖配置、空态、Agent 数据披露、审批、流式、停止、错误、验证和完成摘要。

### 5.2 数据与删除

- SecretStorage 保存 API Key；globalState/workspaceState 保存非敏感配置、会话和最后写入元数据。
- New Conversation 删除当前本地会话但不删除 Provider；修改 Provider 留空密钥时保留已有 Secret。
- 卸载后的数据保留遵循 VS Code 扩展存储行为；公开发布前必须在隐私说明中解释清理方法。
- Evir 不读取 Desktop/CLI Provider 文件，也不上传遥测。

## 6. 其他常用编辑器

| 编辑器            | 复用方式                             | 优先级 | 当前判断                                         |
| ----------------- | ------------------------------------ | ------ | ------------------------------------------------ |
| VSCodium          | 安装同一 VSIX / Open VSX             | P0     | 兼容概率高，需真实安装验收                       |
| Cursor / Windsurf | 安装同一 VSIX                        | P0     | 兼容概率高，需核对 API 版本和内置 AI UI 冲突     |
| JetBrains IDE     | Kotlin UI + 独立 Runtime Adapter     | P1     | 用户覆盖广，但不能直接运行 VS Code Extension API |
| Zed               | Zed Extension API + 受限工具 Adapter | P2     | API 能力需先验证，不能承诺完整 Agent             |
| Neovim            | Lua UI + 本地 Evir Core RPC          | P2     | 可实现，但需要稳定的语言无关 Core 协议           |

下一步先验证同一 VSIX 在 VSCodium、Cursor 和 Windsurf 中的安装与基础 Ask。JetBrains 开发前应先把 Agent Core 暴露为版本化、可取消、可审计的本地 RPC 协议；Sidecar 必须按需启动，不能成为后台常驻服务。

## 7. 产品验收与当前缺口

发布判定必须逐项满足：

- [x] 独立激活、配置、SecretStorage、Ask 流式、停止和会话保存。
- [x] Workspace Trust、本地 Workspace、路径/符号链接边界和逐次审批。
- [x] 最后一次写入 Diff/冲突感知回滚。
- [x] Dark/Light、窄侧栏、键盘发送和审批安全首焦点的自动化证据。
- [ ] Agent step/tool/result/verification/completion 统一事件与 Webview Activity。
- [ ] Tool Calling 能力来源区分“用户声明/实际验证”，保存前不产生确定性误导。
- [ ] 中英文角色、状态、错误与全部 ARIA 文案，无硬编码英语。
- [ ] High Contrast、屏幕阅读器、停止/失败恢复和长输出真实验收。
- [ ] Marketplace/Open VSX 的许可证、Publisher、隐私、素材和安装升级验收。
- [ ] VSCodium/Cursor/Windsurf 至少完成安装和 Ask；未验证前只描述为“可能兼容”。

产品与 UI 专项评审见 `docs/reviews/vscode-cli-product-ui-review.md`。
