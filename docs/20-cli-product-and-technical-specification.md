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

当前实现已完成工作区边界、逐次审批、10 步上限、重复调用检测、基础完成摘要（步骤/工具调用/写入成败/验证标志/耗时）和长输出 Artifact（见 §9）。

## 5. 状态与失败恢复

| 状态              | 人类输出                          | 下一步                      | 当前状态                                                                                                                   |
| ----------------- | --------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 未配置            | 简短原因 + 完整 configure 示例    | 运行 configure              | 已实现基础文本                                                                                                             |
| 配置缺参数        | 缺失字段 + 示例/TTY 向导          | 补充或交互输入              | **当前输出原始 Zod JSON**                                                                                                  |
| 凭据缺失          | Provider ID + 设置方式            | configure 或 `EVIR_API_KEY` | 已实现基础文本                                                                                                             |
| Doctor testing    | 配置、协议、模型、密钥状态        | 等待/取消                   | 已实现                                                                                                                     |
| Provider 失败     | 分类、简短原因、修复命令          | 重试/改配置                 | 退出码 3/4 按凭据/余额族与其余 Provider 错误分类已实现（连接失败类归 4）；本地化修复指引已实现（简短提示，非完整配置向导） |
| Ask streaming     | stdout 文本 delta                 | Ctrl+C                      | 已实现                                                                                                                     |
| Agent running     | step/tool/elapsed                 | Ctrl+C                      | 已实现基础结构化事件                                                                                                       |
| Approval          | 工具、风险、作用域、影响、默认 No | y/N                         | 已实现基础预览                                                                                                             |
| Non-TTY write     | 明确拒绝                          | 改用 TTY 或只读             | 已实现                                                                                                                     |
| Verification      | 命令、退出码、摘要                | 修复或重试                  | 已实现基础验证标志                                                                                                         |
| Completed/partial | 结果、变更、验证、遗留            | 检查 Diff/继续              | 已实现基础摘要                                                                                                             |
| Cancelled         | stopped + 已完成影响              | 安全重跑                    | 退出码 130 已实现                                                                                                          |

## 6. stdout、stderr 与退出码

### 6.1 输出契约

- stdout：`ask` 模型正文、用户请求的最终值、`--json`/`--jsonl`。
- stderr：配置过程、目标 Provider/Workspace、进度、审批、警告和错误。
- 非 TTY、`NO_COLOR` 或 `TERM=dumb`：无 ANSI 颜色、Spinner 或覆盖行。
- JSON 事件包含 `schemaVersion`、`type`、`timestamp`、`command` 和类型相关字段；不得包含密钥、完整环境或默认文件正文。
- 已实现：`agent --json` 的每一行都是 `{ schemaVersion: 1, timestamp, command: "agent", event }` 的换行分隔信封，`event` 即原始的 CLI-2 载荷。
- 已实现：`completed` 事件附加统计字段 `toolCalls`（按工具名次数）、`writes`（写类工具 ok/failed 计数）、`verified`（`run_command`/`git_status`/`git_diff` 全部成功才为 true）和 `elapsedMs`（运行墙钟耗时）；Agent 运行结束时还会在 stderr 输出一行本地化人类摘要（zh/en）。
- 已实现：`failed` 事件新增可选字段 `errorKind`（`config`/`provider`/`runtime`）、`errorType`（共享层 `ProviderErrorType` 枚举）、`retryable`；均为 additive，不影响 `schemaVersion`，Provider 运行错误以外的失败（配置、循环/步骤上限）仅填 `errorKind`。
- 已实现：`ok: true` 的 `tool-result` 事件新增可选字段 `artifact: { path, bytes }`，仅当该次工具输出触发 §9 的 256KB 落盘时出现；为 additive 字段，不影响 `schemaVersion`。

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

当前实现：上表已落地并有单元/集成测试覆盖。说明 6（审批拒绝/非交互审批不可用）当前无产生路径——非 TTY 下拒绝写入/命令是工具级拒绝（工具结果里返回失败文案，交给模型续写），不会终止 Agent 运行或改变进程退出码；该码位保留给未来需要终止运行的审批场景。Provider 运行错误已细分：共享层 `ProviderErrorType`（`src/core/providers/stream-events.ts`）里 `AUTH_FAILED`、`INSUFFICIENT_BALANCE` 归码 3；其余（`RATE_LIMITED`、`NETWORK_ERROR`、`MODEL_NOT_FOUND`、`CONTEXT_OVERFLOW`、`TOOL_CALL_UNSUPPORTED`、`VISION_UNSUPPORTED`、`PROTOCOL_INCOMPATIBLE`、`PROVIDER_ERROR`、`CANCELLED`、`CORS_BLOCKED`）归码 4——CLI 运行在 Node 里没有浏览器 CORS 策略，`CORS_BLOCKED` 只能来自共享层 `mapThrownError`（`openai-chat-utils.ts`）的 `streamStarted === false` 分支：它把 Node `fetch` 在流开始前抛出的 `TypeError`（拒连、DNS 失败等，与浏览器 CORS 拒绝在 fetch 层不可区分）归类为该类型，在 CLI 语境下这是网络族失败而非凭据失败，因此归 4；分类函数为 `packages/cli/src/exit-codes.ts` 的 `mapProviderErrorTypeToExitCode`，有全枚举单元测试与 `ask`/`agent` 集成测试覆盖。真实跨平台网络异常/超时下各子类的实机验收仍属第 10 项 NOT RUN。Agent 循环检测与 10 步安全上限统一归 7（工具或验证失败）。

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
- 已实现：CLI 侧阈值为 256 * 1024 字节（精确等于该值不落盘，超出 1 字节即落盘）；超限输出整份写入 `<workspace>/.evir/artifacts/<UTC 时间戳>-<pid>-<序号>-<工具名>.txt`，模型侧收到的摘要只含字节数、前 4KB 预览（含截断标记）和该 Artifact 相对路径，并提示可用 `read_file` 分段读取；磁盘写入失败时降级为仅返回预览 + 失败原因，不抛错，也不产生 `artifact` 字段。`read_file` 本身超过 256KB 仍直接报错，不落盘、不走该路径。`search_files` 的目录遍历跳过 `.evir`，避免 Artifact 文件污染搜索结果。
- 已实现：`run_command`/`git_status`/`git_diff` 的输出通过 `artifacts.ts` 的 `createSpillSink(root, toolName)` 流式落盘，而不是先在 `workspace-tools.ts` 里累积成一个完整字符串再检查阈值——此前两者的内存上限恰好都是 256KB，导致这三个工具的输出永远先被 `runProcess` 自身截断，从未真正达到落盘阈值，`tool-result` 的 `artifact` 字段对它们形同虚设。现在 sink 在内存中只缓冲到 256KB，一旦这次追加的 chunk 使累计字节超过阈值，就把已缓冲内容一次性写入 Artifact 文件（同一套 `.evir/artifacts/<时间戳>-<pid>-<序号>-<工具名>.txt` 命名），此后的 chunk 原样逐个 `appendFile` 追加，内存不再随输出增长（只保留落盘时刻那 4KB 预览）；成功退出（exit 0）时的工具返回值来自这条流式路径。失败路径（非零退出码 / 子进程 `error` 事件）的错误信息维持原状：仍使用旧的、内存中按 256KB 截断的输出拼成，不经过 sink 的摘要逻辑，也不携带 `artifact` 字段；但若输出在失败前已越过阈值，sink 此前建立的 Artifact 文件会照常留在磁盘上（错误信息不会引用它）。sink 建立阶段（`mkdir`/`writeFile`）失败会降级为与 `spillIfTooLarge` 相同措辞的预览+失败原因摘要，不产生 `artifact` 字段；建立成功之后的某次追加写入（`appendFile`）失败则标记为 partial——摘要如实说明磁盘上只有已成功写入的字节数、输出不完整、未写入的剩余部分不可恢复，此时仍带 `artifact` 字段（`bytes` 为磁盘上的真实字节数，不是逻辑总字节数）。阈值内的输出行为与此前完全一致：按原样返回该工具的结果字符串，没有 `artifact` 字段。

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
- [ ] 友好配置向导和错误分类，不输出原始 Zod JSON（Provider 错误子分类的 CLI 侧已落地：§6.2 的 `mapProviderErrorTypeToExitCode` + stderr 修复指引 + `doctor` 短标签；交互式配置向导与 Zod JSON 的替换展示仍未做）。
- [ ] 中英文人类输出与完整消息目录。
- [x] 版本化 JSON/JSONL 运行事件、稳定 stdout/stderr 和退出码表（本次范围：§6.2 全部码位已映射并有单元/集成测试；跨平台真实 Provider 网络异常/超时下的码位验收仍属第 10 项 NOT RUN）。
- [x] Agent step/tool/verification/completion 摘要和长输出 Artifact（本次范围：完成摘要 + 事件统计字段；长输出 Artifact CLI 侧已实现——工具输出超 256KB 落盘 `.evir/artifacts/` 并返回摘要，`tool-result` 事件附带 `artifact` 字段；`run_command`/`git_status`/`git_diff` 此前因与自身 256KB 捕获上限撞车而永远触不到这条落盘路径，现已改为流式落盘，三者也能真正触发并验证通过；`read_file` 超限仍直接报错；真实 Provider 端到端验收仍 NOT RUN）。
- [ ] macOS/Windows/Linux 的真实 Keyring、安装/升级/卸载验收。
- [ ] 真实 Provider、网络异常、超时、停止和长任务验收。

专项产品与 UI 评审见 `docs/archive/reviews/vscode-cli-product-ui-review.md`（历史快照）。
