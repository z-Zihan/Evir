# Evir VS Code 扩展与编辑器路线

> 本文的扩展 UI 名称固定为 **Evir**，Manifest ID 与展示名解耦。Desktop/CLI 的 Provider 共享不改变 VS Code 扩展的独立 SecretStorage 边界。

## 1. 产品定位

Evir for VS Code 是可独立安装的 BYOM 编辑器 Agent。它不要求账号、Evir 云端后端或 Evir Desktop 常驻进程。用户配置一个模型即可使用 Ask；配置支持 Tool Calling 的模型后，可在受信任的本地工作区使用 Agent。

首版产物：

```text
extensions/vscode/artifacts/evir.vsix
```

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
- 中英文 UI、VS Code Light/Dark 主题、窄侧栏布局和键盘焦点。

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

## 6. 其他常用编辑器

| 编辑器            | 复用方式                             | 优先级 | 当前判断                                         |
| ----------------- | ------------------------------------ | ------ | ------------------------------------------------ |
| VSCodium          | 安装同一 VSIX / Open VSX             | P0     | 兼容概率高，需真实安装验收                       |
| Cursor / Windsurf | 安装同一 VSIX                        | P0     | 兼容概率高，需核对 API 版本和内置 AI UI 冲突     |
| JetBrains IDE     | Kotlin UI + 独立 Runtime Adapter     | P1     | 用户覆盖广，但不能直接运行 VS Code Extension API |
| Zed               | Zed Extension API + 受限工具 Adapter | P2     | API 能力需先验证，不能承诺完整 Agent             |
| Neovim            | Lua UI + 本地 Evir Core RPC          | P2     | 可实现，但需要稳定的语言无关 Core 协议           |

下一步先验证同一 VSIX 在 VSCodium、Cursor 和 Windsurf 中的安装与基础 Ask。JetBrains 开发前应先把 Agent Core 暴露为版本化、可取消、可审计的本地 RPC 协议；Sidecar 必须按需启动，不能成为后台常驻服务。
