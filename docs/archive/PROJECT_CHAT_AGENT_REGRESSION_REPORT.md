> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# Project / Chat / Agent 重构回归报告

> 2026-08-27 · 基线 db3f225 → 本次重构工作树。所有命令在仓库根目录实际执行。

## 执行结果总览

| 门禁          | 命令                                              | 结果                                                 |
| ------------- | ------------------------------------------------- | ---------------------------------------------------- |
| 格式          | `pnpm format:check`                               | ✅ 通过                                              |
| Lint          | `pnpm lint`                                       | ✅ 0 错误 0 警告                                     |
| 类型          | `pnpm typecheck`                                  | ✅ 0 错误（strict）                                  |
| 单元测试      | `pnpm test`                                       | ✅ 97 文件 / **600 通过** / 0 失败（基线 593 → +7）  |
| 核心流程 E2E  | `pnpm test:e2e`（web + desktop）                  | ✅ **35 通过** / 9 平台不适用跳过 / 0 失败           |
| UI 矩阵       | `pnpm test:ui`                                    | ✅ web + desktop 双语双主题响应式全过                |
| 视觉基线      | `pnpm test:visual`                                | ✅ 6/6（会话态基线因侧栏重构**有意更新**，其余未动） |
| 无障碍        | `pnpm test:a11y`                                  | ✅ 18/18                                             |
| Rust          | `cargo test --manifest-path src-tauri/Cargo.toml` | ✅ **19 通过** / 0 失败                              |
| Web 构建+预算 | `pnpm build:web` + benchmark                      | ✅ 初始 JS gzip 277.52 KiB ≤ 350                     |
| 桌面构建+预算 | `pnpm build:desktop:frontend` + benchmark         | ✅ 2691.55 KiB ≤ 15 MiB；36 Skill chunk pass         |
| CLI           | `pnpm --dir packages/cli check`                   | ✅                                                   |
| VS Code       | `pnpm --dir extensions/vscode check`              | ✅                                                   |

## 新增测试覆盖（高风险逻辑优先）

- **Project 生命周期**（`project-store.test.ts`，8）：创建/canonical 去重（同 realpath 重开不重建）/缺目录拒绝/重绑保 ID+保 threads+自定义名/重绑撞他人目录拒绝/Remove 只解绑不删数据/folder-missing 状态/权限档位+额外根去重。
- **effectiveMode**（`conversation-mode.test.ts`，5）：项目线程保留 agent/plan/goal；有项目后 Standalone 恒 ask；legacy workspace 过渡期行为；doneWhen 解析（中英文标记、编号/圆点列表、空行截断、上限）。
- **active-root**（3）：运行期覆盖优先于 resolver（切项目不污染活动 Run）；嵌套压栈恢复；legacy 回退。
- **Permission 矩阵**（`permission-profiles.test.ts`，9）：只读永远自动；ask 恒审批；workspace 根内自动/根外审批/无路径审批；full 全自动但 **Plan 只读优先于 Full Access**（mode gate 先于 profile）；approved 短路；路径边界（`/evirage` 不算 `/evir` 内）；词法 `..` 穿越被归一化拦截；参数路径提取。
- 更新：agent-loop（pendingApproval 携带 workspaceRoot）/architecture（goal 模式与 i18n 键完整性）/finalizeAutomaticVerification（只对真实变更的 run 触发）。
- E2E 更新：首运行信息架构断言（无模式组、Add project/New chat 可见）；workspace 用例改为 legacy-workspace 无 selector 仍可跑项目模式；工作台/证据用例补 legacy 作用域；Ask 技能门控用例适配隐式 ask。

## 重构中发现并修复的回归

1. 数据层自动验证误伤 answer-only 任务（fixture 工作区含 package.json → `pnpm check` 失败 → 纯回答 run 被标 failed）。修复：仅当 run 含成功的写类工具调用才触发工作区检查器；组件层不再改写记录。
2. AgentRunSummary 依赖旧 workspace-store 初始化（原先靠已移除的 WorkspaceSelector 触发）。修复：`useActiveWorkspaceRoot()` 响应式来源。

## NOT RUN（诚实声明）

- **原生桌面 GUI 验证**：新 Sidebar（Projects/Chats/搜索/排序/权限面板）、真实 NSOpenPicker 添加项目、目录改名后 Locate 重绑、Goal 横幅的端到端原生操作未在 Tauri 实机执行（本轮为浏览器 desktop-mode + 单测/E2E 覆盖）。此前经验：dev 构建无 bundle 身份时 computer-use 仅 AXPress 可用，完整原生走查需单独一轮。
- **真实 Provider**：Goal 模式/Plan Execute Plan 在真实模型下的行为未验证（fixture 只能证明管线连通）。
- `pnpm build:desktop`（完整 DMG）本轮未重复执行（`build:desktop:frontend` + cargo test 覆盖编译面；DMG 流程上一轮已验证）。
- `cargo fmt --check` / `cargo clippy` 未运行（Rust 改动仅新增 `fs_real_path` 命令与 `validate_path_in_workspace` 放宽，cargo test 编译通过）。

## Remaining Issues

- Sidebar 项目行暂为 hover 动作（规格允许），右键 Context Menu 未做（规格标注可后续迭代）。
- 会话全文搜索未建索引（规格允许复用已有索引；现有索引不存在）。
- Standalone 会话在 legacy workspace 过渡期仍可跑 agent（有意的迁移兼容）；创建第一个 Project 后自动收紧。
- 旧 WorkspaceSelector.tsx 文件保留（其测试仍在 DataClearingConfirmations 中使用）但已无产品入口；可在后续清理轮删除。
