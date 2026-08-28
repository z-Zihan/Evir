> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# Evir 全项目代码质量审计报告

- 审计日期：2026-08-27
- 审计范围：`src/`（TS 前端）、`src-tauri/`（Rust 桌面后端）、`extensions/vscode/`、`packages/cli/`、`e2e/`、构建与 CI 配置
- 审计方法：5 路并行深度扫描（架构边界 / 安全 / 重复与 SSOT / 状态与异步 / Rust 后端）+ 对全部 P0/P1 发现逐条人工核验源码（含 Tauri 2.11.5 与 wry 0.55.1 官方源码核验）
- Baseline（审计时点，未做任何修改）：`pnpm check` 全绿（format / lint / typecheck / vitest 103 文件 636 用例 / vscode 8 用例 / cli 8 用例 / release workflow 校验）；`cargo fmt --check` 通过；`cargo clippy --all-targets` 通过；`cargo test` 25 用例通过
- 特别说明：按本轮约定，**日志内容、脱敏、持久化一律不在审计与修复范围内**；以下不涉及任何日志类问题。

---

## 1. Executive Summary

**总体健康度：良好偏上。** 项目分层（Types → Config → Repository → Service → Runtime → UI）总体成立：UI 层零直接 Tauri/Dexie/Provider SDK 引用，密钥全程走 Keychain 端口，工具调用有统一 Registry + 审批咽喉点，路径校验（Rust 侧 canonicalize + 前缀阻断）核心逻辑扎实且有高质量测试。工程门禁完整、基线全绿。

**最主要的问题（按风险排序）：**

1. **[P0] 快照三命令存在路径穿越**：`run_id`/`snapshot_id` 未校验直接拼接路径，且 `fs_restore_snapshot` 会复制 metadata 中记录的任意 `snapshot_path`。结合"写文件在工作区 profile 下自动批准"，构成模型可达的任意文件读取原语，击穿 workspace 边界。
2. **[P1] 同步 Tauri 命令全部在主线程执行**（经 Tauri 2.11.5 / wry 0.55.1 源码确认）：`run_command` 的 50ms 轮询循环默认占用主线程最长 30 秒——冻结 UI，且使 `cancel_command`（同样走主线程）在命令执行期间不可达。
3. **[P1] 三处"同一业务事实多处维护"已实际漂移成功能缺陷**：checkpoint zod 枚举漏掉 `goal`（Goal 模式检查点静默丢失）、`providerReadinessError` 硬编码 5 协议而 Registry 支持 7 个（Azure/Ollama 被误拒）、Web 端实体列表缺 5 个实体（Web 写入直接抛错）。
4. **[P1] 聊天发送链路存在三个真实竞态**：规划期双重提交窗口、停止后旧 run 尾部污染新 run 状态、`streamResponse` 无 try/finally 导致 `isStreaming` 可能永久卡死。
5. **[P1] 安全控制"看起来在防、实际没防"**：TS 侧 home 目录敏感前缀阻断在桌面 WebView 中因 `process` 未定义而全部失效（`homeDir()` 返回 `/`），Rust 侧又无 home 阻断——Full Access profile 下 `~/.ssh` 可读。

**是否适合直接重构：适合。** 基线全绿、测试覆盖核心路径、问题集中且相互独立，支持小批次渐进修复。**推荐顺序**：Rust 安全加固 → TS 安全修正 → SSOT 收敛 → 竞态加固 → 架构小修（见文末 Optimization Plan）。

---

## 2. 问题统计

| 级别 | 数量 | 本轮处置                        |
| ---- | ---- | ------------------------------- |
| P0   | 1    | 修复                            |
| P1   | 15   | 12 修复，3 仅报告（产品决策类） |
| P2   | 22   | 9 修复，13 仅报告/延后          |
| P3   | 12   | 2 修复，10 仅报告               |

---

## 3. 问题明细

> 每条均已核验源码。**状态**字段在优化完成后更新为 Fixed / Partially Fixed / Not Fixed / Won't Fix。

### [P0-1] 快照命令路径穿越 + 任意文件复制原语

**位置** `src-tauri/src/commands.rs:1093`（`fs_create_snapshot`）、`:1147-1150`（`fs_seal_snapshot`）、`:1181-1221`（`fs_restore_snapshot`）；TS 入口 `src/core/tools/builtin/local-file-tools.ts:453-479`

**现象** `run_id`、`snapshot_id` 为前端传入的任意字符串，直接 `data_dir.join("snapshots").join(&run_id)` / `join(format!("{snapshot_id}.json"))`，无字符集校验。`fs_restore_snapshot` 还从 metadata JSON 读取 `snapshot_path` 并 `std::fs::copy` 到工作区目标，未校验其位于 snapshots 目录内。

**为什么是问题** 安全（workspace 边界击穿）。攻击链：`write_file`（workspace profile 自动批准）写入伪造 metadata `{"snapshot_path":"/Users/x/.ssh/id_rsa","file_path":"<workspace>/out.txt","post_hash":null}` → `restore_snapshot`（workspace profile 内自动批准）以穿越 `run_id` 指向该文件 → 私钥被复制进工作区 → `read_file` 读出。`create_snapshot`（L1）的 meta 写入还提供任意路径覆盖原语。

**真实影响** 模型可达（工具参数完全由模型控制），无需任何用户审批。

**推荐修复** 三命令对 `run_id`/`snapshot_id` 施加与 `validate_server_id` 相同的字符集校验；`restore` 中校验 `snapshot_path` 必须 canonical 后位于 `<data_dir>/snapshots` 之下。

**修复风险** Low（合法 id 均为 `[A-Za-z0-9._-]` 形态，现有快照功能不受影响）　**本轮处理**：Yes　**验证**：Rust 单测覆盖穿越 id 拒绝、合法 id 通过　**状态**：Fixed

---

### [P1-1] 全部同步命令在主线程执行；`run_command` 冻结 UI 且阻断自身取消

**位置** `src-tauri/src/commands.rs`（35 个 `#[tauri::command]` 同步 fn）；`run_command` 轮询循环 `:813-889`；`src-tauri/src/diagnostics.rs:243-271`

**现象** 经核验 Tauri 2.11.5 宏展开（`tauri-macros-2.6.3/src/command/wrapper.rs:247-251`，非 async fn 默认 `ExecutionContext::Blocking`，`body_blocking` 内联执行）与 wry 0.55.1 WKURLSchemeHandler 分发路径：同步命令在 macOS 主线程内联运行。`run_command` 以 `std::thread::sleep(50ms)` 轮询直至超时（默认 30s，前端可传任意大值），期间主线程被占死；`cancel_command` 也为主线程命令，命令执行期间不可达。`diagnostics_export_zip`（打包可能数百 MB）同理。仓库内 `mcp_stdio.rs` 已示范正确模式（`async fn` + `spawn_blocking`）。

**为什么是问题** 性能 + 可用性 + 取消语义（项目文档明确要求可取消工具执行）。

**真实影响** 长命令执行期间整个窗口无响应、无法停止；此前真机测试命令多为亚秒级故未被察觉（与项目记忆中"native mid-run stop 未验证"一致）。

**推荐修复** `run_command` 与 `diagnostics_export_zip` 改为 `async fn` + `tauri::async_runtime::spawn_blocking`（复用 mcp_stdio 模式）；`timeout_ms` 钳制上限（10 分钟，对齐 `MAX_REQUEST_TIMEOUT_MS`）。其余命令（毫秒级）本轮不动，报告中列明。

**修复风险** Low-Medium（执行线程变化，签名与返回不变；并发语义：`DatabaseState` 已为 `Mutex`，跨线程安全）　**本轮处理**：Yes（两个最重命令）　**验证**：cargo test 全量 + 现有 mcp 模式等价　**状态**：Fixed（第二轮：全部 37 个同步命令已加 `#[tauri::command(async)]` 移出主线程）

---

### [P1-2] `truncate_string` 按 UTF-8 字节边界切片可 panic

**位置** `src-tauri/src/commands.rs:938-944`

**现象** `&s[..max_len]` 为字节切片；`max_len`（50,000/100,000）落在多字节字符（CJK/emoji）中间时 panic。`run_command` 读线程 panic 后输出被 `join().ok()` 静默吞掉；`git_diff` 则在主线程 panic。

**为什么是问题** 健壮性（含大量中文输出的命令是本项目常态场景）。

**推荐修复** 回退到字符边界（`while !s.is_char_boundary(max_len)`）。仓库内 `mcp_stdio_process.rs` 的有界 stderr 排水已示范正确写法。

**修复风险** Low　**本轮处理**：Yes　**验证**：单测覆盖多字节边界　**状态**：Fixed

---

### [P1-3] `run_command` 管道无界读入内存 + 超时无上限

**位置** `src-tauri/src/commands.rs:907-911`（`read_to_string` 全量读）、`:818/844`（`timeout_ms` 未钳制）

**现象** `cat 大文件` / 无限输出命令将整段输出读入 String 后才截断；前端可传任意大超时。同仓库 `mcp_stdio_process.rs:61-71` 已有正确的增量有界读取。

**推荐修复** 有界读取（上限 + 截断标记）；`timeout_ms` 钳制 ≤ 600,000ms。

**修复风险** Low　**本轮处理**：Yes　**验证**：单测 + 现有命令测试　**状态**：Fixed

---

### [P1-4] checkpoint zod 枚举遗漏 `goal` —— Goal 模式检查点静默丢失

**位置** `src/core/context/checkpoint.ts:24`（interface 含 `"goal"`）vs `:49`（`z.enum(["ask","plan","agent"])`）

**现象** 同一业务事实（InteractionMode 全集）两处维护且已漂移。Goal 模式写入的检查点（`mode:"goal"`）在 `normalizeCheckpoint` 解析失败返回 `null`，崩溃恢复/模型切换丢失 Goal 上下文。

**为什么是问题** SSOT 违规已造成数据丢失级缺陷（Goal 是一等模式）。

**推荐修复** 在 `core/providers/tool-registry.ts` 导出 `INTERACTION_MODES` 常量元组，interface 与 zod enum 同源派生。

**修复风险** Low（恢复接口本已声明 goal；属修复预期行为）　**本轮处理**：Yes　**验证**：单测覆盖 goal checkpoint 往返　**状态**：Fixed

---

### [P1-5] `providerReadinessError` 硬编码 5 协议，与 Registry（7 个）漂移

**位置** `src/features/chat/chat-stream.ts:31-41` vs `src/core/providers/adapter-registry.ts:12-41`

**现象** `azure-openai-chat`、`ollama-native` 可被 `createConfiguredAdapter` 构造、可配置，但聊天路径在 `streamAssistant` 之前即以 `chat.protocolUnsupported` 拒绝。

**推荐修复** 就绪检查改为询问 adapter-registry（`createConfiguredAdapter(...) === undefined`），单一事实来源。

**修复风险** Low（对 Azure/Ollama 用户属恢复预期功能；其余 5 协议行为不变）　**本轮处理**：Yes　**验证**：单测　**状态**：Fixed

---

### [P1-6] 浏览器工具为彻底死代码：调用不存在的 Rust 命令

**位置** `src/core/tools/builtin/browser-tools.ts`（invoke `browser_navigate` 等 5 命令）；`src-tauri/src/lib.rs:40-77`（无任何 browser 命令）；`src/runtime/create-runtime.ts:68-71`（capabilities 从不包含 `browserAutomation`）

**现象** 已核验：能力集永不授予、Rust 命令不存在——工具永不出现在模型面前，一旦出现也只会得到 "unknown command"。

**推荐修复** 删除死文件及其引用（无任何行为变化）。

**修复风险** Low　**本轮处理**：Yes　**验证**：typecheck/lint/test 全绿 + registry 内容断言不变（browser 工具本就不可达）　**状态**：Fixed

---

### [P1-7] Web 端实体列表缺 5 个实体 —— SSOT 三处维护已漂移

**位置** `src/core/storage/storage-port.ts:3-26`（21 实体）、`src/core/storage/indexed-db-adapter.ts:7-26`（18 实体）、`src-tauri/src/commands.rs:21-45`（21 实体）

**现象** TS 类型 / Web 适配器运行时守卫 / Rust `validate_entity` 三处手工维护同一集合；Web 侧缺 `skills/backups/notifications/shortcuts/personalization`，写入即抛 "IndexedDB storage does not support entity"。

**推荐修复** ~~TS 侧以单一导出列表派生类型与运行时守卫~~（见下方复核修正）。

**复核修正（实施时核验）**：Dexie schema 恰好只有那 18 个 store，且 5 个"缺失"实体在 TS 侧**无任何写入方**（skills 走目录系统，其余为桌面专属）——Web 端 18 实体列表是**有意的桌面子集**，不是缺陷。为它们加 store 需升 Dexie schema 版本（存储格式变更，本轮禁止）。实际处置：三处列表加互链注释说明维护关系。

**修复风险** Low　**本轮处理**：仅注释互链　**验证**：typecheck/test 全绿　**状态**：Won't Fix（核实为设计如此，已文档化）

---

### [P1-8] 发送链路三个竞态（双重提交 / 停止后污染 / isStreaming 卡死）

**位置与现象**（均已核验）：

- `src/features/chat/send-message.ts:64` 仅以 `isStreaming` 防重入，而该标志要到 `streamResponse → beginConversationStream` 才置位；Agent/Goal 规划期（两次 LLM 往返，各至多 45s）发送按钮完全可用 → 并发双 run。`regenerate`/`editMessage`（`chat-store.ts:201-241`）同理存在 `storage.delete` await 窗口。
- `src/features/chat/stream-ownership.ts:44-53` `finishConversationStream` 仅比较 conversationId 不比较 `startedAt`；停止后旧 run 的持久化尾部（多次 await）会向**同一会话的新 run** 追加旧内容、清空新 `streamingContent`、 prematurely 置 `isStreaming:false`。
- `src/features/chat/stream-response.ts:354-852` 函数体无 try/finally；`persistResponse`/`persistAgentRun` 抛错（磁盘满等）时 `finishConversationStream` 永不执行 → composer 永久禁用。

**推荐修复** 规划期同步置位守护标志（finally 复位）；`finishConversationStream` 增加 `startedAt` 相等校验；`streamResponse` 主体 try/catch/finally。

**修复风险** Medium（触及核心流路径；每项独立小改 + 既有 636 测试回归）　**本轮处理**：Yes　**验证**：新增针对性单测 + 全量回归　**状态**：Fixed

---

### [P1-9] 规划期"停止"不被尊重 —— 取消后仍执行兜底计划

**位置** `src/features/orchestration/orchestration-session.ts:62-78`（planner 抛错一律走兜底计划）、`:129`（取消标志仅在 intake 后检查一次）

**现象** 用户在 "Planning…" 时点停止：planner 流被 abort 抛错，catch 当作"规划失败"返回兜底计划，`prepareTask` 返回 ready，随即执行一个用户已明确取消的完整 Agent run。

**推荐修复** `buildValidatedPlan` 的 catch 分支与计划生成之后各增加一次 `cancelledPreparations` 检查，取消优先于兜底。

**修复风险** Low　**本轮处理**：Yes　**验证**：orchestration 相关单测　**状态**：Fixed

---

### [P1-10] Full Access 下 home 敏感前缀阻断完全失效

**位置** `src/core/tools/builtin/local-file-tools.ts:9-13`（`homeDir()` 在 WebView 中 `process` 未定义 → 返回 `/`，阻断前缀变为 `/.ssh` 等永不匹配）+ `src-tauri/src/commands.rs:634-642`（Rust 阻断表无 home 目录）

**现象** 两层防线都未覆盖 `~/.ssh`、`~/.gnupg`、`~/Library/Keychains`；Full Access profile 下可读写。另：macOS 上 `/var` canonicalize 为 `/private/var`，两层的 `/var` 前缀阻断在 canonical 路径上均失配。

**推荐修复** Rust `validate_path` 阻断表补 home 敏感前缀（canonical 侧生效、唯一可信层）；`/private/var` 见复核修正。

**复核修正（实施时核验）**：`/private/var` 阻断**刻意未加**——macOS `TMPDIR`（`/var/folders/…`）canonicalize 后位于其下，加了会破坏合法的临时目录工作区（既有 Rust 测试即用 temp_dir 作工作区，会立红）；该策略由 TS 层词法 `/var` 阻断承载，代码中已注释说明取舍。

**修复风险** Low-Medium（Full Access 行为收窄至代码注释本就宣称的边界）　**本轮处理**：Yes（Rust home 前缀）　**验证**：Rust 单测（`validate_path_blocks_sensitive_home_locations`）　**状态**：Partially Fixed（home 前缀已阻断；`/private/var` 刻意保留现状并有注释）

---

### [P1-11] `rootForPath` 用朴素 `startsWith` 重复实现路径包含判断（已有 `isInsideRoots`）

**位置** `src/runtime/desktop-storage-adapter.ts:110-119` vs `src/core/security/permission-profiles.ts:27-51`

**现象** 未做反斜杠/尾斜杠规范化，Windows 路径或带尾斜杠 root 静默失配后回落到活动工作区根。属"已有正确实现未复用"。

**推荐修复** 改调 `isInsideRoots`。

**修复风险** Low　**本轮处理**：Yes　**验证**：单测　**状态**：Fixed

---

### [P1-12] "工具调用能力门控"三处实现、三种模式集

**位置** `src/features/chat/stream-response.ts:403`（agent|goal）、`src/core/providers/model-switch-coordinator-impl.ts:87`（!=="ask"，含 plan）、`src/runtime/components/builtin-harness-components.ts:89-96`（仅 agent）

**现象** 同一规则三处漂移。harness 门漏 goal（当前被 stream-response 前置拦截兜住）；coordinator 额外拦截 plan（更严，方向安全）。

**推荐修复** `tool-registry.ts` 导出 `requiresToolCalling(mode)`（agent|goal，以主咽喉 stream-response 为准），stream-response 与 harness 门共用；coordinator 保留更严的 plan 拦截并注释说明（产品语义待定，见未修复清单）。

**修复风险** Low　**本轮处理**：Yes（两处对齐；coordinator 注释化保留）　**验证**：单测　**状态**：Partially Fixed（plan 是否需要 tool-calling 属产品决策，仅报告）

---

### [P1-13] UI 直接实例化 `ModelSwitchCoordinatorImpl` 绕过端口 + core→features 反向依赖 + features 三角值导入环

**位置** `src/app/ChatView.tsx:37,55`（UI import impl 并模块级 `new`，连带 eager `createRuntime()`）；`src/core/context/conversation-summarizer.ts:2`（core → features/chat 值导入，全仓唯一）；`chat-store → send-message → stream-response → run-orchestrated-agent → agent-loop → run-permission → project-store → chat-store` 值导入环

**现象** 分层反转与 ESM 环。环目前靠"绑定均在函数体内惰性使用"侥幸成立；任何模块求值期读取即 TDZ 崩溃。

**推荐修复**（低风险子集）：coordinator 改为组件内懒构造（消除 import 期副作用）；summarizer 改注入 `streamAssistant` 回调（唯一 core→features 边即消失）；环的彻底解耦涉及 store 重构，仅报告。

**修复风险** Low（子集）/ High（全环，不做）　**本轮处理**：Yes（子集）　**验证**：单测 + 全量回归　**状态**：Partially Fixed

---

### [P1-14] 自动验证在无审批门情况下执行工作区定义的检查命令

**位置** `src/core/tools/verification.ts:69-74`（直接 `runtime.storage.runCommand`，绕过 ToolExecutor L3 审批）；触发点 `src/features/chat/agent-run-record.ts:189-210`

**现象** Agent 写入 `package.json` 的 `"scripts": {"check": "curl …| sh"}` 后宣称完成，应用自动执行 `pnpm check`——执行的是 Agent 刚写的任意代码，用户全程无感知、无审批（`ask` profile 下同样发生）。

**为什么是问题** 安全（审批绕过类）。**但**修复需产品决策（路由经 ToolExecutor 会将审批弹窗引入自动验证流程；或 ask profile 跳过自动验证）。

**本轮处理**：第二轮已落地（用户拍板）　**状态**：Fixed（验证命令改经 ToolExecutor 权限门控；需审批档案下返回 skipped 并提示，run 停留 needs_verification）

---

### [P1-15] OpenAI 工具消息序列化三处复制（+CLI/VSCode 两处）

**位置** `src/features/chat/agent-loop.ts:185-211`、`tool-approval-helpers.ts:91-113`、`stream-response.ts:79-100`；`packages/cli/src/agent.ts:66-87`、`extensions/vscode/src/agent-runner.ts:85-121`

**现象** 同一线格式映射（assistant `tool_calls` / `role:"tool"`）五处维护，协议变更需改五处。

**推荐修复** 从 `agent-loop.ts` 导出 `appendToolMessages` 供 features/chat 内两处复用（cli/vscode 跨包复用仅报告）。

**修复风险** Low　**本轮处理**：Yes（features/chat 内）　**验证**：单测　**状态**：Partially Fixed

---

### [P1-16] `approveTool`/`denyTool` 约 140 行同构复制

**位置** `src/features/chat/tool-approval.ts:296-382` vs `:384-464`

**现象** 审批续跑流水线完全同构，差异仅 execute/deny 构建、状态串与两处文案。属同一业务流（审批结果续跑）的真重复。

**推荐修复** 合并为单一 `resolveApproval(pending, outcome, exec)`。**但**该路径为审批咽喉、时序敏感，合并属高回归风险重构。

**本轮处理**：第二轮已落地　**状态**：Fixed（先补 4 条特征测试再合并为 resolveApproval；保留 approve 停止="cancelled" / deny 停止="denied" 差异）

---

### [P2 类（本轮修复项摘要）

- **[P2-1] MCP 陈旧响应使下一请求失败**（`mcp_stdio_process.rs:288-291` id 不匹配即 Err；超时重试场景必现）→ 改为排空陈旧响应继续等待。Fixed
- **[P2-2] MCP `terminate()` 可信号已回收 PID**（`:164-194` vs `:320-323`）→ 增加已回收标志。Fixed
- **[P2-3] `fs_seal_snapshot` 对损坏 metadata 可 panic**（`commands.rs:1167` 对非对象 JSON 索引赋值）→ `as_object_mut` 校验。Fixed
- **[P2-4] `uuid_string` 100µs 碰撞窗**（`commands.rs:1231-1237`）→ 全量纳秒。Fixed
- **[P2-5] worktree `id` 未校验**（`commands.rs:1616-1666`；TS 侧已消毒，Rust 侧应自防）→ 字符集校验。Fixed
- **[P2-6] `diagnostics_export_zip` 目标路径零校验**（`diagnostics.rs:254-271` 唯一不走 validate 的写路径）→ 绝对路径 + 父目录存在 + 非已存在目录。Fixed
- **[P2-7] TS `uuid()` 7 份相同实现**（各 provider adapter）→ 收敛至 `openai-chat-utils.ts`。Fixed
- **[P2-8] SSE 解析器重复**（anthropic `sseEvents` ≡ openai-responses `responseSseEvents`，逐行相同）→ 共享。Fixed
- **[P2-9] Ollama HTTP 错误映射弱分叉**（丢 401/403→AUTH_FAILED 与内容分类）→ 复用 `mapHttpError`。Fixed
- **[P2-10] `RISK_LEVELS`/`TOOL_SOURCES` 守卫数组重复声明**（tool-approval vs tool-registry）→ 导出复用。Fixed
- **[P2-11] 会话导入 zod 静默丢弃字段**（`conversation-import.ts` 缺 `projectId/pinned/activeSkills/summaryMetadata` 等，导出→导入丢项目归属）→ 补齐 optional 字段。Fixed
- **[P2-12] `AgentRunSummary` 验证 effect 无 catch/无取消**（`AgentRunSummary.tsx:59-79`，invoke 拒绝即永久 loading + unmount 后 setState）→ cancelled 标志 + catch。Fixed
- **[P2-13] `STRUCTURED_RESPONSE_TIMEOUT_MS`/`DEFAULT_MAX_CONTEXT_TOKENS`/0.75 阈值等多处内联重复** → 提升为具名共享常量。Fixed
- **[P2-14] `Sidebar` localStorage 损坏即崩** —— **复核为误报**（`readExpanded` 已有 try/catch 回退），从修复清单移除。
- **[P2-15] 本地日期戳 3 份手写**（file-log-sink / diagnostics-export / usage-analytics；与诊断导出按日匹配日志文件直接相关，必须一致）→ 共享 util。Fixed

### [P2 类（仅报告/延后）

- **[P2-R1] 整库订阅重渲染风暴**：`App.tsx:31-39`、`Sidebar.tsx:51-71`、`ChatView.tsx:174-202` 无 selector 整库订阅；流式期间 60fps 级重渲染 Sidebar 全列表。修复面大（组件级 selector 化），列入后续批次。
- **[P2-R2] 全局 `isStreaming` 禁用所有会话 composer**：其他会话无法输入（UX 决策）。
- **[P2-R3] 流式每帧强制滚动到底**（`ChatView.tsx:261-263`），用户无法上翻（UX 决策）。
- **[P2-R4] Ask 模式无超时**（`stream-response.ts:174`），挂死连接只能手动停止；补默认超时可能误伤慢模型，需产品定义。
- **[P2-R5] 删除/清空会话不停流** → 孤儿 DB 行与 token 消耗。
- **[P2-R6] `selectConversation` 加载竞态**（Dexie 查询与立即发送的窄窗口）。
- **[P2-R7] `db_query` 校验缺口**（CTE 前缀 DML 可执行、多语句尾部静默丢弃、PRAGMA 全放行；仅 WebView 可达）。
- **[P2-R8] 遗留 `providers.api_key` 列**（`storage.rs:29-34`；旧版本明文残留可被 `SELECT` 读出）建议一次性清洗。
- **[P2-R9] CSP 为 null**（`tauri.conf.json`）纵深防御缺失；现有渲染链未发现注入向量。
- **[P2-R10] `fs_write_file`/`fs_apply_patch` 非原子写**（快照+restore 缓解）；快照整文件读入内存无上限。
- **[P2-R11] TOCTOU**：校验与打开间 symlink 置换窗口（需 `O_NOFOLLOW` 级修复）。
- **[P2-R12] MCP 退出后仍占注册表（僵尸）**、`request()` 全超时持锁串行化 `status()`。
- **[P2-R13] `run_command` 继承全量环境变量与 stdin**（与 MCP 子进程的严格白名单不一致，或为有意设计）。
- **[P2-R14] 架构测试盲区**（`architecture.test.ts` 正则不匹配动态 import；`src/components` 扫描路径不存在），扩展正则前需先处理 `transports.ts`/已注入 seam 的默认实现，否则 CI 立红。

### [P3 类（本轮修复项）

- **[P3-1] `use-runtime` 模块级 eager `createRuntime()`** → 懒初始化（41 个调用点不变）。Fixed
- **[P3-2] `mcp-store` 越层引用 adapter 内部 helper `publicMcpToolId`** → 移至 types 模块导出。Fixed

### [P3 类（仅报告）

命名/小重复/一致性：`ModelCapabilities` 形状三处声明、localStorage key `"evir-workspace-current"` 双处定义、Tauri 事件名裸字符串、验证状态联合命名重叠、`linkAbort` 模式 4 份、VSCode 独立 i18n 目录、`maxIterationsReached` 映射 2 份、cli/vscode `pathIsInside` 复制、消息 zod schema 与 `db.ts` 接口平行维护、`stream-response.ts` 耦合枢纽（852 行）、Dexie 记录型别作领域词汇表（34 文件 type-only 引用）、`db.ts` 侧 `EvirDB` 句柄类型外泄至 features。

---

## 4. 值得保留的既有优点（审计确认，避免误伤）

- **密钥链路干净**：API Key 全程 Keychain 端口、DB 恒存空串、共享 providers.json `deny_unknown_fields` 拒收密钥（有测试）、诊断导出经 `redactLogValue`。
- **工具调用单一咽喉**：agent-loop 全量经 `ToolExecutor.execute(approved=false)`；`approved=true` 仅存于用户批准路径与 MCP 测试台；模式限制（ask=L0/plan=L1）先于且独立于 profile 执行。
- **MCP 子进程管理优于平均**：env 白名单 + `env_clear`、独立进程组、SIGTERM→2s→SIGKILL、Drop 兜底、有界 stdout/stderr、超时钳制，全部有测试。
- **`shared_provider_profiles_write` 为原子写范本**：临时文件 0o600 + fsync + rename（Windows `MoveFileExW`）。
- **路径校验核心扎实**：Rust canonicalize 至最近存在祖先 + 阻断前缀 + 分量级包含检查，含 symlink 逃逸与 `/tmp` 别名测试。
- **无 panic 文化**：非测试代码仅启动处一个 `expect`；全部锁中毒映射为显式错误。
- **`streamAssistant` 的 AbortController 生命周期、`stream-ownership` 的会话可见性守卫、调度器清理（activeSchedulers finally）**均为正确实现。

---

# Optimization Plan

> 每批独立可测试、可回滚；批次内修改保持公共接口、持久化格式、事件与命令名不变（除注明"恢复预期行为"的漂移修复项）。

### Batch 1 — Rust 安全与健壮性（commands.rs / diagnostics.rs / mcp_stdio_process.rs）

- 快照/worktree/诊断导出路径校验；restore 的 `snapshot_path` 包含检查；`truncate_string` 字符边界；管道有界读 + 超时钳制；seal 的 `as_object_mut`；`uuid_string` 全纳秒；`run_command`/`diagnostics_export_zip` 异步化（spawn_blocking 模式）；MCP 陈旧响应排空 + PID 回收守卫；阻断表补 home 前缀与 `/private/var`。
- 测试：cargo fmt/clippy/test + 新增单测。**风险 Low-Medium**。

### Batch 2 — TS 安全与死代码（runtime / storage）

- `rootForPath`→`isInsideRoots`；实体列表 SSOT 派生；删除 browser-tools 死代码。
- 测试：vitest 相关套件。**风险 Low**。

### Batch 3 — TS SSOT 与重复收敛（core/providers / features/chat / orchestration）

- `INTERACTION_MODES`/`requiresToolCalling` 统一（checkpoint goal 枚举、harness 门对齐）；`providerReadinessError` 走 registry；`uuid()`/SSE/错误映射/`RISK_LEVELS` 收敛；`appendToolMessages` 导出复用；常量提升；导入 zod 补字段；日期戳 util。
- 测试：vitest 全量（636 基线）。**风险 Low**。

### Batch 4 — 发送链路竞态与生命周期加固

- 规划期同步忙标志（send/regenerate/editMessage 共用）；`finishConversationStream` startedAt 守卫；`streamResponse` try/catch/finally；规划期取消复查；`AgentRunSummary` effect 守卫。（Sidebar localStorage 一项复核为误报，未做）
- 测试：新增针对性单测 + 全量。**风险 Medium**。

### Batch 5 — 架构小修（低风险子集）

- `conversation-summarizer` 依赖反转（注入 `streamAssistant`）；`use-runtime` 懒初始化；ChatView coordinator 懒构造；`publicMcpToolId` 归位。
- 测试：vitest 全量。**风险 Low**。

### 明确不在本轮（Won't Fix / 延后）

自动验证审批门（P1-14，产品决策）、done-when 命令门控（同）、L2 审批策略统一（设计决策）、approveTool/denyTool 合并（先补特征测试）、全量 selector 化（P2-R1）、features 环彻底解耦、日志体系（本轮豁免）。

---

## 5. 执行结果总览（优化完成后）

| 批次    | 内容                                                                                    | 状态 |
| ------- | --------------------------------------------------------------------------------------- | ---- |
| Batch 1 | Rust 安全与健壮性（13 项修复 + 6 个新单测）                                             | 完成 |
| Batch 2 | TS 安全与死代码（browser-tools 删除、rootForPath、实体注释互链）                        | 完成 |
| Batch 3 | TS SSOT 与重复收敛（14 项 + 5 个新测试）                                                | 完成 |
| Batch 4 | 发送链路竞态与生命周期加固（6 项 + 2 个新测试）                                         | 完成 |
| Batch 5 | 架构小修（summarizer 依赖反转、use-runtime 懒初始化、coordinator 懒构造、tool-id 归位） | 完成 |

**最终状态汇总**：P0 修复 1/1；P1 修复 10、部分修复 4（P1-1/10/12/13）、不修 2（P1-14 自动验证审批门、P1-16 approveTool/denyTool 合并——均见报告说明）；P2 修复 13、误报 1（P2-14）、其余报告项；P3 修复 2、其余报告项。

**审计后复核修正（第一轮自查发现并已更正）**：

1. P1-7 实体列表"漂移"实为有意的桌面子集（详见该条目）→ Won't Fix。
2. P2-14 Sidebar localStorage 崩溃为误报（已有 try/catch）。
3. `/private/var` 阻断与 macOS TMPDIR 工作区冲突，刻意不加并注释（详见 P1-10）。
4. 0.75 阈值"重复"（context-budget-manager vs coordinator）分母语义不同（可用量 vs 原始 max），非真重复，不合并。
5. 既有测试 `response_ids_cannot_cross_request_ownership` 断言的正是 P2-1 要修的旧契约；按新契约重写并新增正向用例（排空陈旧响应后成功），"响应不跨请求归属"的安全属性由更强的断言保留。

---

## 6. 第二轮执行结果（2026-08-28，A–D 组清偿）

**第二轮修复**（详见 CHANGELOG 第二轮章节）：

- **P1-1** 其余 37 命令异步化（→Fixed）；**P1-14** 自动验证过 ToolExecutor（→Fixed）；**P1-16** approve/deny 合并（→Fixed）。
- **P2-R1** selector 化+memo（→Fixed）；**P2-R2** 按会话门控 composer（→Fixed）；**P2-R3** 贴底滚动（→Fixed）；**P2-R4** Ask 300s 超时（→Fixed）；**P2-R5** 删除/清空防孤儿（→Fixed）；**P2-R7** db_query readonly 闸口+PRAGMA 白名单+多语句拒绝（→Fixed）；**P2-R8** api_key 清洗 migration 3（→Fixed）；**P2-R9** CSP 上线+构建+启动冒烟（→Fixed）；**P2-R10** 原子写+分块快照/哈希+读取上限（→Fixed）；**P2-R11** TOCTOU 写侧缓解（→Partially，读侧 openat 级未做）；**P2-R12** MCP 剪枝+锁重构（→Fixed）；**P2-R13** stdin null（→Partially，env 继承为 PATH 所需、有意保留）；**P2-R14** 架构测试正则+transports 注入（→Fixed）。
- **产品策略**：L2 审批门对齐、工具能力模式集统一（plan/goal/agent）。
- **新决策记录**：done-when 权限不足 → manual 且阻止自动达成；自动验证权限不足 → skipped 停留 needs_verification。
- **意外收获**：worktree 集成测试暴露 `git apply --3-way` 拼写错误（`--3way` 才对）——真实合并从未成功过，已修复。
- **仍不做/遗留**：P2-R6 selectConversation 窄窗口竞态；TOCTOU 读侧；linkAbort/ModelCapabilities（非真重复）；签名公证（非阻塞待凭据）；深度真机交互冒烟（缺屏幕录制权限）。

**第二轮基线**：vitest 107 文件/658 用例；cargo 35 用例；e2e 38/0 失败；全部可选门禁绿。
