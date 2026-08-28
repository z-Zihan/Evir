> **Status: Archived（历史执行产物）**
> 本文件是某一次工作轮的一次性执行/测试/审计记录，仅作历史证据，不代表当前产品状态，也不是规范来源。
> 当前事实来源：根目录 `AGENTS.md`、`docs/agent/Evir-project-memory.md` 与 `docs/` 正式文档。

# 回归测试报告（代码质量优化轮）

## Environment

- macOS 26.5.1（darwin 25.5.0，arm64）
- Node v24.18.0 / pnpm 10.0.0
- rustc 1.97.1 / cargo 1.97.1
- 分支 main（工作区含本轮优化前已存在的未提交改动 —— 系当天早些轮次的诊断 ZIP / README 等工作，非本轮产物，未触碰回退）

## Baseline（修改前）

| 检查                                      | 结果                        |
| ----------------------------------------- | --------------------------- |
| pnpm format:check                         | PASS                        |
| pnpm lint（--max-warnings 0）             | PASS                        |
| pnpm typecheck                            | PASS                        |
| pnpm test（主应用 vitest）                | PASS —— 103 文件 / 636 用例 |
| extensions/vscode check（typecheck+test） | PASS —— 8 用例              |
| packages/cli check（typecheck+test）      | PASS —— 8 用例              |
| pnpm release:validate-workflow            | PASS                        |
| cargo fmt --check                         | PASS                        |
| cargo clippy --all-targets                | PASS（0 警告）              |
| cargo test                                | PASS —— 25 用例             |

## Final（修改后）

| 检查                           | 结果                                 | 明细                                                                                         |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| pnpm format:check              | **PASS**                             |                                                                                              |
| pnpm lint                      | **PASS**                             | 修复过程中 3 个临时 lint 错误（未用导入/多余断言）当场清理                                   |
| pnpm typecheck                 | **PASS**                             | 0 错误                                                                                       |
| pnpm test                      | **PASS**                             | **105 文件 / 643 用例**（+2 文件 +7 用例，全部新增回归测试）                                 |
| extensions/vscode check        | **PASS**                             | 8 用例                                                                                       |
| packages/cli check             | **PASS**                             | 8 用例                                                                                       |
| pnpm release:validate-workflow | **PASS**                             | 随 `pnpm check` 全链执行                                                                     |
| cargo fmt --check              | **PASS**                             |                                                                                              |
| cargo clippy --all-targets     | **PASS**                             | 0 警告                                                                                       |
| cargo test                     | **PASS**                             | **31 用例**（+6：组件 id 穿越、UTF-8 截断、管道上限、home 阻断、快照负载包含、陈旧响应排空） |
| pnpm benchmark                 | **PASS**                             | 产物写入 docs/benchmarks/latest.json；依赖计数不变（未新增任何依赖）                         |
| pnpm test:ui（UI 矩阵）        | **PASS**                             | 2/2                                                                                          |
| pnpm test:a11y                 | **PASS**                             | 18/18                                                                                        |
| pnpm test:visual               | **PASS**                             | 6/6（无快照漂移）                                                                            |
| pnpm test:e2e（核心链路）      | **PASS 33 + 2 预存失败 + 9 skipped** | 见下                                                                                         |

## Pre-existing Failure（修改前即失败，非本轮回归）

`e2e/core.spec.ts:398 "failed provider connection is visible in redacted diagnostic logs"`（web-e2e 与 desktop-e2e 各 1 失败）。

**证据**：将全部工作区改动（本轮 + 早前轮次）`git stash` 后在纯 HEAD 上单跑该测试**同样失败**（同样的 "Export logs" 按钮定位超时），`git stash pop` 恢复后复跑仍稳定失败。该测试与工作区中尚未提交的诊断导出新 UI（DiagnosticsSettings bundle 导出流程）适配不完整，属当天诊断轮的遗留待办，与本次优化 diff 无关。其余 33 个核心 e2e 全绿。

## Commands（实际执行）

```
pnpm check                 # format:check + lint + typecheck + test + release:validate-workflow + vscode + cli
pnpm format                # 提交前统一格式化（项目自身 Prettier）
pnpm test / pnpm vitest run <file>   # 批次内定向验证
pnpm benchmark
pnpm test:e2e / test:ui / test:a11y / test:visual
pnpm exec playwright test --project=web-e2e --project=desktop-e2e -g "failed provider connection" e2e/core.spec.ts
git stash push -u / git stash pop     # 仅用于预存失败判定，工作区已完整恢复（51 项改动齐全）
cd src-tauri && cargo fmt --check && cargo clippy --all-targets && cargo test
```

## Not Run / 环境限制说明

| 项                                      | 原因与风险                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build:desktop`（tauri build 完整打包） | 全量门禁已含 tsc -b + vite build 前置类型/打包检查与 cargo clippy/test；打包链未动（仅 lib 代码修改），风险低。                                  |
| `build:vscode` / `package:vscode`       | vscode check（typecheck+test）已跑；打包配置未改动。                                                                                             |
| 桌面真机 GUI 手工回归                   | 本轮为代码质量轮；建议按 docs/23 §4.13 流程对 Agent 发送/停止/审批链路做一次真机冒烟（本轮恰修复了主线程阻塞与停止竞态，真机可感知验证收益高）。 |
| `release:validate-tag`                  | 需要具体发布 tag 上下文，属发布流程项，与代码无关。                                                                                              |

## 过程中的失败与处理（如实记录）

1. Batch 4 期间引入 `runStreamResponse` 拆分时丢失 `provider` 作用域 → 10 个 chat-store 测试失败 → 当场定位（新 catch 暴露 ReferenceError）并以参数传入修复 → 全绿。该失败从未离开本地。
2. 我新增的 Rust 测试 2 处初版断言/契约错误（截断计数、id-mismatch 旧契约）→ 修正后通过；其中旧契约测试按新语义重写并保留更强断言（响应不跨请求归属）。
3. e2e 2 失败经 stash 判定为预存（见上）。

## 结论

除 1 项预存 e2e 失败（与本次无关，已单列）外，**所有静态检查、单元/集成测试、Rust 三件套、benchmark、UI/a11y/visual/核心 e2e 全部通过**。本轮未新增任何依赖，未改任何公共接口、存储格式、事件与命令名。

---

# 第二轮回归（A–D 组清偿，2026-08-28）

## Environment

同第一轮（macOS 26.5.1 arm64 / Node 24.18 / pnpm 10 / rustc 1.97.1）。

## Result

| 检查                                 | 结果             | 明细                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm format:check / lint / typecheck | **PASS**         | 0 警告 0 错误                                                                                                                                                                                                          |
| pnpm test                            | **PASS**         | **107 文件 / 658 用例**（第二轮 +11：executor L2、verification×4、done-when 重写+权限、approve/deny 特征×4、发送停止等）                                                                                               |
| vscode / cli                         | **PASS**         | 8 / 8                                                                                                                                                                                                                  |
| cargo fmt --check / clippy           | **PASS**         |                                                                                                                                                                                                                        |
| cargo test                           | **PASS**         | **35 用例**（+2：readonly 闸口、api_key 清洗；+2：worktree 真实往返、非 git 失败）                                                                                                                                     |
| pnpm test:e2e                        | **PASS**         | **38 通过 / 0 失败** / 10 平台跳过（上轮预存失败已由产品 QA 轮修复并回归）                                                                                                                                             |
| pnpm test:stress                     | **PASS**         | 7 通过 / 1 Web 不适用                                                                                                                                                                                                  |
| pnpm test:ui / :visual / :a11y       | **PASS**         | 2 / 6 / 18                                                                                                                                                                                                             |
| pnpm benchmark                       | **PASS**         | 依赖数不变（未新增依赖）                                                                                                                                                                                               |
| pnpm build:desktop                   | **PASS**         | arm64 .app + DMG（含新 CSP；ad-hoc 签名，公证按用户指示跳过=非阻塞）                                                                                                                                                   |
| release:validate-tag                 | **PASS**         | `v0.1.0` 格式校验通过（脚本需传 tag 参数）                                                                                                                                                                             |
| 真机 CSP 冒烟                        | **PASS（受限）** | 打包版启动后完整写入 `app.session-started`/`project.loaded`/`personalization.loaded` 等日志 = CSP 下 JS/React/日志链路正常；AX 菜单退出干净。屏幕录制权限缺失，无法截屏/坐标级交互——深度 UI 交互冒烟留待下次有权限会话 |

## Not Run / 受限

- **深度真机交互冒烟**（发送→长命令→停止的主线程阻塞修复体感验证）：环境缺屏幕录制权限，无法操作窗口内容；建议你日常使用中留意（本轮后命令执行期间 UI 应全程流畅）。
- **签名/公证**：按明确指示降级为非必选、非阻塞；发布正式版前补 Apple 凭据即可。
- selectConversation 加载窄窗口竞态（P2-R6）：本轮未动（影响极窄，改动需引入消息版本号），仍留报告。

## 第二轮引入并修复的过程缺陷（如实记录）

1. `(async)` 属性转换后 diagnostics.rs 同步命令遗漏 → 补齐。
2. `check_no_tail` 为 rusqlite 私有（extra_check feature）→ 改词法层尾部检测 + readonly() 权威闸口；期间发现 `PRAGMA writable_schema` readonly() 误报 true → 增 PRAGMA 白名单。
3. 我的新测试文件经历多轮类型/lint 整备（mock 路径深度、vi.fn 泛型、require-await）——最终以显式泛型定稿；期间特征测试确实先于合并通过（4/4）后才动实现。
4. worktree 集成测试暴露 `--3-way` 拼写 bug（真缺陷，非测试问题）→ 修复。
