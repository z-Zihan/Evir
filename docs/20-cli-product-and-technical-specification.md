# Evir CLI 产品与技术规格

> Scope: `packages/cli`。本文同时描述目标契约和当前实现；标记为“目标”的内容不得写成已完成。

## 1. 产品定位

Evir CLI 是独立的本地优先 BYOM 终端 Agent。它面向偏好命令行的开发者和可组合脚本，不要求 Evir 账号、云端后端、Desktop 安装或 Desktop 常驻进程。

核心原则：

- `ask` 不自主访问工作区。
- `agent` 只在显式工作区内注册工具。
- 写入和命令默认拒绝，只能经逐次审批放行。
- 正常结果可进入管道，诊断不会污染 stdout。
- 配置与密钥分离；密钥永不进入 JSON、argv 回显或日志。
- 人类交互和机器自动化使用不同、稳定的 Presenter。

## 2. 用户与场景

- 开发者在终端快速询问模型或让 Agent 检查、修改并验证项目。
- 用户已在 Desktop 配置 Provider，希望 CLI 在下次运行直接识别。
- CI/脚本通过 stdin 运行 Ask，或读取版本化 JSON/JSONL 事件。
- 故障排查时运行 `doctor`，获得配置、凭据、连接和修复指引。

首版不包含：后台守护进程、云同步、MCP、Skill、浏览器/Computer Use、无人值守写入、Shell 字符串插值和 Desktop 会话同步。

## 3. 命令面

```text
evir --help
evir --version
evir config-path
evir configure --protocol <id> --base-url <url> --model <id> [--tool-calling]
evir doctor
evir ask [prompt]
evir agent [task] [--workspace <path>]
```

当前实现支持以上命令、参数/stdin Ask、隐藏密钥输入、SIGINT、文本流和工作区 Agent。

发布前目标补充：

- `--language zh-CN|en` 或等价 Locale 选择。
- `--json` 用于单次结构化结果，`--jsonl` 用于流式运行事件。
- `configure` 缺少必填 Flag 时进入明确的交互向导（TTY）或打印一条完整示例（非 TTY），不输出原始 Zod JSON。
- Provider 错误映射为认证、网络、限流、模型、协议、超时和取消等稳定类别。

## 4. 主流程

### 4.1 首次配置

1. 读取共享 `providers.json`；文件不存在时建立空文档，损坏或版本不支持时停止并提示备份/修复。
2. 合并用户参数与已有默认 Provider；校验协议、URL、模型和能力声明。
3. 非 Ollama Provider 从 `EVIR_API_KEY` 或 TTY 隐藏输入读取密钥；空输入保留已有凭据。
4. API Key 写系统 Credential Store，非敏感 Profile 使用临时文件 + 原子替换写入。
5. 输出保存位置和凭据状态，不回显密钥。
6. 建议用户运行 `evir doctor`，但不自动产生可能收费的能力探测。

### 4.2 Ask

1. 从参数读取 Prompt；缺省时从 stdin 读取。
2. 读取默认启用 Provider 和凭据。
3. 建立 AbortController 并开始真实 Provider 流。
4. 文本 delta 只写 stdout；状态和错误写 stderr。
5. 正常完成返回 0；Ctrl+C 保留已输出内容并返回 130。

### 4.3 Agent

1. 解析 `--workspace` 为真实绝对路径，校验存在、目录和符号链接边界。
2. 在 stderr 展示工作区和 Provider Host，说明相关内容可能外发。
3. 注册只读、写入和命令工具；模型不支持 Tool Calling 时阻止启动。
4. 输出当前步骤和工具事件；写入/执行先展示安全预览并请求 `Allow once? [y/N]`。
5. 非 TTY 环境拒绝写入和命令；只读工具仍受步骤/输出/循环限制。
6. 完成前运行合适验证，输出变更、验证、错误和未完成项。

当前实现已完成工作区边界、逐次审批、10 步上限和重复调用检测；尚未提供结构化步骤/验证/完成摘要 Presenter。

## 5. 状态与失败恢复

| 状态              | 人类输出                          | 下一步                      | 当前状态                  |
| ----------------- | --------------------------------- | --------------------------- | ------------------------- |
| 未配置            | 简短原因 + 完整 configure 示例    | 运行 configure              | 已实现基础文本            |
| 配置缺参数        | 缺失字段 + 示例/TTY 向导          | 补充或交互输入              | **当前输出原始 Zod JSON** |
| 凭据缺失          | Provider ID + 设置方式            | configure 或 `EVIR_API_KEY` | 已实现基础文本            |
| Doctor testing    | 配置、协议、模型、密钥状态        | 等待/取消                   | 已实现                    |
| Provider 失败     | 分类、简短原因、修复命令          | 重试/改配置                 | 分类与指引不完整          |
| Ask streaming     | stdout 文本 delta                 | Ctrl+C                      | 已实现                    |
| Agent running     | step/tool/elapsed                 | Ctrl+C                      | **结构化状态未实现**      |
| Approval          | 工具、风险、作用域、影响、默认 No | y/N                         | 已实现基础预览            |
| Non-TTY write     | 明确拒绝                          | 改用 TTY 或只读             | 已实现                    |
| Verification      | 命令、退出码、摘要                | 修复或重试                  | **Presenter 未实现**      |
| Completed/partial | 结果、变更、验证、遗留            | 检查 Diff/继续              | **统一摘要未实现**        |
| Cancelled         | stopped + 已完成影响              | 安全重跑                    | 退出码 130 已实现         |

## 6. stdout、stderr 与退出码

### 6.1 输出契约

- stdout：`ask` 模型正文、用户请求的最终值、`--json`/`--jsonl`。
- stderr：配置过程、目标 Provider/Workspace、进度、审批、警告和错误。
- 非 TTY、`NO_COLOR` 或 `TERM=dumb`：无 ANSI 颜色、Spinner 或覆盖行。
- JSON 事件包含 `schemaVersion`、`type`、`timestamp`、`command` 和类型相关字段；不得包含密钥、完整环境或默认文件正文。

### 6.2 目标退出码

| Code | 含义                       |
| ---- | -------------------------- |
| 0    | 成功                       |
| 1    | 未分类运行错误（兼容保留） |
| 2    | 参数或配置错误             |
| 3    | 凭据/认证错误              |
| 4    | 网络、超时或 Provider 错误 |
| 5    | 工作区或权限错误           |
| 6    | 审批拒绝/非交互审批不可用  |
| 7    | 工具或验证失败             |
| 130  | SIGINT 取消                |

当前实现除 Ask/Agent 的 SIGINT 130 和 Doctor 缺凭据 2 外，多数错误仍返回 1。发布前必须实现并测试上表；在此之前 README 只能说明当前行为。

## 7. 技术架构

```text
src/arguments.ts          argv → ParsedCommand
src/cli.ts                command orchestration + current text presenter
src/config-store.ts       versioned non-secret Provider document
src/credential-store.ts   OS credential adapter
src/provider-client.ts    shared Provider Core adapter
src/agent.ts              bounded Agent loop + approval gate
src/workspace-boundary.ts workspace root validation
src/workspace-tools.ts    file/search/git/process adapters
```

依赖方向：

```text
types → argument/config repositories → provider/tool services → agent runtime → CLI presenter
```

`provider-client.ts` 可以依赖 `src/core/providers` 的纯 TypeScript API；Core 不得导入 Node stream、Keyring、CLI 参数或工作区工具。

## 8. 配置与凭据

共享文档：

```json
{
  "version": 1,
  "providers": [
    {
      "id": "...",
      "name": "...",
      "protocolId": "openai-compatible-chat",
      "baseUrl": "https://api.example.com/v1",
      "modelId": "example-model",
      "toolCalling": true,
      "enabled": true,
      "isDefault": true,
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

- 文件权限目标为目录 `0700`、文件 `0600`，写入采用同目录临时文件和 rename。
- Credential service 为 `evir`，account 为 `provider:<id>:api-key`。
- 优先级：当前进程 `EVIR_API_KEY` → OS Credential Store。
- CLI 与 Desktop 按 Provider ID/`updatedAt` 合并，显式删除必须有独立语义，避免旧内存覆盖新配置。
- VS Code 扩展不读取该文件或 Credential account。

## 9. 安全、性能与日志

- Tool 输入使用 Zod 校验；路径在执行时重新检查 realpath/symlink 边界。
- 进程调用使用 program + args、`shell: false`、工作区 cwd、超时、输出上限和 AbortSignal。
- 不把完整 Prompt、文件正文、Authorization、Cookie、环境变量或 Provider 原始请求写入日志。
- CLI 冷启动不加载 MCP/Skill/浏览器模块，不扫描工作区；只有 Agent 调用具体工具时读取目标。
- 单次工具输出超过 256KB 时应写 Artifact/临时文件并返回摘要；不得把 1MB+ 输出长期留在 Agent 消息和终端内存。

## 10. 多语言与终端 UI

- 人类文案支持 `zh-CN`、`en`；命令名、Flag、JSON 字段和错误码保持英文稳定标识。
- 配置、审批、错误、停止和帮助文本使用消息目录，禁止业务模块拼接最终句子。
- 不只用颜色表达状态；所有状态同时有词语、结构化 type 或退出码。
- 窄至 80 列时自动换行，路径和 URL 可断行但不截掉风险对象。
- 审批先显示安全摘要，超长文件内容不完整回显到终端。

## 11. 测试与发布门槛

```bash
pnpm --dir packages/cli check
pnpm --dir packages/cli test:smoke
pnpm --dir packages/cli pack:check
```

还必须覆盖：

- macOS、Windows、Linux 的配置路径与 Keyring。
- TTY/非 TTY、参数/stdin、NO_COLOR、80 列、UTF-8 中英文。
- SIGINT 取消 Provider 流与子进程树。
- 损坏/未知版本 Profile 不被静默覆盖；旧 `config.json` 迁移。
- 每个目标退出码、stdout/stderr 分工和 JSON Schema 快照。
- 工作区遍历、绝对路径、符号链接逃逸、审批拒绝与命令注入。
- npm tarball 仅包含 `dist`、README、LICENSE 和必要生产依赖。

公开发布前还需确定 npm 包名与许可证，并完成全局安装、`npx`/等价一次性运行、升级、卸载和 Secret 扫描。

## 12. 完成清单

- [x] 独立构建、bin、版本、帮助、configure、doctor、ask、agent。
- [x] 参数/stdin Ask、真实流、SIGINT、工作区边界、逐次审批、循环/步骤上限。
- [x] Desktop 共享非敏感 Provider Profile 与系统凭据；VS Code 隔离。
- [x] 单元、smoke 和 tarball 检查入口。
- [ ] 友好配置向导和错误分类，不输出原始 Zod JSON。
- [ ] 中英文人类输出与完整消息目录。
- [ ] 版本化 JSON/JSONL 运行事件、稳定 stdout/stderr 和退出码表。
- [ ] Agent step/tool/verification/completion 摘要和长输出 Artifact。
- [ ] macOS/Windows/Linux 的真实 Keyring、安装/升级/卸载验收。
- [ ] 真实 Provider、网络异常、超时、停止和长任务验收。

专项产品与 UI 评审见 `docs/reviews/vscode-cli-product-ui-review.md`。
