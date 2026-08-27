# Project / Chat / Agent 交互重构设计

> 2026-08-27 · 本文档是本次 Desktop 核心产品体验重构的实现设计。事实来源：db3f225 时的真实代码。

## Current State

- **Workspace**：全局单值。`workspace-store` 写 localStorage（`evir-workspace-current`），`runtime.getWorkspaceRoot()` 与 `desktop-storage-adapter.selectedWorkspace()` 各自直接读 localStorage。工具在执行期动态解析 root；无 root 时所有本地工具返回 `path_blocked`。Conversation 与 workspace 无任何关联。
- **Mode**：`InteractionMode = ask | plan | agent`，存于 chat-store（会话级临时状态）。`MODE_TOOL_RISK_LIMITS = { ask: L0, plan: L1, agent: L4 }` 在 Tool Registry/Executor 层强制。桌面 ModeSwitcher 只露 ask/agent（plan 为内部阶段）。
- **Permission**：仅有风险分级一次性审批（L3/L4 → PendingToolApproval），无用户可配置档位。
- **Sidebar**：Pinned + Recent 两个会话分区；无项目概念；`WorkspaceSelector` 在 ChatView 头部。
- **Orchestration**：真实存在（brief/clarify/plan DAG/scheduler/pause/resume/checkpoint/verification），入口挂在 agent 模式发送链路。
- **能力门控**：`modelCapabilities.toolCalling` 驱动 ModeSwitcher 隐藏 Agent + harness capability-gate 拦截。

## Product Problems

1. Chat/Agent/Workspace 混在顶部：用户先输入任务再选目录，概念倒置。
2. Conversation 无归属：切工作区后历史会话与目录关系靠用户记忆。
3. Ask/Agent 是应用级入口，而「是否操作本地项目」本质是上下文（有无 Project）属性。
4. Plan 不是一等模式；Permission 不可配置，L3 全部逐次审批噪声大。
5. 文件夹改名/移动后 workspace 失效，只能重选，历史无法延续。

## Target Information Architecture

```
Sidebar                 │  Main
────────────────────────│──────────────────────
PROJECTS                │  Project Thread:
  ▾ Evir                │    Composer: [Mode][Permission][Model] 附件/Skill 发送/停止
      重构 Sidebar      │    （无目录选择——目录来自 Project）
      优化 Runtime      │  Standalone Chat:
  ▸ Chorus              │    Composer: [Model] 附件/Skill（无 Mode/Permission）
CHATS                   │
  + New Chat            │
  Transformer 是什么    │
```

- **Project 决定在哪里工作**；**Chat（Standalone）只是聊天**；**Thread 是连续任务上下文**；**Mode 决定 Agent 怎么工作**（agent/plan/goal，仅 Project Thread）；**Permission 决定自动程度**；**Model 决定由谁工作**。六者正交。
- 顶部不再有 Ask/Agent 一级切换；`WorkspaceSelector` 从 ChatView 移除，目录只来自 Sidebar → Project。

## Domain Model

```ts
// src/core/storage/db.ts（Dexie v8 + EntityName "projects" + Rust STRUCTURED_ENTITIES）
interface ProjectRecord {
  id: string;                 // 身份（crypto.randomUUID），绝不使用 path
  displayName: string;        // Evir 内显示名；默认目录 basename
  nameIsCustom: boolean;      // 用户改过名后为 true，rebind 不覆盖
  rootPath: string;           // 当前绑定位置（用户可见路径）
  canonicalRootPath: string;  // realpath 归一化（去 symlink/..；大小写按原样保留，比较时小写化）
  pinned?: number;
  permissionProfile: "ask" | "workspace" | "full";  // 默认 "ask"
  additionalAccessRoots: string[];                  // canonical
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

// ConversationRecord 增加：
projectId?: string | null;    // null/缺省 = Standalone Chat
```

- 归一化在 **Project Store（TS 层）**完成：`path.normalize` + `fs.realpath`（经 runtime.storage 新增 `realPath` 能力，失败时退回 normalize 结果）。不依赖 React 层字符串比较。
- 同一 canonicalRootPath 只允许一个 Project（创建/重绑时校验，命中则打开既有 Project）。

## State Ownership

| 状态                  | Owner                                               | 持久化                                            |
| --------------------- | --------------------------------------------------- | ------------------------------------------------- |
| projects 列表/CRUD    | `features/projects/project-store.ts`（zustand）     | structured storage `projects`                     |
| 当前 Project 选择     | project-store `currentProjectId`                    | localStorage `evir-project-current`（纯 UI 选择） |
| 活动运行 root 隔离    | `core/workspace/active-root.ts`（runRoot override） | 无（运行期）                                      |
| 会话归属              | ConversationRecord.projectId                        | structured storage                                |
| mode/permission 选择  | chat-store（现有 mode）+ project.permissionProfile  | mode 会话级；profile 属 Project                   |
| Sidebar 折叠/排序偏好 | localStorage（`evir-sidebar-*`）                    | 轻量 UI 偏好                                      |

**单一真相源**：运行时 root = `runRootOverride ??（当前 Project.rootPath）`。legacy `evir-workspace-current` 只在迁移期读取（见 Migration），一旦存在任何 Project 即不再参与解析。

## Workspace Source of Truth（B6）

新模块 `src/core/workspace/active-root.ts`：

```ts
setRootResolver(fn: () => string | null): void      // workspace/project store 注册
setRunRoot(root: string): void; clearRunRoot(): void  // 运行期覆盖（先保存前值）
getActiveWorkspaceRoot(): string | null              // override > resolver()
```

- `create-runtime.getWorkspaceRoot` 与 `desktop-storage-adapter.selectedWorkspace` 都改为调用 `getActiveWorkspaceRoot()`（迁移期 fallback legacy key）。
- **Run 绑定**：`runAgentLoop` 启动时立即捕获 `getActiveWorkspaceRoot()` → `setRunRoot(captured)`，finally 中恢复。审批续跑（`executeApproved`）同样以其保存的 root 绑定。Sidebar 切换只改变 resolver，不影响进行中的 Run。
- **作用域根**：工具路径校验（`validateWorkspacePath`）从「单一 root」升级为 `roots = [projectRoot, ...additionalAccessRoots]`；`full` 档 roots 不设限（见 Permission）。

## Conversation Association（B2）

- `createConversation(providerId, modelId, projectId?)`；`send-message` 用「当前上下文」决定：打开了 Project → projectId；Standalone → null。
- 有效模式由归属推导：`effectiveMode = conversation.projectId ? storeMode(agent|plan|goal) : "ask"`。Stream/loop 用 effectiveMode（web 恒 ask 不变）。Standalone 不注册 workspace 工具（ask=L0 天然满足）。
- 旧 Conversation 一律 `projectId = null`（Standalone），绝不按旧 workspace 猜测归属。

## Folder Relocation（B3）

- Project 打开/选中时校验目录存在（`runtime.storage` 新增 `pathExists`，Rust `fs` 已有 stat 能力可复用 `fs:allow-stat`）。
- 缺失时：Sidebar 项目行显示 `Folder not found` 徽标；主区 Project 视图显示 Locate Folder 引导。重绑 = 调既有目录选择器选新目录 → 校验 canonical 去重（若命中**其他** Project 则提示并拒绝）→ 只更新 `rootPath/canonicalRootPath`（及未自命名的 displayName），**保留 id/threads/permission/run history**。
- Remove Project：仅删除 `projects` 实体；其 threads 迁移为 Standalone（`projectId=null`），数据零丢失；绝不触碰磁盘。

## Permission Matrix（B7）

新模块 `src/core/security/permission-profiles.ts`，输入 `(profile, toolRisk, toolName, resolvedPath|null, roots)` 输出 `auto | approval`：

| 场景                              | ask（默认）      | workspace  | full                         |
| --------------------------------- | ---------------- | ---------- | ---------------------------- |
| Project 内读/搜索/git 只读（≤L1） | auto（现状）     | auto       | auto                         |
| Project 内写/命令（L2/L3）        | approval（现状） | **auto**   | auto                         |
| additional roots 内               | approval         | auto       | auto                         |
| roots 外路径                      | blocked→approval | approval   | **auto**（full 即解除边界）  |
| 首次开启                          | —                | 项目内确认 | **明确确认对话框，绝不默认** |

- 接入点：`tool-executor.validateToolForExecution` 在 L3 判定前先问 permission-profiles（需要 runtime 携带 `permissionContext`，由 agent-loop 组装 per-run runtime 时注入 `{profile, roots}`）。Plan 模式在 profile 之前仍按 `MODE_TOOL_RISK_LIMITS` 拦截写工具（Mode Capability 优先于 Permission）。
- `workspace/full` 档下 L3 工具不再产生 PendingToolApproval；审计日志记录 `permission.auto-approved`（profile+tool+inRoot）。

## Mode Matrix

| Mode  | 可用上下文                            | 工具边界                 | 说明                                                      |
| ----- | ------------------------------------- | ------------------------ | --------------------------------------------------------- |
| ask   | Standalone Chat / Project Thread 皆可 | L0（无本地工具）         | 纯聊天                                                    |
| plan  | 仅 Project Thread                     | L1 只读（Registry 强制） | 一等模式；完成后 Execute Plan                             |
| goal  | 仅 Project Thread                     | 同 agent + 编排          | 长期目标：objective + doneWhen，复用 orchestration 全链路 |
| agent | 仅 Project Thread                     | L1–L3 + permission       | 默认                                                      |

- Execute Plan：plan run 结束后消息区提供按钮 → 同 Thread 同 Project，切 agent 模式发送「执行上面的计划」（复用 sendMessage，上下文连续）。
- Goal：`TaskBrief` 增加 `doneWhen?: string[]`；Goal 模式输入 = Objective（首行）+ Done when（可选拆行）。UI 在 TaskWorkbench 顶部显示 Objective/Done-when 勾选进度；暂停/恢复/停止复用现有 orchestration 动作。不新建运行时。

## Sidebar UX（B4/B5）

- 分区：`PROJECTS`（折叠组，每个 Project 行 + 嵌套 thread 列表）与 `CHATS`。Standalone 复用现有 `.conversation-item`（e2e 兼容）。
- Project 行：展开/折叠、active 态、`Folder not found` 徽标；hover 动作：New Task / Pin / Rename / Locate（缺失时）/ Permission / Remove。Context Menu 仅在后续迭代（hover actions 已覆盖本批）。
- 排序：Pinned 优先 → lastOpenedAt/updatedAt desc；排序切换 Recent/Name 两档，localStorage 记忆。
- 搜索：单输入框过滤 displayName/basename/path/thread/chat 标题（现有会话搜索已移除，无全文索引，不新建）。
- 组件拆分：`Sidebar.tsx`（骨架+状态）＋ `SidebarProjectItem.tsx` ＋ `SidebarConversationItem.tsx`（抽出现有行渲染）＋ `SidebarSearch.tsx`。

## Model Empty / Capability States（B11）

- 无 Provider：主区现有 provider-empty 态保留并升级文案（Configure a model to start using Evir.）；Composer 禁用发送并提示；Sidebar 可浏览。
- 有模型无 Project：默认 New Chat（不弹 Picker、不强迫建 Project）。
- 无 toolCalling：Project 视图可浏览历史；Mode 控件整体禁用并显示 `Current model does not support tool calling.` + Change Model；goal/plan/agent 均不可发。发送前拦截（沿用 capability-gate），不运行后才报错。

## Migration

1. **Conversation**：无 projectId → Standalone（默认即所得，无写迁移）。
2. **Workspace**：`evir-workspace-current` 保留为迁移 fallback（无任何 Project 时仍解析为 root，保证老用户体验不断裂）；出现第一个 Project 后永久退出解析。`recentWorkspaces` 不再消费。
3. **Storage**：Dexie `version(8)` 增加 `projects` 表；Rust `STRUCTURED_ENTITIES` 增加 `"projects"`（generic KV，无 SQL 迁移）。

## Implementation Batches

1. Project Domain + Storage（db.ts/EntityName/Rust allowlist/ProjectRecord/project-store CRUD/去重）
2. Conversation 关联（createConversation(projectId)、chat-store 选择、effectiveMode 推导）
3. 文件夹验证 + Locate/Rebind（pathExists/realPath runtime 能力、not-found 态、重绑保 id）
4. Sidebar Projects/Chats（新骨架、hover 动作、空态）
5. Pin/Rename/Sort/Search
6. active-root 单一真相 + Run root 绑定（agent-loop/审批续跑/desktop-adapter/create-runtime）
7. Permission Profiles + Additional Access（permission-profiles 模块、executor 接入、Project Permission UI、full 首开确认）
8. Composer/Mode/Permission UI（移除 WorkspaceSelector、composer 紧凑控制区、plan/goal 入口）
9. Plan 一等模式 + Execute Plan
10. Goal Mode（doneWhen + 目标面板，复用编排）
11. 模型空态/能力门控完善
12. 兼容（Web/VSCode/CLI 不受影响校验）+ 文档 + 测试补全

## Regression Plan

- 新增单测：project CRUD/去重/重绑保 ID/threads 保留/remove 不删磁盘/folder-missing；conversation 关联与 effectiveMode；active-root 优先级与 run 隔离；permission 三档矩阵 + plan 只读优先；goal brief 字段。
- 更新 e2e：workspace 用例改为 Project 流；新增 Add Project → New Task → agent cwd；folder-missing → rebind 流。
- 全量：`pnpm check` + e2e/ui/visual/a11y + benchmark + builds + cargo test/clippy。
