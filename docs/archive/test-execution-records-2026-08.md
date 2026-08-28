> **Status: Archived（历史执行记录）**
> 本文件是 docs/23 曾内嵌的 2026-08-25/26 真实 Provider 与 GUI 实测执行记录原文，仅作历史证据。当前验证状态以 `docs/release-readiness.md` 为准。

## 8. 真实 Provider 原生冒烟执行记录（2026-08-25）

| 项目                    | 结果    | 实际证据                                                                                                                         |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 基线                    | INFO    | `main` / `f14ed82` 加未提交修复，macOS Apple Silicon，原生 Tauri ad-hoc release 构建                                             |
| Provider                | PASS    | EvoMap，OpenAI Compatible，`https://api.evomap.ai/v1`，模型 `glm-5.2`；真实 API Key 仅由用户在 Evir UI 输入，未写入本文档或终端  |
| 连接测试                | PASS    | 重启前连接测试成功；Anthropic Messages 虽能通过连接测试，但真实 Ask 返回空白，改为 OpenAI Compatible 后恢复                      |
| 真实 Ask                | PASS    | 返回精确文本 `EVIR_REAL_PROVIDER_OK`                                                                                             |
| 流式 Stop               | PASS    | 生成长中文响应时停止，消息状态显示“已停止”                                                                                       |
| Stop 后恢复             | PASS    | 同一会话继续发送后返回精确文本 `RECOVERED`                                                                                       |
| 会话重启恢复            | PASS    | 退出并重启 Evir 后，成功响应、停止状态和 `RECOVERED` 均仍可见                                                                    |
| Provider 元数据重启恢复 | PASS    | 名称、协议、Base URL、默认状态和模型在重启后仍存在                                                                               |
| Provider 凭证重启恢复   | BLOCKED | 已加入 Keychain 写入后立即回读校验并构建新版；旧进程中的凭证未实际持久化，需用户在新版中重新输入一次后执行重启验收               |
| 跨会话流式隔离          | PASS    | 单元测试与 Web/Desktop E2E 均验证：A 流式期间切到 B 不显示 A 内容；A 完成后只持久化到 A；快速 B→C 查询不发生旧结果覆盖           |
| 工作区选择              | PASS    | 原生目录选择器成功授权一次性目录 `/tmp/evir-e2e-adXU2J`；目录仅含 `input.txt` 与确定性 `verify.sh`                               |
| Agent 读取/写入/验证    | BLOCKED | 凭证丢失发生在任何模型或工具调用之前，未修改测试文件                                                                             |
| Agent 审批、Diff、回滚  | BLOCKED | 依赖真实 Agent 运行；不得以 Fixture 或静态测试冒充原生证据                                                                       |
| 诊断 UI                 | PASS    | Web/Desktop E2E 验证连接失败可见、导出含安全 Provider 错误字段与 request ID，且不含 Authorization 或测试密钥；真实原生复验待凭证 |

### 8.1 本轮缺陷

- `P0 / PRO-018 / PRO-019`：根因是 keyring 3.x 不默认启用平台后端，原配置 `keyring = "3"` 在 macOS 静默使用仅 Entry 内有效的 mock backend，导致写入返回成功而新 Entry 立即读不到。现已显式启用 `apple-native` / `windows-native`，保留写后回读校验，并加入原生后端类型回归测试；当前需用户在修复版重新输入一次以完成真实重启验收。
- `P0 / WEB-020`：已修复全局 `streamingContent/error/pendingToolApproval/latestAgentRun` 污染当前会话的问题。运行态新增所属会话 ID；增量、错误、审批和结果只向原会话可见；异步会话加载增加 stale-result guard。
- `P1 / i18n`：`chat.apiKeyMissing` 已补齐中英文文案，不再直接显示内部翻译键。
- `P0 / LOG-001`：已补齐 Provider 连接结构化日志与聊天流生命周期日志；浏览器导出脱敏自动化通过，真实原生诊断复验待凭证恢复。

### 8.2 继续执行条件

新版已构建并打开在现有 Provider 编辑页。用户需亲自重新输入凭证并保存；应用会立即校验 Keychain 回读。随后必须重启并证明连接测试和新会话仍成功，再继续 `DES-003`、`DES-009`、`DES-012`、`DES-013`、`DES-019`、`DES-020`、`DES-021`、`DES-029`。本轮临时工作区保持原始内容，尚未发生真实 Agent 写入。

### 8.3 本轮自动化结果

| 命令                          | 结果 | 明细                                                                                     |
| ----------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| Provider/存储/日志定向 Vitest | PASS | Keychain 写后回读、失败不落元数据、诊断脱敏与会话隔离定向测试通过                        |
| `pnpm check`                  | PASS | Format、ESLint、TypeScript、80 个文件/488 个测试、Release workflow、VS Code/CLI 全部通过 |
| `pnpm typecheck`              | PASS | TypeScript 构建类型检查通过                                                              |
| VS Code `check`               | PASS | 类型检查及 8 个测试通过                                                                  |
| CLI `check`                   | PASS | 类型检查及 8 个测试通过                                                                  |
| Rust fmt / clippy / test      | PASS | 格式与 lint 通过，17 个测试通过                                                          |
| Release workflow validation   | PASS | macOS Apple Silicon 与 Intel 目标校验通过                                                |
| `pnpm test:e2e`               | PASS | 34 通过、8 个按 Web/Desktop 能力边界预期跳过；含跨会话串流隔离及诊断导出                 |
| `pnpm test:ui`                | PASS | Web/Desktop 响应式、主题与语言矩阵 2/2                                                   |
| `pnpm test:visual`            | PASS | Web/Desktop 视觉基线 6/6                                                                 |
| `pnpm test:a11y`              | PASS | Web/Desktop 无障碍检查 18/18                                                             |
| `pnpm benchmark`              | PASS | 488/488；Web 初始 JS gzip 301.99 KiB，Desktop 前端 1.26 MiB，当前 arm64 DMG 5.26 MiB     |
| 原生 arm64 构建               | PASS | `Evir.app` 与 `Evir_0.1.0_aarch64.dmg` 生成；仅 ad-hoc 签名，未公证                      |

浏览器 Desktop capability E2E 不能替代原生 Tauri、Keychain 或真实 Provider 证据；正式签名、公证、Intel/Windows 实机和真实 Agent 完整任务仍不可由本轮自动化结果代替。

## 9. 真实 Provider 原生 Agent 执行记录（2026-08-26）

### 9.1 本轮原生结果

| 项目                  | 结果            | 实际证据                                                                                                                                                  |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider 凭证重启恢复 | PASS            | 修复版重启后保留 EvoMap Provider、OpenAI Compatible 协议、模型与凭证；真实会话可继续调用。凭证未写入仓库、命令或本文档。                                  |
| 工作区相对路径        | PASS            | 原生 Agent 成功解析并读取 `input.txt`、`verify.sh`、`.` 与 Git 工作区；同时保留路径遍历、同名前缀及符号链接逃逸防护。                                     |
| 文件写入审批          | PASS            | `write_file output.txt` 显示 L3、目标和参数；用户选择“本次允许”后写入精确内容 `ALPHA\nBETA\nGAMMA\n`。                                                    |
| 命令审批              | PASS            | `bash ./verify.sh` 显示 L3、工作目录和参数；用户单次允许后执行。                                                                                          |
| 约束保持              | PASS            | `input.txt` 执行前后 SHA-256 均为 `5165f3b1…`，未被修改。                                                                                                 |
| 预期失败表达          | PASS            | `verify.sh` 因 `input.txt` 缺少 `gamma` 返回 exit 1；模型明确报告失败原因，未伪造 `VERIFIED_OK`。                                                         |
| Git 状态与 Diff       | PASS            | 原生工具报告 `?? output.txt`，已跟踪文件无 diff，结论与测试工作区状态一致。                                                                               |
| 停止传播              | FAIL→FIXED(A+B) | 原生复现停止后编排仍进入后续读取；已修复授权续轮收到 Abort/Stopped 后直接取消整个 Run，并新增回归测试。修复后 Desktop E2E 21/21。                         |
| 运行证据续接          | FAIL→FIXED(A)   | 原生复现写入成功但最终卡片显示“修改文件 0”，导致回滚入口消失；已按编排 Run ID 合并授权前后 Tool、Result、Snapshot 与 File Reference，并新增聚合回归测试。 |
| 原生回滚              | BLOCKED         | 故障版本在停止后丢失回滚入口，未能完成本轮原生点击回滚；底层逆序 Snapshot 恢复测试通过，修复版仍需再做一次真实点击验收。                                  |
| 原生窗口复验          | BLOCKED         | 最新 ad-hoc 构建成功，但桌面自动化接口在重启后持续超时，未取得修复版窗口交互证据；不能以浏览器 Desktop capability 测试替代。                              |

### 9.2 本轮体验与可靠性修复

- 普通 Ask/Agent 流显示真实等待秒数；15 秒后显示慢响应说明，停止操作保持可见。
- Agent 单个模型回合上限为 120 秒；超时返回明确可重试错误，不再无限等待。
- 完成后的 Task Workbench 与 Agent 运行总结默认折叠为单行状态条；模型正文保持主视觉，执行细节和回滚仍可展开。
- 授权续轮停止后不再继续推进计划；写入、命令、快照和文件引用跨续轮合并，回滚入口不会因最终验证节点覆盖而消失。
- Provider 密钥继续只存安全存储；所有测试记录与构建日志均不得包含真实 Key。

### 9.3 2026-08-26 自动化与构建结果

| 命令                     | 结果             | 明细                                                                                                       |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm check`             | PASS             | Format、ESLint、strict TypeScript、80 个文件/500 个测试、Release workflow、VS Code 8/8、CLI 8/8 全部通过。 |
| Rust fmt / clippy / test | PASS             | `cargo fmt --check`、Clippy `-D warnings`、19/19 Rust 测试通过。                                           |
| `pnpm test:e2e`          | PASS             | Web/Desktop 合计 34 通过、8 个按产品能力边界预期跳过；Desktop 单独复跑 21/21。                             |
| `pnpm test:ui`           | PASS             | Web/Desktop 响应式、主题与语言矩阵 2/2。                                                                   |
| `pnpm test:visual`       | PASS             | Web/Desktop 视觉基线 6/6。                                                                                 |
| `pnpm test:a11y`         | PASS             | Web/Desktop axe 与键盘流程 18/18。                                                                         |
| `pnpm benchmark`         | PASS             | 500/500；Web 首屏 JS gzip 301.99 KiB；Desktop 前端 1.29 MiB；所有预算通过。                                |
| VS Code Host             | PASS             | 官方 VS Code 1.134.0 arm64 启动 Extension Host 并以 exit 0 结束。                                          |
| VSIX / CLI 包            | PASS             | VSIX 85.69 KiB；CLI smoke 通过并生成 `evir-cli-0.1.0.tgz`。                                                |
| macOS arm64 原生包       | PASS（开发证据） | 生成 `Evir.app` 与 `Evir_0.1.0_aarch64.dmg`；仅 ad-hoc 签名，未公证。                                      |

### 9.4 当前发布结论

本轮已关闭真实 Provider 保存、原生相对路径读取、写入/命令审批、预期失败报告、Git 证据、停止传播和证据续接问题。当前仍不可声明正式发布：修复版原生点击回滚尚未复验，macOS Developer ID/公证、Intel 实机、Windows 签名实机、真实外部 MCP、VS Code 完整真实 Provider Agent 与 CLI 三平台真实 Provider 验收仍缺失。

## 10. GUI 深度实测执行记录（2026-08-26 下午）

### 10.1 本轮环境

| 项                         | 值                                                                          |
| -------------------------- | --------------------------------------------------------------------------- |
| 基线                       | `main` / `2cbb58e` → `5b550ec`（本节测试期间连续提交）                      |
| 平台                       | macOS Apple Silicon（darwin 25.5.0）                                        |
| Web Runtime                | `vite --mode web` @1420                                                     |
| Desktop Capability Runtime | `vite --mode desktop` @1421                                                 |
| 原生                       | ad-hoc release bundle（`com.zihan.evir`）                                   |
| Provider                   | 节点感知 Agent fixture @1431（v4→v6，见 §10.5）+ 标准 provider-server @1430 |

### 10.2 长任务暂停/恢复实测（GUI-036/037）

| 步骤                                                             | 结果                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 发送 `[long]` 只读检查任务（goalKind=inspect, risk=low, 无疑问） | **未出现计划确认面板，直接 Executing plan**——只读免确认路径真实生效（GUI-035 PASS）                                                      |
| 等待首节点部分输出（"第一段检查进行中"流式可见，articles≥2）     | 暂停前已有部分输出，符合"不要一上来就暂停"                                                                                               |
| 点击"在检查点暂停"                                               | 当前节点完成后进入 Task paused + Resume task 按钮；暂停期间无新节点开始                                                                  |
| 暂停 3 秒后点击"恢复任务"                                        | 从未完成节点继续执行；已完成节点未重跑                                                                                                   |
| 运行结束                                                         | "Task partially completed"（新四态文案真实生效）；运行总结 2 完成/1 未解决/0 跳过；Verify 节点诚实判失败（无成功工具证据，GUI-040 PASS） |
| 证据截图                                                         | `gui-test-screenshots/r6_task_paused.png`、`r6_resume_partial.png`                                                                       |
| 本轮发现并修复                                                   | `partial` 状态原先不显示"重试任务"按钮（只覆盖 failed/cancelled）——已加入 partial 并补测试（GUI-039 补全）                               |

### 10.3 本轮（下午）发现与修复闭环

| #   | 发现                                                      | 处置                                                                                        | 提交             |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| 1   | 中文输入法组词中 Enter 被当发送（3 次实测复现）           | `isComposing` 守卫                                                                          | `2cbb58e`        |
| 2   | 相同工具+参数连续失败重试 10 次刷屏（循环检测到 12 才停） | `stopFailedRetries=2`（第 3 次拦截）+ UI 折叠重复失败卡为 1 张+"已重试 N 次"徽标 + 独立文案 | `5b550ec`        |
| 3   | 失败任务无重试入口                                        | `retryCurrentRun`（保留已完成节点重跑其余）+ 状态条按钮（failed/cancelled/partial）         | `5b550ec` + 本轮 |
| 4   | partial 态漏掉重试按钮（本轮长任务实测发现）              | retryable 条件加入 partial + 测试                                                           | 本轮             |
| 5   | 只读低风险任务确认面板偏重                                | 确认判定本已免确认（≤3 只读节点），实测验证生效并补回归锁定测试                             | `5b550ec`        |

### 10.4 本轮自动化结果

| 命令                             | 结果 | 明细                                                                                           |
| -------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                     | PASS | format/lint/strict TS/518 Vitest（较上轮 +6）/VS Code 8/CLI 8                                  |
| `pnpm test:e2e`                  | PASS | 34 通过/8 预期跳过；多轮连跑 34/34×3 零失败                                                    |
| `pnpm test:visual` / `test:a11y` | PASS | 6/6、18/18                                                                                     |
| 中途 E2E 失败 1 次               | 已修 | provider 错误用例的 `/Retry/i` 宽松断言被新"重试任务"按钮命中两元素 → 改为精确匹配消息级 Retry |

### 10.5 节点感知 Agent fixture 说明（可复用测试资产）

编排 GUI 用例需一个能按节点 system 指令（"Execute only this plan node: X."）行事的 OpenAI Compatible fixture：

- `submit_task_brief` 请求 → 返回结构化 Brief（[long] 触发 inspect 低风险 Brief 用于免确认/暂停测试；默认 change Brief 用于审批流测试）
- `submit_plan_graph` 请求 → 返回非法计划触发内置模板回退（同时验证 model-plan-rejected 日志）
- 节点指令 Inspect context / Execute task / Verify result → 分别返回 read_file 调用、write_file 调用、验证文本
- [long] 模式下每节点输出慢速长文本（~9 秒/节点），供暂停窗口
- [clarify] 模式 Brief 含 unknowns 触发澄清面板

fixture 存放：会话临时目录（本轮 `/tmp/agent-fixture.mjs` v4–v6）；建议后续固化为 `e2e/fixtures/agent-fixture.mjs` 入库。

### 10.6 本节结论

长任务"部分输出后暂停 → 安全边界生效 → 恢复 → 如实部分完成"全链路在 Desktop Capability Runtime 真实通过；原生层暂停/恢复与回滚点击复验仍待 CUA 会话恢复后补充（底层调度/快照逻辑已有单测覆盖）。发布阻断清单不变（§6）。
