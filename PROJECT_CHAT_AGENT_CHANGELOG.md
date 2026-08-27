# Project / Chat / Agent 重构变更记录

> 2026-08-27 · 基于 db3f225 的 Desktop 核心产品体验重构。设计见 `docs/project-chat-agent-redesign.md`。

## 产品模型

- **Project 是稳定实体**（UUID 身份，canonical real path 去重；Folder Path 只是当前绑定位置）。新增 `projects` 结构化实体（Dexie v8 + SQLite generic KV + Rust allowlist），完整生命周期：Add（原生 Folder Picker + realpath 去重）/ Open / Expand / New Task / Pin / Rename（只改显示名，绝不改磁盘目录）/ Sort（Pinned→Recent / Name）/ Search / Remove（只解绑，threads 迁为 Standalone，零数据丢失）/ Locate（目录改名或移动后重绑：保留 ID、threads、权限、run 历史；自定义名称不被覆盖）。
- **Conversation 显式关联 Project**（`projectId: string | null`）。旧会话一律 Standalone，绝不按旧全局 workspace 猜测归属。
- **Standalone Chat = 纯聊天**（`projectId=null` → effectiveMode 恒 ask，无本地工具、无 Shell/Git）。**Project Thread = Agent/Plan/Goal**。顶部 Ask/Agent 一级切换移除。
- **Composer 不再选目录**：WorkspaceSelector 从产品移除；目录只来自 Sidebar → Project。Composer 保留 Mode（项目线程内 Agent/Plan/Goal 紧凑切换）/ Model / 附件 / Skill / 发送停止。
- **Mode 与 Permission 正交**：Plan 只读是 Mode Capability（L1 上限，在 Tool Registry/Executor 层强制，Full Access 也不能覆盖）；Permission 是独立档位。

## Workspace 单一真相与 Run 隔离

- 新 `core/workspace/active-root.ts`：运行期覆盖栈 + 可注册 resolver（项目根 > 迁移期 legacy `evir-workspace-current`）。`runtime.getWorkspaceRoot()` 与 desktop-storage-adapter 全部改走该模块——不再有两处读 localStorage。
- **Run 绑定**：agent-loop 启动即捕获 root+权限上下文并压栈，finally 恢复；审批续跑按 PendingToolApproval 携带的 workspaceRoot 重绑。**Sidebar 切换项目绝不污染活动 Run。**
- 多根/全访问路径：desktop adapter 按命令路径解析包含它的 root 传给 Rust；Rust `validate_path_in_workspace` 放宽 root==文件本身（仅精确匹配），系统目录黑名单不变。

## Permission Profiles（Project 级）

- `ask`（默认）：L3+ 逐次审批（原行为）。
- `workspace`：项目根 + Additional Access Roots 内的普通开发行为（read/write/edit/常规命令/git status/diff）自动执行，出根仍审批。
- `full`：不逐项确认（含项目外），首次开启必须显式确认，绝不默认。Tool Schema 校验、路径归一化、取消、超时、Run State、恢复安全、OS 权限、模型能力全部保留。
- 判定在 `core/security/permission-profiles.ts`（统一 Permission Engine 的一部分，接入 tool-executor；带 `permission.auto-approved` 审计日志；词法 `..` 归一化防目录穿越）。Additional Access Roots 在项目权限面板可增删。

## Plan / Goal 一等模式

- **Plan**：composer 可选；L1 只读在 Registry 层强制；run 记录持久化 `mode`；plan run 完成后提供 **Execute Plan**（同 Project 同 Thread 切 Agent 执行，上下文连续）。
- **Goal**：`InteractionMode` 新增 `goal`（工具档位同 agent）；输入支持 `Done when:`/`完成条件：` 标记行解析为完成条件（TaskBrief.doneWhen）；TaskWorkbench 顶部目标横幅展示 Objective + 完成条件勾选；暂停/恢复/停止/验证全部复用现有 orchestration。

## 模型状态

- 无模型：主区引导 Configure a model（现有空态），Sidebar 可浏览。
- 有模型无 Project：默认 New Chat，不弹 Picker 不强迫建项目。
- 无 tool-calling：项目线程可浏览历史；Mode 组禁用并显示 “当前模型不支持工具调用” + Change Model，发送前拦截。

## 修复的问题（重构中发现）

- 自动工作区验证（上一轮引入）会误伤 answer-only 任务（把纯回答 run 标为 failed）：`finalizeAutomaticVerification` 现在只对真正发生写/命令变更的 run 触发；组件层（AgentRunSummary）不再改写 run 记录，仅展示。
- AgentRunSummary 依赖旧 workspace-store（原先由已移除的 WorkspaceSelector 触发加载）：改用响应式 `useActiveWorkspaceRoot()`。

## 迁移与兼容

- Conversation：无 projectId → Standalone（默认即所得）。
- Legacy workspace：无任何 Project 时仍解析为 root（老用户体验不断裂）；出现第一个 Project 后永久退出。
- Web：纯 Chat 不变，无 Project/目录/Full Access/桌面工具。VS Code / CLI 不受影响（共享 Domain 仅新增可选字段）。
- e2e：workspace 用例改为「legacy workspace 在无 selector 下仍可跑项目模式」断言；首运行断言更新为新信息架构。

## 存储

- `projects` 实体：storage-port EntityName、Dexie `version(8)`、IndexedDBAdapter 映射、Rust `STRUCTURED_ENTITIES`、`fs_real_path` 新命令。
- UI 偏好（排序、展开状态）走 localStorage；Project 数据全部走 StoragePort。
