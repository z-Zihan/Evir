# 代码质量优化变更记录（无功能变化轮）

- 日期：2026-08-27
- 原则：正确性 > 重构数量；不改变功能 > 形式漂亮；每批独立可验证、可回滚
- 日志体系按约定全程未动（未改任何日志内容/级别/持久化）
- 伴随产出：`CODE_QUALITY_AUDIT.md`（问题与状态）、`REGRESSION_TEST_REPORT.md`（验证记录）

---

## Batch 1 — Rust 安全与健壮性

**修改内容**

1. 快照三命令（create/seal/restore）对 `run_id`/`snapshot_id` 施加 `validate_component_id` 字符集校验（镜像 `validate_server_id` 规则 + 显式拒绝 `.`/`..`）——修复 P0 路径穿越。
2. `fs_restore_snapshot` 新增 `confine_snapshot_payload`：metadata 记录的 `snapshot_path` 必须 canonicalize 后位于 `<data_dir>/snapshots` 内——封死"伪造 metadata 任意文件复制"原语。
3. 三个 `git_worktree_*` 命令对 `id` 同样校验。
4. `diagnostics_export_zip` 目标路径校验（绝对路径 + 父目录存在 + 非已存在目录）。
5. `truncate_string` 回退到 UTF-8 字符边界（多字节输出不再 panic）。
6. `read_pipe` 有界读取（200KB 上限 + lossy 解码），`cat 大文件` 不再 OOM。
7. `run_command` 超时钳制 ≤600,000ms（对齐 MCP `MAX_REQUEST_TIMEOUT_MS`）。
8. `run_command`、`diagnostics_export_zip` 改 `async fn` + `tauri::async_runtime::spawn_blocking`（复用 mcp_stdio 既有模式）——移出主线程，长命令不再冻结 UI，`cancel_command` 在命令执行期间可达。
9. `fs_seal_snapshot` 的 `meta["post_hash"]` 赋值改 `as_object_mut`（损坏 metadata 不再 panic）。
10. `uuid_string` 使用全量 subsec_nanos（消除 100µs 碰撞窗）。
11. `validate_path` 阻断表补 home 敏感前缀（`~/.ssh`、`~/.gnupg`、`~/Library/Keychains`）——TS 侧同类阻断在 WebView 中因 `process` 未定义早已失效，Rust 成为唯一有效层。
12. MCP `request()` 陈旧响应排空（id 不匹配 continue 等待而非立即失败）——修复慢服务器重试必失败。
13. MCP `terminate()` 增加已回收守卫（子进程被 reap 后不再向（可能已复用的）pid 发信号）。

**涉及文件** `src-tauri/src/commands.rs`、`diagnostics.rs`、`mcp_stdio_process.rs`、`mcp_stdio_process_tests.rs`

**为什么修改** 审计 P0-1、P1-1/2/3、P1-10、P2-1..6（见审计报告）。

**如何保证没有改变功能** 全部为边界校验与执行线程调整：合法输入路径（既有工具调用参数形态）行为不变；异步化仅改变执行线程（签名、参数、返回值、注册方式不变）；截断上限与语义不变（仍 50k 字符 + 提示）。行为修正三处（陈旧响应排空、home 阻断、timeout 钳制）均为修复缺陷而非改变设计，已在审计报告单列。

**验证** cargo fmt --check / clippy --all-targets / cargo test 31 通过（新增 6 测试：component_ids_reject_path_traversal、truncate_string_stays_on_char_boundaries、read_pipe_caps_output_size、validate_path_blocks_sensitive_home_locations、confine_snapshot_payload_stays_inside_store、stale_response_does_not_fail_the_next_request；重写 response_ids_cannot_cross_request_ownership 为新契约）。

---

## Batch 2 — TS 安全与死代码

**修改内容**

1. 删除 `src/core/tools/builtin/browser-tools.ts`（219 行）：零引用、`browserAutomation` 能力永不授予、对应 Rust 命令不存在——彻底死代码，删除无任何行为面变化。
2. `rootForPath`（desktop-storage-adapter）改用 `isInsideRoots`（归一化比较），消除反斜杠/尾斜杠 root 静默失配。
3. 三处实体列表加互链注释（storage-port ↔ indexed-db-adapter ↔ Rust STRUCTURED_ENTITIES）。

**涉及文件** `src/runtime/desktop-storage-adapter.ts`、`src/core/storage/indexed-db-adapter.ts`、`src-tauri/src/commands.rs`（注释）、删除 browser-tools.ts

**为什么修改** 审计 P1-6、P1-11、P1-7（处置修正为文档化）。

**如何保证没有改变功能** 死代码删除经 grep 证明零引用；isInsideRoots 对现行合法路径（POSIX 规范形态）返回值与旧 startsWith 完全一致，仅修复 Windows/尾斜杠边界的错误回落。

**验证** pnpm typecheck + vitest 636 全绿。

---

## Batch 3 — TS SSOT 与重复收敛

**修改内容**

1. `tool-registry.ts` 导出 `INTERACTION_MODES`、`MODES_REQUIRING_TOOL_CALLING`/`requiresToolCalling()`、`RISK_LEVELS`、`TOOL_SOURCES` 单一事实来源。
2. checkpoint zod 枚举改由 `INTERACTION_MODES` 派生——**恢复 goal 模式检查点的读取**（数据丢失级漂移缺陷）。
3. stream-response 与 harness capability-gate 共用 `requiresToolCalling`（对齐 goal；coordinator 保留更严的 plan 拦截并注释理由）。
4. `adapter-registry` 导出 `isSupportedProtocol`；`providerReadinessError` 改询问 registry——**修复 Azure/Ollama 有适配器却被聊天路径误拒**的漂移。
5. `uuid()` 收敛至 `openai-chat-utils.ts`（7 处副本删除，逐字保留原实现）。
6. SSE 解析器收敛：anthropic 本地副本删除、`responseSseEvents` 改为共享 `sseEvents` 的再导出（与原实现逐行一致）。
7. Ollama 错误映射改走共享 `mapHttpError`（恢复 401/403→AUTH_FAILED 与内容分类）。
8. `appendToolMessages` 系列收敛：agent-loop 导出 `assistantToolCallWireMessage`/`toolResultWireMessages`，tool-approval-helpers 与 stream-response 复用（各自保留 raw vs 重序列化参数的既有语义）。
9. 常量提升：`DEFAULT_MAX_CONTEXT_TOKENS`（新 `core/providers/model-defaults.ts`，原 128k 双处内联）、`STRUCTURED_RESPONSE_TIMEOUT_MS`（新 `features/orchestration/structured-response.ts`，原 45s 双处）。
10. `conversation-import` zod 补齐 `pinned/projectId/activeSkills/summaryMetadata/tool-result 时序字段`——恢复导出→导入往返保真（ projectId 丢失导致项目归属脱钩）。
11. 本地日期戳收敛为 `core/time/local-date-stamp.ts`（file-log-sink / diagnostics-export / usage-analytics 三份逐字相同实现）。

**涉及文件** 见 diff（core/providers/adapters/\*、features/chat/\*、features/orchestration/\* 等 24 文件 + 5 新文件）

**为什么修改** 审计 P1-4/5/12/15、P2-7..11/13/15。

**如何保证没有改变功能** 所有收敛均为"逐字相同实现合并到一处"或"派生自单一常量"；行为修正两处（checkpoint goal、协议就绪）均是把实现拉回已声明的预期契约（interface 已含 goal；registry 已支持 7 协议），在审计报告中单列说明。共享 SSE 解析器与原实现逐行对照后采用。

**验证** typecheck + vitest 641 通过（新增 chat-stream-readiness 3 用例、checkpoint goal 往返 2 用例）。

---

## Batch 4 — 发送链路竞态与生命周期加固

**修改内容**

1. `sendChatMessage` 在首个 await 前同步置位 `isStreaming`，finally 兜底复位（规划期双重提交窗口关闭）；`regenerate`/`editMessage` 同模式（storage await 窗口关闭）。
2. `streamResponse` 重构为薄包装（try/catch/finally）：任何持久化/harness 异常都会复位流状态并显示错误，composer 不再可能永久卡死；原主体移至 `runStreamResponse`（逻辑未动）。
3. `finishConversationStream` 增加 `startedAt` 相等校验；`runStreamResponse` 尾部 set 增加 stream-slot 归属守卫——停止后旧 run 尾部不再污染同会话新 run（仍保留"停止后持久化部分内容"的既有行为）。
4. 体内 5 处冗余 `finishConversationStream` 调用删除（统一由 finally 收尾，消除重复日志事件）。
5. `prepareTask` 在计划生成后复查取消标志——规划期"停止"不再被兜底计划覆盖执行。
6. `AgentRunSummary` 验证 effect 增加 cancelled 标志与 catch（invoke 失败/卸载不再永久 loading）。

**涉及文件** `features/chat/send-message.ts`、`chat-store.ts`、`stream-response.ts`、`stream-ownership.ts`、`features/orchestration/orchestration-session.ts`、`src/app/AgentRunSummary.tsx`

**为什么修改** 审计 P1-8/9、P2-12。

**如何保证没有改变功能** 守卫只拒绝"本就不应发生的并发/迟到的状态写入"；正常时序（单次发送、正常完成、停止后持久化部分输出）路径逐一核对不变。期间自查发现并修复了一个我引入的拆分缺陷（runStreamResponse 作用域丢失 provider，被新 catch 暴露为 10 个测试失败——已修复并全绿）。

**验证** vitest 643 通过（新增双重提交守卫用例、规划期取消用例）。

---

## Batch 5 — 架构小修

**修改内容**

1. `conversation-summarizer`（core）不再值导入 features/chat 的 `streamAssistant`——改为调用方注入 `streamFn`（全仓唯一 core→features 值依赖边消失）。
2. `use-runtime` 的 `createRuntime()` 由模块级急切构造改为首次调用懒构造（41 个调用点不变；消除导入即构建注册表的副作用）。
3. ChatView 的 `ModelSwitchCoordinatorImpl` 由模块级 `new` 改为懒构造函数。
4. `publicMcpToolId` 从 adapter 内部模块移至 `core/mcp/tool-id.ts`（features/mcp 不再依赖 adapter 文件布局）。

**涉及文件** `core/context/conversation-summarizer.ts`（+测试）、`runtime/use-runtime.ts`、`src/app/ChatView.tsx`、`core/mcp/tool-id.ts`（新）、`tool-adapter.ts`、`features/mcp/mcp-store.ts`

**为什么修改** 审计 P1-13、P3-1/2。

**如何保证没有改变功能** 全部为构造时机/依赖方向调整，运行时行为等价；summarizer 无 streamFn 时维持"Summary unavailable"既有兜底语义。

**验证** typecheck + vitest 643 通过。

---

## 明确未做（避免越权）

- 自动验证审批门（P1-14）、done-when 命令门控、L2 审批策略——产品决策项，仅报告。
- `approveTool`/`denyTool` 合并——高回归风险，待补特征测试后另轮处理。
- 整库 selector 化、features 环解耦、架构测试正则扩展（需先处理 transports 注入默认值，否则 CI 即红）。
- 日志体系（本轮豁免范围）。
- Web 端实体列表派生（核实为有意设计）。
