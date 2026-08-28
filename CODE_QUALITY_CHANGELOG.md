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

---

# 第二轮（A–D 组：产品决策落地 + 延后项全量清偿）

日期：2026-08-28。用户指令：A/B/C/D 全做；签名公证降级为非阻塞。

## Batch A — 产品策略落地（原"仅报告"项）

**修改内容**

1. **A3 L2 审批门对齐**：`validateToolForExecution` 由仅拦 L3/L4 改为 `riskLevelExceeds(level, "L1")`（L2+ 全部经 `resolveExecutionPermission`），与 permission-profiles 文档化的 "L2+" 策略一致；ask profile 下的 create_directory/apply_patch 现在会请求审批，workspace profile 内仍自动批准。
2. **A4 工具能力模式集统一**：`MODES_REQUIRING_TOOL_CALLING` 扩为 plan/goal/agent（plan 亦运行 L1 工具；配合 QA 轮的 `effectiveModeForModel` 文本模型降级）。
3. **A1 自动验证审批门**：`runVerification` 改经 `runtime.toolExecutor.execute("run_command", …, {…runtime, mode:"agent"})`——权限档案统一门控；需审批（ask profile）时返回 **skipped** 并提示改用 workspace/full，run 停留在 needs_verification，不再静默执行 Agent 刚写的工作区脚本。
4. **A2 done-when 门控**：`evaluateDoneWhen` 同样改经 ToolExecutor（mode:"goal"）；无执行权限时降级 **manual** 且**阻止**目标自动达成（用户确认或换档案重跑）。

**涉及文件** tool-executor.ts、tool-registry.ts、verification.ts、done-when.ts + 三组测试。
**验证** vitest：新增 executor L2 门控、verification 路由×4、done-when 权限降级/中文混合等用例。

## Batch B-Rust — 延后安全/健壮项

1. **全部 37 个同步命令移出主线程**：`#[tauri::command(async)]`（Tauri 2 对同步 fn 的 sync_threadpool 执行；已验证 State/AppHandle 均可编译）。
2. **db_query 双层收紧**：`execute_query` 增加 SQLite 级 `statement.readonly()` 权威闸口（挡住 CTE 前缀 DML 与写型 PRAGMA——后者 readonly() 误报 true，另配只读 PRAGMA 白名单 + 拒绝 `=` 参数）；词法层 `has_statement_tail` 拒绝多语句（rusqlite 无 extra_check feature 时尾部静默丢弃）；`validate_update_sql` 删除误报子串扫描（"drop_reason" 列名不再被拒）。
3. **遗留密钥清洗（migration 3）**：init 时 `UPDATE providers SET api_key=''`，一次性抹掉实体存储时代前的明文残留。
4. **原子写**：`fs_write_file`/`fs_apply_patch` 改临时文件+fsync+rename（崩溃不再半写；目标处 symlink 被替换而非跟随）。
5. **分块快照/哈希**：`copy_and_hash`/`hash_file` 64KB 流式 FNV-1a（与旧哈希逐字节一致，sealed 快照仍可比对）；`fs_read_file` 1MiB 读取上限。
6. **stdin null**：run_command 子进程不再继承 stdin。
7. **MCP 注册表剪枝**：request/send/status 探测到退出即移除句柄（Drop 收割子进程），死服务器不再以 "already running" 遮蔽重启、不再占僵尸进程。
8. **MCP 锁重构**：响应通道移出进程互斥锁——等待响应（至多超时时长）不再阻塞 status()/stop()/并发请求。

## Batch B-FE1 — 渲染与交互

1. **selector 化**：App/Sidebar 全字段选择器（流式增量不再重渲染整棵侧栏树）；ChatView `useShallow` 组；`SidebarConversationItem/SidebarProjectItem` memo 化；`threadsOf` useMemo。
2. **贴底滚动**：仅当用户已在底部 80px 内才自动跟随流式输出；用户上翻阅读不被打断；发送/执行计划时强制贴底。
3. **按会话门控 composer**：textarea/附件/技能/导出/消息编辑仅在**当前会话**流式时禁用（其他会话可正常草拟）；发送按钮保持全局单 run 策略并附 `chat.streamInProgress` 提示（en/zh）；AgentActivity 审批按钮按审批所属会话门控。
4. **Ask 模式超时**：300s 挂死保护（慢模型仍充裕）。
5. **删除/清空防孤儿**：删除正在流式的会话先 stop；清空会话/全部数据前先 stop。

## Batch B-FE2 — 结构与合并

1. **approveTool/denyTool 合并**：先写 4 条特征测试（执行/无执行器/拒绝/中途停止——保留 approve 停止记 "cancelled"、deny 记 "denied" 的差异），再合并为 `resolveApproval(pending, outcome)`，两函数变薄包装（~140 行重复消除）。
2. **环解耦**：新增 `project-events`（notify/onProjectRemoved），project-store 不再 import chat-store（chat→projects 单向；此前闭环 chat→send-message→projects→chat 消除），chat 侧注册监听完成会话解绑。
3. **coordinator facade**：`features/chat/model-switch-service.ts` 懒构造；ChatView 不再 import core 实现类。
4. **架构测试正则扩展**：覆盖动态 `import()`；修复不存在的 `src/components` 死路径；core/mcp/transports 移除 Tauri 动态导入（invoke/listen 改注入，`runtime/tauri-ipc.ts` 桥由 create-runtime 注入 McpClient）——core 层 Tauri-free 由测试强制。
5. **小 P3**：`evir-workspace-current` key 单一来源；`MCP_STDIO_NOTIFICATION_EVENT` 常量（Rust 侧注释互链）。
6. **评估后不做**：linkAbort 四处形态各异（各绑不同资源），强行抽象违反"不过度抽象"；ModelCapabilities 三处为不同生命周期形状（wire/持久子集/共享档案），非真重复。

## Batch C — 构建与发布

- **CSP**：`tauri.conf.json` 由 null 改为白名单（script-src 'self'；connect-src 覆盖 Tauri IPC、任意 https 提供方、localhost/127.0.0.1 本地模型与 ws；img 覆盖 asset/blob/data/https）。
- **build:desktop** PASS（arm64 .app + DMG，ad-hoc 签名；**公证按指示跳过**，发布前需补 Apple 凭据流程——非阻塞）。
- **release:validate-tag**：`v0.1.0` 格式 PASS（脚本需 tag 参数；已验证拒绝预发布格式）。
- **真机冒烟**：启动打包版 → `app.session-started desktop` 等完整启动日志写入（= CSP 下 JS/React/FileLogSink 正常执行）→ 菜单 AX 干净退出。屏幕录制权限缺失导致无法截屏/坐标交互，深度 UI 交互冒烟未做（如实记录）。

## Batch D — 记忆遗留

1. **done-when 中文命令分类**（随 A2 重写）：CJK 感知的 FAIL_MARKERS（`\b` 对中文永假的缺陷修复）；程序名锚定白名单 + 路径程序识别；混合中文散文/参数含 CJK 一律降级 manual（不再 spawn "运行" 之类的伪程序名导致误报 failed）；尾部结果标记循环剥离。新测试覆盖全部回归场景。
2. **worktree 真实往返测试**：cargo 集成测试 init repo → create → worktree 内写入 → merge → 主树验证 → remove → 分支/目录清理；非 git 目录失败路径。**测试立刻抓出真 bug：`git apply --3-way` 应为 `--3way`——worktree 合并在真实运行中从未成功过**（此前无任何实测），已修复并回归。

## 第二轮回归

全部绿：`pnpm check`（658+8+8）、cargo fmt/clippy/**35 tests**（+2 storage、+2 worktree）、e2e 核心 **38 通过 0 失败**（上一轮的预存诊断 e2e 已由 QA 轮修复）、stress 7、UI 矩阵 2、visual 6、a11y 18、benchmark、build:desktop。
